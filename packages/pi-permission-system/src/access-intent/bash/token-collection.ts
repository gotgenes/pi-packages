import { basename } from "node:path";
import { type TokenEffect, UNPROVEN_EFFECT } from "#src/access-intent/effect";
import { proveCommandEffect } from "./command-effects";
import { EXECUTION_HOST_TYPES, forEachExecutionIn } from "./nested-execution";
import {
  ARG_NODE_TYPES,
  resolveNodeText,
  SKIP_SUBTREE_TYPES,
} from "./node-text";
import type { TSNode } from "./parser";
import { redirectEffectForDestination } from "./redirect-analysis";

/**
 * A collected path-candidate token paired with the effect its position proved.
 *
 * The pairing is made where the token is *produced*, never by mapping a whole
 * result: a nested execution's tokens carry their own command's attribution
 * and must not be overwritten by the enclosing one.
 */
export interface PathToken {
  readonly token: string;
  readonly effect: TokenEffect;
}

// ── Public surface ─────────────────────────────────────────────────────────

/**
 * Recursively visit the AST and collect resolved text of nodes that
 * represent command arguments, redirect destinations, or a statement's own
 * path operands.
 *
 * Reads no text from `heredoc_body`, `heredoc_end`, or `comment` subtrees, but
 * still descends an execution host for the commands it hosts — an interpolating
 * heredoc body runs its substitution even though its prose is never an operand
 * (#741). That is why the {@link EXECUTION_HOST_TYPES} branch sits above the
 * {@link SKIP_SUBTREE_TYPES} check: `heredoc_body` is in both sets, and the
 * host reading is the one that must win.
 *
 * For commands in `PATTERN_FIRST_COMMANDS`, uses position-based
 * argument skipping to avoid collecting inline patterns/scripts
 * as path candidates. For all other commands, collects all
 * arguments generically.
 */
export function collectPathCandidateTokens(node: TSNode): PathToken[] {
  if (node.type === "command") return collectCommandTokens(node);
  if (node.type === "file_redirect") return collectRedirectTokens(node);
  if (node.type === "for_statement") {
    return collectStatementOperandTokens(node, "after-in");
  }
  if (node.type === "case_statement") {
    return collectStatementOperandTokens(node, "before-in");
  }
  if (EXECUTION_HOST_TYPES.has(node.type)) {
    return collectHostedExecutionTokens(node);
  }
  if (SKIP_SUBTREE_TYPES.has(node.type)) return [];

  const tokens: PathToken[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) tokens.push(...collectPathCandidateTokens(child));
  }
  return tokens;
}

/**
 * Select the collection strategy for a `command` node: pattern-first
 * commands use `collectPatternCommandTokens`; all others use
 * `collectGenericCommandTokens`.
 *
 * Every token the command owns carries the effect its head word proves — the
 * pure-reader core, read through the *raw* head word so a path-qualified
 * spelling proves nothing. A nested execution collected along the way keeps
 * its own command's attribution instead.
 */
export function collectCommandTokens(node: TSNode): PathToken[] {
  const effect = proveCommandEffect(
    extractCommandWord(node) ?? "",
    commandArgumentWords(node),
  );
  const commandName = extractCommandName(node);
  const config = commandName
    ? PATTERN_FIRST_COMMANDS.get(commandName)
    : undefined;
  if (config) return collectPatternCommandTokens(node, config, effect);
  return [
    ...collectGenericCommandTokens(node, effect),
    ...collectEmbeddedOptionValues(node, effect),
  ];
}

/**
 * Collect redirect-destination tokens from a `file_redirect` node.
 *
 * The destination itself is an argument value (`> out.txt`), but it can also
 * host a command that really runs (`> $(cat /etc/shadow)`, `< <(cmd)`), whose
 * own operands are path candidates too — so each child is both read for its
 * text and searched for nested executions (#741).
 *
 * Both passes are needed: a substitution can be the destination outright, or be
 * concatenated into it (`> ${DIR}/$(cmd)`), and a `concatenation` is itself an
 * argument node.
 *
 * The operator proves the destination's effect outright, and that proof is
 * absolute: it overrides whatever the redirected command's own head word
 * proved, because `> out.txt` writes `out.txt` however read-only the command
 * in front of it is. A destination the operator names as a file descriptor
 * (`2>&1`) contributes no token at all.
 *
 * Reading the redirect node itself belongs to `redirect-analysis.ts`, which
 * the command enumerator consults for the same fact (#803).
 */
