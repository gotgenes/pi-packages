import { describe, expect, it, vi } from "vitest";
import type {
  AuthorizerInvocationContext,
  AuthorizerVerdict,
} from "#src/authority/authorizer";
import { composeAuthorizerChain } from "#src/authority/authorizer-chain";
import type { PermissionPromptDecision } from "#src/authority/permission-dialog";
import type { PromptPermissionDetails } from "#src/authority/permission-prompter";
import type { AuthorizerLog, PermissionQuery } from "#src/service";
import { makeAuthorizerLog } from "#test/helpers/authorizer-log-fixtures";

/** A shared review-log seam; identity-comparable for injection assertions. */
const log = makeAuthorizerLog();

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeDetails(): PromptPermissionDetails {
  return {
    requestId: "req-1",
    source: "tool_call",
    agentName: null,
    message: "Allow this?",
  };
}

/** A narrow PermissionQuery stub; identity-comparable for injection assertions. */
function makeQuery(): PermissionQuery {
  return {
    checkPermission: vi.fn(),
    getToolPermission: vi.fn(),
  };
}

/** A terminal stub returning a fixed decision; exposes the vi.fn for assertions. */
function makeTerminal(decision: PermissionPromptDecision) {
  return {
    authorize: vi
      .fn<
        (details: PromptPermissionDetails) => Promise<PermissionPromptDecision>
      >()
      .mockResolvedValue(decision),
  };
}

function makeContext(signal?: AbortSignal): AuthorizerInvocationContext {
  return { signal };
}

/** A non-terminal link stub returning a fixed verdict. */
function makeLink(verdict: AuthorizerVerdict) {
  return {
    authorize: vi
      .fn<
        (
          details: PromptPermissionDetails,
          query: PermissionQuery,
          log: AuthorizerLog,
          context: AuthorizerInvocationContext,
        ) => Promise<AuthorizerVerdict>
      >()
      .mockResolvedValue(verdict),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("composeAuthorizerChain", () => {
  it("returns the terminal instance itself when there are no links", () => {
    const terminal = makeTerminal({ approved: true, state: "approved" });

    const composed = composeAuthorizerChain(
      [],
      terminal,
      makeQuery(),
      log,
      makeContext(),
    );

    // Identity is a behavioral invariant: escalate hands the real terminal to
    // the prompter, so `expect.any(LocalUserAuthorizer)` still holds.
    expect(composed).toBe(terminal);
  });

  it("maps an allow verdict to an approved decision and injects the query", async () => {
    const terminal = makeTerminal({ approved: false, state: "denied" });
    const link = makeLink({ kind: "allow" });
    const query = makeQuery();
    const details = makeDetails();

    const composed = composeAuthorizerChain(
      [link],
      terminal,
      query,
      log,
      makeContext(),
    );
    const decision = await composed.authorize(details);

    expect(decision).toEqual({ approved: true, state: "approved" });
    // The chain injects the session-scoped query and the review-log seam into
    // each link (ADR 0007 §3).
    expect(link.authorize).toHaveBeenCalledWith(
      details,
      query,
      log,
      makeContext(),
    );
    expect(terminal.authorize).not.toHaveBeenCalled();
  });

  it("maps a deny verdict with a reason to a denied_with_reason decision", async () => {
    const terminal = makeTerminal({ approved: true, state: "approved" });
    const link = makeLink({
      kind: "deny",
      reason: "wrong path; use pi-packages",
    });

    const composed = composeAuthorizerChain(
      [link],
      terminal,
      makeQuery(),
      log,
      makeContext(),
    );
    const decision = await composed.authorize(makeDetails());

    expect(decision).toEqual({
      approved: false,
      state: "denied_with_reason",
      denialReason: "wrong path; use pi-packages",
    });
    expect(terminal.authorize).not.toHaveBeenCalled();
  });

  it("maps a deny verdict without a reason to a plain denied decision", async () => {
    const terminal = makeTerminal({ approved: true, state: "approved" });
    const link = makeLink({ kind: "deny" });

    const composed = composeAuthorizerChain(
      [link],
      terminal,
      makeQuery(),
      log,
      makeContext(),
    );
    const decision = await composed.authorize(makeDetails());

    expect(decision).toEqual({ approved: false, state: "denied" });
  });

  it("falls through a defer verdict to the terminal", async () => {
    const terminalDecision: PermissionPromptDecision = {
      approved: false,
      state: "denied",
      confirmationUnavailable: true,
    };
    const terminal = makeTerminal(terminalDecision);
    const link = makeLink({ kind: "defer" });
    const query = makeQuery();
    const details = makeDetails();

    const composed = composeAuthorizerChain(
      [link],
      terminal,
      query,
      log,
      makeContext(),
    );
    const decision = await composed.authorize(details);

    expect(decision).toEqual(terminalDecision);
    expect(link.authorize).toHaveBeenCalledWith(
      details,
      query,
      log,
      makeContext(),
    );
    expect(terminal.authorize).toHaveBeenCalledWith(details);
  });

  it("forwards a provided abort signal to each link", async () => {
    const terminal = makeTerminal({ approved: true, state: "approved" });
    const link = makeLink({ kind: "defer" });
    const signal = new AbortController().signal;
    const context: AuthorizerInvocationContext = { signal };

    const composed = composeAuthorizerChain(
      [link],
      terminal,
      makeQuery(),
      log,
      context,
    );
    await composed.authorize(makeDetails());

    expect(link.authorize).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      log,
      context,
    );
  });

  it("supports a fourth-argument runtime context", async () => {
    const terminal = makeTerminal({ approved: true, state: "approved" });
    const link = makeLink({ kind: "defer" });
    const query = makeQuery();
    const signal = new AbortController().signal;
    const context: AuthorizerInvocationContext = { signal };

    const composed = composeAuthorizerChain(
      [link],
      terminal,
      query,
      log,
      context,
    );
    await composed.authorize(makeDetails());

    expect(link.authorize).toHaveBeenCalledWith(
      expect.anything(),
      query,
      log,
      context,
    );
  });

  it("tries links in order and the first non-defer verdict wins", async () => {
    const terminal = makeTerminal({ approved: true, state: "approved" });
    const first = makeLink({ kind: "defer" });
    const second = makeLink({ kind: "deny", reason: "no" });
    const third = makeLink({ kind: "allow" });

    const composed = composeAuthorizerChain(
      [first, second, third],
      terminal,
      makeQuery(),
      log,
      makeContext(),
    );
    const decision = await composed.authorize(makeDetails());

    expect(decision).toEqual({
      approved: false,
      state: "denied_with_reason",
      denialReason: "no",
    });
    expect(third.authorize).not.toHaveBeenCalled();
    expect(terminal.authorize).not.toHaveBeenCalled();
  });

  it("reaches the terminal when every link defers", async () => {
    const terminal = makeTerminal({ approved: true, state: "approved" });
    const first = makeLink({ kind: "defer" });
    const second = makeLink({ kind: "defer" });

    const composed = composeAuthorizerChain(
      [first, second],
      terminal,
      makeQuery(),
      log,
      makeContext(),
    );
    const decision = await composed.authorize(makeDetails());

    expect(decision).toEqual({ approved: true, state: "approved" });
    expect(terminal.authorize).toHaveBeenCalledOnce();
  });
});
