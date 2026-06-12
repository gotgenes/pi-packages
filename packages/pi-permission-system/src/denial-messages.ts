import { EXTENSION_ID } from "./extension-config";
import type { BashCommandContext, PermissionCheckResult } from "./types";

// ── Extension attribution tag ──────────────────────────────────────────────

export const EXTENSION_TAG = `[${EXTENSION_ID}]`;

// ── Denial context discriminated union ─────────────────────────────────────

export type DenialContext =
  | {
      kind: "tool";
      check: PermissionCheckResult;
      agentName?: string;
      input?: unknown;
    }
  | {
      kind: "path";
      toolName: string;
      pathValue: string;
      agentName?: string;
    }
  | {
      kind: "external_directory";
      toolName: string;
      pathValue: string;
      cwd: string;
      agentName?: string;
    }
  | {
      kind: "bash_external_directory";
      command: string;
      externalPaths: string[];
      cwd: string;
      agentName?: string;
    }
  | {
      kind: "bash_path";
      command: string;
      pathValue: string;
      agentName?: string;
    }
  | {
      kind: "skill_read";
      skillName: string;
      readPath: string;
      agentName?: string;
    }
  | {
      kind: "skill_input";
      skillName: string;
      agentName?: string;
    };

// ── Public formatter API ───────────────────────────────────────────────────

/** Format the block reason when permission policy denies an operation. */
export function formatDenyReason(ctx: DenialContext): string {
  return `${EXTENSION_TAG} ${buildDenyBody(ctx)}`;
}

/** Format the block reason when no interactive UI is available to prompt. */
export function formatUnavailableReason(ctx: DenialContext): string {
  return `${EXTENSION_TAG} ${buildUnavailableBody(ctx)}`;
}

/** Format the block reason when the user denies at an interactive prompt. */
export function formatUserDeniedReason(
  ctx: DenialContext,
  denialReason?: string,
): string {
  return `${EXTENSION_TAG} ${buildUserDeniedBody(ctx, denialReason)}`;
}

// ── Private body builders ──────────────────────────────────────────────────

function subject(agentName?: string): string {
  return agentName ? `Agent '${agentName}'` : "Current agent";
}

function reasonSuffix(denialReason?: string): string {
  return denialReason ? ` Reason: ${denialReason}.` : "";
}

function buildDenyBody(ctx: DenialContext): string {
  switch (ctx.kind) {
    case "tool":
      return buildToolDenyBody(ctx);
    case "path":
      return `${subject(ctx.agentName)} is not permitted to access path '${ctx.pathValue}' via tool '${ctx.toolName}'.`;
    case "external_directory":
      return `${subject(ctx.agentName)} is not permitted to run tool '${ctx.toolName}' for path '${ctx.pathValue}' outside working directory '${ctx.cwd}'.`;
    case "bash_external_directory":
      return `${subject(ctx.agentName)} is not permitted to run bash command '${ctx.command}' which references path(s) outside working directory '${ctx.cwd}': ${ctx.externalPaths.join(", ")}.`;
    case "bash_path":
      return `${subject(ctx.agentName)} is not permitted to access path '${ctx.pathValue}' via tool 'bash'.`;
    case "skill_read":
      return `${subject(ctx.agentName)} is not permitted to access skill '${ctx.skillName}' via '${ctx.readPath}'.`;
    case "skill_input":
      return `${subject(ctx.agentName)} is not permitted to access skill '${ctx.skillName}'.`;
  }
}

function buildToolDenyBody(
  ctx: Extract<DenialContext, { kind: "tool" }>,
): string {
  const parts: string[] = [];
  const { check, agentName } = ctx;

  if (agentName) {
    parts.push(`Agent '${agentName}'`);
  }

  if (isMcpCheck(check)) {
    parts.push(`is not permitted to run MCP target '${check.target}'`);
  } else {
    parts.push(`is not permitted to run '${check.toolName}'`);
  }

  if (check.command) {
    parts.push(`command '${check.command}'`);
  }

  const qualifier = matchQualifier(check.matchedPattern, check.commandContext);
  if (qualifier) {
    parts.push(qualifier);
  }

  let message = `${parts.join(" ")}.`;

  // Append custom denial reason after the sentence-ending period.
  if (check.reason) {
    message += ` Reason: ${check.reason}.`;
  }

  return message;
}