export function collectRedirectTokens(node: TSNode): PathToken[] {
  const tokens: PathToken[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (ARG_NODE_TYPES.has(child.type)) {
      const effect = redirectEffectForDestination(node, child);
      if (effect) tokens.push({ token: resolveNodeText(child), effect });
    }
    tokens.push(...collectHostedExecutionTokens(child));
  }
  return tokens;
}

/**
 * Collect the path-candidate tokens of every command nested inside `node`'s
 * execution contexts, reading none of the host subtree's own text.
 *
 * This is what lets a heredoc body contribute its substitution's operands while
 * its prose stays out of the path surface entirely.
 *
 * `node` may be a context outright (`> $(cmd)`) or merely contain one
 * (`> ${DIR}/$(cmd)`), so the traversal is the root-inclusive
 * `forEachExecutionIn`.
 */
function collectHostedExecutionTokens(node: TSNode): PathToken[] {
  const tokens: PathToken[] = [];
  forEachExecutionIn(node, (contextNode) => {
    tokens.push(...collectPathCandidateTokens(contextNode));
  });
  return tokens;
}

/**
 * Which side of a statement's `in` keyword carries its path operands.
 *
 * A `for`/`select` word list follows `in`; a `case` subject precedes it.
 */
type OperandSide = "before-in" | "after-in";

/**
 * Collect the tokens of a statement that names its own path operands, rather
 * than reaching them through a command.
 *
 * A path in a `for`/`select` word list or a `case` subject is a child of the
 * statement node, so the command and redirect collectors never see it and the
 * loop body cannot recover it — `for f in /etc/shadow; do cat $f; done` carries
 * the literal only here, and ADR 0009 declines to resolve the body's `$f`
 * (#839).
 *
 * The two statements ask one question with one parameter — which side of the
 * anonymous `in` keyword is the operand side — so the walk is named here once
 * rather than spelled twice, as `COMMAND_PREFIX_TYPES` is for the two command
 * walkers.
 *
 * Three properties carry the design:
 *
 * 1. A non-operand child falls through to the ordinary recursion, not to
 *    nothing. That is what keeps the `do_group` reaching the loop body's
 *    commands; searching it for hosted executions alone would silently drop
 *    every ordinary body command.
 * 2. An operand-side child outside {@link ARG_NODE_TYPES} falls through the
 *    same way, so a bare substitution in the word list is descended for its
 *    command as before and its operands keep that command's own attribution
 *    (#807) instead of the statement's.
 * 3. An operand-side argument node is read *and* searched for hosted
 *    executions, since a `concatenation` can be both — the pairing
 *    {@link collectRedirectTokens} already performs on a destination.
 *
 * The token carries {@link UNPROVEN_EFFECT}: no command word owns it and no
 * redirect operator names it, so neither proof source can speak and the gates
 * consult both directional surfaces.
 */
function collectStatementOperandTokens(
  node: TSNode,
  operandSide: OperandSide,
): PathToken[] {
  const tokens: PathToken[] = [];
  let seenIn = false;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (!child.isNamed) {
      if (child.type === "in") seenIn = true;
      continue;
    }
    const side: OperandSide = seenIn ? "after-in" : "before-in";
    if (side !== operandSide || !ARG_NODE_TYPES.has(child.type)) {
      tokens.push(...collectPathCandidateTokens(child));
      continue;
    }
    tokens.push({ token: resolveNodeText(child), effect: UNPROVEN_EFFECT });
    tokens.push(...collectHostedExecutionTokens(child));
  }
  return tokens;
}

/**
 * Extract the command name from a `command` node.
 * Returns the basename (e.g. `/usr/bin/sed` → `sed`), or undefined
 * if the command name cannot be determined (e.g. variable expansion).
 *
 * The basename is what {@link PATTERN_FIRST_COMMANDS} needs: `/usr/bin/sed`
 * parses its arguments exactly as `sed` does. It is the wrong question for a
 * capability claim, where the directory prefix is the whole point — use
 * {@link extractCommandWord} there.
 */
