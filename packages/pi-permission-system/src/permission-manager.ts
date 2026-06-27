import { join } from "node:path";
import type { ResolvedAccessIntent } from "./access-intent/access-intent";
import {
  getGlobalConfigPath,
  getProjectAgentsDir,
  getProjectConfigPath,
} from "./config-paths";
import { normalizeInput } from "./input-normalizer";
import { normalizeFlatConfig } from "./normalize";
import { PATH_SURFACES } from "./path-utils";
import {
  FilePolicyLoader,
  type PolicyLoader,
  type PolicyLoaderOptions,
  type ResolvedPolicyPaths,
} from "./policy-loader";
import type { Rule, RuleOrigin, Ruleset } from "./rule";
import { evaluate, evaluateAnyValue, evaluateFirst } from "./rule";
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
import { isPermissionState } from "./value-guards";

const BUILT_IN_TOOL_PERMISSION_NAMES = new Set([
  "bash",
  "read",
  "write",
  "edit",
  "grep",
  "find",
  "ls",
]);
const SPECIAL_PERMISSION_KEYS = new Set(["external_directory", "path"]);

/** Universal fallback when permission["*"] is absent from all scopes. */
const DEFAULT_UNIVERSAL_FALLBACK: PermissionState = "ask";

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
  /**
   * Returns true when at least one explicit `path`-surface rule exists in the
   * composed config ruleset for the given agent scope.
   *
   * Used by the path permission gate as a fast-path skip to avoid calling
   * `fs.realpath()` on every tool invocation when no path rules are configured.
   *
   * Optional so lightweight test mocks that don't exercise symlink resolution
   * are not required to implement it.
   */
  hasPathRules?(agentName?: string): boolean;
}

export interface PermissionManagerOptions extends PolicyLoaderOptions {
  policyLoader?: PolicyLoader;
  /**
   * Pi agent directory.  When provided, the manager derives all loader paths
   * from this value and supports {@link PermissionManager.configureForCwd}.
   */
  agentDir?: string;
}

export class PermissionManager implements ScopedPermissionManager {
  private readonly agentDir: string | undefined;
  private currentCwd: string | undefined;
  private loader: PolicyLoader;
  private readonly resolvedPermissionsCache = new Map<
    string,
    FileCacheEntry<ResolvedPermissions>
  >();

  constructor(options: PermissionManagerOptions = {}) {
    this.agentDir = options.agentDir;
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
    this.currentCwd =
      typeof cwd === "string" && cwd.trim().length > 0 ? cwd : undefined;
    if (this.agentDir !== undefined) {
      this.loader = new FilePolicyLoader(
        derivePolicyLoaderOptions(this.agentDir, cwd),
      );
    }
    this.resolvedPermissionsCache.clear();
  }

  getConfigIssues(agentName?: string): string[] {
    // Trigger a load/resolve to ensure issues are collected.
    this.resolvePermissions(agentName);
    return [...this.loader.getConfigIssues()];
  }

  hasPathRules(agentName?: string): boolean {
    const { composedRules } = this.resolvePermissions(agentName);
    return composedRules.some(
      (r) => r.surface === "path" && r.layer === "config",
    );
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

    const value: ResolvedPermissions = { composedRules };
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
    const normalizedToolName = toolName.trim();

    // Special surfaces (external_directory): evaluate directly by surface name.
    if (SPECIAL_PERMISSION_KEYS.has(normalizedToolName)) {
      return evaluate(normalizedToolName, "*", composedRules).action;
    }

    // Bash, MCP, skill: evaluate with "*" value — the per-surface catch-all
    // (or universal default) handles this correctly.
    if (normalizedToolName === "bash") {
      return evaluate("bash", "*", composedRules).action;
    }
    if (normalizedToolName === "mcp") {
      return evaluate("mcp", "*", composedRules).action;
    }
    if (normalizedToolName === "skill") {
      return evaluate("skill", "*", composedRules).action;
    }

    // Tool-name surfaces (read, write, etc. and extension tools).
    return evaluate(normalizedToolName, "*", composedRules).action;
  }

  /**
   * Unified resolution entry point — dispatches on intent kind.
   *
   * `"tool"` → normalizes raw input through `normalizeInput`.
   * `"path-values"` → evaluates the precomputed values directly.
   */
  check(
    intent: ResolvedAccessIntent,
    sessionRules?: Ruleset,
  ): PermissionCheckResult {
    const { composedRules } = this.resolvePermissions(intent.agentName);
    const fullRules: Ruleset = sessionRules?.length
      ? [...composedRules, ...sessionRules]
      : composedRules;

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
      );
    }

    // kind === "tool"
    const toolName = intent.surface.trim();
    const { surface, values, resultExtras } = normalizeInput(
      toolName,
      intent.input,
      this.loader.getConfiguredMcpServerNames(),
      this.currentCwd,
    );
    return buildCheckResult(
      surface,
      values,
      resultExtras,
      toolName,
      intent.surface,
      fullRules,
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
): PermissionCheckResult {
  const { rule, value } = PATH_SURFACES.has(surface)
    ? evaluateAnyValue(surface, values, fullRules)
    : evaluateFirst(surface, values, fullRules);

  // For MCP, replace the normalizer's fallback target with the actual
  // matched candidate value so PermissionCheckResult.target is accurate.
  const extras =
    surface === "mcp" ? { ...resultExtras, target: value } : resultExtras;

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
    agentsDir: join(agentDir, "agents"),
    projectGlobalConfigPath: cwd ? getProjectConfigPath(cwd) : undefined,
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

  if (toolName === "mcp") {
    if (rule.layer === "default") return "default";
    return "mcp";
  }

  if (SPECIAL_PERMISSION_KEYS.has(toolName)) return "special";
  if (toolName === "skill") return "skill";
  if (toolName === "bash") return "bash";

  // Built-in tools always report "tool"; extension tools distinguish default.
  if (BUILT_IN_TOOL_PERMISSION_NAMES.has(toolName)) return "tool";
  return rule.layer === "default" ? "default" : "tool";
}

// Re-export types that external modules import from this file.
export type { PolicyLoader, ResolvedPolicyPaths } from "./policy-loader";
