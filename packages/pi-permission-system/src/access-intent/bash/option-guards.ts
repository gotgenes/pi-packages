import type { ArgWord } from "./node-text";

// ── Public surface ─────────────────────────────────────────────────────────

/**
 * Whether a guarded word's arguments withdraw its read claim.
 *
 * Each guarded word owns its own predicate, so a word whose proof needs more
 * than option spellings can supply one without widening the option shape.
 */
export type ClaimWithdrawal = (argWords: readonly ArgWord[]) => boolean;

/**
 * A withdrawal decided by option spellings: any argument naming one.
 *
 * A computed argument's value is its unresolved source spelling, not what the
 * program receives, so it is asked only whether it may arrive beginning with
 * `-`, the shape every guarded option has.
 */
export function optionGuard(guard: RetractionGuard): ClaimWithdrawal {
  return (argWords) =>
    argWords.some((word) =>
      word.computed ? word.mayLeadWithDash : retractsClaim(word.value, guard),
    );
}

/**
 * A withdrawal decided by option stems as a user writes them (`-i`,
 * `--in-place`, `-exec`), each classified by its shape: a single letter after
 * one dash matches anywhere in a cluster, a stem after two dashes matches as a
 * long option, and a longer stem after one dash matches the word exactly or
 * with a suffix attached.
 */
export function stemGuard(stems: readonly string[]): ClaimWithdrawal {
  const longStems = new Set<string>();
  const shortLetters = new Set<string>();
  const dashWordPrefixes = new Set<string>();
  for (const stem of stems) {
    if (stem.startsWith("--")) longStems.add(stem);
    else if (stem.length === 2) shortLetters.add(stem.slice(1));
    else dashWordPrefixes.add(stem);
  }
  return optionGuard({ longStems, shortLetters, dashWordPrefixes });
}

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
export interface RetractionGuard {
  /** Whole argument words, for options that neither cluster nor take `=`. */
  readonly exactWords?: ReadonlySet<string>;
  /** Long stems, matched bare (`--output`) or attached (`--output=/tmp/x`). */
  readonly longStems?: ReadonlySet<string>;
  /** Short letters, matched anywhere in a single-dash cluster (`-uo`). */
  readonly shortLetters?: ReadonlySet<string>;
  /**
   * Single-dash long options, matched as the whole word or with a suffix
   * attached (`-exec` matches `-execdir`), never read as a cluster of letters.
   */
  readonly dashWordPrefixes?: ReadonlySet<string>;
}

// ── Private helpers ────────────────────────────────────────────────────────

function retractsClaim(word: string, guard: RetractionGuard): boolean {
  if (guard.exactWords?.has(word)) return true;
  if (matchesLongStem(word, guard.longStems)) return true;
  if (matchesDashWordPrefix(word, guard.dashWordPrefixes)) return true;
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

/** A single-dash long option, whole or with a suffix attached. */
function matchesDashWordPrefix(
  word: string,
  prefixes: ReadonlySet<string> | undefined,
): boolean {
  if (!prefixes) return false;
  for (const prefix of prefixes) {
    if (word.startsWith(prefix)) return true;
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
