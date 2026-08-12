import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  loadUnifiedConfig,
  mergeUnifiedConfigs,
  normalizeFlatPermissionValue,
  stripJsonComments,
} from "./config-loader";
import { getGlobalConfigPath } from "./config-paths";
import type { ScopeConfig } from "./types";
import { toRecord } from "./value-guards";
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
  projectLocalConfigPath: string | null;
  projectLocalConfigExists: boolean;
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
 * Implementations handle caching, path resolution, and config-issue
 * accumulation.  `PermissionManager` depends on this interface so that
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
  /** Accumulated config-parse issues across all loads. */
  getConfigIssues(): string[];
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

export interface PolicyLoaderOptions {
  globalConfigPath?: string;
  agentsDir?: string;
  projectGlobalConfigPath?: string;
  projectLocalConfigPath?: string;
  projectAgentsDir?: string;
  globalMcpConfigPath?: string;
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
  private readonly projectLocalConfigPath: string | null;
  private readonly projectAgentsDir: string | null;
  private readonly globalMcpConfigPath: string;
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
  private accumulatedConfigIssues: string[] = [];

  constructor(options: PolicyLoaderOptions = {}) {
    this.globalConfigPath =
      options.globalConfigPath ?? defaultGlobalConfigPath();
    this.agentsDir = options.agentsDir ?? defaultAgentsDir();
    this.projectGlobalConfigPath = options.projectGlobalConfigPath ?? null;
    this.projectLocalConfigPath = options.projectLocalConfigPath ?? null;
    this.projectAgentsDir = options.projectAgentsDir ?? null;
    this.globalMcpConfigPath =
      options.globalMcpConfigPath ?? defaultGlobalMcpConfigPath();
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

  // ── Config issue accumulation ────────────────────────────────────────

  private accumulateConfigIssues(issues: string[]): void {
    for (const issue of issues) {
      if (!this.accumulatedConfigIssues.includes(issue)) {
        this.accumulatedConfigIssues.push(issue);
      }
    }
  }

  getConfigIssues(): string[] {
    return [...this.accumulatedConfigIssues];
  }

  // ── Scope loaders ────────────────────────────────────────────────────

  loadGlobalConfig(): ScopeConfig {
    const stamp = getFileStamp(this.globalConfigPath);
    if (this.globalConfigCache?.stamp === stamp) {
      return this.globalConfigCache.value;
    }

    const { config, issues } = loadUnifiedConfig(this.globalConfigPath);
    this.accumulateConfigIssues(issues);

    const value: ScopeConfig = {
      permission: config.permission,
    };

    this.globalConfigCache = { stamp, value };
    return value;
  }

  loadProjectConfig(): ScopeConfig {
    if (!this.projectGlobalConfigPath && !this.projectLocalConfigPath) {
      return {};
    }

    const stamp = [
      this.projectGlobalConfigPath
        ? getFileStamp(this.projectGlobalConfigPath)
        : "none",
      this.projectLocalConfigPath
        ? getFileStamp(this.projectLocalConfigPath)
        : "none",
    ].join("|");
    if (this.projectGlobalConfigCache?.stamp === stamp) {
      return this.projectGlobalConfigCache.value;
    }

    const shared = this.projectGlobalConfigPath
      ? loadUnifiedConfig(this.projectGlobalConfigPath)
      : { config: {}, issues: [] };
    const local = this.projectLocalConfigPath
      ? loadUnifiedConfig(this.projectLocalConfigPath)
      : { config: {}, issues: [] };
    const issues = [...shared.issues, ...local.issues];
    this.accumulateConfigIssues(issues);
    const config = mergeUnifiedConfigs(shared.config, local.config);

    // A present-but-rejected file yields issues (parse error or schema
    // rejection); an absent file yields none. Fail closed on the former.
    const value: ScopeConfig = {
      permission: config.permission,
      ...(issues.length > 0 ? { invalid: true } : {}),
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
    const cached = cache.get(agentName);
    if (cached?.stamp === stamp) {
      return cached.value;
    }

    // An absent file (stat failed) is a legitimately-empty scope, not invalid;
    // only a present-but-unreadable file fails closed.
    if (stamp === "missing") {
      const value: ScopeConfig = {};
      cache.set(agentName, { stamp, value });
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

    cache.set(agentName, { stamp, value });
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
    return this.loadScopeConfigFrom(
      this.projectAgentsDir,
      this.projectAgentConfigCache,
      agentName,
    );
  }

  // ── MCP server names ─────────────────────────────────────────────────

  getConfiguredMcpServerNames(): readonly string[] {
    if (this.configuredMcpServerNamesOverride) {
      return this.configuredMcpServerNamesOverride;
    }

    const paths = [this.globalMcpConfigPath];
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
    const projectStamp = this.projectGlobalConfigPath
      ? getFileStamp(this.projectGlobalConfigPath)
      : "none";
    const projectLocalStamp = this.projectLocalConfigPath
      ? getFileStamp(this.projectLocalConfigPath)
      : "none";
    const projectAgentStamp =
      this.projectAgentsDir && agentName
        ? getFileStamp(join(this.projectAgentsDir, `${agentName}.md`))
        : "none";

    return `${getFileStamp(this.globalConfigPath)}|${projectStamp}|${projectLocalStamp}|${agentStamp}|${projectAgentStamp}`;
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
      projectLocalConfigPath: this.projectLocalConfigPath,
      projectLocalConfigExists: this.projectLocalConfigPath
        ? existsSync(this.projectLocalConfigPath)
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
