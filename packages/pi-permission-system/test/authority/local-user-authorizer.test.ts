import { describe, expect, it, vi } from "vitest";
import { LocalUserAuthorizer } from "#src/authority/local-user-authorizer";
import type { PermissionPromptDecision } from "#src/authority/permission-dialog";
import type { requestPermissionDecision } from "#src/authority/permission-prompt-component";
import type { PromptPermissionDetails } from "#src/authority/permission-prompter";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeDetails(
  overrides?: Partial<PromptPermissionDetails>,
): PromptPermissionDetails {
  return {
    requestId: "req-123",
    source: "tool_call",
    agentName: "test-agent",
    message: "Allow read?",
    toolName: "read",
    ...overrides,
  };
}

/** A `PermissionPromptUi` double; the tool-expansion accessors go unused here. */
function makePromptUi() {
  return {
    select: vi.fn(),
    input: vi.fn(),
    custom: vi.fn(),
    getToolsExpanded: vi.fn(() => false),
    setToolsExpanded: vi.fn(),
  };
}

function makeDeps(
  overrides: {
    requestPermissionDecision?: typeof requestPermissionDecision;
  } = {},
) {
  const events = {
    emit: vi.fn(),
    on: vi.fn().mockReturnValue(() => undefined),
  };
  const ui = makePromptUi();
  const decisionFn =
    overrides.requestPermissionDecision ??
    vi
      .fn<typeof requestPermissionDecision>()
      .mockResolvedValue({ approved: true, state: "approved" });
  return {
    deps: {
      ui,
      mode: "tui" as const,
      events,
      getPromptPreferences: () => ({ doublePressToConfirm: true }),
      requestPermissionDecision: decisionFn,
    },
    events,
    ui,
    decisionFn,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("LocalUserAuthorizer", () => {
  it("emits a UI prompt event with normalized surface and value", async () => {
    const { deps, events } = makeDeps();
    const authorizer = new LocalUserAuthorizer(deps);

    await authorizer.authorize(
      makeDetails({
        toolName: "bash",
        command: "git push",
        toolInputPreview: "git push",
      }),
    );

    expect(events.emit).toHaveBeenCalledWith("permissions:ui_prompt", {
      requestId: "req-123",
      source: "tool_call",
      surface: "bash",
      value: "git push",
      agentName: "test-agent",
      message: "Allow read?",
      forwarding: null,
    });
  });

  it("normalizes skill prompt events to the skill surface", async () => {
    const { deps, events } = makeDeps();
    const authorizer = new LocalUserAuthorizer(deps);

    await authorizer.authorize(
      makeDetails({
        source: "skill_input",
        toolName: undefined,
        skillName: "deploy-helper",
      }),
    );

    expect(events.emit).toHaveBeenCalledWith("permissions:ui_prompt", {
      requestId: "req-123",
      source: "skill_input",
      surface: "skill",
      value: "deploy-helper",
      agentName: "test-agent",
      message: "Allow read?",
      forwarding: null,
    });
  });

  it("calls requestPermissionDecision with the threaded view, title, and message", async () => {
    const { deps, ui, decisionFn } = makeDeps();
    const authorizer = new LocalUserAuthorizer(deps);

    await authorizer.authorize(makeDetails());

    expect(decisionFn).toHaveBeenCalledWith(
      { mode: "tui", ui, doublePressToConfirm: true },
      "Permission Required",
      "Allow read?",
      undefined,
    );
  });

  it("passes the sessionLabel option when present", async () => {
    const { deps, decisionFn } = makeDeps();
    const authorizer = new LocalUserAuthorizer(deps);

    await authorizer.authorize(
      makeDetails({ sessionLabel: "Yes, for 'read' tool" }),
    );

    expect(decisionFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.any(String),
      { sessionLabel: "Yes, for 'read' tool" },
    );
  });

  describe("Herdr blocked lifecycle", () => {
    it("stays blocked while a direct permission decision is pending", async () => {
      const calls: string[] = [];
      const pending = Promise.withResolvers<PermissionPromptDecision>();
      const events = {
        emit: vi.fn((channel: string, data: unknown) => {
          if (channel === "herdr:blocked") {
            const { active } = data as { active: boolean };
            calls.push(active ? "herdr:active" : "herdr:inactive");
            return;
          }
          calls.push(channel);
        }),
        on: vi.fn().mockReturnValue(() => undefined),
      };
      const ui = makePromptUi();
      const decisionFn = vi.fn<typeof requestPermissionDecision>(() => {
        calls.push("dialog");
        return pending.promise;
      });
      const authorizer = new LocalUserAuthorizer({
        ui,
        mode: "tui",
        events,
        getPromptPreferences: () => ({ doublePressToConfirm: true }),
        requestPermissionDecision: decisionFn,
      });

      const decisionPromise = authorizer.authorize(makeDetails());

      expect(calls).toEqual([
        "permissions:ui_prompt",
        "herdr:active",
        "dialog",
      ]);
      expect(events.emit).toHaveBeenNthCalledWith(2, "herdr:blocked", {
        active: true,
        label: "Permission Required",
      });

      const decision: PermissionPromptDecision = {
        approved: true,
        state: "approved",
      };
      pending.resolve(decision);
      await expect(decisionPromise).resolves.toEqual(decision);

      expect(calls).toEqual([
        "permissions:ui_prompt",
        "herdr:active",
        "dialog",
        "herdr:inactive",
      ]);
      expect(events.emit).toHaveBeenNthCalledWith(3, "herdr:blocked", {
        active: false,
      });
    });

    it("brackets a forwarded subagent prompt on the serving event bus", async () => {
      const { deps, events } = makeDeps();
      const authorizer = new LocalUserAuthorizer(deps);

      await authorizer.authorize(
        makeDetails({
          forwarding: {
            requesterAgentName: "Explore",
            requesterSessionId: "child-session",
          },
        }),
      );

      expect(events.emit).toHaveBeenCalledTimes(3);
      expect(events.emit).toHaveBeenNthCalledWith(2, "herdr:blocked", {
        active: true,
        label: "Permission Required",
      });
      expect(events.emit).toHaveBeenNthCalledWith(3, "herdr:blocked", {
        active: false,
      });
    });

    it("clears the blocked state when the decision rejects", async () => {
      const failure = new Error("prompt failed");
      const { deps, events } = makeDeps({
        requestPermissionDecision: vi
          .fn<typeof requestPermissionDecision>()
          .mockRejectedValue(failure),
      });
      const authorizer = new LocalUserAuthorizer(deps);

      await expect(authorizer.authorize(makeDetails())).rejects.toBe(failure);

      expect(events.emit).toHaveBeenNthCalledWith(3, "herdr:blocked", {
        active: false,
      });
    });

    it("ignores Herdr listener failures", async () => {
      const decision: PermissionPromptDecision = {
        approved: false,
        state: "denied",
      };
      const { deps, events, decisionFn } = makeDeps({
        requestPermissionDecision: vi
          .fn<typeof requestPermissionDecision>()
          .mockResolvedValue(decision),
      });
      events.emit.mockImplementation((channel: string) => {
        if (channel === "herdr:blocked") {
          throw new Error("listener failed");
        }
      });
      const authorizer = new LocalUserAuthorizer(deps);

      await expect(authorizer.authorize(makeDetails())).resolves.toEqual(
        decision,
      );

      expect(decisionFn).toHaveBeenCalledOnce();
      expect(events.emit).toHaveBeenCalledTimes(3);
    });
  });

  describe("forwarded provenance", () => {
    it("emits a non-degraded forwarded event with populated forwarding and the child's display projection", async () => {
      const { deps, events } = makeDeps();
      const authorizer = new LocalUserAuthorizer(deps);

      await authorizer.authorize(
        makeDetails({
          source: "tool_call",
          agentName: "Explore",
          message:
            "Subagent 'Explore' requested permission.\n\nAllow git push?",
          surface: "bash",
          value: "git push",
          forwarding: {
            requesterAgentName: "Explore",
            requesterSessionId: "child-session",
          },
        }),
      );

      expect(events.emit).toHaveBeenCalledWith("permissions:ui_prompt", {
        requestId: "req-123",
        source: "tool_call",
        surface: "bash",
        value: "git push",
        agentName: "Explore",
        message: "Subagent 'Explore' requested permission.\n\nAllow git push?",
        forwarding: {
          requesterAgentName: "Explore",
          requesterSessionId: "child-session",
        },
      });
    });

    it("uses the '(Subagent)' dialog title when the ask is forwarded", async () => {
      const { deps, ui, decisionFn } = makeDeps();
      const authorizer = new LocalUserAuthorizer(deps);

      await authorizer.authorize(
        makeDetails({
          forwarding: {
            requesterAgentName: "Explore",
            requesterSessionId: "child-session",
          },
        }),
      );

      expect(decisionFn).toHaveBeenCalledWith(
        { mode: "tui", ui, doublePressToConfirm: true },
        "Permission Required (Subagent)",
        "Allow read?",
        undefined,
      );
    });

    it("offers a sessionScope when the forwarded ask carries a suggestion", async () => {
      const { deps, decisionFn } = makeDeps();
      const authorizer = new LocalUserAuthorizer(deps);

      await authorizer.authorize(
        makeDetails({
          toolName: "bash",
          command: "git push",
          forwarding: {
            requesterAgentName: "Explore",
            requesterSessionId: "child-session",
          },
          sessionApproval: { surface: "bash", patterns: ["git *"] },
        }),
      );

      expect(decisionFn).toHaveBeenCalledWith(
        expect.anything(),
        "Permission Required (Subagent)",
        expect.any(String),
        {
          sessionScope: {
            subagentLabel: "This subagent ('Explore') only",
            servingSessionLabel:
              'The whole session — allow bash "git *" for parent and all subagents',
          },
        },
      );
    });

    it("offers no sessionScope for a forwarded ask without a suggestion", async () => {
      const { deps, decisionFn } = makeDeps();
      const authorizer = new LocalUserAuthorizer(deps);

      await authorizer.authorize(
        makeDetails({
          forwarding: {
            requesterAgentName: "Explore",
            requesterSessionId: "child-session",
          },
        }),
      );

      expect(decisionFn).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.any(String),
        undefined,
      );
    });
  });

  it("returns the decision from requestPermissionDecision", async () => {
    const decision: PermissionPromptDecision = {
      approved: false,
      state: "denied",
    };
    const { deps } = makeDeps({
      requestPermissionDecision: vi
        .fn<typeof requestPermissionDecision>()
        .mockResolvedValue(decision),
    });
    const authorizer = new LocalUserAuthorizer(deps);

    const result = await authorizer.authorize(makeDetails());

    expect(result).toEqual(decision);
  });
});
