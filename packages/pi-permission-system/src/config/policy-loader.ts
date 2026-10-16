import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { mergeFlatPermissions } from "#src/policy/permission-merge";
import type { FlatPermissionConfig, ScopeConfig } from "#src/types";
import { toRecord } from "#src/value-guards";
import {
  loadUnifiedConfig,
  normalizeFlatPermissionValue,
  rebasePermissionForDir,
  stripJsonComments,
} from "./config-loader";
import { getGlobalConfigPath } from "./config-paths";
import { extractFrontmatter, parseSimpleYamlMap } from "./yaml-frontmatter";

// ---------------------------------------------------------------------------
// File-stamp helper
// ---------------------------------------------------------------------------

function getFileStamp(path: string): string {
  try {
    return String(statSync(path).mtimeMs);
  } catch {
    return "missing";
  }
}

// ---------------------------------------------------------------------------
// MCP server-name reading helpers
// ---------------------------------------------------------------------------

function readConfiguredMcpServerNamesFromConfigPath(
  configPath: string,
): string[] {
  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(stripJsonComments(raw)) as unknown;
    const root = toRecord(parsed);
    const serverRecord = toRecord(root.mcpServers ?? root["mcp-servers"]);

    return Object.keys(serverRecord)
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
  } catch {
    return [];
  }
}

function getConfiguredMcpServerNamesFromPaths(
  paths: readonly string[],
): string[] {
  const seen = new Set<string>();

  for (const path of paths) {
    for (const name of readConfiguredMcpServerNamesFromConfigPath(path)) {
      seen.add(name);
    }
  }

  return [...seen].sort(
    (left, right) => right.length - left.length || left.localeCompare(right),
  );
}

// ---------------------------------------------------------------------------
// Resolved policy paths
// ---------------------------------------------------------------------------

export interface ResolvedPolicyPaths {
  globalConfigPath: string;
  globalConfigExists: boolean;
  projectConfigPath: string | null;
  projectConfigExists: boolean;
  /** Every ancestor project config path, top-most first (`[]` when none). */
  projectConfigPaths?: readonly string[];
  agentsDir: string;
  agentsDirExists: boolean;
  projectAgentsDir: string | null;
  projectAgentsDirExists: boolean;
  /** Every ancestor project agents dir, top-most first (`[]` when none). */
  projectAgentsDirs?: readonly string[];
}

// ---------------------------------------------------------------------------
// PolicyLoader interface
// ---------------------------------------------------------------------------

/**
 * Abstraction over file I/O for loading permission policy from disk.
 * Implementations handle caching, path resolution, and marking a rejected
 * scope `invalid`.  `PermissionManager` depends on this interface so that
 * merge + evaluation logic can be tested with an in-memory stub.
 */
export interface PolicyLoader {
  loadGlobalConfig(): ScopeConfig;
  loadProjectConfig(): ScopeConfig;
  loadAgentConfig(agentName?: string): ScopeConfig;
  loadProjectAgentConfig(agentName?: string): ScopeConfig;
  getConfiguredMcpServerNames(): readonly string[];
  /** Combined mtime stamp for cache invalidation. */
  getCacheStamp(agentName?: string): string;
  /** Resolved paths for the /permission-system show command. */
  getResolvedPolicyPaths(): ResolvedPolicyPaths;
}

// ---------------------------------------------------------------------------
// Default path factories (deferred until call-time, not module scope)
// ---------------------------------------------------------------------------

function defaultGlobalConfigPath(): string {
  return getGlobalConfigPath(getAgentDir());
}
function defaultAgentsDir(): string {
  return join(getAgentDir(), "agents");
}
function defaultGlobalMcpConfigPath(): string {
  return join(getAgentDir(), "mcp.json");
}

// ---------------------------------------------------------------------------
// File cache helper type
// ---------------------------------------------------------------------------

type FileCacheEntry<TValue> = {
  stamp: string;
  value: TValue;
};

// ---------------------------------------------------------------------------
// Options shared between FilePolicyLoader and the backward-compat
// PermissionManager constructor.
// ---------------------------------------------------------------------------

