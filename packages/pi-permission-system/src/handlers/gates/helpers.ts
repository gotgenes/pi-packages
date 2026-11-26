import type { AccessPath } from "#src/access-intent/access-path";
import type { ToolPathSource } from "#src/access-intent/tool-input-path";
import { classifyToolKind } from "#src/access-intent/tool-kind";
import type { ForwardedAccessFacts } from "#src/authority/permission-forwarding";
import type { PromptPermissionDetails } from "#src/authority/permission-prompter";
import type { PermissionDecisionResolution } from "#src/service/permission-events";
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
 *
 * `pathSource` adds `extractorSource` only when the path came from an
 * **inherited** extractor — a decision that depended on another node's
 * registration says so, and every other decision stays exactly as wide as it
 * was. Stamping the ordinary case too would put a constant on effectively
 * every record in the log.
 */
export function buildPathGateLogContext(
  tcc: PathGateRequestFacts,
  path: string,
  pathSource?: ToolPathSource,
): Record<string, unknown> {
  return {
    source: "tool_call",
    toolCallId: tcc.toolCallId,
    toolName: tcc.toolName,
    agentName: tcc.agentName,
    path,
    ...(pathSource === "inherited_extractor"
      ? { extractorSource: "inherited" }
      : {}),
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
    case "mcp-tool":
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
