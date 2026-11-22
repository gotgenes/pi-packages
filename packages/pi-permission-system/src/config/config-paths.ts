import { dirname, join, resolve } from "node:path";

const EXTENSION_ID = "pi-permission-system";

export const DEBUG_LOG_FILENAME = `${EXTENSION_ID}-debug.jsonl`;
export const REVIEW_LOG_FILENAME = `${EXTENSION_ID}-permission-review.jsonl`;

export function getGlobalConfigDir(agentDir: string): string {
  return join(agentDir, "extensions", EXTENSION_ID);
}

export function getGlobalConfigPath(agentDir: string): string {
  return join(getGlobalConfigDir(agentDir), "config.json");
}

export function getGlobalLogsDir(agentDir: string): string {
  return join(getGlobalConfigDir(agentDir), "logs");
}

export function getProjectConfigPath(cwd: string): string {
  return join(cwd, ".pi", "extensions", EXTENSION_ID, "config.json");
}

export function getProjectMcpPath(cwd: string): string {
  return join(cwd, ".pi", "mcp.json");
}

/**
 * One directory in the project-scope ancestor chain: the directory itself
 * plus every project-scoped path Pi reads inside it.
 */
export interface AncestorProjectScope {
  /** The ancestor directory (or `cwd` itself for the nearest entry). */
  dir: string;
  /** `<dir>/.pi/extensions/pi-permission-system/config.json` */
  configPath: string;
  /** `<dir>/.pi/agents` */
  agentsDir: string;
  /** `<dir>/.pi/mcp.json` */
  mcpPath: string;
  /** `<dir>/.pi/agent/pi-permissions.jsonc` (legacy project policy) */
  legacyPolicyPath: string;
}

/**
 * Directory chain from the filesystem root down to `cwd`, inclusive.
 * Purely lexical (`resolve` + `dirname`); no filesystem access, so a
 * missing intermediate directory still yields its entry.
 */
export function getAncestorDirs(cwd: string): string[] {
  const start = resolve(cwd);
  const chain: string[] = [];
  let dir = start;
  for (;;) {
    chain.unshift(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return chain;
}

/**
 * Project scopes for `cwd` and every parent directory, top-most first so a
 * fold in order gives the nearest directory the final say.
 *
 * Returns `[]` when `cwd` is empty (no session cwd is known yet).
 */
export function getAncestorProjectScopes(cwd: string): AncestorProjectScope[] {
  if (!cwd) return [];
  return getAncestorDirs(cwd).map((dir) => ({
    dir,
    configPath: getProjectConfigPath(dir),
    agentsDir: getProjectAgentsDir(dir),
    mcpPath: getProjectMcpPath(dir),
    legacyPolicyPath: getLegacyProjectPolicyPath(dir),
  }));
}

/**
 * Directory holding project-scoped custom agent definition files.
 *
 * `<cwd>/.pi/agents` is a Pi platform convention, also encoded by
 * `@gotgenes/pi-subagents`' `loadCustomAgents` (`config/custom-agents.ts`).
 * The two packages encode it independently — pi-permission-system has no
 * dependency on pi-subagents (ADR-0002) — so this is this package's
 * authoritative copy.
 */
export function getProjectAgentsDir(cwd: string): string {
  return join(cwd, ".pi", "agents");
}

export function getLegacyGlobalPolicyPath(agentDir: string): string {
  return join(agentDir, "pi-permissions.jsonc");
}

export function getLegacyProjectPolicyPath(cwd: string): string {
  return join(cwd, ".pi", "agent", "pi-permissions.jsonc");
}

export function getLegacyExtensionConfigPath(extensionRoot: string): string {
  return join(extensionRoot, "config.json");
}
