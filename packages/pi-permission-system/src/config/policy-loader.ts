import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ScopeOrigin } from "#src/policy/rule";
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

/**
 * Where one config scope is read from, and whether that place exists. An
 * agent scope names its directory: which agent's file loads is decided per
 * check, not here.
 */
export interface ResolvedScopePath {
  readonly name: ScopeOrigin;
  /** `null` when the scope has no location (no project is configured). */
  readonly path: string | null;
  readonly exists: boolean;
}

/** Every config scope's location, lowest precedence first. */
export type ResolvedPolicyPaths = readonly ResolvedScopePath[];

// ---------------------------------------------------------------------------
// PolicyLoader interface
// ---------------------------------------------------------------------------

/** One config scope's contribution to an agent's policy. */
export interface PolicyScope {
  readonly origin: ScopeOrigin;
  readonly config: ScopeConfig;
  /**
   * Whether an invalid file at this scope floors the composed policy
   * `allow`→`ask` (#646). False for a scope nothing is inherited beneath.
   */
  readonly floorsWhenInvalid: boolean;
}

/**
 * Abstraction over file I/O for loading permission policy from disk.
 * Implementations handle caching, path resolution, and marking a rejected
 * scope `invalid`.  `PermissionManager` depends on this interface so that
 * merge + evaluation logic can be tested with an in-memory stub.
 */
export interface PolicyLoader {
  /** The config scopes for `agentName`, lowest precedence first. */
  loadScopes(agentName?: string): readonly PolicyScope[];
  getConfiguredMcpServerNames(): readonly string[];
  /** Combined mtime stamp for cache invalidation. */
  getCacheStamp(agentName?: string): string;
  /** Where each scope is read from, for the `config.resolved` log entry. */
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
  /** Every scope source, lowest precedence first. */
  private readonly scopeSources: readonly ScopeSource[];
  private readonly globalMcpConfigPath: string;
  private readonly projectMcpConfigPath: string | null;
  private readonly configuredMcpServerNamesOverride: readonly string[] | null;

  private configuredMcpServerNamesCache: FileCacheEntry<
    readonly string[]
  > | null = null;

  constructor(options: PolicyLoaderOptions = {}) {
    // Global is the lowest precedence, so nothing more permissive is
    // inherited beneath it: an invalid global file does not floor.
    this.scopeSources = [
      new ConfigFileScopeSource(
        "global",
        options.globalConfigPath ?? defaultGlobalConfigPath(),
        false,
      ),
      new ConfigFileScopeSource(
        "project",
        options.projectGlobalConfigPath ?? null,
        true,
      ),
      new AgentFileScopeSource(
        "agent",
        options.agentsDir ?? defaultAgentsDir(),
        true,
      ),
      new AgentFileScopeSource(
        "project-agent",
        options.projectAgentsDir ?? null,
        true,
      ),
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

  // ── Scopes ───────────────────────────────────────────────────────────

  loadScopes(agentName?: string): readonly PolicyScope[] {
    return this.scopeSources.map((source) => source.scope(agentName));
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
    return this.scopeSources.map((source) => source.resolvedPath());
  }
}

// ---------------------------------------------------------------------------
// Scope sources
// ---------------------------------------------------------------------------

/** One config scope's file, read with mtime caching. */
interface ScopeSource {
  scope(agentName?: string): PolicyScope;
  /** The file's mtime stamp, for the loader's combined cache stamp. */
  stamp(agentName?: string): string;
  resolvedPath(): ResolvedScopePath;
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

  constructor(
    private readonly origin: ScopeOrigin,
    private readonly path: string | null,
    private readonly floorsWhenInvalid: boolean,
  ) {}

  scope(): PolicyScope {
    return {
      origin: this.origin,
      config: this.load(),
      floorsWhenInvalid: this.floorsWhenInvalid,
    };
  }

  private load(): ScopeConfig {
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

  resolvedPath(): ResolvedScopePath {
    return {
      name: this.origin,
      path: this.path,
      exists: this.path ? existsSync(this.path) : false,
    };
  }
}

/**
 * A scope held in the `permission:` block of an agent definition's
 * frontmatter, one file per agent name under a directory.
 */
class AgentFileScopeSource implements ScopeSource {
  private readonly cache = new Map<string, FileCacheEntry<ScopeConfig>>();

  constructor(
    private readonly origin: ScopeOrigin,
    private readonly dir: string | null,
    private readonly floorsWhenInvalid: boolean,
  ) {}

  scope(agentName?: string): PolicyScope {
    return {
      origin: this.origin,
      config: this.load(agentName),
      floorsWhenInvalid: this.floorsWhenInvalid,
    };
  }

  private load(agentName?: string): ScopeConfig {
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

  resolvedPath(): ResolvedScopePath {
    return {
      name: this.origin,
      path: this.dir,
      exists: this.dir ? existsSync(this.dir) : false,
    };
  }
}
