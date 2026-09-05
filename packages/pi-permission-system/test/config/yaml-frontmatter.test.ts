import { describe, expect, test } from "vitest";

import {
  extractFrontmatter,
  parseSimpleYamlMap,
} from "#src/config/yaml-frontmatter";

describe("extractFrontmatter", () => {
  test("returns empty string when no frontmatter delimiter", () => {
    expect(extractFrontmatter("# Hello\nSome content")).toBe("");
  });

  test("returns empty string when only opening delimiter with no closing", () => {
    expect(extractFrontmatter("---\nkey: value")).toBe("");
  });

  test("returns frontmatter body between delimiters", () => {
    const markdown = "---\nissue: 1\ntitle: Test\n---\n# Content";
    expect(extractFrontmatter(markdown)).toBe("issue: 1\ntitle: Test");
  });

  test("returns empty string when file does not start with ---", () => {
    expect(extractFrontmatter("content\n---\nkey: val\n---")).toBe("");
  });

  test("handles CRLF line endings", () => {
    const markdown = "---\r\nissue: 5\r\n---\r\n# Content";
    expect(extractFrontmatter(markdown)).toBe("issue: 5");
  });

  test("returns empty string for empty string input", () => {
    expect(extractFrontmatter("")).toBe("");
  });

  test("returns empty frontmatter for --- \\n--- with nothing between", () => {
    const markdown = "---\n---\n# Content";
    expect(extractFrontmatter(markdown)).toBe("");
  });
});

describe("parseSimpleYamlMap", () => {
  test("returns empty object for empty string", () => {
    expect(parseSimpleYamlMap("")).toEqual({});
  });

  test("parses simple key-value pairs", () => {
    const yaml = "issue: 21\ntitle: Test";
    expect(parseSimpleYamlMap(yaml)).toEqual({ issue: "21", title: "Test" });
  });

  test("strips surrounding quotes from values", () => {
    const yaml = 'title: "My Title"';
    expect(parseSimpleYamlMap(yaml)).toEqual({ title: "My Title" });

    const yaml2 = "title: 'My Title'";
    expect(parseSimpleYamlMap(yaml2)).toEqual({ title: "My Title" });
  });

  test("skips lines without colon or with colon at position 0", () => {
    const yaml = "no separator here\n:starts-with-colon: val\nkey: val";
    const result = parseSimpleYamlMap(yaml);
    expect(result.key).toBe("val");
    expect(result["no separator here"]).toBeUndefined();
  });

  test("skips comment lines", () => {
    const yaml = "# This is a comment\nkey: value";
    expect(parseSimpleYamlMap(yaml)).toEqual({ key: "value" });
  });

  test("skips blank lines", () => {
    const yaml = "\n\nkey: value\n\n";
    expect(parseSimpleYamlMap(yaml)).toEqual({ key: "value" });
  });

  test("parses nested map (child indented under parent)", () => {
    const yaml = "parent:\n  child: nested_value";
    const result = parseSimpleYamlMap(yaml);
    expect(result.parent).toEqual({ child: "nested_value" });
  });

  test("handles multi-line values correctly (second line is new key)", () => {
    const yaml = "key1: val1\nkey2: val2";
    const result = parseSimpleYamlMap(yaml);
    expect(result.key1).toBe("val1");
    expect(result.key2).toBe("val2");
  });

  test("strips quotes from keys", () => {
    const yaml = '"quoted-key": value';
    const result = parseSimpleYamlMap(yaml);
    expect(result["quoted-key"]).toBe("value");
  });
});
