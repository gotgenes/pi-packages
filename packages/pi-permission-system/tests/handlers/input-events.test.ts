/**
 * Tests that handleInput emits permissions:decision events for skill input gates.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { PermissionGateHandler } from "../../src/handlers/permission-gate-handler";
import type { PermissionDecisionEvent } from "../../src/permission-events";
import { PERMISSIONS_DECISION_CHANNEL } from "../../src/permission-events";
import type { PermissionSession } from "../../src/permission-session";
import type { ToolRegistry } from "../../src/tool-registry";
import type { PermissionState } from "../../src/types";

// ── helpers ────────────────────────────────────────────────────────────────

function makeEvents() {
  return {
    emit: vi.fn(),
    on: vi.fn().mockReturnValue(() => undefined),
  };
}

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
      addEntry: vi.fn(),
    },
    ...overrides,
  } as unknown as ExtensionContext;
}

function makeSession(
  state: "allow" | "deny" | "ask" = "allow",
  overrides: Partial<Record<keyof PermissionSession, unknown>> = {},
): PermissionSession {
  return {
    logger: { debug: vi.fn(), review: vi.fn(), warn: vi.fn() },
    activate: vi.fn(),
    resolveAgentName: vi.fn().mockReturnValue(null),
    checkPermission: vi.fn().mockReturnValue({
      state,
      toolName: "skill",
      source: "skill",
      origin: "global",
      matchedPattern: "*",
    }),
    getToolPermission: vi.fn().mockReturnValue("allow" as PermissionState),
    getSessionRuleset: vi.fn().mockReturnValue([]),
    approveSessionRule: vi.fn(),
    getAgentDir: vi.fn().mockReturnValue("/tmp/agent"),
    refreshConfig: vi.fn(),
    canPrompt: vi.fn().mockReturnValue(true),
    prompt: vi.fn().mockResolvedValue({ approved: true, state: "approved" }),
    createPermissionRequestId: vi.fn().mockReturnValue("req-id"),
    ...overrides,
  } as unknown as PermissionSession;
}

function makeToolRegistry(): ToolRegistry {
  return {
    getAll: vi.fn().mockReturnValue([]),
    setActive: vi.fn(),
  };
}

function makeHandler(
  state: "allow" | "deny" | "ask" = "allow",
  sessionOverrides: Partial<Record<keyof PermissionSession, unknown>> = {},
): {
  handler: PermissionGateHandler;
  events: ReturnType<typeof makeEvents>;
} {
  const session = makeSession(state, sessionOverrides);
  const events = makeEvents();
  const handler = new PermissionGateHandler(
    session,
    events,
    makeToolRegistry(),
  );
  return { handler, events };
}

/** Extract all permissions:decision payloads from the events.emit mock. */
function getDecisionEvents(
  events: ReturnType<typeof makeEvents>,
): PermissionDecisionEvent[] {
  return events.emit.mock.calls
    .filter(([channel]) => channel === PERMISSIONS_DECISION_CHANNEL)
    .map(([, payload]) => payload as PermissionDecisionEvent);
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("handleInput decision events — skill gate", () => {
  it("does not emit when input is not a skill invocation", async () => {
    const { handler, events } = makeHandler();
    await handler.handleInput({ text: "hello world" }, makeCtx());
    expect(getDecisionEvents(events)).toHaveLength(0);
  });

  it("emits allow with policy_allow for an allowed skill", async () => {
    const { handler, events } = makeHandler("allow");
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
    const { handler, events } = makeHandler("deny");
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
    const { handler, events } = makeHandler("ask", {
      prompt: vi.fn().mockResolvedValue({ approved: true, state: "approved" }),
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
    const { handler, events } = makeHandler("ask", {
      prompt: vi.fn().mockResolvedValue({ approved: false, state: "denied" }),
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

  it("emits allow with approved_with_custom_pattern when state=ask and user enters a custom pattern", async () => {
    const { handler, events } = makeHandler("ask", {
      prompt: vi.fn().mockResolvedValue({
        approved: true,
        state: "approved_with_custom_pattern",
        customPatternApproval: {
          pattern: "librarian",
          target: "session",
        },
      }),
    });
    await handler.handleInput({ text: "/skill:librarian" }, makeCtx());

    const decisions = getDecisionEvents(events);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      surface: "skill",
      value: "librarian",
      result: "allow",
      resolution: "approved_with_custom_pattern",
    });
  });

  it("records a session rule and refreshes config when a custom skill pattern is persisted", async () => {
    const refreshConfig = vi.fn();
    const approveSessionRule = vi.fn();
    const { handler } = makeHandler("ask", {
      prompt: vi.fn().mockResolvedValue({
        approved: true,
        state: "approved_with_custom_pattern",
        customPatternApproval: {
          pattern: "librarian",
          target: "global",
        },
      }),
      approveSessionRule,
      refreshConfig,
    });
    const ctx = makeCtx();

    await handler.handleInput({ text: "/skill:librarian" }, ctx);

    expect(approveSessionRule).toHaveBeenCalledWith("skill", "librarian");
    expect(refreshConfig).toHaveBeenCalledWith(ctx);
  });

  it("emits deny with confirmation_unavailable when state=ask but no UI", async () => {
    const { handler, events } = makeHandler("ask", {
      canPrompt: vi.fn().mockReturnValue(false),
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
    const { handler, events } = makeHandler("ask", {
      prompt: vi.fn().mockResolvedValue({
        approved: true,
        state: "approved",
        autoApproved: true,
      }),
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