export function extractCommandName(node: TSNode): string | undefined {
  const word = extractCommandWord(node);
  return word === undefined ? undefined : basename(word);
}

/**
 * Extract the head word of a `command` node exactly as it was written, or
 * undefined when it cannot be determined (e.g. variable expansion).
 *
 * Unbasenamed on purpose: `./grep` and `/tmp/evil/grep` name programs the
 * pure-reader core's audit never saw, so an effect proof must be able to tell
 * them from a bare `grep` — the Codex lesson the bare-basename rule encodes.
 * Documented against {@link extractCommandName}, which answers the other
 * question.
 */
export function extractCommandWord(node: TSNode): string | undefined {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === "command_name") {
      const text = resolveNodeText(child);
      return text === "" ? undefined : text;
    }
  }
  return undefined;
}

// ── Private helpers and config ─────────────────────────────────────────────

/**
 * The command's own argument words, which the retraction guards read.
 *
 * Reads the argument nodes directly rather than the collected tokens, because
 * a guard fires on an *option* (`find -delete`) and no collector emits one.
 */
function commandArgumentWords(node: TSNode): string[] {
  const words: string[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === "command_name" || child.type === "variable_assignment")
      continue;
    if (!ARG_NODE_TYPES.has(child.type)) continue;
    words.push(resolveNodeText(child));
  }
  return words;
}

/**
 * The children of a `command` node that supply no operand text of their own:
 * its head word, and any env-var prefix assignment.
 *
 * Both are skipped as operands — the head word is not an argument, and a prefix
 * assignment's value is assigned rather than accessed — but either can *host* a
 * substitution that really runs (`$(cat /etc/shadow)`,
 * `FOO=$(cat /etc/shadow) echo hi`), whose own operands are candidates like any
 * other position (ADR 0009's positional invariance). The two walkers below are
 * different state machines and so each carry their own skip, which is why the
 * question is named here once rather than spelled twice (#742).
 */
const COMMAND_PREFIX_TYPES: ReadonlySet<string> = new Set([
  "command_name",
  "variable_assignment",
]);

/**
 * A long or short option carrying its value inline: one or two leading dashes,
 * a name containing no `=` or whitespace, then `=` and a non-empty value.
 * Only the first `=` separates, so `--opt=/tmp/a=b` yields `/tmp/a=b`.
 */
const OPTION_VALUE_PATTERN = /^-{1,2}[^=\s]+=(.+)$/;

/**
 * The values embedded in a **generic** command's `--opt=value` argument tokens.
 *
 * Read straight from the argument nodes rather than from the collected token
 * list, because a collector classifies a flag and never emits it — so
 * `tar --directory=/etc` would otherwise lose the path.
 *
 * This is token *preprocessing*, not classification: the extracted value is
 * handed to the ordinary shape classifiers and existence probe, so
 * `--file=/tmp/patterns` reaches the path surfaces while `--format=json`
 * yields a bare `json` that names nothing and is dropped. Keeping the split
 * here is what lets the projection see option-embedded paths without per-command
 * option tables (ADR 0009, #645).
 *
 * A pattern-first command runs the same split from inside its own walker
 * instead, because there the flag's *role* is known: splitting blindly emits a
 * pattern flag's value as a path candidate (#823).
 */
function collectEmbeddedOptionValues(
  node: TSNode,
  effect: TokenEffect,
): PathToken[] {
  const values: PathToken[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === "command_name" || child.type === "variable_assignment")
      continue;
    if (!ARG_NODE_TYPES.has(child.type)) continue;

    const value = OPTION_VALUE_PATTERN.exec(resolveNodeText(child))?.[1];
    if (value !== undefined) values.push({ token: value, effect });
  }
  return values;
}

/** The value embedded in a single `--opt=value` token, if it carries one. */
function embeddedOptionValueToken(
  text: string,
  effect: TokenEffect,
): PathToken[] {
  const value = OPTION_VALUE_PATTERN.exec(text)?.[1];
  return value === undefined ? [] : [{ token: value, effect }];
}

