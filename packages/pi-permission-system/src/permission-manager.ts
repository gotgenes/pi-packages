import { join } from "node:path";
import type { ResolvedAccessIntent } from "./access-intent/access-intent";
import { normalizeInput } from "./access-intent/input-normalizer";
import { PATH_SURFACES } from "./access-intent/path-surfaces";
import { classifyToolKind } from "./access-intent/tool-kind";
import {
  getGlobalConfigPath,
  getGlobalSettingsPath,
  getProjectAgentsDir,
  getProjectConfigPath,
  getProjectSettingsPath,
} from "./config-paths";
import { normalizeFlatConfig } from "./normalize";
import { type PathFlavor, posixPathFlavor } from "./path/path-flavor";
import {
  FilePolicyLoader,
  type PolicyLoader,
  type PolicyLoaderOptions,
  type ResolvedPolicyPaths,
} from "./policy-loader";
import type { Rule, RuleOrigin, Ruleset } from "./rule";
import {
  evaluate,
  evaluateAnyValue,
  evaluateFirst,
  floorAllowsToAsk,
  rewriteAsksToYolo,
} from "./rule";
import { mergeScopesWithOrigins } from "./scope-merge";
import {
  composeRuleset,
  synthesizeBaseline,
  synthesizeDefaults,
} from "./synthesize";
import type {
  FlatPermissionConfig,
  PermissionCheckResult,
  PermissionState,
} from "./types";
import { isPermissionState } from "./types";

const SPECIAL_PERMISSION_KEYS = new Set(["external_directory", "path"]);

/** Universal fallback when permission["*"] is absent from all scopes. */
const DEFAULT_UNIVERSAL_FALLBACK: PermissionState = "ask";

/** Default yolo reader — yolo disabled unless the composition root injects one. */
const YOLO_DISABLED = (): boolean => false;

type FileCacheEntry<TValue> = {
  stamp: string;
  value: TValue;
};

type ResolvedPermissions = {
  /**
   * Fully composed ruleset: synthesized defaults → baseline → config.
   * Session rules are appended at call-time inside check().
   */
  composedRules: Ruleset;
  /**
   * Non-global scopes whose config file failed to load or validate. When
   * non-empty the composed ruleset has been floored allow→ask (#646); the
   * names also drive the fail-closed notice in {@link getConfigIssues}.
   */
  failClosedScopes: RuleOrigin[];
};

/**
 * Narrow interface for session-scoped permission checking.
 * `PermissionSession` depends on this — not the full concrete class — so
 * test mocks can satisfy it without an `as unknown as PermissionManager` cast.
 */
export interface ScopedPermissionManager {
  configureForCwd(cwd: string | undefined | null): void;
  /**
   * Unified resolution entry point (Phase 6 Step 6, #478).
   *
   * Replaces the former `checkPermission` + `checkPathPolicy` method pair with
   * a single dispatched call, making it structurally impossible to stub one
   * method and forget the other (the #393 false-green class).
   */
  check(
    intent: ResolvedAccessIntent,
    sessionRules?: Ruleset,
  ): PermissionCheckResult;
  getToolPermission(toolName: string, agentName?: string): PermissionState;
  getConfigIssues(agentName?: string): string[];
}

export interface PermissionManagerOptions extends PolicyLoaderOptions {
  policyLoader?: PolicyLoader;
  /**
   * Pi agent directory.  When provided, the manager derives all loader paths
   * from this value and supports {@link PermissionManager.configureForCwd}.
   */
  agentDir?: string;
  /**
   * Resolved path-language flavor, injected from the composition root, that
   * decides whether path-surface rule matching folds case (and separators) on
   * Windows. Defaults to the POSIX flavor; production always supplies the real
   * platform's flavor.
   */
  flavor?: PathFlavor;
  /**
   * yolo-mode reader, injected from the composition root. When it reports
   * true, {@link PermissionManager.check} rewrites every matched `ask` to a
   * standing `allow` tagged `origin: "yolo"` (recorded authority, #526).
   * Read per check so a mid-session config change takes effect; defaults to
   * yolo disabled.
   */
  isYoloEnabled?: () => boolean;
}

