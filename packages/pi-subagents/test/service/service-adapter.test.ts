import { describe, expect, it, vi } from "vitest";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import { SubagentState } from "#src/lifecycle/subagent-state";
import type { WorkspaceProvider } from "#src/lifecycle/workspace";
import type { SubagentsService } from "#src/service/service";
import type { ServiceRuntimeLike, SubagentManagerLike } from "#src/service/service-adapter";
import { SubagentsServiceAdapter, toSubagentRecord } from "#src/service/service-adapter";
import { type SessionContext, Subagent } from "#src/types";
import { makeModel } from "#test/helpers/make-model";
import { createTestSubagent, makeStubExecution } from "#test/helpers/make-subagent";
import { createMockSession, createSubagentSessionStub, toSubagentSession } from "#test/helpers/mock-session";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";

describe("toSubagentRecord", () => {
  const baseRecord = (() => {
    const r = createTestSubagent({
      id: "abc-123",
      type: "Explore",
      description: "Check stale TODOs",
      result: "Found 3 stale TODOs",
      toolUses: 5,
      lifetimeUsage: { input: 100, output: 200, cacheWrite: 50 },
      compactionCount: 1,
    });
    return r;
  })();

  it("includes all serializable fields", () => {
    const result = toSubagentRecord(baseRecord);
    expect(result).toEqual({
      id: "abc-123",
      type: "Explore",
      description: "Check stale TODOs",
      status: "completed",
      isBackground: true,
      result: "Found 3 stale TODOs",
      toolUses: 5,
      turnCount: 1,
      startedAt: 1000,
      completedAt: 2000,
      lifetimeUsage: { input: 100, output: 200, cacheWrite: 50 },
      compactionCount: 1,
    });
  });

  it("carries a declared question so a consumer can surface it as answerable", () => {
    const result = toSubagentRecord(createTestSubagent({ pendingQuestion: "Which config?" }));
    expect(result.pendingQuestion).toBe("Which config?");
  });

  it("omits pendingQuestion when the agent asked nothing", () => {
    expect(toSubagentRecord(createTestSubagent())).not.toHaveProperty("pendingQuestion");
  });

  it("reports the background mode resolved for the agent", () => {
    const result = toSubagentRecord(createTestSubagent({ isBackground: false }));
    expect(result.isBackground).toBe(false);
  });

  it("reports the turns consumed so far", () => {
    const result = toSubagentRecord(createTestSubagent({ turnCount: 4 }));
    expect(result.turnCount).toBe(4);
  });

  it("reports the turn ceiling and the transcript path when the agent has them", () => {
    const record = createTestSubagent({ maxTurns: 12 });
    record.subagentSession = toSubagentSession(
      createSubagentSessionStub(createMockSession(), "/sessions/child.jsonl"),
    );
    const result = toSubagentRecord(record);
    expect(result.maxTurns).toBe(12);
    expect(result.outputFile).toBe("/sessions/child.jsonl");
  });

  it("strips live objects and collaborators", () => {
    const record = createTestSubagent({ toolCallId: "tc-1" });
    record.subagentSession = toSubagentSession(createSubagentSessionStub(createMockSession()));
    const result = toSubagentRecord(record);
    expect(result).not.toHaveProperty("subagentSession");
    expect(result).not.toHaveProperty("abortController");
    expect(result).not.toHaveProperty("promise");
    expect(result).not.toHaveProperty("execution");
    expect(result).not.toHaveProperty("notification");
  });

  it("withholds momentary activity and package-internal bookkeeping", () => {
    const record = createTestSubagent({
      activeTools: ["read", "grep"],
      responseText: "partial answer",
      consumedAt: 5000,
      stoppedWhileQueued: true,
    });
    // The source really carries all four, so the assertions below are not vacuous.
    expect([...record.activeTools.values()]).toEqual(["read", "grep"]);
    expect(record.responseText).toBe("partial answer");
    expect(record.consumedAt).toBe(5000);
    expect(record.stoppedWhileQueued).toBe(true);

    const result = toSubagentRecord(record);

    // Momentary state is reactive by nature and stale the instant it is pulled;
    // consumedAt and stoppedWhileQueued are internal bookkeeping. See
    // docs/decisions/0005-subagent-record-admission-policy.md.
    expect(result).not.toHaveProperty("activeTools");
    expect(result).not.toHaveProperty("responseText");
    expect(result).not.toHaveProperty("consumedAt");
    expect(result).not.toHaveProperty("stoppedWhileQueued");
  });

  it("does not drift when the agent keeps accumulating usage", () => {
    const state = new SubagentState({ lifetimeUsage: { input: 100, output: 200, cacheWrite: 50 } });
    const agent = new Subagent({
      id: "usage-1",
      type: "Explore",
      description: "Check stale TODOs",
      isBackground: true,
      execution: makeStubExecution(),
      state,
    });

    const snapshot = toSubagentRecord(agent);
    state.addUsage({ input: 25, output: 0, cacheWrite: 0 });

    expect(snapshot.lifetimeUsage).toEqual({ input: 100, output: 200, cacheWrite: 50 });
    expect(agent.lifetimeUsage.input).toBe(125);
  });

  it("does not let a consumer write into the agent's own totals", () => {
    const agent = createTestSubagent({ lifetimeUsage: { input: 100, output: 200, cacheWrite: 50 } });

    const snapshot = toSubagentRecord(agent);
    snapshot.lifetimeUsage.input = 999;

    expect(agent.lifetimeUsage.input).toBe(100);
  });

  it("omits optional fields when undefined on the source", () => {
    const minimal = createTestSubagent({
      id: "min-1",
      description: "test",
      status: "running",
      result: undefined,
      toolUses: 0,
      startedAt: 500,
      completedAt: undefined,
      lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
    });
    const result = toSubagentRecord(minimal);
    expect(result).toEqual({
      id: "min-1",
      type: "general-purpose",
      description: "test",
      status: "running",
      isBackground: true,
      toolUses: 0,
      turnCount: 1,
      startedAt: 500,
      lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
      compactionCount: 0,
    });
    expect(result).not.toHaveProperty("result");
    expect(result).not.toHaveProperty("error");
    expect(result).not.toHaveProperty("completedAt");
    expect(result).not.toHaveProperty("maxTurns");
    expect(result).not.toHaveProperty("outputFile");
  });
});

