import { describe, expect, it, vi } from "vitest";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import type { WorkspaceProvider } from "#src/lifecycle/workspace";
import type { SubagentsService } from "#src/service/service";
import type { ServiceRuntimeLike, SubagentManagerLike } from "#src/service/service-adapter";
import { SubagentsServiceAdapter, toSubagentRecord } from "#src/service/service-adapter";
import type { SessionContext, Subagent } from "#src/types";
import { makeModel } from "#test/helpers/make-model";
import { createTestSubagent } from "#test/helpers/make-subagent";
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
      result: "Found 3 stale TODOs",
      toolUses: 5,
      startedAt: 1000,
      completedAt: 2000,
      lifetimeUsage: { input: 100, output: 200, cacheWrite: 50 },
      compactionCount: 1,
    });
  });

  it("strips the session from the serialized record", () => {
    const record = createTestSubagent();
    record.subagentSession = toSubagentSession(createSubagentSessionStub(createMockSession()));
    const result = toSubagentRecord(record);
    expect(result).not.toHaveProperty("subagentSession");
  });

  it("strips abortController from the record", () => {
    const record = createTestSubagent();
    const result = toSubagentRecord(record);
    expect(result).not.toHaveProperty("abortController");
  });

  it("strips promise from the record", () => {
    const record = createTestSubagent();
    const result = toSubagentRecord(record);
    expect(result).not.toHaveProperty("promise");
  });

  it("strips abortController, promise, and collaborator fields from the record", () => {
    const record = createTestSubagent();
    const result = toSubagentRecord(record);
    expect(result).not.toHaveProperty("abortController");
    expect(result).not.toHaveProperty("promise");
    expect(result).not.toHaveProperty("execution");
    expect(result).not.toHaveProperty("notification");
  });

  it("strips invocation and collaborator fields from the serialized output", () => {
    const record = createTestSubagent({ invocation: { modelName: "haiku" }, toolCallId: "tc-1" });
    const result = toSubagentRecord(record);
    expect(result).not.toHaveProperty("notification");
    expect(result).not.toHaveProperty("execution");
    expect(result).not.toHaveProperty("invocation");
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
      toolUses: 0,
      startedAt: 500,
      lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
      compactionCount: 0,
    });
    expect(result).not.toHaveProperty("result");
    expect(result).not.toHaveProperty("error");
    expect(result).not.toHaveProperty("completedAt");
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
  const { getSessionInfo, ...rest } = override;
  return {
    currentCtx: makeStubCtx(),
    buildSnapshot: vi.fn((_: boolean): ParentSnapshot => STUB_SNAPSHOT),
    getSessionInfo: getSessionInfo ?? (() => ({
      parentSessionFile: "/sessions/parent.jsonl",
      parentSessionId: "stub-session",
    })),
    ...rest,
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
    registerLifecycleInterceptor: vi.fn<SubagentManagerLike["registerLifecycleInterceptor"]>(() => ({
      dispose: async () => {},
    })),
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
        isBackground: true,
        origin: "service",
        lifecycleParentSession: {
          parentSessionFile: "/sessions/parent.jsonl",
          parentSessionId: "stub-session",
        },
      }),
    );
  });

  it("spawns as foreground when options.foreground is true", () => {
    const mgr = createManagerStub();
    const svc = new SubagentsServiceAdapter(
      mgr,
      vi.fn(),
      makeRuntimeStub(),
    );
    svc.spawn("Plan", "plan work", { foreground: true });
    expect(mgr.spawn).toHaveBeenCalledWith(
      expect.anything(), // snapshot
      "Plan",
      "plan work",
      expect.objectContaining({ isBackground: false }),
    );
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

describe("SubagentsServiceAdapter — registerLifecycleInterceptor", () => {
  it("delegates the generic provider without exposing manager internals", () => {
    const registration = { dispose: vi.fn(async () => {}) };
    const mgr = createManagerStub();
    mgr.registerLifecycleInterceptor.mockReturnValue(registration);
    const svc = new SubagentsServiceAdapter(mgr, vi.fn(), makeRuntimeStub());
    const interceptor = { beforeStart: () => ({ action: "continue" as const }) };

    expect(svc.registerLifecycleInterceptor(interceptor)).toBe(registration);
    expect(mgr.registerLifecycleInterceptor).toHaveBeenCalledWith(interceptor);
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
