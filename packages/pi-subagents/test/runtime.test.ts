import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import { createSubagentRuntime, SubagentRuntime } from "#src/runtime";
import type { SessionContext } from "#src/types";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";

const mockBuildParentSnapshot = vi.hoisted(() =>
  vi.fn<(ctx: SessionContext, inheritContext?: boolean) => ParentSnapshot>(),
);

vi.mock("#src/lifecycle/parent-snapshot", () => ({
  buildParentSnapshot: mockBuildParentSnapshot,
}));

function makeSessionCtx(overrides?: Partial<SessionContext>): SessionContext {
  return {
    cwd: "/test/cwd",
    model: undefined,
    modelRegistry: undefined,
    getSystemPrompt: () => "test prompt",
    sessionManager: {
      getSessionFile: () => "/sessions/test.jsonl",
      getSessionId: () => "test-session-id",
      getBranch: () => [],
    },
    ...overrides,
  };
}

describe("createSubagentRuntime", () => {
  it("returns correct defaults", () => {
    const runtime = createSubagentRuntime();
    expect(runtime.currentCtx).toBeUndefined();
  });

  it("currentCtx is the stored SessionContext after setSessionContext", () => {
    const runtime = createSubagentRuntime();
    const ctx = makeSessionCtx();
    runtime.setSessionContext(ctx);
    expect(runtime.currentCtx).toBe(ctx);
  });
});

describe("SubagentRuntime class", () => {
  it("is a class — instances are created with new", () => {
    const runtime = new SubagentRuntime();
    expect(runtime).toBeInstanceOf(SubagentRuntime);
  });

  it("createSubagentRuntime returns an instance of the class", () => {
    const runtime = createSubagentRuntime();
    expect(runtime).toBeInstanceOf(SubagentRuntime);
  });
});

describe("SubagentRuntime session-context methods", () => {
  it("setSessionContext stores the provided SessionContext directly", () => {
    const runtime = createSubagentRuntime();
    const ctx = makeSessionCtx();
    runtime.setSessionContext(ctx);
    expect(runtime.currentCtx).toBe(ctx);
  });

  it("clearSessionContext resets currentCtx to undefined", () => {
    const runtime = createSubagentRuntime();
    runtime.setSessionContext(makeSessionCtx());
    expect(runtime.currentCtx).toBeDefined();
    runtime.clearSessionContext();
    expect(runtime.currentCtx).toBeUndefined();
  });

  it("round-trip: set then clear returns to initial state", () => {
    const runtime = createSubagentRuntime();
    expect(runtime.currentCtx).toBeUndefined();
    const ctx = makeSessionCtx();
    runtime.setSessionContext(ctx);
    expect(runtime.currentCtx).toBe(ctx);
    runtime.clearSessionContext();
    expect(runtime.currentCtx).toBeUndefined();
  });
});

describe("SubagentRuntime context query methods", () => {
  beforeEach(() => {
    mockBuildParentSnapshot.mockReset();
  });

  it("buildSnapshot delegates to buildParentSnapshot with the current context and inheritContext flag", () => {
    const runtime = createSubagentRuntime();
    const ctx = makeSessionCtx();
    runtime.setSessionContext(ctx);
    mockBuildParentSnapshot.mockReturnValueOnce(STUB_SNAPSHOT);
    const result = runtime.buildSnapshot(true);
    expect(mockBuildParentSnapshot).toHaveBeenCalledWith(ctx, true, []);
    expect(result).toBe(STUB_SNAPSHOT);
  });

  it("captures active extension tools through its composition provider", () => {
    const runtime = createSubagentRuntime();
    const ctx = makeSessionCtx();
    runtime.setSessionContext(ctx);
    runtime.setActiveToolsProvider(() => ["read", "extension_tool"]);
    mockBuildParentSnapshot.mockReturnValueOnce(STUB_SNAPSHOT);

    runtime.buildSnapshot(true);

    expect(mockBuildParentSnapshot).toHaveBeenCalledWith(ctx, true, ["read", "extension_tool"]);
  });

  it("buildSnapshot passes false inheritContext correctly", () => {
    const runtime = createSubagentRuntime();
    const ctx = makeSessionCtx();
    runtime.setSessionContext(ctx);
    mockBuildParentSnapshot.mockReturnValueOnce(STUB_SNAPSHOT);
    runtime.buildSnapshot(false);
    expect(mockBuildParentSnapshot).toHaveBeenCalledWith(ctx, false, []);
  });

  it("getModelInfo returns model and modelRegistry from current context", () => {
    const runtime = createSubagentRuntime();
    const registry = { find: () => undefined, getAll: () => [], getAvailable: () => [] };
    const ctx = makeSessionCtx({ model: { id: "claude-sonnet", name: "Claude Sonnet" }, modelRegistry: registry });
    runtime.setSessionContext(ctx);
    const info = runtime.getModelInfo();
    expect(info.parentModel).toEqual({ id: "claude-sonnet", name: "Claude Sonnet" });
    expect(info.modelRegistry).toBe(registry);
  });

  it("getModelInfo returns undefined parentModel when context model is undefined", () => {
    const runtime = createSubagentRuntime();
    const ctx = makeSessionCtx({ model: undefined });
    runtime.setSessionContext(ctx);
    const info = runtime.getModelInfo();
    expect(info.parentModel).toBeUndefined();
  });

  it("getSessionInfo returns session file and id from sessionManager", () => {
    const runtime = createSubagentRuntime();
    const ctx = makeSessionCtx({
      sessionManager: {
        getSessionFile: () => "/sessions/parent.jsonl",
        getSessionId: () => "session-42",
        getBranch: () => [],
      },
    });
    runtime.setSessionContext(ctx);
    const info = runtime.getSessionInfo();
    expect(info.parentSessionFile).toBe("/sessions/parent.jsonl");
    expect(info.parentSessionId).toBe("session-42");
  });

  it("getSessionInfo uses empty string when getSessionFile returns undefined", () => {
    const runtime = createSubagentRuntime();
    const ctx = makeSessionCtx({
      sessionManager: {
        getSessionFile: () => undefined,
        getSessionId: () => "session-99",
        getBranch: () => [],
      },
    });
    runtime.setSessionContext(ctx);
    const info = runtime.getSessionInfo();
    expect(info.parentSessionFile).toBe("");
    expect(info.parentSessionId).toBe("session-99");
  });
});