/** Minimal SessionContext stub for service-adapter tests. */
function makeStubCtx(): SessionContext {
  return {
    cwd: "/tmp",
    model: undefined,
    modelRegistry: { find: () => undefined, getAll: () => [] },
    getSystemPrompt: () => "test prompt",
    sessionManager: {
      getSessionFile: () => undefined,
      getSessionId: () => "stub-session",
      getBranch: () => [],
    },
  };
}

/**
 * Minimal ServiceRuntimeLike stub for tests.
 * Override `currentCtx` to simulate no active session.
 */
function makeRuntimeStub(override: Partial<ServiceRuntimeLike> = {}): ServiceRuntimeLike {
  return {
    currentCtx: makeStubCtx(),
    buildSnapshot: vi.fn((_: boolean): ParentSnapshot => STUB_SNAPSHOT),
    getSessionInfo: vi.fn(() => ({
      parentSessionFile: "/sessions/parent.jsonl",
      parentSessionId: "parent-session-123",
    })),
    ...override,
  };
}

/**
 * Stub `SubagentManagerLike` for adapter tests.
 *
 * Return type is unannotated so callers retain each stub's `Mock<...>` methods
 * (`mockReturnValue`, `mockImplementation`); configure per-test behavior on the
 * returned object's fields.
 */
function createManagerStub() {
  return {
    spawn: vi.fn<SubagentManagerLike["spawn"]>(() => "spawned-id"),
    getRecord: vi.fn<SubagentManagerLike["getRecord"]>(),
    listAgents: vi.fn<SubagentManagerLike["listAgents"]>(() => []),
    abort: vi.fn<SubagentManagerLike["abort"]>(() => true),
    waitForAll: vi.fn<SubagentManagerLike["waitForAll"]>(async () => {}),
    hasRunning: vi.fn<SubagentManagerLike["hasRunning"]>(() => false),
    registerWorkspaceProvider: vi.fn<SubagentManagerLike["registerWorkspaceProvider"]>(() => () => {}),
  };
}

