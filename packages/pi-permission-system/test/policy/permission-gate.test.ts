import { describe, expect, it, vi } from "vitest";
import type { DecisionSource } from "#src/authority/decision-source";
import type { PermissionPromptDecision } from "#src/authority/permission-dialog";
import {
  applyPermissionGate,
  type PermissionGateParams,
} from "#src/policy/permission-gate";
import {
  DECIDED_BY_ABSENT_AUTHORITY,
  DECIDED_BY_HUMAN,
} from "#test/helpers/decision-fixtures";

/** The recorded authority every arm that never escalates is decided by. */
const POLICY_RULE: DecisionSource = {
  kind: "rule",
  surface: "bash",
  pattern: "*",
  origin: "global",
};

function makeParams(
  overrides: Partial<PermissionGateParams> = {},
): PermissionGateParams {
  return {
    state: "allow",
    canGrantForSession: false,
    promptForApproval: vi.fn<() => Promise<PermissionPromptDecision>>(),
    writeLog: vi.fn(),
    logContext: { source: "test" },
    decidedByRule: POLICY_RULE,
    messages: {
      denyReason: "Denied by policy.",
      // Names the decider it was handed: the gate's remaining job on this arm
      // is to route the whole decision to the renderer, not to pick a
      // sentence, so that is what these tests assert.
      refusedReason: (d) =>
        d.denialReason
          ? `Refused by ${d.decidedBy.kind}. Reason: ${d.denialReason}`
          : `Refused by ${d.decidedBy.kind}.`,
    },
    ...overrides,
  };
}

