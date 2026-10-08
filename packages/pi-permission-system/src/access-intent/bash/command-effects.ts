import { type TokenEffect, UNPROVEN_EFFECT } from "#src/access-intent/effect";
import { awkWithdrawsReadClaim } from "./awk-invocation";
import type { ArgWord } from "./node-text";
import { sedWithdrawsReadClaim } from "./sed-invocation";

// ── Public surface ─────────────────────────────────────────────────────────

/**
 * The effect a command's head word proves for the path tokens that command
 * owns, from the built-in pure-reader core (ADR 0013 §7).
 *
 * A word is core only as a **bare basename**: `./grep` and `/tmp/evil/grep`
 * prove nothing, because a path-qualified head word names a program the core's
 * audit never saw. Rejecting on the separator characters directly — rather
 * than asking a `PathFlavor` — keeps the rule fail-closed on both platforms
 * without reading the host's path language.
 *
 * A guarded word's claim is withdrawn when an argument names one of its
 * write-capable options, or is computed and may arrive as one, yielding `retracted` rather than a write: the command
 * may still only read, so the fail-closed base case is the honest answer and
 * `retracted` is the blame line that says why.
 *
 * Pure and word-based by design — the AST walk that produces the words lives
 * in `token-collection.ts`, the same split `wrapper-analysis.ts` documents.
 */
export function proveCommandEffect(
  headWord: string,
  argWords: readonly ArgWord[],
): TokenEffect {
  if (!isBareCoreWord(headWord)) return UNPROVEN_EFFECT;
  const withdrawsClaim = RETRACTION_GUARDS.get(headWord);
  if (withdrawsClaim?.(argWords)) return RETRACTED_EFFECT;
  return CORE_READ_EFFECT;
}

/**
 * The pure-reader core: the command words that are read-only for any
 * arguments, in any implementation.
 *
 * Exported so `docs/configuration.md`'s published roster is held to it by a
 * parity test — a listed roster drifts from the code otherwise.
 */
export const PURE_READER_CORE: ReadonlySet<string> = new Set(
  coreAdmissions().flatMap(({ words }) => words),
);

/**
 * The effect a redirect operator proves for its destination token, or `null`
 * when the redirect names no file at all and no token should be collected.
 *
 * The operator is the whole proof: `> out.txt` writes `out.txt` whatever the
 * command in front of it does, and `< in.txt` reads it. A syntax proof is
 * therefore absolute — it is applied to the destination after the owning
 * command's attribution and is never retracted by it.
 *
 * `>&` and `<&` are the two operators that may name either a file descriptor
 * (`2>&1`, a duplication that touches no file) or a real file (`cmd >& out`).
 * `destinationIsDescriptor` is the parse-tree fact that tells them apart; the
 * `null` it produces is what keeps `2>&1`'s `1` out of the path surface.
 *
 * An operator outside the table proves nothing rather than dropping the token:
 * dropping it would remove a path from the gates entirely, which is the one
 * fail-open direction available here.
 */
export function redirectDestinationEffect(
  operator: string,
  destinationIsDescriptor: boolean,
): TokenEffect | null {
  if (DESCRIPTOR_CAPABLE_OPERATORS.has(operator)) {
    if (destinationIsDescriptor) return null;
    return operator === ">&" ? SYNTAX_WRITE_EFFECT : SYNTAX_READ_EFFECT;
  }
  if (OUTPUT_REDIRECT_OPERATORS.has(operator)) return SYNTAX_WRITE_EFFECT;
  if (INPUT_REDIRECT_OPERATORS.has(operator)) return SYNTAX_READ_EFFECT;
  return UNPROVEN_EFFECT;
}

// ── The redirect operator table ────────────────────────────────────────────

/** Operators whose destination the shell truncates, appends to, or creates. */
const OUTPUT_REDIRECT_OPERATORS: ReadonlySet<string> = new Set([
  ">",
  ">>",
  ">|",
  "&>",
  "&>>",
]);

/**
 * Operators whose destination the shell reads.
 *
 * `<<<` is a herestring, whose `herestring_redirect` node carries the same
 * shape; its destination is a literal rather than a file in practice, and
 * reading it proves no more than a read either way.
 */
const INPUT_REDIRECT_OPERATORS: ReadonlySet<string> = new Set(["<", "<<<"]);

/** The two operators that may duplicate a descriptor instead of naming a file. */
const DESCRIPTOR_CAPABLE_OPERATORS: ReadonlySet<string> = new Set([">&", "<&"]);

// ── The roster ─────────────────────────────────────────────────────────────

