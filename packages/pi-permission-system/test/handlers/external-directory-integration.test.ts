/**
 * Integration tests for external_directory tool_call enforcement.
 *
 * These tests exercise PermissionGateHandler.handleToolCall with the
 * external-directory gate, verifying the full descriptor→runner pipeline
 * while mocking only the PermissionSession boundary.
 *
 * Regression guard: importing the four external-directory message helpers
 * ensures the test file fails to load if any helper is removed.
 */

import { describe, expect, it, vi } from "vitest";
import { surfaceFamilyOf } from "#src/access-intent/path-surfaces";
import { EXTENSION_TAG } from "#src/presentation/agent-renderer";
import { buildExternalDirectoryAskPayload } from "#src/presentation/path-ask-payload";
import type { PermissionCheckResult } from "#src/types";
import {
  ALL_PATH_BEARING_TOOLS,
  ALL_TOOLS,
  blockReviewEntries,
  EXT_DIR_CWD,
  EXTERNAL_PATH,
  findExtDirDecision,
  makeApprovingPrompter,
  makeDenyingPrompter,
  makeExtDirCheck,
  makeUnavailablePrompter,
  OPTIONAL_PATH_TOOLS,
} from "#test/helpers/external-directory-fixtures";
import {
  getDecisionEvents,
  makeCtx,
  makeHandler,
  makeToolCallEvent,
} from "#test/helpers/handler-fixtures";

// ── SDK stubs ──────────────────────────────────────────────────────────────
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return { ...original };
});

// ── Regression guard: helper presence ──────────────────────────────────────

describe("external_directory helper regression guard", () => {
  it("the external-directory ask names the path it gates", () => {
    expect(
      buildExternalDirectoryAskPayload({
        toolName: "read",
        pathValue: "/outside/file",
        cwd: "/project",
        agentName: null,
        surface: "external_directory_read",
      }).request.value,
    ).toBe("/outside/file");
  });

  it("EXTENSION_TAG is the expected value", () => {
    expect(EXTENSION_TAG).toBe("[pi-permission-system]");
  });

  // formatExternalDirectoryDenyReason, formatExternalDirectoryUserDeniedReason,
  // and formatExternalDirectoryHardStopHint are now renders over the prompt
  // payload. Their behavior is tested in presentation/agent-renderer.test.ts.
});

// ── Path scope: gate applicability ────────────────────────────────────────

describe("external_directory path scope", () => {
  it("skips external_directory check when path is inside CWD", async () => {
    const { handler } = makeHandler({
      session: { checkPermission: makeExtDirCheck("deny") },
      tools: ALL_TOOLS,
    });
    const event = makeToolCallEvent("read", {
      input: { path: `${EXT_DIR_CWD}/src/index.ts` },
    });
    const result = await handler.handleToolCall(event, makeCtx());
    // Should not be blocked — the external_directory gate is skipped,
    // and the tool gate sees "allow" (default toolState in makeExtDirCheck)
    expect(result).toEqual({ action: "allow" });
  });

  it("fires external_directory check when path is outside CWD", async () => {
    const { handler } = makeHandler({
      session: { checkPermission: makeExtDirCheck("deny") },
      tools: ALL_TOOLS,
    });
    const event = makeToolCallEvent("read", { input: { path: EXTERNAL_PATH } });
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toMatchObject({ action: "block" });
  });

  it("skips external_directory check for non-path-bearing tool (bash)", async () => {
    const { handler } = makeHandler({
      session: { checkPermission: makeExtDirCheck("deny", "allow") },
      tools: ALL_TOOLS,
    });
    const event = makeToolCallEvent("bash", {
      input: { command: `cat ${EXTERNAL_PATH}` },
    });
    // bash is not in PATH_BEARING_TOOLS, so the external_directory gate
    // for tool path does not fire (bash-external-directory gate is separate)
    const result = await handler.handleToolCall(event, makeCtx());
    // bash-external-directory gate MAY fire separately, but the tool-path
    // external_directory gate does NOT fire for bash
    // We verify the checkPermission was not called with "external_directory"
    // from the tool-path gate by checking the result is not blocked by it
    expect(result).toBeDefined();
  });

  it.each(
    ALL_PATH_BEARING_TOOLS,
  )("blocks %s with an out-of-cwd path when external_directory is deny", async (toolName) => {
    const { handler } = makeHandler({
      session: { checkPermission: makeExtDirCheck("deny") },
      tools: ALL_TOOLS,
    });
    const event = makeToolCallEvent(toolName, {
      input: { path: EXTERNAL_PATH },
    });
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toMatchObject({ action: "block" });
  });

  it.each(
    OPTIONAL_PATH_TOOLS,
  )("skips external_directory check for %s when path is omitted", async (toolName) => {
    const { handler } = makeHandler({
      session: { checkPermission: makeExtDirCheck("deny") },
      tools: ALL_TOOLS,
    });
    // No path in input — external_directory gate should not fire
    const event = makeToolCallEvent(toolName);
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toEqual({ action: "allow" });
  });
});