describe("SubagentsServiceAdapter — getRecord and listAgents", () => {
  const recordA = createTestSubagent({
    id: "a-1",
    type: "Explore",
    description: "task A",
    lifetimeUsage: { input: 10, output: 20, cacheWrite: 5 },
  });

  const recordB = createTestSubagent({
    id: "b-2",
    type: "Plan",
    description: "task B",
    status: "running",
    toolUses: 1,
    startedAt: 3000,
    result: undefined,
    completedAt: undefined,
    lifetimeUsage: { input: 5, output: 10, cacheWrite: 0 },
  });

  function createService(records: Subagent[]): SubagentsService {
    const manager = createManagerStub();
    manager.getRecord.mockImplementation((id) => records.find((r) => r.id === id));
    manager.listAgents.mockImplementation(() => [...records].sort((a, b) => b.startedAt - a.startedAt));
    return new SubagentsServiceAdapter(
      manager,
      () => makeModel({ id: "test" }),
      makeRuntimeStub(),
    );
  }

  it("getRecord returns serialized record for known id", () => {
    const svc = createService([recordA, recordB]);
    const result = svc.getRecord("a-1");
    expect(result).toBeDefined();
    expect(result!.id).toBe("a-1");
    expect(result).not.toHaveProperty("session");
    expect(result).not.toHaveProperty("abortController");
  });

  it("getRecord returns undefined for unknown id", () => {
    const svc = createService([recordA]);
    expect(svc.getRecord("unknown")).toBeUndefined();
  });

  it("listAgents returns serialized records sorted by startedAt descending", () => {
    const svc = createService([recordA, recordB]);
    const list = svc.listAgents();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe("b-2");
    expect(list[1].id).toBe("a-1");
    // Verify serialization
    expect(list[0]).not.toHaveProperty("session");
    expect(list[1]).not.toHaveProperty("abortController");
  });
});

