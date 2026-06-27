import { realpathSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { join } from "node:path";

/**
 * Resolve symlinks in an absolute path, best-effort.
 *
 * Splits the path into components and tries `realpathSync` from the full path
 * down to `/`, re-appending the non-existent tail to the first ancestor that
 * resolves. Returns the input unchanged when no ancestor resolves (unreachable
 * in practice since `/` always exists) or when a non-ENOENT/ENOTDIR error is
 * encountered (e.g. `EACCES`, `ELOOP`), so callers fall back to lexical
 * containment for paths that cannot be resolved.
 */
export function canonicalizePath(absolutePath: string): string {
  if (!absolutePath) return absolutePath;

  const parts = absolutePath.split("/").filter(Boolean);
  for (let i = parts.length; i >= 0; i--) {
    const candidate = "/" + parts.slice(0, i).join("/");
    try {
      const real = realpathSync(candidate);
      const tail = parts.slice(i);
      return tail.length === 0 ? real : join(real, ...tail);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") return absolutePath;
    }
  }
  return absolutePath;
}

/**
 * Resolve symlinks for an absolute path asynchronously using `fs.realpath`.
 *
 * Returns the resolved real path on success, or `null` when resolution fails
 * (dangling symlink, ENOENT, EPERM, ELOOP, or any other error).
 *
 * Used by the path permission gate to prevent symlink-traversal bypass: a
 * caller should treat a `null` return as a deny, because an unresolvable path
 * could be a dangling or adversarially crafted symlink.
 */
export async function resolveSymlinkAsync(
  absolutePath: string,
): Promise<string | null> {
  if (!absolutePath) return null;
  try {
    return await realpath(absolutePath);
  } catch {
    return null;
  }
}
