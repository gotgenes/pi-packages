import type {
  ExtensionContext,
  ExtensionUIContext,
  KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Input,
  type KeyId,
  matchesKey,
} from "@earendil-works/pi-tui";
import type { PromptNotificationChannel } from "#src/config/config-schema";
import type { DialogKeyBindings, PromptAction } from "#src/config/dialog-keys";
import {
  completeViewBudget,
  type DialogView,
  type RenderBudget,
  renderPromptDialog,
} from "#src/presentation/dialog-renderer";
import { fitLinesToWidth } from "#src/presentation/line-fitting";
import {
  type PromptNotice,
  renderPromptNotification,
} from "#src/presentation/prompt-notification";
import type { PromptPayload } from "#src/presentation/prompt-payload";
import { AnswerWindow } from "./answer-window";
import { collapsePastedNewlines } from "./bracketed-paste";
import type { DecisionSource, UserDecisionSurface } from "./decision-source";
import {
  type PermissionPromptDecision,
  type RequestPermissionOptions,
  requestPermissionDecisionFromUi,
  type UnattributedDecision,
} from "./permission-dialog";
import {
  initialPromptState,
  type PromptEvent,
  type PromptModelConfig,
  type PromptViewState,
  reducePrompt,
  visibleActions,
} from "./permission-prompt-decision";

/**
 * Inline `ctx.ui.custom` permission dialog for TUI sessions.
 *
 * All interaction logic lives in the pure {@link reducePrompt} model; this
 * module is the thin adapter that renders the model's state to lines, maps raw
 * keystrokes to {@link PromptEvent}s, and resolves the `ctx.ui.custom` promise
 * with the committed {@link PermissionPromptDecision}. The component renders
 * inline (never as an overlay), and declares itself a wait on a permission
 * decision, so Pi reports the session as blocked while it is shown.
 */

/** The subset of the session UI surface the inline dialog needs. */
export type PermissionPromptUi = Pick<
  ExtensionUIContext,
  "select" | "input" | "custom" | "getToolsExpanded" | "setToolsExpanded"
>;

/** The keybindings surface the dialog consults; only `matches` is read (ISP). */
type PromptKeybindings = Pick<KeybindingsManager, "matches">;

/** The resolved presentation context selected once per activation. */
export interface PermissionPromptView extends PromptPreferences {
  mode: ExtensionContext["mode"];
  ui: PermissionPromptUi;
  /** What the inline dialog's terminal notification says; the fallback ignores it. */
  notice: PromptNotice;
}

/** Live prompt-behavior preferences read at prompt time (see `doublePressToConfirm`). */
export interface PromptPreferences {
  doublePressToConfirm: boolean;
  /** How much room a render has; the terminal width is added per frame. */
  budget: RenderBudget;
  /** The character bound to each decision. */
  dialogKeys: DialogKeyBindings;
  /** Terminal notifications the inline dialog emits as it opens; empty for none. */
  promptNotifications: readonly PromptNotificationChannel[];
  /** How long a shown prompt waits for an answer before it denies; absent for no timer. */
  promptTimeoutMs?: number;
}

/**
 * Route a permission ask to the inline keybind dialog in TUI mode, or the
 * `select()`/`input()` flow otherwise (RPC / frontend — the #519 constraint).
 *
 * The single entry the `LocalUserAuthorizer` calls; keeps the mode dispatch in
 * one place so the fallback and the inline component never both render.
 *
 * It is therefore also the one place that knows which surface the human
 * answered on, so it is where the decision is attributed to that surface
 * (#726). Having the dialog model and the fallback each name themselves would
 * be two sites that must agree with this branch.
 *
 * It also opens the prompt's {@link AnswerWindow} as the prompt is shown. A
 * surface the window dismissed answers `undefined`, and the window, which is
 * what decided, stamps the `unanswered` decision itself.
 */
export async function requestPermissionDecision(
  view: PermissionPromptView,
  title: string,
  payload: PromptPayload,
  options?: RequestPermissionOptions,
): Promise<PermissionPromptDecision> {
  const window = AnswerWindow.open(view.promptTimeoutMs);
  const surface = chooseDecisionSurface(view, title, payload, options);
  try {
    const answer = await surface.ask(window);
    return answer === undefined
      ? window.expiredDecision()
      : attributeToHuman(answer, surface.via);
  } finally {
    window.close();
  }
}

/**
 * One human-facing surface: how to ask on it, and the name it answers under.
 *
 * `ask` answers `undefined` only when the window dismissed the prompt.
 */
