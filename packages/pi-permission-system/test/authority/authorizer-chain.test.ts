import { describe, expect, it, vi } from "vitest";
import type { AuthorizerVerdict } from "#src/authority/authorizer";
import { composeAuthorizerChain } from "#src/authority/authorizer-chain";
import type { PermissionPromptDecision } from "#src/authority/permission-dialog";
import type { PromptPermissionDetails } from "#src/authority/permission-prompter";
import type { AuthorizerLog, PermissionQuery } from "#src/service";
import type { AskingBashUnit } from "#src/types";
import { makeAuthorizerLog } from "#test/helpers/authorizer-log-fixtures";
import {
  DECIDED_BY_ABSENT_AUTHORITY,
  DECIDED_BY_HUMAN,
} from "#test/helpers/decision-fixtures";
import {
  makeBashChainPromptDetails,
  makePromptDetails as makeDetails,
} from "#test/helpers/prompt-details-fixtures";

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
      decidedBy: DECIDED_BY_ABSENT_AUTHORITY,
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

  describe("a partial allow", () => {
    const assignment = { command: 'F="a b"', matchedPattern: "*" };
    const commit = { command: "git commit -m x", matchedPattern: "*" };
    const tests = { command: "npm test", matchedPattern: "*" };
    const line = 'F="a b" && git commit -m x && npm test';

    /** The ask the gate raises for `line` when only `units` ask. */
    function askFor(units: readonly AskingBashUnit[]) {
      return makeBashChainPromptDetails(units, { command: line });
    }

    function allowUnits(units: readonly AskingBashUnit[], name = "link") {
      return makeLink(
        { kind: "allow_units", units: units.map((unit) => unit.command) },
        name,
      );
    }

    it("hands the terminal only the units still asking", async () => {
      const terminal = makeTerminal();
      const composed = composeAuthorizerChain(
        [allowUnits([assignment])],
        terminal,
        makeQuery(),
        log,
      );

      const decision = await composed.authorize(
        askFor([assignment, commit, tests]),
      );

      expect(terminal.authorize).toHaveBeenCalledWith(askFor([commit, tests]));
      expect(decision).toStrictEqual({
        approved: true,
        state: "approved",
        decidedBy: DECIDED_BY_HUMAN,
      });
    });

    it("hands the next link the ask the previous one narrowed", async () => {
      const next = makeLink({ kind: "defer" }, "next");
      const query = makeQuery();
      const composed = composeAuthorizerChain(
        [allowUnits([assignment]), next],
        makeTerminal(),
        query,
        log,
      );

      await composed.authorize(askFor([assignment, commit, tests]));

      expect(next.authorize).toHaveBeenCalledWith(
        askFor([commit, tests]),
        query,
        log,
      );
    });

    it("allows the call, as the link that settled the last unit, once no unit is left", async () => {
      const terminal = makeTerminal();
      const composed = composeAuthorizerChain(
        [allowUnits([assignment], "first"), allowUnits([commit], "second")],
        terminal,
        makeQuery(),
        log,
      );

      const decision = await composed.authorize(askFor([assignment, commit]));

      // Non-persistent like any link grant: `approved`, never a session state.
      expect(decision).toStrictEqual({
        approved: true,
        state: "approved",
        decidedBy: {
          kind: "authorizer",
          name: "second",
          verdict: "allow",
          reason: null,
        },
      });
      expect(terminal.authorize).not.toHaveBeenCalled();
    });

    it("defers when it names no unit the ask lists", async () => {
      const terminal = makeTerminal();
      const details = askFor([assignment, commit]);
      const composed = composeAuthorizerChain(
        [allowUnits([tests])],
        terminal,
        makeQuery(),
        log,
      );

      await composed.authorize(details);

      expect(terminal.authorize).toHaveBeenCalledWith(details);
    });

    it("defers on a malformed unit list rather than reading it character by character", async () => {
      const terminal = makeTerminal();
      const single = { command: "x", matchedPattern: "*" };
      const details = makeBashChainPromptDetails([single]);
      const composed = composeAuthorizerChain(
        [
          makeLink({
            kind: "allow_units",
            units: "x",
          } as unknown as AuthorizerVerdict),
        ],
        terminal,
        makeQuery(),
        log,
      );

      await composed.authorize(details);

      expect(terminal.authorize).toHaveBeenCalledWith(details);
    });

    it("defers on an ask that lists no asking units", async () => {
      const terminal = makeTerminal();
      const details = makeDetails();
      const composed = composeAuthorizerChain(
        [allowUnits([assignment])],
        terminal,
        makeQuery(),
        log,
      );

      await composed.authorize(details);

      expect(terminal.authorize).toHaveBeenCalledWith(details);
    });

    describe("the review record", () => {
      it("names the link, the units it allowed, and the units left asking", async () => {
        const unitsLog = makeAuthorizerLog();
        const details = askFor([assignment, commit, tests]);
        const composed = composeAuthorizerChain(
          [allowUnits([assignment], "assignments")],
          makeTerminal(),
          makeQuery(),
          unitsLog,
        );

        await composed.authorize(details);

        expect(unitsLog.review).toHaveBeenCalledExactlyOnceWith(
          "authorizer_units_allowed",
          {
            requestId: details.requestId,
            link: "assignments",
            allowedUnits: [assignment.command],
            remainingUnits: [commit.command, tests.command],
          },
        );
      });

      it("is written for a link that settles the ask too", async () => {
        const unitsLog = makeAuthorizerLog();
        const details = askFor([assignment]);
        const composed = composeAuthorizerChain(
          [allowUnits([assignment], "assignments")],
          makeTerminal(),
          makeQuery(),
          unitsLog,
        );

        await composed.authorize(details);

        expect(unitsLog.review).toHaveBeenCalledExactlyOnceWith(
          "authorizer_units_allowed",
          {
            requestId: details.requestId,
            link: "assignments",
            allowedUnits: [assignment.command],
            remainingUnits: [],
          },
        );
      });
    });

    describe("the grants a session answer covers", () => {
      it.each([
        "approved_for_session",
        "approved_for_serving_session",
      ] as const)("names the narrowed grants on a %s answer", async (state) => {
        const answer: PermissionPromptDecision = {
          approved: true,
          state,
          decidedBy: DECIDED_BY_HUMAN,
        };
        const composed = composeAuthorizerChain(
          [allowUnits([assignment])],
          makeTerminal(answer),
          makeQuery(),
          log,
        );

        const decision = await composed.authorize(
          askFor([assignment, commit, tests]),
        );

        expect(decision).toStrictEqual({
          ...answer,
          narrowedGrants: [
            { surface: "bash", pattern: "git commit *" },
            { surface: "bash", pattern: "npm test*" },
          ],
        });
      });

      it("names an empty list when no unit left suggests a pattern", async () => {
        const comment = { command: "# note", matchedPattern: "*" };
        const answer: PermissionPromptDecision = {
          approved: true,
          state: "approved_for_session",
          decidedBy: DECIDED_BY_HUMAN,
        };
        const composed = composeAuthorizerChain(
          [allowUnits([assignment])],
          makeTerminal(answer),
          makeQuery(),
          log,
        );

        const decision = await composed.authorize(
          askFor([assignment, comment]),
        );

        expect(decision).toStrictEqual({ ...answer, narrowedGrants: [] });
      });

      it("keeps the narrower grants a terminal's answer already names", async () => {
        // A relaying terminal's answer can carry the grants its serving node
        // narrowed to; those are narrower than this chain's, so they stand.
        const answer: PermissionPromptDecision = {
          approved: true,
          state: "approved_for_session",
          narrowedGrants: [{ surface: "bash", pattern: "npm test*" }],
          decidedBy: DECIDED_BY_HUMAN,
        };
        const composed = composeAuthorizerChain(
          [allowUnits([assignment])],
          makeTerminal(answer),
          makeQuery(),
          log,
        );

        const decision = await composed.authorize(
          askFor([assignment, commit, tests]),
        );

        expect(decision).toStrictEqual(answer);
      });

      it("names no grants when no link narrowed the ask", async () => {
        const answer: PermissionPromptDecision = {
          approved: true,
          state: "approved_for_session",
          decidedBy: DECIDED_BY_HUMAN,
        };
        const composed = composeAuthorizerChain(
          [makeLink({ kind: "defer" })],
          makeTerminal(answer),
          makeQuery(),
          log,
        );

        const decision = await composed.authorize(askFor([assignment, commit]));

        expect(decision).toStrictEqual(answer);
      });
    });
  });

  it("reads a verdict it does not recognize as a defer", async () => {
    // A link is another extension's code: a newer verdict kind, or a
    // malformed one, must fall through to the terminal rather than decide.
    const terminal = makeTerminal();
    const unknown = makeLink({
      kind: "approve",
    } as unknown as AuthorizerVerdict);
    const details = makeDetails();

    const composed = composeAuthorizerChain(
      [unknown],
      terminal,
      makeQuery(),
      log,
    );
    const decision = await composed.authorize(details);

    expect(decision).toEqual({
      approved: true,
      state: "approved",
      decidedBy: DECIDED_BY_HUMAN,
    });
    expect(terminal.authorize).toHaveBeenCalledWith(details);
  });
});