describe("SubagentsServiceAdapter — spawn", () => {
  it("throws when currentCtx is undefined (no active session)", () => {
    const svc = new SubagentsServiceAdapter(
      createManagerStub(),
      vi.fn(),
      makeRuntimeStub({ currentCtx: undefined }),
    );
    expect(() => svc.spawn("Explore", "do something")).toThrow(
      /no active session/i,
    );
  });

  it("resolves string model names via resolveModel", () => {
    const resolveModel = vi.fn(() => makeModel({ id: "claude-sonnet", provider: "anthropic" }));
    const registry = { find: () => undefined, getAll: () => [] };
    const svc = new SubagentsServiceAdapter(
      createManagerStub(),
      resolveModel,
      makeRuntimeStub({ currentCtx: { ...makeStubCtx(), modelRegistry: registry } }),
    );
    svc.spawn("Explore", "check TODOs", { model: "haiku" });
    expect(resolveModel).toHaveBeenCalledWith("haiku", registry);
  });

  it("throws on model resolution failure", () => {
    const svc = new SubagentsServiceAdapter(
      createManagerStub(),
      () => 'Model not found: "bad-model".\n\nAvailable models:\n  anthropic/claude-sonnet',
      makeRuntimeStub(),
    );
    expect(() => svc.spawn("Explore", "task", { model: "bad-model" })).toThrow(
      /Model not found/,
    );
  });

  describe("thinking level", () => {
    it("throws for an unrecognized level rather than letting the SDK clamp it to off", () => {
      const svc = new SubagentsServiceAdapter(createManagerStub(), vi.fn(), makeRuntimeStub());

      expect(() => svc.spawn("Explore", "task", { thinkingLevel: "turbo" })).toThrow(
        'Invalid thinking level "turbo". Valid levels: off, minimal, low, medium, high, xhigh, max.',
      );
    });

    it("passes a recognized level through to the manager", () => {
      const mgr = createManagerStub();
      const svc = new SubagentsServiceAdapter(mgr, vi.fn(), makeRuntimeStub());

      svc.spawn("Explore", "task", { thinkingLevel: "xhigh" });

      expect(mgr.spawn).toHaveBeenCalledWith(
        expect.anything(),
        "Explore",
        "task",
        expect.objectContaining({ thinkingLevel: "xhigh" }),
      );
    });

    it("leaves the level unset when the caller omits it", () => {
      const mgr = createManagerStub();
      const svc = new SubagentsServiceAdapter(mgr, vi.fn(), makeRuntimeStub());

      svc.spawn("Explore", "task");

      expect(mgr.spawn).toHaveBeenCalledWith(
        expect.anything(),
        "Explore",
        "task",
        expect.objectContaining({ thinkingLevel: undefined }),
      );
    });
  });

  it("delegates to manager.spawn with resolved model", () => {
    const resolvedModel = makeModel({ id: "claude-sonnet", provider: "anthropic" });
    const mgr = createManagerStub();
    const svc = new SubagentsServiceAdapter(
      mgr,
      () => resolvedModel,
      makeRuntimeStub(),
    );
    const id = svc.spawn("Explore", "check TODOs", { model: "sonnet", maxTurns: 5 });
    expect(id).toBe("spawned-id");
    expect(mgr.spawn).toHaveBeenCalledWith(
      expect.anything(), // snapshot
      "Explore",
      "check TODOs",
      expect.objectContaining({
        model: resolvedModel,
        maxTurns: 5,
      }),
    );
  });

  /**
   * An SDK spawn has no tool call, so `toolCallId` is legitimately absent — but
   * the session identity is not, and permission forwarding routes on
   * `parentSessionId`. Asserted with toEqual rather than objectContaining so a
   * stray toolCallId would fail rather than be absorbed.
   */
  describe("parent session", () => {
    it("passes the runtime's session identity, without a toolCallId", () => {
      const mgr = createManagerStub();
      const svc = new SubagentsServiceAdapter(mgr, vi.fn(), makeRuntimeStub());

      svc.spawn("Explore", "check TODOs");

      expect(mgr.spawn).toHaveBeenCalledWith(
        expect.anything(), // snapshot
        "Explore",
        "check TODOs",
        expect.objectContaining({
          parentSession: {
            parentSessionFile: "/sessions/parent.jsonl",
            parentSessionId: "parent-session-123",
          },
        }),
      );
    });
  });

  /**
   * A caller that names `foreground` has committed to a mode; one that omits it
   * has not, and the agent's own frontmatter decides. The manager reads the
   * `kind` to tell those apart, so each case must pin the whole request object —
   * the isBackground value alone cannot distinguish an explicit answer from a
   * default that happens to agree.
   */
  describe("background mode", () => {
    function spawnAndCaptureBackground(options?: { foreground?: boolean }) {
      const mgr = createManagerStub();
      const svc = new SubagentsServiceAdapter(mgr, vi.fn(), makeRuntimeStub());
      svc.spawn("Plan", "plan work", options);
      return mgr.spawn;
    }

    it("defers to the agent config when foreground is omitted", () => {
      const spawn = spawnAndCaptureBackground();

      expect(spawn).toHaveBeenCalledWith(
        expect.anything(), // snapshot
        "Plan",
        "plan work",
        expect.objectContaining({ background: { kind: "default", isBackground: true } }),
      );
    });

    it("commits to foreground when foreground is true", () => {
      const spawn = spawnAndCaptureBackground({ foreground: true });

      expect(spawn).toHaveBeenCalledWith(
        expect.anything(), // snapshot
        "Plan",
        "plan work",
        expect.objectContaining({ background: { kind: "explicit", isBackground: false } }),
      );
    });

    it("commits to background when foreground is false", () => {
      const spawn = spawnAndCaptureBackground({ foreground: false });

      expect(spawn).toHaveBeenCalledWith(
        expect.anything(), // snapshot
        "Plan",
        "plan work",
        expect.objectContaining({ background: { kind: "explicit", isBackground: true } }),
      );
    });
  });

  it("uses truncated prompt as default description", () => {
    const mgr = createManagerStub();
    const svc = new SubagentsServiceAdapter(mgr, vi.fn(), makeRuntimeStub());
    const longPrompt = "x".repeat(200);
    svc.spawn("Explore", longPrompt);
    expect(mgr.spawn).toHaveBeenCalledWith(
      expect.anything(), // snapshot
      "Explore",
      longPrompt,
      expect.objectContaining({ description: "x".repeat(80) }),
    );
  });

  it("uses provided description over default", () => {
    const mgr = createManagerStub();
    const svc = new SubagentsServiceAdapter(mgr, vi.fn(), makeRuntimeStub());
    svc.spawn("Explore", "long prompt here", { description: "short desc" });
    expect(mgr.spawn).toHaveBeenCalledWith(
      expect.anything(), // snapshot
      "Explore",
      "long prompt here",
      expect.objectContaining({ description: "short desc" }),
    );
  });

  it("does not call resolveModel when no model option is provided", () => {
    const resolveModel = vi.fn();
    const svc = new SubagentsServiceAdapter(createManagerStub(), resolveModel, makeRuntimeStub());
    svc.spawn("Explore", "quick check");
    expect(resolveModel).not.toHaveBeenCalled();
  });
});

