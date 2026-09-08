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
    ...overrides,
  };
}

/**
 * A prompt shaped the way `buildSystemPrompt` writes one: the preamble
 * sentence, the tool surface, then the layers that follow it.
 */
function piPrompt(): string {
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
  describe("removing what Pi wrote", () => {
    it("drops the tool list, the filler sentence, and the guidelines", () => {
      const result = renderToolSurface(piPrompt(), inputs());
      const identity = result.slice(0, result.indexOf("Current working"));

      expect(identity).not.toContain("- bash: Execute bash commands");
      expect(identity).not.toContain("In addition to the tools above");
      expect(identity).not.toContain("Guidelines:");
      expect(identity).not.toContain("Available tools:");
    });

    it("leaves everything outside the tool surface byte for byte", () => {
      const result = renderToolSurface(piPrompt(), inputs());

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
      const once = renderToolSurface(piPrompt(), inputs());
      const twice = renderToolSurface(once, inputs());

      expect(twice).toBe(once);
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
  });

  describe("placing this session's block", () => {
    it("appends the block after every layer a child inherits", () => {
      const result = renderToolSurface(piPrompt(), inputs());

      expect(result.indexOf("Available tools:")).toBeGreaterThan(
        result.indexOf("Current working directory: /repo"),
      );
    });

    it("ends the prompt with the block", () => {
      const result = renderToolSurface(piPrompt(), inputs());

      expect(
        result.endsWith("- Show file paths clearly when working with files"),
      ).toBe(true);
    });
  });

  describe("the Available tools section", () => {
    it("lists the allowed tools with Pi's own snippets", () => {
      const result = renderToolSurface(
        piPrompt(),
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
        piPrompt(),
        inputs({ allowedTools: ["read"] }),
      );

      expect(result).not.toContain("- bash:");
    });

    it("omits a tool Pi supplied no snippet for", () => {
      const result = renderToolSurface(
        piPrompt(),
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
        piPrompt(),
        inputs({ allowedTools: ["ask_parent"], toolSnippets: {} }),
      );

      expect(result).not.toContain("Available tools:");
      expect(result).toContain("Guidelines:");
    });
  });

  describe("the Guidelines section", () => {
    it("carries each allowed tool's own guideline bullets", () => {
      const result = renderToolSurface(
        piPrompt(),
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
        piPrompt(),
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
        piPrompt(),
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
        piPrompt(),
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
      const result = renderToolSurface(piPrompt(), inputs());

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
          piPrompt(),
          inputs({ allowedTools: ["bash"] }),
        );

        expect(result).toContain(
          "- Use bash for file operations like ls, rg, find",
        );
      });

      it("is withheld when a dedicated exploration tool is allowed", () => {
        const result = renderToolSurface(
          piPrompt(),
          inputs({ allowedTools: ["bash", "grep"] }),
        );

        expect(result).not.toContain(
          "Use bash for file operations like ls, rg, find",
        );
      });

      it("is withheld when no shell is allowed", () => {
        const result = renderToolSurface(
          piPrompt(),
          inputs({ allowedTools: ["read"] }),
        );

        expect(result).not.toContain("for file operations like");
      });

      it("names PowerShell when it is the only shell", () => {
        const result = renderToolSurface(
          piPrompt(),
          inputs({ allowedTools: ["powershell"] }),
        );

        expect(result).toContain(
          "- Use PowerShell for file operations like listing, searching, and finding files",
        );
      });

      it("names both shells when both are allowed", () => {
        const result = renderToolSurface(
          piPrompt(),
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
        piPrompt(),
        inputs({ allowedTools: ["read", "bash"] }),
      );
      const child = renderToolSurface(
        piPrompt(),
        inputs({ allowedTools: ["read"] }),
      );

      const identityEnd = parent.indexOf("Current working directory: /repo");
      const identity = parent.slice(0, identityEnd);

      expect(identity.length).toBeGreaterThan(0);
      expect(child.startsWith(identity)).toBe(true);
    });

    it("diverges only after the identity, where the two blocks differ", () => {
      const parent = renderToolSurface(
        piPrompt(),
        inputs({ allowedTools: ["read", "bash"] }),
      );
      const child = renderToolSurface(
        piPrompt(),
        inputs({ allowedTools: ["read"] }),
      );

      expect(child).not.toBe(parent);
      expect(parent).toContain("- bash:");
      expect(child).not.toContain("- bash:");
    });
  });

  describe("stability across turns", () => {
    it("renders the same block whether Pi's listing is full or already narrowed", () => {
      const narrowed = piPrompt().replace(
        "- bash: Execute bash commands (ls, grep, find, etc.)\n",
        "",
      );

      const fromFull = renderToolSurface(
        piPrompt(),
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
