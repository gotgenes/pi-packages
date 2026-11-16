import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { AgentTypeRegistry } from "#src/config/agent-types";
import { ConcurrencyLimiter } from "#src/lifecycle/concurrency-limiter";
import type { CreateSubagentSessionParams } from "#src/lifecycle/create-subagent-session";
import type { AgentSpawnConfig } from "#src/lifecycle/subagent-manager";
import { resolveRetentionWindow, SubagentManager, type SubagentManagerObserver } from "#src/lifecycle/subagent-manager";
import type { RunKind } from "#src/lifecycle/subagent-run";
import type { SubagentSession, TurnLoopResult } from "#src/lifecycle/subagent-session";
import type { WorkspaceProvider } from "#src/lifecycle/workspace";
import { NotificationManager } from "#src/observation/notification";
import type { RunConfig } from "#src/runtime";
import { GetResultTool } from "#src/tools/get-result-tool";
import type { AgentConfig, Subagent } from "#src/types";
import { makeAgentConfig } from "#test/helpers/make-agent-config";
import { makeWorkspace, makeWorkspaceProvider } from "#test/helpers/make-workspace";
import { createBlockingFactory, createSessionFactory } from "#test/helpers/manager-stubs";
import { createMockSession, createSubagentSessionStub, emitResumeUsageAndCompaction, toSubagentSession } from "#test/helpers/mock-session";
import { STUB_CTX, STUB_SNAPSHOT } from "#test/helpers/stub-ctx";
import { turnLoopResult } from "#test/helpers/turn-loop-result";

/** Default max concurrent background agents (matches production default). */
const DEFAULT_MAX_CONCURRENT = 4;

type SessionFactory = (params: CreateSubagentSessionParams) => Promise<SubagentSession>;

/** Default factory: resolves to a fresh SubagentSession stub on every spawn. */
function defaultFactory(): SessionFactory {
  return vi.fn(async (_params: CreateSubagentSessionParams) => toSubagentSession(createSubagentSessionStub()));
}

/** Registry with default agents only. */
function defaultRegistry(): AgentTypeRegistry {
  return new AgentTypeRegistry(() => new Map());
}

/** Registry with a single custom agent override, keyed by its canonical name. */
function registryWith(name: string, overrides: Partial<AgentConfig>): AgentTypeRegistry {
  return new AgentTypeRegistry(() => new Map([[name, makeAgentConfig({ name, ...overrides })]]));
}

/** Test helper: construct an SubagentManager with injected stubs. */
function createManager(overrides?: {
  createSubagentSession?: SessionFactory;
  observer?: Partial<SubagentManagerObserver>;
  getMaxConcurrent?: () => number;
  getRunConfig?: () => RunConfig;
  getRetentionPolicy?: () => { consumedSessionRetentionMinutes: number; unconsumedSessionRetentionMinutes: number };
  baseCwd?: string;
  registry?: AgentTypeRegistry;
}) {
  const createSubagentSession: SessionFactory = overrides?.createSubagentSession ?? defaultFactory();
  const observer: SubagentManagerObserver | undefined = overrides?.observer
    ? {
        onSubagentRunStarted: overrides.observer.onSubagentRunStarted ?? (() => {}),
        onSubagentRunFinished: overrides.observer.onSubagentRunFinished ?? (() => {}),
        onSubagentCompacted: overrides.observer.onSubagentCompacted ?? (() => {}),
        onSubagentCreated: overrides.observer.onSubagentCreated ?? (() => {}),
        onSubagentWorkspaceNotice: overrides.observer.onSubagentWorkspaceNotice,
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
    registry: overrides?.registry ?? defaultRegistry(),
  });
  return { manager: mgr, createSubagentSession, limiter };
}

/** Spawn a background agent using STUB_SNAPSHOT. */
function spawnBg(mgr: SubagentManager, prompt = "test", desc = prompt) {
  return mgr.spawn(STUB_SNAPSHOT, "general-purpose", prompt, {
    description: desc,
    background: { kind: "explicit", isBackground: true },
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
    background: { kind: "explicit", isBackground: true },
    parentSession: { toolCallId },
  });
}

/** Arrange a manager at limit 1 with two bg agents over a blocking factory: first runs, second queues. */
function arrangeQueuedPair(observer?: Partial<SubagentManagerObserver>) {
  const factory = createBlockingFactory();
  const { manager: mgr } = createManager({ createSubagentSession: factory, getMaxConcurrent: () => 1, observer });
  const running = spawnBg(mgr, "a");
  const queued = spawnBg(mgr, "b");
  return { manager: mgr, factory, running, queued };
}

/**
 * Arrange a manager whose onSubagentRunFinished observer forwards to a real
 * NotificationManager (mirroring SubagentEventsObserver's unconditional
 * sendCompletion delegation), with one background agent spawned via a tool
 * call. The act (when the record is marked consumed relative to awaiting)
 * stays in each test.
 */
function seedNotificationScenario() {
  const sendMessage = vi.fn();
  const notifications = new NotificationManager(sendMessage);
  const { manager } = createManager({
    observer: { onSubagentRunFinished: (r) => notifications.sendCompletion(r) },
  });
  // The spawning tool call runs inside a parent agent run, so nudges are
  // withheld until it settles.
  notifications.onParentAgentStart();
  const id = spawnBgWithToolCall(manager, "tc-1");
  const record = manager.getRecord(id)!;
  return { manager, record, notifications, sendMessage };
}

/** A foreground spawn whose session creation is held open until openGate(). */
function seedForegroundNotificationScenario() {
  const sendMessage = vi.fn();
  const notifications = new NotificationManager(sendMessage);
  const { promise: gate, resolve: openGate } = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
  const { manager } = createManager({
    observer: { onSubagentRunFinished: (r) => notifications.sendCompletion(r) },
    createSubagentSession: vi.fn(async (_params: CreateSubagentSessionParams) => {
      await gate;
      return toSubagentSession(createSubagentSessionStub());
    }),
  });
  notifications.onParentAgentStart();
  const pending = spawnFg(manager);
  return { manager, notifications, sendMessage, pending, openGate };
}

