/**
 * Pure shape classifier for a bash-command token on a win32 host, where Pi core
 * executes commands through Git Bash and POSIX-shaped absolute tokens carry
 * MSYS mount semantics rather than `node:path.win32` semantics.
 *
 * Consumed only by {@link PathNormalizer.forBashToken}; kept as a standalone
 * module so the shape knowledge is unit-testable in isolation (no filesystem,
 * no platform read).
 */
import { isSafeSystemPath } from "#src/path/safe-system-paths";

/**
 * The MSYS interpretation of a win32 bash token:
 *
 * - `device` — a safe MSYS runtime device (`/dev/null`, `/dev/std{in,out,err}`);
 *   never a filesystem path.
 * - `drive-mount` — an MSYS drive mount (`/c/…`, `/d/…`); `windowsPath` is its
 *   deterministic Windows equivalent (`C:\…`).
 * - `posix-absolute` — any other absolute POSIX path (`/tmp/foo`, `/usr/bin`);
 *   its Windows target is install-dependent and not deterministically knowable,
 *   so it is treated literally.
 * - `plain` — everything else (relative tokens, `~/…`, native Windows drive
 *   paths); handled by ordinary win32 resolution.
 */
export type BashTokenShape =
  | { kind: "device" }
  | { kind: "drive-mount"; windowsPath: string }
  | { kind: "posix-absolute" }
  | { kind: "plain" };

/**
 * A single-letter first path segment identifies an MSYS drive mount: `/c`,
 * `/c/`, or `/c/rest`. A multi-letter first segment (`/dev`, `/tmp`) is not a
 * mount. The device set is checked before this pattern, so `/dev/*` never
 * reaches it.
 */
const MSYS_DRIVE_MOUNT_PATTERN = /^\/([a-zA-Z])(\/.*)?$/;

export function classifyWin32BashToken(token: string): BashTokenShape {
  if (isSafeSystemPath(token)) return { kind: "device" };

  const driveMatch = MSYS_DRIVE_MOUNT_PATTERN.exec(token);
  if (driveMatch) {
    return {
      kind: "drive-mount",
      windowsPath: toWindowsDrivePath(driveMatch[1], driveMatch[2]),
    };
  }

  if (token.startsWith("/")) return { kind: "posix-absolute" };

  return { kind: "plain" };
}

/**
 * Build the Windows equivalent of an MSYS drive mount: uppercase drive letter,
 * `:\`, and the remainder with `/` separators rewritten to `\`. A bare or
 * trailing-slash mount (`/c`, `/c/`) maps to the drive root (`C:\`).
 */
function toWindowsDrivePath(letter: string, rest: string | undefined): string {
  const drive = `${letter.toUpperCase()}:`;
  const tail = (rest ?? "").replace(/^\//, "").replaceAll("/", "\\");
  return tail ? `${drive}\\${tail}` : `${drive}\\`;
}
