import type {
  InteractivePermissionChoice,
  PermissionRuleProposalData,
} from "#src/authority/interactive-permission-choice";
import {
  createDeniedPermissionDecision,
  normalizePermissionDenialReason,
  type PersistentPromptOptions,
  type RequestPermissionOptions,
} from "#src/authority/permission-dialog";
import type { PersistentApprovalTarget } from "#src/persistent-approval-service";

/**
 * Pure decision model for the inline keybind permission dialog.
 *
 * The interaction logic — which hotkey produces which decision, double-press
 * arming, step transitions, editing, and persistence confirmation — lives here
 * with no SDK or TUI imports. The component is only a rendering/input adapter.
 */

/** Decision hotkeys, in their display order when every choice is available. */
export type PromptKey = "y" | "s" | "e" | "p" | "g" | "n" | "r";

/** Which sub-view the dialog is showing. */
export type PromptStep =
  | "decision"
  | "reason"
  | "scope"
  | "edit"
  | "persistent-confirm";

const OPTION_VERBS: Record<PromptKey, string> = {
  y: "approve",
  s: "approve for this session",
  e: "edit the proposed patterns",
  p: "persist for this project",
  g: "persist globally",
  n: "deny",
  r: "deny with a reason",
};

/** Static configuration for a single prompt presentation. */
export interface PromptModelConfig {
  /** When true, a letter hotkey arms first and commits only on a second press. */
  doublePressToConfirm: boolean;
  /** Label shown beside the approve-for-session option. */
  sessionLabel: string;
  /** Show the exact durable rule and destination before saving it. */
  showPersistenceSummary: boolean;
  /** Forwarded-ask session-scope choices. */
  sessionScope?: NonNullable<RequestPermissionOptions["sessionScope"]>;
  /** Local-direct durable choices; absent for forwarded asks. */
  persistent?: PersistentPromptOptions;
}

/** The re-render view state the component draws from. */
export interface PromptViewState {
  step: PromptStep;
  highlightedKey: PromptKey;
  /** Set only while awaiting the confirming second press of a hotkey. */
  armedKey?: PromptKey;
  hint: string;
  reasonDraft: string;
  reasonError?: string;
  scopeServing: boolean;
  proposal?: PermissionRuleProposalData;
  editPatterns?: string[];
  editIndex?: number;
  editError?: string;
  persistenceTarget?: PersistentApprovalTarget;
}

/** An input event the reducer understands. */
export type PromptEvent =
  | { type: "nav"; direction: "up" | "down" }
  | { type: "hotkey"; key: PromptKey }
  | { type: "confirm" }
  | { type: "cancel" }
  | { type: "submitReason"; draft: string }
  | { type: "submitEdit"; draft: string };

/** Either a re-render or a terminal choice. */
export type PromptOutcome =
  | { kind: "render"; state: PromptViewState }
  | { kind: "decision"; decision: InteractivePermissionChoice };

export function promptKeys(config: PromptModelConfig): readonly PromptKey[] {
  const keys: PromptKey[] = ["y", "s"];
  if (config.persistent) {
    keys.push("e");
    if (config.persistent.projectTarget) keys.push("p");
    keys.push("g");
  }
  keys.push("n", "r");
  return keys;
}

export function initialPromptState(config: PromptModelConfig): PromptViewState {
  return {
    step: "decision",
    highlightedKey: "y",
    armedKey: undefined,
    hint: "",
    reasonDraft: "",
    reasonError: undefined,
    scopeServing: false,
    ...(config.persistent
      ? {
          proposal: config.persistent.proposal,
          editPatterns: [],
          editIndex: 0,
        }
      : {}),
  };
}

/** Advance the dialog by one input event. */
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
        highlightedKey: shiftKey(config, state.highlightedKey, event.direction),
        armedKey: undefined,
        hint: "",
      });
    case "hotkey":
      if (!promptKeys(config).includes(event.key)) return render(state);
      return pressHotkey(config, state, event.key);
    case "confirm":
      return commit(config, state, state.highlightedKey);
    case "cancel":
      return { kind: "decision", decision: createDeniedPermissionDecision() };
    default:
      return render(state);
  }
}

function pressHotkey(
  config: PromptModelConfig,
  state: PromptViewState,
  key: PromptKey,
): PromptOutcome {
  const opensNonDestructiveStep =
    key === "e" ||
    ((key === "p" || key === "g") && config.showPersistenceSummary);
  if (
    opensNonDestructiveStep ||
    !config.doublePressToConfirm ||
    state.armedKey === key
  ) {
    return commit(config, state, key);
  }
  return render({
    ...state,
    highlightedKey: key,
    armedKey: key,
    hint: `Press ${key} again to ${OPTION_VERBS[key]}.`,
  });
}