export class PermissionManager implements ScopedPermissionManager {
  private readonly agentDir: string | undefined;
  private readonly flavor: PathFlavor;
  private readonly isYoloEnabled: () => boolean;
  private loader: PolicyLoader;
  private readonly resolvedPermissionsCache = new Map<
    string,
    FileCacheEntry<ResolvedPermissions>
  >();

  constructor(options: PermissionManagerOptions = {}) {
    this.agentDir = options.agentDir;
    this.flavor = options.flavor ?? posixPathFlavor;
    this.isYoloEnabled = options.isYoloEnabled ?? YOLO_DISABLED;
    this.loader =
      options.policyLoader ??
      new FilePolicyLoader(
        options.agentDir !== undefined
          ? derivePolicyLoaderOptions(options.agentDir, undefined)
          : options,
      );
  }

  /**
   * Rebuild the policy loader for a new working directory and clear the
   * resolved-permissions cache.
   *
   * When `agentDir` was not provided at construction (e.g. test managers
   * built with explicit paths), only the cache is cleared.
   */
  configureForCwd(cwd: string | undefined | null): void {
    if (this.agentDir !== undefined) {
      this.loader = new FilePolicyLoader(
        derivePolicyLoaderOptions(this.agentDir, cwd),
      );
    }
    this.resolvedPermissionsCache.clear();
  }

  getConfigIssues(agentName?: string): string[] {
    // Trigger a load/resolve to ensure issues are collected.
    const { failClosedScopes } = this.resolvePermissions(agentName);
    const issues = [...this.loader.getConfigIssues()];
    if (failClosedScopes.length > 0) {
      issues.push(
        `Invalid ${failClosedScopes.join(", ")} configuration detected — ` +
          `failing closed: 'allow' rules are clamped to 'ask' for this session ` +
          `until the configuration is corrected.`,
      );
    }
    return issues;
  }

  getResolvedPolicyPaths(): ResolvedPolicyPaths {
    return this.loader.getResolvedPolicyPaths();
  }

  private resolvePermissions(agentName?: string): ResolvedPermissions {
    const cacheKey = agentName ?? "__global__";
    const stamp = this.loader.getCacheStamp(agentName);
    const cached = this.resolvedPermissionsCache.get(cacheKey);
    if (cached?.stamp === stamp) {
      return cached.value;
    }

    const globalConfig = this.loader.loadGlobalConfig();
    const projectConfig = this.loader.loadProjectConfig();
    const agentConfig = this.loader.loadAgentConfig(agentName);
    const projectAgentConfig = this.loader.loadProjectAgentConfig(agentName);

    // Merge permission objects across scopes (lowest → highest precedence),
    // building a parallel origin map that tracks which scope contributed each
    // (surface, pattern) entry.
    const { mergedPermission, origins } = mergeScopesWithOrigins([
      ["global", globalConfig],
      ["project", projectConfig],
      ["agent", agentConfig],
      ["project-agent", projectAgentConfig],
    ]);

    // Extract the universal fallback from permission["*"].
    // The "*" key feeds synthesizeDefaults() only — it is NOT included as a
    // config rule so that extension tools fall through to source:"default".
    const universalFallback = isPermissionState(mergedPermission["*"])
      ? mergedPermission["*"]
      : DEFAULT_UNIVERSAL_FALLBACK;
    // Track which scope contributed the universal fallback.
    const universalFallbackOrigin: RuleOrigin =
      origins.get("*")?.get("*") ?? "builtin";

    // Build config rules from everything except the universal "*" key.
    const permissionWithoutUniversal: FlatPermissionConfig = Object.fromEntries(
      Object.entries(mergedPermission).filter(([k]) => k !== "*"),
    );

    // Normalize to config rules, tagged with "config" layer and their origin.
    const configRules: Ruleset = normalizeFlatConfig(
      permissionWithoutUniversal,
    ).map(
      (r): Rule => ({
        ...r,
        layer: "config",
        origin: origins.get(r.surface)?.get(r.pattern) ?? "builtin",
      }),
    );

    const composedRules = composeRuleset(
      synthesizeDefaults(universalFallback, universalFallbackOrigin),
      synthesizeBaseline(configRules),
      configRules,
    );

    // Fail closed when a non-global scope's config is invalid: floor every
    // `allow` (including one inherited from a lower scope) to `ask` so a
    // higher scope meant to tighten policy cannot silently fail open (#646).
    // Global is excluded — nothing more permissive is inherited when it fails.
    const failClosedScopes: RuleOrigin[] = [];
    if (projectConfig.invalid === true) failClosedScopes.push("project");
    if (agentConfig.invalid === true) failClosedScopes.push("agent");
    if (projectAgentConfig.invalid === true)
      failClosedScopes.push("project-agent");

    const effectiveRules =
      failClosedScopes.length > 0
        ? floorAllowsToAsk(composedRules)
        : composedRules;

    const value: ResolvedPermissions = {
      composedRules: effectiveRules,
      failClosedScopes,
    };
    this.resolvedPermissionsCache.set(cacheKey, { stamp, value });
    return value;
  }

