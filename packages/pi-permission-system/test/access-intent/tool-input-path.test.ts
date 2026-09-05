import { describe, expect, test } from "vitest";
import {
  getPathBearingToolPath,
  getToolInputPath,
} from "#src/access-intent/tool-input-path";
import type {
  RegistrationOrigin,
  ToolAccessExtractorLookup,
} from "#src/tool-input/tool-access-extractor-registry";

describe("getPathBearingToolPath", () => {
  test("returns path for a path-bearing tool", () => {
    expect(getPathBearingToolPath("read", { path: "/src/foo.ts" })).toBe(
      "/src/foo.ts",
    );
  });

  test("returns null for a non-path-bearing tool", () => {
    expect(getPathBearingToolPath("bash", { path: "/src/foo.ts" })).toBeNull();
    expect(getPathBearingToolPath("mcp", { path: "/src/foo.ts" })).toBeNull();
    expect(getPathBearingToolPath("task", { path: "/src/foo.ts" })).toBeNull();
  });

  test("returns null when input has no path", () => {
    expect(getPathBearingToolPath("read", {})).toBeNull();
    expect(getPathBearingToolPath("read", { path: "" })).toBeNull();
    expect(getPathBearingToolPath("read", null)).toBeNull();
  });
});

describe("getToolInputPath", () => {
  function lookupOf(
    toolName: string,
    extractor: (input: Record<string, unknown>) => string | undefined,
    origin: RegistrationOrigin = "local",
  ): ToolAccessExtractorLookup {
    return {
      resolve: (name) =>
        name === toolName ? { extractor, origin } : undefined,
    };
  }

  test("returns input.path for a built-in path-bearing tool", () => {
    expect(getToolInputPath("read", { path: "/src/foo.ts" })).toEqual({
      path: "/src/foo.ts",
      source: "convention",
    });
    expect(getToolInputPath("write", { path: "/src/bar.ts" })).toEqual({
      path: "/src/bar.ts",
      source: "convention",
    });
  });

  test("returns null for bash", () => {
    expect(getToolInputPath("bash", { path: "/src/foo.ts" })).toEqual({
      path: null,
      source: "convention",
    });
  });

  test("returns the MCP arguments.path for an mcp call", () => {
    expect(
      getToolInputPath("mcp", { arguments: { path: "/etc/hosts" } }),
    ).toEqual({ path: "/etc/hosts", source: "convention" });
  });

  test("returns null for an mcp call without an arguments.path", () => {
    expect(
      getToolInputPath("mcp", { arguments: { query: "x" } }).path,
    ).toBeNull();
    expect(getToolInputPath("mcp", {}).path).toBeNull();
  });

  test("defaults to input.path for an unregistered extension tool", () => {
    expect(getToolInputPath("my-ext", { path: "/work/file.txt" })).toEqual({
      path: "/work/file.txt",
      source: "convention",
    });
  });

  test("returns null for an extension tool without a path", () => {
    expect(getToolInputPath("my-ext", { other: true }).path).toBeNull();
    expect(getToolInputPath("my-ext", { path: "" }).path).toBeNull();
    expect(getToolInputPath("my-ext", null).path).toBeNull();
  });

  test("uses a registered extractor's path over the default convention", () => {
    const extractors = lookupOf("ffgrep", (input) =>
      typeof input.target === "string" ? input.target : undefined,
    );
    expect(
      getToolInputPath("ffgrep", { target: "/etc/passwd" }, extractors),
    ).toEqual({ path: "/etc/passwd", source: "local_extractor" });
  });

  test("returns null when a registered extractor declines", () => {
    const extractors = lookupOf("ffgrep", () => undefined);
    expect(
      getToolInputPath("ffgrep", { target: "x" }, extractors).path,
    ).toBeNull();
  });

  describe("path source", () => {
    test("names an inherited extractor as the source of its path", () => {
      const extractors = lookupOf(
        "ffgrep",
        (input) =>
          typeof input.target === "string" ? input.target : undefined,
        "inherited",
      );
      expect(
        getToolInputPath("ffgrep", { target: "/etc/passwd" }, extractors),
      ).toEqual({ path: "/etc/passwd", source: "inherited_extractor" });
    });

    test("falls back to the convention when no extractor answers", () => {
      const extractors = lookupOf("other-tool", () => "/unused");
      expect(
        getToolInputPath("ffgrep", { path: "/work/file.txt" }, extractors),
      ).toEqual({ path: "/work/file.txt", source: "convention" });
    });
  });
});
