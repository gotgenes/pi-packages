import type { DialogKeyBindings, PromptAction } from "#src/config/dialog-keys";
import type { PersistentApprovalTarget } from "#src/persistence/persistent-approval-service";
import type { SessionGrantWidth } from "#src/session/approval-grant";
import type {
  PermissionRuleProposalData,
  UnattributedChoice,
} from "./interactive-permission-choice";
import {
  createDeniedPermissionDecision,
  dedupeGrants,
  normalizePermissionDenialReason,
  type PersistentPromptOptions,
  persistentChoice,
  type RequestPermissionOptions,
  sessionApprovalDecision,
} from "./permission-dialog";

/**
 * Pure decision model for the inline keybind permission dialog.
 *
 * The interaction logic — which hotkey produces which decision, double-press
 * arming, step transitions, pattern editing, persistence confirmation, and
 * reason validation — lives here with no SDK or TUI imports, so it is
 * unit-testable directly. The `ctx.ui.custom` component
 * ({@link file://./permission-prompt-component.ts}) is a thin adapter that
 * forwards keystrokes to {@link reducePrompt} and renders the returned state.
 */

/** Which sub-view the dialog is showing. */
export type PromptStep =
  | "decision"
  | "reason"
  | "scope"
  | "edit"
  | "persistent-confirm";

/**
 * The decisions in display order.
 *
 * `approveSessionBoth` and the three persistence actions are conditional: the
 * width option appears only for an ask whose session grant can be widened to
 * both directions (#813), and the persistence actions only for a local direct
 * ask that carries a proposal. The roster an ask actually offers comes from
 * {@link visibleActions} rather than from this list.
 */
const OPTION_ORDER: readonly PromptAction[] = [
  "approve",
  "approveSession",
  "approveSessionBoth",
  "editPatterns",
  "persistProject",
  "persistGlobal",
  "deny",
  "denyWithReason",
];

/**
 * The decision step's options, in display order.
 *
 * A function of the config rather than an exported constant, so which options
 * an ask offers is decided in the model and the component renders whatever it
 * is handed — two copies of the roster would be two places to teach about a
 * conditional option.
 */
export function visibleActions(
  config: PromptModelConfig,
): readonly PromptAction[] {
  return OPTION_ORDER.filter((action) => {
    switch (action) {
      case "approveSessionBoth":
        return config.widthLabel !== undefined;
      case "editPatterns":
      case "persistGlobal":
        return config.persistent !== undefined;
      case "persistProject":
        return config.persistent?.projectTarget !== undefined;
      default:
        return true;
    }
  });
}

const OPTION_VERBS: Record<PromptAction, string> = {
  approve: "approve",
  approveSession: "approve for this session",
  approveSessionBoth: "approve both directions for this session",
  editPatterns: "edit the proposed patterns",
  persistProject: "save for this project",
  persistGlobal: "save globally",
  deny: "deny",
  denyWithReason: "deny with a reason",
};

/** Static configuration for a single prompt presentation. */
export interface PromptModelConfig {
  /** When true, a hotkey arms first and commits only on a second press. */
  doublePressToConfirm: boolean;
  /**
   * The character bound to each decision.
   *
   * What the dialog matches keystrokes against and what it renders, so an
   * option's identity and the key that selects it are separate values.
   */
  keys: DialogKeyBindings;
  /** Label shown beside the approve-for-session option. */
  sessionLabel: string;
  /**
   * Label for the both-directions session option (#813).
   *
   * Its presence is what offers the option: an ask whose grants prove no
   * single direction supplies none, and the roster stays four keys.
   */
  widthLabel?: string;
  /**
   * Forwarded asks only: when set, confirming `s` opens a second step choosing
   * whether the grant applies to the requesting subagent only (least-privilege
   * default) or the whole serving session.
   */
  sessionScope?: NonNullable<RequestPermissionOptions["sessionScope"]>;
  /** Show the exact durable rule and destination before saving it. */
  showPersistenceSummary: boolean;
  /** Local direct asks only: the proposal and the files it may be saved to. */
  persistent?: PersistentPromptOptions;
}

/** The re-render view state the component draws from. */
export interface PromptViewState {
  step: PromptStep;
  highlightedAction: PromptAction;
  /** Set only while awaiting the confirming second press of a hotkey. */
  armedAction?: PromptAction;
  /** "Press y again to approve." while armed; empty otherwise. */
  hint: string;
  /** Set when an empty reason submit is rejected. */
  reasonError?: string;
  /** Scope step: false = subagent-only (default), true = whole serving session. */
  scopeServing: boolean;
  /**
   * The width the session option chosen so far would grant.
   *
   * Held on the state rather than passed to the scope step, because a
   * forwarded ask commits the two choices in different steps. Reset to
   * `"proven"` on every return to the decision step, so a width the user
   * backed out of cannot ride along with a later narrow choice.
   */
  grantWidth: SessionGrantWidth;
  /** The proposal as currently offered; replaced by each completed edit. */
  proposal?: PermissionRuleProposalData;
  /**
   * The proposal once the human has changed it from what the gate offered.
   *
   * Separate from `proposal` so a session grant carries grants only when they
   * differ from the descriptor's, and the wire stays byte-identical otherwise.
   */
  editedProposal?: PermissionRuleProposalData;
  /** Edit step: the patterns being edited, one per grant, in proposal order. */
  editPatterns?: string[];
  /** Edit step: which grant's pattern the editor currently holds. */
  editIndex?: number;
  /** Set when a blank pattern submit is rejected. */
  editError?: string;
  /** Persistent-confirm step: the file the confirmed rule will be written to. */
  persistenceTarget?: PersistentApprovalTarget;
}

