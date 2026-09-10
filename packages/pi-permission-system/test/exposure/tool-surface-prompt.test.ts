import { describe, expect, it } from "vitest";
import {
  renderToolSurface,
  type ToolSurfaceInputs,
} from "#src/exposure/tool-surface-prompt";

/** Pi's own snippets for the tools these tests use. */
const SNIPPETS: Record<string, string> = {
  read: "Read file contents",
  bash: "Execute bash commands (ls, grep, find, etc.)",
  edit: "Make precise file edits with exact text replacement",
  write: "Create or overwrite files",
  grep: "Search file contents",
  find: "Find files by name",
  ls: "List directory contents",
  powershell: "Execute PowerShell commands",
};

function inputs(overrides: Partial<ToolSurfaceInputs> = {}): ToolSurfaceInputs {
  return {
    allowedTools: ["read"],
    toolSnippets: SNIPPETS,
    guidelinesByTool: new Map(),
    piAuthoredPreamble: true,
    ...overrides,
  };
}

/**
 * A prompt shaped the way `buildSystemPrompt` writes one under `customPrompt`:
 * the operator's own text, then the layers Pi appends after it. Pi writes no
 * tool surface of its own here, so every section in it is somebody else's.
 */
function customAuthoredPrompt(): string {
  return [
    "# My Assistant",
    "",
    "You are my personal coding assistant.",
    "",
    "Available tools:",
    "- read: only for reviewing code",
    "",
    "In addition to the tools above, ask me first.",
    "",
    "Guidelines:",
    "- Always ask before writing files",
    "",
    "Answer with one word.",
    "",
    "<project_context>",
    "",
    "Project-specific instructions and guidelines:",
    "",
    "</project_context>",
    "",
    "Current working directory: /repo",
  ].join("\n");
}

/**
 * A prompt shaped the way `buildSystemPrompt` writes one: the preamble
 * sentence, the tool surface, then the layers that follow it.
 */
