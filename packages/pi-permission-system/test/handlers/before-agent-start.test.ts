import {
  formatSkillsForPrompt,
  type NormalizedBuildSystemPromptOptions,
  type Skill,
} from "@earendil-works/pi-coding-agent";
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
  makePromptOptions,
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

/** A fresh event per call, so a handler's option mutations never carry over. */
function makeEvent(
  systemPrompt: string | readonly string[] = "You are an assistant.",
  systemPromptOptions: Partial<NormalizedBuildSystemPromptOptions> = {},
) {
  return {
    systemPrompt,
    systemPromptOptions: makePromptOptions(systemPromptOptions),
  };
}

function makeSkill(name: string, overrides: Partial<Skill> = {}): Skill {
  const filePath = `/skills/${name}/SKILL.md`;
  return {
    name,
    description: `Description of ${name}`,
    filePath,
    baseDir: `/skills/${name}`,
    sourceInfo: {
      path: filePath,
      source: "local",
      scope: "user",
      origin: "top-level",
    },
    disableModelInvocation: false,
    ...overrides,
  };
}

/** An event whose prompt carries the catalogue Pi renders from `skills`. */
function skillEvent(skills: Skill[]) {
  return makeEvent(`You are an assistant.${formatSkillsForPrompt(skills)}`, {
    skills,
  });
}

