/**
 * Integration tests verifying that sequential tool calls to the same
 * external path only prompt once — the session-approval recorded by the
 * first call covers the second.
 *
 * Uses real PermissionSession + PermissionResolver + SessionRules so the
 * stateful approval-tracking path is exercised end-to-end.
 */

import { describe, expect, it, vi } from "vitest";

import { GateDecisionReporter } from "#src/decision-reporter";
import type { GatePrompter } from "#src/gate-prompter";
import { GateRunner } from "#src/handlers/gates/runner";
import { SkillInputGatePipeline } from "#src/handlers/gates/skill-input-gate-pipeline";
import { ToolCallGatePipeline } from "#src/handlers/gates/tool-call-gate-pipeline";
import { PermissionGateHandler } from "#src/handlers/permission-gate-handler";
import type { PermissionCheckResult } from "#src/types";
import { wildcardMatch } from "#src/wildcard-matcher";

import {
  makeCtx,
  makeEvents,
  makeToolRegistry,
} from "#test/helpers/handler-fixtures";
import {
  makeRealResolver,
  makeRealSession,
} from "#test/helpers/session-fixtures";

// ── SDK stub ───────────────────────────────────────────────────────────────
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return { ...original };
});

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Build a fully wired PermissionGateHandler for external-directory dedup
 * tests.
 *
 * `permissionManager.checkPermission` is configured so that:
 * - `external_directory` surface returns "ask" on first call
 * - On subsequent calls it checks the shared `sessionRules` store; if a
 *   matching rule was recorded by the runner, it returns "allow" with
 *   `source: "session"`.
 * - All other surfaces return "allow".
 */
