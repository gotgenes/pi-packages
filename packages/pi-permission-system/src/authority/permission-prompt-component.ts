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
import {
  type DialogKeyBindings,
  type PromptAction,
  TOGGLE_SUMMARY_KEY,
} from "#src/config/dialog-keys";
import {
  completeViewBudget,
  type DialogView,
  type RenderBudget,
  renderPromptDialog,
} from "#src/presentation/dialog-renderer";
import { fitLinesToWidth } from "#src/presentation/line-fitting";
import type { PromptPayload } from "#src/presentation/prompt-payload";
import { collapsePastedNewlines } from "./bracketed-paste";
import type { DecisionSource, UserDecisionSurface } from "./decision-source";
import type {
  InteractivePermissionChoice,
  UnattributedChoice,
} from "./interactive-permission-choice";
import {
  type RequestPermissionOptions,
  renderPersistenceSummary,
  requestPermissionDecisionFromUi,
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
 * with the committed {@link UnattributedChoice}. The component renders inline
 * (never as an overlay).
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
  /**
   * Persist a changed summary preference; returns false when the write failed
   * and the dialog should keep showing the old value. Absent when the session
   * cannot persist preferences.
   */
  setShowPersistenceSummary?: (enabled: boolean) => boolean;
}

/** Live prompt-behavior preferences read at prompt time (see `doublePressToConfirm`). */
export interface PromptPreferences {
  doublePressToConfirm: boolean;
  /** Show the exact durable rule and destination before saving it. */
  showPersistenceSummary: boolean;
  /** How much room a render has; the terminal width is added per frame. */
  budget: RenderBudget;
  /** The character bound to each decision. */
  dialogKeys: DialogKeyBindings;
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
 */
export async function requestPermissionDecision(
  view: PermissionPromptView,
  title: string,
  payload: PromptPayload,
  options?: RequestPermissionOptions,
): Promise<InteractivePermissionChoice> {
  if (view.mode === "tui") {
    return attributeToHuman(
      await presentInlinePermissionPrompt(view, title, payload, options),
      "dialog",
    );
  }
  // The fallback renders once and cannot re-render, so it neither paints nor
  // offers an expansion; it substitutes a nominal width for the terminal size
  // it is never told, and the host's own select wraps from there.
  const rendered = renderPromptDialog(payload, {
    ...view.budget,
    width: FALLBACK_RENDER_WIDTH,
  });
  return attributeToHuman(
    await requestPermissionDecisionFromUi(
      view.ui,
      title,
      rendered.lines.join("\n"),
      options,
      view.showPersistenceSummary,
    ),
    "select",
  );
}

function attributeToHuman(
  choice: UnattributedChoice,
  via: UserDecisionSurface,
): InteractivePermissionChoice {
  const decidedBy: DecisionSource = { kind: "user", via };
  return { ...choice, decidedBy };
}

/** The width the `select`/`input` fallback renders against. */
const FALLBACK_RENDER_WIDTH = 80;

/** The End key, as the terminal sends it. */
const END_KEY = "\u001b[F";

/** Minimal theme surface the dialog uses; satisfied by the real SDK theme. */
interface PromptTheme {
  fg(color: string, text: string): string;
}

const DEFAULT_SESSION_LABEL = "Yes, for this session";

const OPTION_LABELS: Record<PromptAction, string> = {
  approve: "Yes",
  approveSession: DEFAULT_SESSION_LABEL,
  approveSessionBoth: "Yes, for this session in both directions",
  editPatterns: "Edit proposed pattern(s)",
  persistProject: "Persist for this project",
  persistGlobal: "Persist globally",
  deny: "No",
  denyWithReason: "No, provide reason",
};

export function presentInlinePermissionPrompt(
  view: PermissionPromptView,
  title: string,
  payload: PromptPayload,
  options?: RequestPermissionOptions,
): Promise<UnattributedChoice> {
  const config: PromptModelConfig = {
    doublePressToConfirm: view.doublePressToConfirm,
    sessionLabel: options?.sessionLabel ?? DEFAULT_SESSION_LABEL,
    widthLabel: options?.sessionWidth?.label,
    sessionScope: options?.sessionScope,
    keys: view.dialogKeys,
    showPersistenceSummary: view.showPersistenceSummary,
    persistent: options?.persistent,
  };
  return view.ui.custom<UnattributedChoice>(
    (tui, theme, keybindings, done) =>
      new PermissionPromptComponent(
        theme,
        config,
        title,
        payload,
        view.budget,
        (data) => handleToolsExpandAction(data, keybindings, view.ui),
        view.setShowPersistenceSummary,
        () => {
          tui.requestRender();
        },
        done,
      ),
    { overlay: false },
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
  /** The pattern line editor, rebuilt for each grant the edit step visits. */
  private patternEditor: Input;
  /** Whether the operator asked to see the complete request (ADR 0011 §4). */
  private expanded = false;
  /**
   * Whether the durable summary has been painted since the step was entered.
   *
   * A confirm before the first paint is ignored: the summary exists so the
   * human sees exactly what will be written, and a keystroke that raced the
   * render saw nothing.
   */
  private summaryRendered = false;

  constructor(
    private readonly theme: PromptTheme,
    private config: PromptModelConfig,
    private readonly title: string,
    private readonly payload: PromptPayload,
    private readonly budget: RenderBudget,
    private readonly handleAppAction: (data: string) => boolean,
    private readonly setShowPersistenceSummary:
      | ((enabled: boolean) => boolean)
      | undefined,
    private readonly requestRender: () => void,
    private readonly done: (choice: UnattributedChoice) => void,
  ) {
    this.state = initialPromptState(config);
    this.reason = this.createReasonEditor();
    this.patternEditor = this.createPatternEditor("");
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

  /** A fresh editor per pattern, prefilled with the pattern as proposed. */
  private createPatternEditor(initial: string): Input {
    const editor = new Input();
    editor.focused = true;
    editor.setValue(initial);
    // `setValue` leaves the cursor where it was (the start of a fresh editor);
    // editing a proposed pattern almost always means appending to it.
    editor.handleInput(END_KEY);
    editor.onSubmit = (draft) => {
      this.apply({ type: "submitEdit", draft });
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
      case "edit":
        return this.renderEdit(width);
      case "persistent-confirm":
        this.summaryRendered = true;
        return this.renderPersistenceConfirmation();
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
    return this.theme.fg("muted", keys.join(" · "));
  }

  handleInput(data: string): void {
    if (this.state.step === "reason") {
      this.handleEditorInput(this.reason, data);
      return;
    }
    if (this.state.step === "edit") {
      this.handleEditorInput(this.patternEditor, data);
      return;
    }
    if (this.offersToggle() && matchesKey(data, TOGGLE_SUMMARY_KEY)) {
      this.togglePersistenceSummary();
      return;
    }
    if (this.handleAppAction(data)) {
      // One "expand" for the operator: the host expands its pending tool call
      // and the dialog expands its own render, on the same keystroke.
      this.expanded = !this.expanded;
      this.requestRender();
      return;
    }
    if (
      this.state.step === "persistent-confirm" &&
      matchesKey(data, "enter") &&
      !this.summaryRendered
    ) {
      this.requestRender();
      return;
    }
    const event = this.toEvent(data);
    if (event) {
      this.apply(event);
    }
  }

  /** The toggle is live only where the preference has something to govern. */
  private offersToggle(): boolean {
    return (
      this.config.persistent !== undefined &&
      (this.state.step === "decision" ||
        this.state.step === "persistent-confirm")
    );
  }

  /**
   * Hand the keystroke to a framework line editor.
   *
   * Delegating is what makes the field accept a paste: a paste arrives as one
   * multi-character chunk wrapped in bracketed-paste markers, which the editor
   * understands and a per-character reader cannot. Submit and cancel come back
   * through the editor's callbacks, so the decision model still owns them.
   */
  private handleEditorInput(editor: Input, data: string): void {
    editor.handleInput(collapsePastedNewlines(data));
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
    const previous = this.state;
    const outcome = reducePrompt(this.config, this.state, event);
    if (outcome.kind === "decision") {
      this.done(outcome.decision);
      return;
    }
    this.state = outcome.state;
    this.syncEditors(previous);
    this.requestRender();
  }

  /** Rebuild whichever editor a step transition (or edit advance) entered. */
  private syncEditors(previous: PromptViewState): void {
    if (this.state.step === "reason" && previous.step !== "reason") {
      this.reason = this.createReasonEditor();
    }
    if (
      this.state.step === "edit" &&
      (previous.step !== "edit" || previous.editIndex !== this.state.editIndex)
    ) {
      this.patternEditor = this.createPatternEditor(
        this.state.editPatterns?.[this.state.editIndex ?? 0] ?? "",
      );
    }
    if (
      this.state.step === "persistent-confirm" &&
      previous.step !== "persistent-confirm"
    ) {
      this.summaryRendered = false;
    }
  }

  private togglePersistenceSummary(): void {
    const enabled = !this.config.showPersistenceSummary;
    // A failed write keeps the old value on screen, so what the dialog shows
    // and what the next prompt will do never disagree.
    if (this.setShowPersistenceSummary?.(enabled) === false) {
      return;
    }
    this.config = { ...this.config, showPersistenceSummary: enabled };
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
    if (this.config.persistent) {
      lines.push("", this.renderToggleRow());
    }
    lines.push("");
    lines.push(this.state.hint || this.hint(ask));
    return lines;
  }

  private renderToggleRow(): string {
    const box = this.config.showPersistenceSummary ? "[x]" : "[ ]";
    return `  ${box} Show summary before saving (${TOGGLE_SUMMARY_KEY})`;
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

  private renderEdit(width: number): string[] {
    const grants = this.state.proposal?.grants ?? [];
    const editIndex = this.state.editIndex ?? 0;
    const surface = grants[editIndex]?.surface ?? "permission";
    const lines = [
      this.theme.fg("accent", this.title),
      `Edit ${surface} pattern ${editIndex + 1}/${grants.length}:`,
      "",
      // Exactly one row, whatever its length: the editor scrolls horizontally.
      ...this.patternEditor.render(width),
    ];
    if (this.state.editError) {
      lines.push(this.theme.fg("error", this.state.editError));
    }
    lines.push("");
    lines.push(this.theme.fg("muted", "enter accept · esc back"));
    return lines;
  }

  private renderPersistenceConfirmation(): string[] {
    const target = this.state.persistenceTarget;
    const proposal = this.state.proposal;
    const summary =
      target && proposal ? renderPersistenceSummary(proposal, target) : [];
    return [
      this.theme.fg("accent", this.title),
      ...summary,
      "",
      this.renderToggleRow(),
      "",
      this.theme.fg(
        "muted",
        `enter save · ${TOGGLE_SUMMARY_KEY} toggle summary · esc back`,
      ),
    ];
  }
}