/** An input event the reducer understands. */
export type PromptEvent =
  | { type: "nav"; direction: "up" | "down" }
  | { type: "hotkey"; action: PromptAction }
  | { type: "confirm" }
  | { type: "cancel" }
  | { type: "submitReason"; draft: string }
  | { type: "submitEdit"; draft: string };

/** Either a re-render or a terminal choice. */
export type PromptOutcome =
  | { kind: "render"; state: PromptViewState }
  | { kind: "decision"; decision: UnattributedChoice };

export function initialPromptState(config: PromptModelConfig): PromptViewState {
  return {
    step: "decision",
    highlightedAction: "approve",
    armedAction: undefined,
    hint: "",
    reasonError: undefined,
    scopeServing: false,
    grantWidth: "proven",
    ...(config.persistent ? { proposal: config.persistent.proposal } : {}),
  };
}

/**
 * Advance the dialog by one input event, returning either the next view state
 * to render or the committed {@link UnattributedChoice}.
 *
 * The model states the outcome and not the decider: which human surface this
 * is gets attributed by the dispatcher that chose to render this dialog, so
 * the two cannot disagree about the surface.
 */
export function reducePrompt(
  config: PromptModelConfig,
  state: PromptViewState,
  event: PromptEvent,
): PromptOutcome {
  switch (state.step) {
    case "decision":
      return reduceDecisionStep(config, state, event);
    case "reason":
      return reduceReasonStep(state, event);
    case "scope":
      return reduceScopeStep(state, event);
    case "edit":
      return reduceEditStep(state, event);
    case "persistent-confirm":
      return reducePersistentConfirmStep(state, event);
  }
}

function reduceDecisionStep(
  config: PromptModelConfig,
  state: PromptViewState,
  event: PromptEvent,
): PromptOutcome {
  switch (event.type) {
    case "nav":
      return render({
        ...state,
        highlightedAction: shiftAction(
          config,
          state.highlightedAction,
          event.direction,
        ),
        armedAction: undefined,
        hint: "",
      });
    case "hotkey":
      return visibleActions(config).includes(event.action)
        ? pressHotkey(config, state, event.action)
        : render(state);
    case "confirm":
      return commit(config, state, state.highlightedAction);
    case "cancel":
      return { kind: "decision", decision: createDeniedPermissionDecision() };
    default:
      return render(state);
  }
}

function pressHotkey(
  config: PromptModelConfig,
  state: PromptViewState,
  action: PromptAction,
): PromptOutcome {
  // Double-press guards a commit; an action that only opens another step is
  // safe on the first press, and the summary step is its own confirmation.
  const opensStep =
    action === "editPatterns" ||
    ((action === "persistProject" || action === "persistGlobal") &&
      config.showPersistenceSummary);
  if (
    opensStep ||
    !config.doublePressToConfirm ||
    state.armedAction === action
  ) {
    return commit(config, state, action);
  }
  return render({
    ...state,
    highlightedAction: action,
    armedAction: action,
    hint: `Press ${config.keys[action]} again to ${OPTION_VERBS[action]}.`,
  });
}

function commit(
  config: PromptModelConfig,
  state: PromptViewState,
  action: PromptAction,
): PromptOutcome {
  switch (action) {
    case "approve":
      return {
        kind: "decision",
        decision: { approved: true, state: "approved" },
      };
    case "deny":
      return { kind: "decision", decision: createDeniedPermissionDecision() };
    case "denyWithReason":
      return render({
        ...state,
        step: "reason",
        highlightedAction: "denyWithReason",
        armedAction: undefined,
        hint: "",
        reasonError: undefined,
      });
    case "approveSession":
    case "approveSessionBoth": {
      // The two session options differ only in the width they grant; which
      // scope they land on is the forwarded scope step's separate question.
      const grantWidth: SessionGrantWidth =
        action === "approveSessionBoth" ? "family" : "proven";
      if (config.sessionScope) {
        return render({
          ...state,
          step: "scope",
          highlightedAction: action,
          armedAction: undefined,
          hint: "",
          scopeServing: false,
          grantWidth,
        });
      }
      return {
        kind: "decision",
        decision: sessionApprovalDecision(
          "approved_for_session",
          grantWidth,
          editedProposal(state),
        ),
      };
    }
    case "editPatterns":
      if (!state.proposal) return render(state);
      return render({
        ...state,
        step: "edit",
        highlightedAction: "editPatterns",
        armedAction: undefined,
        hint: "",
        editPatterns: state.proposal.grants.map((grant) => grant.pattern),
        editIndex: 0,
        editError: undefined,
      });
    case "persistProject":
      return beginPersistence(config, state, config.persistent?.projectTarget);
    case "persistGlobal":
      return beginPersistence(config, state, config.persistent?.globalTarget);
  }
}

