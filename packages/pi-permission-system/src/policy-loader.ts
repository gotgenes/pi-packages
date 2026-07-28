import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  loadUnifiedConfig,
  normalizeFlatPermissionValue,
  stripJsonComments,
} from "./config-loader";
import { getGlobalConfigPath } from "./config-paths";
import { mergeFlatPermissions } from "./permission-merge";
import {
  loadSettingsPolicy,
  type SettingsPolicyLoadResult,
} from "./settings-policy";
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

function loadOptionalUnifiedConfig(path: string | null) {
  return path ? loadUnifiedConfig(path) : { config: {}, issues: [] };
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
  globalSettingsPath?: string | null;
  globalSettingsExists?: boolean;
  projectConfigPath: string | null;
  projectConfigExists: boolean;
  projectSettingsPath?: string | null;
  projectSettingsExists?: boolean;
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

function mergeScopeConfigs(
  base: ScopeConfig,
  override: ScopeConfig,
): ScopeConfig {
  const permission =
    base.permission && override.permission
      ? mergeFlatPermissions(base.permission, override.permission)
      : (override.permission ?? base.permission);
  return {
    ...(permission ? { permission } : {}),
    ...(base.invalid === true || override.invalid === true
      ? { invalid: true }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Options shared between FilePolicyLoader and the backward-compat
// PermissionManager constructor.
// ---------------------------------------------------------------------------

export interface PolicyLoaderOptions {
  globalConfigPath?: string;
  globalSettingsPath?: string;
  agentsDir?: string;
  projectGlobalConfigPath?: string;
  projectSettingsPath?: string;
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
  private readonly globalSettingsPath: string | null;
  private readonly agentsDir: string;
  private readonly projectGlobalConfigPath: string | null;
  private readonly projectSettingsPath: string | null;
  private readonly projectAgentsDir: string | null;
  private readonly globalMcpConfigPath: string;
  private readonly configuredMcpServerNamesOverride: readonly string[] | null;

  private globalConfigCache: FileCacheEntry<ScopeConfig> | null = null;
  private projectGlobalConfigCache: FileCacheEntry<ScopeConfig> | null = null;
  private globalSettingsCache: FileCacheEntry<SettingsPolicyLoadResult> | null =
    null;
  private projectSettingsCache: FileCacheEntry<SettingsPolicyLoadResult> | null =
    null;
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
    this.globalSettingsPath = options.globalSettingsPath ?? null;
    this.agentsDir = options.agentsDir ?? defaultAgentsDir();
    this.projectGlobalConfigPath = options.projectGlobalConfigPath ?? null;
    this.projectSettingsPath = options.projectSettingsPath ?? null;
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

  private loadGlobalSettings(): SettingsPolicyLoadResult {
    if (!this.globalSettingsPath) return { issues: [] };
    const stamp = getFileStamp(this.globalSettingsPath);
    if (this.globalSettingsCache?.stamp === stamp) {
      return this.globalSettingsCache.value;
    }
    const value = loadSettingsPolicy(this.globalSettingsPath);
    this.accumulateConfigIssues(value.issues);
    this.globalSettingsCache = { stamp, value };
    return value;
  }

  private loadProjectSettings(): SettingsPolicyLoadResult {
    if (!this.projectSettingsPath) return { issues: [] };
    const stamp = getFileStamp(this.projectSettingsPath);
    if (this.projectSettingsCache?.stamp === stamp) {
      return this.projectSettingsCache.value;
    }
    const value = loadSettingsPolicy(this.projectSettingsPath);
    this.accumulateConfigIssues(value.issues);
    this.projectSettingsCache = { stamp, value };
    return value;
  }

  // ── Scope loaders ────────────────────────────────────────────────────

  loadGlobalConfig(): ScopeConfig {
    const settingsStamp = this.globalSettingsPath
      ? getFileStamp(this.globalSettingsPath)
      : "none";
    const stamp = `${settingsStamp}|${getFileStamp(this.globalConfigPath)}`;
    if (this.globalConfigCache?.stamp === stamp) {
      return this.globalConfigCache.value;
    }

    const settings = this.loadGlobalSettings();
    const { config, issues } = loadUnifiedConfig(this.globalConfigPath);
    this.accumulateConfigIssues(issues);

    const value = mergeScopeConfigs(
      {
        permission: settings.permission,
        ...(settings.issues.length > 0 ? { invalid: true } : {}),
      },
      { permission: config.permission },
    );

    this.globalConfigCache = { stamp, value };
    return value;
  }

  loadProjectConfig(): ScopeConfig {
    if (!this.projectGlobalConfigPath && !this.projectSettingsPath) {
      return {};
    }

    const settingsStamp = this.projectSettingsPath
      ? getFileStamp(this.projectSettingsPath)
      : "none";
    const configStamp = this.projectGlobalConfigPath
      ? getFileStamp(this.projectGlobalConfigPath)
      : "none";
    const stamp = `${settingsStamp}|${configStamp}`;
    if (this.projectGlobalConfigCache?.stamp === stamp) {
      return this.projectGlobalConfigCache.value;
    }

    const settings = this.loadProjectSettings();
    const configResult = loadOptionalUnifiedConfig(
      this.projectGlobalConfigPath,
    );
    this.accumulateConfigIssues(configResult.issues);

    // A present-but-rejected source yields issues; an absent source yields none.
    // The dedicated config file overrides the settings-backed policy.
    const value = mergeScopeConfigs(
      {
        permission: settings.permission,
        ...(settings.issues.length > 0 ? { invalid: true } : {}),
      },
      {
        permission: configResult.config.permission,
        ...(configResult.issues.length > 0 ? { invalid: true } : {}),
      },
    );

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
    const settings = this.loadGlobalSettings();
    return mergeScopeConfigs(
      {
        permission: agentName ? settings.agents?.[agentName] : undefined,
        ...(agentName && settings.issues.length > 0 ? { invalid: true } : {}),
      },
      this.loadScopeConfigFrom(
        this.agentsDir,
        this.agentConfigCache,
        agentName,
      ),
    );
  }

  loadProjectAgentConfig(agentName?: string): ScopeConfig {
    const settings = this.loadProjectSettings();
    return mergeScopeConfigs(
      {
        permission: agentName ? settings.agents?.[agentName] : undefined,
        ...(agentName && settings.issues.length > 0 ? { invalid: true } : {}),
      },
      this.loadScopeConfigFrom(
        this.projectAgentsDir,
        this.projectAgentConfigCache,
        agentName,
      ),
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
    const globalSettingsStamp = this.globalSettingsPath
      ? getFileStamp(this.globalSettingsPath)
      : "none";
    const projectStamp = this.projectGlobalConfigPath
      ? getFileStamp(this.projectGlobalConfigPath)
      : "none";
    const projectSettingsStamp = this.projectSettingsPath
      ? getFileStamp(this.projectSettingsPath)
      : "none";
    const projectAgentStamp =
      this.projectAgentsDir && agentName
        ? getFileStamp(join(this.projectAgentsDir, `${agentName}.md`))
        : "none";

    return `${getFileStamp(this.globalConfigPath)}|${globalSettingsStamp}|${projectStamp}|${projectSettingsStamp}|${agentStamp}|${projectAgentStamp}`;
  }

  // ── Resolved paths ────────────────────────────────────────────────────

  getResolvedPolicyPaths(): ResolvedPolicyPaths {
    return {
      globalConfigPath: this.globalConfigPath,
      globalConfigExists: existsSync(this.globalConfigPath),
      globalSettingsPath: this.globalSettingsPath,
      globalSettingsExists: this.globalSettingsPath
        ? existsSync(this.globalSettingsPath)
        : false,
      projectConfigPath: this.projectGlobalConfigPath,
      projectConfigExists: this.projectGlobalConfigPath
        ? existsSync(this.projectGlobalConfigPath)
        : false,
      projectSettingsPath: this.projectSettingsPath,
      projectSettingsExists: this.projectSettingsPath
        ? existsSync(this.projectSettingsPath)
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