function makeSetup(opts?: {
  toolFullyDenied?: boolean;
  toolRegistry?: Partial<ToolRegistry>;
  registry?: ToolRegistry;
  /** Whether the node answers as a subagent child; a root by default. */
  isSubagentChild?: boolean;
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
  const turnPrep = new SessionTurnPrep(
    session,
    warmParser,
    { announceReady: vi.fn() },
    { report: vi.fn() },
  );
  const detector = {
    isSubagent: vi.fn(() => opts?.isSubagentChild ?? false),
  };
  const handler = new AgentPrepHandler(
    turnPrep,
    session,
    resolver,
    toolRegistry,
    logger,
    detector,
  );
  return {
    handler,
    detector,
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

  describe("the skill catalogue", () => {
    function denySkill(
      permissionManager: ReturnType<typeof makeSetup>["permissionManager"],
      deniedName: string,
    ): void {
      vi.mocked(permissionManager.check).mockImplementation((intent) =>
        intent.surface === "skill" &&
        intent.kind === "tool" &&
        (intent.input as { name?: string }).name === deniedName
          ? makeCheckResult({ state: "deny" })
          : makeCheckResult(),
      );
    }

    it("drops a denied skill from the prompt options on every turn, not just the first", async () => {
      const { handler, permissionManager } = makeSetup();
      denySkill(permissionManager, "secret");
      const skills = [makeSkill("secret"), makeSkill("open")];

      for (const turn of [1, 2]) {
        const event = skillEvent(skills);
        const result = await handler.handle(event, makeCtx());

        expect(result, `turn ${turn}`).toEqual({});
        expect(
          event.systemPromptOptions.skills.map((s) => s.name),
          `turn ${turn}`,
        ).toEqual(["open"]);
      }
    });

    it("drops a denied skill on a turn whose rendered prompt carries no catalogue yet", async () => {
      // The prompt a handler reads is rendered before this turn's tool changes.
      // On the turn `read`/`bash` return from a full denial it has no `<skills>`,
      // but Pi renders one from `skills` after the chain.
      const { handler, permissionManager } = makeSetup();
      denySkill(permissionManager, "secret");
      const event = makeEvent("You are an assistant.", {
        skills: [makeSkill("secret"), makeSkill("open")],
      });

      await handler.handle(event, makeCtx());

      expect(event.systemPromptOptions.skills.map((s) => s.name)).toEqual([
        "open",
      ]);
    });

    it("keeps a skill Pi does not list in the prompt", async () => {
      // `disableModelInvocation` skills are never rendered into the catalogue,
      // so the prompt says nothing about them either way.
      const { handler, permissionManager } = makeSetup();
      denySkill(permissionManager, "secret");
      const event = skillEvent([
        makeSkill("secret"),
        makeSkill("manual-only", { disableModelInvocation: true }),
      ]);

      await handler.handle(event, makeCtx());

      expect(event.systemPromptOptions.skills.map((s) => s.name)).toEqual([
        "manual-only",
      ]);
    });

    it("still drops a denied skill under an operator's custom prompt", async () => {
      const custom = "You are my personal coding assistant.";
      const { handler, permissionManager } = makeSetup();
      denySkill(permissionManager, "secret");
      const skills = [makeSkill("secret"), makeSkill("open")];
      const event = makeEvent(`${custom}${formatSkillsForPrompt(skills)}`, {
        customPrompt: custom,
        skills,
      });

      const result = await handler.handle(event, makeCtx());

      expect(result).toEqual({});
      expect(event.systemPromptOptions.skills.map((s) => s.name)).toEqual([
        "open",
      ]);
    });

    it("stores only the visible skills for path matching", async () => {
      const { handler, permissionManager, session } = makeSetup();
      denySkill(permissionManager, "secret");
      const spy = vi.spyOn(session, "setActiveSkillEntries");

      await handler.handle(
        skillEvent([makeSkill("secret"), makeSkill("open")]),
        makeCtx(),
      );

      expect(spy.mock.calls.at(-1)?.[0].map((entry) => entry.name)).toEqual([
        "open",
      ]);
    });
  });

  it("stores resolved skill entries on the session", async () => {
    const { handler, session } = makeSetup();
    const spy = vi.spyOn(session, "setActiveSkillEntries");
    await handler.handle(makeEvent(), makeCtx());
    expect(spy).toHaveBeenCalledWith(expect.any(Array));
  });

  it.each([true, false])(
    "normalizes array prompts with systemPromptOptions=%s",
    async (withOptions) => {
      const { handler, session, toolRegistry } = makeSetup({
        toolFullyDenied: true,
        registry: makeStatefulToolRegistry({ active: ["read", "bash"] }),
      });
      const ctx = makeCtx();
      const skills = [makeSkill("open")];
      const systemPrompt = [
        "<active_agent",
        "name='worker'>",
        formatSkillsForPrompt(skills),
      ];
      const event = withOptions
        ? makeEvent(systemPrompt, { skills })
        : { systemPrompt };

      const result = await handler.handle(event, ctx);

      expect(session.resolveAgentName(ctx)).toBe("worker");
      expect(toolRegistry.getActive()).toEqual([]);
      expect(
        session.getActiveSkillEntries().map((entry) => entry.location),
      ).toEqual([skills[0].filePath]);
      expect(result).toEqual({});
    },
  );

  describe("on a prompt Pi wrote", () => {
    it("returns no override, so sections later handlers add still reach the provider", async () => {
      const { handler, permissionManager } = makeSetup();
      vi.mocked(permissionManager.isToolFullyDenied).mockImplementation(
        (tool) => tool === "bash",
      );

      const result = await handler.handle(makeEvent(), makeCtx());

      expect(result).toEqual({});
    });

    it("leaves the tool surface to Pi, which renders it from the narrowed active set", async () => {
      const { handler, toolRegistry, permissionManager } = makeSetup();
      vi.mocked(permissionManager.isToolFullyDenied).mockImplementation(
        (tool) => tool === "bash",
      );
      const event = makeEvent(undefined, {
        toolSnippets: { read: "Read file contents", bash: "Run commands" },
      });

      await handler.handle(event, makeCtx());

      expect(toolRegistry.setActive).toHaveBeenCalledWith(["read"]);
      expect(event.systemPromptOptions.sections).toEqual({});
    });
  });

  describe("under a custom system prompt", () => {
    const custom = "You are my personal coding assistant.";

    it("leaves an operator's custom prompt as Pi built it", async () => {
      // Pi writes no tool list or rules under a custom prompt, so a root node
      // adds none either.
      const { handler } = makeSetup({
        toolRegistry: { getActive: vi.fn().mockReturnValue(["read"]) },
      });
      const event = makeEvent(custom, {
        customPrompt: custom,
        toolSnippets: { read: "Read file contents" },
      });

      const result = await handler.handle(event, makeCtx());

      expect(result).toEqual({});
      expect(event.systemPromptOptions.sections).toEqual({});
    });

    it("still filters the active tools under an operator's custom prompt", async () => {
      const { handler, toolRegistry, permissionManager } = makeSetup();
      vi.mocked(permissionManager.isToolFullyDenied).mockImplementation(
        (tool) => tool === "bash",
      );

      const result = await handler.handle(
        makeEvent(custom, {
          customPrompt: custom,
          toolSnippets: { read: "Read file contents", bash: "Run commands" },
        }),
        makeCtx(),
      );

      expect(toolRegistry.setActive).toHaveBeenCalledWith(["read"]);
      expect(result).toEqual({});
    });

    describe("in a subagent child", () => {
      // Every pi-subagents child is a customPrompt session, and its inherited
      // identity carries no tool list, so these sections are its only tool
      // prose.
      it("states the child's tools and rules as prompt sections", async () => {
        const { handler } = makeSetup({
          isSubagentChild: true,
          toolRegistry: { getActive: vi.fn().mockReturnValue(["read"]) },
        });
        const event = makeEvent(custom, {
          customPrompt: custom,
          toolSnippets: { read: "Read file contents" },
        });

        const result = await handler.handle(event, makeCtx());

        expect(result).toEqual({});
        expect(event.systemPromptOptions.sections).toEqual({
          tools: "- read: Read file contents",
          rules: [
            "- Use read to examine files.",
            "- Be concise in your responses",
            "- Show file paths clearly when working with files",
          ].join("\n"),
        });
      });

      it("drops a denied tool and its guidelines from the child's sections", async () => {
        const { handler, permissionManager } = makeSetup({
          isSubagentChild: true,
        });
        vi.mocked(permissionManager.isToolFullyDenied).mockImplementation(
          (tool) => tool === "bash",
        );
        const event = makeEvent(custom, {
          customPrompt: custom,
          toolSnippets: { read: "Read file contents", bash: "Run commands" },
        });

        await handler.handle(event, makeCtx());

        expect(event.systemPromptOptions.sections).toEqual({
          tools: "- read: Read file contents",
          rules: [
            "- Use read to examine files.",
            "- Be concise in your responses",
            "- Show file paths clearly when working with files",
          ].join("\n"),
        });
      });

      it("carries the rules another extension added to the prompt options", async () => {
        const { handler } = makeSetup({ isSubagentChild: true });
        const event = makeEvent(custom, {
          customPrompt: custom,
          promptGuidelines: ["An extension's rule"],
        });

        await handler.handle(event, makeCtx());

        expect(event.systemPromptOptions.sections.rules).toContain(
          "- An extension's rule",
        );
      });

      it("clears a peer's tools section when no allowed tool has a snippet", async () => {
        const { handler } = makeSetup({ isSubagentChild: true });
        const event = makeEvent(custom, {
          customPrompt: custom,
          sections: { tools: "- peer: a tool a peer listed" },
        });

        await handler.handle(event, makeCtx());

        // Pi leaves an empty section out of the prompt.
        expect(event.systemPromptOptions.sections.tools).toBe("");
      });

      it("states the same sections on every turn for an unchanged policy", async () => {
        const { handler } = makeSetup({ isSubagentChild: true });
        const options = {
          customPrompt: custom,
          toolSnippets: { read: "Read file contents" },
        };
        const first = makeEvent(custom, options);
        const second = makeEvent(custom, options);

        await handler.handle(first, makeCtx());
        await handler.handle(second, makeCtx());

        expect(second.systemPromptOptions.sections).toEqual(
          first.systemPromptOptions.sections,
        );
      });

      it("states none when the custom prompt is empty, which Pi reads as none", async () => {
        const { handler } = makeSetup({ isSubagentChild: true });
        const event = makeEvent(undefined, {
          customPrompt: "",
          toolSnippets: { read: "Read file contents" },
        });

        await handler.handle(event, makeCtx());

        expect(event.systemPromptOptions.sections).toEqual({});
      });
    });
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
