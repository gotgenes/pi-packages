/**
 * SubagentsServiceAdapter.spawn() must forward parentSession to
 * manager.spawn(), mirroring the tool path (background-spawner.ts:34), so
 * that a parent/child permission-forwarding consumer can resolve `ask`-level
 * rules for SDK-spawned children.
 */
import { describe, expect, it, vi } from "vitest";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import type { ServiceRuntimeLike, SubagentManagerLike } from "#src/service/service-adapter";
import { SubagentsServiceAdapter } from "#src/service/service-adapter";
import type { SessionContext } from "#src/types";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";

function makeStubCtx(overrides: Partial<SessionContext["sessionManager"]> = {}): SessionContext {
  return {
    cwd: "/tmp",
    model: undefined,
    modelRegistry: { find: () => undefined, getAll: () => [] },
    getSystemPrompt: () => "test prompt",
    sessionManager: {
      getSessionFile: () => "/tmp/session.jsonl",
      getSessionId: () => "stub-session-id",
      getBranch: () => [],
      ...overrides,
    },
  };
}

function makeRuntimeStub(override: Partial<ServiceRuntimeLike> = {}): ServiceRuntimeLike {
  return {
    currentCtx: makeStubCtx(),
    buildSnapshot: vi.fn((_: boolean): ParentSnapshot => STUB_SNAPSHOT),
    ...override,
  };
}

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

describe("SubagentsServiceAdapter.spawn — parentSession forwarding", () => {
  it("passes parentSession built from currentCtx.sessionManager", () => {
    const mgr = createManagerStub();
    const svc = new SubagentsServiceAdapter(
      mgr,
      vi.fn(),
      makeRuntimeStub({
        currentCtx: makeStubCtx({
          getSessionId: () => "parent-session-42",
          getSessionFile: () => "/sessions/parent-42.jsonl",
        }),
      }),
    );

    svc.spawn("Explore", "check TODOs");

    expect(mgr.spawn).toHaveBeenCalledWith(
      expect.anything(),
      "Explore",
      "check TODOs",
      expect.objectContaining({
        parentSession: {
          parentSessionId: "parent-session-42",
          parentSessionFile: "/sessions/parent-42.jsonl",
        },
      }),
    );
  });

  it("forwards an undefined session file as undefined (no coercion)", () => {
    const mgr = createManagerStub();
    const svc = new SubagentsServiceAdapter(
      mgr,
      vi.fn(),
      makeRuntimeStub({
        currentCtx: makeStubCtx({
          getSessionId: () => "no-file-session",
          getSessionFile: () => undefined,
        }),
      }),
    );

    svc.spawn("Explore", "check TODOs");

    expect(mgr.spawn).toHaveBeenCalledWith(
      expect.anything(),
      "Explore",
      "check TODOs",
      expect.objectContaining({
        parentSession: {
          parentSessionId: "no-file-session",
          parentSessionFile: undefined,
        },
      }),
    );
  });

  it("still throws the existing error when currentCtx is undefined", () => {
    const mgr = createManagerStub();
    const svc = new SubagentsServiceAdapter(mgr, vi.fn(), makeRuntimeStub({ currentCtx: undefined }));

    expect(() => svc.spawn("Explore", "do something")).toThrow(/no active session/i);
    expect(mgr.spawn).not.toHaveBeenCalled();
  });
});
