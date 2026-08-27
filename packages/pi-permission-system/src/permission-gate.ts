import type { DecisionSource } from "#src/authority/decision-source";
import type { PermissionPromptDecision } from "#src/authority/permission-dialog";

/** Result of applying the permission gate. */
export type PermissionGateResult =
  | { action: "allow"; sessionApproval?: { surface: string; pattern: string } }
  | { action: "block"; reason: string };

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
   * Session approval suggestion to record when the user selects
   * "for this session". When present and the decision is `approved_for_session`,
   * the result carries the suggestion back to the caller for recording.
   */
  sessionApproval?: { surface: string; pattern: string };

  /** Write a review-log entry. Called for deny and ask-but-unavailable paths. */
  writeLog: (event: string, extra: Record<string, unknown>) => void;

  /** Log context fields shared across all log calls for this gate. */
  logContext: Record<string, unknown>;

  /**
   * The rule that resolved this gate, for the deny arm's review entry.
   *
   * A sibling of `logContext` rather than a member of it: the context holds
   * what every resolution of this gate shares, and the decider is by
   * definition not shared (#726).
   */
  decidedByRule: DecisionSource;

  /** Message strings/factories for each outcome. */
  messages: {
    denyReason: string;
    unavailableReason: (decision: PermissionPromptDecision) => string;
    userDeniedReason: (decision: PermissionPromptDecision) => string;
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
    return { action: "block", reason: messages.denyReason };
  }

  if (state === "ask") {
    const decision = await promptForApproval();
    if (!decision.approved) {
      // The gate writes no review entry for an ask denial — the prompter
      // brackets it (waiting/denied). The block reason distinguishes an
      // absent-authority denial (confirmationUnavailable) from a user denial.
      return {
        action: "block",
        reason: decision.confirmationUnavailable
          ? messages.unavailableReason(decision)
          : messages.userDeniedReason(decision),
      };
    }
    if (decision.state === "approved_for_session" && params.sessionApproval) {
      return { action: "allow", sessionApproval: params.sessionApproval };
    }
  }

  return { action: "allow" };
}
