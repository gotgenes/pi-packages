import type { BuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { ToolRegistry } from "#src/exposure/tool-registry";
import {
  AgentPrepHandler,
  shouldExposeTool,
} from "#src/handlers/before-agent-start";
import { SessionTurnPrep } from "#src/handlers/session-turn-prep";

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

function makeEvent(
  systemPrompt = "You are an assistant.",
  systemPromptOptions: Partial<BuildSystemPromptOptions> = {},
) {
  return {
    systemPrompt,
    systemPromptOptions: {
      cwd: "/test/project",
      toolSnippets: {},
      promptGuidelines: [],
      ...systemPromptOptions,
    },
  };
}

function makeSetup(opts?: {
  toolFullyDenied?: boolean;
  toolRegistry?: Partial<ToolRegistry>;
  registry?: ToolRegistry;
}) {
  const {
    session,
    permissionManager,
    sessionRules,
    configStore,
    forwarding,
    logger,
  } = makeRealSession();
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
    logger,
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
    logger,
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

  it("returns the same override on repeated calls with unchanged inputs", async () => {
    const { handler } = makeSetup();
    const first = await handler.handle(makeEvent(), makeCtx());
    const second = await handler.handle(makeEvent(), makeCtx());
    expect(second.systemPrompt).toBe(first.systemPrompt);
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
  it("normalizes an OMP array prompt before resolving the active agent", async () => {
    const { handler, session } = makeSetup();
    const resolveAgentName = vi.spyOn(session, "resolveAgentName");

    await handler.handle(
      makeEvent([
        "You are an assistant.",
        "<active_agent name='worker'>",
      ] as unknown as string),
      makeCtx(),
    );

    expect(resolveAgentName).toHaveBeenCalledWith(
      expect.anything(),
      "You are an assistant.\n<active_agent name='worker'>",
    );
  });

  it("states the session's tools for a prompt that carries no tool surface", async () => {
    // A subagent child's inherited identity has none: its parent's node already
    // relocated the surface out of the region the child copies (#890).
    const prompt = "No tools section here.";
    const { handler } = makeSetup({
      toolRegistry: { getActive: vi.fn().mockReturnValue(["read"]) },
    });

    const result = await handler.handle(
      makeEvent(prompt, { toolSnippets: { read: "Read file contents" } }),
      makeCtx(),
    );

    expect(result.systemPrompt).toContain(
      "Available tools:\n- read: Read file contents",
    );
    expect(result.systemPrompt?.startsWith(prompt)).toBe(true);
  });

  it("states the allowed tools instead of editing the listing Pi wrote", async () => {
    const identity = "You are an assistant.";
    const systemPrompt = [
      identity,
      "",
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

    const result = await handler.handle(
      makeEvent(systemPrompt, {
        toolSnippets: {
          read: "Read file contents",
          bash: "Run shell commands",
        },
      }),
      makeCtx(),
    );

    const out = result.systemPrompt ?? "";
    // The identity Pi wrote is left alone; the surface is restated after it.
    expect(out.startsWith(identity)).toBe(true);
    expect(out).toContain("Available tools:\n- read: Read file contents");
    expect(out).not.toContain("- bash");
  });

  it("carries the registry's guidelines for allowed tools and drops a denied tool's", async () => {
    // The whole path: toolRegistry.getAll() -> readRegisteredTools ->
    // guidelinesByTool -> renderToolSurface. The unit tests cover each hop; this
    // pins that the handler actually connects them.
    const { handler, permissionManager } = makeSetup();
    vi.mocked(permissionManager.isToolFullyDenied).mockImplementation(
      (tool) => tool === "bash",
    );

    const result = await handler.handle(makeEvent(), makeCtx());

    expect(result.systemPrompt).toContain("- Use read to examine files.");
    expect(result.systemPrompt).not.toContain("Use bash for file operations.");
  });

  it("keeps the wire system prompt stable across the tool-listing drift between turns", async () => {
    const fullProse = [
      "You are an assistant.",
      "",
      "Available tools:",
      "- bash: Run shell commands",
      "- read: Read file contents",
      "- edit: Edit a file",
      "",
      "Guidelines:",
      "- Use bash for file operations like ls, rg, find",
      "- Be concise in your responses",
    ].join("\n");
    const narrowedProse = [
      "You are an assistant.",
      "",
      "Available tools:",
      "- read: Read file contents",
      "- edit: Edit a file",
      "",
      "Guidelines:",
      "- Be concise in your responses",
    ].join("\n");
    const snippets = {
      bash: "Run shell commands",
      read: "Read file contents",
      edit: "Edit a file",
    };
    const { handler, permissionManager } = makeSetup({
      toolRegistry: {
        getActive: vi.fn().mockReturnValue(["bash", "read", "edit"]),
      },
    });
    vi.mocked(permissionManager.isToolFullyDenied).mockImplementation(
      (tool) => tool === "bash",
    );

    // Turn 1: Pi feeds the full default listing.
    const first = await handler.handle(
      makeEvent(fullProse, { toolSnippets: snippets }),
      makeCtx(),
    );
    // Turn 2: Pi's setActive rebuild means the event now carries the narrowed
    // listing, so the override the handler returns must still match turn 1.
    const second = await handler.handle(
      makeEvent(narrowedProse, { toolSnippets: snippets }),
      makeCtx(),
    );

    expect(second.systemPrompt).toBe(first.systemPrompt);
    expect(first.systemPrompt).toBe(
      [
        "You are an assistant.",
        "",
        "Available tools:",
        "- read: Read file contents",
        "- edit: Edit a file",
        "",
        "Guidelines:",
        "- Use read to examine files.",
        "- Be concise in your responses",
        "- Show file paths clearly when working with files",
      ].join("\n"),
    );
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

    it("does not reactivate a withheld tool that pi unregistered and re-registered", async () => {
      const registry = makeStatefulToolRegistry({ active: LAUNCHED_WITH });
      const { handler, permissionManager } = makeSetup({ registry });
      vi.mocked(permissionManager.isToolFullyDenied).mockImplementation(
        denyOnly("ls"),
      );

      await handler.handle(makeEvent(), makeCtx());
      registry.unregister("ls");
      await handler.handle(makeEvent(), makeCtx());
      registry.register("ls");
      vi.mocked(permissionManager.isToolFullyDenied).mockReturnValue(false);
      await handler.handle(makeEvent(), makeCtx());

      expect(registry.getActive()).not.toContain("ls");
    });

    it("records the withheld tools on the debug stream when the surface changes", async () => {
      const registry = makeStatefulToolRegistry({ active: LAUNCHED_WITH });
      const { handler, permissionManager, logger } = makeSetup({ registry });
      vi.mocked(permissionManager.isToolFullyDenied).mockImplementation(
        denyOnly("ls"),
      );

      await handler.handle(makeEvent(), makeCtx());

      expect(logger.debug).toHaveBeenCalledWith("tool_surface.changed", {
        exposed: ["read", "bash", "edit", "write", "find", "grep"],
        withheld: ["ls"],
        restored: [],
      });
    });

    it("records the restored tools when a rule is relaxed", async () => {
      const registry = makeStatefulToolRegistry({ active: LAUNCHED_WITH });
      const { handler, permissionManager, logger } = makeSetup({ registry });
      vi.mocked(permissionManager.isToolFullyDenied).mockImplementation(
        denyOnly("ls"),
      );
      await handler.handle(makeEvent(), makeCtx());
      vi.mocked(logger.debug).mockClear();

      vi.mocked(permissionManager.isToolFullyDenied).mockReturnValue(false);
      await handler.handle(makeEvent(), makeCtx());

      expect(logger.debug).toHaveBeenCalledWith("tool_surface.changed", {
        exposed: LAUNCHED_WITH,
        withheld: [],
        restored: ["ls"],
      });
    });

    it("stays quiet while the surface is unchanged", async () => {
      const registry = makeStatefulToolRegistry({ active: LAUNCHED_WITH });
      const { handler, permissionManager, logger } = makeSetup({ registry });
      vi.mocked(permissionManager.isToolFullyDenied).mockImplementation(
        denyOnly("ls"),
      );
      await handler.handle(makeEvent(), makeCtx());
      vi.mocked(logger.debug).mockClear();

      await handler.handle(makeEvent(), makeCtx());
      await handler.handle(makeEvent(), makeCtx());

      expect(logger.debug).not.toHaveBeenCalled();
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
