import { describe, expect, test } from "vitest";

import {
  formatEditInputForPrompt,
  formatReadInputForPrompt,
  formatWriteInputForPrompt,
  getPromptPath,
} from "#src/tool-input/tool-input-prompt-formatters";

describe("getPromptPath", () => {
  test("returns path from 'path' key", () => {
    expect(getPromptPath({ path: "/foo/bar" })).toBe("/foo/bar");
  });

  test("falls back to 'file_path' key", () => {
    expect(getPromptPath({ file_path: "/baz" })).toBe("/baz");
  });

  test("returns null when neither key is present", () => {
    expect(getPromptPath({})).toBeNull();
  });

  test("returns null when path is empty string", () => {
    expect(getPromptPath({ path: "" })).toBeNull();
  });
});

describe("formatEditInputForPrompt", () => {
  test("returns path-only description when no edits provided", () => {
    const result = formatEditInputForPrompt({ path: "/foo.ts" });
    expect(result).toBe("for '/foo.ts' with edit input");
  });

  test("formats single replacement with line counts", () => {
    const result = formatEditInputForPrompt({
      path: "/foo.ts",
      edits: [{ oldText: "line1\nline2", newText: "replaced" }],
    });
    expect(result).toContain("for '/foo.ts'");
    expect(result).toContain("1 replacement");
    expect(result).toContain("2 lines");
    expect(result).toContain("1 line");
  });

  test("formats multiple replacements mentioning additional edits", () => {
    const result = formatEditInputForPrompt({
      path: "/foo.ts",
      edits: [
        { oldText: "a", newText: "b" },
        { oldText: "c", newText: "d" },
        { oldText: "e", newText: "f" },
      ],
    });
    expect(result).toContain("3 replacements");
    expect(result).toContain("2 additional edits");
  });

  test("falls back to oldText/newText when no edits array", () => {
    const result = formatEditInputForPrompt({
      path: "/bar.ts",
      oldText: "old",
      newText: "new",
    });
    expect(result).toContain("for '/bar.ts'");
    expect(result).toContain("1 replacement");
  });

  test("works without a path", () => {
    const result = formatEditInputForPrompt({
      edits: [{ oldText: "x", newText: "y" }],
    });
    expect(result).not.toContain("for '");
    expect(result).toContain("1 replacement");
  });
});

describe("formatWriteInputForPrompt", () => {
  test("includes path, line count, and character count", () => {
    const result = formatWriteInputForPrompt({
      path: "/out.ts",
      content: "line1\nline2",
    });
    expect(result).toContain("for '/out.ts'");
    expect(result).toContain("2 lines");
    expect(result).toContain("11 characters");
  });

  test("handles missing content as empty", () => {
    const result = formatWriteInputForPrompt({ path: "/out.ts" });
    expect(result).toContain("0 lines");
    expect(result).toContain("0 characters");
  });
});

describe("formatReadInputForPrompt", () => {
  test("includes path", () => {
    expect(formatReadInputForPrompt({ path: "/src/foo.ts" })).toBe(
      "for path '/src/foo.ts'",
    );
  });

  test("includes offset and limit when present", () => {
    const result = formatReadInputForPrompt({
      path: "/x",
      offset: 10,
      limit: 50,
    });
    expect(result).toContain("offset 10");
    expect(result).toContain("limit 50");
  });

  test("returns empty string when no path and no options", () => {
    expect(formatReadInputForPrompt({})).toBe("");
  });
});
