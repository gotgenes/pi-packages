import { describe, expect, test } from "vitest";
import {
  formatAskPrompt,
  formatMissingToolNameReason,
  formatSkillAskPrompt,
  formatSkillPathAskPrompt,
  formatUnknownToolReason,
} from "#src/permission-prompts";
import type { SkillPromptEntry } from "#src/skill-prompt-sanitizer";
import type { ToolInputFormatterLookup } from "#src/tool-input-formatter-registry";
import {
  TOOL_INPUT_LOG_PREVIEW_MAX_LENGTH,
  TOOL_INPUT_PREVIEW_MAX_LENGTH,
  TOOL_TEXT_SUMMARY_MAX_LENGTH,
} from "#src/tool-input-preview";
import { ToolPreviewFormatter } from "#src/tool-preview-formatter";
import type { PermissionCheckResult } from "#src/types";

function makeFormatter(
  lookup?: ToolInputFormatterLookup,
): ToolPreviewFormatter {
  return new ToolPreviewFormatter(
    {
      toolInputPreviewMaxLength: TOOL_INPUT_PREVIEW_MAX_LENGTH,
      toolTextSummaryMaxLength: TOOL_TEXT_SUMMARY_MAX_LENGTH,
      toolInputLogPreviewMaxLength: TOOL_INPUT_LOG_PREVIEW_MAX_LENGTH,
    },
    lookup,
  );
}

function makeMcpLookup(preview: string): ToolInputFormatterLookup {
  return { get: (name) => (name === "mcp" ? () => preview : undefined) };
}

function toolResult(
  toolName: string,
  overrides: Partial<PermissionCheckResult> = {},
): PermissionCheckResult {
  return {
    toolName,
    state: "ask",
    source: "tool",
    origin: "builtin",
    ...overrides,
  };
}

function mcpResult(
  target: string,
  overrides: Partial<PermissionCheckResult> = {},
): PermissionCheckResult {
  return {
    toolName: "mcp",
    target,
    state: "ask",
    source: "tool",
    origin: "builtin",
    ...overrides,
  };
}

function skillEntry(name: string): SkillPromptEntry {
  return {
    name,
    description: "A skill",
    location: `/skills/${name}/SKILL.md`,
    state: "ask",
    normalizedLocation: `/skills/${name}/SKILL.md`,
    normalizedBaseDir: `/skills/${name}`,
  };
}

describe("formatMissingToolNameReason", () => {
  test("mentions missing tool name and pi.getAllTools()", () => {
    const result = formatMissingToolNameReason();
    expect(result).toContain("no tool name");
    expect(result).toContain("pi.getAllTools()");
  });
});

describe("formatUnknownToolReason", () => {
  test("mentions the unknown tool name and lists available tools", () => {
    const result = formatUnknownToolReason("phantom", ["read", "write"]);
    expect(result).toContain("phantom");
    expect(result).toContain("read");
    expect(result).toContain("write");
  });

  test("includes MCP hint for non-mcp tool names", () => {
    const result = formatUnknownToolReason("my-server:tool", ["mcp"]);
    expect(result).toContain("mcp");
  });

  test("omits MCP hint when tool name is 'mcp'", () => {
    const result = formatUnknownToolReason("mcp", []);
    expect(result).not.toContain("call the registered 'mcp' tool");
  });

  test("shows 'none' when no tools are registered", () => {
    const result = formatUnknownToolReason("ghost", []);
    expect(result).toContain("none");
  });

  test("caps preview at 10 tools and appends ellipsis for longer lists", () => {
    const tools = Array.from({ length: 15 }, (_, i) => `tool${i}`);
    const result = formatUnknownToolReason("ghost", tools);
    expect(result).toContain("...");
  });
});

