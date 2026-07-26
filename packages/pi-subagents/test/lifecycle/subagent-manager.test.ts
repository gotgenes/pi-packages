import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConcurrencyLimiter } from "#src/lifecycle/concurrency-limiter";
import type { CreateSubagentSessionParams } from "#src/lifecycle/create-subagent-session";
import { SubagentManager, type SubagentManagerObserver } from "#src/lifecycle/subagent-manager";
import type { SubagentSession } from "#src/lifecycle/subagent-session";
import type { WorkspaceProvider } from "#src/lifecycle/workspace";
import { NotificationManager } from "#src/observation/notification";
import type { RunConfig } from "#src/runtime";
import type { Subagent } from "#src/types";
import { createBlockingFactory, createSessionFactory } from "#test/helpers/manager-stubs";
import { createMockSession, createSubagentSessionStub, emitResumeUsageAndCompaction, toSubagentSession } from "#test/helpers/mock-session";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";

/** Default max concurrent background agents (matches production default). */
const DEFAULT_MAX_CONCURRENT = 4;

type SessionFactory = (params: CreateSubagentSessionParams) => Promise<SubagentSession>;

/** Default factory: resolves to a fresh SubagentSession stub on every spawn. */
function defaultFactory(): SessionFactory {
  return vi.fn(async (_params: CreateSubagentSessionParams) => toSubagentSession(createSubagentSessionStub()));
}

/** Test helper: construct an SubagentManager with injected stubs. */
function createManager(overrides?: {
  createSubagentSession?: SessionFactory;
  observer?: Partial<SubagentManagerObserver>;
  getMaxConcurrent?: () => number;
  getRunConfig?: () => RunConfig;
  getRetentionPolicy?: () => { consumedSessionRetentionMinutes: number; unconsumedSessionRetentionMinutes: number };
  baseCwd?: string;
}) {
  const createSubagentSession: SessionFactory = overrides?.createSubagentSession ?? defaultFactory();
  const observer: SubagentManagerObserver | undefined = overrides?.observer
    ? {
        onSubagentStarted: overrides.observer.onSubagentStarted ?? (() => {}),
        onSubagentCompleted: overrides.observer.onSubagentCompleted ?? (() => {}),
        onSubagentResumed: overrides.observer.onSubagentResumed ?? (() => {}),
        onSubagentCompacted: overrides.observer.onSubagentCompacted ?? (() => {}),
        onSubagentCreated: overrides.observer.onSubagentCreated ?? (() => {}),
      }
    : undefined;
  const limiter = new ConcurrencyLimiter(overrides?.getMaxConcurrent ?? (() => DEFAULT_MAX_CONCURRENT));
  const mgr = new SubagentManager({
    createSubagentSession,
    observer,
    limiter,
    baseCwd: overrides?.baseCwd ?? "/repo",
    getRunConfig: overrides?.getRunConfig,
    getRetentionPolicy: overrides?.getRetentionPolicy,
  });
  return { manager: mgr, createSubagentSession, limiter };
}

/** Spawn a background agent using STUB_SNAPSHOT. */
function spawnBg(mgr: SubagentManager, prompt = "test", desc = prompt) {
  return mgr.spawn(STUB_SNAPSHOT, "general-purpose", prompt, {
    description: desc,
    isBackground: true,
  });
}

/** Spawn a foreground agent using STUB_SNAPSHOT. */
function spawnFg(mgr: SubagentManager, prompt = "test", desc = prompt) {
  return mgr.spawnAndWait(STUB_SNAPSHOT, "general-purpose", prompt, {
    description: desc,
  });
}

/** Spawn a background agent carrying a parentSession.toolCallId (notification path). */
function spawnBgWithToolCall(mgr: SubagentManager, toolCallId: string, prompt = "test", desc = prompt) {
  return mgr.spawn(STUB_SNAPSHOT, "general-purpose", prompt, {
    description: desc,
    isBackground: true,
    parentSession: { toolCallId },
  });
}

/** Arrange a manager at limit 1 with two bg agents over a blocking factory: first runs, second queues. */
function arrangeQueuedPair() {
  const factory = createBlockingFactory();
  const { manager: mgr } = createManager({ createSubagentSession: factory, getMaxConcurrent: () => 1 });
  const running = spawnBg(mgr, "a");
  const queued = spawnBg(mgr, "b");
  return { manager: mgr, factory, running, queued };
}

