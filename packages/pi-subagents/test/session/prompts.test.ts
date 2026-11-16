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
import { makeAgentConfig } from "#test/helpers/make-agent-config";

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
    const config = makeAgentConfig({ name: "appender", systemPrompt: "Extra custom instructions here.", promptMode: "append" });
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
    const config = makeAgentConfig({ name: "appender", systemPrompt: "Extra custom instructions here.", promptMode: "append" });
    const prompt = buildAgentPrompt(config, "/workspace", env);
    expect(prompt).toContain("/workspace");
    expect(prompt).toContain(GENERIC_BASE);
    expect(prompt).toContain("Extra custom instructions here.");
  });

  it("append mode with empty systemPrompt is a pure parent clone", () => {
    const config = makeAgentConfig({ name: "clone", systemPrompt: "", promptMode: "append" });
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
    const config = makeAgentConfig({ name: "custom", systemPrompt: "You are a specialized agent.", promptMode: "replace" });
    const prompt = buildAgentPrompt(config, "/workspace", env);
    expect(prompt).toContain("You are a specialized agent.");
    expect(prompt).toContain("/workspace");
    // The thin two-line standalone header is removed in favour of the parent/genericBase prefix.
    expect(prompt).not.toContain("You are a pi coding agent sub-agent");
  });

  it("replace mode includes parent prompt as base (no bridge/wrapper)", () => {
    const config = makeAgentConfig({ name: "standalone", systemPrompt: "You are a standalone agent.", promptMode: "replace" });
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
    const config = makeAgentConfig({ name: "standalone", systemPrompt: "Custom standalone instructions.", promptMode: "replace" });
    const prompt = buildAgentPrompt(config, "/workspace", env);
    // Should use genericBase as the prefix (same fallback as append mode).
    expect(prompt).toContain(GENERIC_BASE);
    expect(prompt).not.toContain("You are a pi coding agent sub-agent");
    expect(prompt).toContain("Custom standalone instructions.");
  });

  it("replace mode orders: identity → active_agent → env → config.systemPrompt", () => {
    const config = makeAgentConfig({ name: "ordered", systemPrompt: "Final custom instructions.", promptMode: "replace" });
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

  // Patch 3 (RepOne #443): inject <active_agent name="..."/> tag so downstream
  // extensions (e.g. @gotgenes/pi-permission-system) can resolve per-agent
  // policy by parsing the child's system prompt.
  describe("active_agent tag injection", () => {
    it("includes <active_agent name=...> tag in replace mode after identity prefix", () => {
      const config = makeAgentConfig({ name: "Explore", systemPrompt: "You are an explorer.", promptMode: "replace" });
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
      const config = makeAgentConfig({ name: "general-purpose", systemPrompt: "", promptMode: "append" });
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
      const config = makeAgentConfig({ name: "my-custom-agent", systemPrompt: "You are custom.", promptMode: "replace" });
      const prompt = buildAgentPrompt(config, "/workspace", env);
      expect(prompt).toContain('<active_agent name="my-custom-agent"/>');
    });

    it("active_agent tag appears before envBlock in both modes", () => {
      const replaceConfig = makeAgentConfig({ name: "agent-a", systemPrompt: "Replace agent.", promptMode: "replace" });
      const replacePrompt = buildAgentPrompt(replaceConfig, "/workspace", env);
      const tagIdx = replacePrompt.indexOf('<active_agent name="agent-a"/>');
      const envIdx = replacePrompt.indexOf("# Environment");
      // Replace mode: tag follows the identity prefix (not at position 0)
      // but still precedes the env block.
      expect(tagIdx).toBeGreaterThan(0);
      expect(envIdx).toBeGreaterThan(tagIdx);

      const appendConfig = makeAgentConfig({ name: "agent-b", systemPrompt: "", promptMode: "append" });
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

  // Issue #640: Pi's buildSystemPrompt ends every prompt with the session's
  // working directory, so embedding the parent's prompt verbatim gave a
  // workspace-isolated child a stale claim that outranked its own env block.
  // Pi renders the child's own after the assembled prompt.
  describe("inherited session-resolved tail", () => {
    /** The identity layers Pi writes ahead of anything it resolves per session. */
    const IDENTITY = "You are a parent coding agent.\nCurrent date: 2026-07-25";

    /** What the parent's own directory contributed to its prompt. */
    const PARENT_CONTEXT: ContextFile[] = [
      { path: `${PARENT_CWD}/AGENTS.md`, content: "Repo rules." },
    ];

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
     * A parent prompt as Pi's section renderer assembles it: tagged sections
     * joined by blank lines. The byte shapes are verified against the pinned
     * SDK's dist (1.0.0) — `buildSystemPromptSections` wraps each section as
     * `<name>\n…\n</name>`, pi-ai's `getSystemMessageText` joins them with
     * `"\n\n"`, and `renderProjectContext` writes the lead-in directly below
     * the opening tag — so the fixtures cannot drift from the shapes the
     * anchors must recognize. The skills layer goes through Pi's own
     * formatter, which the renderer trims into the section, so an upstream
     * rewording of its heading fails these tests rather than silently
     * changing which layer the inherited prompt is cut at.
     */
    function parentPrompt(
      layers: {
        identity?: string;
        tools?: string;
        rules?: string;
        docs?: string;
        contextFiles?: ContextFile[];
        skills?: Skill[];
        cwd?: string;
        extensionTail?: string;
      } = {},
    ): string {
      const sections: string[] = [];
      if (layers.tools !== undefined) {
        sections.push(`<tools>\n${layers.tools}\n</tools>`);
      }
      if (layers.rules !== undefined) {
        sections.push(`<rules>\n${layers.rules}\n</rules>`);
      }
      if (layers.docs !== undefined) {
        sections.push(`<docs>\n${layers.docs}\n</docs>`);
      }
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

    function appendConfig(): AgentConfig {
      return makeAgentConfig({ name: "twin", systemPrompt: "", promptMode: "append" });
    }

    function replaceConfig(): AgentConfig {
      return makeAgentConfig({ name: "specialist", systemPrompt: "You are a specialist.", promptMode: "replace" });
    }

    describe("skills-section anchor", () => {
      it("cuts the inherited catalogue in append mode", () => {
        const prompt = buildAgentPrompt(appendConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
            skills: [skill("colgrep")],
            cwd: PARENT_CWD,
          }),
          cwd: PARENT_CWD,
        });

        expect(prompt).not.toContain("<skills>");
        expect(prompt).not.toContain("<available_skills>");
      });

      it("cuts at Pi's catalogue, not at project context quoting its heading", () => {
        // An AGENTS.md may quote Pi's own prompt text; the quote precedes the
        // catalogue Pi appends, so the cut must be the later of the two.
        const quoted = `${IDENTITY}\n${SKILLS_SECTION_HEADING}`;
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
            identity: quoted,
            skills: [skill("colgrep")],
            cwd: PARENT_CWD,
          }),
          cwd: PARENT_CWD,
        });

        expect(prompt).not.toContain("<available_skills>");
        expect(prompt.startsWith(`${quoted}\n\n<active_agent`)).toBe(true);
      });

      it("cuts at Pi's catalogue, not at an extension block quoting its heading", () => {
        // A quote after the catalogue would win a bare last-occurrence search,
        // leaving the real catalogue inherited.
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
            skills: [skill("colgrep")],
            cwd: PARENT_CWD,
            extensionTail: SKILLS_SECTION_HEADING,
          }),
          cwd: PARENT_CWD,
        });

        expect(prompt).not.toContain("<available_skills>");
      });

      it("cuts at Pi's catalogue, not at a whole one an extension appended", () => {
        // Pi writes `<cwd>` directly after its own `<skills>` section, so a
        // second well-formed one appended after `<cwd>` is not the one to
        // anchor on.
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
            skills: [skill("colgrep")],
            cwd: PARENT_CWD,
            extensionTail: `<skills>\n${formatSkillsForPrompt([skill("appended")]).trim()}\n</skills>`,
          }),
          cwd: PARENT_CWD,
        });

        expect(prompt).not.toContain("<available_skills>");
      });

      it("leaves a quoted catalogue alone when the parent resolved no skills", () => {
        // A project-context file quoting a whole catalogue, with the context's
        // own closing tag between it and `<cwd>`: Pi wrote no catalogue here,
        // so the quote is identity and only the cwd section is cut.
        const quoted = [
          IDENTITY,
          "<project_context>",
          formatSkillsForPrompt([skill("quoted")]).trim(),
          "</project_context>",
        ].join("\n");
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({ identity: quoted, cwd: PARENT_CWD }),
          cwd: PARENT_CWD,
        });

        expect(prompt.startsWith(`${quoted}\n\n<active_agent`)).toBe(true);
        expect(prompt).not.toContain("<cwd>");
      });

      it("cuts the inherited skills section at its wrapper for a same-cwd child", () => {
        const prompt = buildAgentPrompt(replaceConfig(), PARENT_CWD, env, {
          systemPrompt: parentPrompt({
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

      it("drops an extension section rendered after the cwd section", () => {
        // Pi renders a section an extension adds from before_agent_start after
        // `<cwd>`; pi-nocd's names the parent's directory, and the child's own
        // extensions write theirs for the child.
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
            skills: [skill("colgrep")],
            cwd: PARENT_CWD,
            extensionTail: `<working_directory>\nShell commands already execute in \`${PARENT_CWD}\`.\n</working_directory>`,
          }),
          cwd: PARENT_CWD,
        });

        expect(prompt).not.toContain("<working_directory>");
        expect(prompt).not.toContain(`\`${PARENT_CWD}\``);
      });

      it("keeps the identity ahead of the skills section byte for byte", () => {
        const parent = parentPrompt({
          skills: [skill("colgrep")],
          cwd: PARENT_CWD,
        });
        const prompt = buildAgentPrompt(replaceConfig(), PARENT_CWD, env, {
          systemPrompt: parent,
          cwd: PARENT_CWD,
        });

        // The agent tag follows the inherited identity directly, so nothing of
        // the skills section survives between them.
        expect(
          prompt.startsWith(`${IDENTITY}\n\n<active_agent name="specialist"/>`),
        ).toBe(true);
      });
    });

    describe("cwd-section anchor", () => {
      it("cuts the inherited cwd section in append mode", () => {
        const prompt = buildAgentPrompt(appendConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({ cwd: PARENT_CWD }),
          cwd: PARENT_CWD,
        });

        expect(prompt).not.toContain("<cwd>");
      });

      it("normalizes backslashes the way Pi's prompt builder does", () => {
        // buildSystemPrompt writes `cwd.replace(/\\/g, "/")`, so a Windows parent
        // cwd reaches the prompt with forward slashes.
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({ cwd: "C:/repo" }),
          cwd: "C:\\repo",
        });

        expect(prompt).not.toContain("<cwd>");
      });

      it("cuts the inherited cwd section when the parent resolved no skills", () => {
        const prompt = buildAgentPrompt(replaceConfig(), PARENT_CWD, env, {
          systemPrompt: parentPrompt({ cwd: PARENT_CWD }),
          cwd: PARENT_CWD,
        });

        expect(prompt).not.toContain("<cwd>");
        expect(prompt).toContain(IDENTITY);
      });

      it("leaves a cwd section naming a different directory alone", () => {
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({ cwd: "/parent-worktrees/one" }),
          cwd: PARENT_CWD,
        });

        // A whole-line content match, not a substring one: /parent must not
        // truncate /parent-worktrees/one, and no other layer anchors the cut.
        expect(prompt).toContain("<cwd>\n/parent-worktrees/one\n</cwd>");
      });
    });

    // Issue #918: `<project_context>` names each context file by absolute path,
    // so a child a WorkspaceProvider relocated inherits a machine-structured
    // claim about a directory that is not its own — the #640 defect in the one
    // per-session layer that sits inside the shared prefix.
    describe("project-context anchor", () => {
      it("cuts the inherited block for a relocated child in append mode", () => {
        const prompt = buildAgentPrompt(appendConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
            contextFiles: PARENT_CONTEXT,
            skills: [skill("colgrep")],
            cwd: PARENT_CWD,
          }),
          cwd: PARENT_CWD,
        });

        expect(prompt).not.toContain("<project_context>");
        expect(prompt).not.toContain(`path="${PARENT_CWD}/AGENTS.md"`);
      });

      it("keeps the inherited block when the child shares the parent's cwd", () => {
        const prompt = buildAgentPrompt(replaceConfig(), PARENT_CWD, env, {
          systemPrompt: parentPrompt({
            contextFiles: PARENT_CONTEXT,
            skills: [skill("colgrep")],
            cwd: PARENT_CWD,
          }),
          cwd: PARENT_CWD,
        });

        expect(prompt).toContain(`path="${PARENT_CWD}/AGENTS.md"`);
        expect(prompt).toContain("Project-specific instructions and guidelines:");
      });

      it("cuts the inherited block for a relocated child at the project-context section", () => {
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
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
          systemPrompt: parentPrompt({
            contextFiles: PARENT_CONTEXT,
            cwd: PARENT_CWD,
          }),
          cwd: PARENT_CWD,
        });

        expect(prompt).not.toContain("<project_context>");
      });

      it("anchors on Pi's own section, not one a context file quotes", () => {
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
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
    });

    // Pi renders `<tools>` and `<rules>` from the session's own tool set, so
    // a child's copy of its parent's describes tools the child may not hold;
    // a child of a parent that narrows them in place would show two lists
    // that disagree.
    describe("Pi's tool surface", () => {
      /** Pi's tool section content: bullets plus its closing sentence. */
      const TOOLS = [
        "- read: Read file contents",
        "- bash: Execute bash commands",
        "",
        "In addition to the tools above, you may have access to other custom tools depending on the project.",
      ].join("\n");
      const RULES = [
        "- Use bash for file operations like ls, rg, find",
        "- Be concise in your responses",
        "- Show file paths clearly when working with files",
      ].join("\n");
      const DOCS = "Pi documentation (read only when the user asks about pi itself):";

      it("drops the parent's <tools> and <rules>, keeping what follows byte for byte", () => {
        const prompt = buildAgentPrompt(replaceConfig(), PARENT_CWD, env, {
          systemPrompt: parentPrompt({
            tools: TOOLS,
            rules: RULES,
            docs: DOCS,
            skills: [skill("colgrep")],
            cwd: PARENT_CWD,
          }),
          cwd: PARENT_CWD,
        });

        const expectedHead = `${IDENTITY}\n\n<docs>\n${DOCS}\n</docs>\n\n<active_agent`;
        expect(prompt.slice(0, expectedHead.length)).toBe(expectedHead);
      });

      it("matches the identity a parent without them produces", () => {
        const layers = {
          docs: DOCS,
          contextFiles: PARENT_CONTEXT,
          skills: [skill("colgrep")],
          cwd: PARENT_CWD,
        };
        const fromPiAuthored = buildAgentPrompt(appendConfig(), PARENT_CWD, env, {
          systemPrompt: parentPrompt({ ...layers, tools: TOOLS, rules: RULES }),
          cwd: PARENT_CWD,
        });
        const fromRelocated = buildAgentPrompt(appendConfig(), PARENT_CWD, env, {
          systemPrompt: parentPrompt(layers),
          cwd: PARENT_CWD,
        });

        expect(fromPiAuthored).toBe(fromRelocated);
      });

      it("drops them for a relocated child too", () => {
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
            tools: TOOLS,
            rules: RULES,
            docs: DOCS,
            contextFiles: PARENT_CONTEXT,
            cwd: PARENT_CWD,
          }),
          cwd: PARENT_CWD,
        });

        const expectedHead = `${IDENTITY}\n\n<docs>\n${DOCS}\n</docs>\n\n<active_agent`;
        expect(prompt.slice(0, expectedHead.length)).toBe(expectedHead);
      });

      it("keeps a quoted pair inside project context", () => {
        const quoted = "<tools>\n- x\n</tools>\n\n<rules>\n- y\n</rules>";
        const parent = parentPrompt({
          contextFiles: [{ path: `${PARENT_CWD}/AGENTS.md`, content: quoted }],
          skills: [skill("colgrep")],
          cwd: PARENT_CWD,
        });
        const prompt = buildAgentPrompt(appendConfig(), PARENT_CWD, env, {
          systemPrompt: parent,
          cwd: PARENT_CWD,
        });

        const identity = parent.slice(0, parent.indexOf("\n\n<skills>"));
        expect(prompt.startsWith(`${identity}\n\n<active_agent`)).toBe(true);
      });

      it("keeps a <tools> block that Pi's <rules> does not follow", () => {
        const identity = `${IDENTITY}\n\n<tools>\n- x\n</tools>\n\nOperator prose.`;
        const prompt = buildAgentPrompt(appendConfig(), PARENT_CWD, env, {
          systemPrompt: parentPrompt({ identity, cwd: PARENT_CWD }),
          cwd: PARENT_CWD,
        });

        expect(prompt.startsWith(`${identity}\n\n<active_agent`)).toBe(true);
      });
    });

    // A parent prompt can lack a `<cwd>` section naming the parent's directory
    // when a `before_agent_start` handler returns its own `systemPrompt`, which
    // Pi then uses as the session's forced prompt.
    describe("no <cwd> section", () => {
      it("leaves a parent prompt with no session-resolved layer unchanged", () => {
        const parent = parentPrompt();
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parent,
          cwd: PARENT_CWD,
        });

        expect(prompt.startsWith(`${parent}\n\n<active_agent`)).toBe(true);
      });

      it("leaves a <tools> and <rules> pair in the inherited identity", () => {
        // Forced text is an extension's, so a pair inside it need not be the
        // one Pi rendered for this session; only a <cwd>-anchored prompt has
        // its tool surface excised.
        const identity = `${IDENTITY}\n\n<tools>\n- read: Read file contents\n</tools>\n\n<rules>\n- Be concise in your responses\n</rules>`;
        const prompt = buildAgentPrompt(appendConfig(), PARENT_CWD, env, {
          systemPrompt: parentPrompt({ identity, skills: [skill("colgrep")] }),
          cwd: PARENT_CWD,
        });

        expect(prompt.startsWith(`${identity}\n\n<active_agent`)).toBe(true);
      });

      it("cuts the catalogue at Pi's <skills> wrapper", () => {
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({ skills: [skill("colgrep")] }),
          cwd: PARENT_CWD,
        });

        expect(
          prompt.startsWith(`${IDENTITY}\n\n<active_agent name="specialist"/>`),
        ).toBe(true);
      });

      it("cuts the inherited block for a relocated child", () => {
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
            contextFiles: [{ path: `${PARENT_CWD}/AGENTS.md`, content: "Repo rules." }],
            skills: [skill("colgrep")],
          }),
          cwd: PARENT_CWD,
        });

        expect(prompt).not.toContain("<project_context>");
        expect(prompt).not.toContain(`path="${PARENT_CWD}/AGENTS.md"`);
      });

      it("cuts a catalogue with no <skills> wrapper at its heading", () => {
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: `${IDENTITY}${formatSkillsForPrompt([skill("colgrep")])}`,
          cwd: PARENT_CWD,
        });

        expect(
          prompt.startsWith(`${IDENTITY}\n\n<active_agent name="specialist"/>`),
        ).toBe(true);
      });
    });

    describe("the assembled child prompt", () => {
      it("makes no <cwd> claim when the directories differ", () => {
        const prompt = buildAgentPrompt(appendConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({ cwd: PARENT_CWD }),
          cwd: PARENT_CWD,
        });

        // Pi renders the child's own <cwd> section after this string, naming the
        // child's directory — so the assembled prompt must contribute none.
        const claims = prompt.split("\n").filter((line) => line === "<cwd>");
        expect(claims).toEqual([]);
      });

      it("makes no <cwd> claim when the directories agree", () => {
        const prompt = buildAgentPrompt(appendConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
            skills: [skill("colgrep")],
            cwd: "/workspace",
          }),
          cwd: "/workspace",
        });

        const claims = prompt.split("\n").filter((line) => line === "<cwd>");
        expect(claims).toEqual([]);
      });

      it("contributes no skills catalogue for Pi's child-resolved one to duplicate", () => {
        const prompt = buildAgentPrompt(appendConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
            skills: [skill("colgrep"), skill("testing")],
            cwd: PARENT_CWD,
            extensionTail: "<working_directory>\nShell commands already execute in `/parent`.\n</working_directory>",
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
       * An identity shaped like Pi's own: the preamble sentence, then the
       * sections Pi renders ahead of the session-resolved tail that a child
       * keeps. Pi's `<tools>` and `<rules>` are excised instead (ADR 0011), so
       * they are pinned under `Pi's tool surface`.
       */
      const IDENTITY_WITH_SECTIONS = [
        "You are a parent coding agent.",
        "",
        "<docs>",
        "Pi documentation (read only when the user asks about pi itself):",
        "</docs>",
        "",
        "<addendum>",
        "Operator instructions.",
        "</addendum>",
      ].join("\n");

      it("opens an append-mode child with the parent's identity verbatim", () => {
        const prompt = buildAgentPrompt(appendConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
            identity: IDENTITY_WITH_SECTIONS,
            skills: [skill("colgrep")],
            cwd: PARENT_CWD,
          }),
          cwd: PARENT_CWD,
        });

        expect(prompt.startsWith(IDENTITY_WITH_SECTIONS)).toBe(true);
      });

      it("opens a replace-mode child with the parent's identity verbatim", () => {
        const prompt = buildAgentPrompt(replaceConfig(), "/workspace", env, {
          systemPrompt: parentPrompt({
            identity: IDENTITY_WITH_SECTIONS,
            skills: [skill("colgrep")],
            cwd: PARENT_CWD,
          }),
          cwd: PARENT_CWD,
        });

        expect(prompt.startsWith(IDENTITY_WITH_SECTIONS)).toBe(true);
      });

      it("keeps the parent's project context inside the shared prefix", () => {
        // The block is the bulk of a real identity, so a child at the parent's
        // directory must carry it byte for byte where the parent has it.
        const identity = parentPrompt({
          identity: IDENTITY_WITH_SECTIONS,
          contextFiles: [{ path: `${PARENT_CWD}/AGENTS.md`, content: "Repo rules." }],
        });
        const prompt = buildAgentPrompt(appendConfig(), PARENT_CWD, env, {
          systemPrompt: parentPrompt({
            identity: IDENTITY_WITH_SECTIONS,
            contextFiles: [{ path: `${PARENT_CWD}/AGENTS.md`, content: "Repo rules." }],
            skills: [skill("colgrep")],
            cwd: PARENT_CWD,
          }),
          cwd: PARENT_CWD,
        });

        expect(prompt.startsWith(`${identity}\n\n<active_agent`)).toBe(true);
      });
    });

    describe("the child's own project context", () => {
      /** A loader standing in for Pi's discovery over the child's directory. */
      function loaderFinding(content: string) {
        return vi.fn((cwd: string) =>
          renderProjectContext([{ path: `${cwd}/AGENTS.md`, content }]),
        );
      }

      function relocatedChild(load: (cwd: string) => string | undefined) {
        return buildAgentPrompt(
          replaceConfig(),
          "/workspace",
          env,
          {
            systemPrompt: parentPrompt({
              contextFiles: PARENT_CONTEXT,
              cwd: PARENT_CWD,
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
              cwd: PARENT_CWD,
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
      return makeAgentConfig({ name: "scout", systemPrompt: "", promptMode });
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