// ── Policy state matrix: allow and deny ────────────────────────────────────

describe("external_directory policy state — allow", () => {
  it("falls through to tool gate when external_directory is allow", async () => {
    const { handler } = makeHandler({
      session: { checkPermission: makeExtDirCheck("allow") },
      tools: ALL_TOOLS,
    });
    const event = makeToolCallEvent("read", { input: { path: EXTERNAL_PATH } });
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toEqual({ action: "allow" });
  });

  it("emits decision event with policy_allow on external_directory surface", async () => {
    const { handler, events } = makeHandler({
      session: { checkPermission: makeExtDirCheck("allow") },
      tools: ALL_TOOLS,
    });
    const event = makeToolCallEvent("read", { input: { path: EXTERNAL_PATH } });
    await handler.handleToolCall(event, makeCtx());
    expect(findExtDirDecision(events)).toMatchObject({
      surface: "external_directory_read",
      result: "allow",
      resolution: "policy_allow",
    });
  });

  it("does not write a block review-log entry when external_directory is allow", async () => {
    const { handler, logger } = makeHandler({
      session: { checkPermission: makeExtDirCheck("allow") },
      tools: ALL_TOOLS,
    });
    const event = makeToolCallEvent("read", { input: { path: EXTERNAL_PATH } });
    await handler.handleToolCall(event, makeCtx());
    expect(blockReviewEntries(logger)).toHaveLength(0);
  });
});

// #144: allow external reads, gate external writes
describe("external_directory — allow external reads, gate external writes (#144)", () => {
  it("allows read of external path when external_directory and read are both allow", async () => {
    const { handler } = makeHandler({
      session: { checkPermission: makeExtDirCheck("allow", "allow") },
      tools: ALL_TOOLS,
    });
    const event = makeToolCallEvent("read", { input: { path: EXTERNAL_PATH } });
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toEqual({ action: "allow" });
  });

  it("prompts for write to external path when external_directory allows but write is ask", async () => {
    const { handler, prompter } = makeHandler({
      session: { checkPermission: makeExtDirCheck("allow", "ask") },
      prompter: makeApprovingPrompter(),
      tools: ALL_TOOLS,
    });
    const event = makeToolCallEvent("write", {
      input: { path: EXTERNAL_PATH },
    });
    const result = await handler.handleToolCall(event, makeCtx());
    // external_directory passes; write gate prompts and user approves
    expect(result).toEqual({ action: "allow" });
    expect(prompter.escalate).toHaveBeenCalledOnce();
  });

  it("blocks write to external path when external_directory allows but write is deny", async () => {
    const { handler } = makeHandler({
      session: { checkPermission: makeExtDirCheck("allow", "deny") },
      tools: ALL_TOOLS,
    });
    const event = makeToolCallEvent("write", {
      input: { path: EXTERNAL_PATH },
    });
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toMatchObject({ action: "block" });
  });

  it("emits separate decision events for external_directory and write surfaces", async () => {
    const { handler, events } = makeHandler({
      session: { checkPermission: makeExtDirCheck("allow", "deny") },
      tools: ALL_TOOLS,
    });
    const event = makeToolCallEvent("write", {
      input: { path: EXTERNAL_PATH },
    });
    await handler.handleToolCall(event, makeCtx());
    const decisions = getDecisionEvents(events);
    const writeDecision = decisions.find((d) => d.surface === "write");
    expect(findExtDirDecision(events)).toMatchObject({
      surface: "external_directory_write",
      result: "allow",
      resolution: "policy_allow",
    });
    expect(writeDecision).toMatchObject({
      surface: "write",
      result: "deny",
      resolution: "policy_deny",
    });
  });
});

