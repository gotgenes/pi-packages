import { join } from "node:path";
import { expandHomePath } from "#src/path/expand-home";
import { discoverGlobalNodeModulesRoot } from "#src/path/node-modules-discovery";
import { getGlobalLogsDir } from "./config-paths";

/**
 * Immutable path constants derived from `agentDir` at construction time.
 *
 * Computed once at startup in `computeExtensionPaths()` and handed to the
 * collaborators that read them.
 */
export interface ExtensionPaths {
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

/** The values {@link computeExtensionPaths} reads besides `agentDir`. */
interface ExtensionPathOptions {
  /**
   * Pi's own install directory (from the coding-agent `getPackageDir()` API,
   * resolved at the composition root). When provided it is auto-allowed for
   * read-only tools so the agent can read Pi's bundled docs and examples
   * regardless of install layout. It is strictly narrower than the discovered
   * global `node_modules` root already included here.
   */
  readonly piPackageDir?: string;
  /**
   * Pi's relocated session store, as the inherited
   * `PI_CODING_AGENT_SESSION_DIR` names it. When non-empty the forwarding
   * directory roots there instead of under `agentDir`, so moving the store out
   * of the agent directory takes the serving heartbeat with it.
   *
   * Only the environment value, never `--session-dir` or `settings.sessionDir`:
   * a parent and its out-of-process child rendezvous in this directory, and an
   * inherited variable is the one source both are guaranteed to share. A
   * relative value passes through unchanged, as it does for Pi's own store.
   */
  readonly sessionDir?: string;
}

/**
 * Compute all immutable path constants from `agentDir`.
 *
 * Calls `discoverGlobalNodeModulesRoot()` internally so the result is
 * self-contained. Call this once at extension startup, not at module scope.
 */
export function computeExtensionPaths(
  agentDir: string,
  { piPackageDir, sessionDir }: ExtensionPathOptions = {},
): ExtensionPaths {
  const forwardingRoot = sessionDir
    ? expandHomePath(sessionDir)
    : join(agentDir, "sessions");
  const subagentSessionsDir = join(agentDir, "subagent-sessions");
  const forwardingDir = join(forwardingRoot, "permission-forwarding");
  const globalLogsDir = getGlobalLogsDir(agentDir);

  const globalNodeModulesRoot = discoverGlobalNodeModulesRoot();
  const piInfrastructureDirs: string[] = [
    ...AGENT_DIR_INFRASTRUCTURE_ENTRIES.map((entry) => join(agentDir, entry)),
    ...(globalNodeModulesRoot ? [globalNodeModulesRoot] : []),
    ...(piPackageDir ? [piPackageDir] : []),
  ];

  return {
    subagentSessionsDir,
    forwardingDir,
    globalLogsDir,
    piInfrastructureDirs,
    piInfrastructureExcludedDirs: [globalLogsDir],
  };
}
