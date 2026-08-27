import { describe, expect, it } from "vitest";

import { describeSkillInputGate } from "#src/handlers/gates/skill-input";
import { makeCheckResult } from "#test/helpers/handler-fixtures";

// ── helpers ────────────────────────────────────────────────────────────────

function makeSkillCheck(state: "allow" | "deny" | "ask") {
  return makeCheckResult({
    state,
    toolName: "skill",
    source: "skill",
    origin: "global",
    matchedPattern: "*",
  });
}

// ── describeSkillInputGate ─────────────────────────────────────────────────

describe("describeSkillInputGate", () => {
  it("sets surface to 'skill'", () => {
    const descriptor = describeSkillInputGate(
      "librarian",
      null,
      makeSkillCheck("allow"),
    );
    expect(descriptor.surface).toBe("skill");
  });

  it("sets input.name to the skill name", () => {
    const descriptor = describeSkillInputGate(
      "librarian",
      null,
      makeSkillCheck("allow"),
    );
    expect(descriptor.input).toEqual({ name: "librarian" });
  });

  it("passes preCheck through verbatim", () => {
    const check = makeSkillCheck("deny");
    const descriptor = describeSkillInputGate("librarian", null, check);
    expect(descriptor.preCheck).toBe(check);
  });

  it("makes the skill the payload's decision-relevant value", () => {
    const descriptor = describeSkillInputGate(
      "librarian",
      null,
      makeSkillCheck("allow"),
    );
    expect(descriptor.payload.kind).toBe("skill");
    expect(descriptor.payload.request.surface).toBe("skill");
    expect(descriptor.payload.request.value).toBe("librarian");
    expect(descriptor.payload.request.requester.agentName).toBeNull();
  });

  it("names the requesting agent on the payload when provided", () => {
    const descriptor = describeSkillInputGate(
      "librarian",
      "code-agent",
      makeSkillCheck("allow"),
    );
    expect(descriptor.payload.request.requester.agentName).toBe("code-agent");
  });

  it("sets promptDetails source to 'skill_input' with skill name and agent", () => {
    const descriptor = describeSkillInputGate(
      "librarian",
      "code-agent",
      makeSkillCheck("ask"),
    );
    expect(descriptor.promptDetails).toMatchObject({
      source: "skill_input",
      agentName: "code-agent",
      skillName: "librarian",
    });
  });

  it("emits a skill payload naming the skill as the decision value", () => {
    const descriptor = describeSkillInputGate(
      "librarian",
      "code-agent",
      makeSkillCheck("ask"),
    );

    expect(descriptor.payload.kind).toBe("skill");
    expect(descriptor.payload.request.value).toBe("librarian");
  });

  it("names the skill in promptDetails so the prompt can identify it", () => {
    const descriptor = describeSkillInputGate(
      "librarian",
      null,
      makeSkillCheck("ask"),
    );
    expect(descriptor.promptDetails.skillName).toBe("librarian");
  });

  it("sets logContext source to 'skill_input' with skill name and agent", () => {
    const descriptor = describeSkillInputGate(
      "librarian",
      "code-agent",
      makeSkillCheck("allow"),
    );
    expect(descriptor.logContext).toMatchObject({
      source: "skill_input",
      skillName: "librarian",
      agentName: "code-agent",
    });
  });

  it("sets decision surface to 'skill' and value to the skill name", () => {
    const descriptor = describeSkillInputGate(
      "my-skill",
      null,
      makeSkillCheck("allow"),
    );
    expect(descriptor.decision).toEqual({
      surface: "skill",
      value: "my-skill",
    });
  });

  it("carries the skill name as single-value access facts on promptDetails", () => {
    const descriptor = describeSkillInputGate(
      "my-skill",
      null,
      makeSkillCheck("ask"),
    );
    expect(descriptor.promptDetails.accessIntent).toEqual({
      surface: "skill",
      matchValues: ["my-skill"],
      boundaryValue: null,
    });
  });

  it("does not set preResolved or sessionApproval", () => {
    const descriptor = describeSkillInputGate(
      "librarian",
      null,
      makeSkillCheck("allow"),
    );
    expect(descriptor.preResolved).toBeUndefined();
    expect(descriptor.sessionApproval).toBeUndefined();
  });
});
