import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import {
  getEventInput,
  PermissionGateHandler,
} from "../../src/handlers/permission-gate-handler";
import type { PermissionSession } from "../../src/permission-session";
import type { ToolRegistry } from "../../src/tool-registry";
import type { PermissionCheckResult, PermissionState } from "../../src/types";

// ── SDK stubs ──────────────────────────────────────────────────────────────
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return { ...original };
});

// ── helpers ────────────────────────────────────────────────────────────────

function makeCtx(
  overrides: Partial<ExtensionContext> & { cwd?: string } = {},
): ExtensionContext {
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

function makePermissionResult(
  state: "allow" | "deny" | "ask",
): PermissionCheckResult {
  return { state, toolName: "read", source: "tool", origin: "builtin" };
}

function makeSession(
  overrides: Partial<Record<keyof PermissionSession, unknown>> = {},
): PermissionSession {
  return {
    logger: { debug: vi.fn(), review: vi.fn(), warn: vi.fn() },
    activate: vi.fn(),
    resolveAgentName: vi.fn().mockReturnValue(null),
    checkPermission: vi.fn().mockReturnValue(makePermissionResult("allow")),
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

function makeEvents() {
  return {
    emit: vi.fn(),
    on: vi.fn().mockReturnValue(() => undefined),
  };
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
  session: PermissionSession;
  toolRegistry: ToolRegistry;
} {
  const session = makeSession(overrides?.session);
  const events = makeEvents();
  const toolRegistry = makeToolRegistry(overrides?.toolRegistry);
  const handler = new PermissionGateHandler(session, events, toolRegistry);
  return { handler, session, toolRegistry };
}

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
    const { handler, session } = makeHandler();
    await handler.handleToolCall(makeToolCallEvent("read"), ctx);
    expect(session.activate).toHaveBeenCalledWith(ctx);
  });

  it("blocks when tool name cannot be resolved", async () => {
    const { handler } = makeHandler();
    const result = await handler.handleToolCall(
      { type: "tool_call" },
      makeCtx(),
    );
    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining("tool"),
    });
  });

  it("blocks when tool is not registered", async () => {
    const { handler } = makeHandler({
      toolRegistry: {
        getAll: vi.fn().mockReturnValue([{ name: "read" }]),
      },
    });
    const result = await handler.handleToolCall(
      makeToolCallEvent("unknown-tool"),
      makeCtx(),
    );
    expect(result).toMatchObject({ block: true });
  });

  it("returns empty object when tool is allowed", async () => {
    const { handler } = makeHandler();
    const result = await handler.handleToolCall(
      makeToolCallEvent("read"),
      makeCtx(),
    );
    expect(result).toEqual({});
  });

  it("blocks when tool is denied by policy", async () => {
    const { handler } = makeHandler({
      session: {
        checkPermission: vi.fn().mockReturnValue(makePermissionResult("deny")),
      },
    });
    const result = await handler.handleToolCall(
      makeToolCallEvent("read"),
      makeCtx(),
    );
    expect(result).toMatchObject({ block: true });
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
    expect(result).toMatchObject({ block: true });
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
    expect(result).toEqual({});
  });
});

// ── external-directory gate ────────────────────────────────────────────────

describe("handleToolCall — external-directory gate", () => {
  it("blocks a read of a path outside cwd when policy is deny", async () => {
    const { handler } = makeHandler({
      session: {
        checkPermission: vi.fn().mockReturnValue(makePermissionResult("deny")),
      },
      toolRegistry: {
        getAll: vi.fn().mockReturnValue([{ name: "read" }]),
      },
    });
    const event = {
      type: "tool_call",
      toolCallId: "tc-ext",
      name: "read",
      input: { path: "/outside/project/file.ts" },
    };
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toMatchObject({ block: true });
  });
});

// ── bash external-directory gate ──────────────────────────────────────────

describe("handleToolCall — bash external-directory gate", () => {
  it("blocks a bash command referencing an external path when policy is deny", async () => {
    const { handler } = makeHandler({
      session: {
        checkPermission: vi.fn().mockReturnValue(makePermissionResult("deny")),
      },
      toolRegistry: {
        getAll: vi.fn().mockReturnValue([{ name: "bash" }]),
      },
    });
    const event = {
      type: "tool_call",
      toolCallId: "tc-bash-ext",
      name: "bash",
      input: { command: "cat /outside/project/file.ts" },
    };
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toMatchObject({ block: true });
  });
});

// ── path gate (tools) ─────────────────────────────────────────────────────

describe("handleToolCall — path gate (tools)", () => {
  it("blocks a read of .env when path surface denies *.env", async () => {
    const checkPermission = vi
      .fn()
      .mockImplementation(
        (surface: string, _input: unknown, _agentName?: string) => {
          if (surface === "path") {
            return { ...makePermissionResult("deny"), matchedPattern: "*.env" };
          }
          return makePermissionResult("allow");
        },
      );
    const { handler } = makeHandler({
      session: { checkPermission },
      toolRegistry: {
        getAll: vi.fn().mockReturnValue([{ name: "read" }]),
      },
    });
    const event = {
      type: "tool_call",
      toolCallId: "tc-path",
      name: "read",
      input: { path: ".env" },
    };
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toMatchObject({ block: true });
  });

  it("allows a read when path surface allows", async () => {
    const { handler } = makeHandler({
      toolRegistry: {
        getAll: vi.fn().mockReturnValue([{ name: "read" }]),
      },
    });
    const event = {
      type: "tool_call",
      toolCallId: "tc-path-ok",
      name: "read",
      input: { path: "src/index.ts" },
    };
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toEqual({});
  });
});

// ── bash path gate ────────────────────────────────────────────────────────

describe("handleToolCall — bash path gate", () => {
  it("blocks a bash command accessing .env when path surface denies", async () => {
    const checkPermission = vi
      .fn()
      .mockImplementation(
        (surface: string, _input: unknown, _agentName?: string) => {
          if (surface === "path") {
            return { ...makePermissionResult("deny"), matchedPattern: "*.env" };
          }
          return makePermissionResult("allow");
        },
      );
    const { handler } = makeHandler({
      session: { checkPermission },
      toolRegistry: {
        getAll: vi.fn().mockReturnValue([{ name: "bash" }]),
      },
    });
    const event = {
      type: "tool_call",
      toolCallId: "tc-bash-path",
      name: "bash",
      input: { command: "cat .env" },
    };
    const result = await handler.handleToolCall(event, makeCtx());
    expect(result).toMatchObject({ block: true });
  });
});