/**
 * One project scope in the ancestor chain: the config file plus the directory
 * that owns it. `dir` rebases the scope's relative path patterns (see
 * `rebasePermissionForDir`); `null` keeps the legacy no-rebase behavior for
 * a lone path with no known owner.
 */
export interface ProjectConfigScope {
  dir: string | null;
  configPath: string;
}

export interface PolicyLoaderOptions {
  globalConfigPath?: string;
  agentsDir?: string;
  projectGlobalConfigPath?: string;
  projectAgentsDir?: string;
  /**
   * Ancestor project config scopes, top-most first. When non-empty it fully
   * describes the project chain (including `cwd` itself) and
   * `projectGlobalConfigPath` is ignored.
   */
  projectConfigScopes?: readonly ProjectConfigScope[];
  /**
   * Ancestor project agents dirs, top-most first. When non-empty it fully
   * describes the project-agents chain and `projectAgentsDir` is ignored.
   */
  projectAgentsDirs?: readonly string[];
  globalMcpConfigPath?: string;
  /**
   * The project's `.pi/mcp.json`, read beside the global file the way Pi's
   * built-in MCP reads it. Set only for a trusted project: the manager derives
   * it from a cwd, and an untrusted project's cwd is withheld.
   */
  projectMcpConfigPath?: string;
  /**
   * Ancestor project `.pi/mcp.json` paths, top-most first. When non-empty it
   * fully describes the project MCP chain and `projectMcpConfigPath` is
   * ignored.
   */
  projectMcpConfigPaths?: readonly string[];
  mcpServerNames?: readonly string[];
}

// ---------------------------------------------------------------------------
// FilePolicyLoader — the production implementation
// ---------------------------------------------------------------------------

/**
 * Production `PolicyLoader` that reads config files from disk with
 * mtime-based caching.
 */
export class FilePolicyLoader implements PolicyLoader {
  private readonly globalConfigPath: string;
  private readonly agentsDir: string;
  private readonly projectConfigScopes: readonly ProjectConfigScope[];
  private readonly projectAgentsDirs: readonly string[];
  private readonly globalMcpConfigPath: string;
  private readonly projectMcpConfigPaths: readonly string[];
  private readonly configuredMcpServerNamesOverride: readonly string[] | null;

  private globalConfigCache: FileCacheEntry<ScopeConfig> | null = null;
  private projectGlobalConfigCache: FileCacheEntry<ScopeConfig> | null = null;
  private readonly agentConfigCache = new Map<
    string,
    FileCacheEntry<ScopeConfig>
  >();
  private readonly projectAgentConfigCache = new Map<
    string,
    FileCacheEntry<ScopeConfig>
  >();
  private configuredMcpServerNamesCache: FileCacheEntry<
    readonly string[]
  > | null = null;

  constructor(options: PolicyLoaderOptions = {}) {
    this.globalConfigPath =
      options.globalConfigPath ?? defaultGlobalConfigPath();
    this.agentsDir = options.agentsDir ?? defaultAgentsDir();
    this.projectConfigScopes =
      options.projectConfigScopes && options.projectConfigScopes.length > 0
        ? options.projectConfigScopes
        : options.projectGlobalConfigPath
          ? [{ dir: null, configPath: options.projectGlobalConfigPath }]
          : [];
    this.projectAgentsDirs =
      options.projectAgentsDirs && options.projectAgentsDirs.length > 0
        ? options.projectAgentsDirs
        : options.projectAgentsDir
          ? [options.projectAgentsDir]
          : [];
    this.globalMcpConfigPath =
      options.globalMcpConfigPath ?? defaultGlobalMcpConfigPath();
    this.projectMcpConfigPaths =
      options.projectMcpConfigPaths && options.projectMcpConfigPaths.length > 0
        ? options.projectMcpConfigPaths
        : options.projectMcpConfigPath
          ? [options.projectMcpConfigPath]
          : [];
    this.configuredMcpServerNamesOverride = options.mcpServerNames
      ? [
          ...new Set(
            options.mcpServerNames
              .map((name) => name.trim())
              .filter((name) => name.length > 0),
          ),
        ]
      : null;
  }

