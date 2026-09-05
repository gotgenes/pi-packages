import type { SessionGrantWidth } from "#src/session/approval-grant";
import {
  createDeniedPermissionDecision,
  normalizePermissionDenialReason,
  type RequestPermissionOptions,
  type UnattributedDecision,
} from "./permission-dialog";

/**
 * Pure decision model for the inline keybind permission dialog.
 *
 * The interaction logic — which hotkey produces which decision, double-press
 * arming, step transitions, and reason validation — lives here with no SDK or
 * TUI imports, so it is unit-testable directly. The `ctx.ui.custom` component
 * ({@link file://./permission-prompt-component.ts}) is a thin adapter that
 * forwards keystrokes to {@link reducePrompt} and renders the returned state.
 */

/**
 * The decision hotkeys, in display order.
 *
 * `b` is conditional: it appears only for an ask whose session grant can be
 * widened to both directions (#813), so the roster an ask actually offers
 * comes from {@link visibleOptionKeys} rather than from this type.
 */
export type PromptKey = "y" | "s" | "b" | "n" | "r";

/** Which sub-view the dialog is showing. */
export type PromptStep = "decision" | "reason" | "scope";

const OPTION_ORDER: readonly PromptKey[] = ["y", "s", "b", "n", "r"];

const NARROW_OPTION_ORDER: readonly PromptKey[] = OPTION_ORDER.filter(
  (key) => key !== "b",
);

/**
 * The decision step's option keys, in display order.
 *
 * A function of the config rather than an exported constant, so which options
 * an ask offers is decided in the model and the component renders whatever it
 * is handed — two copies of the roster would be two places to teach about a
 * conditional option.
 *
 * The width option is offered iff the ask supplied a label for it, so an ask
 * that proves no single direction is rendered and navigated exactly as before.
 */
export function visibleOptionKeys(
  config: PromptModelConfig,
): readonly PromptKey[] {
  return config.widthLabel ? OPTION_ORDER : NARROW_OPTION_ORDER;
}

const OPTION_VERBS: Record<PromptKey, string> = {
  y: "approve",
  s: "approve for this session",
  b: "approve both directions for this session",
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
  /**
   * The width the session option chosen so far would grant.
   *
   * Held on the state rather than passed to the scope step, because a
   * forwarded ask commits the two choices in different steps. Reset to
   * `"proven"` on every return to the decision step, so a width the user
   * backed out of cannot ride along with a later narrow choice.
   */
  grantWidth: SessionGrantWidth;
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
    grantWidth: "proven",
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
        highlightedKey: shiftKey(config, state.highlightedKey, event.direction),
        armedKey: undefined,
        hint: "",
      });
    case "hotkey":
      return visibleOptionKeys(config).includes(event.key)
        ? pressHotkey(config, state, event.key)
        : render(state);
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
    case "b": {
      // The two session options differ only in the width they grant; which
      // scope they land on is the forwarded scope step's separate question.
      const grantWidth: SessionGrantWidth = key === "b" ? "family" : "proven";
      if (config.sessionScope) {
        return render({
          ...state,
          step: "scope",
          highlightedKey: key,
          armedKey: undefined,
          hint: "",
          scopeServing: false,
          grantWidth,
        });
      }
      return {
        kind: "decision",
        decision: sessionDecision("approved_for_session", grantWidth),
      };
    }
  }
}

/**
 * A session-granting decision, naming its width only when it is not the
 * default.
 *
 * Absent means `"proven"` everywhere this value travels — the decision, the
 * gate result, and the forwarded wire — so the narrow grant serializes
 * exactly as it did before the option existed.
 */
function sessionDecision(
  state: "approved_for_session" | "approved_for_serving_session",
  width: SessionGrantWidth,
): UnattributedDecision {
  return {
    approved: true,
    state,
    ...(width === "family" ? { sessionGrantWidth: width } : {}),
  };
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
      grantWidth: "proven",
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
        decision: sessionDecision(
          state.scopeServing
            ? "approved_for_serving_session"
            : "approved_for_session",
          state.grantWidth,
        ),
      };
    case "cancel":
      return render({
        ...state,
        step: "decision",
        armedKey: undefined,
        hint: "",
        grantWidth: "proven",
      });
    default:
      return render(state);
  }
}

function shiftKey(
  config: PromptModelConfig,
  current: PromptKey,
  direction: "up" | "down",
): PromptKey {
  const keys = visibleOptionKeys(config);
  const index = keys.indexOf(current);
  const delta = direction === "down" ? 1 : -1;
  const next = (index + delta + keys.length) % keys.length;
  return keys[next] ?? current;
}

function render(state: PromptViewState): PromptOutcome {
  return { kind: "render", state };
}
