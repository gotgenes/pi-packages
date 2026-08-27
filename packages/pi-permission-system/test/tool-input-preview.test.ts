import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Mock the serialization collaborator before importing the module under test.
vi.mock("../src/json-safe-stringify.js", () => ({
  safeJsonStringify: vi.fn((value: unknown) => JSON.stringify(value)),
}));

import { safeJsonStringify } from "#src/json-safe-stringify";
import {
  countTextLines,
  formatCount,
  serializeToolInputPreview,
  TOOL_INPUT_PREVIEW_MAX_LENGTH,
  TOOL_TEXT_SUMMARY_MAX_LENGTH,
  truncateInlineText,
} from "#src/tool-input-preview";

const mockedStringify = vi.mocked(safeJsonStringify);

beforeEach(() => {
  mockedStringify.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("constants", () => {
  test("TOOL_INPUT_PREVIEW_MAX_LENGTH is 200", () => {
    expect(TOOL_INPUT_PREVIEW_MAX_LENGTH).toBe(200);
  });

  test("TOOL_TEXT_SUMMARY_MAX_LENGTH is 80", () => {
    expect(TOOL_TEXT_SUMMARY_MAX_LENGTH).toBe(80);
  });
});

describe("truncateInlineText", () => {
  test("returns text unchanged when within maxLength", () => {
    expect(truncateInlineText("hello", 10)).toBe("hello");
  });

  test("does not truncate when length equals maxLength", () => {
    const text = "a".repeat(200);
    expect(truncateInlineText(text, 200)).toBe(text);
  });

  test("truncates and appends ellipsis when length exceeds maxLength", () => {
    const text = "a".repeat(201);
    const result = truncateInlineText(text, 200);
    expect(result).toBe(`${"a".repeat(200)}…`);
  });

  test("truncates long text and appends ellipsis", () => {
    const result = truncateInlineText("abcdef", 3);
    expect(result).toBe("abc…");
  });
});

describe("countTextLines", () => {
  test("returns 0 for empty string", () => {
    expect(countTextLines("")).toBe(0);
  });

  test("returns 1 for a single line with no newline", () => {
    expect(countTextLines("hello")).toBe(1);
  });

  test("counts LF-separated lines", () => {
    expect(countTextLines("line1\nline2\nline3")).toBe(3);
  });

  test("counts CRLF-separated lines", () => {
    expect(countTextLines("line1\r\nline2")).toBe(2);
  });

  test("counts CR-separated lines", () => {
    expect(countTextLines("line1\rline2")).toBe(2);
  });
});

describe("formatCount", () => {
  test("uses singular form for 1", () => {
    expect(formatCount(1, "line", "lines")).toBe("1 line");
  });

  test("uses plural form for 0", () => {
    expect(formatCount(0, "line", "lines")).toBe("0 lines");
  });

  test("uses plural form for 2+", () => {
    expect(formatCount(3, "line", "lines")).toBe("3 lines");
  });
});

describe("serializeToolInputPreview", () => {
  test("delegates serialization to safeJsonStringify", () => {
    mockedStringify.mockReturnValue('{"key":"value"}');
    const result = serializeToolInputPreview({ key: "value" });
    expect(mockedStringify).toHaveBeenCalledWith({ key: "value" });
    expect(result).toBe('{"key":"value"}');
  });

  test("returns empty string when safeJsonStringify returns undefined", () => {
    mockedStringify.mockReturnValue(undefined);
    expect(serializeToolInputPreview({})).toBe("");
  });

  test("returns empty string when serialized value is '{}'", () => {
    mockedStringify.mockReturnValue("{}");
    expect(serializeToolInputPreview({})).toBe("");
  });

  test("returns empty string when serialized value is 'null'", () => {
    mockedStringify.mockReturnValue("null");
    expect(serializeToolInputPreview(null)).toBe("");
  });

  test("collapses whitespace in serialized output", () => {
    mockedStringify.mockReturnValue('{\n  "key":  "val"\n}');
    const result = serializeToolInputPreview({});
    expect(result).toBe('{ "key": "val" }');
  });
});
