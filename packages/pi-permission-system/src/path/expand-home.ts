import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The spellings of the home directory this package resolves, in every pattern
 * and path literal.
 *
 * `$HOME` and `${HOME}` are the two spellings of the same shell variable and
 * must stay interchangeable: a rule keyed on one form has to match a path
 * written in the other, and the bash path projection classifies a token by the
 * shape it has *after* this expansion (#694).
 */
const HOME_PREFIXES = ["~", "$HOME", "${HOME}"] as const;

/**
 * Expand a home-directory prefix in a pattern or path value to the OS home
 * directory.
 *
 * A prefix is recognized only when it stands alone or is followed by a path
 * separator, so a longer name (`~username`, `$HOMEDIR`, `${HOMEDIR}`) and a
 * braced parameter expansion carrying an operator (`${HOME:-/tmp}`,
 * `${HOME%/*}`) are both left untouched.
 *
 * Supported forms, for each prefix in {@link HOME_PREFIXES}:
 * - `<prefix>`       → `homedir()`
 * - `<prefix>/path`  → `homedir()/path`
 * - `<prefix>\path`  → `homedir()\path` (Windows)
 *
 * All other patterns are returned unchanged.
 */
export function expandHomePath(pattern: string): string {
  for (const prefix of HOME_PREFIXES) {
    if (pattern === prefix) return homedir();
    if (!pattern.startsWith(prefix)) continue;

    const rest = pattern.slice(prefix.length);
    if (rest.startsWith("/") || rest.startsWith("\\")) {
      return join(homedir(), rest.slice(1));
    }
  }
  return pattern;
}