  // ── Scope loaders ────────────────────────────────────────────────────
  //
  // A config file's schema errors are not kept here: `ConfigStore` loads the
  // same files through the same `loadUnifiedConfig` and reports them, so this
  // loader reads them only to decide whether a scope fails closed (#953).

  loadGlobalConfig(): ScopeConfig {
    const stamp = getFileStamp(this.globalConfigPath);
    if (this.globalConfigCache?.stamp === stamp) {
      return this.globalConfigCache.value;
    }

    const { config } = loadUnifiedConfig(this.globalConfigPath);

    const value: ScopeConfig = {
      permission: config.permission,
    };

    this.globalConfigCache = { stamp, value };
    return value;
  }

  loadProjectConfig(): ScopeConfig {
    if (this.projectConfigScopes.length === 0) {
      return {};
    }

    const stamp = this.projectConfigScopes
      .map((scope) => `${scope.configPath}:${getFileStamp(scope.configPath)}`)
      .join("|");
    if (this.projectGlobalConfigCache?.stamp === stamp) {
      return this.projectGlobalConfigCache.value;
    }

    // Merge the ancestor chain top-most first so the nearest scope wins.
    // Every scope but the nearest keeps its relative path patterns resolved
    // against its own directory (see `rebasePermissionForDir`); the nearest
    // scope keeps its legacy cwd-relative matching unchanged.
    let permission: FlatPermissionConfig | undefined;
    let invalid = false;
    // A `for...of` (not `forEach`): assignments to `invalid` inside the body
    // must stay visible to the read below for the fail-closed flag to type.
    for (const [index, scope] of this.projectConfigScopes.entries()) {
      const { config, issues } = loadUnifiedConfig(scope.configPath);
      // A present-but-rejected file yields issues (parse error or schema
      // rejection); an absent file yields none. Fail closed on the former —
      // any rejected scope in the chain clamps the merged result (#646).
      if (issues.length > 0) invalid = true;
      let scopePermission = config.permission;
      if (
        scopePermission &&
        scope.dir !== null &&
        index < this.projectConfigScopes.length - 1
      ) {
        scopePermission = rebasePermissionForDir(scopePermission, scope.dir);
      }
      if (scopePermission) {
        permission = permission
          ? mergeFlatPermissions(permission, scopePermission)
          : { ...scopePermission };
      }
    }

    const value: ScopeConfig = {
      permission,
      ...(invalid ? { invalid: true } : {}),
    };

    this.projectGlobalConfigCache = { stamp, value };
    return value;
  }

  private loadScopeConfigFrom(
    dir: string | null,
    cache: Map<string, FileCacheEntry<ScopeConfig>>,
    agentName?: string,
  ): ScopeConfig {
    if (!dir || !agentName) {
      return {};
    }

    const filePath = join(dir, `${agentName}.md`);
    const stamp = getFileStamp(filePath);
    // Keyed by directory: several project agents dirs share this cache when
    // the ancestor chain is merged in `loadProjectAgentConfig`.
    const cacheKey = `${dir}::${agentName}`;
    const cached = cache.get(cacheKey);
    if (cached?.stamp === stamp) {
      return cached.value;
    }

    // An absent file (stat failed) is a legitimately-empty scope, not invalid;
    // only a present-but-unreadable file fails closed.
    if (stamp === "missing") {
      const value: ScopeConfig = {};
      cache.set(cacheKey, { stamp, value });
      return value;
    }

    let value: ScopeConfig;
    try {
      const markdown = readFileSync(filePath, "utf-8");
      const frontmatter = extractFrontmatter(markdown);
      if (!frontmatter) {
        value = {};
      } else {
        // Agent frontmatter carries non-config keys (name, description, model,
        // …) alongside `permission`, so it is not validated by the strict
        // config-file schema; only the `permission` block is extracted, and its
        // malformed entries are dropped tolerantly as before.
        const parsed = parseSimpleYamlMap(frontmatter);
        value = {
          permission: normalizeFlatPermissionValue(parsed.permission),
        };
      }
    } catch {
      // The file exists (stat succeeded above) but could not be read or
      // parsed — fail closed for this scope (#646).
      value = { invalid: true };
    }

    cache.set(cacheKey, { stamp, value });
    return value;
  }

