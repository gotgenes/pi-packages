import {
  createDeniedPermissionDecision,
  normalizePermissionDenialReason,
  type RequestPermissionOptions,
  type UnattributedDecision,
} from "#src/authority/permission-dialog";

/**
 * Pure decision model for the inline keybind permission dialog.
 *
 * The interaction logic — which hotkey produces which decision, double-press
 * arming, step transitions, and reason validation — lives here with no SDK or
 * TUI imports, so it is unit-testable directly. The `ctx.ui.custom` component
 * ({@link file://./permission-prompt-component.ts}) is a thin adapter that
 * forwards keystrokes to {@link reducePrompt} and renders the returned state.
 */

/** The four decision hotkeys, in display order. */
export type PromptKey = "y" | "s" | "n" | "r";

/** Which sub-view the dialog is showing. */
export type PromptStep = "decision" | "reason" | "scope";

const OPTION_ORDER: readonly PromptKey[] = ["y", "s", "n", "r"];

const OPTION_VERBS: Record<PromptKey, string> = {
  y: "approve",
  s: "approve for this session",
  n: "deny",
  r: "deny with a reason",
};

/** Static configuration for a single prompt presentation. */
export interface PromptModelConfig {
  /** When true, a letter hotkey arms first and commits only on a second press. */
  doublePressToConfirm: boolean;
  /** Label shown beside the approve-for-session option. */
  sessionLabel: string;
  /**
   * Forwarded asks only: when set, confirming `s` opens a second step choosing
   * whether the grant applies to the requesting subagent only (least-privilege
   * default) or the whole serving session.
   */
  sessionScope?: NonNullable<RequestPermissionOptions["sessionScope"]>;
}

/** The re-render view state the component draws from. */
export interface PromptViewState {
  step: PromptStep;
  highlightedKey: PromptKey;
  /** Set only while awaiting the confirming second press of a hotkey. */
  armedKey?: PromptKey;
  /** "Press y again to approve." while armed; empty otherwise. */
  hint: string;
  /** Set when an empty reason submit is rejected. */
  reasonError?: string;
  /** Scope step: false = subagent-only (default), true = whole serving session. */
  scopeServing: boolean;
}

/** An input event the reducer understands. */
export type PromptEvent =
  | { type: "nav"; direction: "up" | "down" }
  | { type: "hotkey"; key: PromptKey }
  | { type: "confirm" }
  | { type: "cancel" }
  | { type: "submitReason"; draft: string };

/** Either a re-render or a terminal decision. */
export type PromptOutcome =
  | { kind: "render"; state: PromptViewState }
  | { kind: "decision"; decision: UnattributedDecision };

export function initialPromptState(
  _config: PromptModelConfig,
): PromptViewState {
  return {
    step: "decision",
    highlightedKey: "y",
    armedKey: undefined,
    hint: "",
    reasonError: undefined,
    scopeServing: false,
  };
}

/**
 * Advance the dialog by one input event, returning either the next view state
 * to render or the committed {@link UnattributedDecision}.
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
        highlightedKey: shiftKey(state.highlightedKey, event.direction),
        armedKey: undefined,
        hint: "",
      });
    case "hotkey":
      return pressHotkey(config, state, event.key);
    case "confirm":
      return commit(config, state, state.highlightedKey);
    case "cancel":
      return { kind: "decision", decision: createDeniedPermissionDecision() };
    case "submitReason":
      return render(state);
  }
}

function pressHotkey(
  config: PromptModelConfig,
  state: PromptViewState,
  key: PromptKey,
): PromptOutcome {
  if (!config.doublePressToConfirm || state.armedKey === key) {
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
    case "n":
      return { kind: "decision", decision: createDeniedPermissionDecision() };
    case "r":
      return render({
        ...state,
        step: "reason",
        highlightedKey: "r",
        armedKey: undefined,
        hint: "",
        reasonError: undefined,
      });
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
        decision: { approved: true, state: "approved_for_session" },
      };
  }
}

function reduceReasonStep(
  state: PromptViewState,
  event: PromptEvent,
): PromptOutcome {
  if (event.type === "cancel") {
    return render({
      ...state,
      step: "decision",
      armedKey: undefined,
      hint: "",
      reasonError: undefined,
    });
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
        decision: {
          approved: true,
          state: state.scopeServing
            ? "approved_for_serving_session"
            : "approved_for_session",
        },
      };
    case "cancel":
      return render({
        ...state,
        step: "decision",
        armedKey: undefined,
        hint: "",
      });
    default:
      return render(state);
  }
}

function shiftKey(current: PromptKey, direction: "up" | "down"): PromptKey {
  const index = OPTION_ORDER.indexOf(current);
  const delta = direction === "down" ? 1 : -1;
  const next = (index + delta + OPTION_ORDER.length) % OPTION_ORDER.length;
  return OPTION_ORDER[next] ?? current;
}

function render(state: PromptViewState): PromptOutcome {
  return { kind: "render", state };
}
