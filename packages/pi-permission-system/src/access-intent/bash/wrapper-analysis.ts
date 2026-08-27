/**
 * Wrapper interpretation for a bash command unit: what kind of wrapper it is,
 * what it actually runs, and whether its floor still has a reason to hold.
 *
 * Pure and word-based; the AST walk that produces the words lives in
 * `command-enumeration.ts`. The three questions live here together
 * deliberately: the shape that floors a unit to `ask`, the shape that names its
 * inner command, and the shape that exempts it must agree, and separate
 * classifiers over the same vocabulary would drift.
 */

import { proveCommandEffect } from "#src/access-intent/bash/command-effects";

/** One word of a command unit: its text, and its offset into the unit's text. */
export interface CommandWord {
  readonly text: string;
  readonly offset: number;
}

/**
 * Why a command unit's decision is floored to at least `ask`.
 * `"opaque-payload"` — an inline-shell payload (`bash -c`/`eval`) whose inner
 * program is not re-parsed (#481).
 * `"indirection"` — a prefix/exec wrapper (`sudo`/`env`/`xargs`/`find -exec`/…)
 * whose inner command is a visible argument but is not gated on its own (#490).
 * The kind selects the audit sentinel; both floor identically.
 */
export type WrapperKind = "opaque-payload" | "indirection";

/**
 * Why an indirection wrapper's floor does not apply after all (#803).
 *
 * `"core-reader"` — the command the wrapper runs is in the built-in pure-reader
 * core, so it is read-only for any argument feed.
 *
 * A named reason rather than a boolean, so the review log states *why* a
 * wrapper was let through, and so a later source (a chain verdict, a user
 * declaration) is an added member rather than a second flag. ADR 0013 §11
 * keeps v1 at the audited core alone.
 */
export type FloorExemption = "core-reader";

/**
 * Classify a command unit's words as a floored wrapper, or `undefined` for an
 * ordinary command. `words[0]` is the command name; a leading
 * `variable_assignment` prefix is already stripped by the caller. The command
 * name is matched on its basename, so `/bin/bash -c …` counts.
 *
 * `"opaque-payload"`: `eval`, or a shell (`bash`/`sh`/`dash`/`zsh`/`ksh`) with a
 * `-c` short-flag cluster (`-c`, `-ec`, `-xc`) — the inner program is a quoted
 * argument the enumerator does not re-parse (#481).
 *
 * `"indirection"`: an always-invoking prefix/exec wrapper
 * ({@link INDIRECTION_WRAPPER_NAMES}), or a search tool
 * ({@link EXEC_CONDITIONAL_WRAPPERS}, `find`/`fd`) carrying a per-result exec
 * flag — the inner command is a visible argument that a `<cmd> *` rule would
 * otherwise never match (#490). A bare `find`/`fd` search runs no subcommand and
 * is not flagged.
 */
export function classifyWrapperWords(
  words: readonly CommandWord[],
): WrapperKind | undefined {
  const commandName = wrapperName(words);
  if (commandName === undefined) return undefined;
  const args = words.slice(1).map((word) => word.text);
  if (commandName === "eval") return "opaque-payload";
  if (SHELL_WRAPPER_NAMES.has(commandName) && hasShortFlagC(args)) {
    return "opaque-payload";
  }
  if (INDIRECTION_WRAPPER_NAMES.has(commandName)) return "indirection";
  if (execFlagIndex(commandName, args) !== -1) return "indirection";
  return undefined;
}

// ── Wrapper vocabulary ───────────────────────────────────────────────────────

/**
 * The command a wrapper unit actually runs, or `null` when it cannot be
 * established or adds nothing over the unit itself.
 *
 * Display-only (ADR 0011 §3.5, #713): the result names what runs, including
 * the payload of an inline shell, so it deliberately looks *past* a `sh -c`
 * layer that the gate must not look past. Because it is shown on a decision
 * surface, the rule is to fail to `null` rather than to a guess — an
 * unrecognized option shape yields nothing rather than a remainder that might
 * name the wrong command.
 *
 * Nested wrappers unwrap to the innermost command (`sudo timeout 5 xargs grep
 * foo` → `grep foo`), bounded by {@link MAX_UNWRAP_DEPTH}.
 */
