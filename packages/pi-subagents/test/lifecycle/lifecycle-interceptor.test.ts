import { EventEmitter } from "node:events";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createChildLifecyclePublisher, SUBAGENT_CHILD_COMPLETED } from "#src/lifecycle/child-lifecycle";
import { ConcurrencyLimiter } from "#src/lifecycle/concurrency-limiter";
import {
  LifecycleInterceptorRegistry,
  type SubagentLifecycleExecutionPath,
  type SubagentLifecycleIdentity,
} from "#src/lifecycle/lifecycle-interceptor";
import { SubagentManager } from "#src/lifecycle/subagent-manager";
import { SubagentSession } from "#src/lifecycle/subagent-session";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";

function createSession(results = ["result"]) {
  const listeners: Array<(event: any) => void> = [];
  let nextResult = 0;
  const session = {
    messages: [] as unknown[],
    subscribe: vi.fn((listener: (event: any) => void) => {
      listeners.push(listener);
      return () => {};
    }),
    prompt: vi.fn(async () => {
      session.messages.push({
        role: "assistant",
        content: [{ type: "text", text: results[nextResult++] ?? results.at(-1)! }],
      });
    }),
    abort: vi.fn(),
    steer: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    getSessionStats: vi.fn(() => ({ tokens: { input: 0, output: 0, cacheWrite: 0 } })),
    getToolDefinition: vi.fn(),
  };
  return { session, listeners };
}

function makeSubagentSession(
  session: ReturnType<typeof createSession>["session"],
  completed = vi.fn(),
) {
  return new SubagentSession(session as unknown as AgentSession, {
    outputFile: undefined,
    sessionId: "child-1",
    sessionDir: "/session-dir",
    agentName: "Explore",
    agentMaxTurns: undefined,
    parentContext: "PARENT:\n",
    lifecycle: {
      spawning: vi.fn(),
      sessionCreated: vi.fn(),
      completed,
      disposed: vi.fn(),
    },
  });
}

function control(registry: LifecycleInterceptorRegistry, signal = new AbortController().signal) {
  const identity: SubagentLifecycleIdentity = {
    agentId: "agent-1",
    sessionId: "child-1",
    runId: "run-1",
    agentType: "Explore",
    parentSessionId: "parent-1",
  };
  const execution: SubagentLifecycleExecutionPath = {
    phase: "initial",
    origin: "tool",
    mode: "background",
    admission: "queued",
  };
  return registry.createTurnLifecycle({ identity, execution, signal });
}

describe("LifecycleInterceptorRegistry", () => {
  it("runs sequentially, pipes exact prompt/result replacements, and preserves immutable identity", async () => {
    const registry = new LifecycleInterceptorRegistry();
    const calls: string[] = [];
    const seen: unknown[] = [];
    registry.register({
      beforeStart: async (context) => {
        calls.push(`start-1:${context.prompt}`);
        seen.push(context.identity, context.execution);
        return { action: "continue", prompt: `${context.prompt}:first` };
      },
      beforeComplete: async (context) => {
        calls.push(`complete-1:${context.proposedResult}`);
        seen.push(context.identity, context.execution);
        return { action: "complete", result: `${context.proposedResult}:first` };
      },
    });
    registry.register({
      beforeStart: (context) => {
        calls.push(`start-2:${context.prompt}`);
        return { action: "continue", prompt: `${context.prompt}:second` };
      },
      beforeComplete: (context) => {
        calls.push(`complete-2:${context.proposedResult}`);
        return { action: "complete", result: `${context.proposedResult}:second` };
      },
    });

    const turn = control(registry);
    const start = await turn.beforeStart("exact");
    const completion = await turn.beforeComplete("candidate", "completed", 0);

    expect(start).toEqual({ action: "continue", prompt: "exact:first:second" });
    expect(completion).toEqual({ action: "complete", result: "candidate:first:second" });
    expect(calls).toEqual([
      "start-1:exact",
      "start-2:exact:first",
      "complete-1:candidate",
      "complete-2:candidate:first",
    ]);
    expect(seen).toHaveLength(4);
    expect(Object.isFrozen((seen[0] as { agentId: string }))).toBe(true);
    expect(Object.isFrozen((seen[1] as { phase: string }))).toBe(true);
    await registry.dispose();
  });

  it("unregisters future snapshots while allowing the captured ordered snapshot to finish", async () => {
    const registry = new LifecycleInterceptorRegistry();
    const calls: string[] = [];
    registry.register({
      beforeStart: async (context) => {
        calls.push("first");
        await second.dispose();
        return { action: "continue", prompt: context.prompt };
      },
    });
    const second = registry.register({
      beforeStart: (context) => {
        calls.push("second");
        return { action: "continue", prompt: context.prompt };
      },
      dispose: () => { calls.push("second-disposed"); },
    });

    await control(registry).beforeStart("prompt");
    await Promise.resolve();
    expect(calls).toEqual(["first", "second", "second-disposed"]);

    await control(registry).beforeStart("prompt");
    expect(calls).toEqual(["first", "second", "second-disposed", "first"]);
    await registry.dispose();
  });

  it("propagates cancellation during a callback without starting a prompt", async () => {
    const registry = new LifecycleInterceptorRegistry();
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    registry.register({
      beforeStart: async () => {
        entered();
        return new Promise(() => undefined);
      },
    });
    const controller = new AbortController();
    const turn = control(registry, controller.signal);
    const pending = turn.beforeStart("prompt");
    await enteredPromise;
    const reason = new Error("caller cancelled");
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    await registry.dispose();
  });
});

