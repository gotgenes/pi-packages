import { afterEach, describe, expect, test, vi } from "vitest";

import { sanitizeAvailableToolsSection } from "#src/exposure/system-prompt-sanitizer";

afterEach(() => {
  vi.restoreAllMocks();
});

// Helpers for building prompt sections.
function availableToolsSection(tools: string[]): string {
  return ["Available tools:", ...tools.map((t) => `- ${t}`)].join("\n");
}

function guidelinesSection(guidelines: string[]): string {
  return ["Guidelines:", ...guidelines.map((g) => `- ${g}`)].join("\n");
}

function prompt(...sections: string[]): string {
  return sections.join("\n\n");
}

describe("sanitizeAvailableToolsSection — Available tools section", () => {
  test("keeps allowed tool lines and the header, drops denied ones", () => {
    const input = prompt(
      availableToolsSection(["bash", "read"]),
      "Other content",
    );
    const result = sanitizeAvailableToolsSection(input, ["read"]);
    expect(result.removed).toBe(true);
    expect(result.prompt).toContain("Available tools:");
    expect(result.prompt).toContain("- read");
    expect(result.prompt).not.toContain("- bash");
  });

  test("leaves the section untouched when every tool is allowed", () => {
    const input = prompt(
      availableToolsSection(["bash", "read"]),
      "Other content",
    );
    const result = sanitizeAvailableToolsSection(input, ["bash", "read"]);
    expect(result.removed).toBe(false);
    expect(result.prompt).toBe(input);
  });

  // Bug #33: findSection extends to lines.length when no subsequent recognised
  // header follows, so content after the last section is silently deleted.
  test("preserves content that follows the Available tools section (bug #33)", () => {
    const input = prompt(
      availableToolsSection(["bash", "read"]),
      "Other content",
    );
    const result = sanitizeAvailableToolsSection(input, ["read"]);
    expect(result.prompt).toContain("Other content");
  });

  test("removes the whole section when no tool is allowed", () => {
    const input = prompt(
      availableToolsSection(["bash", "read"]),
      "Other content",
    );
    const result = sanitizeAvailableToolsSection(input, []);
    expect(result.removed).toBe(true);
    expect(result.prompt).not.toContain("Available tools:");
    expect(result.prompt).toContain("Other content");
  });

  test("removed flag is false when no Available tools section is present", () => {
    const input = "Just some instructions.\n\nNo tools section.";
    const result = sanitizeAvailableToolsSection(input, ["bash"]);
    expect(result.removed).toBe(false);
    expect(result.prompt).toBe(input);
  });

  test("keeps non-tool boilerplate prose near the section", () => {
    const input = [
      "Available tools:",
      "- read: Read file contents",
      "- bash: Run shell commands",
      "",
      "In addition to the tools above, you may have access to other custom tools depending on the project.",
    ].join("\n");
    const result = sanitizeAvailableToolsSection(input, ["read"]);
    expect(result.prompt).toContain("- read: Read file contents");
    expect(result.prompt).not.toContain("- bash: Run shell commands");
    expect(result.prompt).toContain("In addition to the tools above");
  });

  test("returns original prompt reference unchanged when nothing is removed", () => {
    const input = "No tools section here.";
    const result = sanitizeAvailableToolsSection(input, []);
    expect(result.prompt).toBe(input);
  });

  test("narrowing the full listing yields the already-narrowed listing (cache byte-stability)", () => {
    const allowed = ["read", "edit", "write"];
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

    const fromFull = sanitizeAvailableToolsSection(fullProse, allowed).prompt;
    const fromNarrowed = sanitizeAvailableToolsSection(
      narrowedProse,
      allowed,
    ).prompt;

    // Idempotent on the already-narrowed input Pi feeds back on later turns.
    expect(fromNarrowed).toBe(narrowedProse);
    // Turn 1 (full) and turn 2+ (narrowed) produce identical wire bytes.
    expect(fromFull).toBe(fromNarrowed);
  });
});

