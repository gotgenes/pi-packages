import { describe, expect, it } from "vitest";
import type { TerminalAuthorizer } from "#src/authority/authorizer";
import {
  AutoApproval,
  AutoApprovingAuthorizer,
} from "#src/authority/auto-approval";
import { makePromptDetails } from "#test/helpers/prompt-details-fixtures";

const OWN_ASK = makePromptDetails();
const FORWARDED_BY_REVIEWER = makePromptDetails({
  forwarding: { requesterAgentName: "reviewer", requesterSessionId: "child-1" },
});
const FORWARDED_UNNAMED = makePromptDetails({
  forwarding: { requesterAgentName: null, requesterSessionId: "child-2" },
});

describe("AutoApproval", () => {
  describe("grantFor", () => {
    it("covers nothing when no scope is on", () => {
      const approval = new AutoApproval();

      expect(approval.grantFor(OWN_ASK)).toBeNull();
      expect(approval.grantFor(FORWARDED_BY_REVIEWER)).toBeNull();
    });

    describe("own scope", () => {
      it("covers an ask raised by this node", () => {
        const approval = new AutoApproval();
        approval.enable({ kind: "own" }, "flag");

        expect(approval.grantFor(OWN_ASK)).toEqual({
          kind: "auto_approve",
          setter: "flag",
          scope: "own",
        });
      });

      it("does not cover a forwarded ask", () => {
        const approval = new AutoApproval();
        approval.enable({ kind: "own" }, "flag");

        expect(approval.grantFor(FORWARDED_BY_REVIEWER)).toBeNull();
      });
    });

    describe("forwarded scope", () => {
      it("covers a forwarded ask from any agent", () => {
        const approval = new AutoApproval();
        approval.enable({ kind: "forwarded" }, "command");

        expect(approval.grantFor(FORWARDED_BY_REVIEWER)).toEqual({
          kind: "auto_approve",
          setter: "command",
          scope: "forwarded",
        });
        expect(approval.grantFor(FORWARDED_UNNAMED)).toEqual({
          kind: "auto_approve",
          setter: "command",
          scope: "forwarded",
        });
      });

      it("does not cover this node's own ask", () => {
        const approval = new AutoApproval();
        approval.enable({ kind: "forwarded" }, "command");

        expect(approval.grantFor(OWN_ASK)).toBeNull();
      });
    });

    describe("agent scope", () => {
      it("covers a forwarded ask from the named agent", () => {
        const approval = new AutoApproval();
        approval.enable({ kind: "agent", agentName: "reviewer" }, "command");

        expect(approval.grantFor(FORWARDED_BY_REVIEWER)).toEqual({
          kind: "auto_approve",
          setter: "command",
          scope: "agent",
        });
      });

      it("does not cover another agent, an unnamed requester, or an own ask", () => {
        const approval = new AutoApproval();
        approval.enable({ kind: "agent", agentName: "other" }, "command");

        expect(approval.grantFor(FORWARDED_BY_REVIEWER)).toBeNull();
        expect(approval.grantFor(FORWARDED_UNNAMED)).toBeNull();
        expect(approval.grantFor(OWN_ASK)).toBeNull();
      });

      it("names the agent scope over the forwarded scope when both cover the ask", () => {
        const approval = new AutoApproval();
        approval.enable({ kind: "forwarded" }, "flag");
        approval.enable({ kind: "agent", agentName: "reviewer" }, "command");

        expect(approval.grantFor(FORWARDED_BY_REVIEWER)).toEqual({
          kind: "auto_approve",
          setter: "command",
          scope: "agent",
        });
      });
    });
  });

  describe("disable", () => {
    it("turns off only the named scope", () => {
      const approval = new AutoApproval();
      approval.enable({ kind: "own" }, "flag");
      approval.enable({ kind: "forwarded" }, "flag");

      approval.disable({ kind: "own" });

      expect(approval.grantFor(OWN_ASK)).toBeNull();
      expect(approval.grantFor(FORWARDED_BY_REVIEWER)).not.toBeNull();
    });

    it("turns off every scope, flag-set ones included, when none is named", () => {
      const approval = new AutoApproval();
      approval.enable({ kind: "own" }, "flag");
      approval.enable({ kind: "agent", agentName: "reviewer" }, "command");

      approval.disable();

      expect(approval.isActive()).toBe(false);
      expect(approval.grantFor(OWN_ASK)).toBeNull();
      expect(approval.grantFor(FORWARDED_BY_REVIEWER)).toBeNull();
    });
  });

  describe("answersForwardedAsks", () => {
    it("is false with only the own scope on", () => {
      const approval = new AutoApproval();
      approval.enable({ kind: "own" }, "flag");

      expect(approval.answersForwardedAsks()).toBe(false);
    });

    it("is true with the forwarded scope on", () => {
      const approval = new AutoApproval();
      approval.enable({ kind: "forwarded" }, "flag");

      expect(approval.answersForwardedAsks()).toBe(true);
    });

    it("is true with an agent scope on", () => {
      const approval = new AutoApproval();
      approval.enable({ kind: "agent", agentName: "reviewer" }, "command");

      expect(approval.answersForwardedAsks()).toBe(true);
    });
  });

  describe("describe", () => {
    it("reads off when no scope is on", () => {
      expect(new AutoApproval().describe()).toBe("off");
    });

    it("names each scope and its setter", () => {
      const approval = new AutoApproval();
      approval.enable({ kind: "own" }, "flag");
      approval.enable({ kind: "agent", agentName: "reviewer" }, "command");

      expect(approval.describe()).toBe("own (flag), agent reviewer (command)");
    });
  });
});

describe("AutoApprovingAuthorizer", () => {
  it("approves the ask it is handed under the grant that selected it", async () => {
    const authorizer: TerminalAuthorizer = new AutoApprovingAuthorizer({
      kind: "auto_approve",
      setter: "command",
      scope: "agent",
    });

    const decision = await authorizer.authorize(FORWARDED_BY_REVIEWER);

    expect(decision).toEqual({
      approved: true,
      state: "approved",
      decidedBy: { kind: "auto_approve", setter: "command", scope: "agent" },
    });
  });
});
