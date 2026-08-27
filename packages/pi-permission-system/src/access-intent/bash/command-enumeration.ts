import {
  EXECUTION_HOST_TYPES,
  forEachNestedExecution,
} from "#src/access-intent/bash/nested-execution";
import type { TSNode } from "#src/access-intent/bash/parser";
import {
  type CommandWord,
  classifyWrapperWords,
  executedUnitOf,
  type WrapperKind,
} from "#src/access-intent/bash/wrapper-analysis";
import type { BashCommandContext } from "#src/types";

export type { WrapperKind } from "#src/access-intent/bash/wrapper-analysis";

// ── Command type ─────────────────────────────────────────────────────────────

/**
 * One command-pattern unit of a parsed bash program.
 *
 * Minimal by design — `text` is the simple-command (or whole compound
 * statement) string matched against the bash rules.
 * The type is the stable extension point: #306 adds an execution `context`,
 * #307 adds per-command path candidates and an effective working directory.
 */
export interface BashCommand {
  readonly text: string;
  /**
   * Execution context for a nested command (substitution or subshell); absent
   * for a current-shell (top-level) command.
   */
  readonly context?: BashCommandContext;
  /**
   * Set when this unit is a floored indirection wrapper; its decision is floored
   * to at least `ask` so the wrapped command cannot ride a permissive `allow`.
   * Absent for an ordinary command.
   */
  readonly wrapperKind?: WrapperKind;
  /**
   * The command this wrapper unit actually runs (#713). Display-only — it is
   * never gated on its own, so the wrapper floor still applies. Absent for an
   * ordinary command, and for a wrapper whose inner command cannot be
   * established.
   */
  readonly executedUnit?: string;
}

// ── Command enumeration ──────────────────────────────────────────────────────

/**
 * Container node types descended into when enumerating command units.
 */
const COMMAND_ENUM_DESCEND = new Set([
  "program",
  "list",
  "pipeline",
  "redirected_statement",
]);

/**
 * Named node types abandoned during command enumeration: they are neither
 * commands nor able to host one, so nothing in their subtree ever runs.
 *
 * A redirect and a heredoc body are deliberately NOT listed here. Neither is a
 * command, but each can host a substitution that really executes, so both are
 * {@link EXECUTION_HOST_TYPES} members instead — conflating the two questions
 * ("is this a command?" and "can this host one?") is the bypass #741 fixed.
 *
 * Anonymous tokens (chain operators `&&`/`;`/`|`, substitution and subshell
 * delimiters `$(`/`)`/`` ` ``/`(`) are filtered by the `isNamed` guard, not
 * listed here.
 */
const COMMAND_ENUM_SKIP = new Set(["comment", "heredoc_end"]);

/**
 * Enumerate the command units of a bash program, in source order.
 *
 * Descends container nodes (`program`, `list`, `pipeline`,
 * `redirected_statement`) and emits each `command` node whole.
 * Additionally descends into the three nested execution contexts — command
 * substitution (`$(…)`, backticks), process substitution (`<(…)`/`>(…)`), and
 * subshells (`( … )`) — emitting each inner command as its own unit *in
 * addition to* the enclosing command, since those inner commands really execute
 * (#306).
 * Control-flow bodies and `{ … }` brace groups are emitted whole without
 * descending (deferred).
 *
 * The enclosing command/subshell is always still emitted whole, so adding the
 * nested units can only ever produce a more-restrictive decision, never weaker.
 *
 * Each emitted command unit has any leading `variable_assignment` prefix
 * stripped (so an env-var prefix cannot defeat a command-pattern rule), and a
 * wrapper unit (`bash -c`/`eval`, or an indirection wrapper such as `sudo`) is
 * tagged with a {@link WrapperKind} so its decision is later floored to `ask`.
 */
export function collectCommands(node: TSNode): BashCommand[] {
  const out: BashCommand[] = [];
  collectCommandsInto(node, undefined, out);
  return out;
}

