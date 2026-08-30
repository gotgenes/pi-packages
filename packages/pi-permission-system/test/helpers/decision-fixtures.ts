import type { DecisionSource } from "#src/authority/decision-source";

/**
 * The decider a test stands in for when the decision's *provenance* is not its
 * subject: a human answering the inline dialog, which is what a real
 * `LocalUserAuthorizer` produces.
 *
 * A shared constant rather than a decision builder, so each fixture's literal
 * still shows its own `approved`/`state` — in most of these tests that pair is
 * the subject, and hiding it behind a factory would cost more than the
 * duplication saves.
 */
export const DECIDED_BY_HUMAN: DecisionSource = { kind: "user", via: "dialog" };

/**
 * The decider a test stands in for when *nobody* ruled: the record
 * `DenyingAuthorizer` and every `ParentAuthorizer` abandonment path stamp
 * beside `confirmationUnavailable: true`.
 *
 * A decision carrying that marker and a `user` decider is a contradiction no
 * producer can create, and it stops discriminating the moment a reader
 * dispatches on the decider instead of the marker.
 */
export const DECIDED_BY_ABSENT_AUTHORITY: DecisionSource = {
  kind: "unavailable",
  reason: "No live authority was reachable for this session",
};