describe("SubagentManager", () => {
  describe("spawn", () => {
    let manager: SubagentManager;

    afterEach(() => {
      manager.abortAll();
    });

    describe("type resolution", () => {
      it("stores the canonical type for case-variant input", () => {
        ({ manager } = createManager());

        const id = manager.spawn(STUB_SNAPSHOT, "explore", "test", {
          description: "d",
          background: { kind: "explicit", isBackground: true },
        });

        expect(manager.getRecord(id)!.type).toBe("Explore");
      });

      it("falls back to general-purpose for an unknown type", () => {
        ({ manager } = createManager());

        const id = manager.spawn(STUB_SNAPSHOT, "no-such-agent", "test", {
          description: "d",
          background: { kind: "explicit", isBackground: true },
        });

        expect(manager.getRecord(id)!.type).toBe("general-purpose");
      });

      it("throws for a known-but-disabled type", () => {
        ({ manager } = createManager({ registry: registryWith("Plan", { enabled: false }) }));

        expect(() =>
          manager.spawn(STUB_SNAPSHOT, "Plan", "test", {
            description: "d",
            background: { kind: "explicit", isBackground: true },
          }),
        ).toThrow('Agent type "Plan" is disabled');
      });

      it("reports the canonical casing in the disabled-agent error for case-insensitive input", () => {
        ({ manager } = createManager({ registry: registryWith("Plan", { enabled: false }) }));

        expect(() =>
          manager.spawn(STUB_SNAPSHOT, "plan", "test", {
            description: "d",
            background: { kind: "explicit", isBackground: true },
          }),
        ).toThrow('Agent type "Plan" is disabled');
      });

      it("does not create a record for a rejected spawn", () => {
        ({ manager } = createManager({ registry: registryWith("Plan", { enabled: false }) }));

        expect(() =>
          manager.spawn(STUB_SNAPSHOT, "Plan", "test", {
            description: "d",
            background: { kind: "explicit", isBackground: true },
          }),
        ).toThrow();

        expect(manager.listAgents()).toEqual([]);
      });
    });

    /**
     * onSubagentCreated fires only for a background agent, so it is the
     * discriminator here. Record status cannot serve: under the default
     * concurrency limit a background agent is admitted immediately and reaches
     * "running" too, so asserting on it passes whichever mode resolves.
     */
    describe("background-mode resolution", () => {
      let onCreated: Mock<(record: Subagent) => void>;

      function spawnExplore(background: AgentSpawnConfig["background"], runInBackground: boolean) {
        onCreated = vi.fn();
        ({ manager } = createManager({
          registry: registryWith("Explore", { runInBackground }),
          observer: { onSubagentCreated: onCreated },
        }));
        return manager.spawn(STUB_SNAPSHOT, "Explore", "test", { description: "d", background });
      }

      it("defers to frontmatter declaring background when the request is a default", () => {
        spawnExplore({ kind: "default", isBackground: false }, true);

        expect(onCreated).toHaveBeenCalledOnce();
      });

      it("defers to frontmatter declaring foreground when the request is a default", () => {
        spawnExplore({ kind: "default", isBackground: true }, false);

        expect(onCreated).not.toHaveBeenCalled();
      });

      it("ignores frontmatter declaring foreground when the request is explicit", () => {
        spawnExplore({ kind: "explicit", isBackground: true }, false);

        expect(onCreated).toHaveBeenCalledOnce();
      });

      it("ignores frontmatter declaring background when the request is explicit", () => {
        spawnExplore({ kind: "explicit", isBackground: false }, true);

        expect(onCreated).not.toHaveBeenCalled();
      });

      it("stamps the resolved mode on the record when it resolves to background", () => {
        const id = spawnExplore({ kind: "default", isBackground: false }, true);

        expect(manager.getRecord(id)!.isBackground).toBe(true);
      });

      it("stamps the resolved mode on the record when it resolves to foreground", () => {
        const id = spawnExplore({ kind: "default", isBackground: true }, false);

        expect(manager.getRecord(id)!.isBackground).toBe(false);
      });

      it("queues a resolved-background agent behind a full concurrency limit", () => {
        onCreated = vi.fn();
        ({ manager } = createManager({
          registry: registryWith("Explore", { runInBackground: true }),
          getMaxConcurrent: () => 1,
          createSubagentSession: createBlockingFactory(),
        }));
        spawnBg(manager, "occupies-the-only-slot");

        const id = manager.spawn(STUB_SNAPSHOT, "Explore", "test", {
          description: "d",
          background: { kind: "default", isBackground: false },
        });

        expect(manager.getRecord(id)!.status).toBe("queued");
      });
    });
  });

  describe("spawnAndWait", () => {
    let manager: SubagentManager;

    afterEach(() => {
      manager.abortAll();
    });

    describe("type resolution", () => {
      it("stores the canonical type for case-variant input", async () => {
        ({ manager } = createManager());

        const record = await manager.spawnAndWait(STUB_SNAPSHOT, "explore", "test", { description: "d" });

        expect(record.type).toBe("Explore");
      });

      it("rejects for a known-but-disabled type", async () => {
        ({ manager } = createManager({ registry: registryWith("Plan", { enabled: false }) }));

        await expect(
          manager.spawnAndWait(STUB_SNAPSHOT, "Plan", "test", { description: "d" }),
        ).rejects.toThrow('Agent type "Plan" is disabled');
      });
    });

    describe("foreground commitment", () => {
      it("stamps isBackground false on the record", async () => {
        ({ manager } = createManager({ registry: registryWith("Explore", { runInBackground: true }) }));

        const record = await manager.spawnAndWait(STUB_SNAPSHOT, "Explore", "test", { description: "d" });

        expect(record.isBackground).toBe(false);
      });

      it("stays foreground for an agent whose frontmatter declares runInBackground: true", async () => {
        const onCreated = vi.fn();
        ({ manager } = createManager({
          registry: registryWith("Explore", { runInBackground: true }),
          observer: { onSubagentCreated: onCreated },
        }));

        const record = await manager.spawnAndWait(STUB_SNAPSHOT, "Explore", "test", { description: "d" });

        // The caller holds the result promise, so the frontmatter must not route
        // it through the limiter or announce it as a background agent.
        expect(record.status).toBe("completed");
        expect(onCreated).not.toHaveBeenCalled();
      });
    });

    describe("a caller signal that already fired", () => {
      it("resolves with a stopped record whose session was never created", async () => {
        const { factory } = createSessionFactory();
        ({ manager } = createManager({ createSubagentSession: factory }));
        const controller = new AbortController();
        controller.abort();

        const record = await manager.spawnAndWait(STUB_SNAPSHOT, "general-purpose", "test", {
          description: "d",
          signal: controller.signal,
        });

        expect(record.status).toBe("stopped");
        expect(factory).not.toHaveBeenCalled();
      });

      it("claims the outcome before the run can terminate", async () => {
        // Hold session creation open so the claim is observable while the run is
        // still in flight — the window in which the nudge would otherwise fire.
        const { promise: gate, resolve: openGate } = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
        ({ manager } = createManager({
          createSubagentSession: vi.fn(async (_params: CreateSubagentSessionParams) => {
            await gate;
            return toSubagentSession(createSubagentSessionStub());
          }),
        }));

        const pending = manager.spawnAndWait(STUB_SNAPSHOT, "Explore", "test", { description: "d" });

        expect(manager.listAgents()[0]?.claimed).toBe(true);

        openGate();
        const record = await pending;
        expect(record.claimed).toBe(true);
      });

      it("runs immediately rather than queueing behind a full concurrency limit", async () => {
        // Only the first session creation blocks, so the background agent holds
        // the single limiter slot open while the foreground agent runs.
        let creations = 0;
        const factory = vi.fn((_params: CreateSubagentSessionParams) => {
          creations += 1;
          return creations === 1
            ? new Promise<SubagentSession>(() => {})
            : Promise.resolve(toSubagentSession(createSubagentSessionStub()));
        });
        ({ manager } = createManager({
          registry: registryWith("Explore", { runInBackground: true }),
          getMaxConcurrent: () => 1,
          createSubagentSession: factory,
        }));
        spawnBg(manager, "occupies-the-only-slot");

        // Were this routed through the limiter, the await would never settle.
        const record = await manager.spawnAndWait(STUB_SNAPSHOT, "Explore", "test", { description: "d" });

        expect(record.status).toBe("completed");
      });
    });
  });

  describe("concurrency", () => {
    describe("queueing with injected stubs", () => {
      let manager: SubagentManager;

      afterEach(async () => {
        await manager.dispose();
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
            return turnLoopResult({ responseText: `result-${n}` });
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
            return turnLoopResult({ responseText: "ok" });
          });
          return toSubagentSession(stub);
        });
        ({ manager } = createManager({
          createSubagentSession: factory,
          getMaxConcurrent: () => 1,
          observer: { onSubagentRunStarted: (record) => { startedIds.push(record.id); } },
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

    // Diagnosis, boundary, and these three cases contributed by @daoguademeng in #665.
    describe("stopping a queued agent", () => {
      let manager: SubagentManager;

      afterEach(async () => {
        await manager.dispose();
      });

      it("abort() on a queued agent notifies onSubagentRunFinished", () => {
        const completed: Subagent[] = [];
        const { manager: mgr, running, queued } = arrangeQueuedPair({
          onSubagentRunFinished: (record) => completed.push(record),
        });
        manager = mgr;

        expect(manager.abort(queued)).toBe(true);

        expect(completed).toHaveLength(1);
        expect(completed[0]).toBe(manager.getRecord(queued));
        expect(manager.getRecord(queued)!.status).toBe("stopped");
        expect(manager.getRecord(queued)!.stoppedWhileQueued).toBe(true);

        manager.abort(running);
      });

      it("abortAll() notifies onSubagentRunFinished for queued agents", () => {
        const completed: Subagent[] = [];
        const { manager: mgr, queued } = arrangeQueuedPair({
          onSubagentRunFinished: (record) => completed.push(record),
        });
        manager = mgr;

        expect(manager.abortAll()).toBe(2);

        // Only the queued agent notifies here: the running one's session creation
        // never resolves, so its run never reaches a terminal transition.
        expect(completed).toHaveLength(1);
        expect(completed[0]).toBe(manager.getRecord(queued));
        expect(manager.getRecord(queued)!.stoppedWhileQueued).toBe(true);
      });

      it("notifies exactly once, even after the stopped agent's slot frees", async () => {
        const completed: Subagent[] = [];
        const { promise: gate, resolve } = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args

        let callCount = 0;
        const factory: SessionFactory = vi.fn(async () => {
          callCount++;
          const n = callCount;
          const stub = createSubagentSessionStub();
          stub.runTurnLoop.mockImplementation(async () => {
            if (n === 1) await gate;
            return turnLoopResult({ responseText: `result-${n}` });
          });
          return toSubagentSession(stub);
        });
        ({ manager } = createManager({
          createSubagentSession: factory,
          getMaxConcurrent: () => 1,
          observer: { onSubagentRunFinished: (record) => completed.push(record) },
        }));

        const running = spawnBg(manager, "a");
        const queued = spawnBg(manager, "b");
        expect(manager.getRecord(queued)!.status).toBe("queued");

        manager.abort(queued);
        const notificationsFor = (id: string) => completed.filter((record) => record.id === id);
        expect(notificationsFor(queued)).toHaveLength(1);

        // Free the slot. The limiter runs the stopped agent's thunk, which must
        // no-op on guardedRun()'s active guard rather than run and notify again.
        resolve();
        await manager.getRecord(running)!.promise;
        await manager.getRecord(queued)!.promise;

        expect(notificationsFor(queued)).toHaveLength(1);
        expect(factory).toHaveBeenCalledOnce();
      });
    });

    describe("a background resume", () => {
      let manager: SubagentManager;

      afterEach(async () => {
        await manager.dispose();
      });

      /**
       * At a limit of 1: agent X settles its first run, then a holder spawn whose
       * turn loop stays open until releaseHolder() takes the only slot.
       */
      async function arrangeResumeAtCapacity(observer?: Partial<SubagentManagerObserver>) {
        const holderLoop = Promise.withResolvers<TurnLoopResult>();
        const stubs: Array<ReturnType<typeof createSubagentSessionStub>> = [];
        const factory: SessionFactory = vi.fn(async () => {
          const stub = createSubagentSessionStub();
          if (stubs.length === 1) stub.runTurnLoop.mockReturnValue(holderLoop.promise);
          stubs.push(stub);
          return toSubagentSession(stub);
        });
        ({ manager } = createManager({ createSubagentSession: factory, getMaxConcurrent: () => 1, observer }));
        const x = spawnBg(manager, "x");
        await manager.getRecord(x)!.promise;
        const xStub = stubs[0];
        xStub.runTurnLoop.mockResolvedValue(turnLoopResult({ responseText: "resumed" }));
        const holder = spawnBg(manager, "holder");
        // X's slot frees a microtask after its promise resolves.
        await vi.waitFor(() => expect(manager.getRecord(holder)!.status).toBe("running"));
        return {
          x,
          xStub,
          holder,
          releaseHolder: () => holderLoop.resolve(turnLoopResult({ responseText: "held" })),
        };
      }

      it("queues at capacity and starts when the slot frees", async () => {
        const { x, xStub, holder, releaseHolder } = await arrangeResumeAtCapacity();

        const start = manager.startResume(x, "continue", { background: true });

        expect(start).toEqual({ kind: "started", record: manager.getRecord(x) });
        expect(manager.getRecord(x)!.status).toBe("queued");
        expect(xStub.runTurnLoop).toHaveBeenCalledOnce();

        releaseHolder();
        await manager.getRecord(holder)!.promise;
        await manager.getRecord(x)!.promise;

        expect(xStub.runTurnLoop).toHaveBeenLastCalledWith("continue", expect.anything());
        expect([manager.getRecord(x)!.status, manager.getRecord(x)!.result]).toEqual(["completed", "resumed"]);
      });

      it("starts a foreground resume at capacity, as a foreground spawn does", async () => {
        const { x, releaseHolder } = await arrangeResumeAtCapacity();

        manager.startResume(x, "continue", { background: false, claimOutcome: true });

        expect(manager.getRecord(x)!.status).toBe("running");
        releaseHolder();
        await manager.getRecord(x)!.promise;
      });

      it("refuses a second resume while the first waits", async () => {
        const { x, releaseHolder } = await arrangeResumeAtCapacity();
        manager.startResume(x, "first answer", { background: true });

        expect(manager.startResume(x, "second answer", { background: true })).toEqual({
          kind: "refused",
          reason: "resume-queued",
        });
        releaseHolder();
      });

      it("stops a queued resume as a resume, once, without running it", async () => {
        const finished: Array<[string, RunKind]> = [];
        const { x, xStub, holder, releaseHolder } = await arrangeResumeAtCapacity({
          onSubagentRunFinished: (record, kind) => finished.push([record.id, kind]),
        });
        manager.startResume(x, "continue", { background: true });

        expect(manager.abort(x)).toBe(true);

        const xFinishes = () => finished.filter(([id]) => id === x);
        expect(xFinishes()).toEqual([[x, "initial"], [x, "resume"]]);
        expect([manager.getRecord(x)!.status, manager.getRecord(x)!.stoppedWhileQueued]).toEqual(["stopped", true]);

        releaseHolder();
        await manager.getRecord(holder)!.promise;
        await manager.getRecord(x)!.promise;

        expect(xStub.runTurnLoop).toHaveBeenCalledOnce();
        expect(xFinishes()).toHaveLength(2);
      });

      it("stops a queued resume as a resume on abortAll", async () => {
        const finished: Array<[string, RunKind]> = [];
        const { x } = await arrangeResumeAtCapacity({
          onSubagentRunFinished: (record, kind) => finished.push([record.id, kind]),
        });
        manager.startResume(x, "continue", { background: true });

        manager.abortAll();

        expect(finished.filter(([id]) => id === x)).toEqual([[x, "initial"], [x, "resume"]]);
        expect(manager.getRecord(x)!.status).toBe("stopped");
      });

      it("keeps the waiting door pending through the queue, then resolves with the resumed run", async () => {
        const { x, releaseHolder } = await arrangeResumeAtCapacity();
        let settled = false;

        const resumed = manager.resume(x, "continue", { background: true }).then((outcome) => {
          settled = true;
          return outcome;
        });
        await vi.waitFor(() => expect(manager.getRecord(x)!.status).toBe("queued"));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(settled).toBe(false);

        releaseHolder();

        expect(await resumed).toEqual({ kind: "resumed", record: manager.getRecord(x) });
        expect(manager.getRecord(x)!.status).toBe("completed");
      });
    });
  });

  describe("observer notifications", () => {
    describe("completion callbacks", () => {
      let manager: SubagentManager;

      afterEach(async () => {
        await manager.dispose();
      });

      it("does not let onComplete errors turn a completed agent into a failed run", async () => {
        ({ manager } = createManager({ observer: { onSubagentRunFinished: () => {
          throw new Error("stale extension context");
        } } }));

        const id = spawnBg(manager);
        await expect(manager.getRecord(id)!.promise).resolves.toBeUndefined();

        expect(manager.getRecord(id)!.status).toBe("completed");
      });
    });

    describe("onSubagentCreated", () => {
      let manager: SubagentManager;

      afterEach(async () => {
        await manager.dispose();
      });

      it("fires onSubagentCreated when a background agent is spawned", () => {
        const onCreated = vi.fn();
        ({ manager } = createManager({ observer: { onSubagentCreated: onCreated } }));

        const id = manager.spawn(STUB_SNAPSHOT, "general-purpose", "test", {
          description: "test agent",
          background: { kind: "explicit", isBackground: true },
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

      it("does not let a throwing run-started observer fail the run", async () => {
        ({ manager } = createManager({ observer: { onSubagentRunStarted: () => {
          throw new Error("stale extension context");
        } } }));

        const id = spawnBg(manager);
        await expect(manager.getRecord(id)!.promise).resolves.toBeUndefined();

        expect(manager.getRecord(id)!.status).toBe("completed");
      });

      it("fires onSubagentCreated before onSubagentRunStarted for background agents", async () => {
        const callOrder: string[] = [];
        ({ manager } = createManager({
          observer: {
            onSubagentCreated: () => { callOrder.push("created"); },
            onSubagentRunStarted: () => { callOrder.push("started"); },
          },
        }));

        const id = manager.spawn(STUB_SNAPSHOT, "general-purpose", "test", {
          description: "bg agent",
          background: { kind: "explicit", isBackground: true },
        });
        await manager.getRecord(id)!.promise;

        expect(callOrder).toEqual(["created", "started"]);
      });
    });

    describe("lifecycle observer forwarding", () => {
      let manager: SubagentManager;

      beforeEach(() => {
        const { factory } = createSessionFactory(createMockSession());
        ({ manager } = createManager({ createSubagentSession: factory }));
      });

      afterEach(async () => {
        await manager.dispose();
      });

      it("forwards onSessionCreated from spawn options observer to Agent", async () => {
        const received: { agent: Subagent | undefined } = { agent: undefined };

        const id = manager.spawn(STUB_SNAPSHOT, "general-purpose", "test", {
          description: "test",
          background: { kind: "explicit", isBackground: true },
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

    describe("toolCallId notification wiring", () => {
      let manager: SubagentManager;

      afterEach(async () => {
        await manager.dispose();
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
          background: { kind: "explicit", isBackground: true },
        });
        const record = manager.getRecord(id)!;

        expect(record.toolCallId).toBeUndefined();
        manager.abort(id);
      });
    });

    describe("consumed state versus onComplete ordering", () => {
      let manager: SubagentManager;

      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(async () => {
        await manager.dispose();
        vi.useRealTimers();
      });

      it("marking consumed after awaiting still suppresses the nudge (flush-time re-check)", async () => {
        const seeded = seedNotificationScenario();
        manager = seeded.manager;
        const { record, sendMessage } = seeded;

        // onSubagentRunFinished already withheld the nudge by the time this await
        // resumes (it fires synchronously inside record.promise's resolution
        // chain). The parent pulls the result (markConsumed) later in the same
        // run; the notification manager re-reads record.consumed when the run
        // settles and drops the nudge — no separate cancel call needed.
        await record.promise;
        record.markConsumed();

        seeded.notifications.onParentAgentSettled();
        expect(sendMessage).not.toHaveBeenCalled();
      });

      it("marking consumed before await suppresses the nudge (schedule-time guard)", async () => {
        const seeded = seedNotificationScenario();
        manager = seeded.manager;
        const { record, sendMessage } = seeded;

        // The parent already holds the result: sendCompletion sees record.consumed
        // at enqueue time and never withholds a nudge to flush.
        record.markConsumed();
        await record.promise;

        seeded.notifications.onParentAgentSettled();
        expect(sendMessage).not.toHaveBeenCalled();
      });

      it("onComplete is called for foreground agents", async () => {
        let onCompleteCalled = false;
        ({ manager } = createManager({ observer: { onSubagentRunFinished: () => {
          onCompleteCalled = true;
        } } }));

        await spawnFg(manager);

        // The lifecycle event and the session-history record are facts about the
        // run, owed for every agent; only the nudge is conditional.
        expect(onCompleteCalled).toBe(true);
      });

      it("sends no nudge for a foreground completion", async () => {
        const seeded = seedForegroundNotificationScenario();
        manager = seeded.manager;

        seeded.openGate();
        await seeded.pending;
        seeded.notifications.onParentAgentSettled();

        expect(seeded.sendMessage).not.toHaveBeenCalled();
      });

      it("sends no nudge when the parent turn is interrupted before a foreground agent terminates", async () => {
        const seeded = seedForegroundNotificationScenario();
        manager = seeded.manager;

        // The parent's turn ends while the child is still running, so the flush
        // finds nothing pending and stops withholding. The agent then terminates
        // with no run active — the window the consumption re-check cannot cover,
        // because markConsumed has not run yet either.
        seeded.notifications.onParentAgentSettled();
        seeded.openGate();
        await seeded.pending;

        expect(seeded.sendMessage).not.toHaveBeenCalled();
      });
    });
  });

  describe("session retention and teardown", () => {
    describe("cleanup timer", () => {
      let manager: SubagentManager;

      afterEach(async () => {
        await manager.dispose();
      });

      it("does not keep the process alive on its own", () => {
        // An unref'd timer is not an active resource: it keeps nothing alive.
        const activeTimers = () => process.getActiveResourcesInfo().filter((resource) => resource === "Timeout").length;
        const before = activeTimers();

        ({ manager } = createManager());

        expect(activeTimers()).toBe(before);
      });
    });

    describe("clearCompleted", () => {
      let manager: SubagentManager;

      afterEach(async () => {
        await manager.dispose();
      });

      it("clearCompleted removes completed records", async () => {
        ({ manager } = createManager());

        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;

        expect(manager.listAgents()).toHaveLength(1);
        await manager.clearCompleted();
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

        await manager.clearCompleted();

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

        await manager.clearCompleted();

        expect(disposeSpy).toHaveBeenCalledOnce();
      });

      it("clearCompleted removes error and stopped records", async () => {
        const { factory, stub } = createSessionFactory();
        stub.runTurnLoop.mockRejectedValue(new Error("boom"));
        ({ manager } = createManager({ createSubagentSession: factory }));

        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;
        expect(manager.getRecord(id)!.status).toBe("error");

        await manager.clearCompleted();
        expect(manager.getRecord(id)).toBeUndefined();
      });
    });

    describe("teardown awaits each child's shutdown", () => {
      let manager: SubagentManager;

      /** A manager holding one completed agent whose teardown the test controls. */
      async function seedGatedTeardown() {
        const { factory, stub } = createSessionFactory();
        const teardown = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
        stub.dispose = vi.fn((): Promise<void> => teardown.promise);
        ({ manager } = createManager({ createSubagentSession: factory }));
        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;
        return { id, teardown, stub };
      }

      it("clearCompleted resolves only after the removed record's teardown settles", async () => {
        const { teardown } = await seedGatedTeardown();

        let settled = false;
        const pending = manager.clearCompleted().then(() => {
          settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(false);

        teardown.resolve();
        await pending;
        expect(settled).toBe(true);
      });

      it("clearCompleted drops the record before awaiting its teardown", async () => {
        const { id, teardown } = await seedGatedTeardown();

        const pending = manager.clearCompleted();
        expect(manager.getRecord(id)).toBeUndefined();

        teardown.resolve();
        await pending;
      });

      it("dispose resolves only after every record's teardown settles", async () => {
        const { teardown } = await seedGatedTeardown();

        let settled = false;
        const pending = manager.dispose().then(() => {
          settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(false);

        teardown.resolve();
        await pending;
        expect(settled).toBe(true);
      });

      it("dispose tears down every record even when one teardown rejects", async () => {
        const failing = createSessionFactory();
        failing.stub.dispose = vi.fn((): Promise<void> => Promise.reject(new Error("teardown failed")));
        const healthy = createSessionFactory();
        const factories = [failing.factory, healthy.factory];
        ({ manager } = createManager({
          createSubagentSession: vi.fn(async (params: CreateSubagentSessionParams) =>
            (factories.shift() ?? healthy.factory)(params),
          ),
        }));

        const first = spawnBg(manager, "test1", "first");
        const second = spawnBg(manager, "test2", "second");
        await manager.getRecord(first)!.promise;
        await manager.getRecord(second)!.promise;

        await expect(manager.dispose()).resolves.toBeUndefined();
        expect(failing.stub.dispose).toHaveBeenCalledOnce();
        expect(healthy.stub.dispose).toHaveBeenCalledOnce();
        expect(manager.listAgents()).toHaveLength(0);
      });
    });

    describe("consumption-aware session release sweep", () => {
      let manager: SubagentManager;

      // Only the interval is faked: the sweep runs through its real timer, and the
      // Date.now spies below keep setting the clock it reads.
      beforeEach(() => {
        vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      });

      afterEach(async () => {
        vi.restoreAllMocks();
        await manager.dispose();
        vi.useRealTimers();
      });

      /** Let the sweep's interval fire once. */
      function runSweep(): void {
        vi.advanceTimersByTime(60_000);
      }

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
        runSweep();
        expect(manager.getRecord(id)!.isSessionReady()).toBe(true);

        // 10 min after consumption → session released, record survives.
        nowSpy.mockReturnValue(completedAt + 15 * 60_000);
        runSweep();
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
        runSweep();
        expect(manager.getRecord(id)!.isSessionReady()).toBe(true); // unconsumed → held

        nowSpy.mockReturnValue(completedAt + 721 * 60_000); // past the 12h cap
        runSweep();
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
        runSweep();

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
        runSweep();
        expect(manager.getRecord(id)!.isSessionReady()).toBe(false);
      });

      it("leaves records in place after release (getRecord still resolves them)", async () => {
        const id = await spawnCompleted("/tasks/agent.jsonl");
        const completedAt = manager.getRecord(id)!.completedAt!;
        vi.spyOn(Date, "now").mockReturnValue(completedAt + 721 * 60_000);
        runSweep();
        expect(manager.listAgents()).toHaveLength(1);
        expect(manager.getRecord(id)).toBeDefined();
      });
    });

    describe("subagent session state", () => {
      let manager: SubagentManager;

      afterEach(async () => {
        await manager.dispose();
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
  });

  describe("record initialization", () => {
    // Eager init removes the optional/required asymmetry that previously required
    // `??=` defaults at the callback sites and `?? 0` / `?? 1` at the read sites.
    describe("lifetime usage and compaction count are eagerly initialized", () => {
      let manager: SubagentManager;

      afterEach(async () => {
        await manager.dispose();
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
          return turnLoopResult({ responseText: "done" });
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
          return turnLoopResult({ responseText: "done" });
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
        ({ manager } = createManager({ createSubagentSession: factory }));

        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;
        stub.runTurnLoop.mockImplementation(async () => {
          // Emit events through the session — the record observer subscribed by
          // SubagentManager.resume() will pick them up.
          emitResumeUsageAndCompaction(session);
          return turnLoopResult({ responseText: "second" });
        });

        // Pre-resume: lifetimeUsage from spawn was zero (run did not emit usage events)
        expect(manager.getRecord(id)!.lifetimeUsage).toEqual({ input: 0, output: 0, cacheWrite: 0 });
        expect(manager.getRecord(id)!.compactionCount).toBe(0);

        await manager.resume(id, "more", { background: true });

        expect(manager.getRecord(id)!.lifetimeUsage).toEqual({ input: 70, output: 30, cacheWrite: 5 });
        expect(manager.getRecord(id)!.compactionCount).toBe(1);
      });
    });

    describe("getRunConfig threads defaultMaxTurns and wrapUpTurns into the turn loop", () => {
      let manager: SubagentManager;

      afterEach(async () => {
        await manager.dispose();
      });

      it("passes defaultMaxTurns and wrapUpTurns from getRunConfig to the session's turn limits", async () => {
        const getRunConfig = vi.fn(() => ({ defaultMaxTurns: 10, wrapUpTurns: 3, midRunUpdates: true }));
        const { factory } = createSessionFactory();
        ({ manager } = createManager({ getRunConfig, createSubagentSession: factory }));

        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;

        expect(factory).toHaveBeenCalledWith(
          expect.objectContaining({ turnLimits: { maxTurns: undefined, defaultMaxTurns: 10, wrapUpTurns: 3 } }),
        );
      });

      it("leaves defaultMaxTurns and wrapUpTurns unset when no getRunConfig is provided", async () => {
        const { factory } = createSessionFactory();
        ({ manager } = createManager({ createSubagentSession: factory }));

        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;

        expect(factory).toHaveBeenCalledWith(
          expect.objectContaining({ turnLimits: { maxTurns: undefined, defaultMaxTurns: undefined, wrapUpTurns: undefined } }),
        );
      });
    });

    describe("parent session threading", () => {
      let manager: SubagentManager;

      afterEach(async () => {
        await manager.dispose();
      });

      it("threads parentSession from AgentSpawnConfig to the factory params", async () => {
        const { factory } = createSessionFactory();
        ({ manager } = createManager({ createSubagentSession: factory }));

        manager.spawn(STUB_SNAPSHOT, "general-purpose", "test", {
          description: "test",
          background: { kind: "explicit", isBackground: true },
          parentSession: { parentSessionFile: "/sessions/parent.jsonl", parentSessionId: "parent-session-123" },
        });

        await vi.waitFor(() => expect(factory).toHaveBeenCalled());

        const params = vi.mocked(factory).mock.calls[0][0];
        expect(params.parentSession?.parentSessionFile).toBe("/sessions/parent.jsonl");
        expect(params.parentSession?.parentSessionId).toBe("parent-session-123");
      });
    });
  });

  describe("dependency injection via options bag", () => {
    let manager: SubagentManager;

    afterEach(async () => {
      await manager.dispose();
    });

    it("calls the injected factory when spawning an agent", async () => {
      const { factory } = createSessionFactory();
      ({ manager } = createManager({ createSubagentSession: factory }));

      const id = spawnBg(manager);
      await manager.getRecord(id)!.promise;

      expect(factory).toHaveBeenCalledOnce();
      expect(manager.getRecord(id)!.result).toBe("done");
    });

    it("runs a second turn loop on the same SubagentSession when resuming an agent", async () => {
      const { factory, stub } = createSessionFactory();
      ({ manager } = createManager({ createSubagentSession: factory }));

      const id = spawnBg(manager);
      await manager.getRecord(id)!.promise;
      stub.runTurnLoop.mockResolvedValue(turnLoopResult({ responseText: "second" }));

      await manager.resume(id, "continue", { background: true });

      expect(stub.runTurnLoop).toHaveBeenCalledTimes(2);
      expect(stub.runTurnLoop).toHaveBeenLastCalledWith("continue", expect.objectContaining({ signal: expect.any(AbortSignal) }));
      expect(manager.getRecord(id)!.result).toBe("second");
    });

    it("reports a background agent's resumed run finishing, with its kind", async () => {
      const onSubagentRunFinished = vi.fn();
      const { factory, stub } = createSessionFactory();
      ({ manager } = createManager({ createSubagentSession: factory, observer: { onSubagentRunFinished } }));

      const id = spawnBg(manager);
      await manager.getRecord(id)!.promise;
      stub.runTurnLoop.mockResolvedValue(turnLoopResult({ responseText: "second" }));
      await manager.resume(id, "continue", { background: true });

      expect(onSubagentRunFinished).toHaveBeenCalledTimes(2);
      expect(onSubagentRunFinished).toHaveBeenNthCalledWith(1, manager.getRecord(id), "initial");
      expect(onSubagentRunFinished).toHaveBeenNthCalledWith(2, manager.getRecord(id), "resume");
    });

    it("reports a foreground agent's resumed run finishing, with its kind", async () => {
      const onSubagentRunFinished = vi.fn();
      const { factory, stub } = createSessionFactory();
      ({ manager } = createManager({ createSubagentSession: factory, observer: { onSubagentRunFinished } }));

      const record = await spawnFg(manager);
      stub.runTurnLoop.mockResolvedValue(turnLoopResult({ responseText: "second" }));
      await manager.resume(record.id, "continue", { background: true });

      // A resumed foreground run is a terminal transition like any other; whether
      // the parent is told is the notification layer's call, not this seam's.
      expect(onSubagentRunFinished).toHaveBeenCalledTimes(2);
      expect(onSubagentRunFinished).toHaveBeenLastCalledWith(record, "resume");
    });

  });

  describe("registerWorkspaceProvider", () => {
    let manager: SubagentManager;

    afterEach(async () => {
      await manager.dispose();
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

    it("relays a held workspace's notice to the manager observer when the session is released", async () => {
      const onSubagentWorkspaceNotice = vi.fn<(record: Subagent, notice: string) => void>();
      const notice = "\n\n---\nChanges saved to branch `pi-agent-1`.";
      const stub = createSubagentSessionStub();
      let askParent: ((question: string) => void) | undefined;
      stub.runTurnLoop.mockImplementation(() => {
        askParent?.("Which config?");
        return Promise.resolve(turnLoopResult({ responseText: "Mapped them." }));
      });
      ({ manager } = createManager({
        createSubagentSession: vi.fn(async (params: CreateSubagentSessionParams) => {
          askParent = params.askParent;
          return toSubagentSession(stub);
        }),
        observer: { onSubagentWorkspaceNotice },
      }));
      manager.registerWorkspaceProvider({
        prepare: vi.fn(async () => ({
          cwd: "/ws/dir",
          dispose: vi.fn(() => ({ resultAddendum: notice })),
        })),
      });

      const id = manager.spawn(STUB_SNAPSHOT, "general-purpose", "test", {
        description: "held agent",
        background: { kind: "explicit", isBackground: true },
      });
      const record = manager.getRecord(id)!;
      await record.promise;
      await record.releaseSession();

      expect(onSubagentWorkspaceNotice).toHaveBeenCalledExactlyOnceWith(record, notice);
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

  describe("resume", () => {
    let manager: SubagentManager;

    afterEach(async () => {
      await manager.dispose();
    });

    describe("refused", () => {
      it("reports an id no record answers to", async () => {
        ({ manager } = createManager());

        expect(await manager.resume("nope", "continue", { background: true })).toEqual({
          kind: "refused",
          reason: "unknown-agent",
        });
      });

      it("reports a run that has not settled", async () => {
        ({ manager } = createManager({ createSubagentSession: createBlockingFactory() }));
        const id = spawnBg(manager);

        await vi.waitFor(() => expect(manager.getRecord(id)!.status).toBe("running"));

        expect(await manager.resume(id, "continue", { background: true })).toEqual({
          kind: "refused",
          reason: "still-running",
        });
      });

      it("reports a session released by the retention sweep", async () => {
        const { factory } = createSessionFactory();
        ({ manager } = createManager({ createSubagentSession: factory }));
        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;
        await manager.getRecord(id)!.releaseSession();

        expect(await manager.resume(id, "continue", { background: true })).toEqual({
          kind: "refused",
          reason: "session-released",
        });
      });

      it("reports a workspace torn down at run end, which the old guard let through", async () => {
        const { factory } = createSessionFactory();
        ({ manager } = createManager({ createSubagentSession: factory }));
        manager.registerWorkspaceProvider(makeWorkspaceProvider(makeWorkspace("/ws/dir")));
        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;

        expect(await manager.resume(id, "continue", { background: true })).toEqual({
          kind: "refused",
          reason: "workspace-disposed",
        });
      });

      it("starts no turn loop for a refused resume", async () => {
        const { factory, stub } = createSessionFactory();
        ({ manager } = createManager({ createSubagentSession: factory }));
        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;
        await manager.getRecord(id)!.releaseSession();

        await manager.resume(id, "continue", { background: true });

        // The initial run's loop alone.
        expect(stub.runTurnLoop).toHaveBeenCalledOnce();
      });
    });

    describe("accepted", () => {
      it("returns the resumed record", async () => {
        const { factory, stub } = createSessionFactory();
        ({ manager } = createManager({ createSubagentSession: factory }));
        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;
        stub.runTurnLoop.mockResolvedValue(turnLoopResult({ responseText: "second" }));

        expect(await manager.resume(id, "continue", { background: true })).toEqual({
          kind: "resumed",
          record: manager.getRecord(id),
        });
      });

      it("reports a resumed run that failed as resumed, carrying the error", async () => {
        const { factory, stub } = createSessionFactory();
        ({ manager } = createManager({ createSubagentSession: factory }));
        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;
        stub.runTurnLoop.mockRejectedValue(new Error("resume exploded"));

        const outcome = await manager.resume(id, "continue", { background: true });

        expect(outcome.kind).toBe("resumed");
        expect(manager.getRecord(id)!.status).toBe("error");
      });

      it("leaves the outcome unclaimed by default", async () => {
        const { factory, stub } = createSessionFactory();
        ({ manager } = createManager({ createSubagentSession: factory }));
        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;
        stub.runTurnLoop.mockResolvedValue(turnLoopResult({ responseText: "second" }));

        await manager.resume(id, "continue", { background: true });

        expect(manager.getRecord(id)!.claimed).toBe(false);
      });

      it("claims the outcome before the turn loop starts when the caller asks", async () => {
        const { factory, stub } = createSessionFactory();
        ({ manager } = createManager({ createSubagentSession: factory }));
        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;
        const record = manager.getRecord(id)!;
        // The resume's run is born claimed, so the claim is in place before the
        // turn loop can reach the terminal edge.
        const { promise, resolve } = Promise.withResolvers<TurnLoopResult>();
        stub.runTurnLoop.mockReturnValue(promise);

        const resumed = manager.resume(id, "continue", { background: false, claimOutcome: true });
        await vi.waitFor(() => expect(stub.runTurnLoop).toHaveBeenCalled());

        expect(record.claimed).toBe(true);
        resolve(turnLoopResult({ responseText: "second" }));
        await resumed;
      });

      it("tells the observer a resume started, before it reports one finished", async () => {
        const calls: string[] = [];
        const { factory, stub } = createSessionFactory();
        ({ manager } = createManager({
          createSubagentSession: factory,
          observer: {
            onSubagentRunStarted: (_r, kind) => calls.push(`${kind} started`),
            onSubagentRunFinished: (_r, kind) => calls.push(`${kind} finished`),
          },
        }));
        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;
        stub.runTurnLoop.mockResolvedValue(turnLoopResult({ responseText: "second" }));

        await manager.resume(id, "continue", { background: true });

        expect(calls).toEqual(["initial started", "initial finished", "resume started", "resume finished"]);
      });

      it("runs the resumed turn loop under the record's own lever", async () => {
        const { factory, stub } = createSessionFactory();
        let loopSignal: AbortSignal | undefined;
        ({ manager } = createManager({ createSubagentSession: factory }));
        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;
        stub.runTurnLoop.mockImplementation((_prompt: string, opts: { signal?: AbortSignal }) => {
          loopSignal = opts.signal;
          return Promise.resolve(turnLoopResult({ responseText: "second" }));
        });
        const signal = new AbortController().signal;

        await manager.resume(id, "continue", { background: true, signal });

        // The caller's signal is wired through the record's abort(), so the loop
        // runs under the one lever abort(id) can also pull.
        expect(stub.runTurnLoop).toHaveBeenLastCalledWith("continue", expect.objectContaining({ signal: expect.any(AbortSignal) }));
        expect(loopSignal).not.toBe(signal);
      });

      it("stops a resume whose caller signal already fired", async () => {
        const { factory, stub } = createSessionFactory();
        let abortedAtEntry: boolean | undefined;
        ({ manager } = createManager({ createSubagentSession: factory }));
        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;
        stub.runTurnLoop.mockImplementation((_prompt: string, opts: { signal?: AbortSignal }) => {
          abortedAtEntry = opts.signal?.aborted;
          return Promise.resolve(turnLoopResult({ responseText: "" }));
        });
        const controller = new AbortController();
        controller.abort();

        const outcome = await manager.resume(id, "continue", { background: true, signal: controller.signal });

        expect(outcome.kind).toBe("resumed");
        expect(abortedAtEntry).toBe(true);
        expect(manager.getRecord(id)!.status).toBe("stopped");
      });

      it("stops an in-flight resume when the caller aborts it by id", async () => {
        const { factory, stub } = createSessionFactory();
        ({ manager } = createManager({ createSubagentSession: factory }));
        const id = spawnBg(manager);
        await manager.getRecord(id)!.promise;
        const gate = Promise.withResolvers<TurnLoopResult>();
        let signalled = false;
        stub.runTurnLoop.mockImplementation((_prompt: string, { signal }: { signal?: AbortSignal }) => {
          signal?.addEventListener("abort", () => {
            signalled = true;
            gate.resolve(turnLoopResult({ responseText: "partial answer" }));
          });
          return gate.promise;
        });

        const resumed = manager.resume(id, "continue", { background: true });
        await vi.waitFor(() => expect(stub.runTurnLoop).toHaveBeenCalled());

        expect(manager.abort(id)).toBe(true);
        await resumed;

        expect(signalled).toBe(true);
        expect(manager.getRecord(id)!.status).toBe("stopped");
      });
    });

    describe("announcement after an outcome a carrier already delivered", () => {
      let sendMessage: Mock;

      // A real NotificationManager wired the way SubagentEventsObserver wires it,
      // with the parent idle, so a resumed outcome nobody claims is sent at once.
      beforeEach(() => {
        sendMessage = vi.fn();
        const notifications = new NotificationManager(sendMessage);
        const { factory } = createSessionFactory();
        ({ manager } = createManager({
          createSubagentSession: factory,
          observer: {
            onSubagentRunFinished: (r, kind) => {
              if (kind === "resume") notifications.sendCompletion(r);
            },
          },
        }));
      });

      it("announces an unclaimed resume of an agent a foreground spawn delivered", async () => {
        const record = await spawnFg(manager);

        await manager.resume(record.id, "continue", { background: true });

        expect(sendMessage).toHaveBeenCalledOnce();
        expect(record.claimed).toBe(false);
      });

      it("announces an unclaimed resume of an agent a claimed resume delivered", async () => {
        const record = await spawnFg(manager);
        await manager.resume(record.id, "first answer", { background: false, claimOutcome: true });

        await manager.resume(record.id, "second answer", { background: true });

        expect(sendMessage).toHaveBeenCalledOnce();
      });

      it("announces nothing for a claimed resume that starts while a waiter is waking", async () => {
        const sendMessage = vi.fn();
        const notifications = new NotificationManager(sendMessage);
        const { factory, stub } = createSessionFactory();
        const resumed = Promise.withResolvers<TurnLoopResult>();
        stub.runTurnLoop
          .mockResolvedValueOnce(turnLoopResult({ responseText: "done" }))
          .mockReturnValueOnce(resumed.promise);
        let resumeOutcome: Promise<unknown> | undefined;
        ({ manager } = createManager({
          createSubagentSession: factory,
          observer: {
            // A consumer that resumes the moment the run settles, as a
            // subagents:completed handler can, before the waiter wakes.
            onSubagentRunFinished: (r, kind) => {
              notifications.sendCompletion(r);
              if (kind === "initial") resumeOutcome = manager.resume(r.id, "continue", { background: false, claimOutcome: true });
            },
          },
        }));
        const id = spawnBg(manager);
        const waiter = new GetResultTool(manager, defaultRegistry());

        await waiter.execute("tc-1", { agent_id: id, wait: true }, new AbortController().signal, undefined, STUB_CTX);
        resumed.resolve(turnLoopResult({ responseText: "second" }));
        await resumeOutcome;

        // The resumer receives the outcome; nothing announces it a second time.
        expect(sendMessage).not.toHaveBeenCalled();
      });

      it("still announces nothing for a claimed resume", async () => {
        const record = await spawnFg(manager);

        await manager.resume(record.id, "continue", { background: false, claimOutcome: true });

        expect(sendMessage).not.toHaveBeenCalled();
      });
    });
  });

  describe("startResume", () => {
    let manager: SubagentManager;

    afterEach(async () => {
      await manager.dispose();
    });

    it("returns the record already running the resume, before the resumed run settles", async () => {
      const { factory, stub } = createSessionFactory();
      ({ manager } = createManager({ createSubagentSession: factory }));
      const id = spawnBg(manager);
      const record = manager.getRecord(id)!;
      await record.promise;
      const gate = Promise.withResolvers<TurnLoopResult>();
      stub.runTurnLoop.mockReturnValue(gate.promise);

      const start = manager.startResume(id, "continue", { background: true });

      expect(start).toEqual({ kind: "started", record });
      expect(record.status).toBe("running");
      gate.resolve(turnLoopResult({ responseText: "second" }));
      await record.promise;
      expect(record.status).toBe("completed");
    });

    it("refuses an id no record answers to", () => {
      ({ manager } = createManager());

      expect(manager.startResume("nope", "continue", { background: true })).toEqual({ kind: "refused", reason: "unknown-agent" });
    });

    it("refuses a run that has not settled, starting no turn loop", async () => {
      const { factory, stub } = createSessionFactory();
      // The session exists and its first run is still in flight, so only the
      // refusal stands between this call and a second turn loop.
      stub.runTurnLoop.mockReturnValue(new Promise(() => {}));
      ({ manager } = createManager({ createSubagentSession: factory }));
      const id = spawnBg(manager);
      await vi.waitFor(() => expect(stub.runTurnLoop).toHaveBeenCalled());

      expect(manager.startResume(id, "continue", { background: true })).toEqual({ kind: "refused", reason: "still-running" });
      // The first run's loop, still in flight, alone.
      expect(stub.runTurnLoop).toHaveBeenCalledOnce();
    });

    it("resumes a foreground-spawned agent in the background, as its observer sees at the start edge", async () => {
      const started: Array<{ kind: string; isBackground: boolean }> = [];
      ({ manager } = createManager({
        observer: {
          onSubagentRunStarted: (record, kind) => {
            started.push({ kind, isBackground: record.isBackground });
          },
        },
      }));
      const record = await spawnFg(manager);

      manager.startResume(record.id, "continue", { background: true });
      await record.promise;

      expect(started).toEqual([
        { kind: "initial", isBackground: false },
        { kind: "resume", isBackground: true },
      ]);
      expect(manager.getRecord(record.id)?.isBackground).toBe(true);
    });
  });
});

describe("resolveRetentionWindow", () => {
  const policy = {
    consumedSessionRetentionMinutes: 10,
    unconsumedSessionRetentionMinutes: 720,
  };

  describe("an outcome the parent never collected", () => {
    it("holds for the long window, measured from completion", () => {
      expect(
        resolveRetentionWindow(
          { consumed: false, completedAt: 5_000, consumedAt: undefined, pendingQuestion: undefined },
          policy,
        ),
      ).toEqual({ referenceAt: 5_000, windowMinutes: 720 });
    });

    it("measures from zero when the record has no completion time", () => {
      expect(
        resolveRetentionWindow(
          { consumed: false, completedAt: undefined, consumedAt: undefined, pendingQuestion: undefined },
          policy,
        ),
      ).toEqual({ referenceAt: 0, windowMinutes: 720 });
    });
  });

  describe("an outcome the parent collected", () => {
    it("holds for the short window, measured from collection", () => {
      expect(
        resolveRetentionWindow(
          { consumed: true, completedAt: 5_000, consumedAt: 9_000, pendingQuestion: undefined },
          policy,
        ),
      ).toEqual({ referenceAt: 9_000, windowMinutes: 10 });
    });

    it("measures from completion when that is the later of the two", () => {
      expect(
        resolveRetentionWindow(
          { consumed: true, completedAt: 9_000, consumedAt: 5_000, pendingQuestion: undefined },
          policy,
        ),
      ).toEqual({ referenceAt: 9_000, windowMinutes: 10 });
    });
  });

  describe("a collected outcome that still carries an unanswered question", () => {
    it("holds for the long window, because the parent has not finished with it", () => {
      expect(
        resolveRetentionWindow(
          { consumed: true, completedAt: 5_000, consumedAt: 9_000, pendingQuestion: "Which config wins?" },
          policy,
        ),
      ).toEqual({ referenceAt: 5_000, windowMinutes: 720 });
    });

    it("measures from completion rather than collection, as an uncollected outcome does", () => {
      expect(
        resolveRetentionWindow(
          { consumed: true, completedAt: 9_000, consumedAt: 5_000, pendingQuestion: "Which config wins?" },
          policy,
        ),
      ).toEqual({ referenceAt: 9_000, windowMinutes: 720 });
    });
  });
});