function makeDeduplicatingHandler(prompter?: GatePrompter): {
  handler: PermissionGateHandler;
  prompter: GatePrompter;
} {
  const { session, permissionManager, sessionRules, logger } =
    makeRealSession();
  const { resolver } = makeRealResolver(permissionManager, sessionRules);

  // Configure checkPermission to simulate config-level "ask" for external_directory
  // but return "allow/session" when a session rule has been recorded.
  vi.mocked(permissionManager.checkPermission).mockImplementation(
    (surface, input, _agentName, rules): PermissionCheckResult => {
      if (surface === "external_directory") {
        const record = (input ?? {}) as Record<string, unknown>;
        const pathValue = typeof record.path === "string" ? record.path : null;

        if (pathValue && rules && rules.length > 0) {
          const match = rules.findLast(
            (r) =>
              r.surface === "external_directory" &&
              wildcardMatch(r.pattern, pathValue),
          );
          if (match) {
            return {
              state: "allow",
              toolName: surface,
              source: "session",
              origin: "session",
              matchedPattern: match.pattern,
            };
          }
        }

        return {
          state: "ask",
          toolName: surface,
          source: "special",
          origin: "global",
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

  const events = makeEvents();
  const reporter = new GateDecisionReporter(logger, events);
  const resolvedPrompter: GatePrompter = prompter ?? {
    canConfirm: vi.fn().mockReturnValue(true),
    prompt: vi
      .fn<GatePrompter["prompt"]>()
      .mockResolvedValue({ approved: true, state: "approved_for_session" }),
  };
  const runner = new GateRunner(
    resolver,
    sessionRules,
    resolvedPrompter,
    reporter,
  );
  const handler = new PermissionGateHandler(
    session,
    makeToolRegistry({
      getAll: vi
        .fn()
        .mockReturnValue([
          { name: "read" },
          { name: "write" },
          { name: "edit" },
          { name: "bash" },
        ]),
      getActive: vi
        .fn()
        .mockReturnValue([
          { name: "read" },
          { name: "write" },
          { name: "edit" },
          { name: "bash" },
        ]),
    }),
    new ToolCallGatePipeline(resolver, session),
    new SkillInputGatePipeline(resolver),
    runner,
  );
  return { handler, prompter: resolvedPrompter };
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("external-directory session dedup", () => {
  describe("path-bearing tools (read, write, edit)", () => {
    it("does not re-prompt for the same external path after session approval", async () => {
      const { handler, prompter } = makeDeduplicatingHandler();
      const ctx = makeCtx();
      const externalPath = "/outside/project/data.txt";

      // First call — should prompt
      const event1 = {
        type: "tool_call",
        toolCallId: "tc-1",
        toolName: "read",
        input: { path: externalPath },
      };
      const result1 = await handler.handleToolCall(event1, ctx);
      expect(result1).toEqual({});
      expect(prompter.prompt).toHaveBeenCalledTimes(1);

      // Second call — same path, should hit session rule, no prompt
      const event2 = {
        type: "tool_call",
        toolCallId: "tc-2",
        toolName: "read",
        input: { path: externalPath },
      };
      const result2 = await handler.handleToolCall(event2, ctx);
      expect(result2).toEqual({});
      expect(prompter.prompt).toHaveBeenCalledTimes(1);
    });

    it("does not re-prompt for a different file in the same external directory", async () => {
      const { handler, prompter } = makeDeduplicatingHandler();
      const ctx = makeCtx();

      // First call — prompt for /outside/project/a.txt
      const event1 = {
        type: "tool_call",
        toolCallId: "tc-1",
        toolName: "read",
        input: { path: "/outside/project/a.txt" },
      };
      await handler.handleToolCall(event1, ctx);
      expect(prompter.prompt).toHaveBeenCalledTimes(1);

      // Second call — /outside/project/b.txt is in the same directory
      const event2 = {
        type: "tool_call",
        toolCallId: "tc-2",
        toolName: "read",
        input: { path: "/outside/project/b.txt" },
      };
      await handler.handleToolCall(event2, ctx);
      expect(prompter.prompt).toHaveBeenCalledTimes(1);
    });

    it("does prompt for a file in a different external directory", async () => {
      const { handler, prompter } = makeDeduplicatingHandler();
      const ctx = makeCtx();

      // First call — /outside/alpha/file.txt
      const event1 = {
        type: "tool_call",
        toolCallId: "tc-1",
        toolName: "read",
        input: { path: "/outside/alpha/file.txt" },
      };
      await handler.handleToolCall(event1, ctx);
      expect(prompter.prompt).toHaveBeenCalledTimes(1);

      // Second call — /outside/beta/file.txt is a different directory
      const event2 = {
        type: "tool_call",
        toolCallId: "tc-2",
        toolName: "read",
        input: { path: "/outside/beta/file.txt" },
      };
      await handler.handleToolCall(event2, ctx);
      expect(prompter.prompt).toHaveBeenCalledTimes(2);
    });

    it("re-prompts when user approved once (not for session)", async () => {
      const approveOnce: GatePrompter = {
        canConfirm: vi.fn().mockReturnValue(true),
        prompt: vi
          .fn<GatePrompter["prompt"]>()
          .mockResolvedValue({ approved: true, state: "approved" }),
      };
      const { handler, prompter } = makeDeduplicatingHandler(approveOnce);
      const ctx = makeCtx();
      const externalPath = "/outside/project/data.txt";

      // First call — prompt, approved once
      const event1 = {
        type: "tool_call",
        toolCallId: "tc-1",
        toolName: "read",
        input: { path: externalPath },
      };
      await handler.handleToolCall(event1, ctx);
      expect(prompter.prompt).toHaveBeenCalledTimes(1);

      // Second call — no session rule recorded, should prompt again
      const event2 = {
        type: "tool_call",
        toolCallId: "tc-2",
        toolName: "read",
        input: { path: externalPath },
      };
      await handler.handleToolCall(event2, ctx);
      expect(prompter.prompt).toHaveBeenCalledTimes(2);
    });
  });

  describe("bash commands with external paths", () => {
    it("does not re-prompt for a bash command referencing the same external path after session approval", async () => {
      const { handler, prompter } = makeDeduplicatingHandler();
      const ctx = makeCtx();

      // First call — bash referencing /tmp/out.txt
      const event1 = {
        type: "tool_call",
        toolCallId: "tc-1",
        toolName: "bash",
        input: { command: "echo hello > /tmp/out.txt" },
      };
      const result1 = await handler.handleToolCall(event1, ctx);
      expect(result1).toEqual({});
      expect(prompter.prompt).toHaveBeenCalledTimes(1);

      // Second call — different bash command, same external path
      const event2 = {
        type: "tool_call",
        toolCallId: "tc-2",
        toolName: "bash",
        input: { command: "cat /tmp/out.txt" },
      };
      const result2 = await handler.handleToolCall(event2, ctx);
      expect(result2).toEqual({});
      expect(prompter.prompt).toHaveBeenCalledTimes(1);
    });

    it("does not re-prompt for read after bash already approved the same directory", async () => {
      const { handler, prompter } = makeDeduplicatingHandler();
      const ctx = makeCtx();

      // First call — bash writes to /tmp/out.txt
      const event1 = {
        type: "tool_call",
        toolCallId: "tc-1",
        toolName: "bash",
        input: { command: "echo hello > /tmp/out.txt" },
      };
      await handler.handleToolCall(event1, ctx);
      expect(prompter.prompt).toHaveBeenCalledTimes(1);

      // Second call — read from /tmp/out.txt (same directory, different tool)
      const event2 = {
        type: "tool_call",
        toolCallId: "tc-2",
        toolName: "read",
        input: { path: "/tmp/out.txt" },
      };
      await handler.handleToolCall(event2, ctx);
      expect(prompter.prompt).toHaveBeenCalledTimes(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Moved from permission-system.test.ts catch-all (#342)
// ---------------------------------------------------------------------------

describe("session shutdown clears external-directory approvals", () => {
  it("re-prompts for the same path after session shutdown", async () => {
    // Build a fully wired handler inline so we can access session directly.
    const { session, permissionManager, sessionRules, logger } =
      makeRealSession();
    const { resolver } = makeRealResolver(permissionManager, sessionRules);

    // external_directory=ask; session-covered paths return allow/session.
    vi.mocked(permissionManager.checkPermission).mockImplementation(
      (surface, input, _agentName, rules): PermissionCheckResult => {
        if (surface === "external_directory") {
          const record = (input ?? {}) as Record<string, unknown>;
          const pathValue =
            typeof record.path === "string" ? record.path : null;
          if (pathValue && rules && rules.length > 0) {
            const match = rules.findLast(
              (r) =>
                r.surface === "external_directory" &&
                wildcardMatch(r.pattern, pathValue),
            );
            if (match) {
              return {
                state: "allow",
                toolName: surface,
                source: "session",
                origin: "session",
                matchedPattern: match.pattern,
              };
            }
          }
          return {
            state: "ask",
            toolName: surface,
            source: "special",
            origin: "global",
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

    const events = makeEvents();
    const reporter = new GateDecisionReporter(logger, events);
    const prompter: GatePrompter = {
      canConfirm: vi.fn().mockReturnValue(true),
      // Simulate "Yes, for this session" on first call, "Yes" on subsequent.
      prompt: vi
        .fn<GatePrompter["prompt"]>()
        .mockResolvedValue({ approved: true, state: "approved_for_session" }),
    };
    const runner = new GateRunner(resolver, sessionRules, prompter, reporter);
    const handler = new PermissionGateHandler(
      session,
      makeToolRegistry({
        getAll: vi.fn().mockReturnValue([{ name: "read" }]),
        getActive: vi.fn().mockReturnValue([{ name: "read" }]),
      }),
      new ToolCallGatePipeline(resolver, session),
      new SkillInputGatePipeline(resolver),
      runner,
    );

    const externalPath = "/tmp/sibling/foo.ts";
    const ctx = makeCtx();
    const event = {
      type: "tool_call",
      toolCallId: "tc-1",
      toolName: "read",
      input: { path: externalPath },
    };

    // First access: prompt fires and records session approval.
    await handler.handleToolCall(event, ctx);
    expect(vi.mocked(prompter.prompt)).toHaveBeenCalledTimes(1);

    // Second access: covered by session approval — no re-prompt.
    await handler.handleToolCall({ ...event, toolCallId: "tc-2" }, ctx);
    expect(vi.mocked(prompter.prompt)).toHaveBeenCalledTimes(1);

    // Shutdown clears session approvals.
    session.shutdown();

    // Third access: session rules cleared — must re-prompt.
    await handler.handleToolCall({ ...event, toolCallId: "tc-3" }, ctx);
    expect(vi.mocked(prompter.prompt)).toHaveBeenCalledTimes(2);
  });
});
