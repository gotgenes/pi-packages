import {
  createSyntheticSourceInfo,
  formatSkillsForPrompt,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { AgentTypeRegistry } from "#src/config/agent-types";
import type { EnvInfo } from "#src/session/env";
import { buildAgentPrompt } from "#src/session/prompts";
import type { AgentConfig } from "#src/types";

const testRegistry = new AgentTypeRegistry(() => new Map());

const env: EnvInfo = {
  isGitRepo: true,
  branch: "main",
  platform: "darwin",
};

const envNoGit: EnvInfo = {
  isGitRepo: false,
  branch: "",
  platform: "linux",
};

/** The cwd the inherited parent prompt is taken to name, unless a test varies it. */
const PARENT_CWD = "/parent";

function getDefaultConfig(name: string): AgentConfig {
  return testRegistry.resolveAgentConfig(name);
}

describe("buildAgentPrompt", () => {
  it("includes cwd and git info", () => {
    const config = getDefaultConfig("general-purpose");
    const prompt = buildAgentPrompt(config, "/workspace", env);
    expect(prompt).toContain("/workspace");
    expect(prompt).toContain("Branch: main");
    expect(prompt).toContain("darwin");
  });

  it("handles non-git repos", () => {
    const config = getDefaultConfig("Explore");
    const prompt = buildAgentPrompt(config, "/workspace", envNoGit);
    expect(prompt).toContain("Not a git repository");
    expect(prompt).not.toContain("Branch:");
  });

  it("Explore prompt is read-only", () => {
    const config = getDefaultConfig("Explore");
    const prompt = buildAgentPrompt(config, "/workspace", env);
    expect(prompt).toContain("READ-ONLY");
    expect(prompt).toContain("file search specialist");
  });

  it("Plan prompt is read-only", () => {
    const config = getDefaultConfig("Plan");
    const prompt = buildAgentPrompt(config, "/workspace", env);
    expect(prompt).toContain("READ-ONLY");
    expect(prompt).toContain("software architect");
  });

  it("general-purpose uses append mode (parent twin)", () => {
    const config = getDefaultConfig("general-purpose");
    const parentPrompt = "You are a parent coding agent with full powers.";
    const prompt = buildAgentPrompt(config, "/workspace", env, {
      systemPrompt: parentPrompt,
      cwd: PARENT_CWD,
    });
    expect(prompt).toContain("parent coding agent with full powers");
    expect(prompt).toContain("<sub_agent_context>");
    expect(prompt).not.toContain("<inherited_system_prompt>");
    expect(prompt).not.toContain("READ-ONLY");
    // Empty systemPrompt means no <agent_instructions> section
    expect(prompt).not.toContain("<agent_instructions>");
  });

  it("general-purpose without parent prompt falls back to generic base", () => {
    const config = getDefaultConfig("general-purpose");
    const prompt = buildAgentPrompt(config, "/workspace", env);
    expect(prompt).toContain("general-purpose coding agent");
    expect(prompt).not.toContain("READ-ONLY");
  });

  it("append mode with parent prompt includes parent + custom instructions", () => {
    const config: AgentConfig = {
      name: "appender",
      description: "Appender",
      toolNames: [],
      systemPrompt: "Extra custom instructions here.",
      promptMode: "append",
      inheritContext: false,
      runInBackground: false,
    };
    const parentPrompt = "You are a parent coding agent with special powers.";
    const prompt = buildAgentPrompt(config, "/workspace", env, {
      systemPrompt: parentPrompt,
      cwd: PARENT_CWD,
    });
    expect(prompt).toContain("/workspace");
    expect(prompt).toContain("parent coding agent with special powers");
    expect(prompt).toContain("<sub_agent_context>");
    expect(prompt).not.toContain("<inherited_system_prompt>");
    expect(prompt).toContain("<agent_instructions>");
    expect(prompt).toContain("Extra custom instructions here.");
  });

  it("append mode without parent prompt falls back to generic base", () => {
    const config: AgentConfig = {
      name: "appender",
      description: "Appender",
      toolNames: [],
      systemPrompt: "Extra custom instructions here.",
      promptMode: "append",
      inheritContext: false,
      runInBackground: false,
    };
    const prompt = buildAgentPrompt(config, "/workspace", env);
    expect(prompt).toContain("/workspace");
    expect(prompt).toContain("general-purpose coding agent");
    expect(prompt).toContain("Extra custom instructions here.");
  });

  it("append mode with empty systemPrompt is a pure parent clone", () => {
    const config: AgentConfig = {
      name: "clone",
      description: "Clone",
      toolNames: [],
      systemPrompt: "",
      promptMode: "append",
      inheritContext: false,
      runInBackground: false,
    };
    const parentPrompt = "You are a parent coding agent.";
    const prompt = buildAgentPrompt(config, "/workspace", env, {
      systemPrompt: parentPrompt,
      cwd: PARENT_CWD,
    });
    expect(prompt).toContain("parent coding agent");
    expect(prompt).toContain("<sub_agent_context>");
    expect(prompt).not.toContain("<inherited_system_prompt>");
    expect(prompt).not.toContain("<agent_instructions>");
  });

  it("replace mode includes config systemPrompt last and removes the thin standalone header", () => {
    const config: AgentConfig = {
      name: "custom",
      description: "Custom",
      toolNames: [],
      systemPrompt: "You are a specialized agent.",
      promptMode: "replace",
      inheritContext: false,
      runInBackground: false,
    };
    const prompt = buildAgentPrompt(config, "/workspace", env);
    expect(prompt).toContain("You are a specialized agent.");
    expect(prompt).toContain("/workspace");
    // The thin two-line standalone header is removed in favour of the parent/genericBase prefix.
    expect(prompt).not.toContain("You are a pi coding agent sub-agent");
  });

  it("replace mode includes parent prompt as base (no bridge/wrapper)", () => {
    const config: AgentConfig = {
      name: "standalone",
      description: "Standalone",
      toolNames: [],
      systemPrompt: "You are a standalone agent.",
      promptMode: "replace",
      inheritContext: false,
      runInBackground: false,
    };
    const prompt = buildAgentPrompt(
      config,
      "/workspace",
      env,
      { systemPrompt: "PARENT parent prompt content", cwd: PARENT_CWD },
    );
    expect(prompt).toContain("You are a standalone agent.");
    // Parent is now included as the cacheable base prefix.
    expect(prompt).toContain("PARENT parent prompt content");
    // Replace mode still omits the bridge and agent_instructions wrapper.
    expect(prompt).not.toContain("<sub_agent_context>");
    expect(prompt).not.toContain("<agent_instructions>");
  });

  it("replace mode falls back to genericBase when no parent supplied", () => {
    const config: AgentConfig = {
      name: "standalone",
      description: "Standalone",
      toolNames: [],
      systemPrompt: "Custom standalone instructions.",
      promptMode: "replace",
      inheritContext: false,
      runInBackground: false,
    };
    const prompt = buildAgentPrompt(config, "/workspace", env);
    // Should use genericBase as the prefix (same fallback as append mode).
    expect(prompt).toContain("general-purpose coding agent");
    expect(prompt).not.toContain("You are a pi coding agent sub-agent");
    expect(prompt).toContain("Custom standalone instructions.");
  });

  it("replace mode orders: identity → active_agent → env → config.systemPrompt", () => {
    const config: AgentConfig = {
      name: "ordered",
      description: "Ordered",
      toolNames: [],
      systemPrompt: "Final custom instructions.",
      promptMode: "replace",
      inheritContext: false,
      runInBackground: false,
    };
    const prompt = buildAgentPrompt(
      config,
      "/workspace",
      env,
      { systemPrompt: "IDENTITY parent content", cwd: PARENT_CWD },
    );
    const idxIdentity = prompt.indexOf("IDENTITY parent content");
    const idxTag = prompt.indexOf('<active_agent name="ordered"/>');
    const idxEnv = prompt.indexOf("# Environment");
    const idxCustom = prompt.indexOf("Final custom instructions.");
    expect(idxIdentity).toBeGreaterThan(-1);
    expect(idxTag).toBeGreaterThan(idxIdentity);
    expect(idxEnv).toBeGreaterThan(idxTag);
    expect(idxCustom).toBeGreaterThan(idxEnv);
  });

  it("append mode bridge contains tool reminders", () => {
    const config = getDefaultConfig("general-purpose");
    const prompt = buildAgentPrompt(
      config,
      "/workspace",
      env,
      { systemPrompt: "Parent prompt.", cwd: PARENT_CWD },
    );
    expect(prompt).toContain("Use the read tool instead of cat");
    expect(prompt).toContain("Use the edit tool instead of sed");
    expect(prompt).toContain("Use the grep tool instead of");
  });

  it("append mode without parent prompt still has bridge", () => {
    const config: AgentConfig = {
      name: "no-parent",
      description: "No parent",
      toolNames: [],
      systemPrompt: "Extra stuff.",
      promptMode: "append",
      inheritContext: false,
      runInBackground: false,
    };
    const prompt = buildAgentPrompt(config, "/workspace", env);
    expect(prompt).toContain("<sub_agent_context>");
    expect(prompt).not.toContain("<inherited_system_prompt>");
    expect(prompt).toContain("Use the read tool instead of cat");
    expect(prompt).toContain("general-purpose coding agent");
    expect(prompt).toContain("Extra stuff.");
  });

  // Patch 3 (RepOne #443): inject <active_agent name="..."/> tag so downstream
  // extensions (e.g. @gotgenes/pi-permission-system) can resolve per-agent
  // policy by parsing the child's system prompt.
  describe("active_agent tag injection", () => {
    it("includes <active_agent name=...> tag in replace mode after identity prefix", () => {
      const config: AgentConfig = {
        name: "Explore",
        description: "Explore",
        toolNames: [],
        systemPrompt: "You are an explorer.",
        promptMode: "replace",
        inheritContext: false,
        runInBackground: false,
      };
      // Replace mode now places identity (parent/genericBase) first for KV
      // cache reuse; the tag follows after the cacheable prefix.
      const prompt = buildAgentPrompt(
        config,
        "/workspace",
        env,
        { systemPrompt: "Parent identity prefix.", cwd: PARENT_CWD },
      );
      const idxIdentity = prompt.indexOf("Parent identity prefix.");
      const idxTag = prompt.indexOf('<active_agent name="Explore"/>');
      expect(idxTag).toBeGreaterThan(-1);
      expect(idxTag).toBeGreaterThan(idxIdentity);
    });

    it("includes <active_agent name=...> tag in append mode after sub_agent_context", () => {
      const config: AgentConfig = {
        name: "general-purpose",
        description: "Twin",
        toolNames: [],
        systemPrompt: "",
        promptMode: "append",
        inheritContext: false,
        runInBackground: false,
      };
      const prompt = buildAgentPrompt(
        config,
        "/workspace",
        env,
        { systemPrompt: "Parent prompt content.", cwd: PARENT_CWD },
      );
      const tagIdx = prompt.indexOf('<active_agent name="general-purpose"/>');
      const ctxIdx = prompt.indexOf("<sub_agent_context>");
      expect(tagIdx).toBeGreaterThan(-1);
      expect(ctxIdx).toBeGreaterThan(-1);
      // Sub-agent context comes before the agent-specific active_agent tag
      expect(ctxIdx).toBeLessThan(tagIdx);
    });

    it("uses agent name verbatim in the tag (no escaping or normalization)", () => {
      const config: AgentConfig = {
        name: "my-custom-agent",
        description: "Custom",
        toolNames: [],
        systemPrompt: "You are custom.",
        promptMode: "replace",
        inheritContext: false,
        runInBackground: false,
      };
      const prompt = buildAgentPrompt(config, "/workspace", env);
      expect(prompt).toContain('<active_agent name="my-custom-agent"/>');
    });

    it("active_agent tag appears before envBlock in both modes", () => {
      const replaceConfig: AgentConfig = {
        name: "agent-a",
        description: "Replace",
        toolNames: [],
        systemPrompt: "Replace agent.",
        promptMode: "replace",
        inheritContext: false,
        runInBackground: false,
      };
      const replacePrompt = buildAgentPrompt(replaceConfig, "/workspace", env);
      const tagIdx = replacePrompt.indexOf('<active_agent name="agent-a"/>');
      const envIdx = replacePrompt.indexOf("# Environment");
      // Replace mode: tag follows the identity prefix (not at position 0)
      // but still precedes the env block.
      expect(tagIdx).toBeGreaterThan(0);
      expect(envIdx).toBeGreaterThan(tagIdx);

      const appendConfig: AgentConfig = {
        name: "agent-b",
        description: "Append",
        toolNames: [],
        systemPrompt: "",
        promptMode: "append",
        inheritContext: false,
        runInBackground: false,
      };
      const appendPrompt = buildAgentPrompt(
        appendConfig,
        "/workspace",
        env,
        { systemPrompt: "Parent.", cwd: PARENT_CWD },
      );
      const tagIdxB = appendPrompt.indexOf('<active_agent name="agent-b"/>');
      const envIdxB = appendPrompt.indexOf("# Environment");
      // Append mode: tag follows parent content (not at index 0) but still precedes env block
      expect(tagIdxB).toBeGreaterThan(0);
      expect(envIdxB).toBeGreaterThan(tagIdxB);
    });
  });

  // Issue #640: Pi's buildSystemPrompt ends every prompt with a
  // `Current working directory:` footer, so embedding the parent's prompt
  // verbatim gave a workspace-isolated child a stale claim that outranked its
  // own env block. The child's correct footer is appended by Pi afterwards.
  describe("inherited session-resolved tail", () => {
    /** The identity layers Pi writes ahead of anything it resolves per session. */
    const IDENTITY = "You are a parent coding agent.\nCurrent date: 2026-07-25";

    /** A skill fixture, rendered through Pi's own prompt formatter below. */
    function skill(name: string): Skill {
      const filePath = `/parent/.pi/skills/${name}/SKILL.md`;
      return {
        name,
        description: `The ${name} skill.`,
        filePath,
        baseDir: `/parent/.pi/skills/${name}`,
        sourceInfo: createSyntheticSourceInfo(filePath, { source: "test" }),
        disableModelInvocation: false,
      };
    }

    /**
     * Assemble a parent prompt from the layers `buildSystemPrompt` writes, in
     * its order and with its separators.
     *
     * The skills layer goes through Pi's own `formatSkillsForPrompt`, so an
     * upstream rewording of its heading fails these tests rather than silently
     * changing which layer the inherited prompt is cut at.
     */
    function parentPrompt(
      layers: {
        identity?: string;
        skills?: Skill[];
        footerCwd?: string;
        extensionTail?: string;
      } = {},
    ): string {
      let prompt = layers.identity ?? IDENTITY;
      if (layers.skills) {
        prompt += formatSkillsForPrompt(layers.skills);
      }
      if (layers.footerCwd !== undefined) {
        prompt += `\nCurrent working directory: ${layers.footerCwd}`;
      }
      if (layers.extensionTail !== undefined) {
        prompt += `\n\n${layers.extensionTail}`;
      }
      return prompt;
    }

    function appendConfig(): AgentConfig {
      return {
        name: "twin",
        description: "Twin",
        toolNames: [],
        systemPrompt: "",
        promptMode: "append",
        inheritContext: false,
        runInBackground: false,
      };
    }

    function replaceConfig(): AgentConfig {
      return {
        name: "specialist",
        description: "Specialist",
        toolNames: [],
        systemPrompt: "You are a specialist.",
        promptMode: "replace",
        inheritContext: false,
        runInBackground: false,
      };
    }

    describe("cwd-footer anchor", () => {
      it("strips the inherited footer in append mode", () => {
        const prompt = buildAgentPrompt(appendConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({ footerCwd: PARENT_CWD }),
          cwd: PARENT_CWD,
        });

        expect(prompt).not.toContain(`Current working directory: ${PARENT_CWD}`);
      });

      it("strips the inherited footer in replace mode", () => {
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({ footerCwd: PARENT_CWD }),
          cwd: PARENT_CWD,
        });

        expect(prompt).not.toContain(`Current working directory: ${PARENT_CWD}`);
      });

      it("leaves the identity ahead of the footer intact", () => {
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({ footerCwd: PARENT_CWD }),
          cwd: PARENT_CWD,
        });

        // The cacheable prefix ahead of the cut survives byte for byte.
        expect(prompt.startsWith(`${IDENTITY}\n\n`)).toBe(true);
      });

      it("leaves a footer naming a different directory alone", () => {
        const peerFooter = "Current working directory: /repo-worktrees/issue-42";
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: `${IDENTITY}\n${peerFooter}`,
          cwd: "/repo",
        });

        // A whole-line match, not a substring one: /repo must not truncate /repo-worktrees/....
        expect(prompt).toContain(peerFooter);
      });

      it("normalizes backslashes the way Pi's prompt builder does", () => {
        // buildSystemPrompt writes `cwd.replace(/\\/g, "/")`, so a Windows parent
        // cwd reaches the prompt with forward slashes.
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({ footerCwd: "C:/repo" }),
          cwd: "C:\\repo",
        });

        expect(prompt).not.toContain("Current working directory: C:/repo");
      });

      it("leaves the footer in place when the child shares the parent's cwd", () => {
        const parent = parentPrompt({ footerCwd: "/workspace" });

        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parent,
          cwd: "/workspace",
        });

        // The inherited claim agrees with the child's own, so the prefix stays
        // byte-identical to the parent's prompt for prefix-caching providers.
        expect(prompt.startsWith(`${parent}\n\n`)).toBe(true);
      });

      it("treats separator variants of the same directory as agreeing", () => {
        const parent = parentPrompt({ footerCwd: "C:/repo" });

        const prompt = buildAgentPrompt(replaceConfig(), "C:/repo", env, {
          systemPrompt: parent,
          cwd: "C:\\repo",
        });

        expect(prompt.startsWith(`${parent}\n\n`)).toBe(true);
      });
    });

    describe("no anchor present", () => {
      it("leaves a parent prompt with no session-resolved layer unchanged", () => {
        const parent = parentPrompt();
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parent,
          cwd: PARENT_CWD,
        });

        expect(prompt.startsWith(`${parent}\n\n`)).toBe(true);
      });
    });

    describe("the assembled child prompt", () => {
      it("makes no Current working directory claim when the directories differ", () => {
        const prompt = buildAgentPrompt(appendConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({ footerCwd: PARENT_CWD }),
          cwd: PARENT_CWD,
        });

        // Pi appends the child's own footer after this string, naming the child's
        // cwd — so the assembled prompt must contribute no claim in that form.
        const claims = prompt
          .split("\n")
          .filter((line) => line.startsWith("Current working directory:"));
        expect(claims).toEqual([]);
      });
    });
  });
});
