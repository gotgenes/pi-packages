import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getGlobalConfigPath } from "#src/config/config-paths";
import piPermissionSystemExtension from "#src/index";
import type {
  PermissionDecisionEvent,
  PermissionsReadyEvent,
  PermissionUiPromptEvent,
} from "#src/service/permission-events";
import {
  emitDecisionEvent,
  emitReadyEvent,
  emitUiPromptEvent,
  PERMISSIONS_DECISION_CHANNEL,
  PERMISSIONS_READY_CHANNEL,
  PERMISSIONS_UI_PROMPT_CHANNEL,
} from "#src/service/permission-events";
import { makePromptPayload } from "#test/helpers/prompt-details-fixtures";

// ── Minimal EventBus stub ──────────────────────────────────────────────────

function makeEventBus() {
  return {
    emit: vi.fn(),
    on: vi.fn().mockReturnValue(() => undefined),
  };
}

// ── Constants ──────────────────────────────────────────────────────────────

describe("constants", () => {
  it("channel names have the correct values", () => {
    expect(PERMISSIONS_READY_CHANNEL).toBe("permissions:ready");
    expect(PERMISSIONS_UI_PROMPT_CHANNEL).toBe("permissions:ui_prompt");
    expect(PERMISSIONS_DECISION_CHANNEL).toBe("permissions:decision");
  });
});

// ── emitReadyEvent ─────────────────────────────────────────────────────────

describe("emitReadyEvent", () => {
  const readyFacts: PermissionsReadyEvent = {
    sessionId: "session-abc",
    adjudicatesLocally: true,
  };

  it("emits the emitting node's facts on the permissions:ready channel", () => {
    const bus = makeEventBus();
    emitReadyEvent(bus, readyFacts);
    expect(bus.emit).toHaveBeenCalledOnce();
    expect(bus.emit).toHaveBeenCalledWith("permissions:ready", {
      sessionId: "session-abc",
      adjudicatesLocally: true,
    });
  });

  it("emits a relaying node's facts unchanged", () => {
    const bus = makeEventBus();
    emitReadyEvent(bus, { sessionId: null, adjudicatesLocally: false });
    expect(bus.emit).toHaveBeenCalledWith("permissions:ready", {
      sessionId: null,
      adjudicatesLocally: false,
    });
  });

  it("carries no protocolVersion (the broadcast contract is types + semver)", () => {
    const bus = makeEventBus();
    emitReadyEvent(bus, readyFacts);
    const payload = bus.emit.mock.calls[0][1] as PermissionsReadyEvent;
    expect(payload).not.toHaveProperty("protocolVersion");
  });

  it("swallows event bus errors because broadcasts are best-effort", () => {
    const bus = {
      emit: vi.fn(() => {
        throw new Error("listener failed");
      }),
      on: vi.fn().mockReturnValue(() => undefined),
    };

    expect(() => emitReadyEvent(bus, readyFacts)).not.toThrow();
  });
});

// ── emitUiPromptEvent ──────────────────────────────────────────────────────

describe("emitUiPromptEvent", () => {
  function makeUiPromptEvent(
    overrides: Partial<PermissionUiPromptEvent> = {},
  ): PermissionUiPromptEvent {
    return {
      requestId: "req-123",
      source: "tool_call",
      surface: "bash",
      value: "git status",
      agentName: "Explore",
      request: makePromptPayload().request,
      forwarding: null,
      ...overrides,
    };
  }

  it("emits on the permissions:ui_prompt channel", () => {
    const bus = makeEventBus();
    emitUiPromptEvent(bus, makeUiPromptEvent());
    expect(bus.emit).toHaveBeenCalledOnce();
    expect(bus.emit.mock.calls[0][0]).toBe("permissions:ui_prompt");
  });

  it("forwards the full payload unchanged", () => {
    const bus = makeEventBus();
    const event = makeUiPromptEvent({
      forwarding: { requesterAgentName: "Worker", requesterSessionId: "child" },
    });
    emitUiPromptEvent(bus, event);
    expect(bus.emit.mock.calls[0][1]).toEqual(event);
  });

  it("swallows event bus errors because UI prompt broadcasts are observational", () => {
    const bus = {
      emit: vi.fn(() => {
        throw new Error("listener failed");
      }),
      on: vi.fn().mockReturnValue(() => undefined),
    };

    expect(() => emitUiPromptEvent(bus, makeUiPromptEvent())).not.toThrow();
  });
});

// ── emitDecisionEvent ──────────────────────────────────────────────────────

