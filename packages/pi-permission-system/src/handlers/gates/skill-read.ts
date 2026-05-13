import { toRecord } from "../../common";
import { normalizePathForComparison } from "../../path-utils";
import { suggestSessionPattern } from "../../pattern-suggest";
import {
  formatSkillPathAskPrompt,
  formatSkillPathDenyReason,
} from "../../permission-prompts";
import type { SkillPromptEntry } from "../../skill-prompt-sanitizer";
import { findSkillPathMatch } from "../../skill-prompt-sanitizer";
import type { GateDescriptor } from "./descriptor";
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

  if (tcc.cwd === undefined) {
    return null;
  }

  const normalizedReadPath = normalizePathForComparison(path, tcc.cwd);
  const matchedSkill = findSkillPathMatch(
    normalizedReadPath,
    activeSkillEntries,
  );

  if (!matchedSkill) {
    return null;
  }

  const skillReadMessage = formatSkillPathAskPrompt(
    matchedSkill,
    path,
    tcc.agentName ?? undefined,
  );
  const suggestion = suggestSessionPattern("skill", matchedSkill.name);

  return {
    surface: "skill",
    input: { name: matchedSkill.name },
    messages: {
      denyReason: formatSkillPathDenyReason(
        matchedSkill,
        path,
        tcc.agentName ?? undefined,
      ),
      unavailableReason: `Accessing skill '${matchedSkill.name}' requires approval, but no interactive UI is available.`,
      userDeniedReason: (decision) => {
        const denialReason = decision.denialReason
          ? ` Reason: ${decision.denialReason}.`
          : "";
        return `User denied access to skill '${matchedSkill.name}'.${denialReason}`;
      },
    },
    promptDetails: {
      source: "skill_read",
      agentName: tcc.agentName,
      message: skillReadMessage,
      surface: "skill",
      defaultPersistAction: "allow",
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      skillName: matchedSkill.name,
      path,
      customPatternOptions: suggestion.patternOptions,
    },
    logContext: {
      source: "skill_read",
      skillName: matchedSkill.name,
      agentName: tcc.agentName,
      path,
      message: skillReadMessage,
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
