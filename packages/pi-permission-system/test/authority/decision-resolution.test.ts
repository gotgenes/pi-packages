import { describe, expect, it } from "vitest";
import { resolutionFor } from "#src/authority/decision-resolution";
import type { DecisionSource } from "#src/authority/decision-source";

const ALLOWED = { approved: true, forSession: false } as const;
const ALLOWED_FOR_SESSION = { approved: true, forSession: true } as const;
const REFUSED = { approved: false, forSession: false } as const;

describe("resolutionFor", () => {
  describe("recorded authority", () => {
    const rule: DecisionSource = {
      kind: "rule",
      surface: "bash",
      pattern: "git *",
      origin: "project",
    };

    it("names a rule allow policy_allow", () => {
      expect(resolutionFor(rule, ALLOWED)).toBe("policy_allow");
    });

    it("names a rule denial policy_deny", () => {
      expect(resolutionFor(rule, REFUSED)).toBe("policy_deny");
    });

    it("names a session grant session_approved", () => {
      expect(
        resolutionFor(
          { kind: "session_approval", surface: "bash", pattern: "git *" },
          ALLOWED,
        ),
      ).toBe("session_approved");
    });

    it("names an infrastructure read infrastructure_auto_allowed", () => {
      expect(resolutionFor({ kind: "infrastructure_read" }, ALLOWED)).toBe(
        "infrastructure_auto_allowed",
      );
    });

    it("names a yolo grant auto_approved", () => {
      expect(
        resolutionFor(
          { kind: "yolo", pattern: "<opaque-bash-wrapper>" },
          ALLOWED,
        ),
      ).toBe("auto_approved");
    });
  });

  describe("a human at a prompt", () => {
    const human: DecisionSource = { kind: "user", via: "dialog" };

    it("names a one-off approval user_approved", () => {
      expect(resolutionFor(human, ALLOWED)).toBe("user_approved");
    });

    it("names a session-scoped approval user_approved_for_session", () => {
      expect(resolutionFor(human, ALLOWED_FOR_SESSION)).toBe(
        "user_approved_for_session",
      );
    });

    it("names a denial user_denied", () => {
      expect(resolutionFor(human, REFUSED)).toBe("user_denied");
    });
  });

  describe("an authorizerChain link", () => {
    const link = (verdict: "allow" | "deny"): DecisionSource => ({
      kind: "authorizer",
      name: "model-judge",
      verdict,
      reason: null,
    });

    it("names a link grant authorizer_allowed, not the user's approval", () => {
      expect(resolutionFor(link("allow"), ALLOWED)).toBe("authorizer_allowed");
    });

    it("names a link denial authorizer_denied, not the user's denial", () => {
      expect(resolutionFor(link("deny"), REFUSED)).toBe("authorizer_denied");
    });

    it("does not report a link grant as session-scoped", () => {
      // A link grant is non-persistent by ADR 0007's envelope, so the caller's
      // `forSession` bit cannot make one look like a standing approval.
      expect(resolutionFor(link("allow"), ALLOWED_FOR_SESSION)).toBe(
        "authorizer_allowed",
      );
    });
  });

  describe("nobody ruled", () => {
    it("names an unreachable authority confirmation_unavailable", () => {
      expect(
        resolutionFor(
          { kind: "unavailable", reason: "no serving session" },
          REFUSED,
        ),
      ).toBe("confirmation_unavailable");
    });

    it("names a failed gate gate_error", () => {
      expect(
        resolutionFor({ kind: "gate_error", reason: "boom" }, REFUSED),
      ).toBe("gate_error");
    });
  });

  describe("another session decided", () => {
    function forwarded(decision: DecisionSource | null): DecisionSource {
      return {
        kind: "forwarded",
        responderSessionId: "parent-1",
        decision,
      };
    }

    it("names the parent's rule allow policy_allow, not the user's approval", () => {
      expect(
        resolutionFor(
          forwarded({
            kind: "rule",
            surface: "external_directory",
            pattern: "/tmp/*",
            origin: "global",
          }),
          ALLOWED,
        ),
      ).toBe("policy_allow");
    });

    it("names the parent's link denial authorizer_denied", () => {
      expect(
        resolutionFor(
          forwarded({
            kind: "authorizer",
            name: "model-judge",
            verdict: "deny",
            reason: "reads outside the project",
          }),
          REFUSED,
        ),
      ).toBe("authorizer_denied");
    });

    it("still names the parent's human approval user_approved", () => {
      expect(
        resolutionFor(forwarded({ kind: "user", via: "dialog" }), ALLOWED),
      ).toBe("user_approved");
    });

    it("carries the grant scope through the hop", () => {
      expect(
        resolutionFor(
          forwarded({ kind: "user", via: "dialog" }),
          ALLOWED_FOR_SESSION,
        ),
      ).toBe("user_approved_for_session");
    });

    it("falls back to the user attribution when the responder named no decider", () => {
      // A responder predating decision provenance sends none, so the hop is the
      // only fact available. Keeping today's answer is the fail-soft direction.
      expect(resolutionFor(forwarded(null), ALLOWED)).toBe("user_approved");
      expect(resolutionFor(forwarded(null), REFUSED)).toBe("user_denied");
    });
  });
});
