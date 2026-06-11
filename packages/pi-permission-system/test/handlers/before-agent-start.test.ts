import { describe, expect, it, vi } from "vitest";

import {
  AgentPrepHandler,
  shouldExposeTool,
} from "#src/handlers/before-agent-start";
import type { ToolRegistry } from "#src/tool-registry";

import { makeCheckResult, makeCtx } from "#test/helpers/handler-fixtures";
import {
  makeRealResolver,
  makeRealSession,
} from "#test/helpers/session-fixtures";

// ── SDK stubs ──────────────────────────────────────────────────────────────
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...original,
    isToolCallEventType: vi.fn().mockReturnValue(false),
  };
});

// ── helpers ────────────────────────────────────────────────────────────────

function makeEvent(systemPrompt = "You are an assistant.") {
  return { systemPrompt };
}

function makeToolRegistry(overrides: Partial<ToolRegistry> = {}): ToolRegistry {
  return {
    getAll: vi.fn().mockReturnValue([]),
    getActive: vi.fn().mockReturnValue([]),
    setActive: vi.fn(),
    ...overrides,
  };
}

function makeSetup(opts?: {
  toolPermission?: "allow" | "deny" | "ask";
  toolRegistry?: Partial<ToolRegistry>;
}) {
  const { session, permissionManager, sessionRules, configStore, forwarding } =
    makeRealSession();
  const { resolver } = makeRealResolver(permissionManager, sessionRules);
  if (opts?.toolPermission !== undefined) {
    vi.mocked(permissionManager.getToolPermission).mockReturnValue(
      opts.toolPermission,
    );
  }
  // Default checkPermission returns allow (for skill-prompt sanitizer)
  vi.mocked(permissionManager.checkPermission).mockReturnValue(
    makeCheckResult(),
  );
  const toolRegistry = makeToolRegistry(opts?.toolRegistry);
  const handler = new AgentPrepHandler(session, resolver, toolRegistry);
  return {
    handler,
    session,
    resolver,
    permissionManager,
    configStore,
    forwarding,
    toolRegistry,
  };
}

// ── shouldExposeTool (pure helper) ─────────────────────────────────────────

describe("shouldExposeTool", () => {
  it("returns true when tool permission is allow", () => {
    const getter = vi.fn().mockReturnValue("allow");
    expect(shouldExposeTool("read", null, getter)).toBe(true);
  });

  it("returns true when tool permission is ask", () => {
    const getter = vi.fn().mockReturnValue("ask");
    expect(shouldExposeTool("bash", "agent-x", getter)).toBe(true);
  });

  it("returns false when tool permission is deny", () => {
    const getter = vi.fn().mockReturnValue("deny");
    expect(shouldExposeTool("write", null, getter)).toBe(false);
  });

  it("passes agentName through to getToolPermission", () => {
    const getter = vi.fn().mockReturnValue("allow");
    shouldExposeTool("read", "my-agent", getter);
    expect(getter).toHaveBeenCalledWith("read", "my-agent");
  });

  it("converts null agentName to undefined for getToolPermission", () => {
    const getter = vi.fn().mockReturnValue("allow");
    shouldExposeTool("read", null, getter);
    expect(getter).toHaveBeenCalledWith("read", undefined);
  });
});

// ── AgentPrepHandler.handle ────────────────────────────────────────────────

describe("AgentPrepHandler.handle", () => {
  it("activates the session with ctx", async () => {
    const ctx = makeCtx();
    const { handler, forwarding } = makeSetup();
    await handler.handle(makeEvent(), ctx);
    // Real session.activate calls forwarding.start
    expect(forwarding.start).toHaveBeenCalledWith(ctx);
  });

  it("refreshes config with ctx", async () => {
    const ctx = makeCtx();
    const { handler, configStore } = makeSetup();
    await handler.handle(makeEvent(), ctx);
    expect(configStore.refresh).toHaveBeenCalledWith(ctx);
  });

  it("resolves agent name using systemPrompt", async () => {
    const ctx = makeCtx();
    const { handler, session } = makeSetup();
    const spy = vi.spyOn(session, "resolveAgentName");
    await handler.handle(makeEvent("<active_agent name='x'>"), ctx);
    expect(spy).toHaveBeenCalledWith(ctx, "<active_agent name='x'>");
  });

  it("filters out denied tools from allowed list", async () => {
    const { handler, toolRegistry } = makeSetup({
      toolPermission: "deny",
      toolRegistry: {
        getActive: vi
          .fn()
          .mockReturnValue([{ name: "write" }, { name: "read" }]),
      },
    });
    await handler.handle(makeEvent(), makeCtx());
    expect(toolRegistry.setActive).toHaveBeenCalledWith([]);
  });

  it("includes allowed and ask tools in the active list", async () => {
    const { handler, toolRegistry } = makeSetup({
      toolRegistry: {
        getActive: vi
          .fn()
          .mockReturnValue([{ name: "read" }, { name: "write" }]),
      },
    });
    await handler.handle(makeEvent(), makeCtx());
    expect(toolRegistry.setActive).toHaveBeenCalledWith(["read", "write"]);
  });

  it("calls setActive once across repeated calls with the same allowed tools", async () => {
    const { handler, toolRegistry } = makeSetup({
      toolRegistry: {
        getActive: vi.fn().mockReturnValue([{ name: "read" }]),
      },
    });
    await handler.handle(makeEvent(), makeCtx());
    await handler.handle(makeEvent(), makeCtx());
    expect(toolRegistry.setActive).toHaveBeenCalledOnce();
  });

  it("returns empty object on repeated calls with unchanged inputs", async () => {
    const { handler } = makeSetup();
    await handler.handle(makeEvent(), makeCtx());
    const result = await handler.handle(makeEvent(), makeCtx());
    expect(result).toEqual({});
  });

  it("stores resolved skill entries on the session", async () => {
    const { handler, session } = makeSetup();
    const spy = vi.spyOn(session, "setActiveSkillEntries");
    await handler.handle(makeEvent(), makeCtx());
    expect(spy).toHaveBeenCalledWith(expect.any(Array));
  });

  it("returns modified systemPrompt when prompt changes", async () => {
    const systemPrompt = `You are an assistant.\n\nAvailable tools:\n- read\n- write\n`;
    const { handler } = makeSetup();
    const result = await handler.handle(makeEvent(systemPrompt), makeCtx());
    expect(result).toHaveProperty("systemPrompt");
  });

  it("returns empty object when systemPrompt is unchanged", async () => {
    const prompt = "No tools section here.";
    const { handler } = makeSetup();
    const result = await handler.handle(makeEvent(prompt), makeCtx());
    expect(result).toEqual({});
  });
});
