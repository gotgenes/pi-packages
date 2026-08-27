/**
 * Unit tests for AuthorizerSelection.
 *
 * AuthorizerSelection owns the stored ExtensionContext and is the sole
 * implementation of the AskEscalator role. These tests verify the
 * escalate/reject contract across activation state.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { ParentAuthorizer } from "#src/authority/approval-escalator";
import type { Authorizer } from "#src/authority/authorizer";
import { AuthorizerRegistry } from "#src/authority/authorizer-registry";
import {
  type AdjudicationRole,
  AuthorizerSelection,
} from "#src/authority/authorizer-selection";
import { LocalUserAuthorizer } from "#src/authority/local-user-authorizer";
import type { PermissionPromptDecision } from "#src/authority/permission-dialog";
import type { PromptPermissionDetails } from "#src/authority/permission-prompter";
import {
  makeAuthorizerSelectionDeps as makeDeps,
  makeDetection,
  makeInvokingPrompter,
  makePrompterApi,
  registerLink as register,
} from "#test/helpers/authorizer-fixtures";
import { makeAuthorizerLog } from "#test/helpers/authorizer-log-fixtures";
import { DECIDED_BY_HUMAN } from "#test/helpers/decision-fixtures";
import { makePromptDetails as makeDetails } from "#test/helpers/prompt-details-fixtures";

// ── Test helpers ──────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<ExtensionContext> = {}): ExtensionContext {
  return {
    cwd: "/test/project",
    hasUI: true,
    ui: {
      setStatus: vi.fn(),
      notify: vi.fn(),
      select: vi.fn(),
      input: vi.fn(),
    },
    sessionManager: {
      getEntries: vi.fn().mockReturnValue([]),
      getSessionDir: vi.fn().mockReturnValue("/sessions/test"),
      getSessionId: vi.fn().mockReturnValue(null),
      addEntry: vi.fn(),
    },
    ...overrides,
  } as unknown as ExtensionContext;
}

/** Details whose gate-computed surface drives the delegation envelope. */
function makeDetailsOn(surface: string): PromptPermissionDetails {
  return makeDetails({
    accessIntent: { surface, matchValues: ["/v"], boundaryValue: null },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("AuthorizerSelection", () => {
  describe("escalate", () => {
    it("rejects before activate", async () => {
      const selection = new AuthorizerSelection(makeDeps());
      await expect(selection.escalate(makeDetails())).rejects.toThrow(
        "escalate called before the session was activated",
      );
    });

    it("delegates to deps.prompter.prompt with the selected authorizer", async () => {
      const prompter = makePrompterApi();
      const selection = new AuthorizerSelection(makeDeps({ prompter }));
      const ctx = makeCtx({ hasUI: true });
      selection.activate(ctx);
      const details = makeDetails();

      const result = await selection.escalate(details);

      expect(prompter.prompt).toHaveBeenCalledWith(
        expect.any(LocalUserAuthorizer),
        details,
      );
      expect(result).toEqual({
        approved: true,
        state: "approved",
        decidedBy: DECIDED_BY_HUMAN,
      });
    });

    it("uses the most recently selected authorizer", async () => {
      const prompter = makePrompterApi();
      const selection = new AuthorizerSelection(makeDeps({ prompter }));
      selection.activate(makeCtx({ hasUI: false }));
      selection.activate(makeCtx({ hasUI: true }));

      await selection.escalate(makeDetails());

      expect(prompter.prompt).toHaveBeenCalledWith(
        expect.any(LocalUserAuthorizer),
        expect.anything(),
      );
    });

    it("rejects after deactivate", async () => {
      const selection = new AuthorizerSelection(makeDeps());
      selection.activate(makeCtx());
      selection.deactivate();
      await expect(selection.escalate(makeDetails())).rejects.toThrow(
        "escalate called before the session was activated",
      );
    });

    it("returns the prompter decision", async () => {
      const decision: PermissionPromptDecision = {
        approved: false,
        state: "denied",
        decidedBy: DECIDED_BY_HUMAN,
        denialReason: "user declined",
      };
      const prompter = makePrompterApi();
      prompter.prompt.mockResolvedValue(decision);
      const selection = new AuthorizerSelection(makeDeps({ prompter }));
      selection.activate(makeCtx());

      const result = await selection.escalate(makeDetails());

      expect(result).toEqual(decision);
    });
  });

  describe("lifecycle", () => {
    it("activate then deactivate rejects a subsequent escalate", async () => {
      const selection = new AuthorizerSelection(makeDeps());
      selection.activate(makeCtx());
      selection.deactivate();
      await expect(selection.escalate(makeDetails())).rejects.toThrow(
        "escalate called before the session was activated",
      );
    });

    it("multiple activate calls escalate against the most recent context", async () => {
      const prompter = makePrompterApi();
      const selection = new AuthorizerSelection(makeDeps({ prompter }));
      selection.activate(makeCtx({ cwd: "/old" }));
      selection.activate(makeCtx({ cwd: "/new" }));

      await selection.escalate(makeDetails());

      expect(prompter.prompt).toHaveBeenCalledOnce();
    });
  });

  describe("chain resolution", () => {
    it("consults a configured link before the terminal", async () => {
      const registry = new AuthorizerRegistry();
      register(registry, "judge", { kind: "deny", reason: "typo path" });
      const selection = new AuthorizerSelection(
        makeDeps({
          prompter: makeInvokingPrompter(),
          authorizerRegistry: registry,
          getAuthorizerChain: () => ["judge"],
        }),
      );
      selection.activate(makeCtx({ hasUI: true }));

      const decision = await selection.escalate(makeDetailsOn("bash"));

      // The link decided (deny_with_reason); the LocalUserAuthorizer terminal
      // was never reached (it would have approved by default).
      expect(decision).toEqual({
        approved: false,
        state: "denied_with_reason",
        denialReason: "typo path",
        decidedBy: {
          kind: "authorizer",
          name: "judge",
          verdict: "deny",
          reason: "typo path",
        },
      });
    });

    it("injects the session review-log seam into each link (ADR 0007 §3)", async () => {
      const logger = makeAuthorizerLog();
      const link = vi
        .fn<Authorizer["authorize"]>()
        .mockResolvedValue({ kind: "defer" });
      const registry = new AuthorizerRegistry();
      registry.register("judge", link);
      const selection = new AuthorizerSelection(
        makeDeps({
          prompter: makeInvokingPrompter(),
          authorizerRegistry: registry,
          getAuthorizerChain: () => ["judge"],
          logger,
        }),
      );
      selection.activate(makeCtx({ hasUI: true }));

      await selection.escalate(makeDetailsOn("bash"));

      // The link is handed the session logger as its third argument, so it can
      // record a decision trail to the shared review log.
      expect(link).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        logger,
      );
    });

    it("resolves links in config order (first non-defer wins)", async () => {
      const registry = new AuthorizerRegistry();
      register(registry, "a", { kind: "deny", reason: "a-wins" });
      register(registry, "b", { kind: "deny", reason: "b-wins" });
      const selection = new AuthorizerSelection(
        makeDeps({
          prompter: makeInvokingPrompter(),
          authorizerRegistry: registry,
          getAuthorizerChain: () => ["a", "b"],
        }),
      );
      selection.activate(makeCtx({ hasUI: true }));

      const decision = await selection.escalate(makeDetailsOn("bash"));

      expect(decision).toEqual({
        approved: false,
        state: "denied_with_reason",
        denialReason: "a-wins",
        decidedBy: {
          kind: "authorizer",
          name: "a",
          verdict: "deny",
          reason: "a-wins",
        },
      });
    });

    it("skips an unregistered configured name with a warning", async () => {
      const registry = new AuthorizerRegistry();
      register(registry, "present", {
        kind: "deny",
        reason: "present-decided",
      });
      const logger = makeAuthorizerLog();
      const selection = new AuthorizerSelection(
        makeDeps({
          prompter: makeInvokingPrompter(),
          authorizerRegistry: registry,
          getAuthorizerChain: () => ["missing", "present"],
          logger,
        }),
      );
      selection.activate(makeCtx({ hasUI: true }));

      const decision = await selection.escalate(makeDetailsOn("bash"));

      // The unregistered "missing" link is skipped fail-safe; "present"
      // decides, and is the name credited — the skipped one is not.
      expect(decision).toEqual({
        approved: false,
        state: "denied_with_reason",
        denialReason: "present-decided",
        decidedBy: {
          kind: "authorizer",
          name: "present",
          verdict: "deny",
          reason: "present-decided",
        },
      });
      expect(logger.review).toHaveBeenCalledWith(
        "authorizer_chain_unregistered_link",
        { requestId: "req-1", name: "missing" },
      );
    });

    it("records the resolved link names on the ask", async () => {
      const registry = new AuthorizerRegistry();
      register(registry, "judge", { kind: "defer" });
      const logger = makeAuthorizerLog();
      const selection = new AuthorizerSelection(
        makeDeps({
          prompter: makeInvokingPrompter(),
          authorizerRegistry: registry,
          getAuthorizerChain: () => ["judge"],
          logger,
        }),
      );
      selection.activate(makeCtx({ hasUI: true }));

      await selection.escalate(makeDetailsOn("bash"));

      // Positive evidence the link was consulted: a link that defers decides
      // nothing and would otherwise leave no trace of having run.
      expect(logger.review).toHaveBeenCalledWith("authorizer_chain_resolved", {
        requestId: "req-1",
        links: ["judge"],
      });
    });

    it("records only the names it could resolve", async () => {
      const registry = new AuthorizerRegistry();
      register(registry, "present", { kind: "defer" });
      const logger = makeAuthorizerLog();
      const selection = new AuthorizerSelection(
        makeDeps({
          prompter: makeInvokingPrompter(),
          authorizerRegistry: registry,
          getAuthorizerChain: () => ["missing", "present"],
          logger,
        }),
      );
      selection.activate(makeCtx({ hasUI: true }));

      await selection.escalate(makeDetailsOn("bash"));

      expect(logger.review).toHaveBeenCalledWith("authorizer_chain_resolved", {
        requestId: "req-1",
        links: ["present"],
      });
    });

    it("records no consultation when no configured name resolved", async () => {
      const logger = makeAuthorizerLog();
      const selection = new AuthorizerSelection(
        makeDeps({
          prompter: makeInvokingPrompter(),
          getAuthorizerChain: () => ["missing"],
          logger,
        }),
      );
      selection.activate(makeCtx({ hasUI: true }));

      await selection.escalate(makeDetailsOn("bash"));

      // Nothing ran, so there is no consultation to record; the per-name
      // warning already reports the skip.
      expect(logger.review).not.toHaveBeenCalledWith(
        "authorizer_chain_resolved",
        expect.anything(),
      );
    });

    it("caps a link's allow on an excluded surface, falling through to the terminal", async () => {
      const registry = new AuthorizerRegistry();
      register(registry, "judge", { kind: "allow" });
      const selection = new AuthorizerSelection(
        makeDeps({
          prompter: makeInvokingPrompter(),
          authorizerRegistry: registry,
          getAuthorizerChain: () => ["judge"],
        }),
      );
      // No UI, not a subagent → the terminal is DenyingAuthorizer.
      selection.activate(makeCtx({ hasUI: false }));

      const decision = await selection.escalate(
        makeDetailsOn("external_directory"),
      );

      // The envelope downgraded the link's allow to defer, so the terminal
      // (denying) owns the decision — the allow did not leak through.
      expect(decision.approved).toBe(false);
    });

    it("lets a link's allow through on a non-excluded surface", async () => {
      const registry = new AuthorizerRegistry();
      register(registry, "judge", { kind: "allow" });
      const selection = new AuthorizerSelection(
        makeDeps({
          prompter: makeInvokingPrompter(),
          authorizerRegistry: registry,
          getAuthorizerChain: () => ["judge"],
        }),
      );
      selection.activate(makeCtx({ hasUI: false }));

      const decision = await selection.escalate(makeDetailsOn("bash"));

      // bash is not excluded, so the link's allow stands (a non-persistent
      // approved grant) — the denying terminal is never reached.
      expect(decision).toEqual({
        approved: true,
        state: "approved",
        decidedBy: {
          kind: "authorizer",
          name: "judge",
          verdict: "allow",
          reason: null,
        },
      });
    });

    it("a registered but un-named link grants no authority (terminal identity)", async () => {
      const registry = new AuthorizerRegistry();
      register(registry, "judge", { kind: "allow" });
      const prompter = makePrompterApi();
      const selection = new AuthorizerSelection(
        makeDeps({
          prompter,
          authorizerRegistry: registry,
          getAuthorizerChain: () => [], // not named → opt-in withheld
        }),
      );
      selection.activate(makeCtx({ hasUI: true }));

      await selection.escalate(makeDetails());

      // Empty chain ⇒ the selected value is the terminal instance itself.
      expect(prompter.prompt).toHaveBeenCalledWith(
        expect.any(LocalUserAuthorizer),
        expect.anything(),
      );
    });
  });

  describe("adjudicatesLocally", () => {
    it("satisfies the AdjudicationRole seam", () => {
      const role: AdjudicationRole = new AuthorizerSelection(makeDeps());
      expect(role).toBeDefined();
    });

    it("reports true for a node with its own UI", () => {
      const selection = new AuthorizerSelection(makeDeps());
      selection.activate(makeCtx({ hasUI: true }));
      expect(selection.adjudicatesLocally()).toBe(true);
    });

    it("reports false for a relaying subagent node", () => {
      const selection = new AuthorizerSelection(
        makeDeps({ detection: makeDetection(true) }),
      );
      selection.activate(makeCtx({ hasUI: false }));
      expect(selection.adjudicatesLocally()).toBe(false);
    });

    it("reports true for a subagent node that has its own UI", () => {
      // selectAuthorizer tests hasUI before isSubagent, so the role cannot be
      // re-derived from subagent detection alone.
      const selection = new AuthorizerSelection(
        makeDeps({ detection: makeDetection(true) }),
      );
      selection.activate(makeCtx({ hasUI: true }));
      expect(selection.adjudicatesLocally()).toBe(true);
    });

    it("reports true for a headless non-subagent node", () => {
      const selection = new AuthorizerSelection(makeDeps());
      selection.activate(makeCtx({ hasUI: false }));
      expect(selection.adjudicatesLocally()).toBe(true);
    });

    it("reports true before activation and after deactivation", () => {
      const selection = new AuthorizerSelection(
        makeDeps({ detection: makeDetection(true) }),
      );
      expect(selection.adjudicatesLocally()).toBe(true);
      selection.activate(makeCtx({ hasUI: false }));
      selection.deactivate();
      expect(selection.adjudicatesLocally()).toBe(true);
    });
  });

  describe("chain delegation on a relaying node", () => {
    /** A no-UI subagent node: its terminal relays the ask to the serving node. */
    function makeRelayingSelection(
      overrides: Parameters<typeof makeDeps>[0] = {},
    ): AuthorizerSelection {
      const selection = new AuthorizerSelection(
        makeDeps({ detection: makeDetection(true), ...overrides }),
      );
      selection.activate(makeCtx({ hasUI: false }));
      return selection;
    }

    it("composes no links, so the ask reaches the relaying terminal unchanged", async () => {
      const registry = new AuthorizerRegistry();
      register(registry, "judge", { kind: "deny", reason: "judged locally" });
      const prompter = makePrompterApi();
      const selection = makeRelayingSelection({
        prompter,
        authorizerRegistry: registry,
        getAuthorizerChain: () => ["judge"],
      });
      const details = makeDetailsOn("bash");

      await selection.escalate(details);

      // Zero links ⇒ the composed chain *is* the terminal instance, so the
      // registered link never ran: the serving node adjudicates this ask.
      expect(prompter.prompt).toHaveBeenCalledWith(
        expect.any(ParentAuthorizer),
        details,
      );
    });

    it("records the delegated chain instead of the resolved one", async () => {
      const registry = new AuthorizerRegistry();
      register(registry, "judge", { kind: "deny", reason: "judged locally" });
      const logger = makeAuthorizerLog();
      const selection = makeRelayingSelection({
        authorizerRegistry: registry,
        getAuthorizerChain: () => ["judge"],
        logger,
      });

      await selection.escalate(makeDetailsOn("bash"));

      expect(logger.review).toHaveBeenCalledWith("authorizer_chain_delegated", {
        requestId: "req-1",
        links: ["judge"],
      });
      expect(logger.review).not.toHaveBeenCalledWith(
        "authorizer_chain_resolved",
        expect.anything(),
      );
    });

    it("does not report an unregistrable link as an unregistered one", async () => {
      const logger = makeAuthorizerLog();
      const selection = makeRelayingSelection({
        getAuthorizerChain: () => ["model-judge"],
        logger,
      });

      await selection.escalate(makeDetailsOn("bash"));

      // A child cannot host a link at all (#699), so its absence is the design,
      // not the misconfiguration `authorizer_chain_unregistered_link` reports.
      expect(logger.review).not.toHaveBeenCalledWith(
        "authorizer_chain_unregistered_link",
        expect.anything(),
      );
    });

    it("records nothing when no chain is configured", async () => {
      const logger = makeAuthorizerLog();
      const selection = makeRelayingSelection({ logger });

      await selection.escalate(makeDetailsOn("bash"));

      expect(logger.review).not.toHaveBeenCalledWith(
        "authorizer_chain_delegated",
        expect.anything(),
      );
    });
  });
});