  /**
   * Return the composed config-layer rules for the given agent scope.
   * Used by the `/permission-system show` command to display effective rules
   * with their origin annotations.
   * Session rules are not included — they are runtime-only.
   */
  getComposedConfigRules(agentName?: string): Ruleset {
    const { composedRules } = this.resolvePermissions(agentName);
    return composedRules.filter((r) => r.layer === "config");
  }

  /**
   * Get the tool-level permission state for a tool, without considering
   * command-level rules. Used for tool injection decisions.
   */
  getToolPermission(toolName: string, agentName?: string): PermissionState {
    const { composedRules } = this.resolvePermissions(agentName);
    // Every surface (special, bash, mcp, skill, path-bearing, and extension
    // tools) resolves its tool-level state identically: evaluate the surface
    // name against the "*" catch-all value. There is no per-kind branch.
    return evaluate(toolName.trim(), "*", composedRules, this.flavor).action;
  }

  /**
   * Unified resolution entry point — dispatches on intent kind.
   *
   * `"tool"` → normalizes raw input through `normalizeInput` (bash, skill, mcp,
   * extension surfaces). Path-bearing surfaces arrive as `"path-values"` via
   * the access-path gate (#502) or service/RPC builder (#503).
   * `"path-values"` → evaluates the precomputed values directly.
   *
   * The manager stays string-based by design: it consumes `ResolvedAccessIntent`
   * (`tool | path-values`) and never imports `AccessPath`. This deliberate
   * boundary is formalized in ADR-0002
   * (`docs/decisions/0002-path-values-string-boundary.md`) and guarded by a
   * `no-restricted-imports` lint rule on this file.
   */
  check(
    intent: ResolvedAccessIntent,
    sessionRules?: Ruleset,
  ): PermissionCheckResult {
    const { composedRules } = this.resolvePermissions(intent.agentName);
    const composedWithSession: Ruleset = sessionRules?.length
      ? [...composedRules, ...sessionRules]
      : composedRules;
    // Apply the yolo rewrite post-cache so the resolved-permissions cache and
    // the display surfaces (getComposedConfigRules / getToolPermission) stay
    // yolo-free — only the resolution path sees the ask→allow rewrite (#526).
    const fullRules: Ruleset = this.isYoloEnabled()
      ? rewriteAsksToYolo(composedWithSession)
      : composedWithSession;

    if (intent.kind === "path-values") {
      const lookupValues =
        intent.values.length > 0 ? [...intent.values] : ["*"];
      return buildCheckResult(
        intent.surface,
        lookupValues,
        {},
        intent.surface,
        intent.surface,
        fullRules,
        this.flavor,
      );
    }

    // kind === "tool"
    const toolName = intent.surface.trim();
    const { surface, values, resultExtras } = normalizeInput(
      toolName,
      intent.input,
      this.loader.getConfiguredMcpServerNames(),
    );
    return buildCheckResult(
      surface,
      values,
      resultExtras,
      toolName,
      intent.surface,
      fullRules,
      this.flavor,
    );
  }
}

