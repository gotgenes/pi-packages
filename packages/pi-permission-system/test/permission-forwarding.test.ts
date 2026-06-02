import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  confirmPermission,
  processForwardedPermissionRequests,
} from "#src/forwarded-permissions/polling";
import {
  createPermissionForwardingLocation,
  resolvePermissionForwardingTargetSessionId,
  SUBAGENT_PARENT_SESSION_ENV_CANDIDATES,
  SUBAGENT_PARENT_SESSION_ENV_KEY,
} from "#src/permission-forwarding";
import { SubagentSessionRegistry } from "#src/subagent-registry";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SUBAGENT_PARENT_SESSION_ENV_CANDIDATES", () => {
  test("is an array containing PI_AGENT_ROUTER_PARENT_SESSION_ID", () => {
    expect(Array.isArray(SUBAGENT_PARENT_SESSION_ENV_CANDIDATES)).toBe(true);
    expect(SUBAGENT_PARENT_SESSION_ENV_CANDIDATES).toContain(
      "PI_AGENT_ROUTER_PARENT_SESSION_ID",
    );
  });

  test("contains PI_SUBAGENT_PARENT_SESSION for CLI-based subagent extensions", () => {
    expect(SUBAGENT_PARENT_SESSION_ENV_CANDIDATES).toContain(
      "PI_SUBAGENT_PARENT_SESSION",
    );
  });

  test("deprecated SUBAGENT_PARENT_SESSION_ENV_KEY equals the first candidate", () => {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- test verifying the deprecated alias
    expect(SUBAGENT_PARENT_SESSION_ENV_KEY).toBe(
      SUBAGENT_PARENT_SESSION_ENV_CANDIDATES[0],
    );
  });
});

describe("resolvePermissionForwardingTargetSessionId", () => {
  test("hasUI=true returns the current session ID (UI host owns forwarding)", () => {
    expect(
      resolvePermissionForwardingTargetSessionId({
        hasUI: true,
        isSubagent: false,
        currentSessionId: "parent-session-abc",
        env: {},
      }),
    ).toBe("parent-session-abc");
  });

  test("hasUI=true with isSubagent=true still returns current session ID", () => {
    expect(
      resolvePermissionForwardingTargetSessionId({
        hasUI: true,
        isSubagent: true,
        currentSessionId: "session-xyz",
        env: { PI_AGENT_ROUTER_PARENT_SESSION_ID: "other" },
      }),
    ).toBe("session-xyz");
  });

  test("hasUI=false, isSubagent=false returns null", () => {
    expect(
      resolvePermissionForwardingTargetSessionId({
        hasUI: false,
        isSubagent: false,
        currentSessionId: "session-xyz",
        env: { PI_AGENT_ROUTER_PARENT_SESSION_ID: "parent-session-abc" },
      }),
    ).toBeNull();
  });

  test("isSubagent=true, no candidates set returns null", () => {
    expect(
      resolvePermissionForwardingTargetSessionId({
        hasUI: false,
        isSubagent: true,
        currentSessionId: "session-xyz",
        env: {},
      }),
    ).toBeNull();
  });

  test("isSubagent=true, PI_AGENT_ROUTER_PARENT_SESSION_ID set returns its value", () => {
    expect(
      resolvePermissionForwardingTargetSessionId({
        hasUI: false,
        isSubagent: true,
        currentSessionId: "session-xyz",
        env: { PI_AGENT_ROUTER_PARENT_SESSION_ID: "parent-session-abc" },
      }),
    ).toBe("parent-session-abc");
  });

  test("isSubagent=true, PI_SUBAGENT_PARENT_SESSION resolves when PI_AGENT_ROUTER_PARENT_SESSION_ID is absent", () => {
    expect(
      resolvePermissionForwardingTargetSessionId({
        hasUI: false,
        isSubagent: true,
        currentSessionId: "session-xyz",
        env: {
          PI_SUBAGENT_PARENT_SESSION: "parent-from-convention",
        },
      }),
    ).toBe("parent-from-convention");
  });

  test("isSubagent=true, PI_AGENT_ROUTER_PARENT_SESSION_ID takes precedence over PI_SUBAGENT_PARENT_SESSION", () => {
    expect(
      resolvePermissionForwardingTargetSessionId({
        hasUI: false,
        isSubagent: true,
        currentSessionId: "session-xyz",
        env: {
          PI_AGENT_ROUTER_PARENT_SESSION_ID: "parent-from-router",
          PI_SUBAGENT_PARENT_SESSION: "parent-from-convention",
        },
      }),
    ).toBe("parent-from-router");
  });

  test("isSubagent=true, candidate value is empty string returns null", () => {
    expect(
      resolvePermissionForwardingTargetSessionId({
        hasUI: false,
        isSubagent: true,
        currentSessionId: "session-xyz",
        env: { PI_AGENT_ROUTER_PARENT_SESSION_ID: "" },
      }),
    ).toBeNull();
  });

  test("isSubagent=true, candidate value is 'unknown' returns null", () => {
    expect(
      resolvePermissionForwardingTargetSessionId({
        hasUI: false,
        isSubagent: true,
        currentSessionId: "session-xyz",
        env: { PI_AGENT_ROUTER_PARENT_SESSION_ID: "unknown" },
      }),
    ).toBeNull();
  });

  test("env defaults to process.env when omitted", () => {
    vi.stubEnv("PI_AGENT_ROUTER_PARENT_SESSION_ID", "env-session-abc");
    expect(
      resolvePermissionForwardingTargetSessionId({
        hasUI: false,
        isSubagent: true,
      }),
    ).toBe("env-session-abc");
  });
});