/**
 * Human-readable label for a nested bash execution context, or `undefined` for
 * a current-shell (top-level) command.
 */
export function describeBashCommandContext(
  context?: BashCommandContext,
): string | undefined {
  switch (context) {
    case "command_substitution":
      return "command substitution";
    case "process_substitution":
      return "process substitution";
    case "subshell":
      return "subshell";
    default:
      return undefined;
  }
}

/**
 * Build the parenthetical qualifier for a bash decision, folding the matched
 * rule and (for a nested command) its execution context into one clause, e.g.
 * `(matched 'rm *', inside command substitution)`. Returns `""` when neither
 * applies.
 */
export function matchQualifier(
  matchedPattern?: string,
  context?: BashCommandContext,
): string {
  const parts: string[] = [];
  if (matchedPattern) {
    parts.push(`matched '${matchedPattern}'`);
  }
  const label = describeBashCommandContext(context);
  if (label) {
    parts.push(`inside ${label}`);
  }
  return parts.length > 0 ? `(${parts.join(", ")})` : "";
}

function buildUnavailableBody(ctx: DenialContext): string {
  switch (ctx.kind) {
    case "tool": {
      const { check } = ctx;
      if (check.toolName === "bash" && check.command) {
        return `Running bash command '${check.command}' requires approval, but no interactive UI is available.`;
      }
      if (isMcpCheck(check)) {
        return "Using tool 'mcp' requires approval, but no interactive UI is available.";
      }
      return `Using tool '${check.toolName}' requires approval, but no interactive UI is available.`;
    }
    case "path":
      return `Accessing '${ctx.pathValue}' requires approval, but no interactive UI is available.`;
    case "external_directory":
      return `Accessing '${ctx.pathValue}' outside the working directory requires approval, but no interactive UI is available.`;
    case "bash_external_directory":
      return `Bash command '${ctx.command}' references path(s) outside the working directory and requires approval, but no interactive UI is available.`;
    case "bash_path":
      return `Bash command '${ctx.command}' accesses path '${ctx.pathValue}' which requires approval, but no interactive UI is available.`;
    case "skill_read":
      return `Accessing skill '${ctx.skillName}' requires approval, but no interactive UI is available.`;
    case "skill_input":
      return `Accessing skill '${ctx.skillName}' requires approval, but no interactive UI is available.`;
  }
}

function buildUserDeniedBody(
  ctx: DenialContext,
  denialReason?: string,
): string {
  switch (ctx.kind) {
    case "tool": {
      const { check } = ctx;
      if (isMcpCheck(check)) {
        return `User denied MCP target '${check.target}'.${reasonSuffix(denialReason)}`;
      }
      if (check.toolName === "bash" && check.command) {
        return `User denied bash command '${check.command}'.${reasonSuffix(denialReason)}`;
      }
      return `User denied tool '${check.toolName}'.${reasonSuffix(denialReason)}`;
    }
    case "path":
      return `User denied access to path '${ctx.pathValue}'.${reasonSuffix(denialReason)}`;
    case "external_directory":
      return `User denied external directory access for tool '${ctx.toolName}' path '${ctx.pathValue}'.${reasonSuffix(denialReason)}`;
    case "bash_external_directory":
      return `User denied external directory access for bash command '${ctx.command}'.${reasonSuffix(denialReason)}`;
    case "bash_path":
      return `User denied path access for bash command '${ctx.command}' (path '${ctx.pathValue}').${reasonSuffix(denialReason)}`;
    case "skill_read":
      return `User denied access to skill '${ctx.skillName}'.${reasonSuffix(denialReason)}`;
    case "skill_input":
      return `User denied access to skill '${ctx.skillName}'.${reasonSuffix(denialReason)}`;
  }
}

function isMcpCheck(check: PermissionCheckResult): boolean {
  return (check.source === "mcp" || check.toolName === "mcp") && !!check.target;
}
