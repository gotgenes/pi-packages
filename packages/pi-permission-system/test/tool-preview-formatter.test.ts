import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { ToolInputFormatterLookup } from "#src/tool-input-formatter-registry";

// Mock the prompt-path serializer before importing the module under test.
// The rest of the module stays real — log-redaction.ts builds on
// createJsonSafeReplacer, and a literal factory would blank it out.
vi.mock("../src/json-safe-stringify.js", async (importActual) => ({
  ...(await importActual<typeof import("../src/json-safe-stringify.js")>()),
  safeJsonStringify: vi.fn((value: unknown) => JSON.stringify(value)),
}));

import { safeJsonStringify } from "#src/json-safe-stringify";
import {
  TOOL_INPUT_PREVIEW_MAX_LENGTH,
  TOOL_TEXT_SUMMARY_MAX_LENGTH,
} from "#src/tool-input-preview";
import { resolveToolPreviewLimits } from "#src/tool-preview-formatter";
import type { PermissionCheckResult } from "#src/types";
import {
  makeToolPreviewFormatter as makeFormatter,
  makePermissionCheckResult,
} from "#test/helpers/presentation-fixtures";

const mockedStringify = vi.mocked(safeJsonStringify);

// This file's subject is the allow-path preview, so the wrapper defaults to
// `allow`.
function makeResult(
  toolName: string,
  overrides: Partial<PermissionCheckResult> = {},
): PermissionCheckResult {
  return makePermissionCheckResult(toolName, { state: "allow", ...overrides });
}

