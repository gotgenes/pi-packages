import { describe, expect, it, vi } from "vitest";

import { getEventInput } from "#src/handlers/permission-gate-handler";
import { findEvidence } from "#src/presentation/prompt-payload";

import {
  makeBashCommandCheck,
  makeCheckResult,
  makeCtx,
  makeHandler,
  makeSurfaceCheck,
  makeToolCallEvent,
} from "#test/helpers/handler-fixtures";

// ── SDK stubs ──────────────────────────────────────────────────────────────
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return { ...original };
});

// ── getEventInput ──────────────────────────────────────────────────────────

describe("getEventInput", () => {
  it("returns the input field when present", () => {
    expect(getEventInput({ input: { path: "/foo" } })).toEqual({
      path: "/foo",
    });
  });

  it("returns the arguments field when input is absent", () => {
    expect(getEventInput({ arguments: { command: "ls" } })).toEqual({
      command: "ls",
    });
  });

  it("returns empty object when neither field is present", () => {
    expect(getEventInput({ type: "tool_call" })).toEqual({});
  });

  it("prefers input over arguments when both are present", () => {
    expect(getEventInput({ input: { a: 1 }, arguments: { b: 2 } })).toEqual({
      a: 1,
    });
  });
});

// ── handleToolCall ─────────────────────────────────────────────────────────

describe("handleToolCall", () => {
  it("activates session with ctx", async () => {
    const ctx = makeCtx();
    const { handler, forwarding } = makeHandler();
    await handler.handleToolCall(makeToolCallEvent("read"), ctx);
    // session.activate(ctx) calls forwarding.start(ctx) on the real session
    expect(forwarding.start).toHaveBeenCalledWith(ctx);
  });

  it("blocks when tool name cannot be resolved", async () => {
    const { handler } = makeHandler();
    const result = await handler.handleToolCall(
      { type: "tool_call" },
      makeCtx(),
    );
    expect(result).toEqual({
      action: "block",
      reason: expect.stringContaining("tool"),
    });
  });

  it("blocks when tool is not registered", async () => {
    const { handler } = makeHandler({ tools: ["read"] });
    const result = await handler.handleToolCall(
      makeToolCallEvent("unknown-tool"),
      makeCtx(),
    );
    expect(result).toMatchObject({ action: "block" });
  });

  it("returns empty object when tool is allowed", async () => {
    const { handler } = makeHandler();
    const result = await handler.handleToolCall(
      makeToolCallEvent("read"),
      makeCtx(),
    );
    expect(result).toEqual({ action: "allow" });
  });

  it("blocks when tool is denied by policy", async () => {
    const { handler } = makeHandler({
      session: {
        checkPermission: vi
          .fn()
          .mockReturnValue(makeCheckResult({ state: "deny" })),
      },
    });
    const result = await handler.handleToolCall(
      makeToolCallEvent("read"),
      makeCtx(),
    );
    expect(result).toMatchObject({ action: "block" });
  });
});

// ── skill-read gate ────────────────────────────────────────────────────────

describe("handleToolCall — skill-read gate", () => {
  it("blocks a read of a denied skill path", async () => {
    const skillEntry = {
      name: "librarian",
      description: "Research skills",
      location: "/skills/librarian/SKILL.md",
      state: "deny" as const,
      normalizedLocation: "/skills/librarian/SKILL.md",
      normalizedBaseDir: "/skills/librarian",
    };
    const { handler } = makeHandler({
      session: {
        getActiveSkillEntries: vi.fn().mockReturnValue([skillEntry]),
      },
      toolRegistry: {
        getAll: vi.fn().mockReturnValue([{ toolName: "read" }]),
      },
    });
    const event = {
      type: "tool_call",
      toolCallId: "tc-skill",
      toolName: "read",
      input: { path: "/skills/librarian/SKILL.md" },
    };
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toMatchObject({ action: "block" });
  });

  it("allows a read of a non-skill path even when skill entries are present", async () => {
    const skillEntry = {
      name: "librarian",
      description: "Research skills",
      location: "/skills/librarian/SKILL.md",
      state: "deny" as const,
      normalizedLocation: "/skills/librarian/SKILL.md",
      normalizedBaseDir: "/skills/librarian",
    };
    const { handler } = makeHandler({
      session: {
        getActiveSkillEntries: vi.fn().mockReturnValue([skillEntry]),
      },
      toolRegistry: {
        getAll: vi.fn().mockReturnValue([{ toolName: "read" }]),
      },
    });
    const event = {
      type: "tool_call",
      toolCallId: "tc-ok",
      toolName: "read",
      input: { path: "/test/project/src/index.ts" },
    };
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toEqual({ action: "allow" });
  });
});

// ── external-directory gate ────────────────────────────────────────────────

describe("handleToolCall — external-directory gate", () => {
  it("blocks a read of a path outside cwd when policy is deny", async () => {
    const { handler } = makeHandler({
      session: {
        checkPermission: vi
          .fn()
          .mockReturnValue(makeCheckResult({ state: "deny" })),
      },
      tools: ["read"],
    });
    const event = makeToolCallEvent("read", {
      input: { path: "/outside/project/file.ts" },
    });
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toMatchObject({ action: "block" });
  });
});

// ── bash external-directory gate ──────────────────────────────────────────

describe("handleToolCall — bash external-directory gate", () => {
  it("blocks a bash command referencing an external path when policy is deny", async () => {
    const { handler } = makeHandler({
      session: {
        checkPermission: vi
          .fn()
          .mockReturnValue(makeCheckResult({ state: "deny" })),
      },
      tools: ["bash"],
    });
    const event = makeToolCallEvent("bash", {
      input: { command: "cat /outside/project/file.ts" },
    });
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toMatchObject({ action: "block" });
  });
});

