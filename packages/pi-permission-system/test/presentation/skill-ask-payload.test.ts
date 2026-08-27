import { describe, expect, test } from "vitest";
import {
  buildSkillAskPayload,
  buildSkillPathAskPayload,
} from "#src/presentation/skill-ask-payload";
import type { SkillPromptEntry } from "#src/skill-prompt-sanitizer";

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

describe("buildSkillAskPayload", () => {
  test("makes the skill the decision-relevant value", () => {
    const payload = buildSkillAskPayload("librarian", "my-agent");

    expect(payload.kind).toBe("skill");
    expect(payload.request).toEqual({
      requester: { agentName: "my-agent", forwarded: false, sessionId: null },
      surface: "skill",
      toolName: null,
      invokedToolName: null,
      value: "librarian",
      matchedPattern: null,
      commandContext: null,
      executedUnit: null,
    });
    expect(payload.evidence).toEqual([]);
  });

  test("leaves the requester unnamed when no agent is active", () => {
    expect(buildSkillAskPayload("librarian", null).request.requester).toEqual({
      agentName: null,
      forwarded: false,
      sessionId: null,
    });
  });
});

describe("buildSkillPathAskPayload", () => {
  test("keeps the skill as the value and the path as evidence", () => {
    const payload = buildSkillPathAskPayload(
      skillEntry("librarian"),
      "/skills/librarian/SKILL.md",
      null,
    );

    expect(payload.kind).toBe("skill_read");
    expect(payload.request.value).toBe("librarian");
    expect(payload.evidence).toEqual([
      {
        label: "read path",
        text: "/skills/librarian/SKILL.md",
        detail: null,
      },
    ]);
  });

  test("names the requesting agent on the payload", () => {
    expect(
      buildSkillPathAskPayload(
        skillEntry("librarian"),
        "/skills/librarian/SKILL.md",
        "my-agent",
      ).request.requester.agentName,
    ).toBe("my-agent");
  });
});
