import type { PersistentApprovalTarget } from "#src/persistent-approval-service";
import type {
  InteractivePermissionChoice,
  PermissionRuleProposalData,
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
  /** Edited proposal to record when this is a local session approval. */
  sessionApproval?: PermissionRuleProposalData;
  autoApproved?: true;
  confirmationUnavailable?: true;
};

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

export function normalizePermissionDenialReason(
  value: unknown,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function createDeniedPermissionDecision(
  denialReason?: string,
): PermissionPromptDecision {
  const normalizedReason = normalizePermissionDenialReason(denialReason);
  return normalizedReason
    ? {
        approved: false,
        state: "denied_with_reason",
        denialReason: normalizedReason,
      }
    : { approved: false, state: "denied" };
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

export interface PersistentPromptOptions {
  proposal: PermissionRuleProposalData;
  projectTarget?: PersistentApprovalTarget;
  globalTarget: PersistentApprovalTarget;
}

export interface RequestPermissionOptions {
  sessionLabel?: string;
  sessionScope?: {
    subagentLabel: string;
    servingSessionLabel: string;
  };
  /** Local direct asks only; omitted for forwarded prompts. */
  persistent?: PersistentPromptOptions;
}

export async function requestPermissionDecisionFromUi(
  ui: PermissionDecisionUi,
  title: string,
  message: string,
  options?: RequestPermissionOptions,
  showPersistenceSummary = true,
): Promise<InteractivePermissionChoice> {
  const sessionOption = options?.sessionLabel ?? APPROVE_FOR_SESSION_OPTION;
  let proposal = options?.persistent?.proposal;

  for (;;) {
    const decisionOptions = [APPROVE_OPTION, sessionOption];
    if (proposal) decisionOptions.push(EDIT_PATTERNS_OPTION);
    if (options?.persistent?.projectTarget) {
      decisionOptions.push(APPROVE_FOR_PROJECT_OPTION);
    }
    if (options?.persistent) decisionOptions.push(APPROVE_GLOBALLY_OPTION);
    decisionOptions.push(DENY_OPTION, DENY_WITH_REASON_OPTION);

    const selected = await ui.select(`${title}\n${message}`, decisionOptions);

    if (selected === APPROVE_OPTION) {
      return { approved: true, state: "approved" };
    }
    if (selected === EDIT_PATTERNS_OPTION && proposal) {
      const edited = await editProposal(ui, title, proposal);
      if (edited) proposal = edited;
      continue;
    }
    if (selected === sessionOption) {
      return chooseSessionScope(ui, title, options, proposal);
    }
    if (
      selected === APPROVE_FOR_PROJECT_OPTION &&
      proposal &&
      options?.persistent?.projectTarget
    ) {
      return showPersistenceSummary
        ? confirmPersistence(
            ui,
            title,
            proposal,
            options.persistent.projectTarget,
          )
        : persistentChoice(proposal, options.persistent.projectTarget, false);
    }
    if (
      selected === APPROVE_GLOBALLY_OPTION &&
      proposal &&
      options?.persistent
    ) {
      return showPersistenceSummary
        ? confirmPersistence(
            ui,
            title,
            proposal,
            options.persistent.globalTarget,
          )
        : persistentChoice(proposal, options.persistent.globalTarget, false);
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

async function editProposal(
  ui: PermissionDecisionUi,
  title: string,
  proposal: PermissionRuleProposalData,
): Promise<PermissionRuleProposalData | undefined> {
  const patterns: string[] = [];
  for (const pattern of proposal.patterns) {
    const edited = (
      await ui.input(
        `${title}\nEdit the exact ${proposal.surface} pattern:`,
        pattern,
      )
    )?.trim();
    if (!edited) return undefined;
    patterns.push(edited);
  }
  return { surface: proposal.surface, patterns: [...new Set(patterns)] };
}

async function chooseSessionScope(
  ui: PermissionDecisionUi,
  title: string,
  options: RequestPermissionOptions | undefined,
  proposal: PermissionRuleProposalData | undefined,
): Promise<PermissionPromptDecision> {
  if (!options?.sessionScope) {
    return {
      approved: true,
      state: "approved_for_session",
      ...(proposal ? { sessionApproval: proposal } : {}),
    };
  }
  const scope = await ui.select(`${title}\nApply this session grant to:`, [
    options.sessionScope.subagentLabel,
    options.sessionScope.servingSessionLabel,
  ]);
  return {
    approved: true,
    state:
      scope === options.sessionScope.servingSessionLabel
        ? "approved_for_serving_session"
        : "approved_for_session",
  };
}

async function confirmPersistence(
  ui: PermissionDecisionUi,
  title: string,
  proposal: PermissionRuleProposalData,
  target: PersistentApprovalTarget,
): Promise<InteractivePermissionChoice> {
  const summary = [
    title,
    `Scope: ${target.scope === "project" ? "project-local" : "global"}`,
    `Surface: ${proposal.surface}`,
    "Patterns:",
    ...proposal.patterns.map((pattern) => `  - ${pattern}`),
    "Action: allow",
    `File: ${target.path}`,
  ].join("\n");
  const confirmed = await ui.select(summary, [CONFIRM_OPTION, "Cancel"]);
  return confirmed === CONFIRM_OPTION
    ? persistentChoice(proposal, target, true)
    : createDeniedPermissionDecision();
}

function persistentChoice(
  proposal: PermissionRuleProposalData,
  target: PersistentApprovalTarget,
  summaryShown: boolean,
): InteractivePermissionChoice {
  return {
    kind: "persist",
    scope: target.scope,
    proposal,
    target,
    summaryShown,
  };
}
