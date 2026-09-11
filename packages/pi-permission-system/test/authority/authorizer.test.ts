import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { ParentAuthorizer } from "#src/authority/approval-escalator";
import { selectAuthorizer } from "#src/authority/authorizer";
import { DenyingAuthorizer } from "#src/authority/denying-authorizer";
import type { TargetServingLookup } from "#src/authority/forwarding-liveness";
import { LocalUserAuthorizer } from "#src/authority/local-user-authorizer";
import {
  makeAuthorizerSelectionDeps as makeDeps,
  makeDetection,
  neutralizeSubagentEnvHints,
} from "#test/helpers/authorizer-fixtures";
import { makeSubagentRegistry } from "#test/helpers/forwarding-fixtures";

neutralizeSubagentEnvHints();

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeCtx(hasUI: boolean): ExtensionContext {
  return {
    hasUI,
    mode: "tui",
    ui: { select: vi.fn(), input: vi.fn(), custom: vi.fn() },
    sessionManager: {
      getSessionId: vi.fn().mockReturnValue("session-1"),
      getSessionDir: vi.fn().mockReturnValue("/sessions/session-1"),
      getEntries: vi.fn().mockReturnValue([]),
    },
  } as unknown as ExtensionContext;
}

/** A serving lookup answering a fixed verdict for any target. */
function makeServing(answer: boolean | null) {
  return {
    isServing: vi.fn<TargetServingLookup["isServing"]>(() => answer),
    describe: vi.fn<TargetServingLookup["describe"]>(() => ({
      channel: "none" as const,
      state: null,
      servingIds: [],
    })),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("selectAuthorizer", () => {
  describe("terminal dispatch", () => {
    it("selects LocalUserAuthorizer when the context has UI", () => {
      const authority = selectAuthorizer(makeCtx(true), makeDeps());
      expect(authority.terminal).toBeInstanceOf(LocalUserAuthorizer);
    });

    it("selects LocalUserAuthorizer for a subagent with UI that declares no parent", () => {
      const authority = selectAuthorizer(
        makeCtx(true),
        makeDeps({ detection: makeDetection(true) }),
      );
      expect(authority.terminal).toBeInstanceOf(LocalUserAuthorizer);
    });

    it("selects ParentAuthorizer when there is no UI but the context is a subagent", () => {
      const authority = selectAuthorizer(
        makeCtx(false),
        makeDeps({ detection: makeDetection(true) }),
      );
      expect(authority.terminal).toBeInstanceOf(ParentAuthorizer);
    });

    it("selects DenyingAuthorizer when there is no UI and no subagent", () => {
      const authority = selectAuthorizer(
        makeCtx(false),
        makeDeps({ detection: makeDetection(false) }),
      );
      expect(authority.terminal).toBeInstanceOf(DenyingAuthorizer);
    });
  });

  describe("chain role", () => {
    it("adjudicates locally when the terminal is the human", () => {
      const authority = selectAuthorizer(makeCtx(true), makeDeps());
      expect(authority.adjudicatesLocally).toBe(true);
    });

    it("adjudicates locally when a subagent with its own UI declares no parent", () => {
      const authority = selectAuthorizer(
        makeCtx(true),
        makeDeps({ detection: makeDetection(true) }),
      );
      expect(authority.adjudicatesLocally).toBe(true);
    });

    it("relays instead of adjudicating when the terminal forwards to a serving node", () => {
      const authority = selectAuthorizer(
        makeCtx(false),
        makeDeps({ detection: makeDetection(true) }),
      );
      expect(authority.adjudicatesLocally).toBe(false);
    });

    it("adjudicates locally when the terminal denies for want of authority", () => {
      const authority = selectAuthorizer(
        makeCtx(false),
        makeDeps({ detection: makeDetection(false) }),
      );
      expect(authority.adjudicatesLocally).toBe(true);
    });
  });

  describe("a UI session that declares a parent", () => {
    it("relays to the session an env marker names while that session serves", () => {
      vi.stubEnv("PI_SUBAGENT_PARENT_SESSION", "lead-session");
      const authority = selectAuthorizer(
        makeCtx(true),
        makeDeps({
          detection: makeDetection(true),
          serving: makeServing(true),
        }),
      );
      expect(authority.terminal).toBeInstanceOf(ParentAuthorizer);
      expect(authority.adjudicatesLocally).toBe(false);
      expect(authority.relayTarget).toEqual({
        sessionId: "lead-session",
        source: "env",
      });
    });

    it("relays to a registry-resolved parent while that parent serves", () => {
      const authority = selectAuthorizer(
        makeCtx(true),
        makeDeps({
          detection: makeDetection(true),
          registry: makeSubagentRegistry("session-1", {
            parentSessionId: "lead-session",
          }),
          serving: makeServing(true),
        }),
      );
      expect(authority.terminal).toBeInstanceOf(ParentAuthorizer);
      expect(authority.relayTarget).toEqual({
        sessionId: "lead-session",
        source: "registry",
      });
    });

    it("asks the serving channel about the target it resolved", () => {
      vi.stubEnv("PI_SUBAGENT_PARENT_SESSION", "lead-session");
      const serving = makeServing(true);
      selectAuthorizer(
        makeCtx(true),
        makeDeps({ detection: makeDetection(true), serving }),
      );
      expect(serving.isServing).toHaveBeenCalledWith({
        sessionId: "lead-session",
        source: "env",
      });
    });

    it("keeps the local dialog when the declared parent is not serving", () => {
      vi.stubEnv("PI_SUBAGENT_PARENT_SESSION", "lead-session");
      const authority = selectAuthorizer(
        makeCtx(true),
        makeDeps({
          detection: makeDetection(true),
          serving: makeServing(false),
        }),
      );
      expect(authority.terminal).toBeInstanceOf(LocalUserAuthorizer);
      expect(authority.adjudicatesLocally).toBe(true);
      expect(authority.relayTarget).toBeUndefined();
    });

    it("keeps the local dialog when no channel can answer for the parent", () => {
      vi.stubEnv("PI_SUBAGENT_PARENT_SESSION", "lead-session");
      const authority = selectAuthorizer(
        makeCtx(true),
        makeDeps({
          detection: makeDetection(true),
          serving: makeServing(null),
        }),
      );
      expect(authority.terminal).toBeInstanceOf(LocalUserAuthorizer);
    });

    it("keeps the local dialog when the marker names the reading session", () => {
      vi.stubEnv("PI_SUBAGENT_PARENT_SESSION", "session-1");
      const serving = makeServing(true);
      const authority = selectAuthorizer(
        makeCtx(true),
        makeDeps({ detection: makeDetection(true), serving }),
      );
      expect(authority.terminal).toBeInstanceOf(LocalUserAuthorizer);
      expect(serving.isServing).not.toHaveBeenCalled();
    });
  });

  describe("a headless subagent", () => {
    it("relays without consulting the serving channel", () => {
      vi.stubEnv("PI_SUBAGENT_PARENT_SESSION", "lead-session");
      const serving = makeServing(false);
      const authority = selectAuthorizer(
        makeCtx(false),
        makeDeps({ detection: makeDetection(true), serving }),
      );
      expect(authority.terminal).toBeInstanceOf(ParentAuthorizer);
      expect(serving.isServing).not.toHaveBeenCalled();
    });
  });
});
