import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ForwardingLivenessJudge,
  type HeartbeatState,
  SERVING_HEARTBEAT_REFRESH_MS,
  SERVING_HEARTBEAT_STALE_MS,
  type ServingHeartbeat,
  ServingHeartbeatStore,
  servingHeartbeatDir,
  servingHeartbeatPath,
} from "#src/authority/forwarding-liveness";
import {
  PERMISSION_FORWARDING_POLL_INTERVAL_MS,
  type PermissionForwardingTarget,
} from "#src/authority/permission-forwarding";

let root: string;
let forwardingDir: string;
let clock: number;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "forwarding-liveness-"));
  forwardingDir = join(root, "forwarding");
  clock = 1_700_000_000_000;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeStore(
  overrides: Partial<
    ConstructorParameters<typeof ServingHeartbeatStore>[0]
  > = {},
) {
  const logger = { review: vi.fn(), debug: vi.fn() };
  const store = new ServingHeartbeatStore({
    forwardingDir,
    logger,
    now: () => clock,
    pid: 4242,
    ...overrides,
  });
  return { store, logger };
}

function readRecord(sessionId: string): ServingHeartbeat {
  return JSON.parse(
    readFileSync(servingHeartbeatPath(forwardingDir, sessionId), "utf-8"),
  ) as ServingHeartbeat;
}

describe("timing constants", () => {
  it("refreshes less often than the inbox is polled, so a per-tick call is cheap", () => {
    expect(SERVING_HEARTBEAT_REFRESH_MS).toBeGreaterThan(
      PERMISSION_FORWARDING_POLL_INTERVAL_MS,
    );
  });

  it("tolerates several missed refreshes before calling a record stale", () => {
    expect(SERVING_HEARTBEAT_STALE_MS).toBeGreaterThan(
      SERVING_HEARTBEAT_REFRESH_MS * 2,
    );
  });
});

describe("servingHeartbeatPath", () => {
  it("places the record beside the sessions tree, not inside it", () => {
    expect(servingHeartbeatDir(forwardingDir)).toBe(
      join(forwardingDir, "serving"),
    );
    expect(servingHeartbeatPath(forwardingDir, "sess-1")).toBe(
      join(forwardingDir, "serving", "sess-1.json"),
    );
  });

  it("encodes a session id that would otherwise escape the directory", () => {
    expect(servingHeartbeatPath(forwardingDir, "a/../b")).toBe(
      join(forwardingDir, "serving", "a%2F..%2Fb.json"),
    );
  });
});

describe("ServingHeartbeatStore.markServing", () => {
  it("publishes the session id, the serving process, and the write time", () => {
    const { store } = makeStore();
    store.markServing("sess-1");
    expect(readRecord("sess-1")).toEqual({
      sessionId: "sess-1",
      pid: 4242,
      updatedAt: clock,
    });
  });

  it("creates the record owner-only inside an owner-only directory", () => {
    const { store } = makeStore();
    store.markServing("sess-1");
    expect(
      statSync(servingHeartbeatPath(forwardingDir, "sess-1")).mode & 0o777,
    ).toBe(0o600);
    expect(statSync(servingHeartbeatDir(forwardingDir)).mode & 0o777).toBe(
      0o700,
    );
  });

  it("does not rewrite within the refresh window, so a per-tick caller is cheap", () => {
    const { store } = makeStore();
    store.markServing("sess-1");
    clock += SERVING_HEARTBEAT_REFRESH_MS - 1;
    store.markServing("sess-1");
    expect(readRecord("sess-1").updatedAt).toBe(
      clock - (SERVING_HEARTBEAT_REFRESH_MS - 1),
    );
  });

  it("rewrites once the refresh window has elapsed", () => {
    const { store } = makeStore();
    store.markServing("sess-1");
    clock += SERVING_HEARTBEAT_REFRESH_MS;
    store.markServing("sess-1");
    expect(readRecord("sess-1").updatedAt).toBe(clock);
  });

  it("rewrites immediately for a different session id", () => {
    const { store } = makeStore();
    store.markServing("sess-1");
    clock += 1;
    store.markServing("sess-2");
    expect(readRecord("sess-2").updatedAt).toBe(clock);
    expect(readRecord("sess-1").updatedAt).toBe(clock - 1);
  });

  it("republishes at the next refresh boundary when the record was removed underneath it", () => {
    // The gap is bounded by the refresh window, which is shorter than the
    // grace a forwarding child waits out — so a pruned or externally deleted
    // record cannot make a live session look unserved for long enough to
    // abandon a request.
    const { store } = makeStore();
    store.markServing("sess-1");
    rmSync(servingHeartbeatPath(forwardingDir, "sess-1"));
    clock += SERVING_HEARTBEAT_REFRESH_MS;
    store.markServing("sess-1");
    expect(readRecord("sess-1").updatedAt).toBe(clock);
  });

  it("reports an unusable directory instead of throwing out of the poll timer", () => {
    writeFileSync(join(root, "blocker"), "not a directory", "utf-8");
    const { store, logger } = makeStore({
      forwardingDir: join(root, "blocker", "forwarding"),
    });
    expect(() => {
      store.markServing("sess-1");
    }).not.toThrow();
    expect(logger.review).toHaveBeenCalledWith(
      "permission_forwarding.error",
      expect.objectContaining({ message: expect.stringContaining("serving") }),
    );
  });
});

