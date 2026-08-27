/**
 * forwarding-liveness.ts — Is anyone draining a forwarded-permission inbox?
 *
 * The in-process answer already exists: a serving session marks itself in the
 * process-global `ServingSessionRegistry`, and an in-process child abandons a
 * target that has looked unmarked for the grace window instead of waiting out
 * the full forwarding timeout (#719).
 *
 * A child spawned as a separate `pi` process shares no `globalThis` with its
 * parent, so that mark is invisible to it and it keeps waiting the full ten
 * minutes — every `ask` forwarded to a session that has already exited costs
 * the whole timeout and ends in a denial nobody made (#735 scenario 1).
 *
 * The filesystem is the only channel those two processes share, so the serving
 * session publishes a heartbeat there: one record per serving session,
 * refreshed while it polls and withdrawn when it stops.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ensureDirectoryExists,
  isErrnoCode,
  logPermissionForwardingError,
  safeDeleteFile,
  writeJsonFileAtomic,
} from "#src/authority/forwarding-io";
import type { PermissionForwardingTarget } from "#src/authority/permission-forwarding";
import {
  encodeSessionIdForPath,
  PERMISSION_FORWARDING_POLL_INTERVAL_MS,
} from "#src/authority/permission-forwarding";
import type {
  ServingAnnouncer,
  ServingLookup,
} from "#src/authority/serving-registry";
import type { DebugReviewLogger } from "#src/session-logger";

/**
 * How often a serving session rewrites its heartbeat — four poll ticks.
 *
 * Longer than the poll interval so `ForwardingManager` can announce on every
 * tick without four filesystem writes a second, and short enough that a record
 * deleted underneath its owner reappears well inside the grace window a
 * forwarding child waits out before abandoning.
 */
export const SERVING_HEARTBEAT_REFRESH_MS =
  4 * PERMISSION_FORWARDING_POLL_INTERVAL_MS;

/**
 * How long a heartbeat may go unrefreshed before its writer is presumed gone —
 * five refreshes.
 *
 * Generous because a delayed Node timer is not a dead session, and because the
 * case this threshold exists for (a process that is alive but no longer
 * polling) is the rare one: an exited session withdraws its record and a killed
 * one is caught by the recorded pid, neither of which waits for staleness.
 */
export const SERVING_HEARTBEAT_STALE_MS = 5 * SERVING_HEARTBEAT_REFRESH_MS;

/** What a serving session publishes while it drains its forwarded-permission inbox. */
export interface ServingHeartbeat {
  sessionId: string;
  /** The serving process, so a killed session is detectable without waiting out staleness. */
  pid: number;
  updatedAt: number;
}

/**
 * How a session's heartbeat reads right now.
 *
 * Only `"alive"` means someone is draining the inbox. The other three are the
 * ways a target can be unserved, kept apart because they are the diagnosis a
 * stalled forward needs: `"absent"` is a session that exited (or never served,
 * or runs a version that does not publish), `"dead_pid"` one that was killed,
 * and `"stale"` one whose process survives but stopped polling.
 */
export type HeartbeatState = "alive" | "absent" | "stale" | "dead_pid";

/**
 * Read side of the heartbeat channel, consumed by a forwarding child.
 *
 * Separate from the announce seam because the two have no caller in common: a
 * serving session only publishes, and a forwarding child only reads (ISP).
 */
export interface HeartbeatReader {
  read(sessionId: string): HeartbeatState;
  /** Every session whose record reads as alive, for the abandonment diagnostic. */
  servingIds(): readonly string[];
}

/**
 * Query-side seam: is the session a forwarding target names being drained?
 *
 * Keyed on the target rather than a session id because the answer depends on
 * how the target was resolved. An in-process child and its parent share a
 * `globalThis`, so the registry answers for them; an out-of-process pair shares
 * only the filesystem; and a session that owns the inbox it is forwarding to is
 * not a case either channel describes.
 *
 * Consolidating that into one collaborator is what keeps `ParentAuthorizer`
 * from holding two lookups and re-deciding which one applies — the decision has
 * one home, and a third channel would not reach the poll loop.
 */
export interface TargetServingLookup {
  /** `true` serving, `false` not serving, `null` when the target carries no signal. */
  isServing(target: PermissionForwardingTarget): boolean | null;
  /** What the judge observed, for the review entry a child writes when it gives up. */
  describe(target: PermissionForwardingTarget): ServingObservation;
}

/** What answered a liveness question, and what it saw. */
export interface ServingObservation {
  channel: "registry" | "heartbeat" | "none";
  /** The heartbeat state behind a `"heartbeat"` answer; `null` on the other channels. */
  state: HeartbeatState | null;
  servingIds: readonly string[];
}

/** Constructor config for {@link ForwardingLivenessJudge}. */
export interface ForwardingLivenessJudgeDeps {
  /** Answers for a target the requester shares a process with. */
  registry: ServingLookup;
  /** Answers for a target in another process. */
  heartbeats: HeartbeatReader;
}

