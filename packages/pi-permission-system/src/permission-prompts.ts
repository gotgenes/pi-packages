import { classifyToolKind, isMcpCheck } from "./access-intent/tool-kind";
import { matchQualifier } from "./denial-messages";
import type { SkillPromptEntry } from "./skill-prompt-sanitizer";
import type { ToolPreviewFormatter } from "./tool-preview-formatter";
import type { PermissionCheckResult } from "./types";
import { getNonEmptyString, toRecord } from "./value-guards";

// NOTE: formatDenyReason, formatUserDeniedReason, and
// formatPermissionHardStopHint have been moved to denial-messages.ts.
// This module retains only pre-check messages and user-facing ask prompts.

export function formatMissingToolNameReason(): string {
  return "Tool call was blocked because no tool name was provided. Use a registered tool name from pi.getAllTools().";
}

export function formatUnknownToolReason(
  toolName: string,
  availableToolNames: readonly string[],
): string {
  const preview = availableToolNames.slice(0, 10);
  const suffix = availableToolNames.length > preview.length ? ", ..." : "";
  const availableList =
    preview.length > 0 ? `${preview.join(", ")}${suffix}` : "none";

  const mcpHint =
    classifyToolKind(toolName) === "mcp"
      ? ""
      : ' If this was intended as an MCP server tool, call the registered \'mcp\' tool when available (for example: {"tool":"server:tool"}).';

  return `Tool '${toolName}' is not registered in this runtime and was blocked before permission checks.${mcpHint} Registered tools: ${availableList}.`;
}

export function formatAskPrompt(
  result: PermissionCheckResult,
  agentName?: string,
  input?: unknown,
  formatter?: ToolPreviewFormatter,
): string {
  // Wrap long values onto the next line if they exceed the terminal width.
  // Falls back to 80 if stdout is not a TTY (e.g. in tests).
  const termWidth = (process.stdout.columns as number | undefined) ?? 80;
  const wrap = (label: string, value: string): string => {
    const inline = `${label}${value}`;
    return inline.length > termWidth ? `${label}\n    ${value}` : inline;
  };

  const agentInfo = agentName ? `agent: ${agentName}\n` : "";

  if (classifyToolKind(result.toolName) === "bash") {
    const subCommand = result.command ?? "";
    const qualifier = matchQualifier(
      result.matchedPattern,
      result.commandContext,
    );
    // Skip the generic fallback pattern — it adds no information
    const qualifierInfo =
      qualifier && result.matchedPattern !== "*"
        ? `\n${wrap("  context : ", qualifier)}`
        : "";
    const fullCommand = getNonEmptyString(toRecord(input).command);
    const fullCommandInfo =
      fullCommand && fullCommand !== subCommand
        ? `\n${wrap("  full    : ", fullCommand)}`
        : "";
    return `${agentInfo}  bash    : ${subCommand}${qualifierInfo}${fullCommandInfo}`;
  }

  if (isMcpCheck(result) && result.target) {
    const patternInfo = result.matchedPattern
      ? `\n${wrap("  matched : ", result.matchedPattern)}`
      : "";
    const mcpPreview = formatter
      ? formatter.formatToolInputForPrompt("mcp", input)
      : "";
    const previewSuffix = mcpPreview
      ? `\n${wrap("  input   : ", mcpPreview)}`
      : "";
    return `${agentInfo}  mcp     : ${result.target}${patternInfo}${previewSuffix}`;
  }

  // Generic tool — show pretty-printed JSON input so nothing is truncated
  const patternInfo = result.matchedPattern
    ? `\n${wrap("  matched : ", result.matchedPattern)}`
    : "";
  const preview = formatter
    ? formatter.formatToolInputForPrompt(result.toolName, input)
    : undefined;
  const rawInput =
    preview ?? (input != null ? JSON.stringify(input, null, 2) : "");
  const inputSuffix = rawInput ? `\n${rawInput}` : "";
  return `${agentInfo}  tool    : ${result.toolName}${patternInfo}${inputSuffix}`;
}

export function formatSkillAskPrompt(
  skillName: string,
  agentName?: string,
): string {
  const subject = agentName ? `Agent '${agentName}'` : "Current agent";
  return `${subject} requested skill '${skillName}'. Allow loading this skill?`;
}

export function formatSkillPathAskPrompt(
  skill: SkillPromptEntry,
  readPath: string,
  agentName?: string,
): string {
  const subject = agentName ? `Agent '${agentName}'` : "Current agent";
  return `${subject} requested access to skill '${skill.name}' via '${readPath}'. Allow this read?`;
}

// formatSkillPathDenyReason has been moved to denial-messages.ts.
