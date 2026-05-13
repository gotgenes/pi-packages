import {
  getPathBearingToolPath,
  isPathOutsideWorkingDirectory,
  isPiInfrastructureRead,
  normalizePathForComparison,
} from "../../path-utils";
import { suggestSessionPattern } from "../../pattern-suggest";
import { deriveApprovalPattern } from "../../session-rules";
import type { GateResult } from "./descriptor";
import {
  formatExternalDirectoryAskPrompt,
  formatExternalDirectoryDenyReason,
  formatExternalDirectoryUserDeniedReason,
} from "./external-directory-messages";
import type { ToolCallContext } from "./types";

/**
 * Build a pure descriptor for the external-directory permission gate.
 *
 * Returns `null` when the gate does not apply (no CWD, tool is not
 * path-bearing, or path is inside the working directory).
 * Returns a `GateBypass` for Pi infrastructure reads.
 * Returns a `GateDescriptor` for external paths needing a permission check.
 */
export function describeExternalDirectoryGate(
  tcc: ToolCallContext,
  infraDirs: string[],
): GateResult {
  if (!tcc.cwd) return null;

  const externalDirectoryPath = getPathBearingToolPath(tcc.toolName, tcc.input);
  if (!externalDirectoryPath) return null;

  if (!isPathOutsideWorkingDirectory(externalDirectoryPath, tcc.cwd)) {
    return null;
  }

  const normalizedExtPath = normalizePathForComparison(
    externalDirectoryPath,
    tcc.cwd,
  );

  // ── Pi infrastructure read bypass ──────────────────────────────────────
  if (
    isPiInfrastructureRead(tcc.toolName, normalizedExtPath, infraDirs, tcc.cwd)
  ) {
    return {
      action: "allow",
      log: {
        event: "permission_request.infrastructure_auto_allowed",
        details: {
          source: "tool_call",
          toolCallId: tcc.toolCallId,
          toolName: tcc.toolName,
          agentName: tcc.agentName,
          path: externalDirectoryPath,
        },
      },
      decision: {
        surface: tcc.toolName,
        value: externalDirectoryPath,
        result: "allow",
        resolution: "infrastructure_auto_allowed",
        origin: null,
        agentName: tcc.agentName ?? null,
        matchedPattern: null,
      },
    };
  }

  // ── Build descriptor for permission check ───────────────────────────────
  const extDirMessage = formatExternalDirectoryAskPrompt(
    tcc.toolName,
    externalDirectoryPath,
    tcc.cwd,
    tcc.agentName ?? undefined,
  );

  const pattern = deriveApprovalPattern(normalizedExtPath);
  const suggestion = suggestSessionPattern(
    "external_directory",
    normalizedExtPath,
  );

  return {
    surface: "external_directory",
    input: { path: normalizedExtPath },
    messages: {
      denyReason: formatExternalDirectoryDenyReason(
        tcc.toolName,
        externalDirectoryPath,
        tcc.cwd,
        tcc.agentName ?? undefined,
      ),
      unavailableReason: `Accessing '${externalDirectoryPath}' outside the working directory requires approval, but no interactive UI is available.`,
      userDeniedReason: (decision) =>
        formatExternalDirectoryUserDeniedReason(
          tcc.toolName,
          externalDirectoryPath,
          decision.denialReason,
        ),
    },
    sessionApproval: {
      surface: "external_directory",
      pattern,
    },
    promptDetails: {
      source: "tool_call",
      agentName: tcc.agentName,
      message: extDirMessage,
      surface: "external_directory",
      defaultPersistAction: "allow",
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      path: externalDirectoryPath,
      customPatternOptions: suggestion.patternOptions,
    },
    logContext: {
      source: "tool_call",
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      agentName: tcc.agentName,
      path: externalDirectoryPath,
      message: extDirMessage,
    },
    decision: {
      surface: "external_directory",
      value: externalDirectoryPath,
    },
  };
}