/**
 * Arrange a manager whose onSubagentCompleted observer forwards to a real
 * NotificationManager (mirroring SubagentEventsObserver's unconditional
 * sendCompletion delegation), with one background agent spawned via a tool
 * call. The act (when the record is marked consumed relative to awaiting)
 * stays in each test.
 */
function seedNotificationScenario() {
  const sendMessage = vi.fn();
  const notifications = new NotificationManager(sendMessage);
  const { manager } = createManager({
    observer: { onSubagentCompleted: (r) => notifications.sendCompletion(r) },
  });
  const id = spawnBgWithToolCall(manager, "tc-1");
  const record = manager.getRecord(id)!;
  return { manager, record, notifications, sendMessage };
}

describe("SubagentManager — Bug 1 race condition (consumed state vs onComplete)", () => {
  let manager: SubagentManager;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    manager.dispose();
    vi.useRealTimers();
  });

  it("marking consumed after awaiting still suppresses the nudge (fire-time re-check)", async () => {
    const seeded = seedNotificationScenario();
    manager = seeded.manager;
    const { record, sendMessage } = seeded;

    // onSubagentCompleted already scheduled the nudge by the time this await
    // resumes (it fires synchronously inside record.promise's resolution
    // chain). The parent pulls the result (markConsumed) during the nudge's
    // hold window; the notification manager re-reads record.consumed at fire
    // time and skips the nudge — no separate cancel call needed.
    await record.promise;
    record.markConsumed();

    await vi.advanceTimersByTimeAsync(300);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("marking consumed before await suppresses the nudge (schedule-time guard)", async () => {
    const seeded = seedNotificationScenario();
    manager = seeded.manager;
    const { record, sendMessage } = seeded;

    // The parent already holds the result: sendCompletion sees record.consumed
    // at schedule time and never arms the timer.
    record.markConsumed();
    await record.promise;

    await vi.advanceTimersByTimeAsync(300);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("onComplete is not called for foreground agents", async () => {
    let onCompleteCalled = false;
    ({ manager } = createManager({ observer: { onSubagentCompleted: () => {
      onCompleteCalled = true;
    } } }));

    await spawnFg(manager);

    expect(onCompleteCalled).toBe(false);
  });
});

describe("SubagentManager — completion callbacks", () => {
  let manager: SubagentManager;

  afterEach(() => {
    manager.dispose();
  });

  it("does not let onComplete errors turn a completed agent into a failed run", async () => {
    ({ manager } = createManager({ observer: { onSubagentCompleted: () => {
      throw new Error("stale extension context");
    } } }));

    const id = spawnBg(manager);
    await expect(manager.getRecord(id)!.promise).resolves.toBeUndefined();

    expect(manager.getRecord(id)!.status).toBe("completed");
  });
});

describe("SubagentManager — cleanup timer", () => {
  let manager: SubagentManager;

  afterEach(() => {
    manager.dispose();
  });

  it("does not keep the process alive on its own", () => {
    ({ manager } = createManager());

    expect((manager as any).sweepInterval.hasRef()).toBe(false);
  });
});

describe("SubagentManager — Bug 3 clearCompleted", () => {
  let manager: SubagentManager;

  afterEach(() => {
    manager.dispose();
  });

  it("clearCompleted removes completed records", async () => {
    ({ manager } = createManager());

    const id = spawnBg(manager);
    await manager.getRecord(id)!.promise;

    expect(manager.listAgents()).toHaveLength(1);
    manager.clearCompleted();
    expect(manager.listAgents()).toHaveLength(0);
  });

  it("clearCompleted does not remove running or queued agents", async () => {
    // Use maxConcurrent=1 to keep second agent queued; factory never resolves
    ({ manager } = createManager({ getMaxConcurrent: () => 1, createSubagentSession: createBlockingFactory() }));

    const id1 = spawnBg(manager, "test1", "running agent");
    // Second agent should be queued (limit=1)
    const id2 = spawnBg(manager, "test2", "queued agent");

    expect(manager.getRecord(id1)!.status).toBe("running");
    expect(manager.getRecord(id2)!.status).toBe("queued");

    manager.clearCompleted();

    // Both should still be present
    expect(manager.getRecord(id1)).toBeDefined();
    expect(manager.getRecord(id2)).toBeDefined();

    // Abort to allow cleanup
    manager.abort(id1);
    manager.abort(id2);
  });

  it("clearCompleted calls dispose on sessions of removed records", async () => {
    const disposeSpy = vi.fn();
    const sess = createMockSession({ dispose: disposeSpy });
    const { factory } = createSessionFactory(sess);
    ({ manager } = createManager({ createSubagentSession: factory }));

    const id = spawnBg(manager);
    await manager.getRecord(id)!.promise;

    manager.clearCompleted();

    expect(disposeSpy).toHaveBeenCalledOnce();
  });

  it("clearCompleted removes error and stopped records", async () => {
    const { factory, stub } = createSessionFactory();
    stub.runTurnLoop.mockRejectedValue(new Error("boom"));
    ({ manager } = createManager({ createSubagentSession: factory }));

    const id = spawnBg(manager);
    await manager.getRecord(id)!.promise;
    expect(manager.getRecord(id)!.status).toBe("error");

    manager.clearCompleted();
    expect(manager.getRecord(id)).toBeUndefined();
  });
});

describe("SubagentManager — consumption-aware session release sweep", () => {
  let manager: SubagentManager;

  afterEach(() => {
    vi.restoreAllMocks();
    manager.dispose();
  });

  /** Spawn a background agent over a session factory and await its completion. */
  async function spawnCompleted(
    outputFile: string | undefined = "/tasks/agent.jsonl",
    getRetentionPolicy?: () => { consumedSessionRetentionMinutes: number; unconsumedSessionRetentionMinutes: number },
  ): Promise<string> {
    const { factory } = createSessionFactory(createMockSession(), outputFile);
    ({ manager } = createManager({ createSubagentSession: factory, getRetentionPolicy }));
    const id = spawnBg(manager, "test", "investigate the bug");
    await manager.getRecord(id)!.promise;
    return id;
  }

  it("releases a consumed agent's session 10 min after consumption but keeps the record", async () => {
    const id = await spawnCompleted("/tasks/agent.jsonl");
    const record = manager.getRecord(id)!;
    const completedAt = record.completedAt!;
    record.markConsumed(completedAt + 5 * 60_000); // consumed 5 min after completion
    const nowSpy = vi.spyOn(Date, "now");

    // 10 min after completion is only 5 min after consumption → still retained.
    nowSpy.mockReturnValue(completedAt + 10 * 60_000);
    (manager as any).sweep();
    expect(manager.getRecord(id)!.isSessionReady()).toBe(true);

    // 10 min after consumption → session released, record survives.
    nowSpy.mockReturnValue(completedAt + 15 * 60_000);
    (manager as any).sweep();
    const swept = manager.getRecord(id)!;
    expect(swept).toBeDefined();
    expect(swept.isSessionReady()).toBe(false);
    expect(swept.outputFile).toBe("/tasks/agent.jsonl");
  });

  it("holds an unconsumed agent's session past 10 min and releases it at the cap", async () => {
    const id = await spawnCompleted("/tasks/agent.jsonl");
    const completedAt = manager.getRecord(id)!.completedAt!;
    const nowSpy = vi.spyOn(Date, "now");

    nowSpy.mockReturnValue(completedAt + 11 * 60_000); // past the consumed window
    (manager as any).sweep();
    expect(manager.getRecord(id)!.isSessionReady()).toBe(true); // unconsumed → held

    nowSpy.mockReturnValue(completedAt + 721 * 60_000); // past the 12h cap
    (manager as any).sweep();
    expect(manager.getRecord(id)!.isSessionReady()).toBe(false);
  });

  it("never releases a running or queued agent's session", async () => {
    ({ manager } = createManager({ getMaxConcurrent: () => 1, createSubagentSession: createBlockingFactory() }));
    const runningId = spawnBg(manager, "t1");
    const queuedId = spawnBg(manager, "t2");
    expect(manager.getRecord(runningId)!.status).toBe("running");
    expect(manager.getRecord(queuedId)!.status).toBe("queued");
    const runRelease = vi.spyOn(manager.getRecord(runningId)!, "releaseSession");
    const queueRelease = vi.spyOn(manager.getRecord(queuedId)!, "releaseSession");

    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10_000 * 60_000);
    (manager as any).sweep();

    expect(runRelease).not.toHaveBeenCalled();
    expect(queueRelease).not.toHaveBeenCalled();
    manager.abort(runningId);
    manager.abort(queuedId);
  });

  it("honors a custom retention policy from getRetentionPolicy", async () => {
    const id = await spawnCompleted("/t.jsonl", () => ({
      consumedSessionRetentionMinutes: 1,
      unconsumedSessionRetentionMinutes: 2,
    }));
    const record = manager.getRecord(id)!;
    const completedAt = record.completedAt!;
    record.markConsumed(completedAt);
    vi.spyOn(Date, "now").mockReturnValue(completedAt + 2 * 60_000); // 2 min > 1 min window
    (manager as any).sweep();
    expect(manager.getRecord(id)!.isSessionReady()).toBe(false);
  });

  it("leaves records in place after release (getRecord still resolves them)", async () => {
    const id = await spawnCompleted("/tasks/agent.jsonl");
    const completedAt = manager.getRecord(id)!.completedAt!;
    vi.spyOn(Date, "now").mockReturnValue(completedAt + 721 * 60_000);
    (manager as any).sweep();
    expect(manager.listAgents()).toHaveLength(1);
    expect(manager.getRecord(id)).toBeDefined();
  });
});

// Eager init removes the optional/required asymmetry that previously required
// `??=` defaults at the callback sites and `?? 0` / `?? 1` at the read sites.
describe("SubagentManager — lifetime usage + compaction count are eagerly initialized", () => {
  let manager: SubagentManager;

  afterEach(() => {
    manager.dispose();
  });

  it("spawn initializes lifetimeUsage to zeros and compactionCount to 0", () => {
    // Factory never resolves — we just want to inspect the record at spawn time.
    ({ manager } = createManager({ createSubagentSession: createBlockingFactory() }));

    const id = spawnBg(manager);
    const record = manager.getRecord(id)!;

    expect(record.lifetimeUsage).toEqual({ input: 0, output: 0, cacheWrite: 0 });
    expect(record.compactionCount).toBe(0);

    manager.abort(id);
  });

  it("record observer accumulates assistant usage into record.lifetimeUsage", async () => {
    // The record observer subscribes to session events via the wired subagentSession.
    // Emitting message_end events from runTurnLoop drives stats.
    const session = createMockSession();
    const { factory, stub } = createSessionFactory(session);
    stub.runTurnLoop.mockImplementation(async () => {
      session.emit({ type: "message_end", message: { role: "assistant", usage: { input: 100, output: 50, cacheWrite: 10 } } });
      session.emit({ type: "message_end", message: { role: "assistant", usage: { input: 200, output: 80, cacheWrite: 20 } } });
      return { responseText: "done", aborted: false, steered: false };
    });
    ({ manager } = createManager({ createSubagentSession: factory }));

    const id = spawnBg(manager);
    await manager.getRecord(id)!.promise;

    expect(manager.getRecord(id)!.lifetimeUsage).toEqual({
      input: 300, output: 130, cacheWrite: 30,
    });
  });

  it("record observer increments compactionCount on compaction_end events", async () => {
    const compactSeen: any[] = [];

    const session = createMockSession();
    const { factory, stub } = createSessionFactory(session);
    stub.runTurnLoop.mockImplementation(async () => {
      // Compaction fires while the agent is still running — the record passed to
      // onCompact should reflect the just-incremented count.
      session.emit({ type: "compaction_end", aborted: false, result: { tokensBefore: 12345 }, reason: "threshold" });
      session.emit({ type: "compaction_end", aborted: false, result: { tokensBefore: 22222 }, reason: "manual" });
      return { responseText: "done", aborted: false, steered: false };
    });

    ({ manager } = createManager({ createSubagentSession: factory, observer: { onSubagentCompacted: (record, info) => {
      compactSeen.push({ count: record.compactionCount, reason: info.reason });
    } } }));

    const id = spawnBg(manager);
    await manager.getRecord(id)!.promise;

    expect(compactSeen).toEqual([
      { count: 1, reason: "threshold" },
      { count: 2, reason: "manual" },
    ]);
    expect(manager.getRecord(id)!.compactionCount).toBe(2);
  });

  it("resume() also accumulates usage and increments compactions on the same record", async () => {
    // Spawn with a subscribable session that resume can latch onto.
    const session = createMockSession();
    const { factory, stub } = createSessionFactory(session);
    stub.resumeTurnLoop.mockImplementation(async () => {
      // Emit events through the session — the record observer subscribed by
      // SubagentManager.resume() will pick them up.
      emitResumeUsageAndCompaction(session);
      return "second";
    });
    ({ manager } = createManager({ createSubagentSession: factory }));

    const id = spawnBg(manager);
    await manager.getRecord(id)!.promise;

    // Pre-resume: lifetimeUsage from spawn was zero (run did not emit usage events)
    expect(manager.getRecord(id)!.lifetimeUsage).toEqual({ input: 0, output: 0, cacheWrite: 0 });
    expect(manager.getRecord(id)!.compactionCount).toBe(0);

    await manager.resume(id, "more");

    expect(manager.getRecord(id)!.lifetimeUsage).toEqual({ input: 70, output: 30, cacheWrite: 5 });
    expect(manager.getRecord(id)!.compactionCount).toBe(1);
  });
});

describe("SubagentManager — getRunConfig threads defaultMaxTurns and graceTurns into the turn loop", () => {
  let manager: SubagentManager;

  afterEach(() => {
    manager.dispose();
  });

  it("passes defaultMaxTurns and graceTurns from getRunConfig to runTurnLoop", async () => {
    const getRunConfig = vi.fn(() => ({ defaultMaxTurns: 10, graceTurns: 3 }));
    const { factory, stub } = createSessionFactory();
    ({ manager } = createManager({ getRunConfig, createSubagentSession: factory }));

    const id = spawnBg(manager);
    await manager.getRecord(id)!.promise;

    const turnOpts = stub.runTurnLoop.mock.calls[0][1];
    expect(turnOpts.defaultMaxTurns).toBe(10);
    expect(turnOpts.graceTurns).toBe(3);
  });

  it("omits defaultMaxTurns and graceTurns from runTurnLoop when no getRunConfig is provided", async () => {
    const { factory, stub } = createSessionFactory();
    ({ manager } = createManager({ createSubagentSession: factory }));

    const id = spawnBg(manager);
    await manager.getRecord(id)!.promise;

    const turnOpts = stub.runTurnLoop.mock.calls[0][1];
    expect(turnOpts.defaultMaxTurns).toBeUndefined();
    expect(turnOpts.graceTurns).toBeUndefined();
  });
});

describe("SubagentManager — parent session threading", () => {
  let manager: SubagentManager;

  afterEach(() => {
    manager.dispose();
  });

  it("threads parentSession from AgentSpawnConfig to the factory params", async () => {
    const { factory } = createSessionFactory();
    ({ manager } = createManager({ createSubagentSession: factory }));

    manager.spawn(STUB_SNAPSHOT, "general-purpose", "test", {
      description: "test",
      isBackground: true,
      parentSession: { parentSessionFile: "/sessions/parent.jsonl", parentSessionId: "parent-session-123" },
    });

    await vi.waitFor(() => expect(factory).toHaveBeenCalled());

    const params = vi.mocked(factory).mock.calls[0][0];
    expect(params.parentSession?.parentSessionFile).toBe("/sessions/parent.jsonl");
    expect(params.parentSession?.parentSessionId).toBe("parent-session-123");
  });
});

describe("SubagentManager — dependency injection via options bag", () => {
  let manager: SubagentManager;

  afterEach(() => {
    manager.dispose();
  });

  it("calls the injected factory when spawning an agent", async () => {
    const { factory } = createSessionFactory();
    ({ manager } = createManager({ createSubagentSession: factory }));

    const id = spawnBg(manager);
    await manager.getRecord(id)!.promise;

    expect(factory).toHaveBeenCalledOnce();
    expect(manager.getRecord(id)!.result).toBe("done");
  });

  it("calls resumeTurnLoop on the SubagentSession when resuming an agent", async () => {
    const { factory, stub } = createSessionFactory();
    stub.resumeTurnLoop.mockResolvedValue("second");
    ({ manager } = createManager({ createSubagentSession: factory }));

    const id = spawnBg(manager);
    await manager.getRecord(id)!.promise;

    await manager.resume(id, "continue");

    expect(stub.resumeTurnLoop).toHaveBeenCalledOnce();
    expect(manager.getRecord(id)!.result).toBe("second");
  });

  it("fires onSubagentResumed when a background agent is resumed", async () => {
    const onSubagentResumed = vi.fn();
    const { factory, stub } = createSessionFactory();
    stub.resumeTurnLoop.mockResolvedValue("second");
    ({ manager } = createManager({ createSubagentSession: factory, observer: { onSubagentResumed } }));

    const id = spawnBg(manager);
    await manager.getRecord(id)!.promise;
    await manager.resume(id, "continue");

    expect(onSubagentResumed).toHaveBeenCalledExactlyOnceWith(manager.getRecord(id));
  });

  it("does not fire onSubagentResumed when a foreground agent is resumed", async () => {
    const onSubagentResumed = vi.fn();
    const { factory, stub } = createSessionFactory();
    stub.resumeTurnLoop.mockResolvedValue("second");
    ({ manager } = createManager({ createSubagentSession: factory, observer: { onSubagentResumed } }));

    const record = await spawnFg(manager);
    await manager.resume(record.id, "continue");

    expect(onSubagentResumed).not.toHaveBeenCalled();
  });

});

describe("SubagentManager — queueing and concurrency with injected stubs", () => {
  let manager: SubagentManager;

  afterEach(() => {
    manager.dispose();
  });

  it("queues excess background agents and drains them in order", async () => {
    const startOrder: string[] = [];
    const { promise: gate1, resolve: resolve1 } = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
    const { promise: gate2, resolve: resolve2 } = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args

    let callCount = 0;
    const factory: SessionFactory = vi.fn(async () => {
      callCount++;
      const n = callCount;
      startOrder.push(`start-${n}`);
      const stub = createSubagentSessionStub();
      stub.runTurnLoop.mockImplementation(async () => {
        if (n === 1) await gate1;
        if (n === 2) await gate2;
        return { responseText: `result-${n}`, aborted: false, steered: false };
      });
      return toSubagentSession(stub);
    });
    ({ manager } = createManager({ createSubagentSession: factory, getMaxConcurrent: () => 1 }));

    // Spawn two background agents — first runs, second queues
    const id1 = spawnBg(manager, "test1", "first");
    const id2 = spawnBg(manager, "test2", "second");

    expect(manager.getRecord(id1)!.status).toBe("running");
    expect(manager.getRecord(id2)!.status).toBe("queued");

    // Complete first agent — second should start
    resolve1();
    await manager.getRecord(id1)!.promise;

    // Wait for the second to start
    await vi.waitFor(() => expect(manager.getRecord(id2)!.status).toBe("running"));

    resolve2();
    await manager.getRecord(id2)!.promise;

    expect(startOrder).toEqual(["start-1", "start-2"]);
    expect(manager.getRecord(id1)!.result).toBe("result-1");
    expect(manager.getRecord(id2)!.result).toBe("result-2");
  });

  it("gives a queued agent an awaitable promise at spawn (before its slot opens)", () => {
    const { manager: mgr, running, queued } = arrangeQueuedPair();
    manager = mgr;

    // A still-queued agent must already expose a settle-on-completion promise,
    // so waitForAll can await it without relying on a re-poll. (Regression
    // guard: #374 made the promise lazy; the limiter handle is captured eagerly.)
    expect(manager.getRecord(queued)!.status).toBe("queued");
    expect(manager.getRecord(queued)!.promise).toBeInstanceOf(Promise);

    manager.abort(running);
    manager.abort(queued);
  });

  it("abort removes a queued agent without ever running it", () => {
    const { manager: mgr, factory, running, queued } = arrangeQueuedPair();
    manager = mgr;

    expect(manager.getRecord(queued)!.status).toBe("queued");

    // Abort the queued agent
    expect(manager.abort(queued)).toBe(true);
    expect(manager.getRecord(queued)!.status).toBe("stopped");

    // factory was called once (for the first agent), never for the aborted one
    expect(factory).toHaveBeenCalledOnce();

    manager.abort(running);
  });

  it("onStart fires when agent transitions from queued to running", async () => {
    const startedIds: string[] = [];
    const { promise: gate, resolve } = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args

    let callCount = 0;
    const factory: SessionFactory = vi.fn(async () => {
      callCount++;
      const n = callCount;
      const stub = createSubagentSessionStub();
      stub.runTurnLoop.mockImplementation(async () => {
        if (n === 1) await gate;
        return { responseText: "ok", aborted: false, steered: false };
      });
      return toSubagentSession(stub);
    });
    ({ manager } = createManager({
      createSubagentSession: factory,
      getMaxConcurrent: () => 1,
      observer: { onSubagentStarted: (record) => { startedIds.push(record.id); } },
    }));

    const id1 = spawnBg(manager, "a");
    const id2 = spawnBg(manager, "b");

    // First agent started immediately
    expect(startedIds).toEqual([id1]);

    // Complete first — second should start and fire onStart
    resolve();
    await manager.getRecord(id1)!.promise;
    await vi.waitFor(() => expect(startedIds).toHaveLength(2));

    expect(startedIds).toEqual([id1, id2]);

    await manager.getRecord(id2)!.promise;
  });
});

describe("SubagentManager — subagent session state", () => {
  let manager: SubagentManager;

  afterEach(() => {
    manager.dispose();
  });

  it("sets record.subagentSession with session and outputFile after session creation", async () => {
    const session = createMockSession();
    const { factory } = createSessionFactory(session, "/tmp/session.jsonl");
    ({ manager } = createManager({ createSubagentSession: factory }));

    const id = spawnBg(manager);
    await manager.getRecord(id)!.promise;

    const record = manager.getRecord(id)!;
    expect(record.subagentSession).toBeDefined();
    expect(record.subagentSession!.session).toBe(session);
    expect(record.subagentSession!.outputFile).toBe("/tmp/session.jsonl");
  });

  it("record.subagentSession is undefined before the session is created", () => {
    ({ manager } = createManager({ createSubagentSession: createBlockingFactory() }));

    const id = spawnBg(manager);
    const record = manager.getRecord(id)!;
    expect(record.subagentSession).toBeUndefined();
    manager.abort(id);
  });
});


describe("SubagentManager — onSubagentCreated observer", () => {
  let manager: SubagentManager;

  afterEach(() => {
    manager.dispose();
  });

  it("fires onSubagentCreated when a background agent is spawned", () => {
    const onCreated = vi.fn();
    ({ manager } = createManager({ observer: { onSubagentCreated: onCreated } }));

    const id = manager.spawn(STUB_SNAPSHOT, "general-purpose", "test", {
      description: "test agent",
      isBackground: true,
    });

    expect(onCreated).toHaveBeenCalledOnce();
    expect(onCreated).toHaveBeenCalledWith(manager.getRecord(id));

    manager.abort(id);
  });

  it("does not fire onSubagentCreated for foreground agents", async () => {
    const onCreated = vi.fn();
    ({ manager } = createManager({ observer: { onSubagentCreated: onCreated } }));

    await manager.spawnAndWait(STUB_SNAPSHOT, "general-purpose", "test", {
      description: "foreground agent",
    });

    expect(onCreated).not.toHaveBeenCalled();
  });

  it("fires onSubagentCreated before onSubagentStarted for background agents", async () => {
    const callOrder: string[] = [];
    ({ manager } = createManager({
      observer: {
        onSubagentCreated: () => { callOrder.push("created"); },
        onSubagentStarted: () => { callOrder.push("started"); },
      },
    }));

    const id = manager.spawn(STUB_SNAPSHOT, "general-purpose", "test", {
      description: "bg agent",
      isBackground: true,
    });
    await manager.getRecord(id)!.promise;

    expect(callOrder).toEqual(["created", "started"]);
  });
});

describe("SubagentManager — lifecycle observer forwarding", () => {
  let manager: SubagentManager;

  beforeEach(() => {
    const { factory } = createSessionFactory(createMockSession());
    ({ manager } = createManager({ createSubagentSession: factory }));
  });

  afterEach(() => {
    manager.dispose();
  });

  it("forwards onSessionCreated from spawn options observer to Agent", async () => {
    const received: { agent: Subagent | undefined } = { agent: undefined };

    const id = manager.spawn(STUB_SNAPSHOT, "general-purpose", "test", {
      description: "test",
      isBackground: true,
      observer: {
        onSessionCreated: (agent) => {
          received.agent = agent;
        },
      },
    });
    await manager.getRecord(id)!.promise;

    expect(received.agent).toBe(manager.getRecord(id));
    expect(received.agent!.id).toBe(id);
  });

  it("forwards onSessionCreated for foreground agents", async () => {
    const received: { agent: Subagent | undefined } = { agent: undefined };

    await manager.spawnAndWait(STUB_SNAPSHOT, "general-purpose", "test", {
      description: "fg",
      observer: {
        onSessionCreated: (agent) => {
          received.agent = agent;
        },
      },
    });

    expect(received.agent).toBeDefined();
    expect(received.agent!.type).toBe("general-purpose");
  });
});

describe("SubagentManager — queued-stop lifecycle contract", () => {
  it("abort() on a queued agent notifies onSubagentCompleted with status stopped", () => {
    const onSubagentCompleted = vi.fn();
    const { manager: mgr } = createManager({
      createSubagentSession: createBlockingFactory(),
      getMaxConcurrent: () => 1,
      observer: { onSubagentCompleted },
    });
    const running = spawnBg(mgr, "a");
    const queued = spawnBg(mgr, "b");

    expect(mgr.abort(queued)).toBe(true);

    expect(onSubagentCompleted).toHaveBeenCalledTimes(1);
    const record = onSubagentCompleted.mock.calls[0][0] as Subagent;
    expect(record.id).toBe(queued);
    expect(record.status).toBe("stopped");
    mgr.abort(running);
  });

  it("a stopped-while-queued agent notifies exactly once even after its slot frees", async () => {
    const onSubagentCompleted = vi.fn();
    let limit = 0; // everything queues until raised
    const { manager: mgr, limiter } = createManager({
      getMaxConcurrent: () => limit,
      observer: { onSubagentCompleted },
    });
    const queued = spawnBg(mgr, "a");
    const queuedPromise = mgr.getRecord(queued)!.promise;

    mgr.abort(queued); // stopped while queued → terminal notification
    limit = 4;
    limiter.recheck(); // slot opens; the dropped thunk must stay a no-op
    await queuedPromise;

    const queuedCalls = onSubagentCompleted.mock.calls.filter(
      (c) => (c[0] as Subagent).id === queued,
    );
    expect(queuedCalls).toHaveLength(1);
    expect((queuedCalls[0][0] as Subagent).status).toBe("stopped");
  });

  it("abortAll() notifies onSubagentCompleted for queued agents", () => {
    const onSubagentCompleted = vi.fn();
    const { manager: mgr } = createManager({
      createSubagentSession: createBlockingFactory(),
      getMaxConcurrent: () => 1,
      observer: { onSubagentCompleted },
    });
    spawnBg(mgr, "a");
    const queued = spawnBg(mgr, "b");

    mgr.abortAll();

    const queuedCalls = onSubagentCompleted.mock.calls.filter(
      (c) => (c[0] as Subagent).id === queued,
    );
    expect(queuedCalls).toHaveLength(1);
    expect((queuedCalls[0][0] as Subagent).status).toBe("stopped");
  });
});

describe("SubagentManager — toolCallId notification wiring", () => {
  let manager: SubagentManager;

  afterEach(() => {
    manager.dispose();
  });

  it("wires toolCallId on spawn when provided", () => {
    ({ manager } = createManager());

    const id = spawnBgWithToolCall(manager, "tc-42", "test", "bg");
    const record = manager.getRecord(id)!;

    expect(record.toolCallId).toBe("tc-42");
    manager.abort(id);
  });

  it("toolCallId is undefined when absent", () => {
    ({ manager } = createManager());

    const id = manager.spawn(STUB_SNAPSHOT, "general-purpose", "test", {
      description: "bg",
      isBackground: true,
    });
    const record = manager.getRecord(id)!;

    expect(record.toolCallId).toBeUndefined();
    manager.abort(id);
  });
});

describe("SubagentManager — registerWorkspaceProvider", () => {
  let manager: SubagentManager;

  afterEach(() => {
    manager.dispose();
  });

  function makeProvider(): WorkspaceProvider {
    return { prepare: vi.fn(async () => undefined) };
  }

  it("returns a disposer and exposes the registered provider via getter", () => {
    ({ manager } = createManager());
    const provider = makeProvider();

    const dispose = manager.registerWorkspaceProvider(provider);

    expect(typeof dispose).toBe("function");
    expect(manager.workspaceProvider).toBe(provider);
  });

  it("throws when a provider is already registered", () => {
    ({ manager } = createManager());
    manager.registerWorkspaceProvider(makeProvider());

    expect(() => manager.registerWorkspaceProvider(makeProvider())).toThrow(
      /already registered/i,
    );
  });

  it("disposer clears the slot, allowing re-registration", () => {
    ({ manager } = createManager());
    const first = makeProvider();
    const dispose = manager.registerWorkspaceProvider(first);

    dispose();

    expect(manager.workspaceProvider).toBeUndefined();
    const second = makeProvider();
    manager.registerWorkspaceProvider(second);
    expect(manager.workspaceProvider).toBe(second);
  });

  it("stale disposer does not evict a later provider", () => {
    ({ manager } = createManager());
    const first = makeProvider();
    const disposeFirst = manager.registerWorkspaceProvider(first);
    disposeFirst();
    const second = makeProvider();
    manager.registerWorkspaceProvider(second);

    // Calling the first disposer again must not clear the second provider.
    disposeFirst();

    expect(manager.workspaceProvider).toBe(second);
  });
});
