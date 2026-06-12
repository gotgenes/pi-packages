import { join } from "node:path";
import { isPermissionState } from "./common";
import { getGlobalConfigPath, getProjectConfigPath } from "./config-paths";
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
   * Session rules are appended at call-time inside checkPermission().
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
  checkPermission(
    toolName: string,
    input: unknown,
    agentName?: string,
    sessionRules?: Ruleset,
  ): PermissionCheckResult;
  /**
   * Evaluate the cross-cutting `path` surface against a caller-supplied set of
   * equivalent policy values (e.g. bash tokens already resolved against a
   * preceding literal `cd`). The values are trusted because they are computed
   * internally, never read from a field on raw tool input.
   */
  checkPathPolicy(
    values: readonly string[],
    agentName?: string,
    sessionRules?: Ruleset,
  ): PermissionCheckResult;
  getToolPermission(toolName: string, agentName?: string): PermissionState;
  getConfigIssues(agentName?: string): string[];
  getPolicyCacheStamp(agentName?: string): string;
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

  getResolvedPolicyPaths(): ResolvedPolicyPaths {
    return this.loader.getResolvedPolicyPaths();
  }

  getPolicyCacheStamp(agentName?: string): string {
    return this.loader.getCacheStamp(agentName);
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

  checkPermission(
    toolName: string,
    input: unknown,
    agentName?: string,
    sessionRules?: Ruleset,
  ): PermissionCheckResult {
    const { composedRules } = this.resolvePermissions(agentName);
    const normalizedToolName = toolName.trim();

    // Append session rules at the end (highest priority) so evaluate() handles
    // them via last-match-wins — no separate per-branch pre-check needed.
    const fullRules: Ruleset = sessionRules?.length
      ? [...composedRules, ...sessionRules]
      : composedRules;

    const { surface, values, resultExtras } = normalizeInput(
      normalizedToolName,
      input,
      this.loader.getConfiguredMcpServerNames(),
      this.currentCwd,
    );

    return buildCheckResult(
      surface,
      values,
      resultExtras,
      normalizedToolName,
      toolName,
      fullRules,
    );
  }

  checkPathPolicy(
    values: readonly string[],
    agentName?: string,
    sessionRules?: Ruleset,
  ): PermissionCheckResult {
    const { composedRules } = this.resolvePermissions(agentName);
    const fullRules: Ruleset = sessionRules?.length
      ? [...composedRules, ...sessionRules]
      : composedRules;

    const lookupValues = values.length > 0 ? [...values] : ["*"];
    return buildCheckResult(
      "path",
      lookupValues,
      {},
      "path",
      "path",
      fullRules,
    );
  }
}

/**
 * Evaluate a normalized surface/values triple and shape the result.
 *
 * Path surfaces use {@link evaluateAnyValue} (last-match-wins across equivalent
 * aliases); every other surface keeps {@link evaluateFirst}. Shared by
 * `checkPermission` and `checkPathPolicy`.
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
    projectAgentsDir: cwd ? join(cwd, ".pi", "agent", "agents") : undefined,
  };
}

/**
 * Map a matched rule + tool name to the correct PermissionCheckResult.source.
 *
 * Mirrors the source-derivation logic from the former per-branch
 * checkPermission() implementation:
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
