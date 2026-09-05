import type { PermissionDecisionResolution } from "#src/service/permission-events";
import { type DecisionSource, effectiveDecider } from "./decision-source";

/** What became of the request, as the gate that ran it observed. */
export interface DecisionOutcome {
  /** Whether the request was ultimately allowed. */
  approved: boolean;
  /** Whether the approval was scoped to the rest of the session. */
  forSession: boolean;
}

/**
 * Name how a decision was reached, from the decider stamped on it.
 *
 * The one place a {@link DecisionSource} becomes a
 * {@link PermissionDecisionResolution}, shared by the local gate runner and the
 * serving node so the two records of one request cannot disagree. Every arm
 * reads the stamp the deciding site wrote (#726) rather than re-deriving the
 * decider from the outcome — the derivation that reported an `authorizerChain`
 * link's verdict, and a serving session's own policy, as the operator's answer
 * (#772).
 *
 * `outcome` supplies what the decider does not record: whether the request was
 * allowed, and whether the human scoped their grant to the session. A
 * `{ kind: "user" }` record names the surface answered on, never the scope.
 *
 * The switch is exhaustive with no `default`, so a new `DecisionSource` variant
 * is a compile error here rather than a silent `user_approved`.
 */
export function resolutionFor(
  decidedBy: DecisionSource,
  outcome: DecisionOutcome,
): PermissionDecisionResolution {
  const decider = effectiveDecider(decidedBy);
  switch (decider.kind) {
    case "rule":
      return outcome.approved ? "policy_allow" : "policy_deny";
    case "session_approval":
      return "session_approved";
    case "infrastructure_read":
      return "infrastructure_auto_allowed";
    case "yolo":
      return "auto_approved";
    case "authorizer":
      return outcome.approved ? "authorizer_allowed" : "authorizer_denied";
    case "unavailable":
      return "confirmation_unavailable";
    case "gate_error":
      return "gate_error";
    case "user":
    // A `forwarded` frame reaches here only when the responder named no
    // decider — an older parent — so the hop is the only fact available and
    // today's attribution is the fail-soft answer.
    case "forwarded":
      return userResolution(outcome);
  }
}

function userResolution(
  outcome: DecisionOutcome,
): PermissionDecisionResolution {
  if (!outcome.approved) {
    return "user_denied";
  }
  return outcome.forSession ? "user_approved_for_session" : "user_approved";
}
