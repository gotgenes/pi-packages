import type { PathFlavor } from "#src/path/path-flavor";

/**
 * Derive the wildcard glob to record when a user approves an accessed path for
 * the session: the path's directory scope, with `*` appended.
 *
 * The scope is the value up to and including its last path separator, so the
 * pattern is spelled with the separator the value itself carries. That matters
 * on a win32 host, where Git Bash tokens are POSIX-shaped while Node's own
 * `sep` is a backslash: deriving `/tmp/logs\*` from `/tmp/logs/` widens the
 * grant to the parent directory once the `windowsSeparators` fold (#653)
 * normalizes both operands. A value carrying no separator falls back to the
 * current directory, which is what callers see only if they skipped resolving
 * the path to its absolute form first (#438).
 *
 * The platform's separator alphabet arrives as an injected {@link PathFlavor},
 * never an ambient `node:path` read, so win32 derivation is decidable — and
 * testable — on a POSIX host (#655).
 */
export function deriveApprovalPattern(
  pathValue: string,
  flavor: PathFlavor,
): string {
  const lastSeparator = flavor.lastSeparatorIndex(pathValue);
  if (lastSeparator < 0) return `.${flavor.impl.sep}*`;
  return `${pathValue.slice(0, lastSeparator + 1)}*`;
}