describe("sanitizeAvailableToolsSection — Guidelines section", () => {
  test("removes bash guideline when bash is not in allowed tools", () => {
    const input = prompt(
      guidelinesSection(["use bash for file operations like ls, rg, find"]),
    );
    const result = sanitizeAvailableToolsSection(input, []);
    expect(result.removed).toBe(true);
    expect(result.prompt).not.toContain("use bash for file operations");
  });

  test("keeps bash guideline when bash is in allowed tools", () => {
    const input = prompt(
      guidelinesSection(["use bash for file operations like ls, rg, find"]),
    );
    const result = sanitizeAvailableToolsSection(input, ["bash"]);
    expect(result.removed).toBe(false);
    expect(result.prompt).toContain("use bash for file operations");
  });

  test("removes read guideline when read is not allowed", () => {
    const input = prompt(
      guidelinesSection(["use read to examine files instead of cat or sed."]),
    );
    const result = sanitizeAvailableToolsSection(input, []);
    expect(result.removed).toBe(true);
    expect(result.prompt).not.toContain("use read to examine files");
  });

  test("keeps read guideline when read is allowed", () => {
    const input = prompt(
      guidelinesSection(["use read to examine files instead of cat or sed."]),
    );
    const result = sanitizeAvailableToolsSection(input, ["read"]);
    expect(result.removed).toBe(false);
    expect(result.prompt).toContain("use read to examine files");
  });

  test("removes edit guideline when edit is not allowed", () => {
    const input = prompt(
      guidelinesSection([
        "use edit for precise changes (old text must match exactly)",
      ]),
    );
    const result = sanitizeAvailableToolsSection(input, []);
    expect(result.removed).toBe(true);
    expect(result.prompt).not.toContain("use edit for precise changes");
  });

  test("removes write guideline when write is not allowed", () => {
    const input = prompt(
      guidelinesSection(["use write only for new files or complete rewrites"]),
    );
    const result = sanitizeAvailableToolsSection(input, []);
    expect(result.removed).toBe(true);
    expect(result.prompt).not.toContain("use write only for new files");
  });

  test("removes entire Guidelines section when all bullets are filtered out", () => {
    const input = prompt(
      guidelinesSection([
        "use bash for file operations like ls, rg, find",
        "use write only for new files or complete rewrites",
      ]),
    );
    const result = sanitizeAvailableToolsSection(input, []);
    expect(result.removed).toBe(true);
    expect(result.prompt).not.toContain("Guidelines:");
  });

  test("preserves unrecognised guidelines regardless of allowed tools", () => {
    const input = prompt(
      guidelinesSection(["some custom guideline not in the rules"]),
    );
    const result = sanitizeAvailableToolsSection(input, []);
    expect(result.removed).toBe(false);
    expect(result.prompt).toContain("some custom guideline not in the rules");
  });

  test("handles both sections together: removes tools section and filters guidelines", () => {
    const input = prompt(
      availableToolsSection(["bash"]),
      guidelinesSection([
        "use bash for file operations like ls, rg, find",
        "use write only for new files or complete rewrites",
        "some custom guideline not in the rules",
      ]),
    );
    const result = sanitizeAvailableToolsSection(input, []);
    expect(result.removed).toBe(true);
    expect(result.prompt).not.toContain("Available tools:");
    expect(result.prompt).not.toContain("use bash for file operations");
    expect(result.prompt).not.toContain("use write only for new files");
    expect(result.prompt).toContain("some custom guideline not in the rules");
  });

  test("trims whitespace from allowed tool names", () => {
    const input = prompt(
      guidelinesSection(["use bash for file operations like ls, rg, find"]),
    );
    const result = sanitizeAvailableToolsSection(input, ["  bash  "]);
    expect(result.removed).toBe(false);
    expect(result.prompt).toContain("use bash for file operations");
  });
});

describe("sanitizeAvailableToolsSection — multi-section prompt", () => {
  test("collapses extra blank lines after removal", () => {
    const input = prompt(
      "Intro",
      availableToolsSection(["bash"]),
      guidelinesSection(["use bash for file operations like ls, rg, find"]),
      "Closing",
    );
    const result = sanitizeAvailableToolsSection(input, []);
    // No run of 3+ consecutive newlines
    expect(result.prompt).not.toMatch(/\n{3,}/);
  });
});

