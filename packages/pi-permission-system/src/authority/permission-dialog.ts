import type {
  ApprovalGrant,
  SessionGrantWidth,
} from "#src/session/approval-grant";
import type { DecisionSource } from "./decision-source";

export type PermissionDecisionState =
  | "approved"
  | "approved_for_session"
  | "approved_for_serving_session"
  | "denied"
  | "denied_with_reason";

export type PermissionPromptDecision = {
  approved: boolean;
  state: PermissionDecisionState;
  denialReason?: string;
  /**
   * True when no human ever ruled on this ask: either no live authority was
   * reachable at all (`DenyingAuthorizer`, a no-UI non-subagent session) or the
   * forwarding path gave up before reaching one (`ParentAuthorizer` — target
   * unresolvable, request undeliverable, target not serving, or no answer
   * within the timeout), or a prompt was shown and nobody answered it within
   * its `promptTimeoutMs` window (`AnswerWindow`). Consumed by the gate (block reason) and
   * `PermissionPrompter` (review-entry resolution) to report
   * "confirmation_unavailable" rather than a plain user denial — a user who
   * was never asked denied nothing (#719). The decision-event resolution
   * reads the `unavailable` decider below instead (#772).
   */
  confirmationUnavailable?: true;
  /**
   * How wide a whole-session grant the human chose, when they chose one.
   *
   * Orthogonal to `state` rather than a value of it: the two directions and
   * the subagent/serving scope vary independently, and an unrecognized `state`
   * is rejected outright by the forwarded-response reader, where an
   * unrecognized field is merely dropped. Absent means `"proven"` — the
   * direction the gate named, which is what every producer chose before #813.
   */
  sessionGrantWidth?: SessionGrantWidth;
  /**
   * The grants a session-scoped answer covers when an authorizer link narrowed
   * the ask before it was answered, so the recorder grants what the human was
   * shown rather than the gate's suggestion for the whole ask.
   *
   * Absent means the gate's own suggestion; empty means nothing. The two must
   * never be conflated: absence falls back to the wider grant.
   */
  narrowedGrants?: readonly ApprovalGrant[];
  /**
   * What decided this request, stamped by the site that decided it.
   *
   * Required: every decision names its decider, and the type is what
   * guarantees it rather than a convention each producer has to remember — the
   * same discipline `PromptPermissionDetails.payload` carries (#726).
   */
  decidedBy: DecisionSource;
};

/**
 * A decision before its decider is known.
 *
 * The inner producers — the dialog's decision model, the `select`/`input`
 * fallback, the verdict mapper — state the outcome; which decider to attribute
 * it to is settled one layer up, at the site that chose the producer. The same
 * shape `GateBypass.decision` uses for the request id: a producer emits only
 * what it knows.
 */
export type UnattributedDecision = Omit<PermissionPromptDecision, "decidedBy">;

/** What the fallback hands each host dialog: the signal that may dismiss it. */
export interface PermissionDialogOptions {
  signal?: AbortSignal;
}

export interface PermissionDecisionUi {
  select(
    title: string,
    options: string[],
    opts?: PermissionDialogOptions,
  ): Promise<string | undefined>;
  input(
    title: string,
    placeholder?: string,
    opts?: PermissionDialogOptions,
  ): Promise<string | undefined>;
}

const APPROVE_OPTION = "Yes";
const APPROVE_FOR_SESSION_OPTION = "Yes, for this session";
const DENY_OPTION = "No";
const DENY_WITH_REASON_OPTION = "No, provide reason";

/**
 * A session-granting decision, naming its width only when it is not the
 * default — so a narrow grant serializes exactly as it did before the width
 * option existed.
 */
function sessionApproval(
  state: "approved_for_session" | "approved_for_serving_session",
  width: SessionGrantWidth,
): UnattributedDecision {
  return {
    approved: true,
    state,
    ...(width === "family" ? { sessionGrantWidth: width } : {}),
  };
}

