import type { BashCommandContext, FloorExemption } from "#src/types";
import {
  commandWordNodes,
  EXECUTION_HOST_TYPES,
  forEachExecutionIn,
  timedSubshellOf,
} from "./nested-execution";
import type { WordReader } from "./node-text";
import { parseUnresolvedWithin } from "./parse-health";
import type { TSNode } from "./parser";
import { REDIRECT_NODE_TYPES, redirectMayWriteFile } from "./redirect-analysis";
import {
  type CommandWord,
  classifyWrapperWords,
  executedUnitOf,
  floorExemptionOf,
  inlineShellPayloadIndex,
  type WrapperKind,
} from "./wrapper-analysis";

export type { WrapperKind } from "./wrapper-analysis";

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
  /**
   * Set when this unit was emitted from, or beneath, a statement holding a
   * region tree-sitter could not resolve. Its decision is floored to at least
   * `ask`, because the recovered structure is not evidence of what runs — ADR
   * 0013 §10's fail-closed base case (#840).
   */
  readonly parseUnresolved?: true;
  /**
   * Set when this unit came from a region re-parsed out of a subtree the
   * primary parse could not resolve, rather than from the primary parse
   * itself (#875).
   *
   * Narrower than {@link parseUnresolved}, which a primary unit also carries
   * when its enclosing statement failed. The verdict fold needs the
   * distinction to tell whether the *primary* parse found anything: when it
   * found nothing, the whole command string is the only surface an explicit
   * `deny` can reach (#452), and salvaging a unit must not make that check
   * unreachable.
   */
  readonly salvaged?: true;
  /**
   * Other spellings of {@link text} the shell runs identically, matched with
   * it as aliases of one invocation. Absent when there are none.
   *
   * Two producers supply them, each spelling the text on its own: the
   * home-expanded spelling of a unit whose text opens with `~`, `$HOME`, or
   * `${HOME}` in a program that leaves `HOME` alone
   * ({@link WordReader.spellHomeAtStart}), and the argument spelling, in which
   * every argument word the {@link ArgumentSpeller} resolved to an absolute
   * path is replaced by that path (#910).
   */
  readonly spellings?: readonly string[];
}

/**
 * What the enumerator asks about one argument word of a unit: the absolute
 * spelling of the path it names, as the party that resolved the program's
 * paths knows it, or `undefined` when there is none to give.
 *
 * Asked by node rather than by text, because only the node says which
 * occurrence of a token a unit's word is.
 */
export interface ArgumentSpeller {
  absoluteSpellingOf(node: TSNode): string | undefined;
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
  /**
   * True when the enclosing statement holds a region tree-sitter could not
   * resolve, so every unit beneath it is floored rather than trusted (#840).
   */
  readonly parseUnresolved: boolean;
  /**
   * True when the walk started from a salvaged region rather than the primary
   * parse tree (#875). Relayed unchanged, including into nested executions:
   * everything found inside a salvaged region is salvaged.
   */
  readonly salvaged: boolean;
  /**
   * How the program's shell expands an argument word. Relayed unchanged: a
   * program's variables are the same wherever in it a word sits.
   */
  readonly words: WordReader;
  /**
   * What an argument word's absolute spelling is, from the party that resolved
   * the program's paths. Relayed unchanged, including into nested executions:
   * it answers by node, so each unit asks about its own words. Absent for a
   * salvaged region, whose nodes are not the primary tree's.
   */
  readonly speller?: ArgumentSpeller;
}

/** A top-level command in the current shell, writing no file, fully parsed. */
function topLevelScope(
  words: WordReader,
  speller: ArgumentSpeller | undefined,
): UnitScope {
  const scope: UnitScope = {
    writesViaRedirect: false,
    parseUnresolved: false,
    salvaged: false,
    words,
  };
  return speller === undefined ? scope : { ...scope, speller };
}

/**
 * The scope a salvaged region's own units run under.
 *
 * Marked unresolved because the region reached the salvage only by failing in
 * the primary parse, so the verdict fold floors what it recovers rather than
 * trusting it. `writesViaRedirect` starts false for the same reason
 * {@link collectHostedCommands} resets it: a redirect established outside the
 * region is the enclosing statement's, not the region's.
 */
function salvagedScope(words: WordReader): UnitScope {
  return {
    writesViaRedirect: false,
    parseUnresolved: true,
    salvaged: true,
    words,
  };
}

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
 *
 * `select` parses as `for_statement` and `until` as `while_statement`, so each
 * pair is one entry.
 */
const COMPOUND_STATEMENT_TYPES = new Set([
  "if_statement",
  "while_statement",
  "for_statement",
  "c_style_for_statement",
  "case_statement",
  "function_definition",
  "compound_statement",
  "negated_command",
]);

