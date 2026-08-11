import type {
  ExtensionContext,
  ExtensionUIContext,
  KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  matchesKey,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import {
  type PermissionPromptDecision,
  type RequestPermissionOptions,
  requestPermissionDecisionFromUi,
} from "#src/authority/permission-dialog";
import {
  initialPromptState,
  type PromptEvent,
  type PromptKey,
  type PromptModelConfig,
  type PromptViewState,
  reducePrompt,
} from "#src/authority/permission-prompt-decision";

/**
 * Inline `ctx.ui.custom` permission dialog for TUI sessions.
 *
 * All interaction logic lives in the pure {@link reducePrompt} model; this
 * module is the thin adapter that renders the model's state to lines, maps raw
 * keystrokes to {@link PromptEvent}s, and resolves the `ctx.ui.custom` promise
 * with the committed {@link PermissionPromptDecision}. The component renders
 * inline (never as an overlay).
 */

/** The subset of the session UI surface the inline dialog needs. */
export type PermissionPromptUi = Pick<
  ExtensionUIContext,
  "select" | "input" | "custom" | "getToolsExpanded" | "setToolsExpanded"
>;

/** The keybindings surface the dialog consults; only `matches` is read (ISP). */
type PromptKeybindings = Pick<KeybindingsManager, "matches">;

/** The resolved presentation context selected once per activation. */
export interface PermissionPromptView {
  mode: ExtensionContext["mode"];
  ui: PermissionPromptUi;
  doublePressToConfirm: boolean;
}

/** Live prompt-behavior preferences read at prompt time (see `doublePressToConfirm`). */
export interface PromptPreferences {
  doublePressToConfirm: boolean;
}

/**
 * Route a permission ask to the inline keybind dialog in TUI mode, or the
 * `select()`/`input()` flow otherwise (RPC / frontend — the #519 constraint).
 *
 * The single entry the `LocalUserAuthorizer` calls; keeps the mode dispatch in
 * one place so the fallback and the inline component never both render.
 */
export function requestPermissionDecision(
  view: PermissionPromptView,
  title: string,
  message: string,
  options?: RequestPermissionOptions,
): Promise<PermissionPromptDecision> {
  if (view.mode === "tui") {
    return presentInlinePermissionPrompt(view, title, message, options);
  }
  return requestPermissionDecisionFromUi(view.ui, title, message, options);
}

/** Minimal theme surface the dialog uses; satisfied by the real SDK theme. */
interface PromptTheme {
  fg(color: string, text: string): string;
}

const DEFAULT_SESSION_LABEL = "Yes, for this session";

const OPTION_LABELS: Record<PromptKey, string> = {
  y: "Yes",
  s: DEFAULT_SESSION_LABEL,
  n: "No",
  r: "No, provide reason",
};

const OPTION_ORDER: readonly PromptKey[] = ["y", "s", "n", "r"];

export function presentInlinePermissionPrompt(
  view: PermissionPromptView,
  title: string,
  message: string,
  options?: RequestPermissionOptions,
): Promise<PermissionPromptDecision> {
  const config: PromptModelConfig = {
    doublePressToConfirm: view.doublePressToConfirm,
    sessionLabel: options?.sessionLabel ?? DEFAULT_SESSION_LABEL,
    sessionScope: options?.sessionScope,
  };
  return view.ui.custom<PermissionPromptDecision>(
    (tui, theme, keybindings, done) =>
      new PermissionPromptComponent(
        theme,
        config,
        title,
        message,
        (data) => handleToolsExpandAction(data, keybindings, view.ui),
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
  private reasonBuffer = "";

  constructor(
    private readonly theme: PromptTheme,
    private readonly config: PromptModelConfig,
    private readonly title: string,
    private readonly message: string,
    private readonly handleAppAction: (data: string) => boolean,
    private readonly requestRender: () => void,
    private readonly done: (decision: PermissionPromptDecision) => void,
  ) {
    this.state = initialPromptState(config);
  }

  invalidate(): void {
    // No cached rendering state to clear.
  }

  render(width: number): string[] {
    return fitToWidth(this.renderStep(), width);
  }

  private renderStep(): string[] {
    switch (this.state.step) {
      case "decision":
        return this.renderDecision();
      case "reason":
        return this.renderReason();
      case "scope":
        return this.renderScope();
    }
  }

  handleInput(data: string): void {
    if (this.state.step === "reason") {
      this.handleReasonInput(data);
      return;
    }
    if (this.handleAppAction(data)) {
      return;
    }
    const event = this.toEvent(data);
    if (event) {
      this.apply(event);
    }
  }

  private handleReasonInput(data: string): void {
    if (matchesKey(data, "enter")) {
      this.apply({ type: "submitReason", draft: this.reasonBuffer });
      return;
    }
    if (matchesKey(data, "escape")) {
      this.reasonBuffer = "";
      this.apply({ type: "cancel" });
      return;
    }
    if (matchesKey(data, "backspace")) {
      this.reasonBuffer = this.reasonBuffer.slice(0, -1);
      this.requestRender();
      return;
    }
    if (isPrintable(data)) {
      this.reasonBuffer += data;
      this.requestRender();
    }
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
      const key = OPTION_ORDER.find((option) => matchesKey(data, option));
      if (key) {
        return { type: "hotkey", key };
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
      this.reasonBuffer = "";
    }
    this.state = outcome.state;
    this.requestRender();
  }

  private renderDecision(): string[] {
    const lines = [this.theme.fg("accent", this.title), ""];
    // Render each line with contextual color:
    // - lines with ⚠️  → warning color
    // - "key : value" label lines → key in muted, value in text
    // - empty lines → as-is
    for (const line of this.message.split("\n")) {
      if (line.includes("⚠️")) {
        lines.push(this.theme.fg("warning", line));
      } else if (line.includes(" : ")) {
        const colonIdx = line.indexOf(" : ");
        const label = line.slice(0, colonIdx);
        const value = line.slice(colonIdx + 3);
        lines.push(
          this.theme.fg("muted", label) + this.theme.fg("muted", " : ") + value,
        );
      } else {
        lines.push(line);
      }
    }
    lines.push("");
    for (const key of OPTION_ORDER) {
      const label = key === "s" ? this.config.sessionLabel : OPTION_LABELS[key];
      const selected = this.state.highlightedKey === key;
      const marker = selected ? "▶" : " ";
      const row = `${marker} (${key}) ${label}`;
      lines.push(selected ? this.theme.fg("accent", row) : row);
    }
    lines.push("");
    lines.push(
      this.state.hint ||
        this.theme.fg(
          "muted",
          "↑/↓ move · enter confirm · esc deny · press a letter, then again to confirm",
        ),
    );
    return lines;
  }

  private renderReason(): string[] {
    const lines = [
      this.theme.fg("accent", this.title),
      this.message,
      "",
      `Reason (required): ${this.reasonBuffer}\u2588`,
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

/**
 * Fit rendered lines to the terminal width, satisfying the `ctx.ui.custom`
 * contract that every returned line be a single visual row no wider than
 * `width`. Long lines (e.g. a wide tool-preview message) are wrapped rather
 * than clipped so no content is lost; the final `truncateToWidth` guards the
 * edge cases `wrapTextWithAnsi` cannot split (a lone wide grapheme).
 */
function fitToWidth(lines: string[], width: number): string[] {
  if (width <= 0) {
    return [];
  }
  return lines.flatMap((line) =>
    wrapTextWithAnsi(line, width).map((wrapped) =>
      truncateToWidth(wrapped, width),
    ),
  );
}

function isPrintable(data: string): boolean {
  if (data.length !== 1) {
    return false;
  }
  const code = data.charCodeAt(0);
  return code >= 0x20 && code !== 0x7f;
}