export function normalizePermissionDenialReason(
  value: unknown,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function createDeniedPermissionDecision(
  denialReason?: string,
): UnattributedDecision {
  const normalizedReason = normalizePermissionDenialReason(denialReason);
  return normalizedReason
    ? {
        approved: false,
        state: "denied_with_reason",
        denialReason: normalizedReason,
      }
    : {
        approved: false,
        state: "denied",
      };
}

export function isPermissionDecisionState(
  value: unknown,
): value is PermissionDecisionState {
  return (
    value === "approved" ||
    value === "approved_for_session" ||
    value === "approved_for_serving_session" ||
    value === "denied" ||
    value === "denied_with_reason"
  );
}

export interface RequestPermissionOptions {
  /** Override the "for this session" option label (e.g. to show the suggested pattern). */
  sessionLabel?: string;
  /**
   * Present iff this ask's session grant can be widened to both directions:
   * its label is the extra option shown beside the proven-direction one
   * (#813). Absent leaves the prompt exactly four options.
   */
  sessionWidth?: { label: string };
  /**
   * Forwarded asks only: when set, choosing the "for this session" option opens
   * a second select asking whether the grant applies to the requesting subagent
   * only (the least-privilege default) or the whole serving session.
   */
  sessionScope?: {
    subagentLabel: string;
    servingSessionLabel: string;
  };
}

/**
 * Ask through the host's `select`/`input` dialogs.
 *
 * `signal` reaches every dialog, and the host resolves a dismissed one
 * `undefined` — the same value a human cancel produces. The two are told apart
 * by the signal: an `undefined` while it is aborted answers `undefined` (the
 * prompt was dismissed, so no human ruled), and one while it is live keeps its
 * meaning as the human's cancel.
 */
export async function requestPermissionDecisionFromUi(
  ui: PermissionDecisionUi,
  title: string,
  message: string,
  options?: RequestPermissionOptions,
  signal?: AbortSignal,
): Promise<UnattributedDecision | undefined> {
  const dialogOptions: PermissionDialogOptions = { signal };
  const dismissed = (answer: string | undefined): boolean =>
    answer === undefined && signal?.aborted === true;
  const sessionOption = options?.sessionLabel ?? APPROVE_FOR_SESSION_OPTION;
  const widthOption = options?.sessionWidth?.label;
  const decisionOptions = [
    APPROVE_OPTION,
    sessionOption,
    ...(widthOption ? [widthOption] : []),
    DENY_OPTION,
    DENY_WITH_REASON_OPTION,
  ];

  const selected = await ui.select(
    `${title}\n${message}`,
    decisionOptions,
    dialogOptions,
  );
  if (dismissed(selected)) {
    return undefined;
  }

  if (selected === APPROVE_OPTION) {
    return {
      approved: true,
      state: "approved",
    };
  }

  if (selected === sessionOption || (widthOption && selected === widthOption)) {
    // The two session options differ only in the width they grant; the scope
    // question below is the same for both.
    const width: SessionGrantWidth =
      selected === widthOption ? "family" : "proven";
    if (options?.sessionScope) {
      const scope = await ui.select(
        `${title}\nApply this session grant to:`,
        [
          options.sessionScope.subagentLabel,
          options.sessionScope.servingSessionLabel,
        ],
        dialogOptions,
      );
      if (dismissed(scope)) {
        return undefined;
      }
      return sessionApproval(
        // A cancelled scope select (undefined) falls back to the
        // least-privilege subagent scope.
        scope === options.sessionScope.servingSessionLabel
          ? "approved_for_serving_session"
          : "approved_for_session",
        width,
      );
    }
    return sessionApproval("approved_for_session", width);
  }

  if (selected === DENY_WITH_REASON_OPTION) {
    const typed = await ui.input(
      `${title}\nShare why this request was denied (optional).`,
      "Reason shown back to the agent",
      dialogOptions,
    );
    if (dismissed(typed)) {
      return undefined;
    }
    const denialReason = normalizePermissionDenialReason(typed);

    return createDeniedPermissionDecision(denialReason);
  }

  return createDeniedPermissionDecision();
}
