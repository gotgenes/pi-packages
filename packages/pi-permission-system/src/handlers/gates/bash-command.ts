import type {
  BashCommand,
  WrapperKind,
} from "#src/access-intent/bash/command-enumeration";
import type { ScopedPermissionResolver } from "#src/policy/permission-resolver";
import { pickMostRestrictive } from "#src/policy/restrictiveness";
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
 * untouched (`deny > ask > allow`). A wrapper the enumerator marked exempt is
 * decided by the command it runs instead, or by its own rule when it names no
 * command (a bare `env`).
 *
 * A trivially-empty command (an empty, whitespace-only, or comment-only line)
 * has genuinely nothing to gate, so the whole `command` is resolved as before.
 *
 * When the *primary* parse matched nothing, the whole command string is the
 * only surface an explicit `deny` can reach, so it is resolved first and a
 * `deny` covering it denies outright rather than being masked into an
 * approvable prompt (#712). With no units at all the result also fails closed
 * to a synthetic `ask`, so a permissive top-level `*` cannot silently allow an
 * unparseable command (e.g. `cd /repo && git push` riding a top-level allow on
 * the empty-parse path) — #452. A command whose units are *all* salvaged
 * (#875) takes the same whole-string check, because its primary parse matched
 * nothing either; only the synthetic `ask` is skipped, since the recovered
 * units now carry the verdict.
 *
 * A *partial* parse failure is the other half of that clause: the units the
 * recovery produced are enumerated normally, and any one the enumerator marked
 * {@link BashCommand.parseUnresolved} has its `allow` floored to a synthetic
 * `ask` naming the whole command (`<unparsed-bash-subtree>`, #840), because
 * recovered structure is not evidence of what runs.
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

/**
 * The synthetic `matchedPattern` recorded when a unit the parse could not
 * resolve has its `allow` floored to `ask` (ADR 0013 §10, #840).
 */
const UNPARSED_SUBTREE_SENTINEL = "<unparsed-bash-subtree>";

/**
 * The synthetic `matchedPattern` recorded when a command the parse matched
 * nothing in is floored to `ask` (#452).
 */
const UNPARSEABLE_COMMAND_SENTINEL = "<unparseable-bash-command>";

export function resolveBashCommandCheck(
  command: string,
  commands: BashCommand[],
  agentName: string | undefined,
  resolver: ScopedPermissionResolver,
): PermissionCheckResult {
  if (isTriviallyEmptyCommand(command)) {
    return resolveOnBashSurface(command, [], agentName, resolver);
  }

  if (!commands.some((cmd) => cmd.salvaged !== true)) {
    // The primary parse matched nothing, so the whole command string is the
    // only surface an explicit `deny` can reach (#452, #712) — a rule naming
    // the command in context (`"* rm -rf *"`) matches the string and not the
    // fragment. This runs whether or not the salvage went on to recover units
    // from the wreckage: `> f <<'M' 2>&1 | rm -rf /tmp/x` has zero primary
    // units and one salvaged one, and keying the check on the combined list
    // would silently drop a `deny` the pre-salvage gate reached (#875).
    const whole = resolveOnBashSurface(command, [], agentName, resolver);
    if (whole.state === "deny") {
      return whole;
    }
    if (commands.length === 0) {
      return {
        state: "ask",
        toolName: "bash",
        source: "bash",
        origin: "builtin",
        command,
        matchedPattern: UNPARSEABLE_COMMAND_SENTINEL,
        floor: UNPARSEABLE_COMMAND_SENTINEL,
      };
    }
  }

  const results = commands.map((cmd) =>
    resolveCommandUnit(cmd, command, agentName, resolver),
  );
  const winner =
    pickMostRestrictive(results) ??
    resolveOnBashSurface(command, [], agentName, resolver);
  return withAskingUnits(withChainFloor(winner, results), results);
}

/**
 * List on an asking winner every unit of the chain the gate left asking.
 *
 * The winner names one command, but a forwarded ask's answer approves the
 * whole tool call, so the serving node has to judge every unit the child could
 * not resolve, each with its own floor (#1030). A unit the child's rules or
 * the session allowed stays home.
 */
function withAskingUnits(
  winner: PermissionCheckResult,
  results: readonly PermissionCheckResult[],
): PermissionCheckResult {
  if (winner.state !== "ask") return winner;
  const askingUnits = results
    .filter((result) => result.state === "ask")
    .map((result) => ({
      command: result.command ?? "",
      ...(result.floor === undefined ? {} : { floor: result.floor }),
    }));
  return askingUnits.length === 0 ? winner : { ...winner, askingUnits };
}

/**
 * Carry onto an asking winner the floor another asking unit of the chain
 * raised.
 *
 * The winner is the first of the most restrictive units, so in
 * `git push x && sudo rm y` a `git push *: ask` rule wins the tie and the
 * wrapper's floor would otherwise go unrecorded. A forwarded ask is judged on
 * the winner's value alone, so the floor has to ride the result for the
 * serving node to keep it (#1029).
 */
function withChainFloor(
  winner: PermissionCheckResult,
  results: readonly PermissionCheckResult[],
): PermissionCheckResult {
  if (winner.state !== "ask" || winner.floor !== undefined) return winner;
  const floored = results.find((result) => result.floor !== undefined);
  return floored ? { ...winner, floor: floored.floor } : winner;
}

/**
 * Resolve one command unit of the chain: its own `bash`-surface rule, floored
 * where the enumerator established a reason to floor it, then tagged with the
 * facts the prompt and the session-approval suggestion read off the winner.
 */
export function resolveCommandUnit(
  cmd: BashCommand,
  command: string,
  agentName: string | undefined,
  resolver: ScopedPermissionResolver,
): PermissionCheckResult {
  const base = resolveOnBashSurface(
    cmd.text,
    cmd.spellings ?? [],
    agentName,
    resolver,
  );
  const floored =
    cmd.wrapperKind && base.state === "allow" && !isSessionGrant(base)
      ? resolveWrapperUnit(cmd, cmd.wrapperKind, base, agentName, resolver)
      : base;
  const unparsed = floorUnparsedUnit(cmd, command, floored);
  const contextual = cmd.context
    ? { ...unparsed, commandContext: cmd.context }
    : unparsed;
  return cmd.executedUnit === undefined
    ? contextual
    : { ...contextual, executedUnit: cmd.executedUnit };
}

/**
 * Floor a unit the parse could not resolve, so a subtree the fold did not
 * understand cannot ride a permissive rule (ADR 0013 §10, #840).
 *
 * Three properties carry the safety argument.
 *
 * The result names the **whole** command, not the unit: the reason for the ask
 * is that part of the command was not understood, and a partial parse can drop
 * a command from enumeration entirely, so naming the fragment that did parse
 * withholds exactly what the user needs to judge it. `command` is also the
 * session-approval pattern, and a fragment there would grant more than the
 * prompt showed.
 *
 * Only an `allow` is floored, so an explicit `deny` or `ask` on the unit
 * decides instead — and a wrapper unit already floored to `ask` keeps its own,
 * more specific sentinel.
 *
 * A session grant is never floored: the user approved this exact command, and
 * an `ask` carrying it would tie with a sibling unit's real ask and could
 * approve the whole chain through `GateRunner`'s session fast path (#1033).
 */
function floorUnparsedUnit(
  cmd: BashCommand,
  command: string,
  resolved: PermissionCheckResult,
): PermissionCheckResult {
  if (
    !cmd.parseUnresolved ||
    resolved.state !== "allow" ||
    isSessionGrant(resolved)
  ) {
    return resolved;
  }
  return { ...floorToAsk(resolved, UNPARSED_SUBTREE_SENTINEL), command };
}

/**
 * True when the session layer decided the check. `SessionRules` records only
 * `allow`s, so this is a grant the user gave for the command it matched.
 */
function isSessionGrant(check: PermissionCheckResult): boolean {
  return check.source === "session";
}

/**
 * Clamp a resolved check up to a synthetic `ask` naming the floor that raised
 * it.
 *
 * Never handed a session grant: both floors leave one unfloored. Drops
 * `matchedSpelling`: it names what the replaced rule matched, and beside the
 * sentinel it would name a match that did not decide.
 */
function floorToAsk(
  resolved: PermissionCheckResult,
  sentinel: string,
): PermissionCheckResult {
  const { matchedSpelling: _replaced, ...unspelled } = resolved;
  return {
    ...unspelled,
    state: "ask",
    matchedPattern: sentinel,
    floor: sentinel,
  };
}

/**
 * Resolve a wrapper unit whose own text resolved to `allow`.
 *
 * A wrapper hides or indirects the command that should be gated, so its `allow`
 * is clamped up to a synthetic `ask` naming the kind that caused it — unless
 * the enumerator established that the floor has no reason left to hold, in
 * which case the unit is resolved by the rules of the command it runs (ADR 0013
 * §11): its inner command is a proven pure reader (#803), or every wrapper
 * layer only modifies how that command runs (#963). A wrapper that names no
 * command and runs nothing so (`"no-command"`, a bare `env`) has no inner
 * command to resolve, so its own rule, already in `base`, decides.
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
  if (cmd.floorExemption === "no-command") {
    return { ...base, floorExemption: cmd.floorExemption };
  }
  const inner = cmd.floorExemption && cmd.executedUnit;
  if (!inner) {
    return floorToAsk(base, WRAPPER_SENTINEL[wrapperKind]);
  }
  // The inner command's rule decides, but the unit is still what runs: the
  // prompt, the decision value, and the session-approval suggestion all read
  // `command`, and naming a fragment of the command line there would offer a
  // grant that does not cover what the user is looking at.
  return {
    ...resolveOnBashSurface(inner, [], agentName, resolver),
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
 * Resolve one command string, and the other spellings the shell runs it by,
 * against the `bash` surface's rules.
 *
 * Three callers share it: each command unit of the chain, the whole command
 * when the chain yields no units, and the inner command of a wrapper the floor
 * no longer covers. Only a unit has spellings: they come from the program
 * analysis that produced it, and the whole command or a wrapper's inner text
 * has no unit of its own to carry them.
 */
function resolveOnBashSurface(
  command: string,
  spellings: readonly string[],
  agentName: string | undefined,
  resolver: ScopedPermissionResolver,
): PermissionCheckResult {
  return resolver.resolve({
    kind: "bash-command",
    surface: "bash",
    command,
    spellings,
    agentName,
  });
}
