import { describe, expect, it, vi } from "vitest";

import type { GateBypass } from "#src/handlers/gates/descriptor";
import type { PermissionDecisionEvent } from "#src/permission-events";
import { EXTENSION_TAG } from "#src/presentation/agent-renderer";
import { SessionApproval } from "#src/session-approval";
import { DECIDED_BY_HUMAN } from "#test/helpers/decision-fixtures";
import { makeDescriptor, makeGateRunner } from "#test/helpers/gate-fixtures";
import { makeCheckResult } from "#test/helpers/handler-fixtures";
import { makePromptPayload } from "#test/helpers/prompt-details-fixtures";

// ── GateRunner — descriptor path ───────────────────────────────────────────

describe("GateRunner — descriptor path", () => {
  it("returns allow and emits policy_allow when policy is allow", async () => {
    const { runner, deps } = makeGateRunner();
    const result = await runner.run(makeDescriptor(), null);
    expect(result).toEqual({ action: "allow" });
    expect(deps.reporter.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: "read",
        value: "read",
        result: "allow",
        resolution: "policy_allow",
      }),
    );
  });

  it("returns block and emits policy_deny when policy is deny", async () => {
    const { runner, deps } = makeGateRunner({
      resolveResult: makeCheckResult({ state: "deny", matchedPattern: "*" }),
    });
    const result = await runner.run(makeDescriptor(), null);
    expect(result).toMatchObject({ action: "block" });
    expect(deps.reporter.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "deny",
        resolution: "policy_deny",
      }),
    );
    expect(deps.reporter.writeReviewLog).toHaveBeenCalledWith(
      "permission_request.blocked",
      expect.objectContaining({
        resolution: "policy_denied",
        decidedBy: {
          kind: "rule",
          surface: "read",
          pattern: "*",
          origin: "builtin",
        },
      }),
    );
  });

  it("records which rule denied a blocked request", async () => {
    const { runner, deps } = makeGateRunner({
      resolveResult: makeCheckResult({ state: "deny", matchedPattern: "rm *" }),
    });

    await runner.run(
      makeDescriptor({
        surface: "bash",
        payload: makePromptPayload({
          kind: "bash",
          request: {
            ...makePromptPayload().request,
            surface: "bash",
            toolName: "bash",
            value: "rm -rf build",
            matchedPattern: "rm *",
          },
        }),
      }),
      null,
    );

    expect(deps.reporter.writeReviewLog).toHaveBeenCalledWith(
      "permission_request.blocked",
      expect.objectContaining({ surface: "bash", matchedPattern: "rm *" }),
    );
  });

  it("returns allow and emits session_approved on session hit", async () => {
    const { runner, deps } = makeGateRunner({
      resolveResult: makeCheckResult({
        source: "session",
        matchedPattern: "git *",
      }),
    });
    const result = await runner.run(
      makeDescriptor({
        surface: "bash",
        input: { command: "git status" },
        decision: { surface: "bash", value: "git status" },
      }),
      null,
    );
    expect(result).toEqual({ action: "allow" });
    expect(deps.reporter.writeReviewLog).toHaveBeenCalledWith(
      "permission_request.session_approved",
      expect.objectContaining({
        resolution: "session_approved",
        sessionApprovalPattern: "git *",
        decidedBy: {
          kind: "session_approval",
          surface: "bash",
          pattern: "git *",
        },
      }),
    );
    expect(deps.reporter.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        resolution: "session_approved",
        matchedPattern: "git *",
      }),
    );
  });

  it("returns allow and emits auto_approved on a yolo-origin allow without prompting", async () => {
    const { runner, deps } = makeGateRunner({
      resolveResult: makeCheckResult({
        state: "allow",
        origin: "yolo",
        matchedPattern: "*",
      }),
    });
    const result = await runner.run(makeDescriptor(), null);
    expect(result).toEqual({ action: "allow" });
    expect(deps.escalate).not.toHaveBeenCalled();
    expect(deps.reporter.writeReviewLog).toHaveBeenCalledWith(
      "permission_request.auto_approved",
      expect.objectContaining({
        resolution: "auto_approved",
        decidedBy: { kind: "yolo", pattern: "*" },
      }),
    );
    expect(deps.reporter.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "allow",
        resolution: "auto_approved",
        origin: "yolo",
      }),
    );
  });

  it("preserves the synthetic sentinel that raised a yolo-granted ask", async () => {
    const { runner, deps } = makeGateRunner({
      resolveResult: makeCheckResult({
        state: "ask",
        matchedPattern: "<opaque-bash-wrapper>",
      }),
      isYoloEnabled: () => true,
    });

    await runner.run(makeDescriptor(), null);

    // Which sentinel raised the ask is what makes a yolo grant over a
    // synthesized ask legible; "yolo allowed it" alone does not say why it
    // was asked.
    expect(deps.reporter.writeReviewLog).toHaveBeenCalledWith(
      "permission_request.auto_approved",
      expect.objectContaining({
        decidedBy: { kind: "yolo", pattern: "<opaque-bash-wrapper>" },
      }),
    );
  });

  it("auto-approves a residual synthetic ask under yolo without prompting", async () => {
    const { runner, deps } = makeGateRunner({
      yolo: true,
      resolveResult: makeCheckResult({
        state: "ask",
        source: "bash",
        toolName: "bash",
        matchedPattern: "<indirection-bash-wrapper>",
      }),
    });

    const result = await runner.run(makeDescriptor(), null);

    expect(result).toEqual({ action: "allow" });
    expect(deps.escalate).not.toHaveBeenCalled();
    expect(deps.reporter.writeReviewLog).toHaveBeenCalledWith(
      "permission_request.auto_approved",
      expect.objectContaining({ resolution: "auto_approved" }),
    );
    expect(deps.reporter.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "allow",
        resolution: "auto_approved",
        origin: "yolo",
        matchedPattern: "<indirection-bash-wrapper>",
      }),
    );
  });

  it("blocks an explicit deny under yolo without prompting", async () => {
    const { runner, deps } = makeGateRunner({
      yolo: true,
      resolveResult: makeCheckResult({ state: "deny", matchedPattern: "rm *" }),
    });

    const result = await runner.run(makeDescriptor(), null);

    expect(result).toMatchObject({ action: "block" });
    expect(deps.escalate).not.toHaveBeenCalled();
  });

  it("reads the yolo setting per run, so a mid-session toggle takes effect", async () => {
    let yolo = false;
    const { runner, deps } = makeGateRunner({
      isYoloEnabled: () => yolo,
      resolveResult: makeCheckResult({
        state: "ask",
        matchedPattern: "<unparseable-bash-command>",
      }),
    });

    await runner.run(makeDescriptor(), null);
    expect(deps.escalate).toHaveBeenCalledTimes(1);

    yolo = true;
    await runner.run(makeDescriptor(), null);
    expect(deps.escalate).toHaveBeenCalledTimes(1);
  });

  it("returns allow and emits user_approved when ask + user approves", async () => {
    const { runner, deps } = makeGateRunner({
      resolveResult: makeCheckResult({ state: "ask", matchedPattern: "*" }),
      escalate: vi.fn().mockResolvedValue({
        approved: true,
        state: "approved",
        decidedBy: DECIDED_BY_HUMAN,
      }),
    });
    const result = await runner.run(makeDescriptor(), null);
    expect(result).toEqual({ action: "allow" });
    expect(deps.reporter.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "allow",
        resolution: "user_approved",
      }),
    );
  });

  it("returns allow, emits user_approved_for_session, and records session rule on approved_for_session", async () => {
    const { runner, deps } = makeGateRunner({
      resolveResult: makeCheckResult({ state: "ask", matchedPattern: "*" }),
      escalate: vi.fn().mockResolvedValue({
        approved: true,
        state: "approved_for_session",
        decidedBy: DECIDED_BY_HUMAN,
      }),
    });
    const descriptor = makeDescriptor({
      sessionApproval: SessionApproval.single("read", "*"),
    });
    const result = await runner.run(descriptor, null);
    expect(result).toEqual({ action: "allow" });
    expect(deps.reporter.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        resolution: "user_approved_for_session",
      }),
    );
    expect(deps.recordSessionApproval).toHaveBeenCalledWith(
      SessionApproval.single("read", "*"),
    );
  });

  it("calls recordSessionApproval once with the full SessionApproval when sessionApproval has multiple patterns", async () => {
    const { runner, deps } = makeGateRunner({
      resolveResult: makeCheckResult({ state: "ask", matchedPattern: "*" }),
      escalate: vi.fn().mockResolvedValue({
        approved: true,
        state: "approved_for_session",
        decidedBy: DECIDED_BY_HUMAN,
      }),
    });
    const approval = SessionApproval.multiple("external_directory", [
      "/outside/a/*",
      "/outside/b/*",
    ]);
    const descriptor = makeDescriptor({ sessionApproval: approval });
    const result = await runner.run(descriptor, null);
    expect(result).toEqual({ action: "allow" });
    expect(deps.recordSessionApproval).toHaveBeenCalledTimes(1);
    expect(deps.recordSessionApproval).toHaveBeenCalledWith(approval);
  });

  it("returns block and emits user_denied when ask + user denies", async () => {
    const { runner, deps } = makeGateRunner({
      resolveResult: makeCheckResult({ state: "ask", matchedPattern: "*" }),
      escalate: vi.fn().mockResolvedValue({
        approved: false,
        state: "denied",
        decidedBy: DECIDED_BY_HUMAN,
      }),
    });
    const result = await runner.run(makeDescriptor(), null);
    expect(result).toMatchObject({ action: "block" });
    expect(deps.reporter.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "deny",
        resolution: "user_denied",
      }),
    );
  });

  it("returns block and emits confirmation_unavailable when ask + no UI", async () => {
    const { runner, deps } = makeGateRunner({
      resolveResult: makeCheckResult({ state: "ask", matchedPattern: "*" }),
      escalate: vi.fn().mockResolvedValue({
        approved: false,
        state: "denied",
        confirmationUnavailable: true,
      }),
    });
    const result = await runner.run(makeDescriptor(), null);
    expect(result).toMatchObject({ action: "block" });
    expect(deps.reporter.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "deny",
        resolution: "confirmation_unavailable",
      }),
    );
  });

  it("emits auto_approved resolution when decision has autoApproved flag", async () => {
    const { runner, deps } = makeGateRunner({
      resolveResult: makeCheckResult({ state: "ask", matchedPattern: "*" }),
      escalate: vi.fn().mockResolvedValue({
        approved: true,
        state: "approved",
        autoApproved: true,
      }),
    });
    const result = await runner.run(makeDescriptor(), null);
    expect(result).toEqual({ action: "allow" });
    expect(deps.reporter.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        resolution: "auto_approved",
      }),
    );
  });

  it("uses preResolved.state instead of calling resolve", async () => {
    const { runner, deps } = makeGateRunner();
    const descriptor = makeDescriptor({
      preResolved: { state: "deny" },
    });
    const result = await runner.run(descriptor, null);
    expect(result).toMatchObject({ action: "block" });
    expect(deps.resolve).not.toHaveBeenCalled();
    expect(deps.reporter.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        resolution: "policy_deny",
      }),
    );
  });

  it("uses preResolved.state allow without calling resolve", async () => {
    const { runner, deps } = makeGateRunner();
    const descriptor = makeDescriptor({
      preResolved: { state: "allow" },
    });
    const result = await runner.run(descriptor, null);
    expect(result).toEqual({ action: "allow" });
    expect(deps.resolve).not.toHaveBeenCalled();
    expect(deps.reporter.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        resolution: "policy_allow",
      }),
    );
  });

  it("passes agentName to resolve and decision event", async () => {
    const { runner, deps } = makeGateRunner();
    const result = await runner.run(makeDescriptor(), "test-agent");
    expect(result).toEqual({ action: "allow" });
    expect(deps.resolve).toHaveBeenCalledWith({
      kind: "tool",
      surface: "read",
      input: {},
      agentName: "test-agent",
    });
    expect(deps.reporter.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        agentName: "test-agent",
      }),
    );
  });

  it("escalates a minted request id, not the tool call id", async () => {
    const { runner, deps } = makeGateRunner({
      resolveResult: makeCheckResult({ state: "ask", matchedPattern: "*" }),
    });
    await runner.run(makeDescriptor(), null);
    expect(deps.escalate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: expect.stringMatching(/^perm-/),
        // The host's id keeps flowing as the join back to the Pi transcript.
        toolCallId: "tc-1",
      }),
    );
  });

  it("forwards the descriptor's sessionApproval suggestion on escalate", async () => {
    const { runner, deps } = makeGateRunner({
      resolveResult: makeCheckResult({ state: "ask", matchedPattern: "*" }),
    });
    const approval = SessionApproval.single("bash", "git *");
    await runner.run(makeDescriptor({ sessionApproval: approval }), null);
    expect(deps.escalate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionApproval: { surface: "bash", patterns: ["git *"] },
      }),
    );
  });

  it("omits sessionApproval from escalate details when the descriptor has none", async () => {
    const { runner, deps } = makeGateRunner({
      resolveResult: makeCheckResult({ state: "ask", matchedPattern: "*" }),
    });
    await runner.run(makeDescriptor(), null);
    expect(deps.escalate).toHaveBeenCalledWith(
      expect.not.objectContaining({ sessionApproval: expect.anything() }),
    );
  });

  it("does not call recordSessionApproval when user approves once (no sessionApproval)", async () => {
    const { runner, deps } = makeGateRunner({
      resolveResult: makeCheckResult({ state: "ask", matchedPattern: "*" }),
      escalate: vi.fn().mockResolvedValue({
        approved: true,
        state: "approved",
        decidedBy: DECIDED_BY_HUMAN,
      }),
    });
    await runner.run(makeDescriptor(), null);
    expect(deps.recordSessionApproval).not.toHaveBeenCalled();
  });

  it("uses preCheck result directly instead of calling resolve", async () => {
    const { runner, deps } = makeGateRunner();
    const descriptor = makeDescriptor({
      preCheck: makeCheckResult({
        state: "deny",
        origin: "global",
        matchedPattern: "rm *",
      }),
    });
    const result = await runner.run(descriptor, null);
    expect(result).toMatchObject({ action: "block" });
    expect(deps.resolve).not.toHaveBeenCalled();
    expect(deps.reporter.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        resolution: "policy_deny",
        origin: "global",
        matchedPattern: "rm *",
      }),
    );
  });

  it("does not call recordSessionApproval when user approves for session but no sessionApproval on descriptor", async () => {
    const { runner, deps } = makeGateRunner({
      resolveResult: makeCheckResult({ state: "ask", matchedPattern: "*" }),
      escalate: vi.fn().mockResolvedValue({
        approved: true,
        state: "approved_for_session",
        decidedBy: DECIDED_BY_HUMAN,
      }),
    });
    // No sessionApproval on descriptor
    await runner.run(makeDescriptor(), null);
    expect(deps.recordSessionApproval).not.toHaveBeenCalled();
  });

  describe("agent-facing denial rendering", () => {
    it("renders the deny reason from the descriptor's payload", async () => {
      const { runner } = makeGateRunner({
        resolveResult: makeCheckResult({ state: "deny", matchedPattern: "*" }),
      });
      const result = await runner.run(
        makeDescriptor({
          payload: makePromptPayload({
            request: {
              ...makePromptPayload().request,
              surface: "read",
              toolName: "read",
              value: "read",
              matchedPattern: "*",
            },
          }),
        }),
        "test-agent",
      );
      expect(result.action).toBe("block");
      if (result.action === "block") {
        expect(result.reason).toBe(
          `${EXTENSION_TAG} Denied by policy: 'read' (rule '*').`,
        );
      }
    });

    it("carries an operator's deny-with-reason text on a non-tool surface", async () => {
      const { runner } = makeGateRunner({
        resolveResult: makeCheckResult({
          state: "deny",
          toolName: "path",
          matchedPattern: "/etc/*",
          reason: "system files are off limits",
        }),
      });
      const result = await runner.run(
        makeDescriptor({
          surface: "path",
          payload: makePromptPayload({
            kind: "path",
            request: {
              ...makePromptPayload().request,
              surface: "path",
              toolName: "read",
              value: "/etc/passwd",
              matchedPattern: "/etc/*",
            },
          }),
        }),
        null,
      );
      expect(result.action).toBe("block");
      if (result.action === "block") {
        expect(result.reason).toBe(
          `${EXTENSION_TAG} Denied by policy: 'path' for tool 'read' for path '/etc/passwd' (rule '/etc/*'). Reason: system files are off limits.`,
        );
      }
    });

    it("renders the unavailable reason with the extension tag", async () => {
      const { runner } = makeGateRunner({
        resolveResult: makeCheckResult({ state: "ask", matchedPattern: "*" }),
        escalate: vi.fn().mockResolvedValue({
          approved: false,
          state: "denied",
          confirmationUnavailable: true,
        }),
      });
      const result = await runner.run(makeDescriptor(), null);
      expect(result.action).toBe("block");
      if (result.action === "block") {
        expect(result.reason).toContain(EXTENSION_TAG);
        expect(result.reason).toContain("no interactive UI");
      }
    });

    it("carries an unavailable decision's denial reason into the block message", async () => {
      const { runner } = makeGateRunner({
        resolveResult: makeCheckResult({ state: "ask", matchedPattern: "*" }),
        escalate: vi.fn().mockResolvedValue({
          approved: false,
          state: "denied",
          confirmationUnavailable: true,
          denialReason: "Session 'parent-1' is not serving forwarded requests",
        }),
      });
      const result = await runner.run(makeDescriptor(), null);
      expect(result.action).toBe("block");
      if (result.action === "block") {
        expect(result.reason).toContain(
          "Reason: Session 'parent-1' is not serving forwarded requests.",
        );
      }
    });

    it("renders the user's denial reason with the extension tag", async () => {
      const { runner } = makeGateRunner({
        resolveResult: makeCheckResult({ state: "ask", matchedPattern: "*" }),
        escalate: vi.fn().mockResolvedValue({
          approved: false,
          state: "denied",
          denialReason: "too risky",
        }),
      });
      const result = await runner.run(makeDescriptor(), null);
      expect(result.action).toBe("block");
      if (result.action === "block") {
        expect(result.reason).toContain(EXTENSION_TAG);
        expect(result.reason).toContain("too risky");
      }
    });

    it("never echoes the command into a bash denial", async () => {
      const { runner } = makeGateRunner({
        resolveResult: makeCheckResult({
          state: "deny",
          toolName: "bash",
          matchedPattern: "rm *",
        }),
      });
      const command = `cat <<'EOF'\n${"x".repeat(5000)}\nEOF`;
      const result = await runner.run(
        makeDescriptor({
          surface: "bash",
          payload: makePromptPayload({
            kind: "bash",
            request: {
              ...makePromptPayload().request,
              surface: "bash",
              toolName: "bash",
              value: command,
              matchedPattern: "rm *",
            },
          }),
        }),
        null,
      );
      expect(result.action).toBe("block");
      if (result.action === "block") {
        expect(result.reason).toBe(
          `${EXTENSION_TAG} Denied by policy: 'bash' (rule 'rm *').`,
        );
      }
    });
  });
});