interface DecisionSurface {
  via: UserDecisionSurface;
  ask: (window: DialogClock) => Promise<UnattributedDecision | undefined>;
}

/**
 * The answer window as a surface uses it: the signal that dismisses the
 * prompt, and — for the inline dialog, which sees keystrokes — the
 * running length to show and the means to stop it once the human engages.
 */
export type DialogClock = Pick<
  AnswerWindow,
  "signal" | "pendingTimeoutMs" | "engage"
>;

function chooseDecisionSurface(
  view: PermissionPromptView,
  title: string,
  payload: PromptPayload,
  options?: RequestPermissionOptions,
): DecisionSurface {
  if (view.mode === "tui") {
    return {
      via: "dialog",
      ask: (window) =>
        presentInlinePermissionPrompt(view, title, payload, options, window),
    };
  }
  return {
    via: "select",
    ask: (window) =>
      askThroughFallback(view, title, payload, options, window.signal),
  };
}

function askThroughFallback(
  view: PermissionPromptView,
  title: string,
  payload: PromptPayload,
  options: RequestPermissionOptions | undefined,
  signal: AbortSignal | undefined,
): Promise<UnattributedDecision | undefined> {
  // The fallback renders once and cannot re-render, so it neither paints nor
  // offers an expansion; it substitutes a nominal width for the terminal size
  // it is never told, and the host's own select wraps from there.
  const rendered = renderPromptDialog(payload, {
    ...view.budget,
    width: FALLBACK_RENDER_WIDTH,
  });
  return requestPermissionDecisionFromUi(
    view.ui,
    title,
    rendered.lines.join("\n"),
    options,
    signal,
  );
}

function attributeToHuman(
  decision: UnattributedDecision,
  via: UserDecisionSurface,
): PermissionPromptDecision {
  const decidedBy: DecisionSource = { kind: "user", via };
  return { ...decision, decidedBy };
}

/** The width the `select`/`input` fallback renders against. */
const FALLBACK_RENDER_WIDTH = 80;

/** Minimal theme surface the dialog uses; satisfied by the real SDK theme. */
interface PromptTheme {
  fg(color: string, text: string): string;
}

const DEFAULT_SESSION_LABEL = "Yes, for this session";

const OPTION_LABELS: Record<PromptAction, string> = {
  approve: "Yes",
  approveSession: DEFAULT_SESSION_LABEL,
  approveSessionBoth: "Yes, for this session in both directions",
  deny: "No",
  denyWithReason: "No, provide reason",
};

/**
 * Show the inline dialog. The clock's signal dismisses it: an abort closes the
 * dialog and answers `undefined`, so a caller can tell a dismissal from a
 * human answer. The first keystroke engages the clock, stopping it.
 */
export function presentInlinePermissionPrompt(
  view: PermissionPromptView,
  title: string,
  payload: PromptPayload,
  options?: RequestPermissionOptions,
  clock?: DialogClock,
): Promise<UnattributedDecision | undefined> {
  const config: PromptModelConfig = {
    doublePressToConfirm: view.doublePressToConfirm,
    sessionLabel: options?.sessionLabel ?? DEFAULT_SESSION_LABEL,
    widthLabel: options?.sessionWidth?.label,
    sessionScope: options?.sessionScope,
    keys: view.dialogKeys,
  };
  return view.ui.custom<UnattributedDecision | undefined>(
    (tui, theme, keybindings, done) => {
      // The host's `done` is idempotent, so a human answer racing the abort
      // settles whichever arrives first.
      clock?.signal?.addEventListener(
        "abort",
        () => {
          done(undefined);
        },
        { once: true },
      );
      // The factory runs once, as the dialog mounts, which is the moment the
      // human is being asked; a re-render does not come back through here.
      const notification = renderPromptNotification(
        view.promptNotifications,
        view.notice,
      );
      if (notification) {
        tui.terminal.write(notification);
      }
      return new PermissionPromptComponent(
        theme,
        config,
        title,
        payload,
        view.budget,
        (data) => handleToolsExpandAction(data, keybindings, view.ui),
        () => {
          tui.requestRender();
        },
        done,
        clock,
      );
    },
    // Pi 1.5.0+ reports `blocked` (OSC 7501) while the dialog is shown and
    // restores the previous status when it closes; older Pi ignores the field.
    // The title names no command, path, or target.
    { overlay: false, blocked: { kind: "permission", message: title } },
  );
}

