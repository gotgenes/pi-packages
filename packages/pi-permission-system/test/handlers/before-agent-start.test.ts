import { describe, expect, it, vi } from "vitest";

import {
  AgentPrepHandler,
  shouldExposeTool,
} from "#src/handlers/before-agent-start";
import { SessionTurnPrep } from "#src/handlers/session-turn-prep";
import type { ToolRegistry } from "#src/tool-registry";

import {
  makeCheckResult,
  makeCtx,
  makeStatefulToolRegistry,
  makeToolRegistry,
} from "#test/helpers/handler-fixtures";
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

function makeSetup(opts?: {
  toolFullyDenied?: boolean;
  toolRegistry?: Partial<ToolRegistry>;
  registry?: ToolRegistry;
}) {
  const { session, permissionManager, sessionRules, configStore, forwarding } =
    makeRealSession();
  const { resolver } = makeRealResolver(permissionManager, sessionRules);
  if (opts?.toolFullyDenied !== undefined) {
    vi.mocked(permissionManager.isToolFullyDenied).mockReturnValue(
      opts.toolFullyDenied,
    );
  }
  // Default check returns allow (for skill-prompt sanitizer via resolver.checkPermission)
  vi.mocked(permissionManager.check).mockReturnValue(makeCheckResult());
  const toolRegistry = opts?.registry ?? makeToolRegistry(opts?.toolRegistry);
  const warmParser = vi.fn();
  // A real SessionTurnPrep over the same session: the tool-filtering and
  // prompt-sanitization assertions below read state an activated session owns,
  // so a `{ prepare: vi.fn() }` double would quietly change what they exercise.
  const turnPrep = new SessionTurnPrep(session, warmParser, {
    announceReady: vi.fn(),
  });
  const handler = new AgentPrepHandler(
    turnPrep,
    session,
    resolver,
    toolRegistry,
  );
  return {
    handler,
    turnPrep,
    session,
    resolver,
    permissionManager,
    configStore,
    forwarding,
    toolRegistry,
    warmParser,
  };
}

// ── shouldExposeTool (pure helper) ─────────────────────────────────────────

describe("shouldExposeTool", () => {
  it("returns true when some value under the surface is reachable", () => {
    const isFullyDenied = vi.fn().mockReturnValue(false);
    expect(shouldExposeTool("read", null, isFullyDenied)).toBe(true);
  });

  it("returns false when every value under the surface is denied", () => {
    const isFullyDenied = vi.fn().mockReturnValue(true);
    expect(shouldExposeTool("write", null, isFullyDenied)).toBe(false);
  });

  it("passes agentName through to isToolFullyDenied", () => {
    const isFullyDenied = vi.fn().mockReturnValue(false);
    shouldExposeTool("read", "my-agent", isFullyDenied);
    expect(isFullyDenied).toHaveBeenCalledWith("read", "my-agent");
  });

  it("converts null agentName to undefined for isToolFullyDenied", () => {
    const isFullyDenied = vi.fn().mockReturnValue(false);
    shouldExposeTool("read", null, isFullyDenied);
    expect(isFullyDenied).toHaveBeenCalledWith("read", undefined);
  });
});

// ── AgentPrepHandler.handle ────────────────────────────────────────────────

