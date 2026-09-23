import type {
  BashCommand,
  WrapperKind,
} from "#src/access-intent/bash/command-enumeration";
import { basename } from "#src/access-intent/bash/wrapper-analysis";
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
 * untouched (`deny > ask > allow`).
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

export function resolveBashCommandCheck(
  command: string,
  commands: BashCommand[],
  agentName: string | undefined,
  resolver: ScopedPermissionResolver,
): PermissionCheckResult {
  if (isTriviallyEmptyCommand(command)) {
    return resolveOnBashSurface(command, agentName, resolver);
  }

  if (!commands.some((cmd) => cmd.salvaged !== true)) {
    // The primary parse matched nothing, so the whole command string is the
    // only surface an explicit `deny` can reach (#452, #712) — a rule naming
    // the command in context (`"* rm -rf *"`) matches the string and not the
    // fragment. This runs whether or not the salvage went on to recover units
    // from the wreckage: `> f <<'M' 2>&1 | rm -rf /tmp/x` has zero primary
    // units and one salvaged one, and keying the check on the combined list
    // would silently drop a `deny` the pre-salvage gate reached (#875).
    const whole = resolveOnBashSurface(command, agentName, resolver);
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
        matchedPattern: "<unparseable-bash-command>",
      };
    }
  }

  const results = commands.map((cmd) =>
    resolveCommandUnit(cmd, command, agentName, resolver),
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
  command: string,
  agentName: string | undefined,
  resolver: ScopedPermissionResolver,
): PermissionCheckResult {
  const base = resolveOnBashSurface(cmd.text, agentName, resolver);
  const floored =
    cmd.wrapperKind && base.state === "allow"
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
 * The result is built by spreading `resolved`, so a `source: "session"` grant
 * survives to `GateRunner`'s session fast path, which tests the source before
 * the state. A grant the user gave for this exact command still holds.
 */
function floorUnparsedUnit(
  cmd: BashCommand,
  command: string,
  resolved: PermissionCheckResult,
): PermissionCheckResult {
  if (!cmd.parseUnresolved || resolved.state !== "allow") return resolved;
  return {
    ...resolved,
    state: "ask",
    command,
    matchedPattern: UNPARSED_SUBTREE_SENTINEL,
  };
}

/**
 * Resolve a wrapper unit whose own text resolved to `allow`.
 *
 * A wrapper hides or indirects the command that should be gated, so its `allow`
 * is clamped up to a synthetic `ask` naming the kind that caused it — unless
 * the floor has no reason left to hold, which one of two things can establish:
 * a transparency proof by the enumerator (ADR 0013 §11, #803), or a matched
 * rule whose own text pins the command this wrapper applies (#490).
 *
 * Only an `allow` reaches here, which is what makes either exemption unable to
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
    const pinned = pinnedPattern(cmd, base);
    // #490 escape valve: the matched `allow` names the command this wrapper
    // applies, so the grant is no broader than the inner command's own rule and
    // the floor has nothing left to withhold. The unit is still what runs, so
    // the result keeps the wrapper's `command` and `matchedPattern` — and
    // publishes the pinning pattern, which the prompt offers for approval so a
    // later call re-enters here and is let through.
    if (pinned !== undefined) {
      return { ...base, bypassPattern: pinned };
    }
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
 * The pinning pattern to publish, or `undefined` when this unit's matched rule
 * does not name the command the wrapper applies.
 *
 * Both halves must be present: the enumerator only stamps a bypass on a wrapper
 * whose verb is stable, and a rule only lifts the floor when its own text names
 * the inner command. A bare catch-all (`xargs *`, `*`) names nothing, so that
 * grant stays floored — it is broader than the command it rides on.
 */
function pinnedPattern(
  cmd: BashCommand,
  base: PermissionCheckResult,
): string | undefined {
  const inner = cmd.bypassInnerCommand;
  const pattern = cmd.bypassPattern;
  if (inner === undefined || pattern === undefined) return undefined;
  return rulePinsInnerCommand(base.matchedPattern, inner) ? pattern : undefined;
}

/**
 * True when a matched allow rule's literal prefix names `innerCommand` as a
 * whole token, compared by basename so a path-qualified inner command
 * (`xargs /bin/cat`) still pins.
 *
 * Only the text before the rule's first `*` is consulted: that is the part the
 * rule states, and everything after it is what the wildcard leaves open. A
 * pattern with no literal prefix at all (`*`, `**`) states nothing and never
 * pins.
 */
function rulePinsInnerCommand(
  matchedPattern: string | undefined,
  innerCommand: string,
): boolean {
  if (matchedPattern === undefined) return false;
  const star = matchedPattern.indexOf("*");
  const prefix = star === -1 ? matchedPattern : matchedPattern.slice(0, star);
  return prefix
    .split(/\s+/)
    .filter(Boolean)
    .some((token) => basename(token) === innerCommand);
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
