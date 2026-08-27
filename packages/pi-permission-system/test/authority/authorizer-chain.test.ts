import { describe, expect, it, vi } from "vitest";
import type { AuthorizerVerdict } from "#src/authority/authorizer";
import { composeAuthorizerChain } from "#src/authority/authorizer-chain";
import type { PermissionPromptDecision } from "#src/authority/permission-dialog";
import type { PromptPermissionDetails } from "#src/authority/permission-prompter";
import type { AuthorizerLog, PermissionQuery } from "#src/service";
import { makeAuthorizerLog } from "#test/helpers/authorizer-log-fixtures";
import { DECIDED_BY_HUMAN } from "#test/helpers/decision-fixtures";
import { makePromptDetails as makeDetails } from "#test/helpers/prompt-details-fixtures";

/** A shared review-log seam; identity-comparable for injection assertions. */
const log = makeAuthorizerLog();

// ── Helpers ─────────────────────────────────────────────────────────────────

/** A narrow PermissionQuery stub; identity-comparable for injection assertions. */
function makeQuery(): PermissionQuery {
  return {
    checkPermission: vi.fn(),
    getToolPermission: vi.fn(),
  };
}

/**
 * A terminal stub returning a fixed decision; exposes the vi.fn for assertions.
 *
 * The default is filler for the tests that assert the terminal is never
 * reached; a test whose subject is the terminal's own decision passes one.
 */
function makeTerminal(
  decision: PermissionPromptDecision = {
    approved: true,
    state: "approved",
    decidedBy: DECIDED_BY_HUMAN,
  },
) {
  return {
    authorize: vi
      .fn<
        (details: PromptPermissionDetails) => Promise<PermissionPromptDecision>
      >()
      .mockResolvedValue(decision),
  };
}

/** A non-terminal link stub returning a fixed verdict, under a given name. */
function makeLink(verdict: AuthorizerVerdict, name = "link") {
  return {
    name,
    authorize: vi
      .fn<
        (
          details: PromptPermissionDetails,
          query: PermissionQuery,
          log: AuthorizerLog,
        ) => Promise<AuthorizerVerdict>
      >()
      .mockResolvedValue(verdict),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("composeAuthorizerChain", () => {
  it("returns the terminal instance itself when there are no links", () => {
    const terminal = makeTerminal();

    const composed = composeAuthorizerChain([], terminal, makeQuery(), log);

    // Identity is a behavioral invariant: escalate hands the real terminal to
    // the prompter, so `expect.any(LocalUserAuthorizer)` still holds.
    expect(composed).toBe(terminal);
  });

  it("maps an allow verdict to an approved decision and injects the query", async () => {
    const terminal = makeTerminal({
      approved: false,
      state: "denied",
      decidedBy: DECIDED_BY_HUMAN,
    });
    const link = makeLink({ kind: "allow" }, "model-judge");
    const query = makeQuery();
    const details = makeDetails();

    const composed = composeAuthorizerChain([link], terminal, query, log);
    const decision = await composed.authorize(details);

    expect(decision).toEqual({
      approved: true,
      state: "approved",
      decidedBy: {
        kind: "authorizer",
        name: "model-judge",
        verdict: "allow",
        reason: null,
      },
    });
    // The chain injects the session-scoped query and the review-log seam into
    // each link (ADR 0007 §3).
    expect(link.authorize).toHaveBeenCalledWith(details, query, log);
    expect(terminal.authorize).not.toHaveBeenCalled();
  });

  it("maps a deny verdict with a reason to a denied_with_reason decision", async () => {
    const terminal = makeTerminal();
    const link = makeLink(
      { kind: "deny", reason: "wrong path; use pi-packages" },
      "model-judge",
    );

    const composed = composeAuthorizerChain([link], terminal, makeQuery(), log);
    const decision = await composed.authorize(makeDetails());

    expect(decision).toEqual({
      approved: false,
      state: "denied_with_reason",
      denialReason: "wrong path; use pi-packages",
      decidedBy: {
        kind: "authorizer",
        name: "model-judge",
        verdict: "deny",
        reason: "wrong path; use pi-packages",
      },
    });
    expect(terminal.authorize).not.toHaveBeenCalled();
  });

  it("maps a deny verdict without a reason to a plain denied decision", async () => {
    const terminal = makeTerminal();
    const link = makeLink({ kind: "deny" }, "guard");

    const composed = composeAuthorizerChain([link], terminal, makeQuery(), log);
    const decision = await composed.authorize(makeDetails());

    expect(decision).toEqual({
      approved: false,
      state: "denied",
      decidedBy: {
        kind: "authorizer",
        name: "guard",
        verdict: "deny",
        reason: null,
      },
    });
  });

  it("falls through a defer verdict to the terminal", async () => {
    const terminalDecision: PermissionPromptDecision = {
      approved: false,
      state: "denied",
      decidedBy: DECIDED_BY_HUMAN,
      confirmationUnavailable: true,
    };
    const terminal = makeTerminal(terminalDecision);
    const link = makeLink({ kind: "defer" });
    const query = makeQuery();
    const details = makeDetails();

    const composed = composeAuthorizerChain([link], terminal, query, log);
    const decision = await composed.authorize(details);

    expect(decision).toEqual(terminalDecision);
    expect(link.authorize).toHaveBeenCalledWith(details, query, log);
    expect(terminal.authorize).toHaveBeenCalledWith(details);
  });

  it("tries links in order and the first non-defer verdict wins", async () => {
    const terminal = makeTerminal();
    const first = makeLink({ kind: "defer" }, "first");
    const second = makeLink({ kind: "deny", reason: "no" }, "second");
    const third = makeLink({ kind: "allow" }, "third");

    const composed = composeAuthorizerChain(
      [first, second, third],
      terminal,
      makeQuery(),
      log,
    );
    const decision = await composed.authorize(makeDetails());

    // The deciding link is named, not merely the consulted set: a deferring
    // link ahead of it decided nothing and must not be credited.
    expect(decision).toEqual({
      approved: false,
      state: "denied_with_reason",
      denialReason: "no",
      decidedBy: {
        kind: "authorizer",
        name: "second",
        verdict: "deny",
        reason: "no",
      },
    });
    expect(third.authorize).not.toHaveBeenCalled();
    expect(terminal.authorize).not.toHaveBeenCalled();
  });

  it("reaches the terminal when every link defers", async () => {
    const terminal = makeTerminal({
      approved: true,
      state: "approved",
      decidedBy: DECIDED_BY_HUMAN,
    });
    const first = makeLink({ kind: "defer" }, "first");
    const second = makeLink({ kind: "defer" }, "second");

    const composed = composeAuthorizerChain(
      [first, second],
      terminal,
      makeQuery(),
      log,
    );
    const decision = await composed.authorize(makeDetails());

    // The terminal's own decision passes through unchanged — a link that
    // deferred is not the decider.
    expect(decision).toEqual({
      approved: true,
      state: "approved",
      decidedBy: DECIDED_BY_HUMAN,
    });
    expect(terminal.authorize).toHaveBeenCalledOnce();
  });
});