export function executedUnitOf(
  unitText: string,
  words: readonly CommandWord[],
): string | null {
  const unwrapped = unwrapIndirection(words, unitText);
  const text = unwrapped.kind === "opaque" ? unwrapped.payload : unwrapped.text;
  return nothingNew(text, unitText);
}

/**
 * True when a wrapper unit's floor has no reason left to hold: the command it
 * runs is in the pure-reader core, so its *direction* is provable however
 * unknown its argument feed is (ADR 0013 §11, #803).
 *
 * The floor exists because a wrapper hides the command that should be gated,
 * and the unknowability it guards is unknowability of scope — which stays the
 * projection's and the path surfaces' job, for wrapped and unwrapped commands
 * alike. Argument-independence is the core's admission bar, so there are no
 * arguments that make `grep` write a file.
 *
 * Four things must hold, and each is a way the reason could still hold:
 *
 * 1. The unit is an indirection wrapper — an ordinary command has no floor.
 * 2. Unwrapping reached the inner command without passing through an opaque
 *    payload. `sh -c '…'` carries an unparsed program whose first word says
 *    nothing about the rest of it, which is why this cannot consult
 *    {@link executedUnitOf}'s string.
 * 3. The inner command *proves* a read — bare-basename core word, retraction
 *    guards applied, so `xargs sort -o /tmp/x` and `xargs find . -delete` are
 *    not transparent.
 * 4. The unit writes no file through a redirect, which the caller reads off
 *    the parse tree and this module never sees.
 */
export function isTransparentWrapper(
  words: readonly CommandWord[],
  statement: { readonly writesViaRedirect: boolean },
): boolean {
  if (statement.writesViaRedirect) return false;
  if (classifyWrapperWords(words) !== "indirection") return false;

  // Only the peeled words matter here, so the walk is handed no source span to
  // cut from — the text slice is `executedUnitOf`'s product, not this one's.
  const unwrapped = unwrapIndirection(words, "");
  if (unwrapped.kind === "opaque" || unwrapped.layers === 0) return false;

  const head = unwrapped.words.at(0)?.text ?? "";
  const args = unwrapped.words.slice(1).map((word) => word.text);
  return proveCommandEffect(head, args).effect === "read";
}

// ── Unwrapping ───────────────────────────────────────────────────────────────

/**
 * How an unwrap ended: at the innermost command reachable by peeling
 * indirection layers, or at an inline-shell payload.
 *
 * The two are kept apart because they are different kinds of answer. A peeled
 * result is a slice of this command line, with words the caller can inspect;
 * a payload is an inner *program* the enumerator never parsed, so it has text
 * and nothing else. Collapsing them is how a core-looking first word inside
 * `sh -c '…'` would come to stand for the whole payload (#803).
 */
type UnwrapResult =
  | { readonly kind: "opaque"; readonly payload: string | null }
  | {
      readonly kind: "peeled";
      readonly text: string;
      readonly words: readonly CommandWord[];
      /** How many indirection layers came off; `0` means none did. */
      readonly layers: number;
    };

/**
 * Peel indirection layers off a command unit until an ordinary command, an
 * opaque payload, or an unrecognized option shape stops the walk.
 *
 * Stopping early is not an error: the words peeled so far are returned, and
 * each caller decides what an incomplete peel is worth — `executedUnitOf`
 * shows it, {@link isTransparentWrapper} declines it because the head word it
 * would judge is the wrapper's own.
 *
 * `unitText` is the span the peeled `text` is cut from; a caller that wants
 * only the words passes the empty string and ignores it.
 */
function unwrapIndirection(
  words: readonly CommandWord[],
  unitText: string,
): UnwrapResult {
  let text = unitText;
  let current = words;
  let layers = 0;

  for (let depth = 0; depth < MAX_UNWRAP_DEPTH; depth++) {
    const kind = classifyWrapperWords(current);
    if (kind === undefined) break;

    if (kind === "opaque-payload") {
      // The payload is an inner *program*, not a slice of this command line, so
      // it is unquoted and terminal — unwrapping it further would need a parse.
      return { kind: "opaque", payload: opaquePayload(current) };
    }

    const start = innerCommandIndex(current);
    if (start === -1 || start >= current.length) break;
    const end = execTerminatorIndex(current, start);
    text = sliceWords(text, current, start, end).trimEnd();
    current = rebase(current, start, end);
    layers++;
  }

  return { kind: "peeled", text, words: current, layers };
}