function commit(
  config: PromptModelConfig,
  state: PromptViewState,
  key: PromptKey,
): PromptOutcome {
  switch (key) {
    case "y":
      return {
        kind: "decision",
        decision: { approved: true, state: "approved" },
      };
    case "s":
      if (config.sessionScope) {
        return render({
          ...state,
          step: "scope",
          highlightedKey: "s",
          armedKey: undefined,
          hint: "",
          scopeServing: false,
        });
      }
      return {
        kind: "decision",
        decision: {
          approved: true,
          state: "approved_for_session",
          ...(state.proposal ? { sessionApproval: state.proposal } : {}),
        },
      };
    case "e":
      if (!state.proposal) return render(state);
      return render({
        ...state,
        step: "edit",
        highlightedKey: "e",
        armedKey: undefined,
        hint: "",
        editPatterns: [...state.proposal.patterns],
        editIndex: 0,
        editError: undefined,
      });
    case "p": {
      const target = config.persistent?.projectTarget;
      return target ? beginPersistence(config, state, target) : render(state);
    }
    case "g": {
      const target = config.persistent?.globalTarget;
      return target ? beginPersistence(config, state, target) : render(state);
    }
    case "n":
      return { kind: "decision", decision: createDeniedPermissionDecision() };
    case "r":
      return render({
        ...state,
        step: "reason",
        highlightedKey: "r",
        armedKey: undefined,
        hint: "",
        reasonDraft: "",
        reasonError: undefined,
      });
  }
}

function beginPersistence(
  config: PromptModelConfig,
  state: PromptViewState,
  target: PersistentApprovalTarget,
): PromptOutcome {
  if (!state.proposal) return render(state);
  if (!config.showPersistenceSummary) {
    return persistentChoice(state, target, false);
  }
  return render({
    ...state,
    step: "persistent-confirm",
    armedKey: undefined,
    hint: "",
    persistenceTarget: target,
  });
}

function reduceReasonStep(
  state: PromptViewState,
  event: PromptEvent,
): PromptOutcome {
  if (event.type === "cancel") return backToDecision(state);
  if (event.type !== "submitReason") return render(state);

  const reason = normalizePermissionDenialReason(event.draft);
  if (reason === undefined) {
    return render({
      ...state,
      reasonDraft: event.draft,
      reasonError: "A reason is required.",
    });
  }
  return {
    kind: "decision",
    decision: createDeniedPermissionDecision(reason),
  };
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
        decision: {
          approved: true,
          state: state.scopeServing
            ? "approved_for_serving_session"
            : "approved_for_session",
        },
      };
    case "cancel":
      return backToDecision(state);
    default:
      return render(state);
  }
}

function reduceEditStep(
  state: PromptViewState,
  event: PromptEvent,
): PromptOutcome {
  if (event.type === "cancel") return backToDecision(state);
  if (event.type !== "submitEdit") return render(state);

  const edited = event.draft.trim();
  if (!edited) {
    return render({ ...state, editError: "A pattern is required." });
  }
  const editIndex = state.editIndex ?? 0;
  const patterns = [...(state.editPatterns ?? [])];
  patterns[editIndex] = edited;
  if (editIndex + 1 < patterns.length) {
    return render({
      ...state,
      editPatterns: patterns,
      editIndex: editIndex + 1,
      editError: undefined,
    });
  }
  return render({
    ...state,
    step: "decision",
    highlightedKey: "e",
    armedKey: undefined,
    hint: "",
    proposal: {
      surface: state.proposal?.surface ?? "*",
      patterns: [...new Set(patterns)],
    },
    editPatterns: [],
    editIndex: 0,
    editError: undefined,
  });
}

function reducePersistentConfirmStep(
  state: PromptViewState,
  event: PromptEvent,
): PromptOutcome {
  if (event.type === "cancel") return backToDecision(state);
  if (event.type !== "confirm") return render(state);

  const target = state.persistenceTarget;
  return target ? persistentChoice(state, target, true) : backToDecision(state);
}

function persistentChoice(
  state: PromptViewState,
  target: PersistentApprovalTarget,
  summaryShown: boolean,
): PromptOutcome {
  if (!state.proposal) return backToDecision(state);
  return {
    kind: "decision",
    decision: {
      kind: "persist",
      scope: target.scope,
      proposal: state.proposal,
      target,
      summaryShown,
    },
  };
}

function backToDecision(state: PromptViewState): PromptOutcome {
  return render({
    ...state,
    step: "decision",
    armedKey: undefined,
    hint: "",
    reasonDraft: "",
    reasonError: undefined,
    ...(state.proposal
      ? {
          editPatterns: [],
          editIndex: 0,
          editError: undefined,
          persistenceTarget: undefined,
        }
      : {}),
  });
}

function shiftKey(
  config: PromptModelConfig,
  current: PromptKey,
  direction: "up" | "down",
): PromptKey {
  const keys = promptKeys(config);
  const index = keys.indexOf(current);
  const delta = direction === "down" ? 1 : -1;
  const next = (index + delta + keys.length) % keys.length;
  return keys[next] ?? current;
}

function render(state: PromptViewState): PromptOutcome {
  return { kind: "render", state };
}
