import { describe, expect, it, vi } from "vitest";
import { LocalUserAuthorizer } from "#src/authority/local-user-authorizer";
import type { PermissionPromptDecision } from "#src/authority/permission-dialog";
import type { requestPermissionDecision } from "#src/authority/permission-prompt-component";
import type { PromptPermissionDetails } from "#src/authority/permission-prompter";
import type { PersistentApprovalApi } from "#src/persistent-approval-service";

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
    persistentApprovalService?: PersistentApprovalApi;
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
      getPromptPreferences: () => ({
        doublePressToConfirm: true,
        showPersistenceSummary: true,
      }),
      requestPermissionDecision: decisionFn,
      persistentApprovalService: overrides.persistentApprovalService,
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
      {
        mode: "tui",
        ui,
        doublePressToConfirm: true,
        showPersistenceSummary: true,
        setShowPersistenceSummary: undefined,
      },
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

  it("emits the UI event before calling requestPermissionDecision", async () => {
    const calls: string[] = [];
    const events = {
      emit: vi.fn(() => {
        calls.push("emit");
      }),
      on: vi.fn().mockReturnValue(() => undefined),
    };
    const ui = makePromptUi();
    const decisionFn = vi.fn<typeof requestPermissionDecision>(() => {
      calls.push("dialog");
      return Promise.resolve({ approved: true, state: "approved" });
    });
    const authorizer = new LocalUserAuthorizer({
      ui,
      mode: "tui",
      events,
      getPromptPreferences: () => ({
        doublePressToConfirm: true,
        showPersistenceSummary: true,
      }),
      requestPermissionDecision: decisionFn,
    });

    await authorizer.authorize(makeDetails());

    expect(calls).toEqual(["emit", "dialog"]);
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
        {
          mode: "tui",
          ui,
          doublePressToConfirm: true,
          showPersistenceSummary: true,
          setShowPersistenceSummary: undefined,
        },
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

  it("persists a durable choice before approving the pending request", async () => {
    const target = {
      scope: "project" as const,
      path: "/project/config.local.json",
      expectedDir: "/project",
    };
    const persist = vi.fn(() => ({ path: target.path }));
    const service: PersistentApprovalApi = {
      prepare: vi.fn(() => target),
      persist,
    };
    const { deps } = makeDeps({
      persistentApprovalService: service,
      requestPermissionDecision: vi
        .fn<typeof requestPermissionDecision>()
        .mockResolvedValue({
          kind: "persist",
          scope: "project",
          proposal: { surface: "bash", patterns: ["git status"] },
          target,
          summaryShown: true,
        }),
    });

    const result = await new LocalUserAuthorizer(deps).authorize(makeDetails());

    expect(persist).toHaveBeenCalledWith({
      requestId: "req-123",
      target,
      surface: "bash",
      patterns: ["git status"],
    });
    expect(result).toEqual({ approved: true, state: "approved" });
  });

  it("refuses to persist when an enabled summary was bypassed", async () => {
    const target = {
      scope: "project" as const,
      path: "/project/config.local.json",
      expectedDir: "/project",
    };
    const persist = vi.fn(() => ({ path: target.path }));
    const { deps } = makeDeps({
      persistentApprovalService: {
        prepare: vi.fn(() => target),
        persist,
      },
      requestPermissionDecision: vi
        .fn<typeof requestPermissionDecision>()
        .mockResolvedValue({
          kind: "persist",
          scope: "project",
          proposal: { surface: "bash", patterns: ["git status"] },
          target,
          summaryShown: false,
        }),
    });

    const result = await new LocalUserAuthorizer(deps).authorize(makeDetails());

    expect(persist).not.toHaveBeenCalled();
    expect(result).toEqual({
      approved: false,
      state: "denied_with_reason",
      denialReason: "Persistent approval summary was not shown.",
    });
  });

  it("fails closed without exposing filesystem paths from persistence errors", async () => {
    const target = {
      scope: "global" as const,
      path: "/agent/config.json",
      expectedDir: "/agent",
    };
    const service: PersistentApprovalApi = {
      prepare: vi.fn(() => target),
      persist: vi.fn(() => {
        throw Object.assign(
          new Error(
            "EACCES: permission denied, open '/private/user/config.json'",
          ),
          { code: "EACCES" },
        );
      }),
    };
    const { deps } = makeDeps({
      persistentApprovalService: service,
      requestPermissionDecision: vi
        .fn<typeof requestPermissionDecision>()
        .mockResolvedValue({
          kind: "persist",
          scope: "global",
          proposal: { surface: "bash", patterns: ["git status"] },
          target,
          summaryShown: true,
        }),
    });

    const result = await new LocalUserAuthorizer(deps).authorize(makeDetails());

    expect(result).toEqual({
      approved: false,
      state: "denied_with_reason",
      denialReason: "Persistent approval failed (EACCES).",
    });
    expect(result.denialReason).not.toContain("/private/user");
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