/** The proposal to carry on a session decision: only one the human changed. */
function editedProposal(
  state: PromptViewState,
): PermissionRuleProposalData | undefined {
  return state.editedProposal;
}

function beginPersistence(
  config: PromptModelConfig,
  state: PromptViewState,
  target: PersistentApprovalTarget | undefined,
): PromptOutcome {
  if (!state.proposal || !target) return render(state);
  if (!config.showPersistenceSummary) {
    return {
      kind: "decision",
      decision: persistentChoice(state.proposal, target, false),
    };
  }
  return render({
    ...state,
    step: "persistent-confirm",
    armedAction: undefined,
    hint: "",
    persistenceTarget: target,
  });
}

function reduceReasonStep(
  state: PromptViewState,
  event: PromptEvent,
): PromptOutcome {
  if (event.type === "cancel") {
    return backToDecision(state);
  }
  if (event.type === "submitReason") {
    const reason = normalizePermissionDenialReason(event.draft);
    if (reason === undefined) {
      return render({
        ...state,
        reasonError: "A reason is required.",
      });
    }
    return {
      kind: "decision",
      decision: createDeniedPermissionDecision(reason),
    };
  }
  return render(state);
}

function reduceScopeStep(
  state: PromptViewState,
  event: PromptEvent,
): PromptOutcome {
  switch (event.type) {
    case "nav":
      return render({ ...state, scopeServing: event.direction === "down" });
    case "confirm":
      return {
        kind: "decision",
        decision: sessionApprovalDecision(
          state.scopeServing
            ? "approved_for_serving_session"
            : "approved_for_session",
          state.grantWidth,
          editedProposal(state),
        ),
      };
    case "cancel":
      return backToDecision(state);
    default:
      return render(state);
  }
}

/**
 * One pattern per visit: a submit advances to the next grant, and the last
 * submit replaces the proposal and returns to the decision step, where the
 * edited proposal is what every later choice records or saves.
 */
function reduceEditStep(
  state: PromptViewState,
  event: PromptEvent,
): PromptOutcome {
  if (event.type === "cancel") return backToDecision(state);
  if (event.type !== "submitEdit" || !state.proposal) return render(state);

  const pattern = event.draft.trim();
  if (!pattern) {
    return render({ ...state, editError: "A pattern is required." });
  }
  const editIndex = state.editIndex ?? 0;
  const patterns = [...(state.editPatterns ?? [])];
  patterns[editIndex] = pattern;
  if (editIndex + 1 < patterns.length) {
    return render({
      ...state,
      editPatterns: patterns,
      editIndex: editIndex + 1,
      editError: undefined,
    });
  }
  const grants = dedupeGrants(
    state.proposal.grants.map((grant, index) => ({
      surface: grant.surface,
      pattern: patterns[index] ?? grant.pattern,
    })),
  );
  return render({
    ...backToDecisionState(state),
    highlightedAction: "editPatterns",
    proposal: { grants },
    editedProposal: { grants },
  });
}

function reducePersistentConfirmStep(
  state: PromptViewState,
  event: PromptEvent,
): PromptOutcome {
  if (event.type === "cancel") return backToDecision(state);
  if (event.type !== "confirm") return render(state);

  const target = state.persistenceTarget;
  if (!target || !state.proposal) return backToDecision(state);
  return {
    kind: "decision",
    decision: persistentChoice(state.proposal, target, true),
  };
}

function backToDecision(state: PromptViewState): PromptOutcome {
  return render(backToDecisionState(state));
}

function backToDecisionState(state: PromptViewState): PromptViewState {
  return {
    ...state,
    step: "decision",
    armedAction: undefined,
    hint: "",
    reasonError: undefined,
    grantWidth: "proven",
    editPatterns: undefined,
    editIndex: undefined,
    editError: undefined,
    persistenceTarget: undefined,
  };
}

function shiftAction(
  config: PromptModelConfig,
  current: PromptAction,
  direction: "up" | "down",
): PromptAction {
  const actions = visibleActions(config);
  const index = actions.indexOf(current);
  const delta = direction === "down" ? 1 : -1;
  const next = (index + delta + actions.length) % actions.length;
  return actions[next] ?? current;
}

function render(state: PromptViewState): PromptOutcome {
  return { kind: "render", state };
}
