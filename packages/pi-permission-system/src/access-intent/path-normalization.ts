import { canonicalizePath } from "#src/path/canonicalize-path";
import { expandHomePath } from "#src/path/expand-home";
import type { PathFlavor } from "#src/path/path-flavor";

/**
 * Representation derivation backing {@link AccessPath}: turn an accessed path
 * into the lexical / canonical / policy-value forms the resolver matches
 * against rules. Pure (no filesystem access except `canonicalizePath`'s
 * best-effort symlink resolution); the platform's path semantics arrive as an
 * injected {@link PathFlavor}, never read ambiently.
 */
export function normalizePathForComparison(
  pathValue: string,
  base: string,
  flavor: PathFlavor,
): string {
  const cleaned = normalizePathPolicyLiteral(pathValue);
  return cleaned ? flavor.comparable(cleaned, base) : "";
}

export interface PathPolicyValueOptions {
  /**
   * Current Pi working directory. When provided, returned values include a
   * project-relative alias for paths that resolve inside this directory.
   */
  cwd?: string;
  /**
   * Directory used to resolve `pathValue` into an absolute policy value.
   * Defaults to `cwd`. Bash uses this for tokens seen after a literal `cd`.
   */
  resolveBase?: string;
}

/**
 * Normalize a single path-like lookup value without resolving it against CWD.
 *
 * Preserves compatibility with existing relative path rules (`src/*`, `*.env`)
 * while applying the lexical cleanup {@link normalizePathForComparison} shares:
 * trim, strip simple wrapping quotes, strip the OpenCode-style leading `@`, and
 * expand `~` / `$HOME`.
 */
export function normalizePathPolicyLiteral(pathValue: string): string {
  const trimmed = pathValue.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed) return "";
  const unprefixed = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  return expandHomePath(unprefixed);
}

/**
 * Return equivalent lookup values for path-policy matching.
 *
 * The first value is the cwd/effective-base normalized absolute path when a
 * base is available. The later values preserve project-relative and raw
 * relative forms so existing rules like `src/*` and `*.env` continue to match.
 */
export function getPathPolicyValues(
  pathValue: string,
  options: PathPolicyValueOptions,
  flavor: PathFlavor,
): string[] {
  const literal = normalizePathPolicyLiteral(pathValue);
  if (!literal) return [];
  if (literal === "*") return ["*"];

  return [
    ...new Set([
      ...getAbsolutePathPolicyValues(pathValue, options, flavor),
      literal,
    ]),
  ];
}

function getAbsolutePathPolicyValues(
  pathValue: string,
  options: PathPolicyValueOptions,
  flavor: PathFlavor,
): string[] {
  const resolveBase = options.resolveBase ?? options.cwd;
  if (!resolveBase) return [];

  const absolute = normalizePathForComparison(pathValue, resolveBase, flavor);
  if (!absolute) return [];

  return [
    absolute,
    ...getCwdRelativePathPolicyValues(absolute, options.cwd, flavor),
  ];
}

function getCwdRelativePathPolicyValues(
  absolute: string,
  cwd: string | undefined,
  flavor: PathFlavor,
): string[] {
  if (!cwd) return [];

  const normalizedCwd = normalizePathForComparison(cwd, cwd, flavor);
  if (!normalizedCwd) return [];
  if (absolute !== normalizedCwd && !flavor.isWithin(absolute, normalizedCwd)) {
    return [];
  }

  const relativeValue = flavor.impl.relative(normalizedCwd, absolute);
  return relativeValue ? [relativeValue] : [];
}

/**
 * Like {@link normalizePathForComparison} but also resolves symlinks via
 * `realpathSync` (best-effort). Use this for containment decisions where the
 * OS-followed path matters, not for pattern matching.
 */
export function canonicalNormalizePathForComparison(
  pathValue: string,
  base: string,
  flavor: PathFlavor,
): string {
  const lexical = normalizePathForComparison(pathValue, base, flavor);
  if (!lexical) return "";
  return flavor.fold(canonicalizePath(lexical, flavor));
}
