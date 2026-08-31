import { describe, expect, it, vi } from "vitest";
import {
  type ChildLifecyclePublisher,
  createChildLifecyclePublisher,
  SUBAGENT_CHILD_BOUND,
  SUBAGENT_CHILD_COMPLETED,
  SUBAGENT_CHILD_DISPOSED,
  SUBAGENT_CHILD_SESSION_CREATED,
  SUBAGENT_CHILD_SPAWNING,
} from "#src/lifecycle/child-lifecycle";

function setup(): {
  emit: ReturnType<typeof vi.fn>;
  publisher: ChildLifecyclePublisher;
} {
  const emit = vi.fn<(channel: string, data: unknown) => void>();
  const publisher = createChildLifecyclePublisher(emit);
  return { emit, publisher };
}

describe("createChildLifecyclePublisher", () => {
  it("emits subagents:child:spawning with the agent identity", () => {
    const { emit, publisher } = setup();

    publisher.spawning({ agentName: "Explore", parentSessionId: "parent-42" });

    expect(emit).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith(SUBAGENT_CHILD_SPAWNING, {
      agentName: "Explore",
      parentSessionId: "parent-42",
    });
  });

  it("emits subagents:child:session-created with the child session id", () => {
    const { emit, publisher } = setup();

    publisher.sessionCreated({
      sessionId: "child-session-abc",
      parentSessionId: "parent-42",
    });

    expect(emit).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith(SUBAGENT_CHILD_SESSION_CREATED, {
      sessionId: "child-session-abc",
      parentSessionId: "parent-42",
    });
  });

  it("emits subagents:child:completed with the run outcome", () => {
    const { emit, publisher } = setup();

    publisher.completed({
      sessionDir: "/sessions/child-abc",
      agentName: "Explore",
      aborted: false,
      steered: true,
    });

    expect(emit).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith(SUBAGENT_CHILD_COMPLETED, {
      sessionDir: "/sessions/child-abc",
      agentName: "Explore",
      aborted: false,
      steered: true,
    });
  });

  it("emits subagents:child:bound with the child session id", () => {
    const { emit, publisher } = setup();

    publisher.bound({
      sessionId: "child-session-abc",
      parentSessionId: "parent-42",
    });

    expect(emit).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith(SUBAGENT_CHILD_BOUND, {
      sessionId: "child-session-abc",
      parentSessionId: "parent-42",
    });
  });

  it("emits subagents:child:disposed with the child session id", () => {
    const { emit, publisher } = setup();

    publisher.disposed({ sessionId: "child-session-abc" });

    expect(emit).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith(SUBAGENT_CHILD_DISPOSED, {
      sessionId: "child-session-abc",
    });
  });

  it("passes an undefined parentSessionId through unchanged", () => {
    const { emit, publisher } = setup();

    publisher.spawning({ agentName: "general-purpose", parentSessionId: undefined });

    expect(emit).toHaveBeenCalledWith(SUBAGENT_CHILD_SPAWNING, {
      agentName: "general-purpose",
      parentSessionId: undefined,
    });
  });

  it("exposes the canonical channel-name strings", () => {
    expect(SUBAGENT_CHILD_SPAWNING).toBe("subagents:child:spawning");
    expect(SUBAGENT_CHILD_SESSION_CREATED).toBe("subagents:child:session-created");
    expect(SUBAGENT_CHILD_BOUND).toBe("subagents:child:bound");
    expect(SUBAGENT_CHILD_COMPLETED).toBe("subagents:child:completed");
    expect(SUBAGENT_CHILD_DISPOSED).toBe("subagents:child:disposed");
  });
});
