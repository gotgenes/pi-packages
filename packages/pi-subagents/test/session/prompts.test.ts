import {
  createSyntheticSourceInfo,
  formatSkillsForPrompt,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { AgentTypeRegistry } from "#src/config/agent-types";
import type { EnvInfo } from "#src/session/env";
import {
  type ContextFile,
  renderProjectContext,
} from "#src/session/project-context";
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

/**
 * The fallback identity `prompts.ts` hands a child when no parent contribution
 * is usable, copied verbatim.
 *
 * Named once here because several tests only claim *this prompt fell back*;
 * each used to spell a different fragment of the wording, so a change to the
 * constant meant improvising a new fragment at every site.
 */
const GENERIC_BASE = `# Instructions
Do what has been asked; nothing more, nothing less.`;

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
    expect(prompt).not.toContain("<sub_agent_context>");
    expect(prompt).not.toContain("<inherited_system_prompt>");
    expect(prompt).not.toContain("READ-ONLY");
    // Empty systemPrompt means no <agent_instructions> section
    expect(prompt).not.toContain("<agent_instructions>");
  });

  it("general-purpose without parent prompt falls back to generic base", () => {
    const config = getDefaultConfig("general-purpose");
    const prompt = buildAgentPrompt(config, "/workspace", env);
    expect(prompt).toContain(GENERIC_BASE);
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
    expect(prompt).not.toContain("<sub_agent_context>");
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
    expect(prompt).toContain(GENERIC_BASE);
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
    expect(prompt).not.toContain("<sub_agent_context>");
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
    expect(prompt).toContain(GENERIC_BASE);
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

  // Removed in #890: the bridge asserted these unconditionally, so a child
  // without `edit` was still told to use it. Pi's own tools contribute the
  // equivalent `promptGuidelines`, rendered per session for the tools the
  // child actually has.
  it("append mode contributes no tool reminders of its own", () => {
    const config = getDefaultConfig("general-purpose");
    const prompt = buildAgentPrompt(config, "/workspace", env, {
      systemPrompt: "Parent prompt.",
      cwd: PARENT_CWD,
    });
    expect(prompt).not.toContain("Use the read tool instead of cat");
    expect(prompt).not.toContain("Use the edit tool instead of sed");
    expect(prompt).not.toContain("Use the grep tool instead of");
  });

  it("append mode without parent prompt falls back to the generic base", () => {
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
    expect(prompt).not.toContain("<sub_agent_context>");
    expect(prompt).not.toContain("<inherited_system_prompt>");
    expect(prompt).toContain(GENERIC_BASE);
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

    it("includes <active_agent name=...> tag in append mode after the identity", () => {
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
      const identityIdx = prompt.indexOf("Parent prompt content.");
      expect(tagIdx).toBeGreaterThan(-1);
      expect(identityIdx).toBeGreaterThan(-1);
      // The inherited identity comes before the agent-specific active_agent tag
      expect(identityIdx).toBeLessThan(tagIdx);
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
     * Pi's own heading above the catalogue, read back from its formatter rather
     * than copied, so these tests quote whatever the pinned SDK really writes.
     */
    const SKILLS_SECTION_HEADING =
      formatSkillsForPrompt([skill("probe")])
        .split("\n")
        .find((line) => line.length > 0) ?? "";

    /**
     * Assemble a parent prompt from the layers `buildSystemPrompt` writes, in
     * its order and with its separators.
     *
     * The skills layer goes through Pi's own `formatSkillsForPrompt`, and the
     * project-context layer through this package's byte-replica of Pi's block,
     * so an upstream rewording of either fails these tests rather than silently
     * changing which layer the inherited prompt is cut at.
     */
    function parentPrompt(
      layers: {
        identity?: string;
        contextFiles?: ContextFile[];
        skills?: Skill[];
        footerCwd?: string;
        extensionTail?: string;
      } = {},
    ): string {
      let prompt = layers.identity ?? IDENTITY;
      if (layers.contextFiles) {
        // buildSystemPrompt opens the block with a blank line and closes it
        // with a newline of its own, before whichever layer follows.
        prompt += `\n\n${renderProjectContext(layers.contextFiles) ?? ""}\n`;
      }
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

    describe("skills-catalogue anchor", () => {
      it("cuts the inherited catalogue in append mode", () => {
        const prompt = buildAgentPrompt(appendConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
            skills: [skill("colgrep")],
            footerCwd: PARENT_CWD,
          }),
          cwd: PARENT_CWD,
        });

        expect(prompt).not.toContain("<available_skills>");
      });

      it("cuts the inherited catalogue in replace mode", () => {
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
            skills: [skill("colgrep")],
            footerCwd: PARENT_CWD,
          }),
          cwd: PARENT_CWD,
        });

        expect(prompt).not.toContain("<available_skills>");
      });

      it("cuts the catalogue when the parent resolved no footer", () => {
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({ skills: [skill("colgrep")] }),
          cwd: PARENT_CWD,
        });

        expect(prompt).not.toContain("<available_skills>");
      });

      it("drops the footer that follows the catalogue", () => {
        // The parent's directory matches the child's, so the footer anchor
        // would have left this line alone under #640's exception — only the
        // catalogue cut ahead of it removes the line.
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
            skills: [skill("colgrep")],
            footerCwd: "/workspace",
          }),
          cwd: "/workspace",
        });

        expect(prompt).not.toContain("Current working directory: /workspace");
      });

      it("drops the extension blocks that follow the footer", () => {
        // Pi rebuilds these per turn from the base prompt, so the parent's copy
        // is one turn's transient state — and it names the parent's directory.
        const extensionTail =
          "# Working Directory\n\nShell commands already execute in `/parent`.";
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
            skills: [skill("colgrep")],
            footerCwd: PARENT_CWD,
            extensionTail,
          }),
          cwd: PARENT_CWD,
        });

        expect(prompt).not.toContain("# Working Directory");
      });

      it("keeps the identity ahead of the catalogue byte for byte", () => {
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
            skills: [skill("colgrep"), skill("testing")],
            footerCwd: PARENT_CWD,
          }),
          cwd: PARENT_CWD,
        });

        // The agent tag follows the inherited identity directly, so nothing of
        // the catalogue survives between them.
        expect(
          prompt.startsWith(`${IDENTITY}\n\n<active_agent name="specialist"/>`),
        ).toBe(true);
      });

      it("cuts at Pi's catalogue, not at project context quoting its heading", () => {
        // An AGENTS.md may quote Pi's own prompt text; the quote precedes the
        // catalogue Pi appends, so the cut must be the later of the two.
        const quoted = `${IDENTITY}\n${SKILLS_SECTION_HEADING}`;
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
            identity: quoted,
            skills: [skill("colgrep")],
            footerCwd: PARENT_CWD,
          }),
          cwd: PARENT_CWD,
        });

        expect(prompt).not.toContain("<available_skills>");
        expect(prompt.startsWith(`${quoted}\n\n`)).toBe(true);
      });

      it("cuts at Pi's catalogue, not at an extension block quoting its heading", () => {
        // A quote after the catalogue would win a bare last-occurrence search,
        // leaving the real catalogue inherited.
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
            skills: [skill("colgrep")],
            footerCwd: PARENT_CWD,
            extensionTail: SKILLS_SECTION_HEADING,
          }),
          cwd: PARENT_CWD,
        });

        expect(prompt).not.toContain("<available_skills>");
      });

      it("cuts at Pi's catalogue, not at a whole one an extension appended", () => {
        // Pi writes the footer directly after its own catalogue, so the second
        // well-formed section here is not the one to anchor on.
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
            skills: [skill("colgrep")],
            footerCwd: PARENT_CWD,
            extensionTail: formatSkillsForPrompt([skill("appended")]).trim(),
          }),
          cwd: PARENT_CWD,
        });

        expect(prompt).not.toContain("<available_skills>");
      });

      it("leaves a quoted catalogue alone when the parent resolved no skills", () => {
        // A project-context file quoting a whole catalogue, with the context's
        // own closing tag between it and the footer: Pi wrote no catalogue
        // here, so the quote is identity and only the footer is cut.
        const quoted = [
          IDENTITY,
          "<project_context>",
          formatSkillsForPrompt([skill("quoted")]).trim(),
          "</project_context>",
        ].join("\n");
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({ identity: quoted, footerCwd: PARENT_CWD }),
          cwd: PARENT_CWD,
        });

        expect(prompt.startsWith(`${quoted}\n\n`)).toBe(true);
        expect(prompt).not.toContain(`Current working directory: ${PARENT_CWD}`);
      });
    });

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

      it("strips the inherited footer even when the child shares the parent's cwd", () => {
        // Issue #640 kept an agreeing footer to preserve the byte-identical
        // prefix. The catalogue cut sits ahead of the footer, so the footer is
        // already past the divergence point and the exception buys nothing.
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({ footerCwd: "/workspace" }),
          cwd: "/workspace",
        });

        expect(prompt).not.toContain("Current working directory: /workspace");
      });

      it("strips an agreeing footer whose separators differ from the child's", () => {
        const prompt = buildAgentPrompt(replaceConfig(), "C:/repo", env, {
          systemPrompt: parentPrompt({ footerCwd: "C:/repo" }),
          cwd: "C:\\repo",
        });

        expect(prompt).not.toContain("Current working directory: C:/repo");
      });
    });

    // Issue #918: `<project_context>` names each context file by absolute path,
    // so a child a WorkspaceProvider relocated inherits a machine-structured
    // claim about a directory that is not its own — the #640 defect in the one
    // per-session layer that sits inside the shared prefix.
    describe("project-context anchor", () => {
      /** What the parent's own directory contributed to its prompt. */
      const PARENT_CONTEXT: ContextFile[] = [
        { path: `${PARENT_CWD}/AGENTS.md`, content: "Repo rules." },
      ];

      it("cuts the inherited block for a relocated child in append mode", () => {
        const prompt = buildAgentPrompt(appendConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
            contextFiles: PARENT_CONTEXT,
            skills: [skill("colgrep")],
            footerCwd: PARENT_CWD,
          }),
          cwd: PARENT_CWD,
        });

        expect(prompt).not.toContain("<project_context>");
        expect(prompt).not.toContain(`path="${PARENT_CWD}/AGENTS.md"`);
      });

      it("cuts the inherited block for a relocated child in replace mode", () => {
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
            contextFiles: PARENT_CONTEXT,
            skills: [skill("colgrep")],
            footerCwd: PARENT_CWD,
          }),
          cwd: PARENT_CWD,
        });

        expect(prompt).not.toContain("<project_context>");
        expect(prompt).not.toContain(`path="${PARENT_CWD}/AGENTS.md"`);
      });

      it("cuts the block when the parent resolved no skills", () => {
        // Only the footer anchors the tail here, and the block sits two lines
        // above it rather than three.
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
            contextFiles: PARENT_CONTEXT,
            footerCwd: PARENT_CWD,
          }),
          cwd: PARENT_CWD,
        });

        expect(prompt).not.toContain("<project_context>");
      });

      it("keeps the inherited block when the child shares the parent's cwd", () => {
        const prompt = buildAgentPrompt(replaceConfig(), PARENT_CWD, env, {
          systemPrompt: parentPrompt({
            contextFiles: PARENT_CONTEXT,
            skills: [skill("colgrep")],
            footerCwd: PARENT_CWD,
          }),
          cwd: PARENT_CWD,
        });

        expect(prompt).toContain(`path="${PARENT_CWD}/AGENTS.md"`);
        expect(prompt).toContain("Project-specific instructions and guidelines:");
      });

      it("anchors on Pi's own opening, not one a context file quotes", () => {
        // A context file quoting the opening tag sits later in the document
        // than the real one, so a cut that takes the last match would leave
        // Pi's lead-in and the parent's path behind.
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
            contextFiles: [
              {
                path: `${PARENT_CWD}/AGENTS.md`,
                content: "Pi wraps these files in <project_context>:\n<project_context>",
              },
            ],
            footerCwd: PARENT_CWD,
          }),
          cwd: PARENT_CWD,
        });

        expect(prompt).not.toContain("Project-specific instructions and guidelines:");
        expect(prompt).not.toContain(`path="${PARENT_CWD}/AGENTS.md"`);
      });
    });

    /**
     * A parent prompt as pi ≥0.86's section renderer assembles it: tagged
     * sections joined by blank lines, no footer line. The byte shapes are
     * verified against the 0.86.1 SDK dist — `buildSystemPromptSections`
     * wraps each section as `<name>\n…\n</name>` and joins them with `"\n\n"`,
     * and 0.86's `renderProjectContext` drops the blank line below the opening
     * tag that 0.85's wrote — so the fixtures cannot drift from the shapes the
     * anchors must recognize. The skills layer still goes through Pi's own
     * formatter: its heading is unchanged in 0.86, and the renderer trims it
     * into the section.
     */
    function sectionParentPrompt(
      layers: {
        identity?: string;
        contextFiles?: ContextFile[];
        skills?: Skill[];
        cwd?: string;
        extensionTail?: string;
      } = {},
    ): string {
      const sections: string[] = [];
      if (layers.contextFiles) {
        const content = [
          "Project-specific instructions and guidelines:",
          ...layers.contextFiles.map(
            (file) =>
              `<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>`,
          ),
        ].join("\n\n");
        sections.push(`<project_context>\n${content}\n</project_context>`);
      }
      if (layers.skills) {
        sections.push(
          `<skills>\n${formatSkillsForPrompt(layers.skills).trim()}\n</skills>`,
        );
      }
      if (layers.cwd !== undefined) {
        sections.push(`<cwd>\n${layers.cwd}\n</cwd>`);
      }
      const prompt = [layers.identity ?? IDENTITY, ...sections].join("\n\n");
      return layers.extensionTail !== undefined
        ? `${prompt}\n\n${layers.extensionTail}`
        : prompt;
    }

    // Issue #918 on pi ≥0.86: the section renderer wraps the catalogue in a
    // `<skills>` section and renders the cwd as a `<cwd>` section instead of a
    // footer line, and its project-context block drops the blank line below
    // the opening tag. All three deltas left the relocated-child cut dead —
    // the guard found neither the close tag above the tail nor the lead-in two
    // lines under the opening — so a relocated child inherited the parent's
    // absolute-path context block alongside its own.
    describe("pi ≥0.86 section shape", () => {
      /** What the parent's own directory contributed to its prompt. */
      const PARENT_CONTEXT: ContextFile[] = [
        { path: `${PARENT_CWD}/AGENTS.md`, content: "Repo rules." },
      ];

      it("cuts the inherited skills section at its wrapper for a same-cwd child", () => {
        const prompt = buildAgentPrompt(replaceConfig(), PARENT_CWD, env, {
          systemPrompt: sectionParentPrompt({
            skills: [skill("colgrep")],
            cwd: PARENT_CWD,
          }),
          cwd: PARENT_CWD,
        });

        // Cutting at the section's opening tag drops the wrapper with the
        // layers it carries; the identity ahead of it stays byte for byte.
        expect(prompt).not.toContain("<skills>");
        expect(prompt).not.toContain("</cwd>");
        expect(prompt).toContain(IDENTITY);
      });

      it("cuts the inherited cwd section when the parent resolved no skills", () => {
        const prompt = buildAgentPrompt(replaceConfig(), PARENT_CWD, env, {
          systemPrompt: sectionParentPrompt({ cwd: PARENT_CWD }),
          cwd: PARENT_CWD,
        });

        expect(prompt).not.toContain("<cwd>");
        expect(prompt).toContain(IDENTITY);
      });

      it("cuts the inherited block for a relocated child at the project-context section", () => {
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: sectionParentPrompt({
            contextFiles: PARENT_CONTEXT,
            skills: [skill("colgrep")],
            cwd: PARENT_CWD,
          }),
          cwd: PARENT_CWD,
        });

        expect(prompt).not.toContain("<project_context>");
        expect(prompt).not.toContain(`path="${PARENT_CWD}/AGENTS.md"`);
        expect(prompt).not.toContain("<skills>");
      });

      it("cuts the inherited block for a relocated child when the parent resolved no skills", () => {
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: sectionParentPrompt({
            contextFiles: PARENT_CONTEXT,
            cwd: PARENT_CWD,
          }),
          cwd: PARENT_CWD,
        });

        expect(prompt).not.toContain("<project_context>");
      });

      it("leaves a cwd section naming a different directory alone", () => {
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: sectionParentPrompt({ cwd: "/parent-worktrees/one" }),
          cwd: PARENT_CWD,
        });

        // A whole-line content match, not a substring one: /parent must not
        // truncate /parent-worktrees/one, and no other layer anchors the cut.
        expect(prompt).toContain("<cwd>\n/parent-worktrees/one\n</cwd>");
      });

      it("anchors on Pi's own section, not one a context file quotes", () => {
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: sectionParentPrompt({
            contextFiles: [
              {
                path: `${PARENT_CWD}/AGENTS.md`,
                content: "Pi wraps these files in <project_context>:\n<project_context>",
              },
            ],
            skills: [skill("colgrep")],
            cwd: PARENT_CWD,
          }),
          cwd: PARENT_CWD,
        });

        // The quote sits inside the real block, later in the document than its
        // opening; the walk-back from the anchored tail must find Pi's own.
        expect(prompt).not.toContain("Project-specific instructions and guidelines:");
        expect(prompt).not.toContain(`path="${PARENT_CWD}/AGENTS.md"`);
      });

      it("keeps the identity ahead of the skills section byte for byte", () => {
        const parent = sectionParentPrompt({
          skills: [skill("colgrep")],
          cwd: PARENT_CWD,
        });
        const prompt = buildAgentPrompt(replaceConfig(), PARENT_CWD, env, {
          systemPrompt: parent,
          cwd: PARENT_CWD,
        });

        expect(prompt.startsWith(`${IDENTITY}\n\n`)).toBe(true);
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

      it("makes no Current working directory claim when the directories agree", () => {
        const prompt = buildAgentPrompt(appendConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
            skills: [skill("colgrep")],
            footerCwd: "/workspace",
          }),
          cwd: "/workspace",
        });

        const claims = prompt
          .split("\n")
          .filter((line) => line.startsWith("Current working directory:"));
        expect(claims).toEqual([]);
      });

      it("contributes no skills catalogue for Pi's child-resolved one to duplicate", () => {
        const prompt = buildAgentPrompt(appendConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
            skills: [skill("colgrep"), skill("testing")],
            footerCwd: PARENT_CWD,
            extensionTail: "# Working Directory",
          }),
          cwd: PARENT_CWD,
        });

        const catalogues = prompt
          .split("\n")
          .filter((line) => line === "<available_skills>");
        expect(catalogues).toEqual([]);
      });
    });

    describe("shared prefix with the parent", () => {
      /**
       * An identity shaped like Pi's own: the preamble sentence, then the tool
       * surface, then the layers that follow it. The tool section is what
       * `@gotgenes/pi-permission-system` used to rewrite in place, which is the
       * edit this prefix exists to stay clear of (#890).
       */
      const IDENTITY_WITH_TOOLS = [
        "You are a parent coding agent.",
        "",
        "Available tools:",
        "- read: Read file contents",
        "- bash: Execute bash commands",
        "",
        "Guidelines:",
        "- Be concise in your responses",
      ].join("\n");

      it("opens an append-mode child with the parent's identity verbatim", () => {
        const prompt = buildAgentPrompt(appendConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
            identity: IDENTITY_WITH_TOOLS,
            skills: [skill("colgrep")],
            footerCwd: PARENT_CWD,
          }),
          cwd: PARENT_CWD,
        });

        expect(prompt.startsWith(IDENTITY_WITH_TOOLS)).toBe(true);
      });

      it("opens a replace-mode child with the parent's identity verbatim", () => {
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
            identity: IDENTITY_WITH_TOOLS,
            skills: [skill("colgrep")],
            footerCwd: PARENT_CWD,
          }),
          cwd: PARENT_CWD,
        });

        expect(prompt.startsWith(IDENTITY_WITH_TOOLS)).toBe(true);
      });

      it("keeps the parent's project context inside the shared prefix", () => {
        // The block is the bulk of a real identity, so a child at the parent's
        // directory must carry it byte for byte where the parent has it.
        const identity = parentPrompt({
          identity: IDENTITY_WITH_TOOLS,
          contextFiles: [{ path: `${PARENT_CWD}/AGENTS.md`, content: "Repo rules." }],
        });
        const prompt = buildAgentPrompt(appendConfig(), PARENT_CWD, env, {
          systemPrompt: parentPrompt({
            identity: IDENTITY_WITH_TOOLS,
            contextFiles: [{ path: `${PARENT_CWD}/AGENTS.md`, content: "Repo rules." }],
            skills: [skill("colgrep")],
            footerCwd: PARENT_CWD,
          }),
          cwd: PARENT_CWD,
        });

        expect(prompt.startsWith(identity.trimEnd())).toBe(true);
      });
    });

    describe("the child's own project context", () => {
      /** A loader standing in for Pi's discovery over the child's directory. */
      function loaderFinding(content: string) {
        return vi.fn((cwd: string) =>
          renderProjectContext([{ path: `${cwd}/AGENTS.md`, content }]),
        );
      }

      /** The parent's own block, which a relocated child must not keep. */
      const PARENT_CONTEXT: ContextFile[] = [
        { path: `${PARENT_CWD}/AGENTS.md`, content: "Repo rules." },
      ];

      function relocatedChild(load: (cwd: string) => string | undefined) {
        return buildAgentPrompt(
          replaceConfig(),
          "/workspace",
          env,
          {
            systemPrompt: parentPrompt({
              contextFiles: PARENT_CONTEXT,
              footerCwd: PARENT_CWD,
            }),
            cwd: PARENT_CWD,
          },
          load,
        );
      }

      it("names the child's own directory, not the parent's", () => {
        const prompt = relocatedChild(loaderFinding("Worktree rules."));

        expect(prompt).toContain('<project_instructions path="/workspace/AGENTS.md">');
        expect(prompt).not.toContain(`path="${PARENT_CWD}/AGENTS.md"`);
      });

      it("places the block where Pi places it, ahead of the per-call header", () => {
        const prompt = relocatedChild(loaderFinding("Worktree rules."));

        expect(prompt.indexOf("<project_context>")).toBeLessThan(
          prompt.indexOf('<active_agent name="specialist"/>'),
        );
      });

      it("leaves the agent's own body last in replace mode", () => {
        const prompt = relocatedChild(loaderFinding("Worktree rules."));

        expect(prompt.endsWith("You are a specialist.")).toBe(true);
      });

      it("carries no project context when the workspace resolves none", () => {
        const prompt = relocatedChild(() => undefined);

        expect(prompt).not.toContain("<project_context>");
      });

      it("does not consult the loader when the child shares the parent's cwd", () => {
        const load = loaderFinding("Worktree rules.");

        buildAgentPrompt(
          replaceConfig(),
          PARENT_CWD,
          env,
          {
            systemPrompt: parentPrompt({
              contextFiles: PARENT_CONTEXT,
              footerCwd: PARENT_CWD,
            }),
            cwd: PARENT_CWD,
          },
          load,
        );

        expect(load).not.toHaveBeenCalled();
      });
    });
  });

  // Issue #883: a provider that re-homes the prompt into another harness
  // carries Pi's base preamble into that harness's API, where Anthropic's
  // subscription gate scores it. Such a child adopts the parent's
  // operator-authored parts instead (ADR 0009).
  describe("portable inheritance", () => {
    /** Pi's base preamble, including the documentation-routing line #883 bisected to. */
    const PI_BASE = [
      "You are an expert coding assistant operating inside pi, a coding agent harness.",
      "",
      "Pi documentation (read only when the user asks about pi itself):",
      "- When asked about: custom providers (docs/custom-provider.md), pi packages (docs/packages.md)",
    ].join("\n");

    /**
     * What the parent's operator-authored layers render to: its custom prompt
     * and its appended prompt. Project context is not among them — it names
     * files by absolute path, so each child resolves it against its own
     * directory (#918).
     */
    const PORTABLE = ["You are a specialist.", "", "Extra instructions."].join("\n");

    function agentConfig(promptMode: "append" | "replace"): AgentConfig {
      return {
        name: "scout",
        description: "Scout",
        toolNames: [],
        systemPrompt: "",
        promptMode,
        inheritContext: false,
        runInBackground: false,
      };
    }

    for (const promptMode of ["append", "replace"] as const) {
      describe(`${promptMode} mode`, () => {
        it("opens with the parent's portable identity", () => {
          const prompt = buildAgentPrompt(agentConfig(promptMode), "/workspace", env, {
            systemPrompt: PI_BASE,
            cwd: PARENT_CWD,
            strategy: "portable",
            portablePrompt: PORTABLE,
          });
          expect(prompt.startsWith(PORTABLE)).toBe(true);
        });

        it("carries none of Pi's base preamble", () => {
          const prompt = buildAgentPrompt(agentConfig(promptMode), "/workspace", env, {
            systemPrompt: PI_BASE,
            cwd: PARENT_CWD,
            strategy: "portable",
            portablePrompt: PORTABLE,
          });
          expect(prompt).not.toContain("operating inside pi, a coding agent harness");
          expect(prompt).not.toContain("custom providers (docs/custom-provider.md)");
          expect(prompt).not.toContain("pi packages (docs/packages.md)");
        });

        it("resolves project context against the child's own directory", () => {
          const prompt = buildAgentPrompt(
            agentConfig(promptMode),
            "/workspace",
            env,
            {
              systemPrompt: PI_BASE,
              cwd: PARENT_CWD,
              strategy: "portable",
              portablePrompt: PORTABLE,
            },
            (cwd) =>
              renderProjectContext([
                { path: `${cwd}/AGENTS.md`, content: "Worktree rules." },
              ]),
          );

          expect(prompt).toContain('<project_instructions path="/workspace/AGENTS.md">');
          expect(prompt.indexOf(PORTABLE)).toBeLessThan(
            prompt.indexOf("<project_context>"),
          );
        });

        it("resolves it even when the child shares the parent's directory", () => {
          // Unlike a full identity, a portable one carries no project context
          // to inherit, so the child supplies its own wherever it runs.
          const prompt = buildAgentPrompt(
            agentConfig(promptMode),
            PARENT_CWD,
            env,
            {
              systemPrompt: PI_BASE,
              cwd: PARENT_CWD,
              strategy: "portable",
              portablePrompt: PORTABLE,
            },
            (cwd) =>
              renderProjectContext([
                { path: `${cwd}/AGENTS.md`, content: "Repo rules." },
              ]),
          );

          expect(prompt).toContain(`<project_instructions path="${PARENT_CWD}/AGENTS.md">`);
        });
      });
    }

    describe("fail-safe when the capture is unusable", () => {
      /**
       * Opting into portable must never silently re-embed the harness base it
       * exists to avoid, so an unusable capture falls back to the generic base
       * rather than to the parent's assembled prompt.
       */
      it("falls back to the generic base when no capture is present", () => {
        const prompt = buildAgentPrompt(agentConfig("append"), "/workspace", env, {
          systemPrompt: PI_BASE,
          cwd: PARENT_CWD,
          strategy: "portable",
        });
        expect(prompt.startsWith(GENERIC_BASE)).toBe(true);
        expect(prompt).not.toContain("pi packages (docs/packages.md)");
      });

      it("falls back to the generic base when the capture is whitespace only", () => {
        const prompt = buildAgentPrompt(agentConfig("append"), "/workspace", env, {
          systemPrompt: PI_BASE,
          cwd: PARENT_CWD,
          strategy: "portable",
          portablePrompt: "   \n\n  ",
        });
        expect(prompt.startsWith(GENERIC_BASE)).toBe(true);
        expect(prompt).not.toContain("pi packages (docs/packages.md)");
      });

      it("still resolves the child's own project instructions", () => {
        // The fallback is about never re-embedding the harness base; project
        // context is not part of it, and the child's own is always safe.
        const prompt = buildAgentPrompt(
          agentConfig("append"),
          "/workspace",
          env,
          { systemPrompt: PI_BASE, cwd: PARENT_CWD, strategy: "portable" },
          (cwd) =>
            renderProjectContext([
              { path: `${cwd}/AGENTS.md`, content: "Worktree rules." },
            ]),
        );

        expect(prompt.startsWith(GENERIC_BASE)).toBe(true);
        expect(prompt).toContain('<project_instructions path="/workspace/AGENTS.md">');
        expect(prompt).not.toContain("pi packages (docs/packages.md)");
      });

      // #904: the fallback is the identity of every agent type, so it cannot
      // know which tools the child holds. Explore holds neither `edit` nor
      // `write`, and says so itself twelve lines further down the prompt.
      it("asserts no capability the child may not hold", () => {
        const prompt = buildAgentPrompt(
          getDefaultConfig("Explore"),
          "/workspace",
          env,
          { systemPrompt: PI_BASE, cwd: PARENT_CWD, strategy: "portable" },
        );

        // Scoped to the adopted identity, which ends at the per-call header:
        // Explore's own prompt names writing legitimately, to prohibit it.
        const identity = prompt.slice(0, prompt.indexOf("<active_agent"));
        expect(identity).not.toMatch(/\bwrite\b/i);
        expect(identity).not.toMatch(/\bedit\b/i);
        expect(identity).not.toMatch(/execute commands/i);
      });
    });

    describe("the full strategy is unaffected", () => {
      it("adopts the assembled prompt when the strategy is explicitly full", () => {
        const prompt = buildAgentPrompt(agentConfig("append"), "/workspace", env, {
          systemPrompt: PI_BASE,
          cwd: PARENT_CWD,
          strategy: "full",
          portablePrompt: PORTABLE,
        });
        expect(prompt.startsWith(PI_BASE)).toBe(true);
      });

      it("adopts the assembled prompt when no strategy is stated", () => {
        const prompt = buildAgentPrompt(agentConfig("append"), "/workspace", env, {
          systemPrompt: PI_BASE,
          cwd: PARENT_CWD,
          portablePrompt: PORTABLE,
        });
        expect(prompt.startsWith(PI_BASE)).toBe(true);
      });
    });
  });
});