describe("resolvePermissionForwardingTargetSessionId — registry resolution", () => {
  const childSessionId = "child-session-abc";

  test("returns parentSessionId from registry when env vars are absent", () => {
    const registry = new SubagentSessionRegistry();
    registry.register(childSessionId, {
      parentSessionId: "parent-from-registry",
    });

    expect(
      resolvePermissionForwardingTargetSessionId({
        hasUI: false,
        isSubagent: true,
        sessionId: childSessionId,
        registry,
        env: {},
      }),
    ).toBe("parent-from-registry");
  });

  test("registry takes priority over env vars", () => {
    const registry = new SubagentSessionRegistry();
    registry.register(childSessionId, {
      parentSessionId: "parent-from-registry",
    });

    expect(
      resolvePermissionForwardingTargetSessionId({
        hasUI: false,
        isSubagent: true,
        sessionId: childSessionId,
        registry,
        env: { PI_AGENT_ROUTER_PARENT_SESSION_ID: "parent-from-env" },
      }),
    ).toBe("parent-from-registry");
  });

  test("falls through to env vars when registry entry has no parentSessionId", () => {
    const registry = new SubagentSessionRegistry();
    registry.register(childSessionId, {}); // no parentSessionId

    expect(
      resolvePermissionForwardingTargetSessionId({
        hasUI: false,
        isSubagent: true,
        sessionId: childSessionId,
        registry,
        env: { PI_AGENT_ROUTER_PARENT_SESSION_ID: "parent-from-env" },
      }),
    ).toBe("parent-from-env");
  });

  test("falls through to env vars when sessionId is not in registry", () => {
    const registry = new SubagentSessionRegistry(); // empty

    expect(
      resolvePermissionForwardingTargetSessionId({
        hasUI: false,
        isSubagent: true,
        sessionId: childSessionId,
        registry,
        env: { PI_AGENT_ROUTER_PARENT_SESSION_ID: "parent-from-env" },
      }),
    ).toBe("parent-from-env");
  });

  test("returns null when registry entry has no parentSessionId and no env vars set", () => {
    const registry = new SubagentSessionRegistry();
    registry.register(childSessionId, {}); // no parentSessionId

    expect(
      resolvePermissionForwardingTargetSessionId({
        hasUI: false,
        isSubagent: true,
        sessionId: childSessionId,
        registry,
        env: {},
      }),
    ).toBeNull();
  });

  test("omitting registry preserves existing behaviour", () => {
    expect(
      resolvePermissionForwardingTargetSessionId({
        hasUI: false,
        isSubagent: true,
        sessionId: childSessionId,
        env: { PI_AGENT_ROUTER_PARENT_SESSION_ID: "parent-from-env" },
      }),
    ).toBe("parent-from-env");
  });
});