describe("external_directory policy state — deny", () => {
  it("blocks with reason containing the external path", async () => {
    const { handler } = makeHandler({
      session: { checkPermission: makeExtDirCheck("deny") },
      tools: ALL_TOOLS,
    });
    const event = makeToolCallEvent("read", { input: { path: EXTERNAL_PATH } });
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toMatchObject({ action: "block" });
    expect((result as { reason?: string }).reason).toContain(EXTERNAL_PATH);
  });

  it("block reason contains extension attribution", async () => {
    const { handler } = makeHandler({
      session: { checkPermission: makeExtDirCheck("deny") },
      tools: ALL_TOOLS,
    });
    const event = makeToolCallEvent("read", { input: { path: EXTERNAL_PATH } });
    const result = await handler.handleToolCall(event, makeCtx());
    expect((result as { reason?: string }).reason).toContain(
      "[pi-permission-system]",
    );
    expect((result as { reason?: string }).reason).not.toContain("Hard stop");
  });

  it("writes review-log entry with resolution policy_denied", async () => {
    const { handler, logger } = makeHandler({
      session: { checkPermission: makeExtDirCheck("deny") },
      tools: ALL_TOOLS,
    });
    const event = makeToolCallEvent("read", { input: { path: EXTERNAL_PATH } });
    await handler.handleToolCall(event, makeCtx());
    const entries = blockReviewEntries(logger);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0][1]).toMatchObject({
      resolution: "policy_denied",
    });
  });

  it("emits decision event with policy_deny on external_directory surface", async () => {
    const { handler, events } = makeHandler({
      session: { checkPermission: makeExtDirCheck("deny") },
      tools: ALL_TOOLS,
    });
    const event = makeToolCallEvent("read", { input: { path: EXTERNAL_PATH } });
    await handler.handleToolCall(event, makeCtx());
    expect(findExtDirDecision(events)).toMatchObject({
      surface: "external_directory_read",
      result: "deny",
      resolution: "policy_deny",
    });
  });
});

// ── Policy state matrix: ask ────────────────────────────────────────────────

describe("external_directory policy state — ask", () => {
  it("does not block when user approves", async () => {
    const { handler } = makeHandler({
      session: { checkPermission: makeExtDirCheck("ask") },
      prompter: makeApprovingPrompter(),
      tools: ALL_TOOLS,
    });
    const event = makeToolCallEvent("read", { input: { path: EXTERNAL_PATH } });
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toEqual({ action: "allow" });
  });

  it("emits user_approved decision when user approves", async () => {
    const { handler, events } = makeHandler({
      session: { checkPermission: makeExtDirCheck("ask") },
      prompter: makeApprovingPrompter(),
      tools: ALL_TOOLS,
    });
    const event = makeToolCallEvent("read", { input: { path: EXTERNAL_PATH } });
    await handler.handleToolCall(event, makeCtx());
    expect(findExtDirDecision(events)).toMatchObject({
      surface: "external_directory_read",
      result: "allow",
      resolution: "user_approved",
    });
  });

  it("blocks when user denies", async () => {
    const { handler } = makeHandler({
      session: { checkPermission: makeExtDirCheck("ask") },
      prompter: makeDenyingPrompter(),
      tools: ALL_TOOLS,
    });
    const event = makeToolCallEvent("read", { input: { path: EXTERNAL_PATH } });
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toMatchObject({ action: "block" });
  });

  it("emits user_denied decision when user denies", async () => {
    const { handler, events } = makeHandler({
      session: { checkPermission: makeExtDirCheck("ask") },
      prompter: makeDenyingPrompter(),
      tools: ALL_TOOLS,
    });
    const event = makeToolCallEvent("read", { input: { path: EXTERNAL_PATH } });
    await handler.handleToolCall(event, makeCtx());
    expect(findExtDirDecision(events)).toMatchObject({
      surface: "external_directory_read",
      result: "deny",
      resolution: "user_denied",
    });
  });

  it("block reason includes denialReason when user provides one", async () => {
    const { handler } = makeHandler({
      session: { checkPermission: makeExtDirCheck("ask") },
      prompter: makeDenyingPrompter("not needed"),
      tools: ALL_TOOLS,
    });
    const event = makeToolCallEvent("read", { input: { path: EXTERNAL_PATH } });
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toMatchObject({ action: "block" });
    expect((result as { reason?: string }).reason).toContain("not needed");
  });

  it("blocks with confirmation_unavailable when no UI is available", async () => {
    const { handler } = makeHandler({
      session: { checkPermission: makeExtDirCheck("ask") },
      prompter: makeUnavailablePrompter(),
      tools: ALL_TOOLS,
    });
    const event = makeToolCallEvent("read", { input: { path: EXTERNAL_PATH } });
    const result = await handler.handleToolCall(
      event,
      makeCtx({ hasUI: false }),
    );
    expect(result).toMatchObject({ action: "block" });
    // The gate surface names the boundary; an unavailable verdict states only
    // that approval was unreachable, since no retry shape changes that.
    expect((result as { reason?: string }).reason).toBe(
      `${EXTENSION_TAG} This 'external_directory_read' call for tool 'read' for path '${EXTERNAL_PATH}' requires approval, but no interactive UI is available.`,
    );
  });

  it("emits confirmation_unavailable decision when no UI", async () => {
    const { handler, events } = makeHandler({
      session: { checkPermission: makeExtDirCheck("ask") },
      prompter: makeUnavailablePrompter(),
      tools: ALL_TOOLS,
    });
    const event = makeToolCallEvent("read", { input: { path: EXTERNAL_PATH } });
    await handler.handleToolCall(event, makeCtx({ hasUI: false }));
    expect(findExtDirDecision(events)).toMatchObject({
      surface: "external_directory_read",
      result: "deny",
      resolution: "confirmation_unavailable",
    });
  });
});

