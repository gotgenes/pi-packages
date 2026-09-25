import type { PersistentApprovalTarget } from "#src/persistence/persistent-approval-service";
import type {
  ApprovalGrant,
  SessionGrantWidth,
} from "#src/session/approval-grant";
import type { DecisionSource } from "./decision-source";
import type {
  PermissionRuleProposalData,
  UnattributedChoice,
  UnattributedPersistentChoice,
} from "./interactive-permission-choice";

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
   * within the timeout). Consumed by the gate (block reason) and
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
   * The grants the human edited at a local prompt before granting for the
   * session, replacing the ones the gate proposed. Local direct asks only:
   * a forwarded ask offers no editor, and the wire reader drops the field.
   */
  sessionApproval?: PermissionRuleProposalData;
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

export interface PermissionDecisionUi {
  select(title: string, options: string[]): Promise<string | undefined>;
  input(title: string, placeholder?: string): Promise<string | undefined>;
}

const APPROVE_OPTION = "Yes";
const APPROVE_FOR_SESSION_OPTION = "Yes, for this session";
const EDIT_PATTERNS_OPTION = "Edit proposed pattern(s)";
const APPROVE_FOR_PROJECT_OPTION = "Persist for this project";
const APPROVE_GLOBALLY_OPTION = "Persist globally";
const DENY_OPTION = "No";
const DENY_WITH_REASON_OPTION = "No, provide reason";
const CONFIRM_OPTION = "Confirm";
const CANCEL_OPTION = "Cancel";

/**
 * A session-granting decision, naming its width only when it is not the
 * default — so a narrow grant serializes exactly as it did before the width
 * option existed — and carrying edited grants only when the human edited.
 */
export function sessionApprovalDecision(
  state: "approved_for_session" | "approved_for_serving_session",
  width: SessionGrantWidth,
  edited?: PermissionRuleProposalData,
): UnattributedDecision {
  return {
    approved: true,
    state,
    ...(width === "family" ? { sessionGrantWidth: width } : {}),
    ...(edited ? { sessionApproval: edited } : {}),
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

/**
 * The durable choices a local direct ask offers.
 *
 * The project target is absent when the project is untrusted; the global
 * target is always resolvable. Both are resolved before the prompt so the
 * summary can name the exact file, and re-resolved before the write.
 */
export interface PersistentPromptOptions {
  proposal: PermissionRuleProposalData;
  projectTarget?: PersistentApprovalTarget;
  globalTarget: PersistentApprovalTarget;
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
  /** Local direct asks only; omitted for forwarded prompts. */
  persistent?: PersistentPromptOptions;
}

/** The lines the durable summary shows before a write, shared by both presenters. */
export function renderPersistenceSummary(
  proposal: PermissionRuleProposalData,
  target: PersistentApprovalTarget,
): string[] {
  return [
    `Scope: ${target.scope === "project" ? "project-local" : "global"}`,
    "Rules:",
    ...proposal.grants.map(
      (grant) => `  - ${grant.surface}: ${grant.pattern} → allow`,
    ),
    `File: ${target.path}`,
  ];
}

export function persistentChoice(
  proposal: PermissionRuleProposalData,
  target: PersistentApprovalTarget,
  summaryShown: boolean,
): UnattributedPersistentChoice {
  return {
    kind: "persist",
    scope: target.scope,
    proposal,
    target,
    summaryShown,
  };
}

export async function requestPermissionDecisionFromUi(
  ui: PermissionDecisionUi,
  title: string,
  message: string,
  options?: RequestPermissionOptions,
  showPersistenceSummary = true,
): Promise<UnattributedChoice> {
  const sessionOption = options?.sessionLabel ?? APPROVE_FOR_SESSION_OPTION;
  const widthOption = options?.sessionWidth?.label;
  const persistent = options?.persistent;
  let proposal = persistent?.proposal;
  let edited: PermissionRuleProposalData | undefined;

  // The edit option returns here so the human sees the edited proposal offered
  // again before choosing how long it lives.
  for (;;) {
    const decisionOptions = [
      APPROVE_OPTION,
      sessionOption,
      ...(widthOption ? [widthOption] : []),
      ...(proposal ? [EDIT_PATTERNS_OPTION] : []),
      ...(persistent?.projectTarget ? [APPROVE_FOR_PROJECT_OPTION] : []),
      ...(persistent ? [APPROVE_GLOBALLY_OPTION] : []),
      DENY_OPTION,
      DENY_WITH_REASON_OPTION,
    ];

    const selected = await ui.select(`${title}\n${message}`, decisionOptions);

    if (selected === APPROVE_OPTION) {
      return {
        approved: true,
        state: "approved",
      };
    }

    if (selected === EDIT_PATTERNS_OPTION && proposal) {
      const next = await editProposal(ui, title, proposal);
      if (next) {
        proposal = next;
        edited = next;
      }
      continue;
    }

    if (
      selected === sessionOption ||
      (widthOption && selected === widthOption)
    ) {
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
        );
        return sessionApprovalDecision(
          // A cancelled scope select (undefined) falls back to the
          // least-privilege subagent scope.
          scope === options.sessionScope.servingSessionLabel
            ? "approved_for_serving_session"
            : "approved_for_session",
          width,
          edited,
        );
      }
      return sessionApprovalDecision("approved_for_session", width, edited);
    }

    if (
      selected === APPROVE_FOR_PROJECT_OPTION &&
      proposal &&
      persistent?.projectTarget
    ) {
      return persistOrConfirm(
        ui,
        title,
        proposal,
        persistent.projectTarget,
        showPersistenceSummary,
      );
    }
    if (selected === APPROVE_GLOBALLY_OPTION && proposal && persistent) {
      return persistOrConfirm(
        ui,
        title,
        proposal,
        persistent.globalTarget,
        showPersistenceSummary,
      );
    }

    if (selected === DENY_WITH_REASON_OPTION) {
      const denialReason = normalizePermissionDenialReason(
        await ui.input(
          `${title}\nShare why this request was denied (optional).`,
          "Reason shown back to the agent",
        ),
      );

      return createDeniedPermissionDecision(denialReason);
    }

    return createDeniedPermissionDecision();
  }
}

