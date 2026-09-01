import type { AccessPath } from "#src/access-intent/access-path";
import { classifyToolKind } from "#src/access-intent/tool-kind";
import type { ForwardedAccessFacts } from "#src/authority/permission-forwarding";
import type { PromptPermissionDetails } from "#src/authority/permission-prompter";
import type { PermissionDecisionResolution } from "#src/permission-events";
import type { PermissionCheckResult } from "#src/types";
import type { DecisionEventFacts } from "./descriptor";
import type { ToolCallContext } from "./types";

/**
 * The identity fields every path-shaped tool gate reports about its call.
 *
 * Narrower than {@link ToolCallContext} (ISP): the fact builders below read
 * who asked and which call it was, never the raw input or the cwd.
 */
type PathGateRequestFacts = Pick<
  ToolCallContext,
  "toolCallId" | "toolName" | "agentName"
>;

/**
 * Build the review-log context for a path-shaped tool gate.
 *
 * The `path` and `external_directory` gates report the same five facts about a
 * call, so they share one builder — a field added here reaches both, and the
 * two cannot drift.
 * The request facts and the request id are stamped by the runner, not here.
 */
export function buildPathGateLogContext(
  tcc: PathGateRequestFacts,
  path: string,
): Record<string, unknown> {
  return {
    source: "tool_call",
    toolCallId: tcc.toolCallId,
    toolName: tcc.toolName,
    agentName: tcc.agentName,
    path,
  };
}

/**
 * Build the prompt details for a path-shaped tool gate.
 *
 * The same five facts as {@link buildPathGateLogContext}, plus the child-fixed
 * access facts the ask carries onto the wire.
 */
export function buildPathGatePromptDetails(
  tcc: PathGateRequestFacts,
  path: string,
  accessIntent: ForwardedAccessFacts,
): Omit<PromptPermissionDetails, "requestId" | "payload"> {
  return {
    source: "tool_call",
    agentName: tcc.agentName,
    toolCallId: tcc.toolCallId,
    toolName: tcc.toolName,
    path,
    accessIntent,
  };
}

/**
 * Build the child-fixed access facts for a path-shaped gate from its
 * `AccessPath`.
 *
 * Converts the `AccessPath` to strings at the point of emission (ADR-0002: an
 * `AccessPath` never crosses onto the wire), carrying the lexical ∪ canonical
 * match set. An empty `boundaryValue()` (a literal-only path) becomes `null`,
 * so the wire distinguishes "no canonical form" cleanly.
 */
export function accessFactsFromPath(
  surface: string,
  path: AccessPath,
): ForwardedAccessFacts {
  return {
    surface,
    matchValues: path.matchValues(),
    boundaryValue: path.boundaryValue() || null,
  };
}

/**
 * Build the child-fixed access facts for a non-path gate (bash command, MCP
 * target, skill name, plain tool) from its already-portable single value.
 */
export function accessFactsFromValue(
  surface: string,
  value: string,
): ForwardedAccessFacts {
  return { surface, matchValues: [value], boundaryValue: null };
}

/**
 * Derive the human-readable value for a decision event from a check result.
 * Bash → extracted command; MCP → qualified target;
 * path-bearing tools → file path; others → tool name.
 */
export function deriveDecisionValue(
  toolName: string,
  check: Pick<PermissionCheckResult, "command" | "target">,
  path?: string,
): string {
  switch (classifyToolKind(toolName)) {
    case "bash":
      return check.command ?? toolName;
    case "mcp":
      return check.target ?? toolName;
    case "path":
    case "skill":
    case "extension":
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- || intentional: an empty path falls through to toolName (the original `if (path)` truthiness)
      return path || toolName;
  }
}

/**
 * Build a decision event's facts from the gate's inputs.
 *
 * Centralises the `origin / agentName / matchedPattern ?? null` normalization
 * that is otherwise duplicated across the session-hit path and the gate-result
 * path in `runGateCheck`. The request id is stamped by the runner, which is
 * where it was minted.
 */
export function buildDecisionEvent(
  decision: { surface: string; value: string },
  check: Pick<PermissionCheckResult, "origin" | "matchedPattern">,
  agentName: string | null,
  result: "allow" | "deny",
  resolution: PermissionDecisionResolution,
): DecisionEventFacts {
  return {
    surface: decision.surface,
    value: decision.value,
    result,
    resolution,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- ?? null normalises undefined to null for the log record
    origin: check.origin ?? null,
    agentName: agentName ?? null,
    matchedPattern: check.matchedPattern ?? null,
  };
}

/**
 * The standing yolo grant covering a gate's resolved check, or `null` when
 * yolo does not answer it.
 *
 * yolo is primarily recorded authority: `rewriteAsksToYolo` turns every `ask`
 * rule into an `allow` tagged `origin: "yolo"` at composition (#526), and the
 * first arm recognizes that grant. The second arm covers an `ask` synthesized
 * *after* resolution — the bash wrapper floor (#481, #490) and the fail-closed
 * `<unparseable-bash-command>` sentinel (#452) — which the ruleset rewrite
 * cannot reach because the floor is a property of a parsed command unit, not of
 * a pattern (#712). The synthetic `matchedPattern` is preserved so the review
 * log still shows why the ask was raised, while `origin: "yolo"` records why it
 * was granted.
 *
 * A `deny` matches neither arm, so an explicit deny survives yolo.
 */
export function resolveYoloGrant(
  check: PermissionCheckResult,
  yoloEnabled: boolean,
): PermissionCheckResult | null {
  if (check.state === "allow" && check.origin === "yolo") {
    return check;
  }
  if (check.state === "ask" && yoloEnabled) {
    return { ...check, state: "allow", origin: "yolo" };
  }
  return null;
}