/**
 * Forward Pi's tool-expansion action while the dialog holds keyboard focus.
 *
 * A focused `ctx.ui.custom` component consumes every keystroke, so `Ctrl+O`
 * would otherwise be dead for the duration of an ask — exactly when the user
 * most needs to see the full pending tool invocation. Returns `true` when the
 * keystroke was the action (and was handled), so the caller stops before
 * mapping it to a {@link PromptEvent}; expansion is a display concern and must
 * never reach the decision model.
 *
 * Deliberately does not request a render: `setToolsExpanded` re-renders the
 * host itself, and the dialog's own lines are unaffected by tool expansion.
 */
function handleToolsExpandAction(
  data: string,
  keybindings: PromptKeybindings,
  ui: PermissionPromptUi,
): boolean {
  if (!keybindings.matches(data, "app.tools.expand")) {
    return false;
  }
  ui.setToolsExpanded(!ui.getToolsExpanded());
  return true;
}

class PermissionPromptComponent implements Component {
  private state: PromptViewState;
  /** The denial-reason line editor, rebuilt each time the step is entered. */
  private reason: Input;
  /** Whether the operator asked to see the complete request (ADR 0011 §4). */
  private expanded = false;

  constructor(
    private readonly theme: PromptTheme,
    private readonly config: PromptModelConfig,
    private readonly title: string,
    private readonly payload: PromptPayload,
    private readonly budget: RenderBudget,
    private readonly handleAppAction: (data: string) => boolean,
    private readonly requestRender: () => void,
    private readonly done: (decision: UnattributedDecision) => void,
    private readonly clock: DialogClock | undefined,
  ) {
    this.state = initialPromptState(config);
    this.reason = this.createReasonEditor();
  }

  /**
   * A fresh editor per visit to the reason step.
   *
   * The framework editor carries an undo stack and a kill ring, so reusing one
   * instance would let a reason the operator backed out of be restored into a
   * later ask.
   */
  private createReasonEditor(): Input {
    const editor = new Input();
    // Emits pi-tui's zero-width cursor marker, which positions the hardware
    // cursor for IME composition.
    editor.focused = true;
    editor.onSubmit = (draft) => {
      this.apply({ type: "submitReason", draft });
    };
    editor.onEscape = () => {
      this.apply({ type: "cancel" });
    };
    return editor;
  }

  invalidate(): void {
    // No cached rendering state to clear.
  }

  render(width: number): string[] {
    return fitLinesToWidth(this.renderStep(width), width);
  }

  private renderStep(width: number): string[] {
    switch (this.state.step) {
      case "decision":
        return this.renderDecision(width);
      case "reason":
        return this.renderReason(width);
      case "scope":
        return this.renderScope();
    }
  }

  /**
   * The ask itself, bounded to the budget at this frame's width.
   *
   * Rendered per frame rather than once, because the row budget is a function
   * of the width the host gives us, which a resize changes.
   */
  private renderAsk(width: number): DialogView {
    return renderPromptDialog(
      this.payload,
      this.expanded ? completeViewBudget(width) : { ...this.budget, width },
      (text) => this.theme.fg("warning", text),
    );
  }

  /**
   * The key hints, naming the expansion only when it would do something.
   *
   * An affordance advertised when there is nothing to expand is noise; one
   * left unadvertised when the render dropped something is a decision made
   * without the evidence.
   */
  private hint(view: DialogView): string {
    const keys = [
      "↑/↓ move",
      "enter confirm",
      "esc deny",
      "press a letter, then again to confirm",
    ];
    if (this.expanded) {
      keys.push("ctrl+o collapse");
    } else if (view.elided) {
      keys.push("ctrl+o full request");
    }
    const pendingTimeoutMs = this.clock?.pendingTimeoutMs;
    if (pendingTimeoutMs !== undefined) {
      keys.push(`unanswered, denies in ${pendingTimeoutMs / 1000}s`);
    }
    return this.theme.fg("muted", keys.join(" · "));
  }

  handleInput(data: string): void {
    this.engageClock();
    if (this.state.step === "reason") {
      this.handleReasonInput(data);
      return;
    }
    if (this.handleAppAction(data)) {
      // One "expand" for the operator: the host expands its pending tool call
      // and the dialog expands its own render, on the same keystroke.
      this.expanded = !this.expanded;
      this.requestRender();
      return;
    }
    const event = this.toEvent(data);
    if (event) {
      this.apply(event);
    }
  }

  /**
   * Stop the answer window on the human's first keystroke.
   *
   * The window bounds a prompt nobody is attending to; a keystroke proves
   * someone is, so the dialog waits for them to finish rather than vanishing
   * mid-answer. Re-renders so the hint stops advertising a deadline.
   */
  private engageClock(): void {
    if (this.clock?.pendingTimeoutMs === undefined) {
      return;
    }
    this.clock.engage();
    this.requestRender();
  }

