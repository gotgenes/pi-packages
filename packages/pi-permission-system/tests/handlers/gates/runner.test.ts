import { describe, expect, it, vi } from "vitest";

import type {
  GateDescriptor,
  GateRunnerDeps,
} from "../../../src/handlers/gates/descriptor";
import { runGateCheck } from "../../../src/handlers/gates/runner";
import type { PermissionCheckResult } from "../../../src/types";

// ── helpers ────────────────────────────────────────────────────────────────

function makeDescriptor(
  overrides: Partial<GateDescriptor> = {},
): GateDescriptor {
  return {
    surface: "read",
    input: {},
    messages: {
      denyReason: "Tool 'read' is denied.",
      unavailableReason: "No UI available.",
      userDeniedReason: (d) => `User denied. ${d.denialReason ?? ""}`,
    },
    promptDetails: {
      source: "tool_call",
      agentName: null,
      message: "Allow tool 'read'?",
      toolCallId: "tc-1",
      toolName: "read",
    },
    logContext: {
      source: "tool_call",
      toolCallId: "tc-1",
      toolName: "read",
    },
    decision: {
      surface: "read",
      value: "read",
    },
    ...overrides,
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

function makeRunnerDeps(
  overrides: Partial<GateRunnerDeps> = {},
): GateRunnerDeps {
  return {
    checkPermission: vi.fn().mockReturnValue(makeCheckResult("allow")),
    getSessionRuleset: vi.fn().mockReturnValue([]),
    approveSessionRule: vi.fn(),
    persistCustomPattern: vi.fn().mockReturnValue("/tmp/config.json"),
    refreshConfig: vi.fn(),
    writeReviewLog: vi.fn(),
    emitDecision: vi.fn(),
    canConfirm: vi.fn().mockReturnValue(true),
    promptPermission: vi
      .fn()
      .mockResolvedValue({ approved: true, state: "approved" }),
    ...overrides,
  };
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("runGateCheck", () => {
  it("returns allow and emits policy_allow when policy is allow", async () => {
    const deps = makeRunnerDeps();
    const result = await runGateCheck(makeDescriptor(), null, "tc-1", deps);
    expect(result).toEqual({ action: "allow" });
    expect(deps.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: "read",
        value: "read",
        result: "allow",
        resolution: "policy_allow",
      }),
    );
  });

  it("returns block and emits policy_deny when policy is deny", async () => {
    const deps = makeRunnerDeps({
      checkPermission: vi.fn().mockReturnValue(makeCheckResult("deny")),
    });
    const result = await runGateCheck(makeDescriptor(), null, "tc-1", deps);
    expect(result).toMatchObject({ action: "block" });
    expect(deps.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "deny",
        resolution: "policy_deny",
      }),
    );
    expect(deps.writeReviewLog).toHaveBeenCalledWith(
      "permission_request.blocked",
      expect.objectContaining({ resolution: "policy_denied" }),
    );
  });

  it("returns allow and emits session_approved on session hit", async () => {
    const deps = makeRunnerDeps({
      checkPermission: vi.fn().mockReturnValue(
        makeCheckResult("allow", {
          source: "session",
          matchedPattern: "git *",
        }),
      ),
    });
    const result = await runGateCheck(
      makeDescriptor({
        surface: "bash",
        input: { command: "git status" },
        decision: { surface: "bash", value: "git status" },
      }),
      null,
      "tc-1",
      deps,
    );
    expect(result).toEqual({ action: "allow" });
    expect(deps.writeReviewLog).toHaveBeenCalledWith(
      "permission_request.session_approved",
      expect.objectContaining({
        resolution: "session_approved",
        sessionApprovalPattern: "git *",
      }),
    );
    expect(deps.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        resolution: "session_approved",
        matchedPattern: "git *",
      }),
    );
  });

  it("returns allow and emits user_approved when ask + user approves", async () => {
    const deps = makeRunnerDeps({
      checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
      promptPermission: vi
        .fn()
        .mockResolvedValue({ approved: true, state: "approved" }),
    });
    const result = await runGateCheck(makeDescriptor(), null, "tc-1", deps);
    expect(result).toEqual({ action: "allow" });
    expect(deps.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "allow",
        resolution: "user_approved",
      }),
    );
  });

  it("returns allow, emits user_approved_for_session, and records session rule on approved_for_session", async () => {
    const deps = makeRunnerDeps({
      checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
      promptPermission: vi
        .fn()
        .mockResolvedValue({ approved: true, state: "approved_for_session" }),
    });
    const descriptor = makeDescriptor({
      sessionApproval: { surface: "read", pattern: "*" },
    });
    const result = await runGateCheck(descriptor, null, "tc-1", deps);
    expect(result).toEqual({ action: "allow" });
    expect(deps.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        resolution: "user_approved_for_session",
      }),
    );
    expect(deps.approveSessionRule).toHaveBeenCalledWith("read", "*");
  });

  it("calls approveSessionRule once per pattern when sessionApproval has multiple patterns", async () => {
    const deps = makeRunnerDeps({
      checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
      promptPermission: vi
        .fn()
        .mockResolvedValue({ approved: true, state: "approved_for_session" }),
    });
    const descriptor = makeDescriptor({
      sessionApproval: {
        surface: "external_directory",
        patterns: ["/outside/a/*", "/outside/b/*"],
      },
    });
    const result = await runGateCheck(descriptor, null, "tc-1", deps);
    expect(result).toEqual({ action: "allow" });
    expect(deps.approveSessionRule).toHaveBeenCalledTimes(2);
    expect(deps.approveSessionRule).toHaveBeenCalledWith(
      "external_directory",
      "/outside/a/*",
    );
    expect(deps.approveSessionRule).toHaveBeenCalledWith(
      "external_directory",
      "/outside/b/*",
    );
  });

  it("persists a custom project pattern, records a session rule, refreshes config, and emits approved_with_custom_pattern", async () => {
    const deps = makeRunnerDeps({
      checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
      promptPermission: vi.fn().mockResolvedValue({
        approved: true,
        state: "approved_with_custom_pattern",
        customPatternApproval: {
          pattern: "git checkout *",
          target: "project",
        },
      }),
    });
    const descriptor = makeDescriptor({
      surface: "bash",
      promptDetails: {
        source: "tool_call",
        agentName: null,
        message: "Allow?",
        surface: "bash",
        defaultPersistAction: "allow",
        toolCallId: "tc-1",
        toolName: "bash",
      },
      decision: { surface: "bash", value: "git checkout main" },
    });
    const result = await runGateCheck(descriptor, null, "tc-1", deps);
    expect(result).toEqual({ action: "allow" });
    expect(deps.persistCustomPattern).toHaveBeenCalledWith(
      "project",
      "bash",
      "git checkout *",
      "allow",
    );
    expect(deps.approveSessionRule).toHaveBeenCalledWith(
      "bash",
      "git checkout *",
    );
    expect(deps.refreshConfig).toHaveBeenCalledTimes(1);
    expect(deps.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({ resolution: "approved_with_custom_pattern" }),
    );
  });

  it("returns block and emits user_denied when ask + user denies", async () => {
    const deps = makeRunnerDeps({
      checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
      promptPermission: vi
        .fn()
        .mockResolvedValue({ approved: false, state: "denied" }),
    });
    const result = await runGateCheck(makeDescriptor(), null, "tc-1", deps);
    expect(result).toMatchObject({ action: "block" });
    expect(deps.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "deny",
        resolution: "user_denied",
      }),
    );
  });

  it("returns block and emits confirmation_unavailable when ask + no UI", async () => {
    const deps = makeRunnerDeps({
      checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
      canConfirm: vi.fn().mockReturnValue(false),
    });
    const result = await runGateCheck(makeDescriptor(), null, "tc-1", deps);
    expect(result).toMatchObject({ action: "block" });
    expect(deps.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "deny",
        resolution: "confirmation_unavailable",
      }),
    );
  });

  it("emits auto_approved resolution when decision has autoApproved flag", async () => {
    const deps = makeRunnerDeps({
      checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
      promptPermission: vi.fn().mockResolvedValue({
        approved: true,
        state: "approved",
        autoApproved: true,
      }),
    });
    const result = await runGateCheck(makeDescriptor(), null, "tc-1", deps);
    expect(result).toEqual({ action: "allow" });
    expect(deps.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        resolution: "auto_approved",
      }),
    );
  });

  it("uses preResolved.state instead of calling checkPermission", async () => {
    const deps = makeRunnerDeps();
    const descriptor = makeDescriptor({
      preResolved: { state: "deny" },
    });
    const result = await runGateCheck(descriptor, null, "tc-1", deps);
    expect(result).toMatchObject({ action: "block" });
    expect(deps.checkPermission).not.toHaveBeenCalled();
    expect(deps.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        resolution: "policy_deny",
      }),
    );
  });

  it("uses preResolved.state allow without calling checkPermission", async () => {
    const deps = makeRunnerDeps();
    const descriptor = makeDescriptor({
      preResolved: { state: "allow" },
    });
    const result = await runGateCheck(descriptor, null, "tc-1", deps);
    expect(result).toEqual({ action: "allow" });
    expect(deps.checkPermission).not.toHaveBeenCalled();
    expect(deps.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        resolution: "policy_allow",
      }),
    );
  });

  it("passes agentName to checkPermission and decision event", async () => {
    const deps = makeRunnerDeps();
    const result = await runGateCheck(
      makeDescriptor(),
      "test-agent",
      "tc-1",
      deps,
    );
    expect(result).toEqual({ action: "allow" });
    expect(deps.checkPermission).toHaveBeenCalledWith(
      "read",
      {},
      "test-agent",
      [],
    );
    expect(deps.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        agentName: "test-agent",
      }),
    );
  });

  it("passes requestId from toolCallId to promptPermission", async () => {
    const deps = makeRunnerDeps({
      checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
    });
    await runGateCheck(makeDescriptor(), null, "tc-42", deps);
    expect(deps.promptPermission).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "tc-42" }),
    );
  });

  it("does not call approveSessionRule when user approves once (no sessionApproval)", async () => {
    const deps = makeRunnerDeps({
      checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
      promptPermission: vi
        .fn()
        .mockResolvedValue({ approved: true, state: "approved" }),
    });
    await runGateCheck(makeDescriptor(), null, "tc-1", deps);
    expect(deps.approveSessionRule).not.toHaveBeenCalled();
  });

  it("uses preCheck result directly instead of calling checkPermission", async () => {
    const deps = makeRunnerDeps();
    const descriptor = makeDescriptor({
      preCheck: makeCheckResult("deny", {
        origin: "global",
        matchedPattern: "rm *",
      }),
    });
    const result = await runGateCheck(descriptor, null, "tc-1", deps);
    expect(result).toMatchObject({ action: "block" });
    expect(deps.checkPermission).not.toHaveBeenCalled();
    expect(deps.emitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        resolution: "policy_deny",
        origin: "global",
        matchedPattern: "rm *",
      }),
    );
  });

  it("does not call approveSessionRule when user approves for session but no sessionApproval on descriptor", async () => {
    const deps = makeRunnerDeps({
      checkPermission: vi.fn().mockReturnValue(makeCheckResult("ask")),
      promptPermission: vi
        .fn()
        .mockResolvedValue({ approved: true, state: "approved_for_session" }),
    });
    // No sessionApproval on descriptor
    await runGateCheck(makeDescriptor(), null, "tc-1", deps);
    expect(deps.approveSessionRule).not.toHaveBeenCalled();
  });
});
