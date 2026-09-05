import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Walk up the directory tree from the given file URL until a directory
 * literally named `node_modules` is found.
 *
 * Returns the `node_modules` path, or `null` if the URL cannot be parsed or
 * no `node_modules` ancestor exists.
 */
function walkUpToNodeModules(fromUrl: string): string | null {
  try {
    const thisFile = fileURLToPath(fromUrl);
    let dir = dirname(thisFile);
    while (dir !== dirname(dir)) {
      if (basename(dir) === "node_modules") {
        return dir;
      }
      dir = dirname(dir);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Run `npm root -g` synchronously and return the trimmed output, or `null` on
 * any failure (non-zero exit, ENOENT, timeout, non-existent path).
 *
 * Only called when the walk-up-from-self strategy fails (i.e. the extension is
 * running from a local development checkout, not a global install).
 */
function discoverGlobalNodeModulesViaSubprocess(): string | null {
  try {
    const result = spawnSync("npm", ["root", "-g"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const root = result.stdout.trim();
    if (result.status === 0 && root && existsSync(root)) {
      return root;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Discover the global node_modules root.
 *
 * Strategy 1 (zero-cost, covers all global installs): walk up from
 * `fromUrl` (defaults to this module's own `import.meta.url`) looking for a
 * directory named `node_modules`. This works whenever the extension is
 * installed inside a `node_modules` tree.
 *
 * Strategy 2 (subprocess fallback, dev checkout only): when Strategy 1 fails
 * because the extension is running from a local development checkout with no
 * `node_modules` ancestor, run `npm root -g` to discover the global root.
 * Pi installs skills and extensions via `npm` by default, so `npm root -g`
 * returns the correct root regardless of the user's own project package
 * manager.
 *
 * Returns `null` when both strategies fail — callers must degrade gracefully.
 */
export function discoverGlobalNodeModulesRoot(
  fromUrl = import.meta.url,
): string | null {
  const fromSelf = walkUpToNodeModules(fromUrl);
  if (fromSelf) return fromSelf;
  return discoverGlobalNodeModulesViaSubprocess();
}
