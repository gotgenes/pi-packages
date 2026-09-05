import { expandHomePath } from "#src/path/expand-home";

/**
 * A pattern compiled once for repeated matching.
 *
 * Matching is a method rather than an exposed `RegExp` so that both halves of
 * the {@link WildcardMatchOptions} fold stay together: the compiled regex
 * carries the pattern-side folding, and {@link matches} applies the same
 * folding to the value. A caller holding the raw regex could apply one without
 * the other, which is exactly the asymmetry that made forward-slash path rules
 * inert on Windows (#653).
 */
export interface CompiledWildcardPattern<TState> {
  readonly pattern: string;
  readonly state: TState;
  matches(value: string): boolean;
}

export type WildcardPatternMatch<TState> = {
  state: TState;
  matchedPattern: string;
  matchedName: string;
};

/**
 * Optional folding applied when matching path-surface patterns on Windows.
 *
 * - `caseInsensitive` compiles the pattern with the `i` flag so a mixed-case
 *   pattern matches a lowercased (canonicalized) path value.
 * - `windowsSeparators` rewrites `/` to `\` in both the expanded pattern and
 *   the matched value, so two spellings of the same path match regardless of
 *   which separator either side was written with. Folding only the pattern
 *   leaves every forward-slash value (a Git Bash device, an as-typed literal)
 *   unmatchable (#653).
 */
export interface WildcardMatchOptions {
  caseInsensitive?: boolean;
  windowsSeparators?: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compileWildcardPattern<TState>(
  pattern: string,
  state: TState,
  options?: WildcardMatchOptions,
): CompiledWildcardPattern<TState> {
  const expanded = foldSeparators(expandHomePath(pattern), options);
  let escaped = expanded
    .split("*")
    .map((part) => escapeRegExp(part).replaceAll("\\?", "."))
    .join(".*");

  // If the pattern ends with " *" (space + wildcard), make the trailing
  // space-and-arguments portion optional so that e.g. "git *" matches both
  // "git status" and bare "git". Mirrors OpenCode wildcard semantics.
  if (escaped.endsWith(" .*")) {
    escaped = `${escaped.slice(0, -3)}( .*)?`;
  }

  const regex = new RegExp(
    `^${escaped}$`,
    options?.caseInsensitive ? "si" : "s",
  );

  return {
    pattern,
    state,
    matches: (value) => regex.test(foldSeparators(value, options)),
  };
}

export function compileWildcardPatternEntries<TState>(
  entries: Iterable<readonly [string, TState]>,
): CompiledWildcardPattern<TState>[] {
  return Array.from(entries, ([pattern, state]) =>
    compileWildcardPattern(pattern, state),
  );
}

function _compileWildcardPatterns<TState>(
  patterns: Record<string, TState>,
): CompiledWildcardPattern<TState>[] {
  return compileWildcardPatternEntries(Object.entries(patterns));
}

export function findCompiledWildcardMatch<TState>(
  patterns: readonly CompiledWildcardPattern<TState>[],
  name: string,
): WildcardPatternMatch<TState> | null {
  const match = patterns.findLast((p) => p.matches(name));
  if (match === undefined) return null;
  return {
    state: match.state,
    matchedPattern: match.pattern,
    matchedName: name,
  };
}

/**
 * Test whether `value` matches `pattern` using wildcard rules.
 * `*` matches any sequence of characters (including empty).
 * `?` matches exactly one character.
 * Used by evaluate() for rule matching.
 */
export function wildcardMatch(
  pattern: string,
  value: string,
  options?: WildcardMatchOptions,
): boolean {
  return compileWildcardPattern(pattern, null, options).matches(value);
}

/**
 * Apply the `windowsSeparators` half of the fold to one operand.
 *
 * Called for the pattern at compile time and for the value at match time —
 * the fold is an equivalence relation, so both sides must pass through it.
 */
function foldSeparators(value: string, options?: WildcardMatchOptions): string {
  return options?.windowsSeparators ? value.replaceAll("/", "\\") : value;
}

export function findCompiledWildcardMatchForNames<TState>(
  patterns: readonly CompiledWildcardPattern<TState>[],
  names: readonly string[],
): WildcardPatternMatch<TState> | null {
  const normalizedNames = names
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (normalizedNames.length === 0) {
    return null;
  }

  for (const name of normalizedNames) {
    const match = findCompiledWildcardMatch(patterns, name);
    if (match) {
      return match;
    }
  }

  return null;
}
