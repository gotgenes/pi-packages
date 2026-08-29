import {
  EXECUTION_HOST_TYPES,
  forEachExecutionIn,
} from "#src/access-intent/bash/nested-execution";
import type { TSNode } from "#src/access-intent/bash/parser";
import { redirectMayWriteFile } from "#src/access-intent/bash/redirect-analysis";
import {
  type CommandWord,
  classifyWrapperWords,
  executedUnitOf,
  isTransparentWrapper,
  type WrapperKind,
} from "#src/access-intent/bash/wrapper-analysis";
import type { BashCommandContext, FloorExemption } from "#src/types";

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
   * The command this wrapper unit actually runs (#713). Absent for an ordinary
   * command, and for a wrapper whose inner command cannot be established.
   *
   * Display-only, and deliberately looks past an `sh -c` layer the gate must
   * not look past — {@link floorExemption} is the gateable answer, established
   * by its own walk rather than read off this string (#803).
   */
  readonly executedUnit?: string;
  /**
   * Set when this wrapper unit's floor has no reason left to hold, naming the
   * reason (#803). Only ever present alongside `wrapperKind: "indirection"`
   * and an established {@link executedUnit}.
   */
  readonly floorExemption?: FloorExemption;
}

/**
 * What the statement enclosing a command unit establishes about it.
 *
 * Both facts flow down the walk together because both are the *statement's*,
 * not the command's: a subshell's commands run in a subshell however they are
 * spelled, and a redirected statement writes a file however read-only the
 * command in front of the operator is.
 */
interface UnitScope {
  /**
   * Execution context for a nested command (substitution or subshell); absent
   * for a current-shell (top-level) command.
   */
  readonly context?: BashCommandContext;
  /**
   * True when the enclosing statement redirects output into a real file, which
   * withholds the floor exemption from any wrapper unit beneath it.
   */
  readonly writesViaRedirect: boolean;
}

/** A top-level command in the current shell, writing no file. */
const TOP_LEVEL_SCOPE: UnitScope = { writesViaRedirect: false };

// ── Node-type vocabulary ─────────────────────────────────────────────────────

/**
 * Container node types descended into with the enclosing scope unchanged.
 *
 * `redirected_statement` is descended too, but has its own branch: it is the
 * node that can establish a write, so it descends with a scope of its own.
 */
const COMMAND_ENUM_DESCEND = new Set(["program", "list", "pipeline"]);

/**
 * Compound statements: emitted whole, then descended for their statements.
 *
 * The whole emit is what keeps the #306 never-weaker invariant — the commands
 * found inside are additional units, never a replacement.
 */
const COMPOUND_STATEMENT_TYPES = new Set(["for_statement"]);

/**
 * Syntactic groupings inside a compound statement: descended, never emitted.
 *
 * A `do_group` is nothing anybody runs; it is the loop body's punctuation, and
 * emitting its text would produce a `do rm $f; done` unit.
 */
const STATEMENT_GROUP_TYPES = new Set(["do_group"]);

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
 * Every node type the enumerator recognizes as a statement.
 *
 * This is the enumerator's third question, beside "is this a command?" and
 * "can this host one?": "is this a *statement*, so that descending an enclosing
 * compound reaches it?" A compound statement's named children are a mix —
 * `for_statement` carries its loop variable and word list, `case_statement` its
 * subject, `function_definition` its name — and descending all of them emits
 * operand words as bash command units, naming `a` as the offending *command* in
 * a prompt. Membership is what {@link descendStatementChildren} filters on.
 */
const STATEMENT_TYPES = new Set([
  "command",
  "redirected_statement",
  "subshell",
  "declaration_command",
  "variable_assignment",
  "test_command",
  "unset_command",
  "ERROR",
  ...COMMAND_ENUM_DESCEND,
  ...COMPOUND_STATEMENT_TYPES,
  ...STATEMENT_GROUP_TYPES,
]);

// ── Command enumeration ──────────────────────────────────────────────

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
  collectCommandsInto(node, TOP_LEVEL_SCOPE, out);
  return out;
}

function collectCommandsInto(
  node: TSNode,
  scope: UnitScope,
  out: BashCommand[],
): void {
  // Anonymous tokens (operators `&&`/`;`/`|`, delimiters `$(`/`)`/`` ` ``/`(`)
  // carry no command.
  if (!node.isNamed) return;
  if (COMMAND_ENUM_SKIP.has(node.type)) return;

  if (node.type === "command") {
    out.push(makeCommandUnit(node, scope));
    // A command's text already contains any substitution; descend its subtree
    // to ALSO emit the inner commands of command/process substitutions.
    collectHostedCommands(node, out);
    return;
  }

  if (node.type === "redirected_statement") {
    descendCommandChildren(node, redirectedScope(node, scope), out);
    return;
  }

  if (EXECUTION_HOST_TYPES.has(node.type)) {
    // Not a command itself, but its subtree can host one that really runs
    // (`> $(rm x)`, `< <(rm c)`). Emit only what it hosts (#741).
    collectHostedCommands(node, out);
    return;
  }

  if (node.type === "subshell") {
    out.push(makeUnit(node.text, scope)); // never-weaker whole emit
    descendCommandChildren(node, { ...scope, context: "subshell" }, out);
    return;
  }

  if (COMMAND_ENUM_DESCEND.has(node.type)) {
    descendCommandChildren(node, scope, out);
    return;
  }

  if (COMPOUND_STATEMENT_TYPES.has(node.type)) {
    out.push(makeUnit(node.text, scope)); // never-weaker whole emit
    descendStatementChildren(node, scope, out);
    return;
  }

  if (STATEMENT_GROUP_TYPES.has(node.type)) {
    descendStatementChildren(node, scope, out);
    return;
  }

  if (node.type === "ERROR") {
    // Tree-sitter's error recovery *invents* structure, so the node types
    // inside an ERROR subtree are not evidence that anything runs: descending
    // one turns backtick-quoted prose in an unterminated heredoc into command
    // units. Emit the unparsed blob whole and stop (#742).
    out.push(makeUnit(node.text, scope));
    return;
  }

  // Any other named statement (compound_statement `{ … }`, if/while/for/case,
  // function_definition): emit whole, do not descend — deferred (#306).
  // A declaration, assignment, test, or `unset` still hosts executions that
  // really run (`local x=$(rm y)`, `[[ $(rm x) ]]`), so those are enumerated
  // in addition to the statement (#742).
  out.push(makeUnit(node.text, scope));
  collectHostedCommands(node, out);
}

