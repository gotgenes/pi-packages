import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ScopeConfig } from "#src/types";
import { toRecord } from "#src/value-guards";
import {
  loadUnifiedConfig,
  normalizeFlatPermissionValue,
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
  agentsDir: string;
  agentsDirExists: boolean;
  projectAgentsDir: string | null;
  projectAgentsDirExists: boolean;
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
// FilePolicyLoader options
// ---------------------------------------------------------------------------

export interface PolicyLoaderOptions {
  globalConfigPath?: string;
  agentsDir?: string;
  projectGlobalConfigPath?: string;
  projectAgentsDir?: string;
  globalMcpConfigPath?: string;
  /**
   * The project's `.pi/mcp.json`, read beside the global file the way Pi's
   * built-in MCP reads it. Set only for a trusted project: the manager derives
   * it from a cwd, and an untrusted project's cwd is withheld.
   */
  projectMcpConfigPath?: string;
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
  private readonly projectGlobalConfigPath: string | null;
  private readonly projectAgentsDir: string | null;
  private readonly globalScope: ConfigFileScopeSource;
  private readonly projectScope: ConfigFileScopeSource;
  private readonly agentScope: AgentFileScopeSource;
  private readonly projectAgentScope: AgentFileScopeSource;
  /** Every scope source, lowest precedence first. */
  private readonly scopeSources: readonly ScopeSource[];
  private readonly globalMcpConfigPath: string;
  private readonly projectMcpConfigPath: string | null;
  private readonly configuredMcpServerNamesOverride: readonly string[] | null;

  private configuredMcpServerNamesCache: FileCacheEntry<
    readonly string[]
  > | null = null;

  constructor(options: PolicyLoaderOptions = {}) {
    this.globalConfigPath =
      options.globalConfigPath ?? defaultGlobalConfigPath();
    this.agentsDir = options.agentsDir ?? defaultAgentsDir();
    this.projectGlobalConfigPath = options.projectGlobalConfigPath ?? null;
    this.projectAgentsDir = options.projectAgentsDir ?? null;
    this.globalScope = new ConfigFileScopeSource(this.globalConfigPath);
    this.projectScope = new ConfigFileScopeSource(this.projectGlobalConfigPath);
    this.agentScope = new AgentFileScopeSource(this.agentsDir);
    this.projectAgentScope = new AgentFileScopeSource(this.projectAgentsDir);
    this.scopeSources = [
      this.globalScope,
      this.projectScope,
      this.agentScope,
      this.projectAgentScope,
    ];
    this.globalMcpConfigPath =
      options.globalMcpConfigPath ?? defaultGlobalMcpConfigPath();
    this.projectMcpConfigPath = options.projectMcpConfigPath ?? null;
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

  loadGlobalConfig(): ScopeConfig {
    return this.globalScope.load();
  }

  loadProjectConfig(): ScopeConfig {
    return this.projectScope.load();
  }

  loadAgentConfig(agentName?: string): ScopeConfig {
    return this.agentScope.load(agentName);
  }

  loadProjectAgentConfig(agentName?: string): ScopeConfig {
    return this.projectAgentScope.load(agentName);
  }

  // ── MCP server names ─────────────────────────────────────────────────

  getConfiguredMcpServerNames(): readonly string[] {
    if (this.configuredMcpServerNamesOverride) {
      return this.configuredMcpServerNamesOverride;
    }

    const paths = this.projectMcpConfigPath
      ? [this.globalMcpConfigPath, this.projectMcpConfigPath]
      : [this.globalMcpConfigPath];
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
    return this.scopeSources.map((source) => source.stamp(agentName)).join("|");
  }

  // ── Resolved paths ────────────────────────────────────────────────────

  getResolvedPolicyPaths(): ResolvedPolicyPaths {
    return {
      globalConfigPath: this.globalConfigPath,
      globalConfigExists: existsSync(this.globalConfigPath),
      projectConfigPath: this.projectGlobalConfigPath,
      projectConfigExists: this.projectGlobalConfigPath
        ? existsSync(this.projectGlobalConfigPath)
        : false,
      agentsDir: this.agentsDir,
      agentsDirExists: existsSync(this.agentsDir),
      projectAgentsDir: this.projectAgentsDir,
      projectAgentsDirExists: this.projectAgentsDir
        ? existsSync(this.projectAgentsDir)
        : false,
    };
  }
}

// ---------------------------------------------------------------------------
// Scope sources
// ---------------------------------------------------------------------------

/** One config scope's file, read with mtime caching. */
interface ScopeSource {
  load(agentName?: string): ScopeConfig;
  /** The file's mtime stamp, for the loader's combined cache stamp. */
  stamp(agentName?: string): string;
}

/**
 * A scope held in one config file, validated strictly. A file that is present
 * but rejected (parse error or schema rejection) marks the scope `invalid`; an
 * absent file, or no path at all, is a plain empty scope.
 *
 * A config file's schema errors are not kept here: `ConfigStore` loads the
 * same files through the same `loadUnifiedConfig` and reports them, so this
 * source reads them only to decide whether the scope is invalid (#953).
 */
class ConfigFileScopeSource implements ScopeSource {
  private cache: FileCacheEntry<ScopeConfig> | null = null;

  constructor(private readonly path: string | null) {}

  load(): ScopeConfig {
    if (!this.path) {
      return {};
    }

    const stamp = getFileStamp(this.path);
    if (this.cache?.stamp === stamp) {
      return this.cache.value;
    }

    const { config, issues } = loadUnifiedConfig(this.path);
    const value: ScopeConfig = {
      permission: config.permission,
      ...(issues.length > 0 ? { invalid: true } : {}),
    };

    this.cache = { stamp, value };
    return value;
  }

  stamp(): string {
    return this.path ? getFileStamp(this.path) : "none";
  }
}

/**
 * A scope held in the `permission:` block of an agent definition's
 * frontmatter, one file per agent name under a directory.
 */
class AgentFileScopeSource implements ScopeSource {
  private readonly cache = new Map<string, FileCacheEntry<ScopeConfig>>();

  constructor(private readonly dir: string | null) {}

  load(agentName?: string): ScopeConfig {
    if (!this.dir || !agentName) {
      return {};
    }

    const filePath = join(this.dir, `${agentName}.md`);
    const stamp = getFileStamp(filePath);
    const cached = this.cache.get(agentName);
    if (cached?.stamp === stamp) {
      return cached.value;
    }

    // An absent file (stat failed) is a legitimately-empty scope, not invalid;
    // only a present-but-unreadable file fails closed.
    if (stamp === "missing") {
      const value: ScopeConfig = {};
      this.cache.set(agentName, { stamp, value });
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

    this.cache.set(agentName, { stamp, value });
    return value;
  }

  stamp(agentName?: string): string {
    return this.dir && agentName
      ? getFileStamp(join(this.dir, `${agentName}.md`))
      : "none";
  }
}