describe("sanitizeAvailableToolsSection — findSection boundary edge cases", () => {
  test("preserves content after Guidelines when Guidelines is the last recognised section", () => {
    const input = prompt(
      guidelinesSection(["use bash for file operations like ls, rg, find"]),
      "Trailing custom instructions",
    );
    const result = sanitizeAvailableToolsSection(input, []);
    expect(result.prompt).toContain("Trailing custom instructions");
  });

  test("preserves trailing prose when both sections are removed", () => {
    const input = prompt(
      availableToolsSection(["bash"]),
      guidelinesSection(["use bash for file operations like ls, rg, find"]),
      "Important user note",
    );
    const result = sanitizeAvailableToolsSection(input, []);
    expect(result.removed).toBe(true);
    expect(result.prompt).not.toContain("Available tools:");
    expect(result.prompt).not.toContain("Guidelines:");
    expect(result.prompt).toContain("Important user note");
  });

  test("section at EOF is removed entirely when no tool is allowed", () => {
    const input = availableToolsSection(["bash", "read"]);
    const result = sanitizeAvailableToolsSection(input, []);
    expect(result.removed).toBe(true);
    expect(result.prompt).toBe("");
  });

  test("section followed by blank lines then prose — prose survives removal", () => {
    const input = ["Available tools:", "- bash", "", "", "Custom note"].join(
      "\n",
    );
    const result = sanitizeAvailableToolsSection(input, []);
    expect(result.removed).toBe(true);
    expect(result.prompt).toContain("Custom note");
    expect(result.prompt).not.toContain("Available tools:");
  });
});

// ---------------------------------------------------------------------------
// Moved from permission-system.test.ts catch-all (#342)
// ---------------------------------------------------------------------------

test("System prompt sanitizer keeps the active tools in the Available tools section", () => {
  const prompt = [
    "Available tools:",
    "- read: Read file contents",
    "- mcp: Discover, inspect, and call MCP tools across configured servers",
    "",
    "In addition to the tools above, you may have access to other custom tools depending on the project.",
    "",
    "Guidelines:",
    "- Use mcp for MCP discovery first: search by capability, describe one exact tool name, then call it.",
    "- Be concise in your responses",
  ].join("\n");

  const result = sanitizeAvailableToolsSection(prompt, ["read", "mcp"]);

  expect(result.removed).toBe(false);
  expect(result.prompt).toContain("Available tools:");
  expect(result.prompt).toContain("- read: Read file contents");
  expect(result.prompt).toContain("- mcp: Discover");
  expect(result.prompt).toContain("In addition to the tools above");
  expect(result.prompt).toMatch(/Guidelines:/);
});

test("System prompt sanitizer drops a denied tool's line but keeps the section", () => {
  const prompt = [
    "Available tools:",
    "- read: Read file contents",
    "- mcp: Discover, inspect, and call MCP tools across configured servers",
    "",
    "Guidelines:",
    "- Use mcp for MCP discovery first: search by capability, describe one exact tool name, then call it.",
    "- Be concise in your responses",
  ].join("\n");

  const result = sanitizeAvailableToolsSection(prompt, ["read"]);

  expect(result.removed).toBe(true);
  expect(result.prompt).toContain("Available tools:");
  expect(result.prompt).toContain("- read: Read file contents");
  expect(result.prompt).not.toContain("- mcp: Discover");
});

test("System prompt sanitizer removes denied tool guidelines while keeping global guidance", () => {
  const prompt = [
    "Guidelines:",
    "- Use task when work SHOULD be delegated to one or more specialized agents instead of handled entirely in the current session.",
    "- Use mcp for MCP discovery first: search by capability, describe one exact tool name, then call it.",
    "- Prefer grep/find/ls tools over bash for file exploration (faster, respects .gitignore)",
    "- Be concise in your responses",
    "- Show file paths clearly when working with files",
  ].join("\n");

  const result = sanitizeAvailableToolsSection(prompt, ["bash", "grep", "mcp"]);

  expect(result.removed).toBe(true);
  expect(result.prompt).not.toContain("Use task when work SHOULD");
  expect(result.prompt).toMatch(/Use mcp for MCP discovery first/i);
  expect(result.prompt).toMatch(/Prefer grep\/find\/ls tools over bash/i);
  expect(result.prompt).toMatch(/Be concise in your responses/);
  expect(result.prompt).toMatch(
    /Show file paths clearly when working with files/,
  );
});

test("System prompt sanitizer removes inactive built-in write guidance", () => {
  const prompt = [
    "Guidelines:",
    "- Use write only for new files or complete rewrites",
    "- When summarizing your actions, output plain text directly - do NOT use cat or bash to display what you did",
    "- Be concise in your responses",
  ].join("\n");

  const result = sanitizeAvailableToolsSection(prompt, ["read"]);

  expect(result.removed).toBe(true);
  expect(result.prompt).not.toContain(
    "Use write only for new files or complete rewrites",
  );
  expect(result.prompt).not.toContain(
    "do NOT use cat or bash to display what you did",
  );
  expect(result.prompt).toMatch(/Be concise in your responses/);
});
