import { getNonEmptyString, toRecord } from "../../common";
import { suggestSessionPattern } from "../../pattern-suggest";
import type { Rule } from "../../rule";
import { deriveApprovalPattern } from "../../session-rules";
import type { PermissionCheckResult } from "../../types";
import { extractExternalPathsFromBashCommand } from "./bash-path-extractor";
import type { GateResult } from "./descriptor";
import {
  formatBashExternalDirectoryAskPrompt,
  formatBashExternalDirectoryDenyReason,
  formatExternalDirectoryHardStopHint,
} from "./external-directory-messages";
import type { ToolCallContext } from "./types";

/** Function type for checkPermission used by the descriptor factory. */
type CheckPermissionFn = (
  surface: string,
  input: unknown,
  agentName?: string,
  sessionRules?: Rule[],
) => PermissionCheckResult;

/**
 * Build a pure descriptor for the bash external-directory permission gate.
 *
 * Extracts paths from a bash command and checks whether any reference
 * directories outside the working directory. Returns `null` when the gate
 * does not apply (tool is not bash, no CWD, or no external paths found).
 * Returns a `GateBypass` when all paths are session-covered.
 * Returns a `GateDescriptor` with multi-pattern sessionApproval for uncovered paths.
 */
export async function describeBashExternalDirectoryGate(
  tcc: ToolCallContext,
  checkPermission: CheckPermissionFn,
  getSessionRuleset: () => Rule[],
): Promise<GateResult> {
  if (tcc.toolName !== "bash" || !tcc.cwd) return null;

  const command = getNonEmptyString(toRecord(tcc.input).command);
  if (!command) return null;

  const externalPaths = await extractExternalPathsFromBashCommand(
    command,
    tcc.cwd,
  );
  if (externalPaths.length === 0) return null;

  const bashSessionRules = getSessionRuleset();
  const uncoveredPaths = externalPaths.filter(
    (p) =>
      checkPermission(
        "external_directory",
        { path: p },
        tcc.agentName ?? undefined,
        bashSessionRules,
      ).source !== "session",
  );

  if (uncoveredPaths.length === 0) {
    return {
      action: "allow",
      log: {
        event: "permission_request.session_approved",
        details: {
          source: "tool_call",
          toolCallId: tcc.toolCallId,
          toolName: tcc.toolName,
          agentName: tcc.agentName,
          command,
          externalPaths,
          resolution: "session_approved",
        },
      },
    };
  }

  // Get the config-level policy (no path → no session check).
  const extCheck = checkPermission(
    "external_directory",
    {},
    tcc.agentName ?? undefined,
  );

  const bashExtMessage = formatBashExternalDirectoryAskPrompt(
    command,
    uncoveredPaths,
    tcc.cwd,
    tcc.agentName ?? undefined,
  );

  const patterns = uncoveredPaths.map((p) => deriveApprovalPattern(p));
  const customPatternOptions = patterns.flatMap(
    (pattern, index) =>
      suggestSessionPattern(
        "external_directory",
        uncoveredPaths[index] ?? pattern,
      ).patternOptions,
  );

  return {
    surface: "external_directory",
    input: {},
    messages: {
      denyReason: formatBashExternalDirectoryDenyReason(
        command,
        uncoveredPaths,
        tcc.cwd,
        tcc.agentName ?? undefined,
      ),
      unavailableReason: `Bash command '${command}' references path(s) outside the working directory and requires approval, but no interactive UI is available.`,
      userDeniedReason: (decision) => {
        const reasonSuffix = decision.denialReason
          ? ` Reason: ${decision.denialReason}.`
          : "";
        return `User denied external directory access for bash command '${command}'.${reasonSuffix} ${formatExternalDirectoryHardStopHint()}`;
      },
    },
    sessionApproval: {
      surface: "external_directory",
      patterns,
    },
    promptDetails: {
      source: "tool_call",
      agentName: tcc.agentName,
      message: bashExtMessage,
      surface: "external_directory",
      defaultPersistAction: "allow",
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      command,
      customPatternOptions,
    },
    logContext: {
      source: "tool_call",
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      agentName: tcc.agentName,
      command,
      externalPaths: uncoveredPaths,
      message: bashExtMessage,
    },
    decision: {
      surface: "external_directory",
      value: command,
    },
    preCheck: extCheck,
  };
}
