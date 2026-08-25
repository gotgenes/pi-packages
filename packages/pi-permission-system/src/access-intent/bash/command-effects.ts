import { type TokenEffect, UNPROVEN_EFFECT } from "#src/access-intent/effect";

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
 * write-capable options, yielding `retracted` rather than a write: the command
 * may still only read, so the fail-closed base case is the honest answer and
 * `retracted` is the blame line that says why.
 *
 * Pure and word-based by design — the AST walk that produces the words lives
 * in `token-collection.ts`, the same split `wrapper-analysis.ts` documents.
 */
export function proveCommandEffect(
  headWord: string,
  argWords: readonly string[],
): TokenEffect {
  if (!isBareCoreWord(headWord)) return UNPROVEN_EFFECT;
  const guard = RETRACTION_GUARDS.get(headWord);
  if (guard && argWords.some((word) => retractsClaim(word, guard))) {
    return RETRACTED_EFFECT;
  }
  return CORE_READ_EFFECT;
}

/**
 * The frozen v1 pure-reader core: command words that are read-only for any
 * arguments, in any implementation.
 *
 * Exported so `docs/configuration.md`'s published roster is held to it by a
 * parity test — a listed roster drifts from the code otherwise.
 */
export const PURE_READER_CORE: ReadonlySet<string> = new Set(
  coreAdmissions().flatMap(({ words }) => words),
);

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
 * | `awk`, `gawk`, `nawk`                           | The program text can `print > "file"` — not stable under args  |
 * | `sed`                                           | `-i` is in-place, and BSD needs a separate argument where GNU attaches one, so the guard is dialect-variant |
 * | `uniq`                                          | `uniq IN OUT` writes its second positional                     |
 * | `tee`, `dd`, `split`, `csplit`, `xxd`, `tree`, `curl`, `wget` | Each has a positional or option that writes a file |
 * | `less`, `more`                                  | Interactive shell escape (`!cmd`) and `LESSOPEN` preprocessing |
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
      words: ["ls", "stat", "file", "pwd"],
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
      words: ["find", "fd", "sort"],
      reason:
        "Read-only until an argument says otherwise — see RETRACTION_GUARDS",
    },
  ];
}

// ── The retraction guards ──────────────────────────────────────────────────

/**
 * The option forms that withdraw a guarded word's read claim.
 *
 * Matching is fail-closed over the forms ADR 0013 §7 names: a long stem
 * matches bare or with an attached `=value`, and a short letter matches
 * anywhere in a single-dash cluster, which covers the attached-value form
 * (`-oFILE`) too. Over-retraction costs one ask; under-retraction misses a
 * write.
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
 * The three guarded words and what withdraws each one's claim.
 *
 * All three were chosen because their write options spell identically in GNU
 * and BSD — which is exactly why `sed` is excluded outright rather than
 * guarded. `find`'s options are single-dash long words that never cluster, so
 * they match as exact words; `sort`'s only short option containing `o` is `-o`
 * itself, so the cluster rule cannot over-retract there.
 */
const RETRACTION_GUARDS: ReadonlyMap<string, RetractionGuard> = new Map([
  [
    "find",
    {
      exactWords: new Set([
        "-exec",
        "-execdir",
        "-ok",
        "-okdir",
        "-delete",
        "-fprint",
        "-fprintf",
        "-fls",
      ]),
    },
  ],
  [
    "fd",
    {
      longStems: new Set(["--exec", "--exec-batch"]),
      shortLetters: new Set(["x", "X"]),
    },
  ],
  [
    "sort",
    {
      longStems: new Set(["--output"]),
      shortLetters: new Set(["o"]),
    },
  ],
]);

// ── Private helpers ────────────────────────────────────────────────────────

/** A core word's proven attribution. */
const CORE_READ_EFFECT: TokenEffect = { effect: "read", source: "core" };

/** A guarded word whose claim an argument withdrew (ADR 0013 §7's blame line). */
const RETRACTED_EFFECT: TokenEffect = {
  effect: "unproven",
  source: "retracted",
};

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

/** A long option, bare or carrying its value inline. */
function matchesLongStem(
  word: string,
  stems: ReadonlySet<string> | undefined,
): boolean {
  if (!stems) return false;
  for (const stem of stems) {
    if (word === stem || word.startsWith(`${stem}=`)) return true;
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
