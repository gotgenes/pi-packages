import type { AccessPath } from "#src/access-intent/access-path";
import { classifyToolKind } from "#src/access-intent/tool-kind";
import type { ForwardedAccessFacts } from "#src/authority/permission-forwarding";
import type { PermissionDecisionResolution } from "#src/permission-events";
import type { PermissionCheckResult } from "#src/types";
import type { DecisionEventFacts } from "./descriptor";

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
 * Map the gate outcome back to a PermissionDecisionResolution.
 *
 * @param state     - The permission state passed to the gate.
 * @param action    - The gate's resulting action ("allow" | "block").
 * @param hasSession - True when the gate result carries a sessionApproval
 *                    (indicates the user chose "for this session").
 * @param confirmationUnavailable - True when the denial came from the
 *                    DenyingAuthorizer (no live authority was reachable).
 */
export function deriveResolution(
  state: "allow" | "deny" | "ask",
  action: "allow" | "block",
  hasSession: boolean,
  confirmationUnavailable: boolean,
  autoApproved = false,
): PermissionDecisionResolution {
  if (state === "allow") return autoApproved ? "auto_approved" : "policy_allow";
  if (state === "deny") return "policy_deny";
  // state === "ask"
  if (action === "allow") {
    if (autoApproved) return "auto_approved";
    return hasSession ? "user_approved_for_session" : "user_approved";
  }
  return confirmationUnavailable ? "confirmation_unavailable" : "user_denied";
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
