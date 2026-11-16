import type { AccessPath } from "#src/access-intent/access-path";
import { PATH_BEARING_TOOLS } from "#src/access-intent/path-surfaces";
import { getPathBearingToolPath } from "#src/access-intent/tool-input-path";
import {
  classifyToolKind,
  type ShellInvocation,
} from "#src/access-intent/tool-kind";
import {
  type SessionApprovalSuggestion,
  suggestExactSessionPattern,
  suggestPathSessionPattern,
  suggestSessionPattern,
} from "#src/presentation/pattern-suggest";
import { buildToolAskPayload } from "#src/presentation/tool-ask-payload";
import { SessionApproval } from "#src/session/session-approval";
import type { ToolPreviewFormatter } from "#src/tool-input/tool-preview-formatter";
import type { AskingBashUnit, PermissionCheckResult } from "#src/types";
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
  readonly approvalPatterns: readonly string[];
}

/**
 * Derive the value used for session-approval pattern suggestions.
 *
 * Bash → command string; MCP → qualified target; everything else → catch-all
 * wildcard. A path-bearing tool that resolved a path never reaches here — its
 * suggestion comes from the already-derived {@link ToolPathAccess} patterns.
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
 * The surface a tool call is gated on.
 *
 * A shell invocation (native `bash` or an aliased shell tool) is gated on the
 * `bash` surface, and a Pi MCP tool on the `mcp` surface — their session rule,
 * decision value, and suggestion are shaped by that surface — while the
 * invoked tool name is preserved in the prompt and review log so a user sees
 * which tool actually ran (#574).
 */
function gateSurfaceOf(
  toolName: string,
  shell: ShellInvocation | null | undefined,
): string {
  if (shell) return "bash";
  if (classifyToolKind(toolName) === "mcp-tool") return "mcp";
  return toolName;
}

/** A session option: the approval to record and the label offering it. */
interface SessionOption {
  readonly approval: SessionApproval;
  readonly label: string;
}

/** The session option for a path-bearing tool, from its derived patterns. */
function pathSessionOption(
  gateSurface: string,
  approvalPatterns: readonly string[],
): SessionOption {
  const suggestion = suggestPathSessionPattern(gateSurface, approvalPatterns);
  return {
    approval: SessionApproval.forPatterns(
      suggestion.surface,
      suggestion.patterns,
    ),
    label: suggestion.label,
  };
}

/** The session option for a gate whose value is not a path. */
function valueSessionOption(
  toolName: string,
  gateSurface: string,
  check: PermissionCheckResult,
): SessionOption {
  const suggestion = suggestValueSessionPattern(toolName, gateSurface, check);
  return {
    approval: SessionApproval.single(suggestion.surface, suggestion.pattern),
    label: suggestion.label,
  };
}

/**
 * The session approval for a gate whose value is not a path.
 *
 * A Pi MCP tool is approved by its own full name, which is one of its `mcp`
 * candidates: exactly the tool asked about, never the wider server prefix the
 * proxy target heuristic would suggest.
 */
function suggestValueSessionPattern(
  toolName: string,
  gateSurface: string,
  check: PermissionCheckResult,
): SessionApprovalSuggestion {
  if (classifyToolKind(toolName) === "mcp-tool") {
    return suggestExactSessionPattern(gateSurface, toolName.trim());
  }
  return suggestSessionPattern(
    gateSurface,
    deriveSuggestionValue(gateSurface, check),
  );
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
  const gateSurface = gateSurfaceOf(tcc.toolName, shell);

  const permissionLogContext = formatter.getPermissionLogContext(
    check,
    tcc.input,
    PATH_BEARING_TOOLS,
  );

  // The session approval and label for the "for this session" option.
  const sessionOption = pathAccess
    ? pathSessionOption(gateSurface, pathAccess.approvalPatterns)
    : valueSessionOption(tcc.toolName, gateSurface, check);

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
  // (bash command, MCP target, plain tool) carries its already-portable value,
  // and a bash ask the floor that raised it.
  const accessIntent = pathAccess
    ? accessFactsFromPath(gateSurface, pathAccess.path)
    : {
        ...accessFactsFromValue(gateSurface, decisionValue),
        ...floorFact(check),
        ...askingUnitsFact(check),
      };

  return {
    surface: gateSurface,
    input: tcc.input,
    payload,
    sessionApproval: sessionOption.approval,
    promptDetails: {
      source: "tool_call",
      agentName: tcc.agentName,
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      sessionLabel: sessionOption.label,
      accessIntent,
      ...permissionLogContext,
    },
    logContext: {
      source: "tool_call",
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      ...permissionLogContext,
      ...floorExemptionFact(check),
    },
    decision: {
      surface: gateSurface,
      value: decisionValue,
    },
  };
}

/**
 * Why a bash wrapper's floor did not apply, when one did not (#803).
 *
 * The blame line ADR 0013 §11 asks the review log to record: `matchedPattern`
 * names the rule that decided and `executedUnit` the command it decided about,
 * and this names why that rule was consulted instead of the floor. Absent for
 * every other decision, so a line states what was true rather than enumerating
 * what was not.
 *
 * It rides the gate's `logContext` rather than the prompt payload because an
 * exempt unit's usual outcome is that no prompt happens at all. A bash path
 * ask's blame is the opposite case — it explains a prompt — so it is a payload
 * fact instead.
 */
function floorExemptionFact(
  check: PermissionCheckResult,
): Record<string, unknown> {
  return check.floorExemption === undefined
    ? {}
    : { floorExemption: check.floorExemption };
}

/**
 * The floor that raised a bash ask, as a child-fixed fact for the wire.
 *
 * Only the child's parse knows a unit was a wrapper or failed to parse, so the
 * serving node of a forwarded ask cannot recompute it (ADR 0008). Absent when
 * no floor was raised, so every other ask's facts keep their exact shape.
 */
function floorFact(check: PermissionCheckResult): { floor?: string } {
  return check.floor === undefined ? {} : { floor: check.floor };
}

/**
 * Every unit of a bash chain the child left asking, as a child-fixed fact for
 * the wire, so the serving node judges each command rather than the winner
 * alone (#1030). Absent when the check lists none.
 */
function askingUnitsFact(check: PermissionCheckResult): {
  askingUnits?: AskingBashUnit[];
} {
  return check.askingUnits === undefined
    ? {}
    : { askingUnits: [...check.askingUnits] };
}
