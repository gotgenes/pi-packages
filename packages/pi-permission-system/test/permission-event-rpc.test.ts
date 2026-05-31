/* eslint-disable @typescript-eslint/no-deprecated -- tests the deprecated RPC channel implementation */
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  type PermissionRpcDeps,
  registerPermissionRpcHandlers,
} from "#src/permission-event-rpc";
import type {
  PermissionsCheckReplyData,
  PermissionsRpcReply,
} from "#src/permission-events";
import {
  PERMISSIONS_PROTOCOL_VERSION,
  PERMISSIONS_RPC_CHECK_CHANNEL,
  PERMISSIONS_RPC_PROMPT_CHANNEL,
  PERMISSIONS_UI_PROMPT_CHANNEL,
} from "#src/permission-events";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeCheckResult(
  state: "allow" | "deny" | "ask",
  overrides: Record<string, unknown> = {},
) {
  return {
    toolName: "bash",
    state,
    matchedPattern: "*",
    source: "bash" as const,
    origin: "global" as const,
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<PermissionRpcDeps> = {},
): PermissionRpcDeps {
  return {
    getPermissionManager: vi.fn().mockReturnValue({
      checkPermission: vi.fn().mockReturnValue(makeCheckResult("allow")),
    }),
    getSessionRules: vi.fn().mockReturnValue([]),
    getRuntimeContext: vi.fn().mockReturnValue(null),
    requestPermissionDecisionFromUi: vi.fn(),
    writeReviewLog: vi.fn(),
    ...overrides,
  };
}

/** Wait for a single event on the bus reply channel. */
function waitForReply<T>(
  bus: ReturnType<typeof createEventBus>,
  channel: string,
): Promise<T> {
  return new Promise((resolve) => {
    const unsub = bus.on(channel, (data) => {
      unsub();
      resolve(data as T);
    });
  });
}

// ── registerPermissionRpcHandlers — check RPC ──────────────────────────────

describe("registerPermissionRpcHandlers — permissions:rpc:check", () => {
  it("returns unsubscribe handles", () => {
    const bus = createEventBus();
    const handles = registerPermissionRpcHandlers(bus, makeDeps());
    expect(typeof handles.unsubCheck).toBe("function");
    expect(typeof handles.unsubPrompt).toBe("function");
  });

  it("replies allow for an allowed surface/value", async () => {
    const bus = createEventBus();
    const deps = makeDeps({
      getPermissionManager: vi.fn().mockReturnValue({
        checkPermission: vi.fn().mockReturnValue(makeCheckResult("allow")),
      }),
    });
    registerPermissionRpcHandlers(bus, deps);

    const replyPromise = waitForReply<
      PermissionsRpcReply<PermissionsCheckReplyData>
    >(bus, `${PERMISSIONS_RPC_CHECK_CHANNEL}:reply:req-allow`);
    bus.emit(PERMISSIONS_RPC_CHECK_CHANNEL, {
      requestId: "req-allow",
      surface: "bash",
      value: "git status",
    });

    const reply = await replyPromise;
    expect(reply.success).toBe(true);
    expect(reply.protocolVersion).toBe(PERMISSIONS_PROTOCOL_VERSION);
    if (reply.success) {
      expect(reply.data?.result).toBe("allow");
      expect(reply.data?.origin).toBe("global");
    }
  });

  it("replies deny for a denied surface/value", async () => {
    const bus = createEventBus();
    const deps = makeDeps({
      getPermissionManager: vi.fn().mockReturnValue({
        checkPermission: vi.fn().mockReturnValue(
          makeCheckResult("deny", {
            origin: "project",
            matchedPattern: "rm *",
          }),
        ),
      }),
    });
    registerPermissionRpcHandlers(bus, deps);

    const replyPromise = waitForReply<
      PermissionsRpcReply<PermissionsCheckReplyData>
    >(bus, `${PERMISSIONS_RPC_CHECK_CHANNEL}:reply:req-deny`);
    bus.emit(PERMISSIONS_RPC_CHECK_CHANNEL, {
      requestId: "req-deny",
      surface: "bash",
      value: "rm -rf /tmp",
    });

    const reply = await replyPromise;
    expect(reply.success).toBe(true);
    if (reply.success) {
      expect(reply.data?.result).toBe("deny");
      expect(reply.data?.matchedPattern).toBe("rm *");
    }
  });

  it("replies ask for an ask surface/value", async () => {
    const bus = createEventBus();
    const deps = makeDeps({
      getPermissionManager: vi.fn().mockReturnValue({
        checkPermission: vi
          .fn()
          .mockReturnValue(
            makeCheckResult("ask", { matchedPattern: undefined }),
          ),
      }),
    });
    registerPermissionRpcHandlers(bus, deps);

    const replyPromise = waitForReply<
      PermissionsRpcReply<PermissionsCheckReplyData>
    >(bus, `${PERMISSIONS_RPC_CHECK_CHANNEL}:reply:req-ask`);
    bus.emit(PERMISSIONS_RPC_CHECK_CHANNEL, {
      requestId: "req-ask",
      surface: "mcp",
      value: "exa:search",
    });

    const reply = await replyPromise;
    expect(reply.success).toBe(true);
    if (reply.success) {
      expect(reply.data?.result).toBe("ask");
    }
  });

  it("passes agentName to checkPermission when provided", async () => {
    const checkPermission = vi.fn().mockReturnValue(makeCheckResult("allow"));
    const bus = createEventBus();
    const deps = makeDeps({
      getPermissionManager: vi.fn().mockReturnValue({ checkPermission }),
    });
    registerPermissionRpcHandlers(bus, deps);

    const replyPromise = waitForReply(
      bus,
      `${PERMISSIONS_RPC_CHECK_CHANNEL}:reply:req-agent`,
    );
    bus.emit(PERMISSIONS_RPC_CHECK_CHANNEL, {
      requestId: "req-agent",
      surface: "bash",
      value: "git push",
      agentName: "Worker",
    });
    await replyPromise;

    expect(checkPermission).toHaveBeenCalledWith(
      "bash",
      expect.anything(),
      "Worker",
      expect.anything(),
    );
  });

  it("includes session rules in the check", async () => {
    const sessionRules = [
      {
        surface: "bash",
        pattern: "git *",
        action: "allow" as const,
        origin: "session" as const,
      },
    ];
    const checkPermission = vi.fn().mockReturnValue(makeCheckResult("allow"));
    const bus = createEventBus();
    const deps = makeDeps({
      getPermissionManager: vi.fn().mockReturnValue({ checkPermission }),
      getSessionRules: vi.fn().mockReturnValue(sessionRules),
    });
    registerPermissionRpcHandlers(bus, deps);

    const replyPromise = waitForReply(
      bus,
      `${PERMISSIONS_RPC_CHECK_CHANNEL}:reply:req-session`,
    );
    bus.emit(PERMISSIONS_RPC_CHECK_CHANNEL, {
      requestId: "req-session",
      surface: "bash",
      value: "git status",
    });
    await replyPromise;

    expect(checkPermission).toHaveBeenCalledWith(
      "bash",
      expect.anything(),
      undefined,
      sessionRules,
    );
  });

  it("replies with error envelope when requestId is missing", async () => {
    const bus = createEventBus();
    registerPermissionRpcHandlers(bus, makeDeps());

    // No reply channel to wait on — emit without requestId and confirm
    // no throw / crash. We check indirectly via a timeout-free approach:
    // emit an immediately-followable good request and ensure both succeed.
    const replyPromise = waitForReply<PermissionsRpcReply>(
      bus,
      `${PERMISSIONS_RPC_CHECK_CHANNEL}:reply:req-good`,
    );
    bus.emit(PERMISSIONS_RPC_CHECK_CHANNEL, {}); // missing requestId — should not crash
    bus.emit(PERMISSIONS_RPC_CHECK_CHANNEL, {
      requestId: "req-good",
      surface: "bash",
    });

    const reply = await replyPromise;
    expect(reply.success).toBe(true); // good request still handled
  });

  it("unsubCheck stops the handler from firing", async () => {
    const checkPermission = vi.fn().mockReturnValue(makeCheckResult("allow"));
    const bus = createEventBus();
    const deps = makeDeps({
      getPermissionManager: vi.fn().mockReturnValue({ checkPermission }),
    });
    const handles = registerPermissionRpcHandlers(bus, deps);
    handles.unsubCheck();

    bus.emit(PERMISSIONS_RPC_CHECK_CHANNEL, {
      requestId: "req-unsub",
      surface: "bash",
    });

    // Give async handlers a chance to fire
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(checkPermission).not.toHaveBeenCalled();
  });
});

// ── registerPermissionRpcHandlers — prompt RPC ──────────────────────────

describe("registerPermissionRpcHandlers — permissions:rpc:prompt", () => {
  function makeUi() {
    return {
      select: vi.fn(),
      input: vi.fn(),
      notify: vi.fn(),
      setStatus: vi.fn(),
    };
  }

  function makeCtxWithUi() {
    return {
      hasUI: true,
      ui: makeUi(),
      cwd: "/test/project",
      sessionManager: {
        getSessionDir: vi.fn().mockReturnValue("/sessions/test"),
      },
    };
  }

  it("replies with approval when user approves", async () => {
    const bus = createEventBus();
    const ctx = makeCtxWithUi();
    const approvedDecision = { approved: true, state: "approved" as const };
    const deps = makeDeps({
      getRuntimeContext: vi.fn().mockReturnValue(ctx),
      requestPermissionDecisionFromUi: vi
        .fn()
        .mockResolvedValue(approvedDecision),
    });
    registerPermissionRpcHandlers(bus, deps);

    const replyPromise = waitForReply<
      PermissionsRpcReply<
        import("../src/permission-events").PermissionsPromptReplyData
      >
    >(bus, `${PERMISSIONS_RPC_PROMPT_CHANNEL}:reply:req-prompt-1`);
    bus.emit(PERMISSIONS_RPC_PROMPT_CHANNEL, {
      requestId: "req-prompt-1",
      surface: "bash",
      value: "rm -rf /tmp",
      message: "Allow rm -rf /tmp?",
    });

    const reply = await replyPromise;
    expect(reply.success).toBe(true);
    expect(reply.protocolVersion).toBe(PERMISSIONS_PROTOCOL_VERSION);
    if (reply.success) {
      expect(reply.data?.approved).toBe(true);
      expect(reply.data?.state).toBe("approved");
    }
  });

  it("emits a UI prompt broadcast before awaiting the UI decision", async () => {
    const bus = createEventBus();
    const ctx = makeCtxWithUi();
    const requestUi = vi
      .fn()
      .mockResolvedValue({ approved: true, state: "approved" as const });
    const deps = makeDeps({
      getRuntimeContext: vi.fn().mockReturnValue(ctx),
      requestPermissionDecisionFromUi: requestUi,
    });
    registerPermissionRpcHandlers(bus, deps);

    const promptPromise = waitForReply(bus, PERMISSIONS_UI_PROMPT_CHANNEL);
    const replyPromise = waitForReply(
      bus,
      `${PERMISSIONS_RPC_PROMPT_CHANNEL}:reply:req-prompt-broadcast`,
    );
    bus.emit(PERMISSIONS_RPC_PROMPT_CHANNEL, {
      requestId: "req-prompt-broadcast",
      surface: "bash",
      value: "git push",
      message: "Allow git push?",
      agentName: "Worker",
      sessionLabel: "Allow git *",
    });

    await expect(promptPromise).resolves.toEqual({
      protocolVersion: PERMISSIONS_PROTOCOL_VERSION,
      requestId: "req-prompt-broadcast",
      source: "rpc_prompt",
      surface: "bash",
      value: "git push",
      agentName: "Worker",
      message: "Allow git push?",
      toolCallId: null,
      toolName: null,
      skillName: null,
      path: null,
      command: null,
      target: "git push",
      toolInputPreview: null,
      sessionLabel: "Allow git *",
    });
    await replyPromise;
  });

  it("passes the message to requestPermissionDecisionFromUi", async () => {
    const bus = createEventBus();
    const ctx = makeCtxWithUi();
    const requestUi = vi
      .fn()
      .mockResolvedValue({ approved: true, state: "approved" as const });
    const deps = makeDeps({
      getRuntimeContext: vi.fn().mockReturnValue(ctx),
      requestPermissionDecisionFromUi: requestUi,
    });
    registerPermissionRpcHandlers(bus, deps);

    const replyPromise = waitForReply(
      bus,
      `${PERMISSIONS_RPC_PROMPT_CHANNEL}:reply:req-prompt-2`,
    );
    bus.emit(PERMISSIONS_RPC_PROMPT_CHANNEL, {
      requestId: "req-prompt-2",
      surface: "bash",
      value: "git push",
      message: "Allow git push?",
      agentName: "Worker",
      sessionLabel: "Allow git *",
    });
    await replyPromise;

    expect(requestUi).toHaveBeenCalledWith(
      ctx.ui,
      expect.stringContaining("Worker"),
      "Allow git push?",
      { sessionLabel: "Allow git *" },
    );
  });

  it("replies with denied when user denies", async () => {
    const bus = createEventBus();
    const ctx = makeCtxWithUi();
    const deniedDecision = {
      approved: false,
      state: "denied_with_reason" as const,
      denialReason: "Too risky",
    };
    const deps = makeDeps({
      getRuntimeContext: vi.fn().mockReturnValue(ctx),
      requestPermissionDecisionFromUi: vi
        .fn()
        .mockResolvedValue(deniedDecision),
    });
    registerPermissionRpcHandlers(bus, deps);

    const replyPromise = waitForReply<
      PermissionsRpcReply<
        import("../src/permission-events").PermissionsPromptReplyData
      >
    >(bus, `${PERMISSIONS_RPC_PROMPT_CHANNEL}:reply:req-denied`);
    bus.emit(PERMISSIONS_RPC_PROMPT_CHANNEL, {
      requestId: "req-denied",
      surface: "bash",
      value: "rm -rf /",
      message: "Allow rm -rf /?",
    });

    const reply = await replyPromise;
    expect(reply.success).toBe(true);
    if (reply.success) {
      expect(reply.data?.approved).toBe(false);
      expect(reply.data?.state).toBe("denied_with_reason");
      expect(reply.data?.denialReason).toBe("Too risky");
    }
  });

  it("replies with no_ui error when context has no UI", async () => {
    const bus = createEventBus();
    const deps = makeDeps({
      getRuntimeContext: vi.fn().mockReturnValue(null),
    });
    registerPermissionRpcHandlers(bus, deps);

    const replyPromise = waitForReply<PermissionsRpcReply>(
      bus,
      `${PERMISSIONS_RPC_PROMPT_CHANNEL}:reply:req-no-ui`,
    );
    bus.emit(PERMISSIONS_RPC_PROMPT_CHANNEL, {
      requestId: "req-no-ui",
      surface: "bash",
      value: "git push",
      message: "Allow git push?",
    });

    const reply = await replyPromise;
    expect(reply.success).toBe(false);
    expect((reply as { success: false; error: string }).error).toBe("no_ui");
  });

  it("replies with no_ui error when context hasUI is false", async () => {
    const bus = createEventBus();
    const deps = makeDeps({
      getRuntimeContext: vi
        .fn()
        .mockReturnValue({ hasUI: false, ui: makeUi() }),
    });
    registerPermissionRpcHandlers(bus, deps);

    const replyPromise = waitForReply<PermissionsRpcReply>(
      bus,
      `${PERMISSIONS_RPC_PROMPT_CHANNEL}:reply:req-headless`,
    );
    bus.emit(PERMISSIONS_RPC_PROMPT_CHANNEL, {
      requestId: "req-headless",
      surface: "bash",
      value: "git push",
      message: "Allow git push?",
    });

    const reply = await replyPromise;
    expect(reply.success).toBe(false);
    expect((reply as { success: false; error: string }).error).toBe("no_ui");
  });

  it("writes to the review log after a prompt decision", async () => {
    const bus = createEventBus();
    const ctx = makeCtxWithUi();
    const writeReviewLog = vi.fn();
    const deps = makeDeps({
      getRuntimeContext: vi.fn().mockReturnValue(ctx),
      requestPermissionDecisionFromUi: vi
        .fn()
        .mockResolvedValue({ approved: true, state: "approved" as const }),
      writeReviewLog,
    });
    registerPermissionRpcHandlers(bus, deps);

    const replyPromise = waitForReply(
      bus,
      `${PERMISSIONS_RPC_PROMPT_CHANNEL}:reply:req-log`,
    );
    bus.emit(PERMISSIONS_RPC_PROMPT_CHANNEL, {
      requestId: "req-log",
      surface: "bash",
      value: "git push",
      message: "Allow git push?",
      agentName: "Worker",
    });
    await replyPromise;

    expect(writeReviewLog).toHaveBeenCalledWith(
      "permission_request.rpc_prompt",
      expect.objectContaining({
        requestId: "req-log",
        surface: "bash",
        value: "git push",
        agentName: "Worker",
        approved: true,
      }),
    );
  });

  it("unsubPrompt stops the handler from firing", async () => {
    const requestUi = vi
      .fn()
      .mockResolvedValue({ approved: true, state: "approved" as const });
    const bus = createEventBus();
    const ctx = makeCtxWithUi();
    const deps = makeDeps({
      getRuntimeContext: vi.fn().mockReturnValue(ctx),
      requestPermissionDecisionFromUi: requestUi,
    });
    const handles = registerPermissionRpcHandlers(bus, deps);
    handles.unsubPrompt();

    bus.emit(PERMISSIONS_RPC_PROMPT_CHANNEL, {
      requestId: "req-unsub-prompt",
      surface: "bash",
      value: "git push",
      message: "Allow?",
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(requestUi).not.toHaveBeenCalled();
  });
});