describe("applyPermissionGate", () => {
  describe("deny branch", () => {
    it("returns block with deny reason when state is deny", async () => {
      const params = makeParams({ state: "deny" });
      const result = await applyPermissionGate(params);
      expect(result).toEqual({
        action: "block",
        decidedBy: POLICY_RULE,
        reason: "Denied by policy.",
      });
    });

    it("calls writeLog with policy_denied resolution", async () => {
      const params = makeParams({
        state: "deny",
        logContext: { source: "tool_call", toolName: "bash" },
      });
      await applyPermissionGate(params);
      expect(params.writeLog).toHaveBeenCalledOnce();
      expect(params.writeLog).toHaveBeenCalledWith(
        "permission_request.blocked",
        {
          source: "tool_call",
          toolName: "bash",
          resolution: "policy_denied",
          decidedBy: {
            kind: "rule",
            surface: "bash",
            pattern: "*",
            origin: "global",
          },
        },
      );
    });

    it("does not call promptForApproval when state is deny", async () => {
      const params = makeParams({ state: "deny" });
      await applyPermissionGate(params);
      expect(params.promptForApproval).not.toHaveBeenCalled();
    });
  });

  describe("ask branch — confirmation unavailable", () => {
    const unavailableDecision: PermissionPromptDecision = {
      approved: false,
      state: "denied",
      decidedBy: DECIDED_BY_ABSENT_AUTHORITY,
      confirmationUnavailable: true,
    };

    it("blocks with the refusal render of the absent-authority decision", async () => {
      const params = makeParams({
        state: "ask",
        promptForApproval: vi.fn().mockResolvedValue(unavailableDecision),
      });
      const result = await applyPermissionGate(params);
      expect(result).toEqual({
        action: "block",
        decidedBy: DECIDED_BY_ABSENT_AUTHORITY,
        reason: "Refused by unavailable.",
      });
    });

    it("does not call writeLog when confirmation is unavailable (logged by the prompter)", async () => {
      const params = makeParams({
        state: "ask",
        promptForApproval: vi.fn().mockResolvedValue(unavailableDecision),
        logContext: { source: "skill_read", skillName: "foo" },
      });
      await applyPermissionGate(params);
      expect(params.writeLog).not.toHaveBeenCalled();
    });

    it("passes the decision's denial reason to the refusal render", async () => {
      const params = makeParams({
        state: "ask",
        promptForApproval: vi.fn().mockResolvedValue({
          ...unavailableDecision,
          denialReason: "Session 'parent-1' did not answer within 600s.",
        }),
      });
      const result = await applyPermissionGate(params);
      expect(result).toEqual({
        action: "block",
        decidedBy: DECIDED_BY_ABSENT_AUTHORITY,
        reason:
          "Refused by unavailable. Reason: Session 'parent-1' did not answer within 600s.",
      });
    });
  });

  describe("ask branch — user rejects", () => {
    it("blocks with the refusal render of the human's decision", async () => {
      const decision: PermissionPromptDecision = {
        approved: false,
        state: "denied",
        decidedBy: DECIDED_BY_HUMAN,
      };
      const promptForApproval = vi.fn().mockResolvedValue(decision);
      const params = makeParams({
        state: "ask",
        promptForApproval,
      });
      const result = await applyPermissionGate(params);
      expect(result).toEqual({
        action: "block",
        decidedBy: DECIDED_BY_HUMAN,
        reason: "Refused by user.",
      });
    });

    it("passes the human's denial reason to the refusal render", async () => {
      const decision: PermissionPromptDecision = {
        approved: false,
        state: "denied_with_reason",
        decidedBy: DECIDED_BY_HUMAN,
        denialReason: "not now",
      };
      const promptForApproval = vi.fn().mockResolvedValue(decision);
      const params = makeParams({
        state: "ask",
        promptForApproval,
      });
      const result = await applyPermissionGate(params);
      expect(result).toEqual({
        action: "block",
        decidedBy: DECIDED_BY_HUMAN,
        reason: "Refused by user. Reason: not now",
      });
    });

    it("does not call writeLog when user rejects (logged by promptPermission)", async () => {
      const decision: PermissionPromptDecision = {
        approved: false,
        state: "denied",
        decidedBy: DECIDED_BY_HUMAN,
      };
      const promptForApproval = vi.fn().mockResolvedValue(decision);
      const params = makeParams({
        state: "ask",
        promptForApproval,
      });
      await applyPermissionGate(params);
      expect(params.writeLog).not.toHaveBeenCalled();
    });
  });

  describe("ask branch — user approves", () => {
    it("returns allow when user approves", async () => {
      const decision: PermissionPromptDecision = {
        approved: true,
        state: "approved",
        decidedBy: DECIDED_BY_HUMAN,
      };
      const promptForApproval = vi.fn().mockResolvedValue(decision);
      const params = makeParams({
        state: "ask",
        promptForApproval,
      });
      const result = await applyPermissionGate(params);
      expect(result).toEqual({ action: "allow", decidedBy: DECIDED_BY_HUMAN });
    });

    it("does not call writeLog when user approves", async () => {
      const decision: PermissionPromptDecision = {
        approved: true,
        state: "approved",
        decidedBy: DECIDED_BY_HUMAN,
      };
      const promptForApproval = vi.fn().mockResolvedValue(decision);
      const params = makeParams({
        state: "ask",
        promptForApproval,
      });
      await applyPermissionGate(params);
      expect(params.writeLog).not.toHaveBeenCalled();
    });
  });

  describe("ask branch — the session-grant report", () => {
    it("reports a session grant when the decision is approved_for_session and the ask carried a suggestion", async () => {
      const decision: PermissionPromptDecision = {
        approved: true,
        state: "approved_for_session",
        decidedBy: DECIDED_BY_HUMAN,
      };
      const promptForApproval = vi.fn().mockResolvedValue(decision);
      const params = makeParams({
        state: "ask",
        promptForApproval,
        canGrantForSession: true,
      });
      const result = await applyPermissionGate(params);
      expect(result).toEqual({
        action: "allow",
        decidedBy: DECIDED_BY_HUMAN,
        sessionGrant: { width: "proven" },
      });
    });

    it("records the width the decision names", async () => {
      const decision: PermissionPromptDecision = {
        approved: true,
        state: "approved_for_session",
        sessionGrantWidth: "family",
        decidedBy: DECIDED_BY_HUMAN,
      };
      const promptForApproval = vi.fn().mockResolvedValue(decision);
      const params = makeParams({
        state: "ask",
        promptForApproval,
        canGrantForSession: true,
      });
      const result = await applyPermissionGate(params);
      expect(result).toEqual({
        action: "allow",
        decidedBy: DECIDED_BY_HUMAN,
        sessionGrant: { width: "family" },
      });
    });

    it("reports no session grant when the decision is approved (once)", async () => {
      const decision: PermissionPromptDecision = {
        approved: true,
        state: "approved",
        decidedBy: DECIDED_BY_HUMAN,
      };
      const promptForApproval = vi.fn().mockResolvedValue(decision);
      const params = makeParams({
        state: "ask",
        promptForApproval,
        canGrantForSession: true,
      });
      const result = await applyPermissionGate(params);
      expect(result).toEqual({ action: "allow", decidedBy: DECIDED_BY_HUMAN });
    });

    it("reports no session grant when the ask carried no suggestion", async () => {
      const decision: PermissionPromptDecision = {
        approved: true,
        state: "approved_for_session",
        decidedBy: DECIDED_BY_HUMAN,
      };
      const promptForApproval = vi.fn().mockResolvedValue(decision);
      const params = makeParams({
        state: "ask",
        promptForApproval,
        canGrantForSession: false,
      });
      const result = await applyPermissionGate(params);
      expect(result).toEqual({ action: "allow", decidedBy: DECIDED_BY_HUMAN });
    });

    it("reports no session grant when the user denies", async () => {
      const decision: PermissionPromptDecision = {
        approved: false,
        state: "denied",
        decidedBy: DECIDED_BY_HUMAN,
      };
      const promptForApproval = vi.fn().mockResolvedValue(decision);
      const params = makeParams({
        state: "ask",
        promptForApproval,
        canGrantForSession: true,
      });
      const result = await applyPermissionGate(params);
      expect(result).toEqual({
        action: "block",
        decidedBy: DECIDED_BY_HUMAN,
        reason: "Refused by user.",
      });
    });
  });

  describe("allow branch", () => {
    it("returns allow immediately when state is allow", async () => {
      const params = makeParams({ state: "allow" });
      const result = await applyPermissionGate(params);
      expect(result).toEqual({ action: "allow", decidedBy: POLICY_RULE });
    });

    it("does not call writeLog when state is allow", async () => {
      const params = makeParams({ state: "allow" });
      await applyPermissionGate(params);
      expect(params.writeLog).not.toHaveBeenCalled();
    });

    it("does not call promptForApproval when state is allow", async () => {
      const params = makeParams({ state: "allow" });
      await applyPermissionGate(params);
      expect(params.promptForApproval).not.toHaveBeenCalled();
    });
  });
});
