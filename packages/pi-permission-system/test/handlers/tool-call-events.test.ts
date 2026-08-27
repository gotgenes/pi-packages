/**
 * Tests that handleToolCall emits permissions:decision events at every
 * gate resolution and fast-path site.
 */
import { describe, expect, it, vi } from "vitest";

import type { AskEscalator } from "#src/authority/authorizer-selection";
import { DECIDED_BY_HUMAN } from "#test/helpers/decision-fixtures";
import {
  getDecisionEvents,
  makeCheckResult,
  makeCtx,
  makeHandler,
  makeToolCallEvent,
} from "#test/helpers/handler-fixtures";

// ── policy_allow path ──────────────────────────────────────────────────────

describe("handleToolCall decision events — policy_allow", () => {
  it("emits allow with policy_allow when checkPermission returns allow", async () => {
    const { handler, events } = makeHandler({
      session: {
        checkPermission: vi.fn().mockReturnValue(
          makeCheckResult({
            state: "allow",
            origin: "global",
            matchedPattern: "*",
          }),
        ),
      },
    });

    await handler.handleToolCall(makeToolCallEvent("read"), makeCtx());

    const decisions = getDecisionEvents(events);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      surface: "read",
      result: "allow",
      resolution: "policy_allow",
      origin: "global",
      matchedPattern: "*",
    });
  });
});

// ── policy_deny path ───────────────────────────────────────────────────────

describe("handleToolCall decision events — policy_deny", () => {
  it("emits deny with policy_deny when checkPermission returns deny", async () => {
    const { handler, events } = makeHandler({
      session: {
        checkPermission: vi.fn().mockReturnValue(
          makeCheckResult({
            state: "deny",
            origin: "project",
            matchedPattern: "read",
          }),
        ),
      },
    });

    await handler.handleToolCall(makeToolCallEvent("read"), makeCtx());

    const decisions = getDecisionEvents(events);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      surface: "read",
      result: "deny",
      resolution: "policy_deny",
    });
  });
});

// ── session_approved fast path ─────────────────────────────────────────────

describe("handleToolCall decision events — session_approved", () => {
  it("emits allow with session_approved when checkPermission returns source:session", async () => {
    const { handler, events } = makeHandler({
      session: {
        checkPermission: vi.fn().mockReturnValue(
          makeCheckResult({
            state: "allow",
            source: "session",
            matchedPattern: "git *",
          }),
        ),
      },
    });

    await handler.handleToolCall(
      makeToolCallEvent("bash", { input: { command: "git status" } }),
      makeCtx(),
    );

    const decisions = getDecisionEvents(events);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      surface: "bash",
      result: "allow",
      resolution: "session_approved",
    });
  });
});

// ── user_approved path ─────────────────────────────────────────────────────

describe("handleToolCall decision events — user_approved", () => {
  it("emits allow with user_approved when state=ask and user approves once", async () => {
    const { handler, events } = makeHandler({
      session: {
        checkPermission: vi
          .fn()
          .mockReturnValue(makeCheckResult({ state: "ask" })),
      },
      prompter: {
        escalate: vi.fn<AskEscalator["escalate"]>().mockResolvedValue({
          approved: true,
          state: "approved",
          decidedBy: DECIDED_BY_HUMAN,
        }),
      },
    });

    await handler.handleToolCall(makeToolCallEvent("read"), makeCtx());

    const decisions = getDecisionEvents(events);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      result: "allow",
      resolution: "user_approved",
    });
  });

  it("emits allow with user_approved_for_session when user approves for session", async () => {
    const { handler, events } = makeHandler({
      session: {
        checkPermission: vi
          .fn()
          .mockReturnValue(makeCheckResult({ state: "ask" })),
      },
      prompter: {
        escalate: vi.fn<AskEscalator["escalate"]>().mockResolvedValue({
          approved: true,
          state: "approved_for_session",
          decidedBy: DECIDED_BY_HUMAN,
        }),
      },
    });

    await handler.handleToolCall(makeToolCallEvent("read"), makeCtx());

    const decisions = getDecisionEvents(events);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      result: "allow",
      resolution: "user_approved_for_session",
    });
  });
});

// ── user_denied path ───────────────────────────────────────────────────────

describe("handleToolCall decision events — user_denied", () => {
  it("emits deny with user_denied when state=ask and user denies", async () => {
    const { handler, events } = makeHandler({
      session: {
        checkPermission: vi
          .fn()
          .mockReturnValue(makeCheckResult({ state: "ask" })),
      },
      prompter: {
        escalate: vi.fn<AskEscalator["escalate"]>().mockResolvedValue({
          approved: false,
          state: "denied",
          decidedBy: DECIDED_BY_HUMAN,
        }),
      },
    });

    await handler.handleToolCall(makeToolCallEvent("read"), makeCtx());

    const decisions = getDecisionEvents(events);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      result: "deny",
      resolution: "user_denied",
    });
  });
});

// ── confirmation_unavailable path ──────────────────────────────────────────

describe("handleToolCall decision events — confirmation_unavailable", () => {
  it("emits deny with confirmation_unavailable when state=ask but no UI", async () => {
    const { handler, events } = makeHandler({
      session: {
        checkPermission: vi
          .fn()
          .mockReturnValue(makeCheckResult({ state: "ask" })),
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

    await handler.handleToolCall(
      makeToolCallEvent("read"),
      makeCtx({ hasUI: false }),
    );

    const decisions = getDecisionEvents(events);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      result: "deny",
      resolution: "confirmation_unavailable",
    });
  });
});

// ── infrastructure_auto_allowed path ──────────────────────────────────────

describe("handleToolCall decision events — infrastructure_auto_allowed", () => {
  it("emits allow with infrastructure_auto_allowed for Pi infra reads", async () => {
    const infraDir = "/test/agent";
    const { handler, events } = makeHandler({
      session: {
        checkPermission: vi.fn().mockReturnValue(makeCheckResult()),
        getInfrastructureReadDirs: vi.fn().mockReturnValue([infraDir]),
      },
    });

    const event = makeToolCallEvent("read", {
      input: { path: `${infraDir}/some-file.json` },
    });
    await handler.handleToolCall(event, makeCtx());

    const decisions = getDecisionEvents(events);
    const infraEvents = decisions.filter(
      (e) => e.resolution === "infrastructure_auto_allowed",
    );
    expect(infraEvents).toHaveLength(1);
    expect(infraEvents[0]).toMatchObject({
      result: "allow",
      resolution: "infrastructure_auto_allowed",
    });
  });
});

// ── auto_approved path (yolo mode) ───────────────────────────────────

describe("handleToolCall decision events — auto_approved", () => {
  it("emits allow with auto_approved when prompt returns autoApproved:true", async () => {
    const { handler, events } = makeHandler({
      session: {
        checkPermission: vi
          .fn()
          .mockReturnValue(makeCheckResult({ state: "ask" })),
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

    await handler.handleToolCall(makeToolCallEvent("read"), makeCtx());

    const decisions = getDecisionEvents(events);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      result: "allow",
      resolution: "auto_approved",
    });
  });
});
