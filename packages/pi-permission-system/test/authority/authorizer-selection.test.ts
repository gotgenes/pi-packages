/**
 * Unit tests for AuthorizerSelection.
 *
 * AuthorizerSelection owns the stored ExtensionContext and is the sole
 * implementation of the AskEscalator role. These tests verify the
 * escalate/reject contract across activation state.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import type {
  Authorizer,
  AuthorizerVerdict,
  AuthorizerSelectionDeps as SelectionCtorDeps,
} from "#src/authority/authorizer";
import { AuthorizerRegistry } from "#src/authority/authorizer-registry";
import { AuthorizerSelection } from "#src/authority/authorizer-selection";
import { LocalUserAuthorizer } from "#src/authority/local-user-authorizer";
import type { PermissionPromptDecision } from "#src/authority/permission-dialog";
import type {
  PermissionPrompterApi,
  PromptPermissionDetails,
} from "#src/authority/permission-prompter";
import type { SubagentDetector } from "#src/authority/subagent-detection";
import type { PermissionQuery } from "#src/service";
import { makeAuthorizerLog } from "#test/helpers/authorizer-log-fixtures";

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

function makePrompterApi(): PermissionPrompterApi & {
  prompt: ReturnType<typeof vi.fn>;
} {
  return {
    prompt: vi
      .fn<PermissionPrompterApi["prompt"]>()
      .mockResolvedValue({ approved: true, state: "approved" }),
  };
}

function makeDetails(): PromptPermissionDetails {
  return {
    requestId: "req-1",
    source: "tool_call",
    agentName: null,
    message: "Allow this?",
  };
}

function makeDetection(isSubagent = false): SubagentDetector {
  return { isSubagent: vi.fn(() => isSubagent) };
}

function makeQuery(): PermissionQuery {
  return { checkPermission: vi.fn(), getToolPermission: vi.fn() };
}

/** Details whose gate-computed surface drives the delegation envelope. */
function makeDetailsOn(surface: string): PromptPermissionDetails {
  return {
    ...makeDetails(),
    accessIntent: { surface, matchValues: ["/v"], boundaryValue: null },
  };
}

/** A prompter that actually runs the passed authorizer, so a test can observe
 * the composed chain's decision (the real PermissionPrompter brackets log
 * entries around `authorizer.authorize(details)`). */
function makeInvokingPrompter(): PermissionPrompterApi & {
  prompt: ReturnType<typeof vi.fn>;
} {
  return {
    prompt: vi.fn<PermissionPrompterApi["prompt"]>((authorizer, details) =>
      authorizer.authorize(details),
    ),
  };
}

type SelectionDeps = SelectionCtorDeps & {
  prompter: PermissionPrompterApi;
  getPermissionQuery: () => PermissionQuery;
  authorizerRegistry: AuthorizerRegistry;
  getAuthorizerChain: () => string[];
  getAllowAuthorizerOnExternalDirectory: () => boolean;
};

function makeDeps(overrides: Partial<SelectionDeps> = {}): SelectionDeps {
  return {
    detection: overrides.detection ?? makeDetection(),
    events: overrides.events ?? {
      emit: vi.fn(),
      on: vi.fn().mockReturnValue(() => undefined),
    },
    getPromptPreferences:
      overrides.getPromptPreferences ??
      (() => ({ doublePressToConfirm: true })),
    requestPermissionDecision:
      overrides.requestPermissionDecision ??
      vi.fn().mockResolvedValue({ approved: true, state: "approved" }),
    forwardingDir: overrides.forwardingDir ?? "/tmp/forwarding",
    registry: overrides.registry,
    logger: overrides.logger ?? makeAuthorizerLog(),
    prompter: overrides.prompter ?? makePrompterApi(),
    getPermissionQuery: overrides.getPermissionQuery ?? (() => makeQuery()),
    authorizerRegistry:
      overrides.authorizerRegistry ?? new AuthorizerRegistry(),
    getAuthorizerChain: overrides.getAuthorizerChain ?? (() => []),
    getAllowAuthorizerOnExternalDirectory:
      overrides.getAllowAuthorizerOnExternalDirectory ?? (() => false),
  };
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
      expect(result).toEqual({ approved: true, state: "approved" });
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
    /** Register a link returning a fixed verdict. */
    function register(
      registry: AuthorizerRegistry,
      name: string,
      verdict: AuthorizerVerdict,
    ): void {
      registry.register(name, () => Promise.resolve(verdict));
    }

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

      // The unregistered "missing" link is skipped fail-safe; "present" decides.
      expect(decision).toEqual({
        approved: false,
        state: "denied_with_reason",
        denialReason: "present-decided",
      });
      expect(logger.review).toHaveBeenCalledWith(
        "authorizer_chain_unregistered_link",
        { name: "missing" },
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
      expect(decision).toEqual({ approved: true, state: "approved" });
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
});
