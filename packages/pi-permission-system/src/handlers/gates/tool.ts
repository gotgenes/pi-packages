import type { AccessPath } from "#src/access-intent/access-path";
import { PATH_BEARING_TOOLS } from "#src/access-intent/path-surfaces";
import { getPathBearingToolPath } from "#src/access-intent/tool-input-path";
import {
  classifyToolKind,
  type ShellInvocation,
} from "#src/access-intent/tool-kind";
import {
  suggestPathSessionPattern,
  suggestSessionPattern,
} from "#src/pattern-suggest";
import { buildToolAskPayload } from "#src/presentation/tool-ask-payload";
import { SessionApproval } from "#src/session-approval";
import type { ToolPreviewFormatter } from "#src/tool-preview-formatter";
import type { PermissionCheckResult } from "#src/types";
import type { GateDescriptor } from "./descriptor";
import {
  accessFactsFromPath,
  accessFactsFromValue,
  deriveDecisionValue,
} from "./helpers";
import type { ToolCallContext } from "./types";

/**
 * A path-bearing tool call's resolved path, paired with the session scope
 * approving it would grant.
 *
 * The pattern is derived by the pipeline's `PathNormalizer`, which owns the
 * session's `PathFlavor`, rather than re-derived here from `path.value()` — so
 * the gate carries the platform's separator semantics without holding them
 * (#655).
 */
export interface ToolPathAccess {
  readonly path: AccessPath;
  readonly approvalPattern: string;
}

/**
 * Derive the value used for session-approval pattern suggestions.
 *
 * Bash → command string; MCP → qualified target; everything else → catch-all
 * wildcard. A path-bearing tool that resolved a path never reaches here — its
 * suggestion comes from the already-derived {@link ToolPathAccess} pattern.
 */
function deriveSuggestionValue(
  toolName: string,
  check: PermissionCheckResult,
): string {
  switch (classifyToolKind(toolName)) {
    case "bash":
      return check.command ?? "";
    case "mcp":
      return check.target ?? "mcp";
    default:
      return "*";
  }
}

/**
 * Build a pure descriptor for the normal tool permission gate.
 *
 * Takes a pre-computed PermissionCheckResult (from checkPermission) and
 * returns a GateDescriptor that the runner can execute. No side effects.
 */
export function describeToolGate(
  tcc: ToolCallContext,
  check: PermissionCheckResult,
  formatter: ToolPreviewFormatter,
  pathAccess?: ToolPathAccess,
  shell?: ShellInvocation | null,
): GateDescriptor {
  // A shell invocation (native `bash` or an aliased shell tool) is gated on the
  // `bash` surface — its session rule, decision value, and suggestion are
  // bash-shaped — while the invoked tool name is preserved in the prompt and
  // review log so a user sees which tool actually ran (#574).
  const gateSurface = shell ? "bash" : tcc.toolName;

  const permissionLogContext = formatter.getPermissionLogContext(
    check,
    tcc.input,
    PATH_BEARING_TOOLS,
  );

  // Compute session approval suggestion for the "for this session" option.
  const suggestion = pathAccess
    ? suggestPathSessionPattern(gateSurface, pathAccess.approvalPattern)
    : suggestSessionPattern(
        gateSurface,
        deriveSuggestionValue(gateSurface, check),
      );

  const payload = buildToolAskPayload({
    check,
    agentName: tcc.agentName,
    surface: gateSurface,
    invokedToolName: tcc.toolName,
    input: tcc.input,
    formatter,
  });

  const decisionValue = deriveDecisionValue(
    gateSurface,
    check,
    getPathBearingToolPath(tcc.toolName, tcc.input) ?? undefined,
  );

  // A path-bearing tool carries the AccessPath's alias set; every other surface
  // (bash command, MCP target, plain tool) carries its already-portable value.
  const accessIntent = pathAccess
    ? accessFactsFromPath(gateSurface, pathAccess.path)
    : accessFactsFromValue(gateSurface, decisionValue);

  return {
    surface: gateSurface,
    input: tcc.input,
    payload,
    sessionApproval: SessionApproval.single(
      suggestion.surface,
      suggestion.pattern,
    ),
    promptDetails: {
      source: "tool_call",
      agentName: tcc.agentName,
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      sessionLabel: suggestion.label,
      accessIntent,
      ...permissionLogContext,
    },
    logContext: {
      source: "tool_call",
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      ...permissionLogContext,
    },
    decision: {
      surface: gateSurface,
      value: decisionValue,
    },
  };
}