/**
 * What a recognized flag's argument is, for the pattern-first walker.
 *
 * `script` and `script-file` mark the inline pattern positional as already
 * supplied; `value` and `suffix` do not. Only `script-file` contributes a path
 * candidate — the others name a pattern, a count, or a backup suffix.
 */
type PatternFlagRole =
  /** Supplies the pattern/script inline (`grep -e`, `sed --expression`). */
  | "script"
  /** Supplies the pattern/script from a file (`grep -f`, `sed --file`). */
  | "script-file"
  /** Consumes a value that is neither pattern nor path (`grep -A`, `rg -g`). */
  | "value"
  /**
   * Consumes the following argument only when it is empty.
   *
   * BSD `sed` requires a separate suffix argument (`sed -i '' 's/a/b/' f`)
   * while GNU `sed` requires it glued (`-i`, `-i.bak`). Consuming
   * unconditionally is right for one and eats the *script* on the other,
   * leaving the file operand to be skipped as the inline pattern — a write
   * target that reaches no path surface. The argument's own emptiness decides
   * it, so the walk needs no knowledge of which sed is installed (#823).
   *
   * BSD also accepts a separate *non-empty* suffix (`sed -i bak 's/a/b/' f`),
   * which this rule declines: the suffix then spends the pattern positional
   * and the script surfaces as a candidate. The file operand still survives,
   * so the residual is on ADR 0009's recoverable side.
   */
  | "suffix"
  /**
   * Recognized, but whose arity depends on which implementation the command's
   * *name* resolves to — so it takes neither the following argument nor the
   * pattern positional.
   *
   * `awk` is GNU awk on Fedora/RHEL, where `--file prog.awk` reads `prog.awk`,
   * and one-true-awk or mawk elsewhere, where the long option is ignored
   * outright and `prog.awk` is the program *text*. Asserting either arity
   * drops a real operand on the other family, and the projection cannot see
   * which binary the name will reach. Claiming neither over-surfaces on both
   * — the recoverable direction — and the extra token names nothing, so the
   * existence probe discards it. Prefer a precise role wherever the name does
   * fix the parser: `gawk` gets the real ones (#823).
   */
  | "unknown-arity";

interface PatternCommandConfig {
  /** Recognized flag spellings, short and long, mapped to their roles. */
  readonly flags: ReadonlyMap<string, PatternFlagRole>;
  /**
   * Number of leading positional arguments that are patterns/scripts, not paths.
   * Default: 1 (covers sed, awk, grep, rg).
   * sd uses 2 (FIND and REPLACE_WITH are both non-path positionals).
   */
  readonly patternPositionals?: number;
}

const GREP_FLAGS = new Map<string, PatternFlagRole>([
  ["-e", "script"],
  ["--regexp", "script"],
  ["-f", "script-file"],
  ["--file", "script-file"],
  ["-A", "value"],
  ["--after-context", "value"],
  ["-B", "value"],
  ["--before-context", "value"],
  ["-C", "value"],
  // `--context` is deliberately absent, though `-C` is present and `rg` lists
  // the long form below. grep parses with getopt, which declares `context`
  // with an *optional* argument (`-C[NUM]`'s history), and a long option
  // declared that way never takes a separate `argv`: `grep --context 2 pat f`
  // searches for `2` in the files `pat` and `f`. Listing it would consume the
  // `2`, leaving `pat` — a real file operand — to be skipped as the inline
  // pattern. Its absence costs only a bare `2` token from `--context=2`, which
  // names nothing and the existence probe drops (#823).
  ["-m", "value"],
  ["--max-count", "value"],
]);

const SED_CONFIG: PatternCommandConfig = {
  flags: new Map<string, PatternFlagRole>([
    ["-e", "script"],
    ["--expression", "script"],
    ["-f", "script-file"],
    ["--file", "script-file"],
    ["-i", "suffix"],
  ]),
};

/**
 * The short flags are POSIX and consume on every awk; the GNU long forms are
 * `unknown-arity` because the bare name does not fix the parser.
 *
 * `awk` is GNU awk on Fedora/RHEL, where `--file prog.awk` reads `prog.awk`,
 * and one-true-awk or mawk on macOS and Debian/Ubuntu, where the long option
 * is ignored outright (`awk: unknown option --field-separator ignored`) and
 * the following words are the program text and its input files. Asserting
 * either arity drops a real operand on the other family, so the table asserts
 * neither. `nawk` shares this for the same reason (#823).
 */
