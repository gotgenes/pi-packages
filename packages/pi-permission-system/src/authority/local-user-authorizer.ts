import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isPersistentPermissionChoice } from "#src/authority/interactive-permission-choice";
import {
  createDeniedPermissionDecision,
  type PermissionPromptDecision,
  type RequestPermissionOptions,
} from "#src/authority/permission-dialog";
import type {
  PermissionPromptUi,
  PromptPreferences,
  requestPermissionDecision,
} from "#src/authority/permission-prompt-component";
import { buildForwardedScopeLabels } from "#src/pattern-suggest";
import {
  emitUiPromptEvent,
  type PermissionEventBus,
} from "#src/permission-events";
import { buildUiPrompt } from "#src/permission-ui-prompt";
import type {
  PersistentApprovalApi,
  PersistentApprovalTarget,
} from "#src/persistent-approval-service";
import type { TerminalAuthorizer } from "./authorizer";
import type { PromptPermissionDetails } from "./permission-prompter";

/** Dependencies required by {@link LocalUserAuthorizer}. */
export interface LocalUserAuthorizerDeps {
  /** The active session's UI surface (select/input plus the inline `custom` dialog). */
  ui: PermissionPromptUi;
  /** The session run mode; the dispatcher renders the inline dialog only in `"tui"`. */
  mode: ExtensionContext["mode"];
  /** Event bus used for the `permissions:ui_prompt` broadcast. */
  events: PermissionEventBus;
  /** Read live at prompt time so a settings-modal toggle takes effect on the next prompt. */
  getPromptPreferences: () => PromptPreferences;
  /** Persist the sticky summary preference changed from the inline prompt. */
  setShowPersistenceSummary?: (enabled: boolean) => boolean;
  /** Injected for testability; production callers pass the real function. */
  requestPermissionDecision: typeof requestPermissionDecision;
  /** Present only for direct local sessions that may mutate durable policy. */
  persistentApprovalService?: PersistentApprovalApi;
}

/**
 * Authorizer for a session with an active UI: prompt the human here.
 *
 * Emits the `permissions:ui_prompt` broadcast (moved here from
 * `PermissionPrompter`'s `ctx.hasUI` arm) before showing the dialog, so
 * observers know a decision is imminent. This is the single emit site: a
 * forwarded ask carries its provenance on `details.forwarding`, which this
 * class renders (populated `forwarding` context + "(Subagent)" title) so the
 * broadcast stays non-degraded (#292) without a second emission path.
 */
export class LocalUserAuthorizer implements TerminalAuthorizer {
  constructor(private readonly deps: LocalUserAuthorizerDeps) {}

  async authorize(
    details: PromptPermissionDetails,
  ): Promise<PermissionPromptDecision> {
    const uiPrompt = buildUiPrompt(details);
    emitUiPromptEvent(this.deps.events, uiPrompt);
    const preferences = this.deps.getPromptPreferences();
    const choice = await this.deps.requestPermissionDecision(
      {
        mode: this.deps.mode,
        ui: this.deps.ui,
        doublePressToConfirm: preferences.doublePressToConfirm,
        showPersistenceSummary: preferences.showPersistenceSummary,
        setShowPersistenceSummary: this.deps.setShowPersistenceSummary,
      },
      details.forwarding
        ? "Permission Required (Subagent)"
        : "Permission Required",
      details.message,
      buildRequestOptions(details, this.deps.persistentApprovalService),
    );
    if (!isPersistentPermissionChoice(choice)) return choice;

    if (
      this.deps.getPromptPreferences().showPersistenceSummary &&
      !choice.summaryShown
    ) {
      return createDeniedPermissionDecision(
        "Persistent approval summary was not shown.",
      );
    }

    if (!this.deps.persistentApprovalService) {
      return createDeniedPermissionDecision(
        "Persistent approval is unavailable in this session.",
      );
    }
    try {
      this.deps.persistentApprovalService.persist({
        requestId: details.requestId,
        target: choice.target,
        surface: choice.proposal.surface,
        patterns: choice.proposal.patterns,
      });
      return { approved: true, state: "approved" };
    } catch (error) {
      return createDeniedPermissionDecision(persistenceFailureReason(error));
    }
  }
}

/** Keep filesystem paths and other error details out of agent-visible denial text. */
function persistenceFailureReason(error: unknown): string {
  const code = safeErrorCode(error);
  return code
    ? `Persistent approval failed (${code}).`
    : "Persistent approval failed.";
}

function safeErrorCode(error: unknown): string | undefined {
  try {
    const code =
      typeof error === "object" && error !== null
        ? (error as { code?: unknown }).code
        : undefined;
    return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(code)
      ? code
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A forwarded ask carrying a session-approval suggestion offers the scope
 * choice (subagent vs whole session); any other ask keeps its single
 * "for this session" option (custom label when the gate supplied one).
 */
function buildRequestOptions(
  details: PromptPermissionDetails,
  persistence?: PersistentApprovalApi,
): RequestPermissionOptions | undefined {
  const pattern = details.sessionApproval?.patterns[0];
  if (details.forwarding && details.sessionApproval && pattern) {
    return {
      sessionScope: buildForwardedScopeLabels(
        details.forwarding.requesterAgentName,
        details.sessionApproval.surface,
        pattern,
      ),
    };
  }
  if (details.forwarding) {
    return details.sessionLabel
      ? { sessionLabel: details.sessionLabel }
      : undefined;
  }

  const proposal = details.sessionApproval;
  if (!proposal || !persistence) {
    return details.sessionLabel
      ? { sessionLabel: details.sessionLabel }
      : undefined;
  }
  let projectTarget: PersistentApprovalTarget | undefined;
  try {
    projectTarget = persistence.prepare("project");
  } catch {
    projectTarget = undefined;
  }
  return {
    ...(details.sessionLabel ? { sessionLabel: details.sessionLabel } : {}),
    persistent: {
      proposal,
      ...(projectTarget ? { projectTarget } : {}),
      globalTarget: persistence.prepare("global"),
    },
  };
}
