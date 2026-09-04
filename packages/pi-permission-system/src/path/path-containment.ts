import { isSafeSystemPath } from "#src/safe-system-paths";
import type { PathFlavor } from "./path-flavor";

/**
 * Pure geometry: is `canonicalPath` outside `canonicalCwd`?
 *
 * Both operands must already be canonical (symlink-resolved, win32-lowercased)
 * — the caller prepares them (see {@link PathNormalizer.isOutsideWorkingDirectory}).
 * This predicate touches no filesystem and does no derivation; the containment
 * geometry lives on {@link PathFlavor.isWithin}.
 */
export function isPathOutsideWorkingDirectory(
  canonicalPath: string,
  canonicalCwd: string,
  flavor: PathFlavor,
): boolean {
  if (!canonicalCwd || !canonicalPath) {
    return false;
  }
  if (isSafeSystemPath(canonicalPath)) {
    return false;
  }
  return !flavor.isWithin(canonicalPath, canonicalCwd);
}