describe("emitDecisionEvent", () => {
  function makeDecisionEvent(
    overrides: Partial<PermissionDecisionEvent> = {},
  ): PermissionDecisionEvent {
    return {
      requestId: "perm-00000000-0000-4000-8000-000000000000",
      surface: "bash",
      value: "git status",
      result: "allow",
      resolution: "policy_allow",
      origin: "global",
      agentName: null,
      matchedPattern: "*",
      ...overrides,
    };
  }

  it("carries the request id that identifies the decided request", () => {
    const bus = makeEventBus();
    emitDecisionEvent(bus, makeDecisionEvent({ requestId: "perm-abc" }));
    const payload = bus.emit.mock.calls[0][1] as PermissionDecisionEvent;
    expect(payload.requestId).toBe("perm-abc");
  });

  it("emits on the permissions:decision channel", () => {
    const bus = makeEventBus();
    emitDecisionEvent(bus, makeDecisionEvent());
    expect(bus.emit).toHaveBeenCalledOnce();
    expect(bus.emit.mock.calls[0][0]).toBe("permissions:decision");
  });

  it("forwards the full payload unchanged", () => {
    const bus = makeEventBus();
    const event = makeDecisionEvent({
      surface: "mcp",
      value: "exa:search",
      result: "deny",
      resolution: "policy_deny",
      origin: "project",
      agentName: "Worker",
      matchedPattern: "exa:*",
    });
    emitDecisionEvent(bus, event);
    expect(bus.emit.mock.calls[0][1]).toEqual(event);
  });

  it("accepts all defined resolution values", () => {
    const resolutions: PermissionDecisionEvent["resolution"][] = [
      "policy_allow",
      "policy_deny",
      "session_approved",
      "infrastructure_auto_allowed",
      "user_approved",
      "user_approved_for_session",
      "user_denied",
      "auto_approved",
      "confirmation_unavailable",
    ];
    const bus = makeEventBus();
    for (const resolution of resolutions) {
      emitDecisionEvent(bus, makeDecisionEvent({ resolution }));
    }
    expect(bus.emit).toHaveBeenCalledTimes(resolutions.length);
  });

  it("accepts null for optional fields", () => {
    const bus = makeEventBus();
    emitDecisionEvent(
      bus,
      makeDecisionEvent({
        origin: null,
        agentName: null,
        matchedPattern: null,
      }),
    );
    const payload = bus.emit.mock.calls[0][1] as PermissionDecisionEvent;
    expect(payload.origin).toBeNull();
    expect(payload.agentName).toBeNull();
    expect(payload.matchedPattern).toBeNull();
  });

  it("swallows event bus errors because broadcasts are best-effort", () => {
    const bus = {
      emit: vi.fn(() => {
        throw new Error("listener failed");
      }),
      on: vi.fn().mockReturnValue(() => undefined),
    };

    expect(() => emitDecisionEvent(bus, makeDecisionEvent())).not.toThrow();
  });
});

// ── piPermissionSystemExtension emits permissions:ready ────────────────────

describe("piPermissionSystemExtension ready event wiring", () => {
  let baseDir: string;
  let originalAgentDir: string | undefined;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "pi-perm-events-test-"));
    originalAgentDir = process.env.PI_CODING_AGENT_DIR;
    const globalConfigPath = getGlobalConfigPath(baseDir);
    mkdirSync(dirname(globalConfigPath), { recursive: true });
    mkdirSync(join(baseDir, "agents"), { recursive: true });
    writeFileSync(
      globalConfigPath,
      `${JSON.stringify({ permission: { "*": "ask" } })}\n`,
      "utf8",
    );
    process.env.PI_CODING_AGENT_DIR = baseDir;
  });

  afterEach(() => {
    if (originalAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    }
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("emits permissions:ready at session_start", async () => {
    const emitSpy = vi.fn();
    const handlers = new Map<
      string,
      (event: unknown, ctx: unknown) => unknown
    >();
    piPermissionSystemExtension({
      on: vi.fn(
        (event: string, handler: (e: unknown, c: unknown) => unknown) => {
          handlers.set(event, handler);
        },
      ),
      registerCommand: vi.fn(),
      getAllTools: vi.fn().mockReturnValue([]),
      getActiveTools: vi.fn().mockReturnValue([]),
      setActiveTools: vi.fn(),
      registerProvider: vi.fn(),
      events: { emit: emitSpy, on: vi.fn().mockReturnValue(() => undefined) },
    } as never);

    // ready is not emitted at load — only after session_start publishes.
    expect(
      emitSpy.mock.calls.filter(([c]) => c === PERMISSIONS_READY_CHANNEL),
    ).toHaveLength(0);

    const ctx = {
      cwd: baseDir,
      hasUI: false,
      isProjectTrusted: (): boolean => true,
      sessionManager: {
        getEntries: (): unknown[] => [],
        getSessionId: (): string => "top-session",
        getSessionDir: (): string => baseDir,
      },
      ui: {
        notify: (): void => {},
        setStatus: (): void => {},
        select: async (): Promise<string | undefined> => undefined,
        input: async (): Promise<string | undefined> => undefined,
      },
    };
    await handlers.get("session_start")?.({ reason: "start" }, ctx);

    const readyCalls = emitSpy.mock.calls.filter(
      ([channel]) => channel === PERMISSIONS_READY_CHANNEL,
    );
    expect(readyCalls).toHaveLength(1);
    // A headless non-subagent node adjudicates locally (DenyingAuthorizer).
    expect(readyCalls[0][1]).toEqual({
      sessionId: "top-session",
      adjudicatesLocally: true,
    });
  });
});