/** A group of core words admitted for one shared structural reason. */
interface CoreAdmission {
  readonly words: readonly string[];
  /** Why the group clears the bar — the audit, kept beside what it admits. */
  readonly reason: string;
}

/**
 * The roster, grouped by admission reason.
 *
 * The bar is **structural**, never popularity: implementation-independent
 * read-only-ness across GNU and BSD alike, no option that redirects output to
 * a file, and effects stable under argument content. A word that fails any of
 * the three is excluded even when it is overwhelmingly used to read.
 *
 * Deliberately excluded, so the audit is auditable:
 *
 * | Word                                            | Why not                                                        |
 * | ----------------------------------------------- | -------------------------------------------------------------- |
 * | `gawk`, `nawk`                                  | Their own dialects' options are unaudited; `awk` is guarded instead |
 * | `uniq`                                          | `uniq IN OUT` writes its second positional                     |
 * | `tee`, `dd`, `split`, `csplit`, `xxd`, `tree`, `curl`, `wget` | Each has a positional or option that writes a file |
 * | `less`, `more`                                  | Interactive shell escape (`!cmd`) and `LESSOPEN` preprocessing |
 * | `file`                                          | `-C`/`--compile` writes a `magic.mgc` file — it reports on its arguments, but not only |
 * | `git`, `pnpm`, `npm`, `node`, `python3`, `gh`   | Subcommand- and argument-dependent — the `commandEffects` long tail |
 *
 * Widening the roster only ever loosens, so evidence can add a word as a
 * non-breaking change; a wrong admission is a fail-open, which is why the bar
 * is stated rather than assumed.
 */
function coreAdmissions(): readonly CoreAdmission[] {
  return [
    {
      words: ["cat", "head", "tail", "wc", "grep", "egrep", "fgrep", "rg"],
      reason:
        "Content readers: no output-file option in any surveyed dialect; output is stdout only",
    },
    {
      words: ["diff"],
      reason: "Writes nothing; `-D` emits merged output to stdout",
    },
    {
      words: ["ls", "stat", "pwd"],
      reason: "Metadata and listing: report only",
    },
    {
      words: ["basename", "dirname", "realpath"],
      reason:
        "Path-string transforms: `realpath` reads the filesystem and writes nothing; the other two touch it at all only to resolve",
    },
    {
      words: ["echo", "which", "cd"],
      reason:
        "No filesystem write: `echo` writes to stdout (a redirect destination is the syntax proof's job, not `echo`'s); `cd` reads a directory to enter it",
    },
    {
      words: ["true", "false", ":"],
      reason:
        "No-ops: ignore their operands and touch no file; GNU's `--help`/`--version` print to stdout only",
    },
    {
      words: ["find", "fd", "sort"],
      reason:
        "Read-only until an argument says otherwise — see RETRACTION_GUARDS",
    },
    {
      words: ["sed"],
      reason:
        "Read-only until the command line says otherwise: an allowlist proof over its options and script — see sed-invocation.ts",
    },
    {
      words: ["awk"],
      reason:
        "Read-only until the command line says otherwise: an allowlist proof over its options and program text — see awk-invocation.ts",
    },
  ];
}

// ── The retraction guards ──────────────────────────────────────────────────

/**
 * The option forms that withdraw a guarded word's read claim.
 *
 * Matching is fail-closed over the forms ADR 0013 §7 names: a long stem
 * matches bare, with an attached `=value`, or as any prefix of itself, and a
 * short letter matches anywhere in a single-dash cluster, which covers the
 * attached-value form (`-oFILE`) too. Over-retraction costs one ask;
 * under-retraction misses a write.
 *
 * The prefix rule exists because GNU `getopt_long` accepts any unambiguous
 * abbreviation, so `sort --out=/tmp/x` reaches the same code `--output` does.
 * Matching every prefix also retracts on an abbreviation the real program
 * would reject as ambiguous — the affordable direction.
 */
interface RetractionGuard {
  /** Whole argument words, for options that neither cluster nor take `=`. */
  readonly exactWords?: ReadonlySet<string>;
  /** Long stems, matched bare (`--output`) or attached (`--output=/tmp/x`). */
  readonly longStems?: ReadonlySet<string>;
  /** Short letters, matched anywhere in a single-dash cluster (`-uo`). */
  readonly shortLetters?: ReadonlySet<string>;
}

/**
 * Whether a guarded word's arguments withdraw its read claim.
 *
 * Each guarded word owns its own predicate, so a word whose proof needs more
 * than option spellings can supply one without widening the option shape.
 */