// ── path gate (tools) ─────────────────────────────────────────────────────

describe("handleToolCall — path gate (tools)", () => {
  it("blocks a read of .env when path surface denies *.env", async () => {
    const { handler } = makeHandler({
      session: {
        checkPermission: makeSurfaceCheck({
          path: { state: "deny", matchedPattern: "*.env" },
        }),
      },
      tools: ["read"],
    });
    const event = makeToolCallEvent("read", { input: { path: ".env" } });
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toMatchObject({ action: "block" });
  });

  it("allows a read when path surface allows", async () => {
    const { handler } = makeHandler({ tools: ["read"] });
    const event = makeToolCallEvent("read", {
      input: { path: "src/index.ts" },
    });
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toEqual({ action: "allow" });
  });
});

// ── bash path gate ────────────────────────────────────────────────────────

describe("handleToolCall — bash path gate", () => {
  it("blocks a bash command accessing .env when path surface denies", async () => {
    const { handler } = makeHandler({
      session: {
        checkPermission: makeSurfaceCheck({
          path: { state: "deny", matchedPattern: "*.env" },
        }),
      },
      tools: ["bash"],
    });
    const event = makeToolCallEvent("bash", { input: { command: "cat .env" } });
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toMatchObject({ action: "block" });
  });
});

// ── bash command chain gate ───────────────────────────────────────────────

describe("handleToolCall — bash command chain gate", () => {
  it("blocks a chain when a later sub-command is denied (#301)", async () => {
    const { handler } = makeHandler({
      session: {
        checkPermission: makeBashCommandCheck({
          deny: /^npm\b/,
          denyMatched: "npm *",
          allowMatched: "echo *",
        }),
      },
      tools: ["bash"],
    });
    const event = makeToolCallEvent("bash", {
      input: { command: "echo start && npm install compromised-package" },
    });
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toMatchObject({ action: "block" });
  });

  it("blocks a command nested inside command substitution (#306)", async () => {
    const { handler } = makeHandler({
      session: {
        checkPermission: makeBashCommandCheck({
          deny: /^rm\b/,
          denyMatched: "rm *",
          allowMatched: "echo *",
        }),
      },
      tools: ["bash"],
    });
    const event = makeToolCallEvent("bash", {
      input: { command: "echo $(rm -rf foo)" },
    });
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toMatchObject({ action: "block" });
  });

  it("allows a single non-chained bash command", async () => {
    const { handler } = makeHandler({ tools: ["bash"] });
    const event = makeToolCallEvent("bash", { input: { command: "echo hi" } });
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toEqual({ action: "allow" });
  });
});

// ---------------------------------------------------------------------------
// Moved from permission-system.test.ts catch-all (#342)
// ---------------------------------------------------------------------------

describe("handleToolCall — bash external-directory policy states", () => {
  it("allows bash command with only internal paths when external_directory is denied", async () => {
    const { handler } = makeHandler({ tools: ["bash"] });
    const event = makeToolCallEvent("bash", {
      input: { command: "cat src/index.ts" },
    });
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toEqual({ action: "allow" });
  });

  it("blocks bash command with external path when external_directory is ask and no UI", async () => {
    const { handler } = makeHandler({
      session: {
        checkPermission: makeSurfaceCheck({
          external_directory: { state: "ask", source: "special" },
        }),
      },
      tools: ["bash"],
      prompter: {
        escalate: vi.fn().mockResolvedValue({
          approved: false,
          state: "denied",
          confirmationUnavailable: true,
        }),
      },
    });
    const event = makeToolCallEvent("bash", {
      input: { command: "cat /etc/hosts" },
    });
    const result = await handler.handleToolCall(
      event,
      makeCtx({ hasUI: false }),
    );
    expect(result).toMatchObject({ action: "block" });
    expect(String((result as { reason?: unknown }).reason)).toMatch(
      /no interactive UI/i,
    );
  });

  it("allows bash command with external path when external_directory is allow", async () => {
    const { handler } = makeHandler({
      session: {
        checkPermission: makeSurfaceCheck({
          external_directory: { state: "allow", source: "special" },
        }),
      },
      tools: ["bash"],
    });
    const event = makeToolCallEvent("bash", {
      input: { command: "cat /etc/hosts" },
    });
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toEqual({ action: "allow" });
  });

  it("applies bash pattern deny after external_directory allow", async () => {
    const { handler } = makeHandler({
      session: {
        checkPermission: makeSurfaceCheck(
          {
            external_directory: { state: "allow", source: "special" },
            bash: { state: "deny", source: "bash" },
          },
          { state: "allow" },
        ),
      },
      tools: ["bash"],
    });
    const event = makeToolCallEvent("bash", {
      input: { command: "cat /etc/hosts" },
    });
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toMatchObject({ action: "block" });
  });
});

describe("handleToolCall — generic ask prompt content", () => {
  it("ask prompt includes serialized tool input for informed approval", async () => {
    const { handler, prompter } = makeHandler({
      session: {
        checkPermission: makeSurfaceCheck({
          weather_lookup: { state: "ask" },
        }),
      },
      tools: ["weather_lookup"],
      prompter: {
        escalate: vi
          .fn()
          .mockResolvedValue({ approved: false, state: "denied" }),
      },
    });
    const event = makeToolCallEvent("weather_lookup", {
      input: { city: "Chicago", units: "metric" },
    });
    await handler.handleToolCall(event, makeCtx());
    expect(vi.mocked(prompter.escalate)).toHaveBeenCalledTimes(1);
    const promptDetails = vi.mocked(prompter.escalate).mock.calls[0][0];
    expect(findEvidence(promptDetails.payload, "input")?.text).toMatch(
      /\{"city":"Chicago","units":"metric"\}/,
    );
  });
});