const AWK_CONFIG: PatternCommandConfig = {
  flags: new Map<string, PatternFlagRole>([
    ["-e", "script"],
    ["-f", "script-file"],
    ["-F", "value"],
    ["-v", "value"],
    ["--source", "unknown-arity"],
    ["--file", "unknown-arity"],
    ["--field-separator", "unknown-arity"],
    ["--assign", "unknown-arity"],
  ]),
};

/** `gawk` names GNU awk outright, so its long forms carry their real roles. */
const GAWK_CONFIG: PatternCommandConfig = {
  flags: new Map<string, PatternFlagRole>([
    ...AWK_CONFIG.flags,
    ["--source", "script"],
    ["--file", "script-file"],
    ["--field-separator", "value"],
    ["--assign", "value"],
  ]),
};

const GREP_CONFIG: PatternCommandConfig = { flags: GREP_FLAGS };

const RG_CONFIG: PatternCommandConfig = {
  flags: new Map<string, PatternFlagRole>([
    ...GREP_FLAGS,
    // rg parses with clap rather than getopt, where `--context` takes a
    // required argument, so its separated spelling really does consume:
    // `rg --context 2 pat f` searches for `pat` in `f`. Same spelling as
    // grep's, opposite arity — which is why it is listed per tool rather than
    // shared above (#823).
    ["--context", "value"],
    ["-g", "value"],
    ["--glob", "value"],
    ["-t", "value"],
    ["--type", "value"],
    ["-T", "value"],
    ["--type-not", "value"],
    ["-j", "value"],
    ["--threads", "value"],
    ["-M", "value"],
    ["--max-columns", "value"],
    ["-r", "value"],
    ["--replace", "value"],
    ["-E", "value"],
    ["--encoding", "value"],
  ]),
};

const SD_CONFIG: PatternCommandConfig = {
  flags: new Map<string, PatternFlagRole>([
    ["-f", "value"],
    ["--flags", "value"],
    ["-n", "value"],
    ["--max-replacements", "value"],
  ]),
  patternPositionals: 2,
};

/**
 * Commands whose first N positional arguments are inline patterns/scripts,
 * not filesystem paths. The map stores per-command flag configuration so
 * the walker can correctly identify which arguments are consumed by flags
 * vs. which are positional.
 *
 * Names share a configuration object only when they share a *parser*, which is
 * narrower than being aliases: `egrep`/`fgrep` are the same binary as `grep`
 * here, and `nawk` is one-true-awk like `awk` — but `gawk` has its own config,
 * because it is the only one of the three that certainly means GNU awk and so
 * the only one whose long options certainly consume (#823).
 */
const PATTERN_FIRST_COMMANDS: ReadonlyMap<string, PatternCommandConfig> =
  new Map([
    ["sed", SED_CONFIG],
    ["awk", AWK_CONFIG],
    ["gawk", GAWK_CONFIG],
    ["nawk", AWK_CONFIG],
    ["grep", GREP_CONFIG],
    ["egrep", GREP_CONFIG],
    ["fgrep", GREP_CONFIG],
    ["rg", RG_CONFIG],
    ["sd", SD_CONFIG],
  ]);

/**
 * Describes what the walker should do when it encounters a flag word inside
 * a pattern-first command.  Using a discriminated union lets the `switch` in
 * `collectPatternCommandTokens` narrow the flag's role without a non-null
 * assertion (which would trigger the Biome/ESLint assertion conflict).
 */
type PatternCommandFlagDirective =
  | { kind: "end-of-flags" }
  | { kind: "regular-flag" }
  /** A recognized flag whose value is the argument that follows it. */
  | { kind: "consume-next"; role: PatternFlagRole }
  /** A recognized flag carrying its value in the same token. */
  | { kind: "inline-value"; role: PatternFlagRole; value: string };

/** A long option carrying its value inline: `--name=value`. */
const LONG_OPTION_VALUE_PATTERN = /^(--[^=\s]+)=(.+)$/;

