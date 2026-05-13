/**
 * Tests that handleToolCall emits permissions:decision events at every
 * gate resolution and fast-path site.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { PermissionGateHandler } from "../../src/handlers/permission-gate-handler";
import type { PermissionDecisionEvent } from "../../src/permission-events";
import { PERMISSIONS_DECISION_CHANNEL } from "../../src/permission-events";
import type { PermissionSession } from "../../src/permission-session";
import type { ToolRegistry } from "../../src/tool-registry";
import type { PermissionCheckResult, PermissionState } from "../../src/types";

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

function makeToolCallEvent(
  toolName: string,
  extraFields: Record<string, unknown> = {},
) {
  return {
    type: "tool_call",
    toolCallId: "tc-1",
    name: toolName,
    input: {},
    ...extraFields,
  };
}

function makeCheckResult(
  state: "allow" | "deny" | "ask",
  overrides: Partial<PermissionCheckResult> = {},
): PermissionCheckResult {
  return {
    state,
    toolName: "read",
    source: "tool",
    origin: "builtin",
    matchedPattern: "*",
    ...overrides,
  };
}

function makeSession(
  overrides: Partial<Record<keyof PermissionSession, unknown>> = {},
): PermissionSession {
  return {
    logger: { debug: vi.fn(), review: vi.fn(), warn: vi.fn() },
    activate: vi.fn(),
    resolveAgentName: vi.fn().mockReturnValue(null),
    checkPermission: vi.fn().mockReturnValue(makeCheckResult("allow")),
    getToolPermission: vi.fn().mockReturnValue("allow" as PermissionState),
    getSessionRuleset: vi.fn().mockReturnValue([]),
    approveSessionRule: vi.fn(),
    getActiveSkillEntries: vi.fn().mockReturnValue([]),
    getInfrastructureDirs: vi
      .fn()
      .mockReturnValue(["/test/agent", "/test/agent/git"]),
    getInfrastructureReadPaths: vi.fn().mockReturnValue([]),
    refreshConfig: vi.fn(),
    canPrompt: vi.fn().mockReturnValue(true),
    prompt: vi.fn().mockResolvedValue({ approved: true, state: "approved" }),
    ...overrides,
  } as unknown as PermissionSession;
}

function makeToolRegistry(overrides: Partial<ToolRegistry> = {}): ToolRegistry {
  return {
    getAll: vi.fn().mockReturnValue([{ name: "read" }, { name: "bash" }]),
    setActive: vi.fn(),
    ...overrides,
  };
}

function makeHandler(overrides?: {
  session?: Partial<Record<keyof PermissionSession, unknown>>;
  toolRegistry?: Partial<ToolRegistry>;
}): {
  handler: PermissionGateHandler;
  events: ReturnType<typeof makeEvents>;
  session: PermissionSession;
} {
  const session = makeSession(overrides?.session);
  const events = makeEvents();
  const toolRegistry = makeToolRegistry(overrides?.toolRegistry);
  const handler = new PermissionGateHandler(session, events, toolRegistry);
  return { handler, events, session };
}

/** Extract all permissions:decision payloads from the events.emit mock. */
function getDecisionEvents(
  events: ReturnType<typeof makeEvents>,
): PermissionDecisionEvent[] {
  return events.emit.mock.calls
    .filter(([channel]) => channel === PERMISSIONS_DECISION_CHANNEL)
    .map(([, payload]) => payload as PermissionDecisionEvent);
}

// ── policy_allow path ──────────────────────────────────────────────────────

describe("handleToolCall decision events — policy_allow", () => {
  it("emits allow with policy_allow when checkPermission returns allow", async () => {
    const { handler, events } = makeHandler({
      session: {
        checkPermission: vi.fn().mockReturnValue(
          makeCheckResult("allow", {
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
          makeCheckResult("deny", {
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
          makeCheckResult("allow", {
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
        checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
        prompt: vi
          .fn()
          .mockResolvedValue({ approved: true, state: "approved" }),
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
        checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
        prompt: vi.fn().mockResolvedValue({
          approved: true,
          state: "approved_for_session",
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
        checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
        prompt: vi.fn().mockResolvedValue({ approved: false, state: "denied" }),
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
        checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
        canPrompt: vi.fn().mockReturnValue(false),
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
        checkPermission: vi.fn().mockReturnValue(makeCheckResult("allow")),
        getInfrastructureDirs: vi.fn().mockReturnValue([infraDir]),
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
        checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
        prompt: vi.fn().mockResolvedValue({
          approved: true,
          state: "approved",
          autoApproved: true,
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
