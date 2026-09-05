import { parseBashCommandsSync } from "#src/access-intent/bash/sync-commands";
import { resolveBashCommandCheck } from "#src/handlers/gates/bash-command";
import type { ScopedPermissionResolver } from "#src/policy/permission-resolver";
import type { PermissionCheckResult } from "#src/types";

/**
 * Resolve an advisory bash query at the gate's decomposed fidelity.
 *
 * When the tree-sitter parser is warm, the command is decomposed into its
 * command-pattern units and routed through the same shared orchestrator the
 * enforcement gate uses (`resolveBashCommandCheck`) — so a chained/nested
 * command returns the most-restrictive decision (`deny > ask > allow`) and
 * inherits the opaque-wrapper floor (#481) and both fail-closed parse
 * sentinels — `<unparseable-bash-command>` (#452) and `<unparsed-bash-subtree>`
 * (#840) — at parity with the gate.
 *
 * In the pre-warm window (`parseBashCommandsSync` returns `null`) it falls back
 * to the pre-#309 whole-string match, so the advisory answer is never *weaker*
 * than before — only strengthened once warm.
 *
 * Synchronous, preserving `PermissionsService.checkPermission`'s sync contract:
 * the only async step (parser init) happens earlier, at `before_agent_start`.
 */
export function resolveBashAdvisoryCheck(
  command: string,
  agentName: string | undefined,
  resolver: ScopedPermissionResolver,
): PermissionCheckResult {
  const commands = parseBashCommandsSync(command);
  if (commands === null) {
    return resolver.resolve({
      kind: "tool",
      surface: "bash",
      input: { command },
      agentName,
    });
  }
  return resolveBashCommandCheck(command, commands, agentName, resolver);
}
