import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import {
  extractSkillNameFromInput,
  PermissionGateHandler,
} from "../../src/handlers/permission-gate-handler";
import type { PermissionSession } from "../../src/permission-session";
import type { ToolRegistry } from "../../src/tool-registry";
import type { PermissionState } from "../../src/types";

// ── helpers ────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<ExtensionContext> = {}): ExtensionContext {
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

function makeInputEvent(text: string) {
  return { text };
}

function makeSession(
  overrides: Partial<Record<keyof PermissionSession, unknown>> = {},
): PermissionSession {
  return {
    logger: { debug: vi.fn(), review: vi.fn(), warn: vi.fn() },
    activate: vi.fn(),
    resolveAgentName: vi.fn().mockReturnValue(null),
    checkPermission: vi.fn().mockReturnValue({ state: "allow" }),
    getToolPermission: vi.fn().mockReturnValue("allow" as PermissionState),
    getSessionRuleset: vi.fn().mockReturnValue([]),
    approveSessionRule: vi.fn(),
    refreshConfig: vi.fn(),
    canPrompt: vi.fn().mockReturnValue(true),
    prompt: vi.fn().mockResolvedValue({ approved: true, state: "approved" }),
    createPermissionRequestId: vi.fn().mockReturnValue("req-id"),
    ...overrides,
  } as unknown as PermissionSession;
}

function makeEvents() {
  return {
    emit: vi.fn(),
    on: vi.fn().mockReturnValue(() => undefined),
  };
}

function makeToolRegistry(): ToolRegistry {
  return {
    getAll: vi.fn().mockReturnValue([]),
    setActive: vi.fn(),
  };
}

function makeHandler(overrides?: {
  session?: Partial<Record<keyof PermissionSession, unknown>>;
}): {
  handler: PermissionGateHandler;
  session: PermissionSession;
} {
  const session = makeSession(overrides?.session);
  const events = makeEvents();
  const toolRegistry = makeToolRegistry();
  const handler = new PermissionGateHandler(session, events, toolRegistry);
  return { handler, session };
}

// ── extractSkillNameFromInput ──────────────────────────────────────────────

describe("extractSkillNameFromInput", () => {
  it("returns null for plain text", () => {
    expect(extractSkillNameFromInput("hello world")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractSkillNameFromInput("")).toBeNull();
  });

  it("returns null for bare /skill: with no name", () => {
    expect(extractSkillNameFromInput("/skill:")).toBeNull();
  });

  it("extracts skill name from /skill:<name>", () => {
    expect(extractSkillNameFromInput("/skill:librarian")).toBe("librarian");
  });

  it("extracts skill name stopping at whitespace", () => {
    expect(extractSkillNameFromInput("/skill:librarian some extra")).toBe(
      "librarian",
    );
  });

  it("trims leading whitespace before the prefix", () => {
    expect(extractSkillNameFromInput("  /skill:my-skill")).toBe("my-skill");
  });

  it("returns null when the skill name after trimming is empty", () => {
    expect(extractSkillNameFromInput("/skill: ")).toBeNull();
  });
});

// ── handleInput ───────────────────────────────────────────────────────────

describe("handleInput", () => {
  it("activates session with ctx", async () => {
    const ctx = makeCtx();
    const { handler, session } = makeHandler();
    await handler.handleInput(makeInputEvent("hello"), ctx);
    expect(session.activate).toHaveBeenCalledWith(ctx);
  });

  it("returns continue for non-skill input", async () => {
    const { handler } = makeHandler();
    const result = await handler.handleInput(
      makeInputEvent("just a message"),
      makeCtx(),
    );
    expect(result).toEqual({ action: "continue" });
  });

  it("does not check permissions for non-skill input", async () => {
    const { handler, session } = makeHandler();
    await handler.handleInput(makeInputEvent("just a message"), makeCtx());
    expect(session.checkPermission).not.toHaveBeenCalled();
  });

  it("returns continue when skill is allowed", async () => {
    const { handler } = makeHandler();
    const result = await handler.handleInput(
      makeInputEvent("/skill:librarian"),
      makeCtx(),
    );
    expect(result).toEqual({ action: "continue" });
  });

  it("returns handled when skill is denied", async () => {
    const { handler } = makeHandler({
      session: {
        checkPermission: vi.fn().mockReturnValue({ state: "deny" }),
      },
    });
    const result = await handler.handleInput(
      makeInputEvent("/skill:librarian"),
      makeCtx(),
    );
    expect(result).toEqual({ action: "handled" });
  });

  it("shows a warning notification when skill is denied and UI is available", async () => {
    const ctx = makeCtx({ hasUI: true });
    const { handler } = makeHandler({
      session: {
        checkPermission: vi.fn().mockReturnValue({ state: "deny" }),
      },
    });
    await handler.handleInput(makeInputEvent("/skill:librarian"), ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("librarian"),
      "warning",
    );
  });

  it("does not show a warning notification when skill is denied and UI is absent", async () => {
    const ctx = makeCtx({ hasUI: false });
    const { handler } = makeHandler({
      session: {
        checkPermission: vi.fn().mockReturnValue({ state: "deny" }),
      },
    });
    await handler.handleInput(makeInputEvent("/skill:librarian"), ctx);
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  it("returns handled when skill requires approval but no UI is available", async () => {
    const { handler } = makeHandler({
      session: {
        checkPermission: vi.fn().mockReturnValue({ state: "ask" }),
        canPrompt: vi.fn().mockReturnValue(false),
      },
    });
    const result = await handler.handleInput(
      makeInputEvent("/skill:librarian"),
      makeCtx(),
    );
    expect(result).toEqual({ action: "handled" });
  });

  it("prompts and returns continue when skill ask is approved", async () => {
    const { handler, session } = makeHandler({
      session: {
        checkPermission: vi.fn().mockReturnValue({ state: "ask" }),
        prompt: vi
          .fn()
          .mockResolvedValue({ approved: true, state: "approved" }),
      },
    });
    const result = await handler.handleInput(
      makeInputEvent("/skill:librarian"),
      makeCtx(),
    );
    expect(result).toEqual({ action: "continue" });
    expect(session.prompt).toHaveBeenCalledOnce();
  });

  it("returns handled when skill ask is denied by user", async () => {
    const { handler } = makeHandler({
      session: {
        checkPermission: vi.fn().mockReturnValue({ state: "ask" }),
        prompt: vi.fn().mockResolvedValue({ approved: false, state: "denied" }),
      },
    });
    const result = await handler.handleInput(
      makeInputEvent("/skill:librarian"),
      makeCtx(),
    );
    expect(result).toEqual({ action: "handled" });
  });

  it("passes agentName in the prompt permission request", async () => {
    const { handler, session } = makeHandler({
      session: {
        checkPermission: vi.fn().mockReturnValue({ state: "ask" }),
        resolveAgentName: vi.fn().mockReturnValue("code-agent"),
        prompt: vi
          .fn()
          .mockResolvedValue({ approved: true, state: "approved" }),
      },
    });
    await handler.handleInput(makeInputEvent("/skill:librarian"), makeCtx());
    expect(session.prompt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        agentName: "code-agent",
        skillName: "librarian",
      }),
    );
  });
});
