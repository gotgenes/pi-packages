import type { PromptPayload } from "#src/presentation/prompt-payload";
import { localRequester } from "#src/presentation/prompt-payload";
import type { SkillPromptEntry } from "#src/skill-prompt-sanitizer";

/** A request to load a skill. */
export function buildSkillAskPayload(
  skillName: string,
  agentName: string | null,
): PromptPayload {
  return skillPayload("skill", skillName, agentName, []);
}

/**
 * A read that reaches a skill through one of its files.
 *
 * The skill is the decision-relevant value — it is what the policy names — and
 * the path is the evidence for why this read counts as reaching it.
 */
export function buildSkillPathAskPayload(
  skill: SkillPromptEntry,
  readPath: string,
  agentName: string | null,
): PromptPayload {
  return skillPayload("skill_read", skill.name, agentName, [
    { label: "read path", text: readPath, detail: null },
  ]);
}

function skillPayload(
  kind: "skill" | "skill_read",
  skillName: string,
  agentName: string | null,
  evidence: PromptPayload["evidence"],
): PromptPayload {
  return {
    kind,
    request: {
      requester: localRequester(agentName),
      surface: "skill",
      toolName: null,
      invokedToolName: null,
      value: skillName,
      matchedPattern: null,
      commandContext: null,
      executedUnit: null,
    },
    evidence,
    annotations: [],
  };
}
