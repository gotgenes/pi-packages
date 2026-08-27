import type { PathNormalizer } from "#src/path-normalizer";
import { buildSkillPathAskPayload } from "#src/presentation/skill-ask-payload";
import type { SkillPromptEntry } from "#src/skill-prompt-sanitizer";
import { findSkillPathMatch } from "#src/skill-prompt-sanitizer";
import { toRecord } from "#src/value-guards";
import type { GateDescriptor } from "./descriptor";
import { accessFactsFromValue } from "./helpers";
import type { ToolCallContext } from "./types";

/**
 * Build a pure descriptor for the skill-read permission gate.
 *
 * Returns `null` when the gate does not apply (tool is not `read`, no active
 * skill entries, or the read path does not match any skill).
 * Returns a GateDescriptor with preResolved state from the matched skill entry.
 */
export function describeSkillReadGate(
  tcc: ToolCallContext,
  normalizer: PathNormalizer,
  getActiveSkillEntries: () => SkillPromptEntry[],
): GateDescriptor | null {
  const activeSkillEntries = getActiveSkillEntries();

  if (tcc.toolName !== "read" || activeSkillEntries.length === 0) {
    return null;
  }

  const inputRecord = toRecord(tcc.input);
  const path = typeof inputRecord.path === "string" ? inputRecord.path : "";
  if (!path) {
    return null;
  }

  const normalizedReadPath = normalizer.comparableValue(path);
  const matchedSkill = findSkillPathMatch(
    normalizedReadPath,
    activeSkillEntries,
    normalizer,
  );

  if (!matchedSkill) {
    return null;
  }

  const payload = buildSkillPathAskPayload(matchedSkill, path, tcc.agentName);

  return {
    surface: "skill",
    input: { name: matchedSkill.name },
    payload,
    promptDetails: {
      source: "skill_read",
      agentName: tcc.agentName,
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      skillName: matchedSkill.name,
      path,
      accessIntent: accessFactsFromValue("skill", matchedSkill.name),
    },
    logContext: {
      source: "skill_read",
      toolCallId: tcc.toolCallId,
      skillName: matchedSkill.name,
      agentName: tcc.agentName,
      path,
    },
    decision: {
      surface: "skill",
      value: matchedSkill.name,
    },
    preResolved: {
      state: matchedSkill.state,
    },
  };
}
