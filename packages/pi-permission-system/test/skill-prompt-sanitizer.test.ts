import { resolve } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { posixPathFlavor } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path/path-normalizer";
import type { ScopedPermissionManager } from "#src/policy/permission-manager";
import {
  findSkillPathMatch,
  parseAllSkillPromptSections,
  resolveSkillPromptEntries,
  type SkillPermissionChecker,
} from "#src/skill-prompt-sanitizer";
import type { PermissionCheckResult } from "#src/types";
import { createManager } from "#test/helpers/manager-harness";

/**
 * Adapt a real `PermissionManager` to the raw `SkillPermissionChecker`
 * contract, mirroring how `PermissionResolver.checkPermission` delegates to
 * `manager.check` with a tool intent (#478).
 */
function asChecker(manager: ScopedPermissionManager): SkillPermissionChecker {
  return {
    checkPermission: (surface, input, agentName) =>
      manager.check({ kind: "tool", surface, input, agentName }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Helpers ────────────────────────────────────────────────────────────────

const CWD = "/projects/my-app";

// `findSkillPathMatch` only uses the normalizer's platform (it compares two
// already-absolute paths via `isWithinDirectory`), so this CWD-baked instance
// serves every call regardless of the entries' cwd.
const normalizer = new PathNormalizer(posixPathFlavor, CWD);

function makeManager(
  defaultState: "allow" | "deny" | "ask" = "allow",
  overrides: Record<string, "allow" | "deny" | "ask"> = {},
): SkillPermissionChecker {
  return {
    checkPermission: vi.fn(
      (_surface: string, input: unknown): PermissionCheckResult => {
        const name = (input as { name?: string }).name ?? "";
        const state = overrides[name] ?? defaultState;
        return { toolName: "skill", state, source: "tool", origin: "builtin" };
      },
    ),
  };
}

function skillBlock(
  name: string,
  location = `/skills/${name}/SKILL.md`,
): string {
  return [
    "  <skill>",
    `    <name>${name}</name>`,
    `    <description>Description of ${name}</description>`,
    `    <location>${location}</location>`,
    "  </skill>",
  ].join("\n");
}

function availableSkillsSection(...names: string[]): string {
  return [
    "<available_skills>",
    ...names.map((n) => skillBlock(n)),
    "</available_skills>",
  ].join("\n");
}

// ── resolveSkillPromptEntries ───────────────────────────────────────────────

describe("resolveSkillPromptEntries", () => {
  test("returns unchanged prompt and empty entries when no skills section present", () => {
    const input = "You are a helpful assistant.";
    const manager = makeManager("allow");
    const result = resolveSkillPromptEntries(input, manager, null, normalizer);
    expect(result.prompt).toBe(input);
    expect(result.entries).toEqual([]);
    expect(manager.checkPermission).not.toHaveBeenCalled();
  });

  test("keeps all skills when all are allowed", () => {
    const input = availableSkillsSection("librarian", "ask-user");
    const manager = makeManager("allow");
    const result = resolveSkillPromptEntries(input, manager, null, normalizer);
    expect(result.prompt).toContain("librarian");
    expect(result.prompt).toContain("ask-user");
    expect(result.entries).toHaveLength(2);
  });

  test("removes denied skill from section", () => {
    const input = availableSkillsSection("librarian", "dangerous");
    const manager = makeManager("allow", { dangerous: "deny" });
    const result = resolveSkillPromptEntries(input, manager, null, normalizer);
    expect(result.prompt).toContain("librarian");
    expect(result.prompt).not.toContain("dangerous");
    // denied skill is excluded from returned entries
    expect(result.entries.map((e) => e.name)).not.toContain("dangerous");
  });

  test("removes entire section when all skills are denied", () => {
    const input = `Intro\n${availableSkillsSection("dangerous")}\nOutro`;
    const manager = makeManager("deny");
    const result = resolveSkillPromptEntries(input, manager, null, normalizer);
    expect(result.prompt).not.toContain("<available_skills>");
    expect(result.prompt).toContain("Intro");
    expect(result.prompt).toContain("Outro");
    expect(result.entries).toHaveLength(0);
  });

  test("keeps ask-state skills in section and entries", () => {
    const input = availableSkillsSection("librarian");
    const manager = makeManager("ask");
    const result = resolveSkillPromptEntries(input, manager, null, normalizer);
    expect(result.prompt).toContain("librarian");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].state).toBe("ask");
  });

  test("delegates permission check to permissionManager for each skill", () => {
    const input = availableSkillsSection("alpha", "beta");
    const manager = makeManager("allow");
    resolveSkillPromptEntries(input, manager, null, normalizer);
    expect(manager.checkPermission).toHaveBeenCalledWith(
      "skill",
      { name: "alpha" },
      undefined,
    );
    expect(manager.checkPermission).toHaveBeenCalledWith(
      "skill",
      { name: "beta" },
      undefined,
    );
  });

  test("passes agentName to permissionManager", () => {
    const input = availableSkillsSection("librarian");
    const manager = makeManager("allow");
    resolveSkillPromptEntries(input, manager, "my-agent", normalizer);
    expect(manager.checkPermission).toHaveBeenCalledWith(
      "skill",
      { name: "librarian" },
      "my-agent",
    );
  });

  test("caches permission result: checkPermission called once per unique skill name", () => {
    // Same skill appears in two separate sections.
    const input = [
      availableSkillsSection("librarian"),
      availableSkillsSection("librarian"),
    ].join("\n");
    const manager = makeManager("allow");
    resolveSkillPromptEntries(input, manager, null, normalizer);
    // Should only be called once despite appearing twice.
    expect(manager.checkPermission).toHaveBeenCalledTimes(1);
  });

  test("resolves entry normalizedLocation relative to cwd", () => {
    const location = "/skills/librarian/SKILL.md";
    const input = availableSkillsSection("librarian");
    const manager = makeManager("allow");
    const result = resolveSkillPromptEntries(input, manager, null, normalizer);
    expect(result.entries[0].normalizedLocation).toBe(location);
    expect(result.entries[0].normalizedBaseDir).toBe("/skills/librarian");
  });

  test("handles multi-section prompt: processes each section independently", () => {
    const section1 = availableSkillsSection("alpha");
    const section2 = availableSkillsSection("beta");
    const input = `${section1}\n${section2}`;
    const manager = makeManager("allow", { beta: "deny" });
    const result = resolveSkillPromptEntries(input, manager, null, normalizer);
    expect(result.entries.map((e) => e.name)).toContain("alpha");
    expect(result.entries.map((e) => e.name)).not.toContain("beta");
  });
});

// ── findSkillPathMatch ──────────────────────────────────────────────────────

describe("findSkillPathMatch", () => {
  const entries = [
    {
      name: "librarian",
      description: "desc",
      location: "/skills/librarian/SKILL.md",
      state: "allow" as const,
      normalizedLocation: "/skills/librarian/SKILL.md",
      normalizedBaseDir: "/skills/librarian",
    },
    {
      name: "ask-user",
      description: "desc",
      location: "/skills/ask-user/SKILL.md",
      state: "allow" as const,
      normalizedLocation: "/skills/ask-user/SKILL.md",
      normalizedBaseDir: "/skills/ask-user",
    },
  ];

  test("returns null for empty normalized path", () => {
    expect(findSkillPathMatch("", entries, normalizer)).toBeNull();
  });

  test("returns null for empty entries array", () => {
    expect(
      findSkillPathMatch("/skills/librarian/SKILL.md", [], normalizer),
    ).toBeNull();
  });

  test("matches exact location path", () => {
    const match = findSkillPathMatch(
      "/skills/librarian/SKILL.md",
      entries,
      normalizer,
    );
    expect(match?.name).toBe("librarian");
  });

  test("matches path within skill base directory", () => {
    const match = findSkillPathMatch(
      "/skills/librarian/extra/helper.md",
      entries,
      normalizer,
    );
    expect(match?.name).toBe("librarian");
  });

  test("returns null for path not within any skill directory", () => {
    const match = findSkillPathMatch(
      "/other/path/file.md",
      entries,
      normalizer,
    );
    expect(match).toBeNull();
  });

  test("returns null for sibling path that shares a prefix", () => {
    // "/skills/librarian-extra" should not match "/skills/librarian"
    const match = findSkillPathMatch(
      "/skills/librarian-extra/SKILL.md",
      entries,
      normalizer,
    );
    expect(match).toBeNull();
  });

  test("prefers longer matching base directory (most specific skill wins)", () => {
    const nestedEntries = [
      {
        name: "parent",
        description: "desc",
        location: "/skills/parent/SKILL.md",
        state: "allow" as const,
        normalizedLocation: "/skills/parent/SKILL.md",
        normalizedBaseDir: "/skills/parent",
      },
      {
        name: "child",
        description: "desc",
        location: "/skills/parent/child/SKILL.md",
        state: "allow" as const,
        normalizedLocation: "/skills/parent/child/SKILL.md",
        normalizedBaseDir: "/skills/parent/child",
      },
    ];
    const match = findSkillPathMatch(
      "/skills/parent/child/helper.md",
      nestedEntries,
      normalizer,
    );
    expect(match?.name).toBe("child");
  });
});

// ---------------------------------------------------------------------------
// Moved from permission-system.test.ts catch-all (#342)
// ---------------------------------------------------------------------------

test("parseAllSkillPromptSections finds every available_skills block", () => {
  const prompt = [
    "Some preamble",
    "<available_skills>",
    "  <skill>",
    "    <name>skill-one</name>",
    "    <description>First skill</description>",
    "    <location>/path/to/one</location>",
    "  </skill>",
    "</available_skills>",
    "Some content between",
    "<available_skills>",
    "  <skill>",
    "    <name>skill-two</name>",
    "    <description>Second skill</description>",
    "    <location>/path/to/two</location>",
    "  </skill>",
    "</available_skills>",
    "Footer",
  ].join("\n");

  const sections = parseAllSkillPromptSections(prompt);

  expect(sections.length).toBe(2);
  expect(sections[0].entries[0]?.name).toBe("skill-one");
  expect(sections[1].entries[0]?.name).toBe("skill-two");
});

test("REGRESSION: resolveSkillPromptEntries sanitizes every available_skills block", () => {
  const { manager, cleanup } = createManager({
    permission: {
      "*": "ask",
      skill: { "denied-skill": "deny" },
    },
  });

  try {
    const prompt = [
      "System prompt start",
      "<available_skills>",
      "  <skill>",
      "    <name>visible-skill</name>",
      "    <description>Allowed skill</description>",
      "    <location>/skills/visible/index.ts</location>",
      "  </skill>",
      "  <skill>",
      "    <name>denied-skill</name>",
      "    <description>Denied in first block</description>",
      "    <location>/skills/blocked/one.ts</location>",
      "  </skill>",
      "</available_skills>",
      "Agent identity section",
      "<available_skills>",
      "  <skill>",
      "    <name>denied-skill</name>",
      "    <description>Denied in second block</description>",
      "    <location>/skills/blocked/two.ts</location>",
      "  </skill>",
      "</available_skills>",
      "System prompt end",
    ].join("\n");

    const result = resolveSkillPromptEntries(
      prompt,
      asChecker(manager),
      null,
      new PathNormalizer(posixPathFlavor, "/cwd"),
    );

    expect(result.prompt).not.toContain("denied-skill");
    expect(result.prompt).toContain("visible-skill");
    expect((result.prompt.match(/<available_skills>/g) ?? []).length).toBe(1);
    expect(result.entries.map((entry) => entry.name)).toEqual([
      "visible-skill",
    ]);
  } finally {
    cleanup();
  }
});

test("REGRESSION: resolveSkillPromptEntries keeps only visible skills available for path matching", () => {
  const { manager, cleanup } = createManager({
    permission: {
      "*": "ask",
      skill: { "blocked-skill": "deny" },
    },
  });

  try {
    const prompt = [
      "System prompt start",
      "<available_skills>",
      "  <skill>",
      "    <name>blocked-skill</name>",
      "    <description>Blocked skill</description>",
      "    <location>@./skills/blocked/entry.ts</location>",
      "  </skill>",
      "</available_skills>",
      "Middle section",
      "<available_skills>",
      "  <skill>",
      "    <name>visible-skill</name>",
      "    <description>Visible skill</description>",
      "    <location>@./skills/visible/entry.ts</location>",
      "  </skill>",
      "</available_skills>",
      "System prompt end",
    ].join("\n");

    const result = resolveSkillPromptEntries(
      prompt,
      asChecker(manager),
      null,
      new PathNormalizer(posixPathFlavor, "/cwd"),
    );
    const visiblePath = resolve("/cwd", "./skills/visible/file.ts");
    const blockedPath = resolve("/cwd", "./skills/blocked/file.ts");
    const matchedVisibleSkill = findSkillPathMatch(
      process.platform === "win32" ? visiblePath.toLowerCase() : visiblePath,
      result.entries,
      normalizer,
    );
    const matchedBlockedSkill = findSkillPathMatch(
      process.platform === "win32" ? blockedPath.toLowerCase() : blockedPath,
      result.entries,
      normalizer,
    );

    expect(matchedVisibleSkill?.name).toBe("visible-skill");
    expect(matchedBlockedSkill).toBe(null);
  } finally {
    cleanup();
  }
});
