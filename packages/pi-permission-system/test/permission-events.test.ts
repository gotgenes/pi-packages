/* eslint-disable @typescript-eslint/no-deprecated -- tests the deprecated RPC channel implementation */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getGlobalConfigPath } from "#src/config-paths";
import piPermissionSystemExtension from "#src/index";
import type {
  PermissionDecisionEvent,
  PermissionUiPromptEvent,
  PermissionsCheckReplyData,
  PermissionsCheckRequest,
  PermissionsPromptReplyData,
  PermissionsPromptRequest,
  PermissionsReadyEvent,
  PermissionsRpcReply,
} from "#src/permission-events";
import {
  emitDecisionEvent,
  emitReadyEvent,
  emitUiPromptEvent,
  PERMISSIONS_DECISION_CHANNEL,
  PERMISSIONS_PROTOCOL_VERSION,
  PERMISSIONS_READY_CHANNEL,
  PERMISSIONS_RPC_CHECK_CHANNEL,
  PERMISSIONS_RPC_PROMPT_CHANNEL,
  PERMISSIONS_UI_PROMPT_CHANNEL,
} from "#src/permission-events";

// ── Minimal EventBus stub ──────────────────────────────────────────────────

function makeEventBus() {
  return {
    emit: vi.fn(),
    on: vi.fn().mockReturnValue(() => undefined),
  };
}

// ── Constants ──────────────────────────────────────────────────────────────

describe("constants", () => {
  it("PERMISSIONS_PROTOCOL_VERSION is 1", () => {
    expect(PERMISSIONS_PROTOCOL_VERSION).toBe(1);
  });

  it("channel names have the correct values", () => {
    expect(PERMISSIONS_READY_CHANNEL).toBe("permissions:ready");
    expect(PERMISSIONS_UI_PROMPT_CHANNEL).toBe("permissions:ui_prompt");
    expect(PERMISSIONS_DECISION_CHANNEL).toBe("permissions:decision");
    expect(PERMISSIONS_RPC_CHECK_CHANNEL).toBe("permissions:rpc:check");
    expect(PERMISSIONS_RPC_PROMPT_CHANNEL).toBe("permissions:rpc:prompt");
  });
});

// ── emitReadyEvent ─────────────────────────────────────────────────────────

describe("emitReadyEvent", () => {
  it("emits on the permissions:ready channel with protocol version", () => {
    const bus = makeEventBus();
    emitReadyEvent(bus);
    expect(bus.emit).toHaveBeenCalledOnce();
    expect(bus.emit).toHaveBeenCalledWith("permissions:ready", {
      protocolVersion: 1,
    });
  });

  it("emitted payload satisfies PermissionsReadyEvent shape", () => {
    const bus = makeEventBus();
    emitReadyEvent(bus);
    const payload = bus.emit.mock.calls[0][1] as PermissionsReadyEvent;
    expect(typeof payload.protocolVersion).toBe("number");
  });
});

// ── emitUiPromptEvent ──────────────────────────────────────────────────────

describe("emitUiPromptEvent", () => {
  function makeUiPromptEvent(
    overrides: Partial<PermissionUiPromptEvent> = {},
  ): PermissionUiPromptEvent {
    return {
      protocolVersion: PERMISSIONS_PROTOCOL_VERSION,
      requestId: "req-123",
      source: "tool_call",
      surface: "bash",
      value: "git status",
      agentName: "Explore",
      message: "Allow git status?",
      toolCallId: "call-123",
      toolName: "bash",
      skillName: null,
      path: null,
      command: "git status",
      target: null,
      toolInputPreview: null,
      sessionLabel: null,
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
    const event = makeUiPromptEvent({ sessionLabel: "Allow for session" });
    emitUiPromptEvent(bus, event);
    expect(bus.emit.mock.calls[0][1]).toEqual(event);
  });

  it("includes the protocol version in UI prompt events", () => {
    const bus = makeEventBus();
    emitUiPromptEvent(bus, makeUiPromptEvent());
    const payload = bus.emit.mock.calls[0][1] as PermissionUiPromptEvent;
    expect(payload.protocolVersion).toBe(PERMISSIONS_PROTOCOL_VERSION);
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
});

// ── Type-shape compile-time checks (runtime assertions on literal values) ──

describe("type shapes (PermissionsRpcReply)", () => {
  it("success reply has success=true and protocolVersion", () => {
    const reply: PermissionsRpcReply<{ result: "allow" }> = {
      success: true,
      protocolVersion: PERMISSIONS_PROTOCOL_VERSION,
      data: { result: "allow" },
    };
    expect(reply.success).toBe(true);
    expect(reply.protocolVersion).toBe(1);
  });

  it("error reply has success=false and error string", () => {
    const reply: PermissionsRpcReply = {
      success: false,
      protocolVersion: PERMISSIONS_PROTOCOL_VERSION,
      error: "no_ui",
    };
    expect(reply.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- narrowing on discriminated union
    if (!reply.success) {
      expect(reply.error).toBe("no_ui");
    }
  });
});

describe("type shapes (PermissionsCheckRequest)", () => {
  it("minimal request requires requestId and surface", () => {
    const req: PermissionsCheckRequest = {
      requestId: "abc-123",
      surface: "bash",
    };
    expect(req.requestId).toBe("abc-123");
    expect(req.surface).toBe("bash");
  });

  it("optional fields are accepted", () => {
    const req: PermissionsCheckRequest = {
      requestId: "abc-123",
      surface: "bash",
      value: "git status",
      agentName: "Worker",
    };
    expect(req.value).toBe("git status");
    expect(req.agentName).toBe("Worker");
  });
});

describe("type shapes (PermissionsCheckReplyData)", () => {
  it("has result, matchedPattern, origin", () => {
    const data: PermissionsCheckReplyData = {
      result: "ask",
      matchedPattern: null,
      origin: "builtin",
    };
    expect(data.result).toBe("ask");
  });
});

describe("type shapes (PermissionsPromptRequest)", () => {
  it("minimal request requires requestId, surface, value, message", () => {
    const req: PermissionsPromptRequest = {
      requestId: "def-456",
      surface: "bash",
      value: "rm -rf /tmp",
      message: "Allow rm -rf /tmp?",
    };
    expect(req.requestId).toBe("def-456");
  });

  it("optional agentName and sessionLabel are accepted", () => {
    const req: PermissionsPromptRequest = {
      requestId: "def-456",
      surface: "bash",
      value: "rm -rf /tmp",
      message: "Allow rm -rf /tmp?",
      agentName: "Explore",
      sessionLabel: "Allow rm *",
    };
    expect(req.agentName).toBe("Explore");
    expect(req.sessionLabel).toBe("Allow rm *");
  });
});

describe("type shapes (PermissionsPromptReplyData)", () => {
  it("approved reply has approved=true and state", () => {
    const data: PermissionsPromptReplyData = {
      approved: true,
      state: "approved_for_session",
    };
    expect(data.approved).toBe(true);
    expect(data.state).toBe("approved_for_session");
  });

  it("denied reply may include denialReason", () => {
    const data: PermissionsPromptReplyData = {
      approved: false,
      state: "denied_with_reason",
      denialReason: "Too risky",
    };
    expect(data.denialReason).toBe("Too risky");
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

  it("emits permissions:ready with protocolVersion at session_start", async () => {
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
    expect(readyCalls[0][1]).toEqual({
      protocolVersion: PERMISSIONS_PROTOCOL_VERSION,
    });
  });
});