  loadAgentConfig(agentName?: string): ScopeConfig {
    return this.loadScopeConfigFrom(
      this.agentsDir,
      this.agentConfigCache,
      agentName,
    );
  }

  loadProjectAgentConfig(agentName?: string): ScopeConfig {
    if (!agentName) {
      return {};
    }
    // Merge the ancestor chain top-most first so the nearest scope wins.
    // Frontmatter patterns match as written (cwd-relative, as today) — only
    // config-file scopes rebase relative paths against their own directory.
    let permission: FlatPermissionConfig | undefined;
    let invalid = false;
    for (const dir of this.projectAgentsDirs) {
      const scope = this.loadScopeConfigFrom(
        dir,
        this.projectAgentConfigCache,
        agentName,
      );
      if (scope.invalid === true) invalid = true;
      if (scope.permission) {
        permission = permission
          ? mergeFlatPermissions(permission, scope.permission)
          : { ...scope.permission };
      }
    }
    if (permission === undefined && !invalid) {
      return {};
    }
    return { permission, ...(invalid ? { invalid: true } : {}) };
  }

  // ── MCP server names ─────────────────────────────────────────────────

  getConfiguredMcpServerNames(): readonly string[] {
    if (this.configuredMcpServerNamesOverride) {
      return this.configuredMcpServerNamesOverride;
    }

    const paths = [this.globalMcpConfigPath, ...this.projectMcpConfigPaths];
    const stamp = paths
      .map((path) => `${path}:${getFileStamp(path)}`)
      .join("|");
    if (this.configuredMcpServerNamesCache?.stamp === stamp) {
      return this.configuredMcpServerNamesCache.value;
    }

    const value = getConfiguredMcpServerNamesFromPaths(paths);
    this.configuredMcpServerNamesCache = { stamp, value };
    return value;
  }

  // ── Cache stamp ───────────────────────────────────────────────────────

  getCacheStamp(agentName?: string): string {
    const agentStamp = agentName
      ? getFileStamp(join(this.agentsDir, `${agentName}.md`))
      : "missing";
    const projectStamp =
      this.projectConfigScopes.length > 0
        ? this.projectConfigScopes
            .map((scope) => getFileStamp(scope.configPath))
            .join(",")
        : "none";
    const projectAgentStamp =
      this.projectAgentsDirs.length > 0 && agentName
        ? this.projectAgentsDirs
            .map((dir) => getFileStamp(join(dir, `${agentName}.md`)))
            .join(",")
        : "none";

    return `${getFileStamp(this.globalConfigPath)}|${projectStamp}|${agentStamp}|${projectAgentStamp}`;
  }

  // ── Resolved paths ────────────────────────────────────────────────────

  getResolvedPolicyPaths(): ResolvedPolicyPaths {
    const projectConfigPaths = this.projectConfigScopes.map(
      (scope) => scope.configPath,
    );
    // The nearest scope is the one an operator edits; the chain carries the
    // ancestors it inherits from.
    const nearestProjectConfigPath =
      projectConfigPaths.length > 0
        ? projectConfigPaths[projectConfigPaths.length - 1]
        : null;
    const nearestProjectAgentsDir =
      this.projectAgentsDirs.length > 0
        ? this.projectAgentsDirs[this.projectAgentsDirs.length - 1]
        : null;
    return {
      globalConfigPath: this.globalConfigPath,
      globalConfigExists: existsSync(this.globalConfigPath),
      projectConfigPath: nearestProjectConfigPath,
      projectConfigExists: projectConfigPaths.some((path) => existsSync(path)),
      projectConfigPaths,
      agentsDir: this.agentsDir,
      agentsDirExists: existsSync(this.agentsDir),
      projectAgentsDir: nearestProjectAgentsDir,
      projectAgentsDirExists: this.projectAgentsDirs.some((dir) =>
        existsSync(dir),
      ),
      projectAgentsDirs: [...this.projectAgentsDirs],
    };
  }
}