describe("AgentPrepHandler.handle", () => {
  it("prepares the session for the turn before reading its state", async () => {
    const ctx = makeCtx();
    const { handler, turnPrep, session } = makeSetup();
    const order: string[] = [];
    vi.spyOn(turnPrep, "prepare").mockImplementation(() => {
      order.push("prepare");
    });
    vi.spyOn(session, "resolveAgentName").mockImplementation(() => {
      order.push("resolveAgentName");
      return null;
    });
    await handler.handle(makeEvent(), ctx);
    expect(order).toEqual(["prepare", "resolveAgentName"]);
    expect(turnPrep.prepare).toHaveBeenCalledWith(ctx);
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
      toolFullyDenied: true,
      toolRegistry: {
        getActive: vi.fn().mockReturnValue(["write", "read"]),
      },
    });
    await handler.handle(makeEvent(), makeCtx());
    expect(toolRegistry.setActive).toHaveBeenCalledWith([]);
  });

  it("includes allowed and ask tools in the active list", async () => {
    const { handler, toolRegistry } = makeSetup({
      toolRegistry: {
        getActive: vi.fn().mockReturnValue(["read", "write"]),
      },
    });
    await handler.handle(makeEvent(), makeCtx());
    expect(toolRegistry.setActive).toHaveBeenCalledWith(["read", "write"]);
  });

  it("does not activate registered tools pi left inactive (find/grep/ls)", async () => {
    // Regression for #385: the active set is the base, not the full registry.
    const { handler, toolRegistry } = makeSetup({
      toolRegistry: {
        getActive: vi.fn().mockReturnValue(["read", "bash", "edit", "write"]),
        getAll: vi
          .fn()
          .mockReturnValue([
            { name: "read" },
            { name: "bash" },
            { name: "edit" },
            { name: "write" },
            { name: "find" },
            { name: "grep" },
            { name: "ls" },
          ]),
      },
    });
    await handler.handle(makeEvent(), makeCtx());
    expect(toolRegistry.setActive).toHaveBeenCalledWith([
      "read",
      "bash",
      "edit",
      "write",
    ]);
  });

  it("calls setActive on every turn (no dedup gate)", async () => {
    const { handler, toolRegistry } = makeSetup({
      toolRegistry: {
        getActive: vi.fn().mockReturnValue(["read"]),
      },
    });
    await handler.handle(makeEvent(), makeCtx());
    await handler.handle(makeEvent(), makeCtx());
    expect(toolRegistry.setActive).toHaveBeenCalledTimes(2);
  });

  it("filters a denied skill from the systemPrompt on every turn, not just the first", async () => {
    const systemPrompt = [
      "You are an assistant.",
      "",
      "<available_skills>",
      "  <skill>",
      "    <name>secret</name>",
      "    <description>A denied skill</description>",
      "    <location>/skills/secret/SKILL.md</location>",
      "  </skill>",
      "</available_skills>",
    ].join("\n");
    const { handler, permissionManager } = makeSetup();
    vi.mocked(permissionManager.check).mockImplementation((intent) =>
      intent.surface === "skill"
        ? makeCheckResult({ state: "deny" })
        : makeCheckResult(),
    );

    const first = await handler.handle(makeEvent(systemPrompt), makeCtx());
    const second = await handler.handle(makeEvent(systemPrompt), makeCtx());

    expect(first).toHaveProperty("systemPrompt");
    expect((first as { systemPrompt: string }).systemPrompt).not.toContain(
      "secret",
    );
    expect(second).toHaveProperty("systemPrompt");
    expect((second as { systemPrompt: string }).systemPrompt).not.toContain(
      "secret",
    );
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

  it("narrows a denied tool out of the Available tools listing without removing the section", async () => {
    const systemPrompt = [
      "Available tools:",
      "- read: Read file contents",
      "- bash: Run shell commands",
    ].join("\n");
    const { handler, permissionManager } = makeSetup({
      toolRegistry: {
        getActive: vi.fn().mockReturnValue(["read", "bash"]),
      },
    });
    vi.mocked(permissionManager.isToolFullyDenied).mockImplementation(
      (tool) => tool === "bash",
    );

    const result = await handler.handle(makeEvent(systemPrompt), makeCtx());

    expect(result.systemPrompt).toBeDefined();
    const out = result.systemPrompt ?? "";
    expect(out).toContain("Available tools:");
    expect(out).toContain("- read: Read file contents");
    expect(out).not.toContain("- bash");
  });

  it("keeps the wire system prompt byte-stable across the tool-listing drift between turns", async () => {
    const fullProse = [
      "You are an assistant.",
      "",
      "Available tools:",
      "- bash: Run shell commands",
      "- read: Read file contents",
      "- edit: Edit a file",
      "- write: Write a file",
      "",
      "Guidelines:",
      "- use bash for file operations like ls, rg, find",
      "- use read to examine files instead of cat or sed.",
      "- Be concise in your responses",
    ].join("\n");
    const narrowedProse = [
      "You are an assistant.",
      "",
      "Available tools:",
      "- read: Read file contents",
      "- edit: Edit a file",
      "- write: Write a file",
      "",
      "Guidelines:",
      "- use read to examine files instead of cat or sed.",
      "- Be concise in your responses",
    ].join("\n");
    const { handler, permissionManager } = makeSetup({
      toolRegistry: {
        getActive: vi.fn().mockReturnValue(["bash", "read", "edit", "write"]),
      },
    });
    vi.mocked(permissionManager.isToolFullyDenied).mockImplementation(
      (tool) => tool === "bash",
    );

    // Turn 1: Pi feeds the full default listing.
    const first = await handler.handle(makeEvent(fullProse), makeCtx());
    // Turn 2: Pi's setActive rebuild means the event now carries the narrowed
    // listing, so the override the handler returns must still match turn 1.
    const second = await handler.handle(makeEvent(narrowedProse), makeCtx());

    const wire1 = first.systemPrompt ?? fullProse;
    const wire2 = second.systemPrompt ?? narrowedProse;
    expect(wire1).toBe(narrowedProse);
    expect(wire2).toBe(narrowedProse);
  });

  describe("policy changes across turns", () => {
    const PI_DEFAULTS = ["read", "bash", "edit", "write"];
    const LAUNCHED_WITH = [...PI_DEFAULTS, "ls", "find", "grep"];

    function denyOnly(deniedTool: string) {
      return (toolName: string) => toolName === deniedTool;
    }

    it("restores a tool after its deny rule is removed, without a restart", async () => {
      const registry = makeStatefulToolRegistry({ active: LAUNCHED_WITH });
      const { handler, permissionManager } = makeSetup({ registry });

      await handler.handle(makeEvent(), makeCtx());
      expect(registry.getActive()).toEqual(LAUNCHED_WITH);

      vi.mocked(permissionManager.isToolFullyDenied).mockImplementation(
        denyOnly("ls"),
      );
      await handler.handle(makeEvent(), makeCtx());
      expect(registry.getActive()).toEqual([
        "read",
        "bash",
        "edit",
        "write",
        "find",
        "grep",
      ]);

      vi.mocked(permissionManager.isToolFullyDenied).mockReturnValue(false);
      await handler.handle(makeEvent(), makeCtx());
      expect(registry.getActive()).toEqual(LAUNCHED_WITH);
    });

    it("keeps a tool withheld for as long as its deny rule stands", async () => {
      const registry = makeStatefulToolRegistry({ active: LAUNCHED_WITH });
      const { handler, permissionManager } = makeSetup({ registry });
      vi.mocked(permissionManager.isToolFullyDenied).mockImplementation(
        denyOnly("ls"),
      );

      await handler.handle(makeEvent(), makeCtx());
      await handler.handle(makeEvent(), makeCtx());
      await handler.handle(makeEvent(), makeCtx());

      expect(registry.getActive()).not.toContain("ls");
    });

    it("does not activate a registered tool pi left inactive when the policy relaxes", async () => {
      const registry = makeStatefulToolRegistry({
        active: PI_DEFAULTS,
        registered: LAUNCHED_WITH,
      });
      const { handler, permissionManager } = makeSetup({ registry });
      vi.mocked(permissionManager.isToolFullyDenied).mockImplementation(
        denyOnly("bash"),
      );

      await handler.handle(makeEvent(), makeCtx());
      vi.mocked(permissionManager.isToolFullyDenied).mockReturnValue(false);
      await handler.handle(makeEvent(), makeCtx());

      expect(registry.getActive()).toEqual(PI_DEFAULTS);
    });
  });
});
