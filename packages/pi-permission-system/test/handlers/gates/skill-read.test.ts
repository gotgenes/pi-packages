import { describe, expect, it, vi } from "vitest";
import { describeSkillReadGate } from "#src/handlers/gates/skill-read";
import type { ToolCallContext } from "#src/handlers/gates/types";
import { posixPathFlavor } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path-normalizer";
import type { SkillPromptEntry } from "#src/skill-prompt-sanitizer";

// All test tccs use cwd "/test/project"; one normalizer serves every call.
const normalizer = new PathNormalizer(posixPathFlavor, "/test/project");

// ── SDK stubs ──────────────────────────────────────────────────────────────
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return { ...original };
});

// ── helpers ────────────────────────────────────────────────────────────────

function makeSkillEntry(
  overrides: Partial<SkillPromptEntry> = {},
): SkillPromptEntry {
  return {
    name: "librarian",
    description: "Research skills",
    location: "/skills/librarian/SKILL.md",
    state: "ask",
    normalizedLocation: "/skills/librarian/SKILL.md",
    normalizedBaseDir: "/skills/librarian",
    ...overrides,
  };
}

function makeTcc(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    toolName: "read",
    agentName: null,
    input: { path: "/skills/librarian/SKILL.md" },
    toolCallId: "tc-1",
    cwd: "/test/project",
    ...overrides,
  };
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("describeSkillReadGate", () => {
  it("returns null when tool is not read", () => {
    const result = describeSkillReadGate(
      makeTcc({ toolName: "write" }),
      normalizer,
      () => [makeSkillEntry()],
    );
    expect(result).toBeNull();
  });

  it("returns null when no active skill entries", () => {
    const result = describeSkillReadGate(makeTcc(), normalizer, () => []);
    expect(result).toBeNull();
  });

  it("returns null when read path does not match any skill", () => {
    const result = describeSkillReadGate(
      makeTcc({ input: { path: "/test/project/src/index.ts" } }),
      normalizer,
      () => [makeSkillEntry()],
    );
    expect(result).toBeNull();
  });

  it("returns null when input has no path", () => {
    const result = describeSkillReadGate(
      makeTcc({ input: {} }),
      normalizer,
      () => [makeSkillEntry()],
    );
    expect(result).toBeNull();
  });

  it("returns GateDescriptor with preResolved.state matching skill entry state (ask)", () => {
    const result = describeSkillReadGate(makeTcc(), normalizer, () => [
      makeSkillEntry({ state: "ask" }),
    ]);
    expect(result).not.toBeNull();
    const desc = result!;
    expect(desc.preResolved).toEqual({ state: "ask" });
  });

  it("returns GateDescriptor with preResolved.state matching skill entry state (allow)", () => {
    const result = describeSkillReadGate(makeTcc(), normalizer, () => [
      makeSkillEntry({ state: "allow" }),
    ]);
    expect(result).not.toBeNull();
    const desc = result!;
    expect(desc.preResolved).toEqual({ state: "allow" });
  });

  it("returns GateDescriptor with preResolved.state matching skill entry state (deny)", () => {
    const result = describeSkillReadGate(makeTcc(), normalizer, () => [
      makeSkillEntry({ state: "deny" }),
    ]);
    expect(result).not.toBeNull();
    const desc = result!;
    expect(desc.preResolved).toEqual({ state: "deny" });
  });

  it("decision surface is 'skill' and decision value is the skill name", () => {
    const result = describeSkillReadGate(makeTcc(), normalizer, () => [
      makeSkillEntry({ name: "my-skill" }),
    ])!;
    expect(result.decision.surface).toBe("skill");
    expect(result.decision.value).toBe("my-skill");
  });

  it("carries the skill name as single-value access facts on promptDetails", () => {
    const result = describeSkillReadGate(makeTcc(), normalizer, () => [
      makeSkillEntry({ name: "my-skill" }),
    ])!;
    expect(result.promptDetails.accessIntent).toEqual({
      surface: "skill",
      matchValues: ["my-skill"],
      boundaryValue: null,
    });
  });

  it("emits a skill_read payload keeping the skill as the decision value", () => {
    const result = describeSkillReadGate(makeTcc(), normalizer, () => [
      makeSkillEntry({ name: "my-skill" }),
    ])!;

    expect(result.payload.kind).toBe("skill_read");
    expect(result.payload.request.value).toBe("my-skill");
  });

  it("payload contains the skill name and the path it was reached through", () => {
    const result = describeSkillReadGate(makeTcc(), normalizer, () => [
      makeSkillEntry({ name: "librarian" }),
    ])!;
    expect(result.payload.kind).toBe("skill_read");
    expect(result.payload.request.value).toBe("librarian");
    expect(result.payload.request.requester.agentName).toBeNull();
    expect(result.payload.evidence).toEqual([
      {
        label: "read path",
        text: "/skills/librarian/SKILL.md",
        detail: null,
      },
    ]);
  });

  it("promptDetails includes skill_read source and skillName", () => {
    const result = describeSkillReadGate(
      makeTcc({ agentName: "test-agent", toolCallId: "tc-42" }),
      normalizer,
      () => [makeSkillEntry({ name: "my-skill" })],
    )!;
    expect(result.promptDetails).toMatchObject({
      source: "skill_read",
      agentName: "test-agent",
      toolCallId: "tc-42",
      toolName: "read",
      skillName: "my-skill",
    });
  });

  it("logContext includes skill_read source and skillName", () => {
    const result = describeSkillReadGate(
      makeTcc({ agentName: "agent-1" }),
      normalizer,
      () => [makeSkillEntry({ name: "librarian" })],
    )!;
    expect(result.logContext).toMatchObject({
      source: "skill_read",
      skillName: "librarian",
      agentName: "agent-1",
    });
  });

  it("surface is 'skill' on the descriptor", () => {
    const result = describeSkillReadGate(makeTcc(), normalizer, () => [
      makeSkillEntry(),
    ])!;
    expect(result.surface).toBe("skill");
  });
});