/**
 * Syntactic groupings inside a compound statement: descended, never emitted.
 *
 * None of these is something anybody runs — a `do_group` is the loop body's
 * punctuation — so emitting one would produce a `do rm $f; done` unit.
 */
const STATEMENT_GROUP_TYPES = new Set([
  "do_group",
  "case_item",
  "elif_clause",
  "else_clause",
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
 * (#306). A subshell timed by `time`, which the grammar reads as the argument
 * of a command named `time`, is descended the same way.
 * A compound statement (control flow, a function definition, a `{ … }` brace
 * group) is emitted whole and then descended for the statements it contains,
 * while its operand words — a loop variable, a word list, a `case` subject, a
 * function's own name — are not commands and are left unemitted. An `ERROR`
 * node is the one exception: its recovered structure is invented rather than
 * observed, so the unparsed blob is emitted whole and never descended (#742).
 *
 * The enclosing command/statement is always still emitted whole, so adding the
 * nested units can only ever produce a more-restrictive decision, never weaker.
 *
 * A unit emitted from, or beneath, a statement holding a region tree-sitter
 * could not resolve is marked {@link BashCommand.parseUnresolved}, so the
 * verdict fold can floor it rather than match its recovered text against the
 * bash rules (#840).
 *
 * Each emitted command unit has any leading `variable_assignment` prefix
 * stripped (so an env-var prefix cannot defeat a command-pattern rule), and a
 * wrapper unit (`bash -c`/`eval`, or an indirection wrapper such as `sudo`) is
 * tagged with a {@link WrapperKind} so its decision is later floored to `ask`.
 */
export function collectCommands(
  node: TSNode,
  words: WordReader,
  speller?: ArgumentSpeller,
): BashCommand[] {
  const out: BashCommand[] = [];
  collectCommandsInto(node, topLevelScope(words, speller), out);
  return out;
}

/**
 * Enumerate the command units of a region the primary parse could not resolve,
 * re-parsed cleanly on its own (`unresolved-salvage.ts`, #875).
 *
 * The same walk as {@link collectCommands}, differing only in the scope it
 * starts from: every unit is marked {@link BashCommand.parseUnresolved}, so a
 * command the primary parse dropped is matched against the bash rules — an
 * explicit `deny` fires — while its `allow` is still floored to `ask` by the
 * verdict fold (#840).
 */
export function collectSalvagedCommands(
  node: TSNode,
  words: WordReader,
): BashCommand[] {
  const out: BashCommand[] = [];
  collectCommandsInto(node, salvagedScope(words), out);
  return out;
}

/**
 * The node holding a `command` node's inline-shell payload — the inner program
 * of `bash -c '…'`, `sh -c "…"`, or `eval '…'` — or `null` for any other
 * command.
 *
 * The node rather than its text, because the log's command masker re-parses the
 * payload and offsets the spans it recovers by the node's `startIndex`
 * (`logging/command-redaction.ts`, #923). {@link executedUnitOf} answers the
 * text question for display and cannot serve that one: it unquotes, unwraps
 * nested indirection, and drops a result that adds nothing — all of which lose
 * the correspondence to the command as written.
 *
 * The payload set is the *shell* set, which is what keeps an interpreter
 * (`python3 -c`, `node -e`) out: its payload is another language, so re-parsing
 * it as bash would read a secret out of embedded Python.
 */
export function inlineShellPayloadNode(
  command: TSNode,
  words: WordReader,
): TSNode | null {
  const nodes = commandWordNodes(command);
  const index = inlineShellPayloadIndex(
    nodes.map((node) => ({
      ...words.argWord(node),
      text: node.text,
      offset: node.startIndex,
    })),
  );
  return index === -1 ? null : (nodes.at(index) ?? null);
}

function collectCommandsInto(
  node: TSNode,
  inherited: UnitScope,
  out: BashCommand[],
): void {
  // Anonymous tokens (operators `&&`/`;`/`|`, delimiters `$(`/`)`/`` ` ``/`(`)
  // carry no command.
  if (!node.isNamed) return;
  if (COMMAND_ENUM_SKIP.has(node.type)) return;

  const scope = unresolvedScope(node, inherited);

  if (node.type === "command") {
    const timed = timedSubshellOf(node);
    if (timed !== null) {
      collectTimedSubshell(node, timed, scope, out);
      return;
    }
    out.push(makeCommandUnit(node, scope));
    // A command's text already contains any substitution; descend its subtree
    // to ALSO emit the inner commands of command/process substitutions.
    collectHostedCommands(node, scope, out);
    return;
  }

  if (node.type === "redirected_statement") {
    descendCommandChildren(node, redirectedScope(node, scope), out);
    return;
  }

  if (EXECUTION_HOST_TYPES.has(node.type)) {
    // Not a command itself, but its subtree can host one that really runs
    // (`> $(rm x)`, `< <(rm c)`). Emit only what it hosts (#741).
    collectHostedCommands(node, scope, out);
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
  collectHostedCommands(node, scope, out);
}

/**
 * Enumerate `time ( … )`: the `time` unit whole, then the subshell's commands
 * as units of their own, exactly as a bare subshell's are.
 *
 * The `time` unit is the never-weaker whole emit, and it is exempt from the
 * wrapper floor: the floor exists because a wrapper hides the command that
 * should be gated, and every command in this subshell is a unit gated on its
 * own rules. It resolves by its executed unit, the subshell's text, which is
 * how the bare subshell's whole unit resolves.
 *
 * Substitutions the command hosts outside the subshell (in a redirect) are
 * still enumerated, and the subshell is left to the descent so a substitution
 * inside it is emitted once.
 */
function collectTimedSubshell(
  node: TSNode,
  subshell: TSNode,
  scope: UnitScope,
  out: BashCommand[],
): void {
  out.push(makeCommandUnit(node, scope, "execution-modifier"));
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.startIndex !== subshell.startIndex) {
      collectHostedCommands(child, scope, out);
    }
  }
  descendCommandChildren(
    subshell,
    { ...redirectedScope(node, scope), context: "subshell" },
    out,
  );
}

/**
 * The scope `node`'s own subtree establishes, marking it unresolved when
 * tree-sitter could not parse a region within it (#840).
 *
 * The three pure containers are deliberately excluded. `program`, `list`, and
 * `pipeline` report an error whenever *anything* anywhere beneath them failed,
 * so asking there would mark every unit of the command and make the answer
 * per-program rather than per-statement. Excluded, `rm -rf /tmp/y` in
 * `echo hi > out.txt <> rw.txt; rm -rf /tmp/y` keeps its own rule, while every
 * unit under the failed statement is floored.
 *
 * Over-marking is the fail-closed direction — the flag can only floor an
 * `allow` up to `ask`, never weaken a decision — which is what makes marking a
 * whole statement for a failure buried in one of its redirects acceptable.
 */
function unresolvedScope(node: TSNode, scope: UnitScope): UnitScope {
  if (scope.parseUnresolved) return scope;
  if (COMMAND_ENUM_DESCEND.has(node.type)) return scope;
  return parseUnresolvedWithin(node)
    ? { ...scope, parseUnresolved: true }
    : scope;
}

/**
 * The facts a `command` node's words establish about its unit: the three
 * wrapper answers, and the other spellings its text has.
 */
interface UnitFacts {
  readonly wrapperKind?: WrapperKind;
  readonly executedUnit?: string;
  readonly floorExemption?: FloorExemption;
  readonly spellings?: readonly string[];
}

function makeUnit(
  text: string,
  scope: UnitScope,
  facts: UnitFacts = {},
): BashCommand {
  const { wrapperKind, executedUnit, floorExemption, spellings } = facts;
  const scoped: BashCommand = scope.context
    ? { text, context: scope.context }
    : { text };
  const flagged = wrapperKind ? { ...scoped, wrapperKind } : scoped;
  const named =
    executedUnit === undefined ? flagged : { ...flagged, executedUnit };
  const exempted =
    floorExemption === undefined ? named : { ...named, floorExemption };
  const marked: BashCommand = scope.parseUnresolved
    ? { ...exempted, parseUnresolved: true }
    : exempted;
  const salvaged: BashCommand = scope.salvaged
    ? { ...marked, salvaged: true }
    : marked;
  return spellings === undefined ? salvaged : { ...salvaged, spellings };
}

/**
 * Build the unit for a `command` node, reading its words once to answer all
 * three wrapper questions: whether the unit is floored, what it actually runs,
 * and whether the floor still has a reason to hold.
 *
 * The floor question also reads the command's own redirects: one written
 * before or between the words (`>/tmp/o xargs grep foo`) writes a file as
 * surely as one on the enclosing statement.
 */
function makeCommandUnit(
  node: TSNode,
  scope: UnitScope,
  floorExemption?: FloorExemption,
): BashCommand {
  const { text, words, argumentSpelling } = readCommandUnit(node, scope);
  return makeUnit(text, scope, {
    spellings: distinctSpellings(text, [
      scope.words.spellHomeAtStart(text),
      argumentSpelling,
    ]),
    wrapperKind: classifyWrapperWords(words),
    executedUnit: executedUnitOf(text, words) ?? undefined,
    floorExemption:
      floorExemption ?? floorExemptionOf(words, redirectedScope(node, scope)),
  });
}

/**
 * The scope a node's own children run under: the enclosing one, plus a write
 * unless every `file_redirect` among its children provably only reads.
 *
 * Asked of a `redirected_statement` and of a `command`, since a redirect may
 * hang off either. On a statement, the redirect belongs to the last element of
 * a pipeline, but it hangs off the whole statement in the parse tree, so every
 * command beneath it is marked.
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
 * A `command` node's unit: the command-pattern text a bash rule is matched
 * against, and its words (the `command_name` followed by its arguments), each
 * carrying its offset into that text.
 *
 * The text runs from the first word to the last, so it leaves out two kinds of
 * child that are not words of the command:
 *
 * - An env-var prefix (`AWS_PROFILE=prod aws …`, `PGPASSWORD=…`), which is part
 *   of the `command` node's text but must not defeat a rule that gates the
 *   underlying command.
 * - A redirect, wherever it sits (`2>/dev/null git push`, `git <<< x push`).
 *   Bash accepts one anywhere in a simple command, and its position does not
 *   change which command runs, so it must not change which rule applies either
 *   (#977).
 *
 * The source between two consecutive words is kept verbatim, so a command with
 * no hosted redirect keeps its exact spacing and line continuations; where a
 * redirect sat between two words, one space joins them instead.
 * A pure assignment (`FOO=bar`, no `command_name`) runs no command, has no
 * words, and keeps its whole text.
 */
function readCommandUnit(
  node: TSNode,
  scope: UnitScope,
): {
  text: string;
  words: CommandWord[];
  argumentSpelling?: string;
} {
  const nodes = commandWordNodes(node);
  if (nodes.length === 0) return { text: node.text, words: [] };

  const redirects = hostedRedirects(node);
  const words: CommandWord[] = [];
  let text = "";
  let spelled = "";
  let respelled = false;
  let previous: TSNode | undefined;
  for (const word of nodes) {
    if (previous) {
      const gap = gapBetween(node, previous, word, redirects);
      text += gap;
      spelled += gap;
    }
    const argWord = scope.words.argWord(word);
    words.push({ ...argWord, text: word.text, offset: text.length });
    text += word.text;
    const spelling = argWord.computed
      ? undefined
      : scope.speller?.absoluteSpellingOf(word);
    respelled ||= spelling !== undefined;
    spelled += spelling ?? word.text;
    previous = word;
  }
  return respelled
    ? { text, words, argumentSpelling: spelled }
    : { text, words };
}

/**
 * The spellings that differ from `text`, each once, or `undefined` when none
 * does — so a unit with nothing to respell keeps the shape it had.
 */
function distinctSpellings(
  text: string,
  candidates: readonly (string | undefined)[],
): readonly string[] | undefined {
  const spellings = [
    ...new Set(
      candidates.filter(
        (spelling): spelling is string =>
          spelling !== undefined && spelling !== text,
      ),
    ),
  ];
  return spellings.length === 0 ? undefined : spellings;
}

/**
 * The text that joins two consecutive words of a unit: the command's own
 * source between them, or one space where a hosted redirect sat there.
 */
function gapBetween(
  command: TSNode,
  before: TSNode,
  after: TSNode,
  redirects: readonly TSNode[],
): string {
  const hostsRedirect = redirects.some(
    (redirect) =>
      redirect.startIndex >= before.endIndex &&
      redirect.startIndex < after.startIndex,
  );
  if (hostsRedirect) return " ";
  return command.text.slice(
    before.endIndex - command.startIndex,
    after.startIndex - command.startIndex,
  );
}

/** The redirects a `command` node hosts among its own children. */
function hostedRedirects(node: TSNode): TSNode[] {
  const redirects: TSNode[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && REDIRECT_NODE_TYPES.has(child.type)) redirects.push(child);
  }
  return redirects;
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
    else collectHostedCommands(child, scope, out);
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
function collectHostedCommands(
  node: TSNode,
  scope: UnitScope,
  out: BashCommand[],
): void {
  forEachExecutionIn(node, (contextNode, context) => {
    // A nested execution starts fresh: an enclosing statement's redirect is
    // that statement's, not the substitution's, exactly as #807 attributes a
    // nested command's path tokens to its own command. The parse question
    // starts fresh for the same reason and costs nothing either way — each
    // statement inside re-asks it of itself, and the enclosing statement's own
    // units carry the mark regardless, so the verdict is unchanged (#840).
    descendCommandChildren(
      contextNode,
      {
        context,
        writesViaRedirect: false,
        parseUnresolved: false,
        salvaged: scope.salvaged,
        words: scope.words,
        speller: scope.speller,
      },
      out,
    );
  });
}