describe("ServingHeartbeatStore.clearServing", () => {
  it("withdraws the record", () => {
    const { store } = makeStore();
    store.markServing("sess-1");
    store.clearServing("sess-1");
    expect(existsSync(servingHeartbeatPath(forwardingDir, "sess-1"))).toBe(
      false,
    );
  });

  it("leaves the directory in place, so a sibling session's write cannot race it", () => {
    const { store } = makeStore();
    store.markServing("sess-1");
    store.clearServing("sess-1");
    expect(existsSync(servingHeartbeatDir(forwardingDir))).toBe(true);
  });

  it("leaves a sibling session's record untouched", () => {
    const { store } = makeStore();
    store.markServing("sess-1");
    store.markServing("sess-2");
    store.clearServing("sess-1");
    expect(readRecord("sess-2").sessionId).toBe("sess-2");
  });

  it("is a no-op for a session that was never marked", () => {
    const { store, logger } = makeStore();
    expect(() => {
      store.clearServing("sess-1");
    }).not.toThrow();
    expect(logger.review).not.toHaveBeenCalled();
  });

  it("republishes after a withdrawal rather than staying throttled", () => {
    const { store } = makeStore();
    store.markServing("sess-1");
    store.clearServing("sess-1");
    clock += 1;
    store.markServing("sess-1");
    expect(readRecord("sess-1").updatedAt).toBe(clock);
  });
});

/** Publishes a record directly, standing in for another process's session. */
function publishRecord(
  sessionId: string,
  overrides: Partial<ServingHeartbeat> = {},
): void {
  mkdirSync(servingHeartbeatDir(forwardingDir), { recursive: true });
  writeFileSync(
    servingHeartbeatPath(forwardingDir, sessionId),
    JSON.stringify({ sessionId, pid: 4242, updatedAt: clock, ...overrides }),
    "utf-8",
  );
}

/** Publishes an unusable record, standing in for a truncated or foreign write. */
function publishRaw(sessionId: string, contents: string): void {
  mkdirSync(servingHeartbeatDir(forwardingDir), { recursive: true });
  writeFileSync(
    servingHeartbeatPath(forwardingDir, sessionId),
    contents,
    "utf-8",
  );
}

/** Only pid 4242 is running, unless a test says otherwise. */
const onlyOwnPidAlive = (pid: number): boolean => pid === 4242;