/** How many wrapper layers to unwrap before giving up. */
const MAX_UNWRAP_DEPTH = 4;

/**
 * The extracted text, or `null` when it establishes nothing new — it is absent
 * or empty, it still begins with an option (so the inner command was never
 * reached), or it simply repeats the unit.
 */
function nothingNew(text: string | null, unitText: string): string | null {
  if (text === null || text === "" || text === unitText) return null;
  return text.startsWith("-") ? null : text;
}

/** The inline-shell payload argument, unquoted; `null` when absent. */
function opaquePayload(words: readonly CommandWord[]): string | null {
  const args = words.slice(1);
  // `eval` takes its program as the first argument (no `-c`, so the index is
  // -1); a shell takes it after the `-c` cluster.
  const flagIndex = shortFlagCIndex(args.map((word) => word.text));
  const payload = args[flagIndex + 1] as CommandWord | undefined;
  return payload === undefined ? null : unquote(payload.text);
}

/** Strip one matching pair of surrounding quotes. */
function unquote(text: string): string {
  const first = text.at(0);
  const quoted =
    (first === "'" || first === '"') &&
    text.length >= 2 &&
    text.endsWith(first);
  return quoted ? text.slice(1, -1) : text;
}

/**
 * Index of the word beginning the inner command, or `-1` when the wrapper's own
 * options run out first.
 *
 * Skips the wrapper name, environment assignments, options (consuming a
 * following value for the options in {@link VALUE_TAKING_FLAGS}), and a leading
 * operand for the wrappers that take one. An exec-conditional wrapper instead
 * starts immediately after its exec flag.
 */
function innerCommandIndex(words: readonly CommandWord[]): number {
  const name = wrapperName(words);
  if (name === undefined) return -1;

  const argTexts = words.slice(1).map((word) => word.text);
  const execFlag = execFlagIndex(name, argTexts);
  if (execFlag !== -1) return execFlag + 2;

  const valueTaking = VALUE_TAKING_FLAGS.get(name) ?? EMPTY_FLAGS;
  let operandPending = LEADING_OPERAND_WRAPPERS.has(name);
  let index = 1;

  while (index < words.length) {
    const word = words[index].text;
    if (word === "--") return index + 1;
    if (isEnvironmentAssignment(word)) {
      index++;
      continue;
    }
    if (word.startsWith("-")) {
      index += valueTaking.has(word) ? 2 : 1;
      continue;
    }
    if (operandPending) {
      operandPending = false;
      index++;
      continue;
    }
    return index;
  }
  return -1;
}

/**
 * Index of an exec wrapper's `;`/`+` terminator, or `words.length` — the
 * terminator belongs to `find`, not to the command it runs.
 */
function execTerminatorIndex(
  words: readonly CommandWord[],
  start: number,
): number {
  const terminator = words.findIndex(
    (word, index) =>
      index >= start && EXEC_TERMINATORS.has(word.text.replace(/^\\/, "")),
  );
  return terminator === -1 ? words.length : terminator;
}

/** The unit text spanned by `words[start..end)`. */
function sliceWords(
  unitText: string,
  words: readonly CommandWord[],
  start: number,
  end: number,
): string {
  const from = words[start].offset;
  return end < words.length
    ? unitText.slice(from, words[end].offset)
    : unitText.slice(from);
}

/** `words[start..end)` with offsets rebased onto the sliced text. */
function rebase(
  words: readonly CommandWord[],
  start: number,
  end: number,
): CommandWord[] {
  const origin = words[start].offset;
  return words
    .slice(start, end)
    .map((word) => ({ text: word.text, offset: word.offset - origin }));
}

/** True for a `NAME=value` environment prefix. */
function isEnvironmentAssignment(word: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);
}

/**
 * Shell command names whose `-c` flag introduces an opaque inline program.
 */
const SHELL_WRAPPER_NAMES = new Set(["bash", "sh", "dash", "zsh", "ksh"]);

/**
 * Indirection wrappers that always invoke a following command, so the wrapper
 * (not the inner command) is what a bash rule matches. Floored by command-name
 * basename alone. Extend this set to cover another always-invoking wrapper.
 */