describe("SubagentsServiceAdapter — steer, abort, waitForAll, hasRunning", () => {
  function createSvc(mgr: ReturnType<typeof createManagerStub>) {
    return new SubagentsServiceAdapter(mgr, vi.fn(), makeRuntimeStub());
  }

  describe("abort", () => {
    it("delegates to manager.abort and returns its result", () => {
      const mgr = createManagerStub();
      const svc = createSvc(mgr);
      const result = svc.abort("agent-1");
      expect(mgr.abort).toHaveBeenCalledWith("agent-1");
      expect(result).toBe(true);
    });

    it("returns false when manager returns false", () => {
      const mgr = createManagerStub();
      mgr.abort.mockReturnValue(false);
      const svc = createSvc(mgr);
      expect(svc.abort("unknown")).toBe(false);
    });
  });

  describe("waitForAll", () => {
    it("delegates to manager.waitForAll", async () => {
      const mgr = createManagerStub();
      const svc = createSvc(mgr);
      await svc.waitForAll();
      expect(mgr.waitForAll).toHaveBeenCalled();
    });
  });

  describe("hasRunning", () => {
    it("delegates to manager.hasRunning", () => {
      const mgr = createManagerStub();
      mgr.hasRunning.mockReturnValue(true);
      const svc = createSvc(mgr);
      expect(svc.hasRunning()).toBe(true);
      expect(mgr.hasRunning).toHaveBeenCalled();
    });
  });

  describe("steer", () => {
    it("returns false for non-running agent", async () => {
      const mgr = createManagerStub();
      mgr.getRecord.mockReturnValue(createTestSubagent({ id: "a-1", status: "completed" }));
      const svc = createSvc(mgr);
      expect(await svc.steer("a-1", "hurry")).toBe(false);
    });

    it("returns false for unknown agent", async () => {
      const mgr = createManagerStub();
      mgr.getRecord.mockReturnValue(undefined);
      const svc = createSvc(mgr);
      expect(await svc.steer("unknown", "hurry")).toBe(false);
    });

    it("queues message and returns true when session not ready", async () => {
      const record = createTestSubagent({ id: "a-1", status: "running" });
      const mgr = createManagerStub();
      mgr.getRecord.mockReturnValue(record);
      const svc = createSvc(mgr);
      expect(await svc.steer("a-1", "do this")).toBe(true);
      expect(record.pendingSteerCount).toBe(1);
    });

    it("delegates to session.steer and returns true when session is ready", async () => {
      const mockSteer = vi.fn(async () => {});
      const record = createTestSubagent({ id: "a-1", status: "running" });
      record.subagentSession = toSubagentSession(createSubagentSessionStub(createMockSession({ steer: mockSteer })));
      const mgr = createManagerStub();
      mgr.getRecord.mockReturnValue(record);
      const svc = createSvc(mgr);
      expect(await svc.steer("a-1", "focus on tests")).toBe(true);
      expect(mockSteer).toHaveBeenCalledWith("focus on tests");
    });
  });
});

describe("SubagentsServiceAdapter — registerWorkspaceProvider", () => {
  it("delegates to manager.registerWorkspaceProvider and returns its disposer", () => {
    const disposer = vi.fn();
    const mgr = createManagerStub();
    mgr.registerWorkspaceProvider.mockReturnValue(disposer);
    const svc = new SubagentsServiceAdapter(mgr, vi.fn(), makeRuntimeStub());
    const provider: WorkspaceProvider = { prepare: vi.fn(async () => undefined) };

    const result = svc.registerWorkspaceProvider(provider);

    expect(mgr.registerWorkspaceProvider).toHaveBeenCalledWith(provider);
    expect(result).toBe(disposer);
  });
});
