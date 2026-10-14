import { join } from "node:path";
import type { ResolvedAccessIntent } from "#src/access-intent/access-intent";
import {
  normalizeBashCommand,
  normalizeInput,
} from "#src/access-intent/input-normalizer";
import { surfaceFamilyOf } from "#src/access-intent/path-surfaces";
import { classifyToolKind } from "#src/access-intent/tool-kind";
import {
  getAncestorProjectScopes,
  getGlobalConfigPath,
} from "#src/config/config-paths";
import {
  FilePolicyLoader,
  type PolicyLoader,
  type PolicyLoaderOptions,
  type ResolvedPolicyPaths,
} from "#src/config/policy-loader";
import { type PathFlavor, posixPathFlavor } from "#src/path/path-flavor";
import type {
  FlatPermissionConfig,
  PermissionCheckResult,
  PermissionState,
} from "#src/types";
import { isPermissionState } from "#src/types";
import { normalizeFlatConfig, relocateMcpToolKeyRules } from "./normalize";
import type { Rule, RuleOrigin, Ruleset } from "./rule";
import {
  evaluate,
  evaluateAnyValue,
  floorAllowsToAsk,
  isSurfaceFullyDenied,
  rewriteAsksToYolo,
} from "./rule";
import { type MergedScopes, mergeScopesWithOrigins } from "./scope-merge";
import {
  composeRuleset,
  synthesizeBaseline,
  synthesizeDefaults,
} from "./synthesize";

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
   * names also drive the fail-closed notice in {@link getPolicyIssues}.
   */
  failClosedScopes: RuleOrigin[];
  /**
   * Top-level permission keys naming Pi MCP tools, relocated onto the `mcp`
   * surface; they drive the port notice in {@link getPolicyIssues}.
   */
  legacyMcpToolKeys: string[];
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
  isToolFullyDenied(toolName: string, agentName?: string): boolean;
  getPolicyIssues(agentName?: string): string[];
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

  /**
   * What composing `agentName`'s policy revealed: the fail-closed notice for
   * a rejected non-global scope and the port notice for relocated MCP tool
   * keys. Recomputed on every resolve, so a notice disappears once its cause is
   * fixed.
   *
   * A config file's own schema errors are not here: `ConfigStore` loads the
   * same files through the same `loadUnifiedConfig` and owns reporting them,
   * so listing them here too showed the operator each one twice (#953).
   */
  getPolicyIssues(agentName?: string): string[] {
    const { failClosedScopes, legacyMcpToolKeys } =
      this.resolvePermissions(agentName);
    const issues: string[] = [];
    if (failClosedScopes.length > 0) {
      issues.push(
        `Invalid ${failClosedScopes.join(", ")} configuration detected — ` +
          `failing closed: 'allow' rules are clamped to 'ask' for this session ` +
          `until the configuration is corrected.`,
      );
    }
    if (legacyMcpToolKeys.length > 0) {
      issues.push(formatMcpToolKeyPortNotice(legacyMcpToolKeys));
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

    const configRules = buildConfigRules(mergedPermission, origins);
    // A top-level `mcp__…` key now names an `mcp` candidate. The baseline reads
    // the rules as written, so a relocated `allow` on one Pi MCP tool does not
    // newly open the proxy's discovery targets.
    const relocation = relocateMcpToolKeyRules(configRules);

    const composedRules = composeRuleset(
      synthesizeDefaults(universalFallback, universalFallbackOrigin),
      synthesizeBaseline(configRules),
      relocation.rules,
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
      legacyMcpToolKeys: [...new Set(relocation.relocatedKeys)],
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
    const name = toolName.trim();
    if (classifyToolKind(name) === "mcp-tool") {
      return this.resolvePiMcpTool(name, composedRules);
    }
    // Every other surface (special, bash, mcp, skill, path-bearing, and
    // extension tools) resolves its tool-level state identically: evaluate the
    // surface name against the "*" catch-all value.
    return evaluate(name, "*", composedRules, this.flavor).action;
  }

  /**
   * Whether every value under a tool's surface resolves to `deny`.
   *
   * This is the question tool exposure asks, and it is not
   * {@link PermissionManager.getToolPermission} — that reports the surface's
   * catch-all, so `bash: {"*": "deny", "git *": "ask"}` reads as `deny` even
   * though `git status` would be asked about (#815).
   *
   * Reads the same composed rules the catch-all query does, so it inherits the
   * fail-closed floor and not the yolo rewrite. Neither matters: one touches
   * only `allow` and the other only `ask`, so neither can create or remove the
   * `deny` this answer turns on.
   */
  isToolFullyDenied(toolName: string, agentName?: string): boolean {
    const { composedRules } = this.resolvePermissions(agentName);
    const name = toolName.trim();
    if (classifyToolKind(name) === "mcp-tool") {
      return this.resolvePiMcpTool(name, composedRules) === "deny";
    }
    return isSurfaceFullyDenied(name, composedRules, this.flavor);
  }

  /**
   * The action a Pi MCP tool resolves to on the `mcp` surface.
   *
   * Its candidates come from its name alone, never its input, so this one
   * answer is both its tool-level state and whether it is fully denied.
   */
  private resolvePiMcpTool(
    toolName: string,
    composedRules: Ruleset,
  ): PermissionState {
    const { surface, values } = normalizeInput(
      toolName,
      undefined,
      this.loader.getConfiguredMcpServerNames(),
    );
    return evaluateAnyValue(surface, values, composedRules, this.flavor).rule
      .action;
  }

  /**
   * Unified resolution entry point — dispatches on intent kind.
   *
   * `"tool"` → normalizes raw input through `normalizeInput` (bash, skill, mcp,
   * extension surfaces). Path-bearing surfaces arrive as `"path-values"` via
   * the access-path gate (#502) or service/RPC builder (#503).
   * `"path-values"` → evaluates the precomputed values directly.
   * `"bash-command"` → evaluates a bash command unit and its spellings as
   * aliases through `normalizeBashCommand`.
   *
   * The manager stays string-based by design: it consumes `ResolvedAccessIntent`
   * (`tool | path-values | bash-command`) and never imports `AccessPath`. This deliberate
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

    if (intent.kind === "bash-command") {
      const { surface, values, resultExtras } = normalizeBashCommand(
        intent.command,
        intent.spellings,
      );
      const { result, matchedValue } = evaluateCheck(
        surface,
        values,
        resultExtras,
        surface,
        surface,
        fullRules,
        this.flavor,
      );
      // `values[0]` is the unit as typed, and the evaluator reports the first
      // value the winning rule matches, so any other value is a spelling the
      // typed text did not match.
      return matchedValue === values[0]
        ? result
        : { ...result, matchedSpelling: matchedValue };
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
 * Every surface resolves through {@link evaluateAnyValue}, so a rule's position
 * in the config decides and the candidate list only determines which name the
 * decision is reported under. Shared by the `"tool"` and `"path-values"`
 * branches of {@link PermissionManager.check}.
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
  return evaluateCheck(
    surface,
    values,
    resultExtras,
    normalizedToolName,
    toolName,
    fullRules,
    flavor,
  ).result;
}

/**
 * {@link buildCheckResult}, plus the candidate value the decision was reported
 * under — for a caller that knows what that value means on its own surface.
 */
function evaluateCheck(
  surface: string,
  values: string[],
  resultExtras: Record<string, unknown>,
  normalizedToolName: string,
  toolName: string,
  fullRules: Ruleset,
  flavor: PathFlavor,
): { result: PermissionCheckResult; matchedValue: string } {
  const { rule, value } = evaluateAnyValue(surface, values, fullRules, flavor);

  // For MCP, replace the normalizer's fallback target with the actual
  // matched candidate value so PermissionCheckResult.target is accurate.
  const extras =
    classifyToolKind(surface) === "mcp"
      ? { ...resultExtras, target: value }
      : resultExtras;

  return {
    result: {
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
    },
    matchedValue: value,
  };
}

const MCP_TOOL_KEY_MIGRATION_GUIDE =
  "https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/migration/1001-pi-mcp-tools-on-mcp-surface.md";

/** The notice asking the operator to move top-level `mcp__…` keys under `mcp`. */
function formatMcpToolKeyPortNotice(keys: readonly string[]): string {
  const named = keys.map((key) => `"${key}"`).join(", ");
  return (
    `Top-level permission keys naming Pi MCP tools are applied as "mcp" rules: ${named}. ` +
    `Move them under "mcp" — see ${MCP_TOOL_KEY_MIGRATION_GUIDE}`
  );
}

/**
 * Build the config-layer rules from the merged permission object: every key
 * except the universal `"*"` (which feeds `synthesizeDefaults` only), each
 * rule tagged with the `config` layer and the scope that contributed it.
 */
function buildConfigRules(
  mergedPermission: FlatPermissionConfig,
  origins: MergedScopes["origins"],
): Ruleset {
  const permissionWithoutUniversal: FlatPermissionConfig = Object.fromEntries(
    Object.entries(mergedPermission).filter(([k]) => k !== "*"),
  );
  return normalizeFlatConfig(permissionWithoutUniversal).map(
    (r): Rule => ({
      ...r,
      layer: "config",
      origin: origins.get(r.surface)?.get(r.pattern) ?? "builtin",
    }),
  );
}

/**
 * Derive `PolicyLoaderOptions` from an agentDir + an optional cwd.
 * Setting agentsDir explicitly from agentDir removes the hidden
 * `getAgentDir()` env-read that FilePolicyLoader's default would perform.
 *
 * The project scopes cover `cwd` and every parent directory's `.pi`,
 * top-most first, so parent-level permissions apply to nested sessions.
 */
function derivePolicyLoaderOptions(
  agentDir: string,
  cwd: string | undefined | null,
): PolicyLoaderOptions {
  const scopes = cwd ? getAncestorProjectScopes(cwd) : [];
  return {
    globalConfigPath: getGlobalConfigPath(agentDir),
    agentsDir: join(agentDir, "agents"),
    projectConfigScopes: scopes.map((scope) => ({
      dir: scope.dir,
      configPath: scope.configPath,
    })),
    projectAgentsDirs: scopes.map((scope) => scope.agentsDir),
    // Pi's built-in MCP reads these two files (`extensions/mcp/config.ts`).
    globalMcpConfigPath: join(agentDir, "mcp.json"),
    projectMcpConfigPaths: scopes.map((scope) => scope.mcpPath),
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
 * - mcp + other      → "mcp" (the proxy and Pi MCP tools alike)
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
  // Family membership, so a directional surface keeps reporting "special".
  if (SPECIAL_PERMISSION_KEYS.has(surfaceFamilyOf(toolName))) return "special";

  switch (classifyToolKind(toolName)) {
    case "mcp":
    case "mcp-tool":
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
export type {
  PolicyLoader,
  ResolvedPolicyPaths,
} from "#src/config/policy-loader";
