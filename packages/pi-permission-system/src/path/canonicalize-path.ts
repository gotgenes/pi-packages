import type { PathFlavor } from "./path-flavor";

/**
 * Resolve an absolute path to the spelling the filesystem reaches, best-effort:
 * symlinks followed and, on POSIX, each existing component in the case and
 * Unicode normalization the filesystem stores (via {@link PathFlavor.realpath}).
 *
 * Splits the path into components and resolves from the full path down to
 * `/`, re-appending the non-existent tail (as typed) to the first ancestor that
 * resolves. Returns the input unchanged when no ancestor resolves (unreachable
 * in practice since `/` always exists) or when a non-ENOENT/ENOTDIR error is
 * encountered (e.g. `EACCES`, `ELOOP`), so callers fall back to lexical
 * containment for paths that cannot be resolved.
 */
export function canonicalizePath(
  absolutePath: string,
  flavor: PathFlavor,
): string {
  if (!absolutePath) return absolutePath;

  const { impl } = flavor;
  const root = impl.parse(absolutePath).root;
  const rest = absolutePath.slice(root.length);
  const parts = rest.split(impl.sep).filter(Boolean);
  for (let i = parts.length; i >= 0; i--) {
    const candidate = root + parts.slice(0, i).join(impl.sep);
    try {
      const real = flavor.realpath(candidate);
      const tail = parts.slice(i);
      return tail.length === 0 ? real : impl.join(real, ...tail);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") return absolutePath;
    }
  }
  return absolutePath;
}