const INDIRECTION_WRAPPER_NAMES = new Set([
  "sudo",
  "env",
  "xargs",
  "time",
  "nohup",
  "timeout",
  "nice",
  // Exec-capable rewrites and prefix wrappers surveyed in #575: parallelizers
  // (parallel/rust-parallel/rush), a sudo rewrite (doas), and prefix wrappers
  // (setsid/stdbuf/watch/flock) that all always invoke a following command.
  "parallel",
  "rust-parallel",
  "rush",
  "doas",
  "setsid",
  "stdbuf",
  "watch",
  "flock",
]);

/**
 * Search tools that invoke a command per result only when an exec flag is
 * present; a bare search runs no subcommand. Floored only when an argument
 * exactly matches one of the tool's exec flags. Extend by adding a tool with
 * its exec-flag set.
 */
const EXEC_CONDITIONAL_WRAPPERS = new Map<string, ReadonlySet<string>>([
  ["find", new Set(["-exec", "-execdir", "-ok", "-okdir"])],
  ["fd", new Set(["-x", "--exec", "-X", "--exec-batch"])],
]);

/**
 * Curated per-wrapper options that consume the following word, so skipping a
 * wrapper's own arguments does not mistake an option's value for the inner
 * command. Attached forms (`-I{}`, `--user=root`) need no entry — they are one
 * word. Only the display-side extraction reads this, and a missing or wrong
 * entry yields `null` (see {@link executedUnitOf}), never a weaker gate.
 */
const VALUE_TAKING_FLAGS = new Map<string, ReadonlySet<string>>([
  ["sudo", new Set(["-u", "-g", "-p", "-C", "-h", "-U", "-r", "-t"])],
  ["doas", new Set(["-u", "-C"])],
  ["env", new Set(["-u", "-C", "--unset", "--chdir"])],
  [
    "xargs",
    new Set(["-n", "-P", "-I", "-i", "-d", "-E", "-L", "-l", "-s", "-a"]),
  ],
  ["timeout", new Set(["-s", "-k", "--signal", "--kill-after"])],
  ["nice", new Set(["-n", "--adjustment"])],
  ["time", new Set(["-o", "-f", "--output", "--format"])],
  ["stdbuf", new Set(["-i", "-o", "-e", "--input", "--output", "--error"])],
  ["watch", new Set(["-n", "--interval"])],
  ["flock", new Set(["-w", "-E", "--timeout", "--conflict-exit-code"])],
]);

const EMPTY_FLAGS: ReadonlySet<string> = new Set<string>();

/**
 * Wrappers whose first bare word is an operand (a duration, a lock file) rather
 * than the start of the inner command.
 */
const LEADING_OPERAND_WRAPPERS = new Set(["timeout", "flock"]);

/** Words ending a `find -exec` clause; they belong to `find`, not its command. */
const EXEC_TERMINATORS = new Set([";", "+"]);

// ── Shared helpers ───────────────────────────────────────────────────────────

/** The wrapper's command-name basename, or `undefined` for an empty unit. */
function wrapperName(words: readonly CommandWord[]): string | undefined {
  return words.length === 0 ? undefined : basename(words[0].text);
}

/**
 * True when an argument list has a short-flag cluster containing `c` before any
 * `--` end-of-options marker (`-c`, `-ec`, `-xc`) — the inline-shell payload
 * flag for `bash`/`sh`/`dash`/`zsh`/`ksh`.
 */
function hasShortFlagC(args: readonly string[]): boolean {
  return shortFlagCIndex(args) !== -1;
}

/** Index within `args` of the `-c` short-flag cluster, or `-1`. */
function shortFlagCIndex(args: readonly string[]): number {
  for (const [index, arg] of args.entries()) {
    if (arg === "--") return -1;
    if (arg.startsWith("-") && !arg.startsWith("--") && arg.includes("c")) {
      return index;
    }
  }
  return -1;
}

/** Index within `args` of a matched per-result exec flag, or `-1`. */
function execFlagIndex(commandName: string, args: readonly string[]): number {
  const execFlags = EXEC_CONDITIONAL_WRAPPERS.get(commandName);
  if (!execFlags) return -1;
  return args.findIndex((arg) => execFlags.has(arg));
}

/** The final path segment of a command name (`/bin/bash` → `bash`). */
function basename(name: string): string {
  const slash = name.lastIndexOf("/");
  return slash === -1 ? name : name.slice(slash + 1);
}