describe("formatAskPrompt", () => {
  test("uses 'Current agent' when no agent name given", () => {
    const result = formatAskPrompt(
      toolResult("read"),
      undefined,
      { path: "/src" },
      makeFormatter(),
    );
    expect(result).not.toContain("agent :");
  });

  test("uses agent name when provided", () => {
    const result = formatAskPrompt(
      toolResult("read"),
      "my-agent",
      { path: "/src" },
      makeFormatter(),
    );
    expect(result).toContain("agent: my-agent");
  });

  test("formats bash prompt with command and does not use formatter", () => {
    const result = formatAskPrompt(
      toolResult("bash", { command: "git status" }),
      undefined,
      undefined,
      makeFormatter(),
    );
    expect(result).toContain("git status");
    expect(result).not.toContain("Allow this command?");
  });

  test("formats bash prompt with matched pattern", () => {
    const result = formatAskPrompt(
      toolResult("bash", { command: "git push", matchedPattern: "git *" }),
      undefined,
      undefined,
      makeFormatter(),
    );
    expect(result).toContain("context :");
    expect(result).toContain("matched 'git *'");
  });

  test("appends full command when input contains a chain that differs from the sub-command", () => {
    const result = formatAskPrompt(
      toolResult("bash", { command: "rm -rf ." }),
      undefined,
      { command: 'echo "hello" && rm -rf .' },
      makeFormatter(),
    );
    expect(result).toContain("bash    : rm -rf .");
    expect(result).toContain("full    :");
    expect(result).toContain('echo "hello" && rm -rf .');
  });

  test("suppresses full-command suffix when input command matches the sub-command (no chain)", () => {
    const result = formatAskPrompt(
      toolResult("bash", { command: "git push" }),
      undefined,
      { command: "git push" },
      makeFormatter(),
    );
    expect(result).not.toContain("full    :");
    expect(result).toContain("bash    : git push");
  });

  test("suppresses full-command suffix when input is undefined", () => {
    const result = formatAskPrompt(
      toolResult("bash", { command: "git push" }),
      undefined,
      undefined,
      makeFormatter(),
    );
    expect(result).not.toContain("full    :");
  });

  test("suppresses full-command suffix when input has no command field", () => {
    const result = formatAskPrompt(
      toolResult("bash", { command: "git push" }),
      undefined,
      { unrelated: "value" },
      makeFormatter(),
    );
    expect(result).not.toContain("full    :");
  });

  test("suppresses full-command suffix when input command is empty", () => {
    const result = formatAskPrompt(
      toolResult("bash", { command: "git push" }),
      undefined,
      { command: "" },
      makeFormatter(),
    );
    expect(result).not.toContain("full    :");
  });

  test("places full-command suffix after the qualifier", () => {
    const result = formatAskPrompt(
      toolResult("bash", { command: "rm -rf foo", matchedPattern: "rm *" }),
      undefined,
      { command: "cd /tmp && rm -rf foo" },
      makeFormatter(),
    );
    expect(result).toContain("bash    : rm -rf foo");
    expect(result).toContain("context :");
    expect(result).toContain("matched 'rm *'");
    expect(result).toContain("full    :");
    expect(result).toContain("cd /tmp && rm -rf foo");
    // context appears before full
    expect(result.indexOf("context :")).toBeLessThan(
      result.indexOf("full    :"),
    );
  });

  test("formats bash prompt with nested execution context", () => {
    const result = formatAskPrompt(
      toolResult("bash", {
        command: "rm -rf foo",
        matchedPattern: "rm *",
        commandContext: "command_substitution",
      }),
      undefined,
      undefined,
      makeFormatter(),
    );
    expect(result).toContain("bash    : rm -rf foo");
    expect(result).toContain("inside command substitution");
  });

  test("formats MCP prompt with target", () => {
    const result = formatAskPrompt(
      mcpResult("server:query"),
      undefined,
      undefined,
      makeFormatter(),
    );
    expect(result).toContain("server:query");
    expect(result).not.toContain("Allow this call?");
  });

  test("formats MCP prompt with matched pattern", () => {
    const result = formatAskPrompt(
      mcpResult("server:query", { matchedPattern: "server:*" }),
      undefined,
      undefined,
      makeFormatter(),
    );
    expect(result).toContain("matched : server:*");
  });

  test("appends MCP argument summary when the formatter has an mcp formatter registered", () => {
    const result = formatAskPrompt(
      mcpResult("exa:search"),
      undefined,
      { tool: "exa:search", arguments: { query: "typescript" } },
      makeFormatter(makeMcpLookup('with query: "typescript"')),
    );
    expect(result).toContain("exa:search");
    expect(result).toContain('with query: "typescript"');
    expect(result).not.toContain("Allow this call?");
  });

  test("MCP prompt is unchanged when the formatter returns undefined (no arguments)", () => {
    const noArgsLookup: ToolInputFormatterLookup = {
      get: (name) => (name === "mcp" ? () => undefined : undefined),
    };
    const result = formatAskPrompt(
      mcpResult("exa:search"),
      undefined,
      { tool: "exa:search" },
      makeFormatter(noArgsLookup),
    );
    expect(result).toContain("exa:search");
    expect(result).not.toMatch(/with /);
    expect(result).not.toContain("Allow this call?");
  });

  test("MCP prompt is unchanged when no formatter is provided", () => {
    const result = formatAskPrompt(mcpResult("exa:search"), undefined, {
      tool: "exa:search",
      arguments: { query: "test" },
    });
    expect(result).toContain("exa:search");
    expect(result).not.toMatch(/with /);
    expect(result).not.toContain("Allow this call?");
  });

  test("includes real input preview for non-bash non-mcp tools", () => {
    const result = formatAskPrompt(
      toolResult("read"),
      undefined,
      { path: "/src/foo.ts" },
      makeFormatter(),
    );
    expect(result).toContain("/src/foo.ts");
    expect(result).not.toContain("Allow this call?");
  });

  test("omits input suffix when formatter returns empty string for input", () => {
    const result = formatAskPrompt(
      toolResult("task"),
      undefined,
      {},
      makeFormatter(),
    );
    expect(result).toContain("task");
    expect(result).not.toContain("undefined");
  });

  test("omits input suffix when no formatter provided", () => {
    const result = formatAskPrompt(toolResult("task"), undefined, {
      path: "/src",
    });
    expect(result).toContain("task");
    expect(result).not.toContain("undefined");
    expect(result).not.toContain("Allow this call?");
  });
});

describe("formatSkillAskPrompt", () => {
  test("includes skill name and agent name", () => {
    const result = formatSkillAskPrompt("librarian", "my-agent");
    expect(result).toContain("librarian");
    expect(result).toContain("Agent 'my-agent'");
  });

  test("uses 'Current agent' without agent name", () => {
    const result = formatSkillAskPrompt("librarian");
    expect(result).toContain("Current agent");
    expect(result).toContain("librarian");
  });
});

describe("formatSkillPathAskPrompt", () => {
  test("includes skill name, read path, and agent name", () => {
    const result = formatSkillPathAskPrompt(
      skillEntry("librarian"),
      "/skills/librarian/SKILL.md",
      "my-agent",
    );
    expect(result).toContain("librarian");
    expect(result).toContain("/skills/librarian/SKILL.md");
    expect(result).toContain("Agent 'my-agent'");
  });

  test("uses 'Current agent' without agent name", () => {
    const result = formatSkillPathAskPrompt(
      skillEntry("librarian"),
      "/skills/librarian/SKILL.md",
    );
    expect(result).toContain("Current agent");
  });
});

// formatSkillPathDenyReason has moved to denial-messages.ts.
// Its behavior is tested in denial-messages.test.ts.