  /**
   * Hand the keystroke to the framework line editor.
   *
   * Delegating is what makes the field accept a paste: a paste arrives as one
   * multi-character chunk wrapped in bracketed-paste markers, which the editor
   * understands and a per-character reader cannot. Submit and cancel come back
   * through the editor's callbacks, so the decision model still owns them.
   */
  private handleReasonInput(data: string): void {
    this.reason.handleInput(collapsePastedNewlines(data));
    // The editor mutates its own buffer silently; only the dialog can repaint.
    this.requestRender();
  }

  private toEvent(data: string): PromptEvent | undefined {
    if (matchesKey(data, "up") || matchesKey(data, "k")) {
      return { type: "nav", direction: "up" };
    }
    if (matchesKey(data, "down") || matchesKey(data, "j")) {
      return { type: "nav", direction: "down" };
    }
    if (matchesKey(data, "enter")) {
      return { type: "confirm" };
    }
    if (matchesKey(data, "escape")) {
      return { type: "cancel" };
    }
    if (this.state.step === "decision") {
      const action = visibleActions(this.config).find((option) =>
        matchesKey(data, this.boundKey(option)),
      );
      if (action) {
        return { type: "hotkey", action };
      }
    }
    return undefined;
  }

  private apply(event: PromptEvent): void {
    const outcome = reducePrompt(this.config, this.state, event);
    if (outcome.kind === "decision") {
      this.done(outcome.decision);
      return;
    }
    if (outcome.state.step === "reason" && this.state.step !== "reason") {
      this.reason = this.createReasonEditor();
    }
    this.state = outcome.state;
    this.requestRender();
  }

  private renderDecision(width: number): string[] {
    const ask = this.renderAsk(width);
    const lines = [this.theme.fg("accent", this.title), ...ask.lines, ""];
    for (const action of visibleActions(this.config)) {
      const label = this.labelFor(action);
      const selected = this.state.highlightedAction === action;
      const marker = selected ? "▶" : " ";
      const row = `${marker} (${this.boundKey(action)}) ${label}`;
      lines.push(selected ? this.theme.fg("accent", row) : row);
    }
    lines.push("");
    lines.push(this.state.hint || this.hint(ask));
    return lines;
  }

  /**
   * The character that selects an option, as a key identifier.
   *
   * The cast is total by construction: a binding is one printable character,
   * which is exactly what pi-tui's matcher accepts as a `KeyId`.
   */
  private boundKey(action: PromptAction): KeyId {
    return this.config.keys[action] as KeyId;
  }

  /**
   * The row label for a key: the two session options carry ask-supplied text
   * naming what they grant, and the rest are fixed.
   */
  private labelFor(action: PromptAction): string {
    if (action === "approveSession") return this.config.sessionLabel;
    if (action === "approveSessionBoth") {
      return this.config.widthLabel ?? OPTION_LABELS.approveSessionBoth;
    }
    return OPTION_LABELS[action];
  }

  private renderReason(width: number): string[] {
    const lines = [
      this.theme.fg("accent", this.title),
      ...this.renderAsk(width).lines,
      "",
      "Reason (required):",
      // Exactly one row, whatever its length: the editor scrolls horizontally.
      ...this.reason.render(width),
    ];
    if (this.state.reasonError) {
      lines.push(this.theme.fg("error", this.state.reasonError));
    }
    lines.push("");
    lines.push(this.theme.fg("muted", "enter submit · esc back"));
    return lines;
  }

  private renderScope(): string[] {
    const scope = this.config.sessionScope;
    const subagentLabel = scope?.subagentLabel ?? "This subagent only";
    const servingLabel = scope?.servingSessionLabel ?? "The whole session";
    const rows: Array<{ label: string; serving: boolean }> = [
      { label: subagentLabel, serving: false },
      { label: servingLabel, serving: true },
    ];
    const lines = [
      this.theme.fg("accent", this.title),
      "Apply this session grant to:",
      "",
    ];
    for (const row of rows) {
      const selected = this.state.scopeServing === row.serving;
      const marker = selected ? "▶" : " ";
      const text = `${marker} ${row.label}`;
      lines.push(selected ? this.theme.fg("accent", text) : text);
    }
    lines.push("");
    lines.push(this.theme.fg("muted", "↑/↓ move · enter confirm · esc back"));
    return lines;
  }
}