describe("ServingHeartbeatStore.read", () => {
  it("reports absent when the session has published nothing", () => {
    const { store } = makeStore({ isProcessAlive: onlyOwnPidAlive });
    expect(store.read("sess-1")).toBe("absent");
  });

  it("reports alive for a fresh record whose process is running", () => {
    publishRecord("sess-1");
    const { store } = makeStore({ isProcessAlive: onlyOwnPidAlive });
    expect(store.read("sess-1")).toBe("alive");
  });

  it("reports alive one tick short of the staleness window", () => {
    publishRecord("sess-1");
    clock += SERVING_HEARTBEAT_STALE_MS - 1;
    const { store } = makeStore({ isProcessAlive: onlyOwnPidAlive });
    expect(store.read("sess-1")).toBe("alive");
  });

  it("reports stale once the record outlives the staleness window", () => {
    publishRecord("sess-1");
    clock += SERVING_HEARTBEAT_STALE_MS;
    const { store } = makeStore({ isProcessAlive: onlyOwnPidAlive });
    expect(store.read("sess-1")).toBe("stale");
  });

  it("reports dead_pid when the recorded process is gone", () => {
    publishRecord("sess-1", { pid: 9999 });
    const { store } = makeStore({ isProcessAlive: onlyOwnPidAlive });
    expect(store.read("sess-1")).toBe("dead_pid");
  });

  it("names the dead process rather than the age, when the record is both", () => {
    publishRecord("sess-1", { pid: 9999 });
    clock += SERVING_HEARTBEAT_STALE_MS;
    const { store } = makeStore({ isProcessAlive: onlyOwnPidAlive });
    expect(store.read("sess-1")).toBe("dead_pid");
  });

  it("reports absent for an unparseable record", () => {
    publishRaw("sess-1", "{ truncated");
    const { store } = makeStore({ isProcessAlive: onlyOwnPidAlive });
    expect(store.read("sess-1")).toBe("absent");
  });

  it("reports absent rather than probing a pid that names no process", () => {
    // `process.kill(0, 0)` addresses the caller's own process group, so a
    // malformed record must never reach the liveness probe.
    publishRecord("sess-1", { pid: 0 });
    const isProcessAlive = vi.fn(onlyOwnPidAlive);
    const { store } = makeStore({ isProcessAlive });
    expect(store.read("sess-1")).toBe("absent");
    expect(isProcessAlive).not.toHaveBeenCalled();
  });

  it("does not flood the log while a child polls an unreadable record", () => {
    publishRaw("sess-1", "{ truncated");
    const { store, logger } = makeStore({ isProcessAlive: onlyOwnPidAlive });
    store.read("sess-1");
    store.read("sess-1");
    expect(logger.review).not.toHaveBeenCalled();
  });
});

describe("ServingHeartbeatStore.servingIds", () => {
  it("is empty when nothing has been published", () => {
    const { store } = makeStore({ isProcessAlive: onlyOwnPidAlive });
    expect(store.servingIds()).toEqual([]);
  });

  it("lists the sessions whose records read as alive", () => {
    publishRecord("sess-1");
    publishRecord("sess-2");
    const { store } = makeStore({ isProcessAlive: onlyOwnPidAlive });
    expect([...store.servingIds()].sort()).toEqual(["sess-1", "sess-2"]);
  });

  it("omits a session whose process is gone", () => {
    publishRecord("sess-1");
    publishRecord("sess-2", { pid: 9999 });
    const { store } = makeStore({ isProcessAlive: onlyOwnPidAlive });
    expect(store.servingIds()).toEqual(["sess-1"]);
  });

  it("reports the session's own id, not its encoded filename", () => {
    publishRecord("a/b");
    const { store } = makeStore({ isProcessAlive: onlyOwnPidAlive });
    expect(store.servingIds()).toEqual(["a/b"]);
  });
});

describe("ServingHeartbeatStore pruning", () => {
  it("removes a record left behind by a process that is gone", () => {
    publishRecord("dead-session", { pid: 9999 });
    const { store } = makeStore({ isProcessAlive: onlyOwnPidAlive });
    store.markServing("sess-1");
    expect(
      existsSync(servingHeartbeatPath(forwardingDir, "dead-session")),
    ).toBe(false);
  });

  it("removes a record no reader could use", () => {
    publishRaw("corrupt-session", "{ truncated");
    const { store } = makeStore({ isProcessAlive: onlyOwnPidAlive });
    store.markServing("sess-1");
    expect(
      existsSync(servingHeartbeatPath(forwardingDir, "corrupt-session")),
    ).toBe(false);
  });

  it("keeps a stale record whose process is still running", () => {
    // Being behind on refreshes is not proof of death, and the reader already
    // reports it as stale without the record having to be removed.
    publishRecord("slow-session", {
      updatedAt: clock - SERVING_HEARTBEAT_STALE_MS,
    });
    const { store } = makeStore({ isProcessAlive: onlyOwnPidAlive });
    store.markServing("sess-1");
    expect(
      existsSync(servingHeartbeatPath(forwardingDir, "slow-session")),
    ).toBe(true);
  });

  it("publishes its own record alongside the sweep", () => {
    publishRecord("dead-session", { pid: 9999 });
    const { store } = makeStore({ isProcessAlive: onlyOwnPidAlive });
    store.markServing("sess-1");
    expect(readRecord("sess-1").sessionId).toBe("sess-1");
  });

  it("sweeps once per session rather than on every refresh", () => {
    const { store } = makeStore({ isProcessAlive: onlyOwnPidAlive });
    store.markServing("sess-1");
    publishRecord("dead-session", { pid: 9999 });
    clock += SERVING_HEARTBEAT_REFRESH_MS;
    store.markServing("sess-1");
    expect(
      existsSync(servingHeartbeatPath(forwardingDir, "dead-session")),
    ).toBe(true);
  });
});

