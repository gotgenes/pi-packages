import { buildSkillAskPayload } from "#src/presentation/skill-ask-payload";
import type { PermissionCheckResult } from "#src/types";
import type { GateDescriptor } from "./descriptor";
import { accessFactsFromValue } from "./helpers";

/**
 * Build a pure descriptor for the skill-input permission gate.
 *
 * Takes the pre-computed check result so the gate can reuse the result the
 * caller already obtained (e.g. to conditionally emit a deny warning) without
 * re-running the check inside the runner.
 */
export function describeSkillInputGate(
  skillName: string,
  agentName: string | null,
  preCheck: PermissionCheckResult,
): GateDescriptor {
  const payload = buildSkillAskPayload(skillName, agentName);
  return {
    surface: "skill",
    input: { name: skillName },
    preCheck,
    payload,
    promptDetails: {
      source: "skill_input",
      agentName,
      skillName,
      accessIntent: accessFactsFromValue("skill", skillName),
    },
    logContext: {
      source: "skill_input",
      skillName,
      agentName,
    },
    decision: {
      surface: "skill",
      value: skillName,
    },
  };
}
