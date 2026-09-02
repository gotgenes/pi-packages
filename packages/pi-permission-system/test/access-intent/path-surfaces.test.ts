import { describe, expect, test } from "vitest";

import {
  capabilityDirectionOf,
  capabilitySurfaceForEffect,
  capabilitySurfaceForTool,
  PATH_BEARING_TOOLS,
  PATH_SURFACES,
  READ_ONLY_PATH_BEARING_TOOLS,
  surfaceFamilyMembers,
  surfaceFamilyOf,
} from "#src/access-intent/path-surfaces";

describe("PATH_BEARING_TOOLS", () => {
  test("contains the expected tool names", () => {
    for (const tool of ["read", "write", "edit", "find", "grep", "ls"]) {
      expect(PATH_BEARING_TOOLS.has(tool)).toBe(true);
    }
  });

  test("does not contain bash or mcp", () => {
    expect(PATH_BEARING_TOOLS.has("bash")).toBe(false);
    expect(PATH_BEARING_TOOLS.has("mcp")).toBe(false);
  });
});

describe("READ_ONLY_PATH_BEARING_TOOLS", () => {
  test("contains read, find, grep, ls", () => {
    for (const tool of ["read", "find", "grep", "ls"]) {
      expect(READ_ONLY_PATH_BEARING_TOOLS.has(tool)).toBe(true);
    }
  });

  test("does not contain write or edit", () => {
    expect(READ_ONLY_PATH_BEARING_TOOLS.has("write")).toBe(false);
    expect(READ_ONLY_PATH_BEARING_TOOLS.has("edit")).toBe(false);
  });
});

describe("PATH_SURFACES", () => {
  test("contains the path-bearing tools plus the cross-cutting gates", () => {
    for (const surface of [
      "read",
      "write",
      "edit",
      "find",
      "grep",
      "ls",
      "external_directory",
      "path",
    ]) {
      expect(PATH_SURFACES.has(surface)).toBe(true);
    }
  });

  test("contains the four directional surfaces", () => {
    for (const surface of [
      "path_read",
      "path_write",
      "external_directory_read",
      "external_directory_write",
    ]) {
      expect(PATH_SURFACES.has(surface)).toBe(true);
    }
  });

  test("does not contain bash or mcp", () => {
    expect(PATH_SURFACES.has("bash")).toBe(false);
    expect(PATH_SURFACES.has("mcp")).toBe(false);
  });
});

describe("surfaceFamilyOf", () => {
  test.each([
    ["path_read", "path"],
    ["path_write", "path"],
    ["external_directory_read", "external_directory"],
    ["external_directory_write", "external_directory"],
  ])("strips the capability suffix from %s", (surface, family) => {
    expect(surfaceFamilyOf(surface)).toBe(family);
  });

  test.each(["path", "external_directory", "read", "write", "bash", "mcp"])(
    "answers %s with itself",
    (surface) => {
      expect(surfaceFamilyOf(surface)).toBe(surface);
    },
  );

  test("leaves a suffixed surface outside the directional families alone", () => {
    expect(surfaceFamilyOf("my_tool_read")).toBe("my_tool_read");
    expect(surfaceFamilyOf("_read")).toBe("_read");
  });
});

describe("capabilityDirectionOf", () => {
  test.each([
    ["path_read", "read"],
    ["path_write", "write"],
    ["external_directory_read", "read"],
    ["external_directory_write", "write"],
  ])("names the direction %s proves", (surface, direction) => {
    expect(capabilityDirectionOf(surface)).toBe(direction);
  });

  test.each(["path", "external_directory", "read", "write", "bash", "mcp"])(
    "answers null for %s, which carries no capability suffix",
    (surface) => {
      expect(capabilityDirectionOf(surface)).toBeNull();
    },
  );

  test("answers null for a suffixed surface outside the directional families", () => {
    expect(capabilityDirectionOf("my_tool_read")).toBeNull();
    expect(capabilityDirectionOf("_read")).toBeNull();
  });
});

describe("surfaceFamilyMembers", () => {
  test("answers a family name with its members in read-then-write order", () => {
    expect(surfaceFamilyMembers("path")).toEqual(["path_read", "path_write"]);
    expect(surfaceFamilyMembers("external_directory")).toEqual([
      "external_directory_read",
      "external_directory_write",
    ]);
  });

  test.each([
    "path_read",
    "path_write",
    "external_directory_read",
    "read",
    "write",
    "edit",
    "bash",
  ])("answers null for %s, which is not a family name", (surface) => {
    expect(surfaceFamilyMembers(surface)).toBeNull();
  });
});

describe("capabilitySurfaceForTool", () => {
  test.each(["read", "grep", "find", "ls"])(
    "names the read surface for %s, whose direction is proven",
    (toolName) => {
      expect(capabilitySurfaceForTool("path", toolName)).toBe("path_read");
      expect(capabilitySurfaceForTool("external_directory", toolName)).toBe(
        "external_directory_read",
      );
    },
  );

  test("names the write surface for write", () => {
    expect(capabilitySurfaceForTool("path", "write")).toBe("path_write");
    expect(capabilitySurfaceForTool("external_directory", "write")).toBe(
      "external_directory_write",
    );
  });

  test.each([
    ["edit", "proven to do both"],
    ["mcp__server__tool", "an MCP tool of unknown direction"],
    ["some_extension_tool", "an extension tool of unknown direction"],
    ["bash", "a bash token of unknown direction"],
  ])("names the bare family for %s (%s)", (toolName) => {
    expect(capabilitySurfaceForTool("path", toolName)).toBe("path");
    expect(capabilitySurfaceForTool("external_directory", toolName)).toBe(
      "external_directory",
    );
  });
});

describe("capabilitySurfaceForEffect", () => {
  test("names the read surface for a proven read", () => {
    expect(capabilitySurfaceForEffect("path", "read")).toBe("path_read");
    expect(capabilitySurfaceForEffect("external_directory", "read")).toBe(
      "external_directory_read",
    );
  });

  test("names the write surface for a proven write", () => {
    expect(capabilitySurfaceForEffect("path", "write")).toBe("path_write");
    expect(capabilitySurfaceForEffect("external_directory", "write")).toBe(
      "external_directory_write",
    );
  });

  test("names the bare family for an unproven effect, which folds both", () => {
    expect(capabilitySurfaceForEffect("path", "unproven")).toBe("path");
    expect(capabilitySurfaceForEffect("external_directory", "unproven")).toBe(
      "external_directory",
    );
  });

  test("agrees with the tool-keyed selector, which routes through it", () => {
    expect(capabilitySurfaceForEffect("path", "read")).toBe(
      capabilitySurfaceForTool("path", "read"),
    );
    expect(capabilitySurfaceForEffect("path", "write")).toBe(
      capabilitySurfaceForTool("path", "write"),
    );
    expect(capabilitySurfaceForEffect("path", "unproven")).toBe(
      capabilitySurfaceForTool("path", "edit"),
    );
  });
});