/**
 * One `input()` per grant, prefilled with the current pattern; a cleared
 * pattern abandons the whole edit rather than dropping the grant, so the
 * proposal the human is then offered is always the one they last saw.
 */
async function editProposal(
  ui: PermissionDecisionUi,
  title: string,
  proposal: PermissionRuleProposalData,
): Promise<PermissionRuleProposalData | undefined> {
  const grants: ApprovalGrant[] = [];
  for (const grant of proposal.grants) {
    const pattern = (
      await ui.input(
        `${title}\nEdit the exact ${grant.surface} pattern:`,
        grant.pattern,
      )
    )?.trim();
    if (!pattern) return undefined;
    grants.push({ surface: grant.surface, pattern });
  }
  return { grants: dedupeGrants(grants) };
}

export function dedupeGrants(
  grants: readonly ApprovalGrant[],
): ApprovalGrant[] {
  const seen = new Set<string>();
  return grants.filter((grant) => {
    const key = `${grant.surface}\u0000${grant.pattern}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function persistOrConfirm(
  ui: PermissionDecisionUi,
  title: string,
  proposal: PermissionRuleProposalData,
  target: PersistentApprovalTarget,
  showPersistenceSummary: boolean,
): Promise<UnattributedChoice> {
  if (!showPersistenceSummary) {
    return persistentChoice(proposal, target, false);
  }
  const summary = [title, ...renderPersistenceSummary(proposal, target)].join(
    "\n",
  );
  const confirmed = await ui.select(summary, [CONFIRM_OPTION, CANCEL_OPTION]);
  return confirmed === CONFIRM_OPTION
    ? persistentChoice(proposal, target, true)
    : createDeniedPermissionDecision();
}
