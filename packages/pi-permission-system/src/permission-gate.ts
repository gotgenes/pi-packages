import type { SessionGrantWidth } from "#src/approval-grant";
import type { DecisionSource } from "#src/authority/decision-source";
import type { PermissionPromptDecision } from "#src/authority/permission-dialog";

/**
 * Result of applying the permission gate.
 *
 * Both arms name what decided. The gate is the one place that knows whether
 * recorded authority answered or an escalation did, so it reports the decider
 * rather than leaving the caller to reconstruct it from a captured decision
 * (#772).
 */
export type PermissionGateResult =
  | {
      action: "allow";
      decidedBy: DecisionSource;
      /**
       * Set when the human granted the ask for the whole session, carrying the
       * width to record it at.
       *
       * One field rather than a `forSession` flag beside a width: the width is
       * meaningless without the grant, and two optional fields could represent
       * a width for a grant that never happened.
       */
      sessionGrant?: { width: SessionGrantWidth };
    }
  | { action: "block"; decidedBy: DecisionSource; reason: string };

/** Everything the gate needs — no direct dependency on ExtensionContext. */
export interface PermissionGateParams {
  /** The resolved permission state from checkPermission(). */
  state: "allow" | "deny" | "ask";

  /**
   * Escalate the ask to the session's Authorizer for a decision. Called for
   * every `ask`; the DenyingAuthorizer answers by denying with the
   * `confirmationUnavailable` marker when no live authority is reachable.
   */
  promptForApproval: () => Promise<PermissionPromptDecision>;

  /**
   * Whether this ask has a session-approval suggestion to record when the user
   * selects "for this session".
   *
   * A boolean rather than the suggestion itself: the gate decides only whether
   * a whole-session grant happened, and the caller records the suggestion it
   * already holds. Handing the gate the value would ask it to name a single
   * representative `(surface, pattern)`, which a multi-pattern approval has no
   * way to choose (#810).
   */
  canGrantForSession: boolean;

  /** Write a review-log entry. Called for deny and ask-but-unavailable paths. */
  writeLog: (event: string, extra: Record<string, unknown>) => void;

  /** Log context fields shared across all log calls for this gate. */
  logContext: Record<string, unknown>;

  /**
   * The rule that resolved this gate — the decider for both arms that never
   * escalate, and the deny arm's review entry.
   *
   * A sibling of `logContext` rather than a member of it: the context holds
   * what every resolution of this gate shares, and the decider is by
   * definition not shared (#726).
   */
  decidedByRule: DecisionSource;

  /** Message strings/factories for each outcome. */
  messages: {
    /** What the agent is told when recorded authority denied the request. */
    denyReason: string;
    /**
     * What the agent is told when an escalation refused it.
     *
     * One factory rather than one per outcome: which sentence a refusal earns
     * follows from the decision's own decider, and that dispatch belongs with
     * the renderers rather than here (#772).
     */
    refusedReason: (decision: PermissionPromptDecision) => string;
  };
}

/**
 * Apply the deny/ask/allow permission gate.
 *
 * This is a pure decision function: all IO is injected via callbacks.
 */
export async function applyPermissionGate(
  params: PermissionGateParams,
): Promise<PermissionGateResult> {
  const { state, promptForApproval, writeLog, logContext, messages } = params;

  if (state === "deny") {
    writeLog("permission_request.blocked", {
      ...logContext,
      resolution: "policy_denied",
      decidedBy: params.decidedByRule,
    });
    return {
      action: "block",
      decidedBy: params.decidedByRule,
      reason: messages.denyReason,
    };
  }

  if (state === "ask") {
    const decision = await promptForApproval();
    const decidedBy = decision.decidedBy;
    if (!decision.approved) {
      // The gate writes no review entry for an ask denial — the prompter
      // brackets it (waiting/denied).
      return {
        action: "block",
        decidedBy,
        reason: messages.refusedReason(decision),
      };
    }
    if (
      decision.state === "approved_for_session" &&
      params.canGrantForSession
    ) {
      return { action: "allow", decidedBy, sessionGrant: { width: "proven" } };
    }
    return { action: "allow", decidedBy };
  }

  return { action: "allow", decidedBy: params.decidedByRule };
}