function collectCommandsInto(
  node: TSNode,
  context: BashCommandContext | undefined,
  out: BashCommand[],
): void {
  // Anonymous tokens (operators `&&`/`;`/`|`, delimiters `$(`/`)`/`` ` ``/`(`)
  // carry no command.
  if (!node.isNamed) return;
  if (COMMAND_ENUM_SKIP.has(node.type)) return;

  if (node.type === "command") {
    out.push(makeCommandUnit(node, context));
    // A command's text already contains any substitution; descend its subtree
    // to ALSO emit the inner commands of command/process substitutions.
    collectHostedCommands(node, out);
    return;
  }

  if (EXECUTION_HOST_TYPES.has(node.type)) {
    // Not a command itself, but its subtree can host one that really runs
    // (`> $(rm x)`, `< <(rm c)`). Emit only what it hosts (#741).
    collectHostedCommands(node, out);
    return;
  }

  if (node.type === "subshell") {
    out.push(makeUnit(node.text, context)); // never-weaker whole emit
    descendCommandChildren(node, "subshell", out);
    return;
  }

  if (COMMAND_ENUM_DESCEND.has(node.type)) {
    descendCommandChildren(node, context, out);
    return;
  }

  // Any other named statement (compound_statement `{ … }`, if/while/for/case,
  // function_definition): emit whole, do not descend — deferred (#306).
  out.push(makeUnit(node.text, context));
}

function makeUnit(
  text: string,
  context: BashCommandContext | undefined,
  wrapperKind?: WrapperKind,
  executedUnit?: string,
): BashCommand {
  const unit: BashCommand = context ? { text, context } : { text };
  const flagged = wrapperKind ? { ...unit, wrapperKind } : unit;
  return executedUnit === undefined ? flagged : { ...flagged, executedUnit };
}

/**
 * Build the unit for a `command` node, reading its words once to answer both
 * wrapper questions: whether the unit is floored, and what it actually runs.
 */
function makeCommandUnit(
  node: TSNode,
  context: BashCommandContext | undefined,
): BashCommand {
  const text = commandUnitText(node);
  const words = readCommandWords(node);
  return makeUnit(
    text,
    context,
    classifyWrapperWords(words),
    executedUnitOf(text, words) ?? undefined,
  );
}

/**
 * A `command` node's words — its `command_name` followed by its arguments — each
 * carrying its offset into the unit text `commandUnitText` produces.
 *
 * A leading `variable_assignment` prefix is skipped (matching
 * `commandUnitText`), so offsets are relative to the `command_name`. An empty
 * list means a pure assignment with no `command_name`.
 */
function readCommandWords(node: TSNode): CommandWord[] {
  const words: CommandWord[] = [];
  let unitStart: number | undefined;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child?.isNamed) continue;
    if (child.type === "variable_assignment") continue;
    unitStart ??= child.startIndex;
    words.push({ text: child.text, offset: child.startIndex - unitStart });
  }
  return words;
}

/**
 * The command-pattern text of a `command` node, with any leading
 * `variable_assignment` prefix stripped.
 *
 * An env-var prefix (`AWS_PROFILE=prod aws …`, `PGPASSWORD=…`) is part of the
 * `command` node's text but must not defeat a rule that gates the underlying
 * command, so matching targets the text from the first non-assignment child
 * (the `command_name`) onward, sliced verbatim to preserve spacing. A pure
 * assignment (`FOO=bar`, no `command_name`) runs no command and is returned
 * unchanged.
 */
function commandUnitText(node: TSNode): string {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.isNamed && child.type !== "variable_assignment") {
      return node.text.slice(child.startIndex - node.startIndex);
    }
  }
  return node.text;
}

function descendCommandChildren(
  node: TSNode,
  context: BashCommandContext | undefined,
  out: BashCommand[],
): void {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) collectCommandsInto(child, context, out);
  }
}

/**
 * Enumerate the commands of every nested execution context in a subtree, each
 * tagged with the context it was found in.
 *
 * The traversal itself lives in `nested-execution.ts` so the bash path surface
 * shares one definition of what counts as a nested execution (#741); this
 * function supplies the command-surface interpretation of each one found.
 */
function collectHostedCommands(node: TSNode, out: BashCommand[]): void {
  forEachNestedExecution(node, (contextNode, context) => {
    descendCommandChildren(contextNode, context, out);
  });
}
