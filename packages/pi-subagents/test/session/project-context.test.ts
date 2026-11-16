import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ContextFile,
  createProjectContextLoader,
  renderProjectContext,
} from "#src/session/project-context";

describe("renderProjectContext", () => {
  describe("Pi's block format", () => {
    // Byte-exact against the pinned SDK's dist/core/system-prompt.js
    // (`renderProjectContext` in 1.0.0): the lead-in and each block are joined
    // by a blank line, and the section wrapper adds no blank line inside
    // either tag.
    it("renders one context file the way Pi's buildSystemPrompt does", () => {
      expect(
        renderProjectContext([{ path: "/repo/AGENTS.md", content: "Repo rules." }]),
      ).toBe(
        [
          "<project_context>",
          "Project-specific instructions and guidelines:",
          "",
          '<project_instructions path="/repo/AGENTS.md">',
          "Repo rules.",
          "</project_instructions>",
          "</project_context>",
        ].join("\n"),
      );
    });

    it("separates several context files with a blank line", () => {
      expect(
        renderProjectContext([
          { path: "/repo/AGENTS.md", content: "Repo rules." },
          { path: "/repo/sub/AGENTS.md", content: "Nested rules." },
        ]),
      ).toBe(
        [
          "<project_context>",
          "Project-specific instructions and guidelines:",
          "",
          '<project_instructions path="/repo/AGENTS.md">',
          "Repo rules.",
          "</project_instructions>",
          "",
          '<project_instructions path="/repo/sub/AGENTS.md">',
          "Nested rules.",
          "</project_instructions>",
          "</project_context>",
        ].join("\n"),
      );
    });

    it("attributes the instructions to the path the loader reported", () => {
      expect(
        renderProjectContext([
          { path: "/worktree/issue-918/AGENTS.md", content: "Worktree rules." },
        ]),
      ).toContain('<project_instructions path="/worktree/issue-918/AGENTS.md">');
    });
  });

  describe("a directory with no context files", () => {
    it("renders nothing for an empty list", () => {
      expect(renderProjectContext([])).toBeUndefined();
    });

    it("renders nothing when the loader reported none at all", () => {
      expect(renderProjectContext(undefined)).toBeUndefined();
    });
  });
});

describe("createProjectContextLoader", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("resolves the block against the directory it is asked about", () => {
    const discover = vi.fn(
      ({ cwd }: { cwd: string; agentDir: string }): ContextFile[] => [
        { path: `${cwd}/AGENTS.md`, content: "Worktree rules." },
      ],
    );

    const block = createProjectContextLoader(discover, "/home/me/.pi/agent")("/worktree");

    expect(discover).toHaveBeenCalledWith({
      cwd: "/worktree",
      agentDir: "/home/me/.pi/agent",
    });
    expect(block).toContain('<project_instructions path="/worktree/AGENTS.md">');
  });

  describe("a directory that carries no project instructions", () => {
    const discoverNothing = (): ContextFile[] => [];

    it("loads no block", () => {
      expect(
        createProjectContextLoader(discoverNothing, "/home/me/.pi/agent")("/sandbox"),
      ).toBeUndefined();
    });

    it("notes the empty directory when debug logging is on", () => {
      vi.stubEnv("PI_SUBAGENTS_DEBUG", "1");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      createProjectContextLoader(discoverNothing, "/home/me/.pi/agent")("/sandbox");

      expect(warn).toHaveBeenCalledWith(
        "[pi-subagents:debug] no project context under /sandbox",
      );
    });

    it("stays silent when debug logging is off", () => {
      vi.stubEnv("PI_SUBAGENTS_DEBUG", "");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      createProjectContextLoader(discoverNothing, "/home/me/.pi/agent")("/sandbox");

      expect(warn).not.toHaveBeenCalled();
    });
  });
});
