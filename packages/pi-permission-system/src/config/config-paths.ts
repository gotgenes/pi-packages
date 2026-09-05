import { join } from "node:path";

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
