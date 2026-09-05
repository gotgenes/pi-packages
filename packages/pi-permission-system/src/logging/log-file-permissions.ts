import { chmodSync } from "node:fs";

/**
 * Owner-only POSIX modes for the extension's on-disk artifacts.
 *
 * The permission logs record bash command strings and tool-input previews, and
 * the forwarding files carry the same text between sessions. Left to the
 * process umask they are created world-readable (0644 / 0755 under the common
 * default), which is only acceptable on a single-user host.
 */

export const OWNER_ONLY_FILE_MODE = 0o600;
export const OWNER_ONLY_DIRECTORY_MODE = 0o700;

/**
 * Best-effort tightening of an existing path's mode.
 *
 * Creation-time modes cover new files, but an installation that predates this
 * hardening already has a world-readable log that no `mode` option will fix —
 * hence the explicit `chmod`.
 *
 * Never throws, and never reports. On Windows `chmod` only toggles the
 * read-only bit and can reject a directory outright; warning about that every
 * session would be noise, since the file there is governed by NTFS ACL
 * inheritance rather than POSIX modes. A hardening failure must also never
 * break the gate, which is the caller's real work.
 */
export function restrictExistingPathToOwner(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    // Intentionally ignored — see above.
  }
}
