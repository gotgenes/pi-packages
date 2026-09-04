import type {
  BashCommand,
  WrapperKind,
} from "#src/access-intent/bash/command-enumeration";
import type { ScopedPermissionResolver } from "#src/permission-resolver";
import { pickMostRestrictive } from "#src/restrictiveness";
import type { PermissionCheckResult } from "#src/types";

/**
 * Resolve the bash command-pattern decision for a (possibly chained) command.
 *
 * A bash invocation may be a shell program with several commands joined by
 * `&&`, `||`, `;`, `|`, `&`, or newlines. Matching the whole string against the
 * bash patterns lets a denied command ride through on an allowed leading one
 * (issue #301). Instead, the caller supplies the program's command units (from
 * the shared `BashProgram.commands()` parse) — including those nested inside
 * substitutions and subshells (#306); each is evaluated on the `bash` surface
 * and the most restrictive result wins (`deny > ask > allow`).
 *
 * The selected result carries the offending sub-command in `command`, its rule
 * in `matchedPattern`, and the offending command's execution context in
 * `commandContext` (set only for a nested command), so the prompt,
 * session-approval suggestion, and decision event scope to that command.
 *
 * A wrapper unit (flagged with a `wrapperKind` by the enumerator) hides or
 * indirects the command that should be gated, so an `allow` is floored up to a
 * synthetic `ask` — the `<opaque-bash-wrapper>` pattern for an inline-shell
 * payload (`bash -c`/`eval`, #481) or `<indirection-bash-wrapper>` for a
 * prefix/exec wrapper (`sudo`/`env`/`xargs`/`find -exec`/…, #490) — to keep it
 * from riding a permissive rule; an explicit `deny`/`ask` on the wrapper is left
 * untouched (`deny > ask > allow`).
 *
 * When `commands` is empty there are two cases. A trivially-empty command (an
 * empty, whitespace-only, or comment-only line) has genuinely nothing to gate,
 * so the whole `command` is resolved as before. A non-empty command that parsed
 * to zero command units (a parse anomaly or an opaque program) fails closed to
 * a synthetic `ask` so a permissive top-level `*` cannot silently allow an
 * unparseable command (e.g. `cd /repo && git push` riding a top-level allow on
 * the empty-parse path) — #452. The whole command is still resolved first so an
 * explicit `deny` covering it denies outright rather than being masked into an
 * approvable prompt (#712).
 *
 * Pure and synchronous: the (async, tree-sitter) parse happens once in the
 * handler, which passes the decomposed `commands` here.
 */
/**
 * The synthetic `matchedPattern` recorded when a wrapper unit's `allow` is
 * floored to `ask`, keyed by the wrapper kind that caused the floor.
 */
const WRAPPER_SENTINEL: Record<WrapperKind, string> = {
  "opaque-payload": "<opaque-bash-wrapper>",
  indirection: "<indirection-bash-wrapper>",
};

export function resolveBashCommandCheck(
  command: string,
  commands: BashCommand[],
  agentName: string | undefined,
  resolver: ScopedPermissionResolver,
): PermissionCheckResult {
  if (commands.length === 0) {
    if (isTriviallyEmptyCommand(command)) {
      return resolveOnBashSurface(command, agentName, resolver);
    }
    const whole = resolveOnBashSurface(command, agentName, resolver);
    if (whole.state === "deny") {
      return whole;
    }
    return {
      state: "ask",
      toolName: "bash",
      source: "bash",
      origin: "builtin",
      command,
      matchedPattern: "<unparseable-bash-command>",
    };
  }

  const results = commands.map((cmd) =>
    resolveCommandUnit(cmd, agentName, resolver),
  );
  return (
    pickMostRestrictive(results) ??
    resolveOnBashSurface(command, agentName, resolver)
  );
}

/**
 * Resolve one command unit of the chain: its own `bash`-surface rule, floored
 * where the enumerator established a reason to floor it, then tagged with the
 * facts the prompt and the session-approval suggestion read off the winner.
 */
function resolveCommandUnit(
  cmd: BashCommand,
  agentName: string | undefined,
  resolver: ScopedPermissionResolver,
): PermissionCheckResult {
  const base = resolveOnBashSurface(cmd.text, agentName, resolver);
  const floored =
    cmd.wrapperKind && base.state === "allow"
      ? resolveWrapperUnit(cmd, cmd.wrapperKind, base, agentName, resolver)
      : base;
  const contextual = cmd.context
    ? { ...floored, commandContext: cmd.context }
    : floored;
  return cmd.executedUnit === undefined
    ? contextual
    : { ...contextual, executedUnit: cmd.executedUnit };
}

/**
 * Resolve a wrapper unit whose own text resolved to `allow`.
 *
 * A wrapper hides or indirects the command that should be gated, so its `allow`
 * is clamped up to a synthetic `ask` naming the kind that caused it — unless
 * the enumerator established that the floor has no reason left to hold, in
 * which case the unit is resolved by the rules of the command it runs (ADR 0013
 * §11, #803).
 *
 * Only an `allow` reaches here, which is what makes the exemption unable to
 * weaken anything: an explicit `deny` or `ask` on the wrapper is decided before
 * this function is consulted, and no inner rule is read at all.
 */
function resolveWrapperUnit(
  cmd: BashCommand,
  wrapperKind: WrapperKind,
  base: PermissionCheckResult,
  agentName: string | undefined,
  resolver: ScopedPermissionResolver,
): PermissionCheckResult {
  const inner = cmd.floorExemption && cmd.executedUnit;
  if (!inner) {
    return {
      ...base,
      state: "ask",
      matchedPattern: WRAPPER_SENTINEL[wrapperKind],
    };
  }
  // The inner command's rule decides, but the unit is still what runs: the
  // prompt, the decision value, and the session-approval suggestion all read
  // `command`, and naming a fragment of the command line there would offer a
  // grant that does not cover what the user is looking at.
  return {
    ...resolveOnBashSurface(inner, agentName, resolver),
    command: base.command,
    floorExemption: cmd.floorExemption,
  };
}

/**
 * True when a command has genuinely nothing to gate: it is empty,
 * whitespace-only, or contains only comment lines (every non-blank line starts
 * with `#`). Such a command yields zero command units legitimately, so the
 * whole-string resolve is safe rather than a parse anomaly.
 */
function isTriviallyEmptyCommand(command: string): boolean {
  const lines = command
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.every((line) => line.startsWith("#"));
}

/**
 * Resolve one command string against the `bash` surface's rules.
 *
 * Three callers share it: each command unit of the chain, the whole command
 * when the chain yields no units, and the inner command of a wrapper the floor
 * no longer covers.
 */
function resolveOnBashSurface(
  command: string,
  agentName: string | undefined,
  resolver: ScopedPermissionResolver,
): PermissionCheckResult {
  return resolver.resolve({
    kind: "tool",
    surface: "bash",
    input: { command },
    agentName,
  });
}