// ── GateRunner.run — null and bypass dispatch ──────────────────────────────

describe("GateRunner.run — null and bypass dispatch", () => {
  it("returns allow for a null gate", async () => {
    const { runner, deps } = makeGateRunner();
    const result = await runner.run(null, null);
    expect(result).toEqual({ action: "allow" });
    expect(deps.reporter.writeReviewLog).not.toHaveBeenCalled();
    expect(deps.reporter.emitDecision).not.toHaveBeenCalled();
  });

  it("returns allow for a bypass with no log or decision", async () => {
    const { runner, deps } = makeGateRunner();
    const bypass: GateBypass = {
      action: "allow",
      decidedBy: { kind: "infrastructure_read" },
    };
    const result = await runner.run(bypass, null);
    expect(result).toEqual({ action: "allow" });
    expect(deps.reporter.writeReviewLog).not.toHaveBeenCalled();
    expect(deps.reporter.emitDecision).not.toHaveBeenCalled();
  });

  it("fires writeReviewLog for a bypass with a log entry", async () => {
    const { runner, deps } = makeGateRunner();
    const bypass: GateBypass = {
      action: "allow",
      decidedBy: { kind: "infrastructure_read" },
      log: { event: "infra.bypass", details: { path: "/x" } },
    };
    await runner.run(bypass, null);
    expect(deps.reporter.writeReviewLog).toHaveBeenCalledWith("infra.bypass", {
      path: "/x",
      requestId: expect.stringMatching(/^perm-/),
      decidedBy: { kind: "infrastructure_read" },
    });
    expect(deps.reporter.emitDecision).not.toHaveBeenCalled();
  });

  it("fires emitDecision for a bypass with a decision", async () => {
    const { runner, deps } = makeGateRunner();
    const decision = {
      surface: "path",
      value: "/x",
      result: "allow" as const,
      resolution: "policy_allow" as const,
      origin: null,
      agentName: null,
      matchedPattern: null,
    };
    const bypass: GateBypass = {
      action: "allow",
      decidedBy: { kind: "infrastructure_read" },
      decision,
    };
    await runner.run(bypass, null);
    expect(deps.reporter.emitDecision).toHaveBeenCalledWith({
      ...decision,
      requestId: expect.stringMatching(/^perm-/),
    });
    expect(deps.reporter.writeReviewLog).not.toHaveBeenCalled();
  });

  it("routes a descriptor to the gate check logic and returns allow", async () => {
    const { runner } = makeGateRunner();
    const result = await runner.run(makeDescriptor(), null);
    expect(result).toEqual({ action: "allow" });
  });

  it("routes a descriptor to the gate check logic and returns block", async () => {
    const { runner } = makeGateRunner({
      resolveResult: makeCheckResult({ state: "deny", matchedPattern: "*" }),
    });
    const result = await runner.run(makeDescriptor(), null);
    expect(result).toMatchObject({ action: "block" });
  });
});

