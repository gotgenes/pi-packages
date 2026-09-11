import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { ParentAuthorizer } from "#src/authority/approval-escalator";
import { selectAuthorizer } from "#src/authority/authorizer";
import { DenyingAuthorizer } from "#src/authority/denying-authorizer";
import { LocalUserAuthorizer } from "#src/authority/local-user-authorizer";
import {
  makeAuthorizerSelectionDeps as makeDeps,
  makeDetection,
  neutralizeSubagentEnvHints,
} from "#test/helpers/authorizer-fixtures";

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

// ── Tests ─────────────────────────────────────────────────────────────────

describe("selectAuthorizer", () => {
  describe("terminal dispatch", () => {
    it("selects LocalUserAuthorizer when the context has UI", () => {
      const authority = selectAuthorizer(makeCtx(true), makeDeps());
      expect(authority.terminal).toBeInstanceOf(LocalUserAuthorizer);
    });

    it("selects LocalUserAuthorizer even when the context is also a subagent", () => {
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

    it("adjudicates locally when a subagent has its own UI", () => {
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
});