/** The wrapper facts a `command` node's words establish about its unit. */
interface WrapperFacts {
  readonly wrapperKind?: WrapperKind;
  readonly executedUnit?: string;
  readonly floorExemption?: FloorExemption;
}

function makeUnit(
  text: string,
  scope: UnitScope,
  wrapper: WrapperFacts = {},
): BashCommand {
  const { wrapperKind, executedUnit, floorExemption } = wrapper;
  const scoped: BashCommand = scope.context
    ? { text, context: scope.context }
    : { text };
  const flagged = wrapperKind ? { ...scoped, wrapperKind } : scoped;
  const named =
    executedUnit === undefined ? flagged : { ...flagged, executedUnit };
  return floorExemption === undefined ? named : { ...named, floorExemption };
}

/**
 * Build the unit for a `command` node, reading its words once to answer all
 * three wrapper questions: whether the unit is floored, what it actually runs,
 * and whether the floor still has a reason to hold.
 */
function makeCommandUnit(node: TSNode, scope: UnitScope): BashCommand {
  const text = commandUnitText(node);
  const words = readCommandWords(node);
  return makeUnit(text, scope, {
    wrapperKind: classifyWrapperWords(words),
    executedUnit: executedUnitOf(text, words) ?? undefined,
    floorExemption: isTransparentWrapper(words, scope)
      ? "core-reader"
      : undefined,
  });
}

/**
 * The scope a `redirected_statement`'s children run under: the enclosing one,
 * plus a write unless every one of its redirects provably only reads.
 *
 * The redirect belongs to the last element of a pipeline, but it hangs off the
 * whole statement in the parse tree, so every command beneath it is marked.
 * Over-attributing is the fail-closed direction — the flag can only withhold an
 * exemption, never grant one — which is also why the question asked of each
 * redirect is a refusal rather than a proof.
 */
function redirectedScope(node: TSNode, scope: UnitScope): UnitScope {
  if (scope.writesViaRedirect) return scope;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.type !== "file_redirect") continue;
    if (redirectMayWriteFile(child)) {
      return { ...scope, writesViaRedirect: true };
    }
  }
  return scope;
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
  scope: UnitScope,
  out: BashCommand[],
): void {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) collectCommandsInto(child, scope, out);
  }
}

/**
 * Descend a compound statement's children, enumerating only the ones that are
 * themselves statements.
 *
 * The filter is the whole difference from {@link descendCommandChildren}, whose
 * container types (`program` / `list` / `pipeline` / `redirected_statement` /
 * `subshell`) have nothing but statement children. Here the children are a mix,
 * and a non-statement one is an operand word rather than something that runs.
 *
 * A non-statement child is not abandoned, though: `for f in $(rm x)` hosts a
 * real execution in its word list, which is what the second branch reaches.
 *
 * The scope is relayed unchanged — a compound statement's body runs in the
 * current shell, so a write established by an enclosing `redirected_statement`
 * covers every unit beneath it (#803).
 */
function descendStatementChildren(
  node: TSNode,
  scope: UnitScope,
  out: BashCommand[],
): void {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child?.isNamed) continue;
    if (STATEMENT_TYPES.has(child.type)) collectCommandsInto(child, scope, out);
    else collectHostedCommands(child, out);
  }
}

/**
 * Enumerate the commands of every nested execution context in a subtree, each
 * tagged with the context it was found in.
 *
 * The traversal itself lives in `nested-execution.ts` so the bash path surface
 * shares one definition of what counts as a nested execution (#741); this
 * function supplies the command-surface interpretation of each one found.
 *
 * `node` may be a context outright or merely host one, so the traversal is the
 * root-inclusive `forEachExecutionIn`.
 */
function collectHostedCommands(node: TSNode, out: BashCommand[]): void {
  forEachExecutionIn(node, (contextNode, context) => {
    // A nested execution starts fresh: an enclosing statement's redirect is
    // that statement's, not the substitution's, exactly as #807 attributes a
    // nested command's path tokens to its own command.
    descendCommandChildren(
      contextNode,
      { context, writesViaRedirect: false },
      out,
    );
  });
}
