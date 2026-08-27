/**
 * Integration tests verifying that sequential tool calls to the same
 * external path only prompt once — the session-approval recorded by the
 * first call covers the second.
 *
 * Uses real PermissionSession + PermissionResolver + SessionRules so the
 * stateful approval-tracking path is exercised end-to-end.
 */

import { describe, expect, it, vi } from "vitest";
import {
  makeApprovingPrompter,
  makeDeduplicatingHandler,
  makeDedupWiring,
  makeExtDirBashEvent,
  makeExtDirToolEvent,
} from "#test/helpers/external-directory-fixtures";
import { makeCtx } from "#test/helpers/handler-fixtures";

// ── SDK stub ───────────────────────────────────────────────────────────────
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return { ...original };
});

// ── tests ──────────────────────────────────────────────────────────────────

describe("external-directory session dedup", () => {
  describe("path-bearing tools (read, write, edit)", () => {
    it("does not re-prompt for the same external path after session approval", async () => {
      const { handler, prompter } = makeDeduplicatingHandler();
      const ctx = makeCtx();
      const externalPath = "/outside/project/data.txt";

      // First call — should prompt
      const event1 = makeExtDirToolEvent("read", externalPath, "tc-1");
      const result1 = await handler.handleToolCall(event1, ctx);
      expect(result1).toEqual({ action: "allow" });
      expect(prompter.escalate).toHaveBeenCalledTimes(1);

      // Second call — same path, should hit session rule, no prompt
      const event2 = makeExtDirToolEvent("read", externalPath, "tc-2");
      const result2 = await handler.handleToolCall(event2, ctx);
      expect(result2).toEqual({ action: "allow" });
      expect(prompter.escalate).toHaveBeenCalledTimes(1);
    });

    it("does not re-prompt for a different file in the same external directory", async () => {
      const { handler, prompter } = makeDeduplicatingHandler();
      const ctx = makeCtx();

      // First call — prompt for /outside/project/a.txt
      const event1 = makeExtDirToolEvent(
        "read",
        "/outside/project/a.txt",
        "tc-1",
      );
      await handler.handleToolCall(event1, ctx);
      expect(prompter.escalate).toHaveBeenCalledTimes(1);

      // Second call — /outside/project/b.txt is in the same directory
      const event2 = makeExtDirToolEvent(
        "read",
        "/outside/project/b.txt",
        "tc-2",
      );
      await handler.handleToolCall(event2, ctx);
      expect(prompter.escalate).toHaveBeenCalledTimes(1);
    });

    it("does prompt for a file in a different external directory", async () => {
      const { handler, prompter } = makeDeduplicatingHandler();
      const ctx = makeCtx();

      // First call — /outside/alpha/file.txt
      const event1 = makeExtDirToolEvent(
        "read",
        "/outside/alpha/file.txt",
        "tc-1",
      );
      await handler.handleToolCall(event1, ctx);
      expect(prompter.escalate).toHaveBeenCalledTimes(1);

      // Second call — /outside/beta/file.txt is a different directory
      const event2 = makeExtDirToolEvent(
        "read",
        "/outside/beta/file.txt",
        "tc-2",
      );
      await handler.handleToolCall(event2, ctx);
      expect(prompter.escalate).toHaveBeenCalledTimes(2);
    });

    it("re-prompts when user approved once (not for session)", async () => {
      const approveOnce = makeApprovingPrompter();
      const { handler, prompter } = makeDeduplicatingHandler(approveOnce);
      const ctx = makeCtx();
      const externalPath = "/outside/project/data.txt";

      // First call — prompt, approved once
      const event1 = makeExtDirToolEvent("read", externalPath, "tc-1");
      await handler.handleToolCall(event1, ctx);
      expect(prompter.escalate).toHaveBeenCalledTimes(1);

      // Second call — no session rule recorded, should prompt again
      const event2 = makeExtDirToolEvent("read", externalPath, "tc-2");
      await handler.handleToolCall(event2, ctx);
      expect(prompter.escalate).toHaveBeenCalledTimes(2);
    });
  });

  describe("bash commands with external paths", () => {
    it("does not re-prompt for a bash command referencing the same external path after session approval", async () => {
      const { handler, prompter } = makeDeduplicatingHandler();
      const ctx = makeCtx();

      // First call — bash reading /tmp/out.txt
      const event1 = makeExtDirBashEvent("cat /tmp/out.txt", "tc-1");
      const result1 = await handler.handleToolCall(event1, ctx);
      expect(result1).toEqual({ action: "allow" });
      expect(prompter.escalate).toHaveBeenCalledTimes(1);

      // Second call — different bash command, same external path, same direction
      const event2 = makeExtDirBashEvent("head -n 5 /tmp/out.txt", "tc-2");
      const result2 = await handler.handleToolCall(event2, ctx);
      expect(result2).toEqual({ action: "allow" });
      expect(prompter.escalate).toHaveBeenCalledTimes(1);
    });

    it("does not re-prompt for read after bash already read the same directory", async () => {
      const { handler, prompter } = makeDeduplicatingHandler();
      const ctx = makeCtx();

      // First call — bash reads /tmp/out.txt
      const event1 = makeExtDirBashEvent("cat /tmp/out.txt", "tc-1");
      await handler.handleToolCall(event1, ctx);
      expect(prompter.escalate).toHaveBeenCalledTimes(1);

      // Second call — read from /tmp/out.txt (same directory, different tool,
      // same direction: `read`'s identity proves the same read the core word did)
      const event2 = makeExtDirToolEvent("read", "/tmp/out.txt", "tc-2");
      await handler.handleToolCall(event2, ctx);
      expect(prompter.escalate).toHaveBeenCalledTimes(1);
    });

    describe("the read/write axis narrows a session grant (#807)", () => {
      it("re-prompts for a read after only a write was approved", async () => {
        const { handler, prompter } = makeDeduplicatingHandler();
        const ctx = makeCtx();

        // The redirect proves a write, so the grant is recorded on
        // `external_directory_write` — the direction the prompt named.
        const event1 = makeExtDirBashEvent("echo hello > /tmp/out.txt", "tc-1");
        await handler.handleToolCall(event1, ctx);
        expect(prompter.escalate).toHaveBeenCalledTimes(1);

        // A read is the other direction, and the two are independent bits
        // rather than tiers (ADR 0013 §3–§4), so a write grant does not cover it.
        const event2 = makeExtDirBashEvent("cat /tmp/out.txt", "tc-2");
        await handler.handleToolCall(event2, ctx);
        expect(prompter.escalate).toHaveBeenCalledTimes(2);
      });

      it("re-prompts for the read tool after only a bash write was approved", async () => {
        const { handler, prompter } = makeDeduplicatingHandler();
        const ctx = makeCtx();

        const event1 = makeExtDirBashEvent("echo hello > /tmp/out.txt", "tc-1");
        await handler.handleToolCall(event1, ctx);
        expect(prompter.escalate).toHaveBeenCalledTimes(1);

        const event2 = makeExtDirToolEvent("read", "/tmp/out.txt", "tc-2");
        await handler.handleToolCall(event2, ctx);
        expect(prompter.escalate).toHaveBeenCalledTimes(2);
      });

      it("covers a later write with an approved write", async () => {
        const { handler, prompter } = makeDeduplicatingHandler();
        const ctx = makeCtx();

        const event1 = makeExtDirBashEvent("echo hello > /tmp/out.txt", "tc-1");
        await handler.handleToolCall(event1, ctx);
        expect(prompter.escalate).toHaveBeenCalledTimes(1);

        const event2 = makeExtDirBashEvent("echo bye >> /tmp/out.txt", "tc-2");
        await handler.handleToolCall(event2, ctx);
        expect(prompter.escalate).toHaveBeenCalledTimes(1);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Moved from permission-system.test.ts catch-all (#342)
// ---------------------------------------------------------------------------

describe("session shutdown clears external-directory approvals", () => {
  it("re-prompts for the same path after session shutdown", async () => {
    const { handler, prompter, session } = makeDedupWiring();

    const externalPath = "/tmp/sibling/foo.ts";
    const ctx = makeCtx();
    const event = makeExtDirToolEvent("read", externalPath, "tc-1");

    // First access: prompt fires and records session approval.
    await handler.handleToolCall(event, ctx);
    expect(vi.mocked(prompter.escalate)).toHaveBeenCalledTimes(1);

    // Second access: covered by session approval — no re-prompt.
    await handler.handleToolCall({ ...event, toolCallId: "tc-2" }, ctx);
    expect(vi.mocked(prompter.escalate)).toHaveBeenCalledTimes(1);

    // Shutdown clears session approvals.
    session.shutdown();

    // Third access: session rules cleared — must re-prompt.
    await handler.handleToolCall({ ...event, toolCallId: "tc-3" }, ctx);
    expect(vi.mocked(prompter.escalate)).toHaveBeenCalledTimes(2);
  });
});