/**
 * Classify a flag word from a pattern-first command into a directive that
 * tells the walker how to handle the flag and its value.
 *
 * Matched in the order the tools accept: the exact spelling (short or long),
 * then a long option's `=`-embedded value, then a glued short value. The glued
 * form matches only the **first** short flag, which is getopt's own rule —
 * `grep -ei pattern` really is `-e` with the value `i`. A cluster whose
 * argument-taking flag is not first (`grep -ie pattern`) therefore stays a
 * plain flag, which over-surfaces the pattern rather than dropping the
 * command's operand (ADR 0009's recoverable direction).
 */
function classifyPatternCommandFlag(
  text: string,
  config: PatternCommandConfig,
): PatternCommandFlagDirective {
  if (text === "--") return { kind: "end-of-flags" };

  const exact = config.flags.get(text);
  if (exact) return { kind: "consume-next", role: exact };

  const longOption = LONG_OPTION_VALUE_PATTERN.exec(text);
  if (longOption) {
    const [, name, value] = longOption;
    const role = config.flags.get(name);
    return role === undefined
      ? { kind: "regular-flag" }
      : { kind: "inline-value", role, value };
  }

  if (!text.startsWith("--") && text.length > 2) {
    const role = config.flags.get(text.slice(0, 2));
    if (role) return { kind: "inline-value", role, value: text.slice(2) };
  }
  return { kind: "regular-flag" };
}

/**
 * Collect path-candidate tokens from a command known to have
 * pattern/script arguments in leading positional slots.
 *
 * Uses position-based skipping: the first N positional arguments
 * (where N = patternPositionals, default 1) are assumed to be
 * inline patterns/scripts and are skipped. Remaining positional
 * arguments are collected as path candidates.
 *
 * A recognized flag's role (see {@link PatternFlagRole}) decides three things
 * at once: whether the pattern positional is still expected, whether the
 * flag's value is a path candidate, and — for `suffix` — whether the
 * following argument belongs to the flag at all. The `=`-embedded and glued
 * spellings carry the value in the flag's own token, so the walker splits it
 * here rather than letting {@link collectEmbeddedOptionValues} emit a
 * pattern's text as a path (#823).
 */
function collectPatternCommandTokens(
  node: TSNode,
  config: PatternCommandConfig,
  effect: TokenEffect,
): PathToken[] {
  const patternPositionals = config.patternPositionals ?? 1;
  let hasExplicitScript = false;
  let positionalsSeen = 0;
  let pendingConsumption: PatternFlagRole | null = null;
  let pastEndOfFlags = false;
  const tokens: PathToken[] = [];

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (COMMAND_PREFIX_TYPES.has(child.type)) {
      // Supplies no operand of its own, but may host one that really runs.
      tokens.push(...collectHostedExecutionTokens(child));
      continue;
    }

    const isArgNode = ARG_NODE_TYPES.has(child.type);
    const text = resolveNodeText(child);

    // Handle the argument a previous flag consumed. The consumption discharges
    // on whatever node type follows, not only on an ARG_NODE_TYPES one: a bare
    // number (`-A 3`), an expansion (`-A $N`), and a substitution
    // (`-A $(echo 3)`) are all this flag's argument, and carrying the pending
    // skip past them lands it on the *pattern* — shifting the positional count
    // by one and eating the command's real file operand (#823).
    if (pendingConsumption !== null) {
      const consumption = pendingConsumption;
      pendingConsumption = null;
      if (!isArgNode) {
        // Contributes no operand text of its own, but may host a nested
        // execution whose operands are candidates (#741).
        tokens.push(...collectPathCandidateTokens(child));
        continue;
      }
      const discharge = dischargePendingConsumption(consumption, text, effect);
      if (discharge.token) tokens.push(discharge.token);
      if (discharge.consumed) continue;
    }

    // A node outside ARG_NODE_TYPES is still one word the shell passes as an
    // argument (`grep 42 f`, `grep $PATTERN f`, `grep $(cmd) f`), so it spends
    // a pattern positional even though no reliable operand text can be read
    // from it. Counting only argument nodes left a numeric or computed pattern
    // unseen, so the slot was spent on the command's real operand instead and
    // the operand reached no path surface (#823).
    //
    // A redirect hosted on the command node is not an argument and is excluded;
    // counting it would push the real pattern out as an operand token. The
    // exclusion is the narrow side on purpose: miscounting an argument as a
    // redirect drops an operand, while the reverse only over-surfaces.
    if (!isArgNode) {
      if (
        !EXECUTION_HOST_TYPES.has(child.type) &&
        !hasExplicitScript &&
        positionalsSeen < patternPositionals
      ) {
        positionalsSeen++;
      }
      // Recurse for nested commands (e.g. command_substitution).
      tokens.push(...collectPathCandidateTokens(child));
      continue;
    }

    // Flag detection (only before "--" end-of-flags marker).
    if (
      !pastEndOfFlags &&
      child.type === "word" &&
      text.startsWith("-") &&
      text.length > 1
    ) {
      const directive = classifyPatternCommandFlag(text, config);
      switch (directive.kind) {
        case "end-of-flags":
          pastEndOfFlags = true;
          break;
        case "consume-next":
          pendingConsumption = directive.role;
          if (suppliesScript(directive.role)) hasExplicitScript = true;
          break;
        case "inline-value":
          if (directive.role === "script-file")
            tokens.push({ token: directive.value, effect });
          if (suppliesScript(directive.role)) hasExplicitScript = true;
          break;
        case "regular-flag":
          // Unrecognized: fall back to the blind `--opt=value` split, which is
          // safe precisely because the flag's role is unknown (#645).
          tokens.push(...embeddedOptionValueToken(text, effect));
          break;
      }
      continue;
    }

    // Positional argument.
    if (!hasExplicitScript && positionalsSeen < patternPositionals) {
      positionalsSeen++; // Skip: this is an inline pattern/script.
    } else {
      tokens.push({ token: text, effect });
    }
    // A quoted flag never reaches the flag branch above, so its embedded value
    // is split here instead.
    tokens.push(...embeddedOptionValueToken(text, effect));
  }

  return tokens;
}