function piAuthoredPrompt(): string {
  return [
    "You are an expert coding assistant operating inside pi, a coding agent harness.",
    "",
    "Available tools:",
    "- read: Read file contents",
    "- bash: Execute bash commands (ls, grep, find, etc.)",
    "",
    "In addition to the tools above, you may have access to other custom tools depending on the project.",
    "",
    "Guidelines:",
    "- Use bash for file operations like ls, rg, find",
    "- Be concise in your responses",
    "",
    "Pi documentation (read only when the user asks about pi itself):",
    "- Main documentation: /pi/README.md",
    "",
    "<project_context>",
    "Project instructions.",
    "</project_context>",
    "",
    "Current working directory: /repo",
  ].join("\n");
}
describe("renderToolSurface", () => {
  describe("OMP prompt payload compatibility", () => {
    it("normalizes an array of prompt fragments before rendering", () => {
      const result = renderToolSurface(
        [
          "You are a child agent.",
          "",
          "Available tools:",
          "- bash: Execute bash commands",
        ],
        inputs(),
      );

      expect(result).toContain("You are a child agent.");
      expect(result).toContain("Available tools:\n- read: Read file contents");
      expect(result).not.toContain("- bash: Execute bash commands");
    });
  });

  describe("removing what Pi wrote", () => {
    it("drops the tool list, the filler sentence, and the guidelines", () => {
      const result = renderToolSurface(piAuthoredPrompt(), inputs());
      const identity = result.slice(0, result.indexOf("Current working"));

      expect(identity).not.toContain("- bash: Execute bash commands");
      expect(identity).not.toContain("In addition to the tools above");
      expect(identity).not.toContain("Guidelines:");
      expect(identity).not.toContain("Available tools:");
    });

    it("leaves everything outside the tool surface byte for byte", () => {
      const result = renderToolSurface(piAuthoredPrompt(), inputs());

      expect(result).toContain(
        "You are an expert coding assistant operating inside pi, a coding agent harness.",
      );
      expect(result).toContain(
        "Pi documentation (read only when the user asks about pi itself):",
      );
      expect(result).toContain("<project_context>\nProject instructions.");
      expect(result).toContain("Current working directory: /repo");
    });

    it("renders a block for a prompt carrying no tool surface at all", () => {
      const result = renderToolSurface("You are a child agent.", inputs());

      expect(result).toBe(
        [
          "You are a child agent.",
          "",
          "Available tools:",
          "- read: Read file contents",
          "",
          "Guidelines:",
          "- Be concise in your responses",
          "- Show file paths clearly when working with files",
        ].join("\n"),
      );
    });

    it("is unchanged by a second pass over its own output", () => {
      const once = renderToolSurface(piAuthoredPrompt(), inputs());
      const twice = renderToolSurface(once, inputs());

      expect(twice).toBe(once);
    });

    it("removes a section-header-shaped line in project context when Pi wrote the preamble", () => {
      // Pi's own sections come first in a prompt it wrote, so this heading is
      // only reachable when Pi wrote none - which cannot happen in its default
      // branch. Documents the behavior of the Pi-authored path.
      const prompt = [
        "You are an assistant.",
        "",
        "<project_context>",
        "  Guidelines:",
        "  - Our team writes conventional commits.",
        "</project_context>",
      ].join("\n");

      const result = renderToolSurface(prompt, inputs());

      expect(result).not.toContain("Our team writes conventional commits.");
      expect(result).toContain("<project_context>");
    });

    it("keeps a project's own Guidelines heading when Pi did not write the preamble", () => {
      const prompt = [
        "You are an assistant.",
        "",
        "<project_context>",
        "  Guidelines:",
        "  - Our team writes conventional commits.",
        "</project_context>",
      ].join("\n");

      const result = renderToolSurface(
        prompt,
        inputs({ piAuthoredPreamble: false }),
      );

      expect(result).toContain("  Guidelines:");
      expect(result).toContain("  - Our team writes conventional commits.");
    });

    it("keeps a Guidelines section that ends the prompt from swallowing later prose", () => {
      const prompt = [
        "Guidelines:",
        "- Be concise in your responses",
        "",
        "Some closing prose that is not a section body.",
      ].join("\n");

      const result = renderToolSurface(prompt, inputs());

      expect(result).toContain(
        "Some closing prose that is not a section body.",
      );
    });

    it("keeps the prose between a section and the next header-shaped line", () => {
      // Pi's own lead-in sentence inside <project_context> ends with a colon,
      // so a section allowed to run to "the next header" swallows everything
      // a user wrote in between (#919, #932).
      const prompt = [
        "You are an assistant.",
        "",
        "Guidelines:",
        "- Be concise in your responses",
        "",
        "Answer with one word.",
        "",
        "Project-specific instructions and guidelines:",
        "- A project bullet.",
      ].join("\n");

      const result = renderToolSurface(prompt, inputs());

      expect(result).toContain("Answer with one word.");
      expect(result).toContain("Project-specific instructions and guidelines:");
      expect(result).toContain("- A project bullet.");
    });

    it("removes Pi's empty-list placeholder with the section it belongs to", () => {
      const prompt = [
        "You are an assistant.",
        "",
        "Available tools:",
        "(none)",
        "",
        "Guidelines:",
        "- Be concise in your responses",
      ].join("\n");

      const result = renderToolSurface(prompt, inputs());

      expect(result).not.toContain("(none)");
    });
  });

  describe("a preamble Pi did not write", () => {
    const customInputs = inputs({ piAuthoredPreamble: false });

    it("keeps the operator's own tool and guideline sections", () => {
      const result = renderToolSurface(customAuthoredPrompt(), customInputs);

      expect(result).toContain(
        "Available tools:\n- read: only for reviewing code",
      );
      expect(result).toContain(
        "Guidelines:\n- Always ask before writing files",
      );
      expect(result).toContain("In addition to the tools above, ask me first.");
      expect(result).toContain("Answer with one word.");
    });

    it("keeps the project-context block Pi wrapped around its own layers", () => {
      const result = renderToolSurface(customAuthoredPrompt(), customInputs);

      expect(result).toContain("<project_context>");
      expect(result).toContain("</project_context>");
      expect(result).toContain("Project-specific instructions and guidelines:");
    });

    it("still states this session's own tool surface", () => {
      const result = renderToolSurface(customAuthoredPrompt(), customInputs);
      const block = result.slice(
        result.indexOf("Current working directory: /repo"),
      );

      expect(block).toContain("Available tools:\n- read: Read file contents");
      expect(block).toContain("- Be concise in your responses");
    });

    it("replaces the block it appended rather than appending a second one", () => {
      const once = renderToolSurface(customAuthoredPrompt(), customInputs);
      const twice = renderToolSurface(once, customInputs);

      expect(twice).toBe(once);
    });

    it("anchors on Pi's footer, not a line of the same shape above it", () => {
      // Anything below the anchor is treated as an extension's own block and
      // removed, so mistaking the operator's line for Pi's would delete the
      // sections they wrote beneath it.
      const prompt = [
        "Run every command from the repo root.",
        "Current working directory: /somewhere/else",
        "",
        "Guidelines:",
        "- Always ask before writing files",
        "",
        "Current working directory: /repo",
      ].join("\n");

      const result = renderToolSurface(prompt, customInputs);

      expect(result).toContain(
        "Guidelines:\n- Always ask before writing files",
      );
      expect(result).toContain("Current working directory: /somewhere/else");
    });

    it("collects a second block when nothing left a footer to anchor on", () => {
      // Documents the accepted edge rather than endorsing it: with no footer
      // there is no tail to replace a block in, so a custom preamble keeps the
      // one it already carries. Pi writes the footer last in both branches, so
      // reaching this needs a downstream rewrite of its whole output.
      const prompt = [
        "You are my personal coding assistant.",
        "",
        "Available tools:",
        "- read: Read file contents",
      ].join("\n");

      const result = renderToolSurface(prompt, customInputs);

      expect(result.split("Available tools:")).toHaveLength(3);
    });

    it("leaves a region it removed nothing from byte for byte", () => {
      const prompt = [
        "You are my personal coding assistant.",
        "",
        "",
        "",
        "Answer with one word.",
        "",
        "Current working directory: /repo",
      ].join("\n");

      const result = renderToolSurface(prompt, customInputs);

      expect(result.startsWith(prompt)).toBe(true);
    });
  });

  describe("placing this session's block", () => {
    it("appends the block after every layer a child inherits", () => {
      const result = renderToolSurface(piAuthoredPrompt(), inputs());

      expect(result.indexOf("Available tools:")).toBeGreaterThan(
        result.indexOf("Current working directory: /repo"),
      );
    });

    it("leaves text another extension appended byte for byte", () => {
      const prompt = [
        "You are an assistant.",
        "",
        "Current working directory: /repo",
        "",
        "# Working Directory",
        "",
        "",
        "",
        "Run every command from the repo root.",
      ].join("\n");

      const result = renderToolSurface(prompt, inputs());

      expect(result.startsWith(prompt)).toBe(true);
    });

    it("ends the prompt with the block", () => {
      const result = renderToolSurface(piAuthoredPrompt(), inputs());

      expect(
        result.endsWith("- Show file paths clearly when working with files"),
      ).toBe(true);
    });
  });

  describe("the Available tools section", () => {
    it("lists the allowed tools with Pi's own snippets", () => {
      const result = renderToolSurface(
        piAuthoredPrompt(),
        inputs({ allowedTools: ["read", "grep"] }),
      );

      expect(result).toContain(
        [
          "Available tools:",
          "- read: Read file contents",
          "- grep: Search file contents",
        ].join("\n"),
      );
    });

    it("omits a denied tool", () => {
      const result = renderToolSurface(
        piAuthoredPrompt(),
        inputs({ allowedTools: ["read"] }),
      );

      expect(result).not.toContain("- bash:");
    });

    it("omits a tool Pi supplied no snippet for", () => {
      const result = renderToolSurface(
        piAuthoredPrompt(),
        inputs({
          allowedTools: ["read", "ask_parent"],
          toolSnippets: { read: SNIPPETS.read },
        }),
      );

      expect(result).toContain("- read: Read file contents");
      expect(result).not.toContain("ask_parent");
    });

    it("writes no section when no allowed tool has a snippet", () => {
      const result = renderToolSurface(
        piAuthoredPrompt(),
        inputs({ allowedTools: ["ask_parent"], toolSnippets: {} }),
      );

      expect(result).not.toContain("Available tools:");
      expect(result).toContain("Guidelines:");
    });
  });

  describe("the Guidelines section", () => {
    it("carries each allowed tool's own guideline bullets", () => {
      const result = renderToolSurface(
        piAuthoredPrompt(),
        inputs({
          allowedTools: ["read", "edit"],
          guidelinesByTool: new Map([
            ["read", ["Use read to examine files instead of cat or sed."]],
            [
              "edit",
              ["Use edit for precise changes (old text must match exactly)"],
            ],
          ]),
        }),
      );

      expect(result).toContain(
        "- Use read to examine files instead of cat or sed.",
      );
      expect(result).toContain(
        "- Use edit for precise changes (old text must match exactly)",
      );
    });

    it("omits a denied tool's guideline bullets", () => {
      const result = renderToolSurface(
        piAuthoredPrompt(),
        inputs({
          allowedTools: ["read"],
          guidelinesByTool: new Map([
            ["read", ["Use read to examine files instead of cat or sed."]],
            ["write", ["Use write only for new files or complete rewrites"]],
          ]),
        }),
      );

      expect(result).toContain(
        "- Use read to examine files instead of cat or sed.",
      );
      expect(result).not.toContain("Use write only for new files");
    });

    it("carries a third-party tool's guidelines, which no built-in table names", () => {
      const result = renderToolSurface(
        piAuthoredPrompt(),
        inputs({
          allowedTools: ["colgrep"],
          toolSnippets: { colgrep: "Semantic code search" },
          guidelinesByTool: new Map([
            ["colgrep", ["Prefer colgrep for intent-based searches."]],
          ]),
        }),
      );

      expect(result).toContain("- Prefer colgrep for intent-based searches.");
    });

    it("de-duplicates a bullet two tools both contribute", () => {
      const shared = "Do not use emojis";
      const result = renderToolSurface(
        piAuthoredPrompt(),
        inputs({
          allowedTools: ["read", "edit"],
          guidelinesByTool: new Map([
            ["read", [shared]],
            ["edit", [shared]],
          ]),
        }),
      );

      const occurrences = result
        .split("\n")
        .filter((line) => line === `- ${shared}`);
      expect(occurrences).toHaveLength(1);
    });

    it("always ends with Pi's two unconditional bullets", () => {
      const result = renderToolSurface(piAuthoredPrompt(), inputs());

      expect(result).toContain(
        [
          "- Be concise in your responses",
          "- Show file paths clearly when working with files",
        ].join("\n"),
      );
    });

    describe("Pi's file-exploration bullet", () => {
      it("is written when bash is the only way to explore", () => {
        const result = renderToolSurface(
          piAuthoredPrompt(),
          inputs({ allowedTools: ["bash"] }),
        );

        expect(result).toContain(
          "- Use bash for file operations like ls, rg, find",
        );
      });

      it("is withheld when a dedicated exploration tool is allowed", () => {
        const result = renderToolSurface(
          piAuthoredPrompt(),
          inputs({ allowedTools: ["bash", "grep"] }),
        );

        expect(result).not.toContain(
          "Use bash for file operations like ls, rg, find",
        );
      });

      it("is withheld when no shell is allowed", () => {
        const result = renderToolSurface(
          piAuthoredPrompt(),
          inputs({ allowedTools: ["read"] }),
        );

        expect(result).not.toContain("for file operations like");
      });

      it("names PowerShell when it is the only shell", () => {
        const result = renderToolSurface(
          piAuthoredPrompt(),
          inputs({ allowedTools: ["powershell"] }),
        );

        expect(result).toContain(
          "- Use PowerShell for file operations like listing, searching, and finding files",
        );
      });

      it("names both shells when both are allowed", () => {
        const result = renderToolSurface(
          piAuthoredPrompt(),
          inputs({ allowedTools: ["bash", "powershell"] }),
        );

        expect(result).toContain(
          "- Use bash or PowerShell for file operations like listing, searching, and finding files",
        );
      });
    });
  });

  describe("the prefix a subagent child shares with its parent", () => {
    it("leaves the identity byte-identical when parent and child allow different tools", () => {
      // What #180/#400 created and #890 restored: the child's leading bytes
      // match the parent's, so a prefix-reusing engine does not reprocess them.
      const parent = renderToolSurface(
        piAuthoredPrompt(),
        inputs({ allowedTools: ["read", "bash"] }),
      );
      const child = renderToolSurface(
        piAuthoredPrompt(),
        inputs({ allowedTools: ["read"] }),
      );

      const identityEnd = parent.indexOf("Current working directory: /repo");
      const identity = parent.slice(0, identityEnd);

      expect(identity.length).toBeGreaterThan(0);
      expect(child.startsWith(identity)).toBe(true);
    });

    it("diverges only after the identity, where the two blocks differ", () => {
      const parent = renderToolSurface(
        piAuthoredPrompt(),
        inputs({ allowedTools: ["read", "bash"] }),
      );
      const child = renderToolSurface(
        piAuthoredPrompt(),
        inputs({ allowedTools: ["read"] }),
      );

      expect(child).not.toBe(parent);
      expect(parent).toContain("- bash:");
      expect(child).not.toContain("- bash:");
    });
  });

  describe("stability across turns", () => {
    it("renders the same block whether Pi's listing is full or already narrowed", () => {
      const narrowed = piAuthoredPrompt().replace(
        "- bash: Execute bash commands (ls, grep, find, etc.)\n",
        "",
      );

      const fromFull = renderToolSurface(
        piAuthoredPrompt(),
        inputs({ allowedTools: ["read"] }),
      );
      const fromNarrowed = renderToolSurface(
        narrowed,
        inputs({ allowedTools: ["read"] }),
      );

      expect(fromNarrowed).toBe(fromFull);
    });
  });
});