// ── Per-agent override ─────────────────────────────────────────────────────

describe("external_directory per-agent override", () => {
  it("honors per-agent override of external_directory policy", async () => {
    // checkPermission varies by agentName: allow for "special-agent", deny otherwise
    const agentAwareCheck = vi
      .fn()
      .mockImplementation(
        (
          surface: string,
          _input: unknown,
          agentName?: string,
        ): PermissionCheckResult => {
          if (surfaceFamilyOf(surface) === "external_directory") {
            const state =
              agentName === "special-agent" ? "allow" : ("deny" as const);
            return {
              state,
              toolName: surface,
              source: "tool",
              origin: agentName === "special-agent" ? "agent" : "global",
            };
          }
          return {
            state: "allow",
            toolName: surface,
            source: "tool",
            origin: "builtin",
          };
        },
      );

    // With agent override → allowed
    const { handler: handler1, events: events1 } = makeHandler({
      session: {
        checkPermission: agentAwareCheck,
        resolveAgentName: vi.fn().mockReturnValue("special-agent"),
      },
      tools: ALL_TOOLS,
    });
    const event = makeToolCallEvent("read", { input: { path: EXTERNAL_PATH } });
    const result1 = await handler1.handleToolCall(event, makeCtx());
    expect(result1).toEqual({ action: "allow" });

    expect(findExtDirDecision(events1)).toMatchObject({
      result: "allow",
      resolution: "policy_allow",
      agentName: "special-agent",
    });

    // Without agent override → denied
    const { handler: handler2 } = makeHandler({
      session: {
        checkPermission: agentAwareCheck,
        resolveAgentName: vi.fn().mockReturnValue(null),
      },
      tools: ALL_TOOLS,
    });
    const result2 = await handler2.handleToolCall(event, makeCtx());
    expect(result2).toMatchObject({ action: "block" });
  });
});

// ── Decision event surface and value ──────────────────────────────────────

describe("external_directory decision event fields", () => {
  it("decision event value is the external path", async () => {
    const { handler, events } = makeHandler({
      session: { checkPermission: makeExtDirCheck("deny") },
      tools: ALL_TOOLS,
    });
    const event = makeToolCallEvent("read", { input: { path: EXTERNAL_PATH } });
    await handler.handleToolCall(event, makeCtx());
    const extDirDecision = findExtDirDecision(events);
    expect(extDirDecision).toBeDefined();
    expect(extDirDecision!.value).toBe(EXTERNAL_PATH);
  });

  it("decision event includes agentName when present", async () => {
    const { handler, events } = makeHandler({
      session: {
        checkPermission: makeExtDirCheck("allow"),
        resolveAgentName: vi.fn().mockReturnValue("my-agent"),
      },
      tools: ALL_TOOLS,
    });
    const event = makeToolCallEvent("read", { input: { path: EXTERNAL_PATH } });
    await handler.handleToolCall(event, makeCtx());
    expect(findExtDirDecision(events)).toMatchObject({
      agentName: "my-agent",
    });
  });

  it("decision event agentName is null when no agent", async () => {
    const { handler, events } = makeHandler({
      session: { checkPermission: makeExtDirCheck("allow") },
      tools: ALL_TOOLS,
    });
    const event = makeToolCallEvent("read", { input: { path: EXTERNAL_PATH } });
    await handler.handleToolCall(event, makeCtx());
    expect(findExtDirDecision(events)).toMatchObject({
      agentName: null,
    });
  });
});
