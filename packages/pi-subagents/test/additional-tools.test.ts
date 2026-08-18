import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAdditionalTools, sanitizeAdditionalTools, withAdditionalTools } from "#src/index";
import { createSettingsDirs, type SettingsDirs } from "#test/helpers/tmp-settings-dirs";

describe("sanitizeAdditionalTools", () => {
  it("rejects non-object roots (array, string, number, null, undefined)", () => {
    expect(sanitizeAdditionalTools(["general-purpose"])).toBeUndefined();
    expect(sanitizeAdditionalTools("general-purpose")).toBeUndefined();
    expect(sanitizeAdditionalTools(42)).toBeUndefined();
    expect(sanitizeAdditionalTools(null)).toBeUndefined();
    expect(sanitizeAdditionalTools(undefined)).toBeUndefined();
  });

  it("drops keys whose value is not an array", () => {
    expect(sanitizeAdditionalTools({ "general-purpose": "skill_manage" })).toBeUndefined();
    expect(
      sanitizeAdditionalTools({ "general-purpose": ["skill_manage"], "*": "memory_search" }),
    ).toEqual({ "general-purpose": ["skill_manage"] });
  });

  it("filters non-string and blank members out of a tool array", () => {
    expect(
      sanitizeAdditionalTools({ "*": ["memory_search", "", "   ", 42, null, {}, "session_search"] }),
    ).toEqual({ "*": ["memory_search", "session_search"] });
  });

  it("drops a key entirely when its array yields no valid tool names", () => {
    expect(sanitizeAdditionalTools({ "*": ["", "   ", 42] })).toBeUndefined();
    expect(
      sanitizeAdditionalTools({ "*": ["", 42], "general-purpose": ["skill_manage"] }),
    ).toEqual({ "general-purpose": ["skill_manage"] });
  });

  it("lowercases keys and unions colliding keys after trim/lowercase", () => {
    expect(
      sanitizeAdditionalTools({
        "General-Purpose": ["skill_manage"],
        "general-purpose": ["memory_add"],
        " GENERAL-PURPOSE ": ["memory_add", "memory_remove"],
      }),
    ).toEqual({ "general-purpose": ["skill_manage", "memory_add", "memory_remove"] });
  });

  it("trims whitespace on both keys and tool names", () => {
    expect(sanitizeAdditionalTools({ " * ": ["  memory_search  "] })).toEqual({ "*": ["memory_search"] });
  });

  it("returns undefined when every key sanitizes away (empty result)", () => {
    expect(sanitizeAdditionalTools({})).toBeUndefined();
    expect(sanitizeAdditionalTools({ "": ["memory_search"] })).toBeUndefined();
  });
});

describe("readAdditionalTools", () => {
  let dirs: SettingsDirs;
  let globalDir: string;
  let projectDir: string;
  let writeGlobal: (obj: unknown) => void;
  let writeProject: (obj: unknown) => void;

  beforeEach(() => {
    dirs = createSettingsDirs("subagents.json");
    ({ globalDir, projectDir, writeGlobal, writeProject } = dirs);
  });

  afterEach(() => {
    dirs.dispose();
  });

  it("returns undefined when both files are missing", () => {
    expect(readAdditionalTools(globalDir, projectDir)).toBeUndefined();
  });

  it("reads a global-only additionalTools config", () => {
    writeGlobal({ additionalTools: { "*": ["memory_search"], "general-purpose": ["skill_manage"] } });
    expect(readAdditionalTools(globalDir, projectDir)).toEqual({
      "*": ["memory_search"],
      "general-purpose": ["skill_manage"],
    });
  });

  it("project-layer additionalTools replaces global's, per loadLayeredSettings's shallow merge", () => {
    writeGlobal({ additionalTools: { "*": ["memory_search"], "general-purpose": ["skill_manage"] } });
    writeProject({ additionalTools: { "*": ["session_search"] } });
    // Shallow merge means the whole `additionalTools` value from the project
    // layer wins wholesale — it does not deep-merge per agent-type key.
    expect(readAdditionalTools(globalDir, projectDir)).toEqual({ "*": ["session_search"] });
  });

  it("returns undefined when the config file has no additionalTools key", () => {
    writeGlobal({ maxConcurrent: 4 });
    expect(readAdditionalTools(globalDir, projectDir)).toBeUndefined();
  });
});

describe("withAdditionalTools", () => {
  function makeRegistry() {
    return {
      resolveAgentConfig: (type: string) => ({
        name: type,
        displayName: type,
        description: "",
        toolNames: ["read", "bash"],
        systemPrompt: "",
        promptMode: "append" as const,
      }),
      getToolNamesForType: (type: string) =>
        type.toLowerCase() === "general-purpose" ? ["read", "bash", "edit", "write", "grep", "find", "ls"] : ["read"],
      resolveType: (name: string) => (name.toLowerCase() === "general-purpose" ? "general-purpose" : undefined),
    };
  }

  it("returns the same registry unchanged (passthrough) when config is undefined", () => {
    const registry = makeRegistry();
    expect(withAdditionalTools(registry, undefined)).toBe(registry);
  });

  it("unions '*' and per-type grants into the base list, deduped", () => {
    const registry = makeRegistry();
    const wrapped = withAdditionalTools(registry, {
      "*": ["memory_search", "session_search"],
      "general-purpose": ["skill_manage", "memory_add", "memory_search"], // memory_search dupes across "*"
    });
    expect(wrapped.getToolNamesForType("general-purpose")).toEqual([
      "read",
      "bash",
      "edit",
      "write",
      "grep",
      "find",
      "ls",
      "memory_search",
      "session_search",
      "skill_manage",
      "memory_add",
    ]);
  });

  it("grants only the '*' entries to a type the registry can't resolve", () => {
    const registry = makeRegistry();
    const wrapped = withAdditionalTools(registry, {
      "*": ["memory_search", "session_search"],
      "general-purpose": ["skill_manage"],
    });
    expect(wrapped.getToolNamesForType("Explore")).toEqual(["read", "memory_search", "session_search"]);
  });

  it("returns the base list unchanged when neither '*' nor the type has grants", () => {
    const registry = makeRegistry();
    const wrapped = withAdditionalTools(registry, { "general-purpose": ["skill_manage"] });
    expect(wrapped.getToolNamesForType("Explore")).toEqual(["read"]);
  });

  it("delegates resolveAgentConfig unchanged", () => {
    const registry = makeRegistry();
    const wrapped = withAdditionalTools(registry, { "*": ["memory_search"] });
    expect(wrapped.resolveAgentConfig("general-purpose")).toEqual(registry.resolveAgentConfig("general-purpose"));
  });
});