describe("processForwardedPermissionRequests", () => {
  test("emits a UI prompt event before showing a forwarded permission dialog", async () => {
    const root = mkdtempSync(join(tmpdir(), "permission-forwarding-"));
    try {
      const forwardingDir = join(root, "forwarding");
      const location = createPermissionForwardingLocation(
        forwardingDir,
        "parent-session",
      );
      mkdirSync(location.requestsDir, { recursive: true });
      mkdirSync(location.responsesDir, { recursive: true });
      writeFileSync(
        join(location.requestsDir, "req-forwarded.json"),
        JSON.stringify({
          id: "req-forwarded",
          createdAt: Date.now(),
          requesterSessionId: "child-session",
          targetSessionId: "parent-session",
          requesterAgentName: "Explore",
          message: "Allow git push?",
        }),
        "utf-8",
      );

      const events = {
        emit: vi.fn(),
        on: vi.fn().mockReturnValue(() => undefined),
      };
      const requestPermissionDecisionFromUi = vi
        .fn()
        .mockResolvedValue({ approved: true, state: "approved" as const });

      await processForwardedPermissionRequests(
        {
          hasUI: true,
          ui: { select: vi.fn(), input: vi.fn() },
          sessionManager: {
            getSessionId: vi.fn().mockReturnValue("parent-session"),
          },
        } as unknown as ExtensionContext,
        {
          forwardingDir,
          subagentSessionsDir: join(root, "subagents"),
          events,
          logger: { writeReviewLog: vi.fn(), writeDebugLog: vi.fn() },
          writeReviewLog: vi.fn(),
          requestPermissionDecisionFromUi,
          shouldAutoApprove: () => false,
        },
      );

      expect(events.emit).toHaveBeenCalledWith(
        "permissions:ui_prompt",
        expect.objectContaining({
          requestId: "req-forwarded",
          source: "tool_call",
          surface: null,
          value: null,
          agentName: "Explore",
          message: expect.stringContaining("Allow git push?"),
          forwarding: {
            requesterAgentName: "Explore",
            requesterSessionId: "child-session",
          },
        }),
      );
      expect(requestPermissionDecisionFromUi).toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("emits a non-degraded UI prompt event when the request carries display fields", async () => {
    const root = mkdtempSync(join(tmpdir(), "permission-forwarding-"));
    try {
      const forwardingDir = join(root, "forwarding");
      const location = createPermissionForwardingLocation(
        forwardingDir,
        "parent-session",
      );
      mkdirSync(location.requestsDir, { recursive: true });
      mkdirSync(location.responsesDir, { recursive: true });
      writeFileSync(
        join(location.requestsDir, "req-forwarded-rich.json"),
        JSON.stringify({
          id: "req-forwarded-rich",
          createdAt: Date.now(),
          requesterSessionId: "child-session",
          targetSessionId: "parent-session",
          requesterAgentName: "Explore",
          message: "Allow git push?",
          source: "tool_call",
          surface: "bash",
          value: "git push",
        }),
        "utf-8",
      );

      const events = {
        emit: vi.fn(),
        on: vi.fn().mockReturnValue(() => undefined),
      };
      const requestPermissionDecisionFromUi = vi
        .fn()
        .mockResolvedValue({ approved: true, state: "approved" as const });

      await processForwardedPermissionRequests(
        {
          hasUI: true,
          ui: { select: vi.fn(), input: vi.fn() },
          sessionManager: {
            getSessionId: vi.fn().mockReturnValue("parent-session"),
          },
        } as unknown as ExtensionContext,
        {
          forwardingDir,
          subagentSessionsDir: join(root, "subagents"),
          events,
          logger: { writeReviewLog: vi.fn(), writeDebugLog: vi.fn() },
          writeReviewLog: vi.fn(),
          requestPermissionDecisionFromUi,
          shouldAutoApprove: () => false,
        },
      );

      expect(events.emit).toHaveBeenCalledWith(
        "permissions:ui_prompt",
        expect.objectContaining({
          requestId: "req-forwarded-rich",
          source: "tool_call",
          surface: "bash",
          value: "git push",
          agentName: "Explore",
          message: expect.stringContaining("Allow git push?"),
          forwarding: {
            requesterAgentName: "Explore",
            requesterSessionId: "child-session",
          },
        }),
      );
      expect(requestPermissionDecisionFromUi).toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("does not emit a UI prompt event when forwarded permission auto-approves", async () => {
    const root = mkdtempSync(join(tmpdir(), "permission-forwarding-"));
    try {
      const forwardingDir = join(root, "forwarding");
      const location = createPermissionForwardingLocation(
        forwardingDir,
        "parent-session",
      );
      mkdirSync(location.requestsDir, { recursive: true });
      mkdirSync(location.responsesDir, { recursive: true });
      writeFileSync(
        join(location.requestsDir, "req-forwarded-auto.json"),
        JSON.stringify({
          id: "req-forwarded-auto",
          createdAt: Date.now(),
          requesterSessionId: "child-session",
          targetSessionId: "parent-session",
          requesterAgentName: "Explore",
          message: "Allow git push?",
        }),
        "utf-8",
      );

      const events = {
        emit: vi.fn(),
        on: vi.fn().mockReturnValue(() => undefined),
      };
      const requestPermissionDecisionFromUi = vi.fn();

      await processForwardedPermissionRequests(
        {
          hasUI: true,
          ui: { select: vi.fn(), input: vi.fn() },
          sessionManager: {
            getSessionId: vi.fn().mockReturnValue("parent-session"),
          },
        } as unknown as ExtensionContext,
        {
          forwardingDir,
          subagentSessionsDir: join(root, "subagents"),
          events,
          logger: { writeReviewLog: vi.fn(), writeDebugLog: vi.fn() },
          writeReviewLog: vi.fn(),
          requestPermissionDecisionFromUi,
          shouldAutoApprove: () => true,
        },
      );

      expect(events.emit).not.toHaveBeenCalledWith(
        "permissions:ui_prompt",
        expect.anything(),
      );
      expect(requestPermissionDecisionFromUi).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("confirmPermission", () => {
  test("shows the UI dialog but does not emit a UI prompt event (the prompter does)", async () => {
    const events = {
      emit: vi.fn(),
      on: vi.fn().mockReturnValue(() => undefined),
    };
    const requestPermissionDecisionFromUi = vi
      .fn()
      .mockResolvedValue({ approved: true, state: "approved" as const });

    await confirmPermission(
      {
        hasUI: true,
        ui: { select: vi.fn(), input: vi.fn() },
      } as unknown as ExtensionContext,
      "Allow git push?",
      {
        forwardingDir: "/tmp/forwarding",
        subagentSessionsDir: "/tmp/subagents",
        events,
        logger: { writeReviewLog: vi.fn(), writeDebugLog: vi.fn() },
        writeReviewLog: vi.fn(),
        requestPermissionDecisionFromUi,
        shouldAutoApprove: () => false,
      },
    );

    expect(requestPermissionDecisionFromUi).toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalledWith(
      "permissions:ui_prompt",
      expect.anything(),
    );
  });

  test("does not show a dialog or emit when there is no active UI", async () => {
    const events = {
      emit: vi.fn(),
      on: vi.fn().mockReturnValue(() => undefined),
    };
    const requestPermissionDecisionFromUi = vi.fn();

    await confirmPermission(
      {
        hasUI: false,
        sessionManager: {
          getSessionDir: vi.fn().mockReturnValue(null),
        },
      } as unknown as ExtensionContext,
      "Allow git push?",
      {
        forwardingDir: "/tmp/forwarding",
        subagentSessionsDir: "/tmp/subagents",
        events,
        logger: { writeReviewLog: vi.fn(), writeDebugLog: vi.fn() },
        writeReviewLog: vi.fn(),
        requestPermissionDecisionFromUi,
        shouldAutoApprove: () => false,
      },
    );

    expect(events.emit).not.toHaveBeenCalledWith(
      "permissions:ui_prompt",
      expect.anything(),
    );
    expect(requestPermissionDecisionFromUi).not.toHaveBeenCalled();
  });
});