type ClaimWithdrawal = (argWords: readonly ArgWord[]) => boolean;

/**
 * A withdrawal decided by option spellings: any argument naming one.
 *
 * A computed argument's value is its unresolved source spelling, not what the
 * program receives, so it is asked only whether it may arrive beginning with
 * `-`, the shape every guarded option has.
 */
function optionGuard(guard: RetractionGuard): ClaimWithdrawal {
  return (argWords) =>
    argWords.some((word) =>
      word.computed ? word.mayLeadWithDash : retractsClaim(word.value, guard),
    );
}

/**
 * The guarded words and what withdraws each one's claim.
 *
 * `find`, `fd`, and `sort` are guarded by option spellings, chosen because
 * their write options spell identically in GNU and BSD; a computed argument
 * that may lead with `-` withdraws their claim too, since it could spell any
 * of them. `sed` needs a
 * proof over its script too, since a `w` command writes whatever its options
 * say, and `awk` a proof over its program, since `print >` does the same — so
 * each owns a predicate of its own. `find`'s options are single-dash long
 * words that never cluster, so they match as exact words; `sort`'s only short
 * option containing `o` is `-o` itself, so the cluster rule cannot
 * over-retract there.
 */
const RETRACTION_GUARDS: ReadonlyMap<string, ClaimWithdrawal> = new Map([
  [
    "find",
    optionGuard({
      exactWords: new Set([
        "-exec",
        "-execdir",
        "-ok",
        "-okdir",
        "-delete",
        "-fprint",
        "-fprint0",
        "-fprintf",
        "-fls",
      ]),
    }),
  ],
  [
    "fd",
    optionGuard({
      longStems: new Set(["--exec", "--exec-batch"]),
      shortLetters: new Set(["x", "X"]),
    }),
  ],
  [
    "sort",
    optionGuard({
      longStems: new Set(["--output"]),
      shortLetters: new Set(["o"]),
    }),
  ],
  ["sed", sedWithdrawsReadClaim],
  ["awk", awkWithdrawsReadClaim],
]);

// ── Private helpers ────────────────────────────────────────────────────────

/** A core word's proven attribution. */
const CORE_READ_EFFECT: TokenEffect = { effect: "read", source: "core" };

/** A guarded word whose claim an argument withdrew (ADR 0013 §7's blame line). */
const RETRACTED_EFFECT: TokenEffect = {
  effect: "unproven",
  source: "retracted",
};

/** A redirect destination the operator proves the shell reads. */
const SYNTAX_READ_EFFECT: TokenEffect = { effect: "read", source: "syntax" };

/** A redirect destination the operator proves the shell writes. */
const SYNTAX_WRITE_EFFECT: TokenEffect = { effect: "write", source: "syntax" };

/** The path separators that disqualify a head word from the core, both flavors. */
const PATH_SEPARATORS = ["/", "\\"];

function isBareCoreWord(headWord: string): boolean {
  if (PATH_SEPARATORS.some((separator) => headWord.includes(separator))) {
    return false;
  }
  return PURE_READER_CORE.has(headWord);
}

function retractsClaim(word: string, guard: RetractionGuard): boolean {
  if (guard.exactWords?.has(word)) return true;
  if (matchesLongStem(word, guard.longStems)) return true;
  return matchesShortCluster(word, guard.shortLetters);
}

/**
 * A long option, bare, carrying its value inline, or abbreviated.
 *
 * The name is taken before the first `=`, so `--out=/tmp/x` is tested as
 * `--out` — an abbreviation of `--output` that GNU `getopt_long` resolves to
 * it. A bare `--` abbreviates nothing.
 */
function matchesLongStem(
  word: string,
  stems: ReadonlySet<string> | undefined,
): boolean {
  if (!stems) return false;
  const name = word.split("=")[0];
  if (!name.startsWith("--") || name.length <= 2) return false;
  for (const stem of stems) {
    if (stem.startsWith(name)) return true;
  }
  return false;
}

/**
 * A guarded letter anywhere in a single-dash cluster.
 *
 * The scan runs past the letters into an attached value, which is what makes
 * `-oFILE` retract as surely as `-o FILE` does.
 */
function matchesShortCluster(
  word: string,
  letters: ReadonlySet<string> | undefined,
): boolean {
  if (!letters) return false;
  if (!word.startsWith("-") || word.startsWith("--") || word.length < 2) {
    return false;
  }
  const cluster = word.slice(1);
  for (const letter of letters) {
    if (cluster.includes(letter)) return true;
  }
  return false;
}
