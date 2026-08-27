/**
 * Tests that handleInput emits permissions:decision events for skill input gates.
 */
import { describe, expect, it, vi } from "vitest";

import type { AskEscalator } from "#src/authority/authorizer-selection";
import { DECIDED_BY_HUMAN } from "#test/helpers/decision-fixtures";
import {
  getDecisionEvents,
  makeCheckResult,
  makeCtx,
  makeHandler,
} from "#test/helpers/handler-fixtures";

// ── helpers ────────────────────────────────────────────────────────────────

/** Build a checkPermission mock returning a skill-surface result. */
function makeSkillCheckPermission(state: "allow" | "deny" | "ask") {
  return vi.fn().mockReturnValue(
    makeCheckResult({
      state,
      toolName: "skill",
      source: "skill",
      origin: "global",
      matchedPattern: "*",
    }),
  );
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("handleInput decision events — skill gate", () => {
  it("does not emit when input is not a skill invocation", async () => {
    const { handler, events } = makeHandler();
    await handler.handleInput({ text: "hello world" }, makeCtx());
    expect(getDecisionEvents(events)).toHaveLength(0);
  });

  it("emits allow with policy_allow for an allowed skill", async () => {
    const { handler, events } = makeHandler({
      session: { checkPermission: makeSkillCheckPermission("allow") },
    });
    await handler.handleInput({ text: "/skill:librarian" }, makeCtx());

    const decisions = getDecisionEvents(events);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      surface: "skill",
      value: "librarian",
      result: "allow",
      resolution: "policy_allow",
    });
  });

  it("emits deny with policy_deny for a denied skill", async () => {
    const { handler, events } = makeHandler({
      session: { checkPermission: makeSkillCheckPermission("deny") },
    });
    await handler.handleInput({ text: "/skill:restricted" }, makeCtx());

    const decisions = getDecisionEvents(events);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      surface: "skill",
      value: "restricted",
      result: "deny",
      resolution: "policy_deny",
    });
  });

  it("emits allow with user_approved when state=ask and user approves", async () => {
    const { handler, events } = makeHandler({
      session: {
        checkPermission: makeSkillCheckPermission("ask"),
      },
      prompter: {
        escalate: vi.fn<AskEscalator["escalate"]>().mockResolvedValue({
          approved: true,
          state: "approved",
          decidedBy: DECIDED_BY_HUMAN,
        }),
      },
    });
    await handler.handleInput({ text: "/skill:explorer" }, makeCtx());

    const decisions = getDecisionEvents(events);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      surface: "skill",
      value: "explorer",
      result: "allow",
      resolution: "user_approved",
    });
  });

  it("emits deny with user_denied when state=ask and user denies", async () => {
    const { handler, events } = makeHandler({
      session: {
        checkPermission: makeSkillCheckPermission("ask"),
      },
      prompter: {
        escalate: vi.fn<AskEscalator["escalate"]>().mockResolvedValue({
          approved: false,
          state: "denied",
          decidedBy: DECIDED_BY_HUMAN,
        }),
      },
    });
    await handler.handleInput({ text: "/skill:explorer" }, makeCtx());

    const decisions = getDecisionEvents(events);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      surface: "skill",
      value: "explorer",
      result: "deny",
      resolution: "user_denied",
    });
  });

  it("emits deny with confirmation_unavailable when state=ask but no UI", async () => {
    const { handler, events } = makeHandler({
      session: {
        checkPermission: makeSkillCheckPermission("ask"),
      },
      prompter: {
        escalate: vi.fn<AskEscalator["escalate"]>().mockResolvedValue({
          approved: false,
          state: "denied",
          confirmationUnavailable: true,
          decidedBy: DECIDED_BY_HUMAN,
        }),
      },
    });
    await handler.handleInput(
      { text: "/skill:explorer" },
      makeCtx({ hasUI: false }),
    );

    const decisions = getDecisionEvents(events);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      surface: "skill",
      value: "explorer",
      result: "deny",
      resolution: "confirmation_unavailable",
    });
  });

  it("emits allow with auto_approved when prompt returns autoApproved:true", async () => {
    const { handler, events } = makeHandler({
      session: {
        checkPermission: makeSkillCheckPermission("ask"),
      },
      prompter: {
        escalate: vi.fn<AskEscalator["escalate"]>().mockResolvedValue({
          approved: true,
          state: "approved",
          autoApproved: true,
          decidedBy: DECIDED_BY_HUMAN,
        }),
      },
    });
    await handler.handleInput({ text: "/skill:explorer" }, makeCtx());

    const decisions = getDecisionEvents(events);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      surface: "skill",
      value: "explorer",
      result: "allow",
      resolution: "auto_approved",
    });
  });
});
