/**
 * transient-fs-retry.ts — Survive a file lock that is about to clear.
 *
 * On Windows a `rename` or `mkdir` is not the POSIX operation of the same
 * name: an antivirus scanner, the search indexer, or any other process holding
 * a transient handle on a path fails the call with `EPERM`/`EBUSY`/`EACCES`.
 * The forwarded-permission writes that ride on those calls are then simply
 * lost — a child's request write becomes a refused tool call, and a serving
 * heartbeat goes unpublished (#914).
 *
 * A few attempts a few milliseconds apart is enough for the common case. The
 * decision lives here rather than at either call site so both inherit one
 * errno set and one budget, and so it can be tested without a filesystem.
 */

/** Tuning seams, injected so a unit test asserts the backoff without sleeping. */
export interface TransientFsRetryOptions {
  delaysMs?: readonly number[];
  sleep?: (ms: number) => void;
}

/** How an operation that eventually succeeded got there. */
export interface TransientFsRetryRecord {
  /** Attempts made, counting the first — `1` when it succeeded outright. */
  attempts: number;
  /** The transient errno that forced the retries, or `null` when there were none. */
  code: string | null;
}

/**
 * Run `operation`, retrying while a transient filesystem lock rejects it.
 *
 * Returns how it went, so the caller can record a recovery without this module
 * having to know anything about logging. An error outside the transient set is
 * rethrown immediately with no sleep, keeping a permanent `ENOTDIR`/`ENOENT`
 * exactly as fast as it is today; an exhausted budget rethrows the last error,
 * so every caller's existing `catch` keeps working unchanged.
 */
export function retryOnTransientFsError(
  operation: () => void,
  options?: TransientFsRetryOptions,
): TransientFsRetryRecord {
  const delaysMs = options?.delaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep = options?.sleep ?? sleepBlocking;

  let attempts = 0;
  let code: string | null = null;

  for (;;) {
    try {
      operation();
      return { attempts: attempts + 1, code };
    } catch (error) {
      const transientCode = transientErrorCode(error);
      if (transientCode === null || attempts >= delaysMs.length) {
        throw error;
      }
      code = transientCode;
      sleep(delaysMs[attempts] ?? 0);
      attempts += 1;
    }
  }
}

// ── Module-private ─────────────────────────────────────────────────────────

/**
 * Three retries, 60 ms of blocking at worst.
 *
 * Sized against the two windows it has to fit inside: well under one
 * `PERMISSION_FORWARDING_POLL_INTERVAL_MS` tick, so a retrying heartbeat write
 * cannot push the serving node's timer into the next tick, and far under the
 * grace a forwarding child waits out, so a parent retrying its own writes can
 * never be the reason a child gives up on it.
 */
const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [10, 20, 30];

/**
 * The errno values a transient lock produces on an otherwise-valid operation.
 *
 * This set is the platform gate: `process.platform` is unreadable in `src/`,
 * and a POSIX host that produces one of these on a rename is in the same
 * situation a Windows host is — worth one more attempt, and no worse off for
 * it.
 */
const TRANSIENT_FS_ERROR_CODES: ReadonlySet<string> = new Set([
  "EPERM",
  "EBUSY",
  "EACCES",
]);

/** The transient errno `error` carries, or `null` when retrying cannot help. */
function transientErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  const { code } = error as { code?: unknown };
  return typeof code === "string" && TRANSIENT_FS_ERROR_CODES.has(code)
    ? code
    : null;
}

/**
 * Block the calling thread for `ms`.
 *
 * Synchronous because every caller is: the heartbeat publish satisfies a
 * `void` seam a timer drives. `Atomics.wait` on a never-notified buffer is the
 * standard blocking sleep and is permitted on Node's main thread.
 *
 * The buffer is module-scoped — which persists across same-cwd session
 * switches — and that is safe here precisely because nothing ever writes to
 * it: every wait sees the initial zero and times out.
 */
const SLEEP_BUFFER = new Int32Array(new SharedArrayBuffer(4));

function sleepBlocking(ms: number): void {
  Atomics.wait(SLEEP_BUFFER, 0, 0, ms);
}
