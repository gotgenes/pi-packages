/**
 * SubagentsServiceAdapter.spawn() must pass an `invocation` object to
 * manager.spawn(), mirroring the tool path (background-spawner.ts:34), so
 * the native widget's roster filter
 * (record.invocation?.runInBackground === true, agent-widget.ts:168) admits
 * SDK-spawned agents instead of treating them as permanently ineligible.
 */
import { describe, expect, it, vi } from "vitest";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import type { ServiceRuntimeLike, SubagentManagerLike } from "#src/service/service-adapter";
import { SubagentsServiceAdapter } from "#src/service/service-adapter";
import type { SessionContext } from "#src/types";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";

function makeStubCtx(): SessionContext {
  return {
    cwd: "/tmp",
    model: undefined,
    modelRegistry: { find: () => undefined, getAll: () => [] },
    getSystemPrompt: () => "test prompt",
    sessionManager: {
      getSessionFile: () => "/tmp/session.jsonl",
      getSessionId: () => "stub-session-id",
      getBranch: () => [],
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

describe("SubagentsServiceAdapter.spawn — invocation", () => {
  it("passes invocation: { runInBackground: true } for a background spawn (default)", () => {
    const mgr = createManagerStub();
    const svc = new SubagentsServiceAdapter(mgr, vi.fn(), makeRuntimeStub());

    svc.spawn("Explore", "check TODOs");

    expect(mgr.spawn).toHaveBeenCalledWith(
      expect.anything(),
      "Explore",
      "check TODOs",
      expect.objectContaining({ invocation: { runInBackground: true } }),
    );
  });

  it("passes invocation: { runInBackground: false } for a foreground spawn", () => {
    const mgr = createManagerStub();
    const svc = new SubagentsServiceAdapter(mgr, vi.fn(), makeRuntimeStub());

    svc.spawn("Plan", "plan work", { foreground: true });

    expect(mgr.spawn).toHaveBeenCalledWith(
      expect.anything(),
      "Plan",
      "plan work",
      expect.objectContaining({ invocation: { runInBackground: false } }),
    );
  });
});