describe("SubagentSession lifecycle interception", () => {
  it("runs start before the exact prompt and completion before child completion", async () => {
    const registry = new LifecycleInterceptorRegistry();
    const order: string[] = [];
    registry.register({
      beforeStart: (context) => {
        order.push(`start:${context.prompt}`);
        return { action: "continue", prompt: `${context.prompt}:provider` };
      },
      beforeComplete: (context) => {
        order.push(`completion:${context.proposedResult}`);
        return { action: "complete", result: `${context.proposedResult}:accepted` };
      },
    });
    const { session } = createSession(["candidate"]);
    const completed = vi.fn(() => { order.push("child-completed"); });
    const subagentSession = makeSubagentSession(session, completed);

    const result = await subagentSession.runTurnLoop("work", { lifecycle: control(registry) });

    expect(session.prompt).toHaveBeenCalledWith("PARENT:\nwork:provider");
    expect(result).toMatchObject({ responseText: "candidate:accepted", aborted: false });
    expect(order).toEqual([
      "start:PARENT:\nwork",
      "completion:candidate",
      "child-completed",
    ]);
    await registry.dispose();
  });

  it("publishes the Pi EventEmitter completion only after provider acceptance", async () => {
    const registry = new LifecycleInterceptorRegistry();
    const order: string[] = [];
    registry.register({
      beforeComplete: (context) => {
        order.push(`provider:${context.proposedResult}`);
        return { action: "complete", result: context.proposedResult };
      },
    });
    const events = new EventEmitter();
    events.on(SUBAGENT_CHILD_COMPLETED, () => { order.push("event"); });
    const { session } = createSession(["candidate"]);
    const subagentSession = new SubagentSession(session as unknown as AgentSession, {
      outputFile: undefined,
      sessionId: "child-1",
      sessionDir: "/session-dir",
      agentName: "Explore",
      agentMaxTurns: undefined,
      parentContext: undefined,
      lifecycle: createChildLifecyclePublisher((channel, data) => events.emit(channel, data)),
    });

    await subagentSession.runTurnLoop("work", { lifecycle: control(registry) });

    expect(order).toEqual(["provider:candidate", "event"]);
    await registry.dispose();
  });

  it("prevents the first prompt on start abort and does not emit child completion", async () => {
    const registry = new LifecycleInterceptorRegistry();
    registry.register({ beforeStart: () => ({ action: "abort", reason: "blocked" }) });
    const { session } = createSession();
    const completed = vi.fn();
    const subagentSession = makeSubagentSession(session, completed);

    const result = await subagentSession.runTurnLoop("work", { lifecycle: control(registry) });

    expect(result).toMatchObject({ responseText: "blocked", aborted: true, lifecycleAborted: true });
    expect(session.prompt).not.toHaveBeenCalled();
    expect(completed).not.toHaveBeenCalled();
    await registry.dispose();
  });

  it("cancels a pending completion callback before any completion side effect", async () => {
    const registry = new LifecycleInterceptorRegistry();
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    registry.register({
      beforeComplete: async () => {
        entered();
        return new Promise(() => undefined);
      },
    });
    const controller = new AbortController();
    const reason = new Error("completion cancelled");
    const { session } = createSession(["candidate"]);
    const completed = vi.fn();
    const subagentSession = makeSubagentSession(session, completed);
    const pending = subagentSession.runTurnLoop("work", {
      lifecycle: control(registry, controller.signal),
    });
    await enteredPromise;
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(session.prompt).toHaveBeenCalledOnce();
    expect(completed).not.toHaveBeenCalled();
    await registry.dispose();
  });

  it("continues on the same session and aborts exactly at the finite bound", async () => {
    const registry = new LifecycleInterceptorRegistry();
    registry.register({
      beforeComplete: (context) => ({
        action: "continue",
        prompt: `continue-${context.continuationRound}`,
      }),
    });
    const { session } = createSession(["first", "second", "third", "fourth"]);
    const completed = vi.fn();
    const subagentSession = makeSubagentSession(session, completed);

    const result = await subagentSession.runTurnLoop("work", { lifecycle: control(registry) });

    expect(result).toMatchObject({ aborted: true, lifecycleAborted: true });
    expect(session.prompt).toHaveBeenCalledTimes(4);
    expect(session.prompt).toHaveBeenNthCalledWith(1, "PARENT:\nwork");
    expect(session.prompt).toHaveBeenNthCalledWith(2, "continue-0");
    expect(session.prompt).toHaveBeenNthCalledWith(3, "continue-1");
    expect(session.prompt).toHaveBeenNthCalledWith(4, "continue-2");
    expect(completed).not.toHaveBeenCalled();
    await registry.dispose();
  });

  it("covers tool/service, foreground/background/queued, initial, and resume through the manager", async () => {
    let limit = 1;
    let sessionNumber = 0;
    const manager = new SubagentManager({
      baseCwd: "/repo",
      limiter: new ConcurrencyLimiter(() => limit),
      createSubagentSession: async () => {
        const { session } = createSession([`result-${++sessionNumber}`]);
        return makeSubagentSession(session);
      },
    });
    const starts: SubagentLifecycleExecutionPath[] = [];
    const completions: SubagentLifecycleExecutionPath[] = [];
    manager.registerLifecycleInterceptor({
      beforeStart: (context) => {
        starts.push(context.execution);
        return { action: "continue" };
      },
      beforeComplete: (context) => {
        completions.push(context.execution);
        return { action: "complete" };
      },
    });

    await manager.spawnAndWait(STUB_SNAPSHOT, "Explore", "tool foreground", {
      description: "tool foreground",
      origin: "tool",
    });
    const serviceImmediate = manager.spawn(STUB_SNAPSHOT, "Explore", "service background", {
      description: "service background",
      isBackground: true,
      origin: "service",
      parentSession: { parentSessionId: "service-parent" },
    });
    await manager.getRecord(serviceImmediate)!.promise;

    limit = 0;
    const queued = manager.spawn(STUB_SNAPSHOT, "Explore", "tool queued", {
      description: "tool queued",
      isBackground: true,
      origin: "tool",
    });
    expect(manager.getRecord(queued)!.status).toBe("queued");
    limit = 1;
    // The limiter intentionally owns queue admission; reopening it starts the
    // already-registered lifecycle at dequeue rather than record creation.
    (manager as unknown as { limiter: ConcurrencyLimiter }).limiter.recheck();
    await manager.getRecord(queued)!.promise;
    await manager.resume(serviceImmediate, "resume");

    expect(starts).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: "initial", origin: "tool", mode: "foreground", admission: "immediate" }),
      expect.objectContaining({ phase: "initial", origin: "service", mode: "background", admission: "immediate" }),
      expect.objectContaining({ phase: "initial", origin: "tool", mode: "background", admission: "queued" }),
      expect.objectContaining({ phase: "resume", origin: "service", mode: "background", admission: "immediate" }),
    ]));
    expect(completions).toHaveLength(4);
    manager.dispose();
  });

  it("fails before finalization when a completion interceptor rejects", async () => {
    const registry = new LifecycleInterceptorRegistry();
    registry.register({ beforeComplete: () => { throw new Error("provider failed"); } });
    const { session } = createSession(["candidate"]);
    const completed = vi.fn();
    const subagentSession = makeSubagentSession(session, completed);

    await expect(subagentSession.runTurnLoop("work", { lifecycle: control(registry) }))
      .rejects.toThrow("Lifecycle interceptor failed during beforeComplete");
    expect(completed).not.toHaveBeenCalled();
    await registry.dispose();
  });

  it("keeps no-provider event ordering unchanged", async () => {
    const { session } = createSession(["result"]);
    const order: string[] = [];
    const subagentSession = makeSubagentSession(session, vi.fn(() => { order.push("child-completed"); }));
    session.prompt.mockImplementation(async () => {
      session.messages.push({ role: "assistant", content: [{ type: "text", text: "result" }] });
      order.push("prompt-resolved");
    });

    await subagentSession.runTurnLoop("work", {});

    expect(order).toEqual(["prompt-resolved", "child-completed"]);
  });
});