const REGISTRY_TARGET: PermissionForwardingTarget = {
  sessionId: "parent",
  source: "registry",
};
const ENV_TARGET: PermissionForwardingTarget = {
  sessionId: "parent",
  source: "env",
};
const SELF_TARGET: PermissionForwardingTarget = {
  sessionId: "parent",
  source: "self",
};

function makeRegistry(marked: string[] = []) {
  return {
    isServing: vi.fn((sessionId: string) => marked.includes(sessionId)),
    servingIds: vi.fn((): readonly string[] => marked),
  };
}

function makeHeartbeats(state: HeartbeatState, ids: string[] = []) {
  return {
    read: vi.fn((): HeartbeatState => state),
    servingIds: vi.fn((): readonly string[] => ids),
  };
}

describe("ForwardingLivenessJudge.isServing", () => {
  it("answers an in-process target from the registry", () => {
    const judge = new ForwardingLivenessJudge({
      registry: makeRegistry(["parent"]),
      heartbeats: makeHeartbeats("absent"),
    });
    expect(judge.isServing(REGISTRY_TARGET)).toBe(true);
  });

  it("reports an unmarked in-process target as not serving", () => {
    const judge = new ForwardingLivenessJudge({
      registry: makeRegistry(),
      heartbeats: makeHeartbeats("alive"),
    });
    expect(judge.isServing(REGISTRY_TARGET)).toBe(false);
  });

  it("answers an out-of-process target from the filesystem heartbeat", () => {
    const judge = new ForwardingLivenessJudge({
      registry: makeRegistry(),
      heartbeats: makeHeartbeats("alive"),
    });
    expect(judge.isServing(ENV_TARGET)).toBe(true);
  });

  it.each([
    "absent",
    "stale",
    "dead_pid",
  ] as const)("reports an out-of-process target as not serving when its heartbeat is %s", (state) => {
    const judge = new ForwardingLivenessJudge({
      registry: makeRegistry(["parent"]),
      heartbeats: makeHeartbeats(state),
    });
    expect(judge.isServing(ENV_TARGET)).toBe(false);
  });

  it("declines to judge a session that owns the inbox it is forwarding to", () => {
    const judge = new ForwardingLivenessJudge({
      registry: makeRegistry(),
      heartbeats: makeHeartbeats("absent"),
    });
    expect(judge.isServing(SELF_TARGET)).toBeNull();
  });

  it("does not touch the filesystem for an in-process target", () => {
    const heartbeats = makeHeartbeats("absent");
    const judge = new ForwardingLivenessJudge({
      registry: makeRegistry(["parent"]),
      heartbeats,
    });
    judge.isServing(REGISTRY_TARGET);
    expect(heartbeats.read).not.toHaveBeenCalled();
  });

  it("does not consult the registry for an out-of-process target", () => {
    // Its parent lives in another process, so an absent mark would say nothing
    // — reading one would fast-fail every out-of-process child.
    const registry = makeRegistry();
    const judge = new ForwardingLivenessJudge({
      registry,
      heartbeats: makeHeartbeats("alive"),
    });
    judge.isServing(ENV_TARGET);
    expect(registry.isServing).not.toHaveBeenCalled();
  });
});

describe("ForwardingLivenessJudge.describe", () => {
  it("names the registry channel and the ids it observed", () => {
    const judge = new ForwardingLivenessJudge({
      registry: makeRegistry(["other-parent"]),
      heartbeats: makeHeartbeats("alive", ["unrelated"]),
    });
    expect(judge.describe(REGISTRY_TARGET)).toEqual({
      channel: "registry",
      state: null,
      servingIds: ["other-parent"],
    });
  });

  it("names the heartbeat channel, the state it read, and the ids it observed", () => {
    const judge = new ForwardingLivenessJudge({
      registry: makeRegistry(["unrelated"]),
      heartbeats: makeHeartbeats("dead_pid", ["other-parent"]),
    });
    expect(judge.describe(ENV_TARGET)).toEqual({
      channel: "heartbeat",
      state: "dead_pid",
      servingIds: ["other-parent"],
    });
  });

  it("reports no channel for a target it does not judge", () => {
    const judge = new ForwardingLivenessJudge({
      registry: makeRegistry(["unrelated"]),
      heartbeats: makeHeartbeats("alive", ["unrelated"]),
    });
    expect(judge.describe(SELF_TARGET)).toEqual({
      channel: "none",
      state: null,
      servingIds: [],
    });
  });
});