/**
 * Routes a liveness question to the channel that can answer it.
 *
 * The routing key is `PermissionForwardingTarget.source`, which the resolver
 * already produces — so "in-process" is decided once, where the target is
 * found, rather than re-derived here (#719).
 */
export class ForwardingLivenessJudge implements TargetServingLookup {
  constructor(private readonly deps: ForwardingLivenessJudgeDeps) {}

  isServing(target: PermissionForwardingTarget): boolean | null {
    switch (target.source) {
      case "registry":
        return this.deps.registry.isServing(target.sessionId);
      case "env":
        return this.deps.heartbeats.read(target.sessionId) === "alive";
      case "self":
        return null;
    }
  }

  describe(target: PermissionForwardingTarget): ServingObservation {
    switch (target.source) {
      case "registry":
        return {
          channel: "registry",
          state: null,
          servingIds: this.deps.registry.servingIds(),
        };
      case "env":
        return {
          channel: "heartbeat",
          state: this.deps.heartbeats.read(target.sessionId),
          servingIds: this.deps.heartbeats.servingIds(),
        };
      case "self":
        return { channel: "none", state: null, servingIds: [] };
    }
  }
}

const SERVING_HEARTBEAT_DIRECTORY_NAME = "serving";

/**
 * Where serving heartbeats live: beside the `sessions/` tree, never inside it.
 *
 * A heartbeat under `sessions/<id>/` would make that session root permanently
 * non-empty, entangling liveness with the request/response cleanup whose
 * removal ordering already produced an ENOENT write loop (#398). Kept disjoint,
 * that logic stays untouched and "who is serving" is a single directory read.
 */
export function servingHeartbeatDir(forwardingDir: string): string {
  return join(forwardingDir, SERVING_HEARTBEAT_DIRECTORY_NAME);
}

/** The heartbeat record for `sessionId`, under {@link servingHeartbeatDir}. */
export function servingHeartbeatPath(
  forwardingDir: string,
  sessionId: string,
): string {
  return join(
    servingHeartbeatDir(forwardingDir),
    `${encodeSessionIdForPath(sessionId)}.json`,
  );
}

/** Constructor config for {@link ServingHeartbeatStore}. */
export interface ServingHeartbeatStoreDeps {
  forwardingDir: string;
  logger: DebugReviewLogger;
  /** Injected so the refresh throttle and staleness are testable without sleeping. */
  now?: () => number;
  /** The process to record. Injected so a test can publish a pid it controls. */
  pid?: number;
  /** Injected so a test can decide which pids are running. */
  isProcessAlive?: (pid: number) => boolean;
}

/**
 * Publishes this session's serving heartbeat to the filesystem.
 *
 * Satisfies the same {@link ServingAnnouncer} seam as `ServingSessionRegistry`,
 * so `ForwardingManager` announces to both channels through one collaborator
 * and neither knows the other exists.
 *
 * `markServing` is idempotent by that seam's contract and internally throttled,
 * so the caller may announce on every poll tick. Nothing here throws: it runs
 * from a timer, and a filesystem failure must degrade to the pre-existing
 * timeout rather than break the poll loop.
 */
