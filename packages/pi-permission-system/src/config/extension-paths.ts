import { join } from "node:path";
import { expandHomePath } from "#src/path/expand-home";
import { discoverGlobalNodeModulesRoot } from "#src/path/node-modules-discovery";
import { getGlobalLogsDir } from "./config-paths";

/**
 * Immutable path constants derived from `agentDir` at construction time.
 *
 * Computed once at startup in `computeExtensionPaths()` and embedded into
 * `ExtensionRuntime`. Later refactorings (#129 PermissionSession, #130
 * handler classes) consume this as a single dep instead of individual fields.
 */
export interface ExtensionPaths {
  readonly agentDir: string;
  readonly sessionsDir: string;
  readonly subagentSessionsDir: string;
  readonly forwardingDir: string;
  readonly globalLogsDir: string;
  /**
   * Static Pi infrastructure roots used for external-directory read
   * auto-allow; an entry may be a directory or a single file. Computed once
   * from `agentDir` (only Pi's harness entries, never `agentDir` itself),
   * `discoverGlobalNodeModulesRoot()`, and (when provided) Pi's own
   * install directory (`getPackageDir()`). Config-based extras
   * (`piInfrastructureReadPaths`) are read from `runtime.config` at
   * call time in the handler so they pick up config reloads.
   */
  readonly piInfrastructureDirs: readonly string[];
  /**
   * Directories never auto-allowed as infrastructure reads, even inside one of
   * `piInfrastructureDirs` or a configured `piInfrastructureReadPaths` entry:
   * this package's own logs directory, whose entries hold tool input.
   */
  readonly piInfrastructureExcludedDirs: readonly string[];
}

/**
 * The entries under `agentDir` that Pi's harness reads: its resource roots
 * (`skills`, `prompts`, `themes`, `extensions`, the system-prompt files, the
 * global `AGENTS.md`), its package install roots (`npm`, `git`), settings, and
 * subagent definitions. Everything else there (`auth.json`, `sessions/`,
 * `mcp-oauth/`, and the like) stays behind the `external_directory` gate.
 */
const AGENT_DIR_INFRASTRUCTURE_ENTRIES = [
  "agents",
  "extensions",
  "git",
  "npm",
  "prompts",
  "skills",
  "themes",
  "settings.json",
  "SYSTEM.md",
  "APPEND_SYSTEM.md",
  "AGENTS.md",
] as const;

/**
 * Compute all immutable path constants from `agentDir`.
 *
 * Calls `discoverGlobalNodeModulesRoot()` internally so the result is
 * self-contained. Call this once at extension startup, not at module scope.
 *
 * `piPackageDir` is Pi's own install directory (from the coding-agent
 * `getPackageDir()` API, resolved at the composition root). When provided it is
 * auto-allowed for read-only tools so the agent can read Pi's bundled docs and
 * examples regardless of install layout. It is strictly narrower than the
 * discovered global `node_modules` root already included here.
 *
 * `sessionDir` is the operator's relocated session store (Pi's
 * `PI_CODING_AGENT_SESSION_DIR`, read at the composition root). When set, the
 * forwarding directory follows it, so a store moved out of `agentDir` (to keep
 * the config directory free of runtime state) does not leave the per-second
 * heartbeat behind. It must be the inherited environment value rather than a
 * per-invocation `--session-dir`: parent and child processes rendezvous here,
 * and only the environment is guaranteed to agree between them.
 */
export function computeExtensionPaths(
  agentDir: string,
  piPackageDir?: string,
  sessionDir?: string,
): ExtensionPaths {
  const sessionsDir = sessionDir
    ? expandHomePath(sessionDir)
    : join(agentDir, "sessions");
  const subagentSessionsDir = join(agentDir, "subagent-sessions");
  const forwardingDir = join(sessionsDir, "permission-forwarding");
  const globalLogsDir = getGlobalLogsDir(agentDir);

  const globalNodeModulesRoot = discoverGlobalNodeModulesRoot();
  const piInfrastructureDirs: string[] = [
    ...AGENT_DIR_INFRASTRUCTURE_ENTRIES.map((entry) => join(agentDir, entry)),
    ...(globalNodeModulesRoot ? [globalNodeModulesRoot] : []),
    ...(piPackageDir ? [piPackageDir] : []),
  ];

  return {
    agentDir,
    sessionsDir,
    subagentSessionsDir,
    forwardingDir,
    globalLogsDir,
    piInfrastructureDirs,
    piInfrastructureExcludedDirs: [globalLogsDir],
  };
}