/**
 * Evaluate a normalized surface/values triple and shape the result.
 *
 * Path surfaces use {@link evaluateAnyValue} (last-match-wins across equivalent
 * aliases); every other surface keeps {@link evaluateFirst}. Shared by the
 * `"tool"` and `"path-values"` branches of {@link PermissionManager.check}.
 */
function buildCheckResult(
  surface: string,
  values: string[],
  resultExtras: Record<string, unknown>,
  normalizedToolName: string,
  toolName: string,
  fullRules: Ruleset,
  flavor: PathFlavor,
): PermissionCheckResult {
  const { rule, value } = PATH_SURFACES.has(surface)
    ? evaluateAnyValue(surface, values, fullRules, flavor)
    : evaluateFirst(surface, values, fullRules, flavor);

  // For MCP, replace the normalizer's fallback target with the actual
  // matched candidate value so PermissionCheckResult.target is accurate.
  const extras =
    classifyToolKind(surface) === "mcp"
      ? { ...resultExtras, target: value }
      : resultExtras;

  return {
    toolName,
    state: rule.action,
    reason: rule.reason,
    matchedPattern:
      rule.layer === "config" || rule.layer === "session"
        ? rule.pattern
        : undefined,
    source: deriveSource(rule, normalizedToolName),
    origin: rule.origin,
    ...extras,
  };
}

/**
 * Derive `PolicyLoaderOptions` from an agentDir + an optional cwd.
 * Setting agentsDir explicitly from agentDir removes the hidden
 * `getAgentDir()` env-read that FilePolicyLoader's default would perform.
 */
function derivePolicyLoaderOptions(
  agentDir: string,
  cwd: string | undefined | null,
): PolicyLoaderOptions {
  return {
    globalConfigPath: getGlobalConfigPath(agentDir),
    globalSettingsPath: getGlobalSettingsPath(agentDir),
    agentsDir: join(agentDir, "agents"),
    projectGlobalConfigPath: cwd ? getProjectConfigPath(cwd) : undefined,
    projectSettingsPath: cwd ? getProjectSettingsPath(cwd) : undefined,
    projectAgentsDir: cwd ? getProjectAgentsDir(cwd) : undefined,
  };
}

/**
 * Map a matched rule + tool name to the correct PermissionCheckResult.source.
 *
 * Mirrors the source-derivation logic from the former per-branch
 * permission-check implementation:
 *
 * - session          → "session" (always, all surfaces)
 * - mcp + default    → "default"
 * - mcp + other      → "mcp"
 * - special          → "special" (always)
 * - skill            → "skill" (always)
 * - bash             → "bash" (always)
 * - built-in tool    → "tool" (always)
 * - extension tool   → "default" when default layer, "tool" otherwise
 */
function deriveSource(
  rule: Rule,
  toolName: string,
): PermissionCheckResult["source"] {
  if (rule.layer === "session") return "session";
  if (SPECIAL_PERMISSION_KEYS.has(toolName)) return "special";

  switch (classifyToolKind(toolName)) {
    case "mcp":
      return rule.layer === "default" ? "default" : "mcp";
    case "skill":
      return "skill";
    case "bash":
      return "bash";
    case "path":
      // Built-in path-bearing tools (read/write/edit/grep/find/ls).
      return "tool";
    case "extension":
      // Extension tools distinguish a synthesized-default match from a rule.
      return rule.layer === "default" ? "default" : "tool";
  }
}

// Re-export types that external modules import from this file.
export type { PolicyLoader, ResolvedPolicyPaths } from "./policy-loader";