beforeEach(() => {
  mockedStringify.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── sanitizeInlineText ────────────────────────────────────────────────────

describe("ToolPreviewFormatter.sanitizeInlineText", () => {
  test("collapses whitespace and trims", () => {
    const f = makeFormatter();
    expect(f.sanitizeInlineText("  hello   world  ")).toBe("hello world");
  });

  test("returns 'empty text' for blank string", () => {
    const f = makeFormatter();
    expect(f.sanitizeInlineText("")).toBe("empty text");
    expect(f.sanitizeInlineText("   ")).toBe("empty text");
  });

  test("truncates at constructor toolTextSummaryMaxLength", () => {
    const f = makeFormatter({ toolTextSummaryMaxLength: 5 });
    const result = f.sanitizeInlineText("hello world");
    expect(result).toBe("hello…");
  });

  test("explicit maxLength override takes precedence over constructor default", () => {
    const f = makeFormatter({ toolTextSummaryMaxLength: 80 });
    const result = f.sanitizeInlineText("hello world", 5);
    expect(result).toBe("hello…");
  });
});

// ── formatJsonInputForPrompt ──────────────────────────────────────────────

describe("ToolPreviewFormatter.formatJsonInputForPrompt", () => {
  test("returns empty string when serialization yields empty", () => {
    mockedStringify.mockReturnValue(undefined);
    const f = makeFormatter();
    expect(f.formatJsonInputForPrompt({})).toBe("");
  });

  test("returns prefixed JSON with 'with input' prefix", () => {
    mockedStringify.mockReturnValue('{"k":"v"}');
    const f = makeFormatter();
    expect(f.formatJsonInputForPrompt({ k: "v" })).toBe('with input {"k":"v"}');
  });

  test("truncates at constructor toolInputPreviewMaxLength", () => {
    const longJson = `"${"x".repeat(20)}"`;
    mockedStringify.mockReturnValue(longJson);
    const f = makeFormatter({ toolInputPreviewMaxLength: 10 });
    const result = f.formatJsonInputForPrompt({});
    // "with input " + 10 chars + ellipsis
    const preview = result.slice("with input ".length);
    expect(preview.length).toBe(11); // 10 + 1 for "…"
    expect(preview.endsWith("…")).toBe(true);
  });

  test("does not truncate when within toolInputPreviewMaxLength", () => {
    mockedStringify.mockReturnValue('{"k":"v"}');
    const f = makeFormatter({ toolInputPreviewMaxLength: 200 });
    expect(f.formatJsonInputForPrompt({ k: "v" })).toBe('with input {"k":"v"}');
  });
});

// ── formatSearchInputForPrompt ────────────────────────────────────────────

describe("ToolPreviewFormatter.formatSearchInputForPrompt", () => {
  test("includes pattern and path", () => {
    const f = makeFormatter();
    const result = f.formatSearchInputForPrompt("grep", {
      pattern: "TODO",
      path: "/src",
    });
    expect(result).toContain("pattern 'TODO'");
    expect(result).toContain("path '/src'");
  });

  test("truncates pattern at toolTextSummaryMaxLength", () => {
    const f = makeFormatter({ toolTextSummaryMaxLength: 5 });
    const result = f.formatSearchInputForPrompt("grep", {
      pattern: "abcdefgh",
    });
    expect(result).toContain("abcde…");
  });

  test("uses 'current working directory' for find/grep/ls without path", () => {
    const f = makeFormatter();
    for (const toolName of ["find", "grep", "ls"]) {
      const result = f.formatSearchInputForPrompt(toolName, {});
      expect(result).toContain("current working directory");
    }
  });

  test("returns empty string for unknown tool with no input", () => {
    const f = makeFormatter();
    expect(f.formatSearchInputForPrompt("other", {})).toBe("");
  });
});

// ── formatToolInputForPrompt ──────────────────────────────────────────────

describe("ToolPreviewFormatter.formatToolInputForPrompt", () => {
  test("dispatches 'edit' to standalone formatEditInputForPrompt", () => {
    mockedStringify.mockReturnValue(undefined);
    const f = makeFormatter();
    const result = f.formatToolInputForPrompt("edit", {
      path: "/foo.ts",
      edits: [],
    });
    expect(result).toContain("for '/foo.ts'");
  });

  test("dispatches 'write' to standalone formatWriteInputForPrompt", () => {
    const f = makeFormatter();
    const result = f.formatToolInputForPrompt("write", {
      path: "/out.ts",
      content: "hi",
    });
    expect(result).toContain("for '/out.ts'");
  });

  test("dispatches 'read' to standalone formatReadInputForPrompt", () => {
    const f = makeFormatter();
    const result = f.formatToolInputForPrompt("read", { path: "/src/x.ts" });
    expect(result).toContain("path '/src/x.ts'");
  });

  test("dispatches 'find'/'grep'/'ls' to formatSearchInputForPrompt", () => {
    const f = makeFormatter();
    for (const tool of ["find", "grep", "ls"]) {
      const result = f.formatToolInputForPrompt(tool, {});
      expect(result).toContain("current working directory");
    }
  });

  test("falls back to formatJsonInputForPrompt for unknown tools", () => {
    mockedStringify.mockReturnValue('{"x":1}');
    const f = makeFormatter();
    const result = f.formatToolInputForPrompt("unknown", { x: 1 });
    expect(result).toContain('{"x":1}');
  });

  test("unknown tool truncates at constructor toolInputPreviewMaxLength", () => {
    const longJson = `{"k":"${"x".repeat(50)}"}`;
    mockedStringify.mockReturnValue(longJson);
    const f = makeFormatter({ toolInputPreviewMaxLength: 10 });
    const result = f.formatToolInputForPrompt("custom", {});
    const preview = result.slice("with input ".length);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview.length).toBe(11); // 10 + "…"
  });
});

// ── formatToolInputForPrompt (custom formatter seam) ───────────────────────

describe("ToolPreviewFormatter.formatToolInputForPrompt — custom formatter seam", () => {
  function makeLookup(
    toolName: string,
    result: string | undefined,
  ): ToolInputFormatterLookup {
    return {
      get: (name) => (name === toolName ? () => result : undefined),
    };
  }

  test("uses a custom formatter's string result verbatim, bypassing the switch", () => {
    const lookup = makeLookup("my-tool", "custom preview");
    const f = makeFormatter({}, lookup);
    expect(f.formatToolInputForPrompt("my-tool", {})).toBe("custom preview");
  });

  test("falls through to the built-in switch when custom formatter returns undefined", () => {
    mockedStringify.mockReturnValue('{"x":1}');
    const lookup = makeLookup("unknown-tool", undefined);
    const f = makeFormatter({}, lookup);
    // Falls through to JSON default for unknown tools
    expect(f.formatToolInputForPrompt("unknown-tool", { x: 1 })).toContain(
      '{"x":1}',
    );
  });

  test("custom formatter for a built-in tool overrides the built-in preview", () => {
    const lookup = makeLookup("read", "custom read summary");
    const f = makeFormatter({}, lookup);
    // Would normally use formatReadInputForPrompt; custom overrides it
    expect(f.formatToolInputForPrompt("read", { path: "/foo.ts" })).toBe(
      "custom read summary",
    );
  });

  test("absent lookup preserves current behaviour for all tool types", () => {
    const f = makeFormatter();
    // Built-in path still works
    expect(f.formatToolInputForPrompt("read", { path: "/foo.ts" })).toContain(
      "/foo.ts",
    );
  });
});

// ── formatGenericToolInputForLog ──────────────────────────────────────────

describe("ToolPreviewFormatter.formatGenericToolInputForLog", () => {
  // The log path serializes through redactedJsonStringify, not the mocked
  // prompt-path serializer, so these exercise real serialization.
  test("returns undefined when serialization yields empty string", () => {
    const f = makeFormatter();
    expect(f.formatGenericToolInputForLog({})).toBeUndefined();
  });

  test("returns prefixed input preview", () => {
    const f = makeFormatter();
    expect(f.formatGenericToolInputForLog({ k: "v" })).toBe('input {"k":"v"}');
  });

  test("does not truncate — the log writer bounds what it persists", () => {
    const f = makeFormatter();
    const result = f.formatGenericToolInputForLog({ k: "x".repeat(2000) });
    expect(result).toBe(`input {"k":"${"x".repeat(2000)}"}`);
  });

  test("masks a sensitive-keyed value in the logged preview", () => {
    const f = makeFormatter();
    expect(
      f.formatGenericToolInputForLog({
        url: "https://example.test",
        authorization: "Bearer TEST_VALUE",
      }),
    ).toBe('input {"url":"https://example.test","authorization":"[redacted]"}');
  });
});

// ── prompt-vs-log redaction boundary ──────────────────────────────────────

describe("ToolPreviewFormatter redaction boundary", () => {
  // Both paths serialize for real here: the invariant is about what each one
  // emits, so asserting against a stubbed serializer would prove nothing.
  beforeEach(() => {
    mockedStringify.mockImplementation((value: unknown) =>
      JSON.stringify(value),
    );
  });

  const input = { authorization: "Bearer TEST_VALUE" };

  test("masks the value in the log preview but not in the ask-prompt", () => {
    const f = makeFormatter();

    expect(f.formatGenericToolInputForLog(input)).toBe(
      'input {"authorization":"[redacted]"}',
    );
    // The user must see the real input to make a permission decision.
    expect(f.formatToolInputForPrompt("http", input)).toBe(
      'with input {"authorization":"Bearer TEST_VALUE"}',
    );
  });

  test("masks a generic tool's input reaching the review log", () => {
    const f = makeFormatter();

    expect(
      f.getToolInputPreviewForLog(
        makeResult("http"),
        input,
        new Set(["read", "write", "edit"]),
      ),
    ).toBe('input {"authorization":"[redacted]"}');
  });
});

// ── getToolInputPreviewForLog ─────────────────────────────────────────────

describe("ToolPreviewFormatter.getToolInputPreviewForLog", () => {
  const pathBearingTools = new Set(["read", "write", "edit"]);

  test("returns undefined for bash tool", () => {
    const f = makeFormatter();
    expect(
      f.getToolInputPreviewForLog(
        makeResult("bash"),
        { command: "ls" },
        pathBearingTools,
      ),
    ).toBeUndefined();
  });

  test("returns undefined for mcp tool", () => {
    const f = makeFormatter();
    expect(
      f.getToolInputPreviewForLog(makeResult("mcp"), {}, pathBearingTools),
    ).toBeUndefined();
  });

  test("returns undefined for mcp source", () => {
    const f = makeFormatter();
    const result = makeResult("some-server:some-tool", { source: "mcp" });
    expect(
      f.getToolInputPreviewForLog(result, {}, pathBearingTools),
    ).toBeUndefined();
  });

  test("returns path-based preview for path-bearing tools", () => {
    const f = makeFormatter();
    const preview = f.getToolInputPreviewForLog(
      makeResult("read"),
      { path: "/src/foo.ts" },
      pathBearingTools,
    );
    expect(preview).toContain("/src/foo.ts");
  });

  test("does not truncate a path preview — the log writer bounds it", () => {
    const f = makeFormatter();
    const longPath = `/src/${"a".repeat(2000)}.ts`;
    const preview = f.getToolInputPreviewForLog(
      makeResult("read"),
      { path: longPath },
      pathBearingTools,
    );
    expect(preview).toBeDefined();
    expect(preview).toContain(longPath);
  });

  test("returns generic JSON preview for non-path-bearing tools", () => {
    mockedStringify.mockReturnValue('{"n":1}');
    const f = makeFormatter();
    const preview = f.getToolInputPreviewForLog(
      makeResult("task"),
      { n: 1 },
      pathBearingTools,
    );
    expect(preview).toContain('{"n":1}');
  });
});

// ── getPermissionLogContext ───────────────────────────────────────────────

describe("ToolPreviewFormatter.getPermissionLogContext", () => {
  const pathBearingTools = new Set(["read", "write", "edit"]);

  test("returns command, target, toolInputPreview, and origin fields", () => {
    const f = makeFormatter();
    const result = makeResult("bash", { command: "ls -la" });
    const ctx = f.getPermissionLogContext(result, {}, pathBearingTools);
    expect(ctx.command).toBe("ls -la");
    expect(ctx.target).toBeUndefined();
    expect(ctx.toolInputPreview).toBeUndefined();
  });

  test("includes toolInputPreview for non-bash path-bearing tools", () => {
    const f = makeFormatter();
    const result = makeResult("read");
    const ctx = f.getPermissionLogContext(
      result,
      { path: "/foo.ts" },
      pathBearingTools,
    );
    expect(ctx.toolInputPreview).toContain("/foo.ts");
  });

  test("includes origin from check result", () => {
    const f = makeFormatter();
    const result = makeResult("read", { origin: "project" });
    const ctx = f.getPermissionLogContext(result, {}, pathBearingTools);
    expect(ctx.origin).toBe("project");
  });

  test("toolInputPreview carries the whole path, for the writer to bound", () => {
    const f = makeFormatter();
    const longPath = `/src/${"a".repeat(2000)}.ts`;
    const ctx = f.getPermissionLogContext(
      makeResult("read"),
      { path: longPath },
      pathBearingTools,
    );
    expect(ctx.toolInputPreview).toContain(longPath);
  });
});

// ── resolveToolPreviewLimits ───────────────────────────────────────────────

// The two operator-facing caps are subsumed by the renderer budgets (ADR 0011
// §5), so the limits are now the built-in constants alone — no config is read.
describe("resolveToolPreviewLimits", () => {
  test("returns the three built-in constants", () => {
    expect(resolveToolPreviewLimits()).toEqual({
      toolInputPreviewMaxLength: TOOL_INPUT_PREVIEW_MAX_LENGTH,
      toolTextSummaryMaxLength: TOOL_TEXT_SUMMARY_MAX_LENGTH,
    });
  });
});