export class ServingHeartbeatStore
  implements ServingAnnouncer, HeartbeatReader
{
  private readonly forwardingDir: string;
  private readonly logger: DebugReviewLogger;
  private readonly now: () => number;
  private readonly pid: number;
  private readonly isProcessAlive: (pid: number) => boolean;
  private published: { sessionId: string; at: number } | null = null;
  private hasSweptDeadRecords = false;

  constructor(deps: ServingHeartbeatStoreDeps) {
    this.forwardingDir = deps.forwardingDir;
    this.logger = deps.logger;
    this.now = deps.now ?? Date.now;
    this.pid = deps.pid ?? process.pid;
    this.isProcessAlive = deps.isProcessAlive ?? isRunningProcess;
  }

  /** Publish (or refresh) `sessionId`'s heartbeat. Throttled; never throws. */
  markServing(sessionId: string): void {
    const at = this.now();
    if (this.isThrottled(sessionId, at)) {
      return;
    }

    const directory = servingHeartbeatDir(this.forwardingDir);
    if (
      !ensureDirectoryExists(
        this.logger,
        directory,
        "permission forwarding serving heartbeat",
      )
    ) {
      return;
    }
    this.sweepDeadRecordsOnce();

    const heartbeat: ServingHeartbeat = {
      sessionId,
      pid: this.pid,
      updatedAt: at,
    };
    try {
      writeJsonFileAtomic(
        this.logger,
        servingHeartbeatPath(this.forwardingDir, sessionId),
        heartbeat,
      );
    } catch (error) {
      logPermissionForwardingError(
        this.logger,
        `Failed to publish the serving heartbeat for session '${sessionId}'`,
        error,
      );
      return;
    }
    this.published = { sessionId, at };
  }

  /** Withdraw `sessionId`'s heartbeat, leaving the directory for its siblings. */
  clearServing(sessionId: string): void {
    if (this.published?.sessionId === sessionId) {
      this.published = null;
    }
    safeDeleteFile(
      this.logger,
      servingHeartbeatPath(this.forwardingDir, sessionId),
      "permission forwarding serving heartbeat",
    );
  }

  /** How `sessionId`'s heartbeat reads right now. */
  read(sessionId: string): HeartbeatState {
    const record = this.readRecord(
      servingHeartbeatPath(this.forwardingDir, sessionId),
    );
    return record === null ? "absent" : this.classify(record);
  }

  /** Every session whose record reads as alive. */
  servingIds(): readonly string[] {
    const ids: string[] = [];
    for (const { record } of this.listRecords()) {
      if (record !== null && this.classify(record) === "alive") {
        ids.push(record.sessionId);
      }
    }
    return ids;
  }

  // ── Private methods ────────────────────────────────────────────────

  /**
   * Delete the records of processes that are provably gone, once per session.
   *
   * Without this the directory grows one record per session that was killed
   * rather than shut down, forever. Bounded to a single directory read at the
   * first announcement, and safe under pid reuse: a wrongly swept owner
   * republishes within the refresh window, which is shorter than the grace a
   * forwarding child waits out.
   *
   * Only a dead pid is proof. A record that is merely stale belongs to a
   * process that still exists, and the reader already reports it as stale
   * without anyone having to remove it.
   */
  private sweepDeadRecordsOnce(): void {
    if (this.hasSweptDeadRecords) {
      return;
    }
    this.hasSweptDeadRecords = true;
    for (const { path, record } of this.listRecords()) {
      if (record !== null && this.isProcessAlive(record.pid)) {
        continue;
      }
      safeDeleteFile(
        this.logger,
        path,
        "abandoned permission forwarding serving heartbeat",
      );
    }
  }

  /** Every published record, paired with its path; unusable ones read as `null`. */
  private listRecords(): {
    path: string;
    record: ServingHeartbeat | null;
  }[] {
    const directory = servingHeartbeatDir(this.forwardingDir);
    let names: string[];
    try {
      names = readdirSync(directory);
    } catch {
      return [];
    }
    return names
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        const path = join(directory, name);
        return { path, record: this.readRecord(path) };
      });
  }

  /**
   * Read a record, or `null` when it is missing or unusable.
   *
   * Silent by design: a forwarding child calls this on every poll tick, so a
   * warning per unreadable read would flood the review log at four lines a
   * second. The unusability is already reported once, as the `absent` state on
   * the abandonment entry.
   */
  private readRecord(path: string): ServingHeartbeat | null {
    try {
      return asServingHeartbeat(JSON.parse(readFileSync(path, "utf-8")));
    } catch {
      return null;
    }
  }

  /** Which of the four states a well-formed record is in. */
  private classify(record: ServingHeartbeat): HeartbeatState {
    if (!this.isProcessAlive(record.pid)) {
      return "dead_pid";
    }
    return this.now() - record.updatedAt >= SERVING_HEARTBEAT_STALE_MS
      ? "stale"
      : "alive";
  }

  /**
   * Whether the record on disk is recent enough to leave alone.
   *
   * Time alone, with no existence probe: an existence check would cost a
   * syscall on every poll tick to save at most one refresh window, and a record
   * removed underneath its owner reappears inside the grace window anyway.
   */
  private isThrottled(sessionId: string, at: number): boolean {
    return (
      this.published !== null &&
      this.published.sessionId === sessionId &&
      at - this.published.at < SERVING_HEARTBEAT_REFRESH_MS
    );
  }
}

// ── Module-private helpers ────────────────────────────────────────────────

/**
 * Narrow a parsed record, or `undefined`.
 *
 * `pid` must be a positive integer specifically: `process.kill(0, 0)` addresses
 * the caller's own process group and `kill(-n)` a foreign one, so a malformed
 * record must be rejected before it can reach the liveness probe.
 */
function asServingHeartbeat(value: unknown): ServingHeartbeat | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Partial<ServingHeartbeat>;
  if (
    typeof candidate.sessionId !== "string" ||
    candidate.sessionId.length === 0 ||
    typeof candidate.pid !== "number" ||
    !Number.isInteger(candidate.pid) ||
    candidate.pid <= 0 ||
    typeof candidate.updatedAt !== "number" ||
    !Number.isFinite(candidate.updatedAt)
  ) {
    return null;
  }
  return {
    sessionId: candidate.sessionId,
    pid: candidate.pid,
    updatedAt: candidate.updatedAt,
  };
}

/**
 * Whether `pid` names a running process.
 *
 * Signal `0` performs the permission and existence checks without delivering
 * anything. `EPERM` means the process exists under another user — reported as
 * alive, the direction that falls back to the timeout rather than abandoning a
 * request someone may still answer.
 */
function isRunningProcess(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isErrnoCode(error, "EPERM");
  }
}