// ── GateRunner — request identity ────────────────────────────────────

/**
 * Runner over a reporter that records its review-log writes, so a test can
 * read back the id the runner minted rather than only matching a shape.
 */
function makeRecordingRunner(
  overrides: Parameters<typeof makeGateRunner>[0] = {},
) {
  const reviewWrites: Array<{
    event: string;
    details: Record<string, unknown>;
  }> = [];
  const decisions: PermissionDecisionEvent[] = [];
  const { runner, deps } = makeGateRunner({
    ...overrides,
    reporter: {
      writeReviewLog: (event, details) => {
        reviewWrites.push({ event, details });
      },
      emitDecision: (event) => {
        decisions.push(event);
      },
    },
  });
  return { runner, deps, reviewWrites, decisions };
}

describe("GateRunner — request identity", () => {
  it("carries the minted id on the session-approved review entry", async () => {
    const { runner, reviewWrites } = makeRecordingRunner({
      resolveResult: makeCheckResult({
        source: "session",
        matchedPattern: "git *",
      }),
    });
    await runner.run(makeDescriptor(), null);
    expect(reviewWrites).toHaveLength(1);
    expect(reviewWrites[0].event).toBe("permission_request.session_approved");
    expect(reviewWrites[0].details.requestId).toMatch(/^perm-/);
  });

  it("carries the minted id on the auto-approved review entry", async () => {
    const { runner, reviewWrites } = makeRecordingRunner({
      resolveResult: makeCheckResult({ state: "ask", matchedPattern: "*" }),
      yolo: true,
    });
    await runner.run(makeDescriptor(), null);
    expect(reviewWrites).toHaveLength(1);
    expect(reviewWrites[0].event).toBe("permission_request.auto_approved");
    expect(reviewWrites[0].details.requestId).toMatch(/^perm-/);
  });

  it("carries the minted id on the policy-denied review entry", async () => {
    const { runner, reviewWrites } = makeRecordingRunner({
      resolveResult: makeCheckResult({ state: "deny", matchedPattern: "*" }),
    });
    await runner.run(makeDescriptor(), null);
    expect(reviewWrites).toHaveLength(1);
    expect(reviewWrites[0].event).toBe("permission_request.blocked");
    expect(reviewWrites[0].details.requestId).toMatch(/^perm-/);
  });

  it("carries the minted id on a bypass review entry", async () => {
    const { runner, reviewWrites } = makeRecordingRunner();
    const bypass: GateBypass = {
      action: "allow",
      decidedBy: { kind: "infrastructure_read" },
      log: {
        event: "permission_request.infrastructure_auto_allowed",
        details: { path: "/x" },
      },
    };
    await runner.run(bypass, null);
    expect(reviewWrites).toHaveLength(1);
    expect(reviewWrites[0].details.requestId).toMatch(/^perm-/);
  });

  it("stamps the bypass's own decider onto its review entry", async () => {
    const { runner, reviewWrites } = makeRecordingRunner();
    const bypass: GateBypass = {
      action: "allow",
      decidedBy: { kind: "infrastructure_read" },
      log: {
        event: "permission_request.infrastructure_auto_allowed",
        details: { path: "/x" },
      },
    };

    await runner.run(bypass, null);

    // The gate that short-circuits is the decider; the runner relays what it
    // states rather than inferring one from the event name.
    expect(reviewWrites[0].details.decidedBy).toEqual({
      kind: "infrastructure_read",
    });
  });

  it("keeps the tool call id alongside the minted id on the review entry", async () => {
    const { runner, reviewWrites } = makeRecordingRunner({
      resolveResult: makeCheckResult({ state: "deny", matchedPattern: "*" }),
    });
    await runner.run(makeDescriptor(), null);
    expect(reviewWrites[0].details.toolCallId).toBe("tc-1");
    expect(reviewWrites[0].details.requestId).not.toBe("tc-1");
  });

  it("mints a distinct id for each run, so one tool call's gates stay separable", async () => {
    const { runner, reviewWrites } = makeRecordingRunner({
      resolveResult: makeCheckResult({ state: "deny", matchedPattern: "*" }),
    });
    await runner.run(makeDescriptor(), null);
    await runner.run(makeDescriptor(), null);
    expect(reviewWrites[0].details.requestId).not.toBe(
      reviewWrites[1].details.requestId,
    );
  });

  it("stamps the session-approved entry and its decision event with one id", async () => {
    const { runner, reviewWrites, decisions } = makeRecordingRunner({
      resolveResult: makeCheckResult({
        source: "session",
        matchedPattern: "git *",
      }),
    });
    await runner.run(makeDescriptor(), null);
    expect(decisions[0].requestId).toBe(reviewWrites[0].details.requestId);
  });

  it("stamps the auto-approved entry and its decision event with one id", async () => {
    const { runner, reviewWrites, decisions } = makeRecordingRunner({
      resolveResult: makeCheckResult({ state: "ask", matchedPattern: "*" }),
      yolo: true,
    });
    await runner.run(makeDescriptor(), null);
    expect(decisions[0].requestId).toBe(reviewWrites[0].details.requestId);
  });

  it("stamps the policy-denied entry and its decision event with one id", async () => {
    const { runner, reviewWrites, decisions } = makeRecordingRunner({
      resolveResult: makeCheckResult({ state: "deny", matchedPattern: "*" }),
    });
    await runner.run(makeDescriptor(), null);
    expect(decisions[0].requestId).toBe(reviewWrites[0].details.requestId);
  });

  it("stamps a bypass's log entry and decision event with one id", async () => {
    const { runner, reviewWrites, decisions } = makeRecordingRunner();
    const bypass: GateBypass = {
      action: "allow",
      decidedBy: { kind: "infrastructure_read" },
      log: {
        event: "permission_request.infrastructure_auto_allowed",
        details: { path: "/x" },
      },
      decision: {
        surface: "read",
        value: "/x",
        result: "allow",
        resolution: "infrastructure_auto_allowed",
        origin: null,
        agentName: null,
        matchedPattern: null,
      },
    };
    await runner.run(bypass, null);
    expect(decisions[0].requestId).toMatch(/^perm-/);
    expect(decisions[0].requestId).toBe(reviewWrites[0].details.requestId);
  });

  it("stamps an allow decision event even when nothing is written to the log", async () => {
    const { runner, decisions } = makeRecordingRunner();
    await runner.run(makeDescriptor(), null);
    expect(decisions[0].requestId).toMatch(/^perm-/);
  });
});