/**
 * Whether a flag in this role means the inline pattern positional is spent.
 *
 * `unknown-arity` says so for the opposite reason to the others: not because
 * the script was supplied, but because the walker cannot tell which word the
 * script is, and skipping the wrong one drops a real operand.
 */
function suppliesScript(role: PatternFlagRole): boolean {
  return (
    role === "script" || role === "script-file" || role === "unknown-arity"
  );
}

/**
 * What a pending flag consumption made of the argument node that followed it.
 *
 * `consumed` is the flag's own verdict, not the walker's: a `suffix` flag
 * declines a non-empty argument, which the walker then reads as an ordinary
 * argument.
 */
interface ConsumptionDischarge {
  readonly consumed: boolean;
  /** The path candidate the consumed argument contributes, if any. */
  readonly token?: PathToken;
}

/** Apply a pending consumption to the argument text that follows its flag. */
function dischargePendingConsumption(
  role: PatternFlagRole,
  text: string,
  effect: TokenEffect,
): ConsumptionDischarge {
  switch (role) {
    case "script-file":
      return { consumed: true, token: { token: text, effect } };
    case "script":
    case "value":
      return { consumed: true };
    case "suffix":
      return { consumed: text === "" };
    case "unknown-arity":
      return { consumed: false };
  }
}

/**
 * Collect all argument tokens from a generic (non-pattern-first) command node,
 * skipping the command name and variable assignments.
 */
function collectGenericCommandTokens(
  node: TSNode,
  effect: TokenEffect,
): PathToken[] {
  const tokens: PathToken[] = [];
  let seenCommandName = false;

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (COMMAND_PREFIX_TYPES.has(child.type)) {
      // Supplies no operand of its own, but may host one that really runs.
      if (child.type === "command_name") seenCommandName = true;
      tokens.push(...collectHostedExecutionTokens(child));
      continue;
    }

    // If there was no explicit command_name node, the first word-like
    // child is the command name itself — skip it.
    if (!seenCommandName && ARG_NODE_TYPES.has(child.type)) {
      seenCommandName = true;
      continue;
    }

    // Argument nodes: resolve their text and collect.
    if (ARG_NODE_TYPES.has(child.type)) {
      tokens.push({ token: resolveNodeText(child), effect });
      continue;
    }

    // Recurse into other children (e.g. command_substitution nested in args)
    tokens.push(...collectPathCandidateTokens(child));
  }

  return tokens;
}
