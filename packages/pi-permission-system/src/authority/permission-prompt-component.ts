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
import type { InteractivePermissionChoice } from "#src/authority/interactive-permission-choice";
import {
  type RequestPermissionOptions,
  requestPermissionDecisionFromUi,
} from "#src/authority/permission-dialog";
import {
  initialPromptState,
  type PromptEvent,
  type PromptKey,
  type PromptModelConfig,
  type PromptViewState,
  promptKeys,
  reducePrompt,
} from "#src/authority/permission-prompt-decision";

/** Inline `ctx.ui.custom` permission dialog for TUI sessions. */

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
  showPersistenceSummary: boolean;
  /** Persist a changed summary preference; false leaves the current value unchanged. */
  setShowPersistenceSummary?(enabled: boolean): boolean;
}

/** Live prompt-behavior preferences read at prompt time. */
export interface PromptPreferences {
  doublePressToConfirm: boolean;
  showPersistenceSummary: boolean;
}

/**
 * Route TUI asks to the inline keybind dialog and non-TUI asks to the SDK
 * select/input flow. Both presenters expose the same durable choices.
 */
export function requestPermissionDecision(
  view: PermissionPromptView,
  title: string,
  message: string,
  options?: RequestPermissionOptions,
): Promise<InteractivePermissionChoice> {
  if (view.mode === "tui") {
    return presentInlinePermissionPrompt(view, title, message, options);
  }
  return requestPermissionDecisionFromUi(
    view.ui,
    title,
    message,
    options,
    view.showPersistenceSummary,
  );
}

/** Minimal theme surface the dialog uses; satisfied by the real SDK theme. */
interface PromptTheme {
  fg(color: string, text: string): string;
}

const DEFAULT_SESSION_LABEL = "Yes, for this session";

const OPTION_LABELS: Record<PromptKey, string> = {
  y: "Yes",
  s: DEFAULT_SESSION_LABEL,
  e: "Edit proposed pattern(s)",
  p: "Persist for this project",
  g: "Persist globally",
  n: "No",
  r: "No, provide reason",
};

export function presentInlinePermissionPrompt(
  view: PermissionPromptView,
  title: string,
  message: string,
  options?: RequestPermissionOptions,
): Promise<InteractivePermissionChoice> {
  const config: PromptModelConfig = {
    doublePressToConfirm: view.doublePressToConfirm,
    sessionLabel: options?.sessionLabel ?? DEFAULT_SESSION_LABEL,
    showPersistenceSummary: view.showPersistenceSummary,
    sessionScope: options?.sessionScope,
    persistent: options?.persistent,
  };
  return view.ui.custom<InteractivePermissionChoice>(
    (tui, theme, keybindings, done) =>
      new PermissionPromptComponent(
        theme,
        config,
        title,
        message,
        (data) => handleToolsExpandAction(data, keybindings, view.ui),
        view.setShowPersistenceSummary
          ? (enabled) => view.setShowPersistenceSummary?.(enabled) ?? false
          : undefined,
        () => {
          tui.requestRender();
        },
        done,
      ),
    { overlay: false },
  );
}

/** Forward Pi's tool-expansion action while the dialog owns keyboard focus. */
function handleToolsExpandAction(
  data: string,
  keybindings: PromptKeybindings,
  ui: PermissionPromptUi,
): boolean {
  if (!keybindings.matches(data, "app.tools.expand")) return false;
  ui.setToolsExpanded(!ui.getToolsExpanded());
  return true;
}

class PermissionPromptComponent implements Component {
  private state: PromptViewState;
  private reasonBuffer = "";
  private editBuffer = "";
  private persistenceSummaryRendered = false;

  constructor(
    private readonly theme: PromptTheme,
    private config: PromptModelConfig,
    private readonly title: string,
    private readonly message: string,
    private readonly handleAppAction: (data: string) => boolean,
    private readonly setShowPersistenceSummary:
      | ((enabled: boolean) => boolean)
      | undefined,
    private readonly requestRender: () => void,
    private readonly done: (decision: InteractivePermissionChoice) => void,
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
      case "edit":
        return this.renderEdit();
      case "persistent-confirm":
        this.persistenceSummaryRendered = true;
        return this.renderPersistenceConfirmation();
    }
  }

  handleInput(data: string): void {
    if (this.state.step === "reason") {
      this.handleTextInput(data, "reason");
      return;
    }
    if (this.state.step === "edit") {
      this.handleTextInput(data, "edit");
      return;
    }
    if (
      this.config.persistent &&
      (this.state.step === "decision" ||
        this.state.step === "persistent-confirm") &&
      matchesKey(data, "t")
    ) {
      this.togglePersistenceSummary();
      return;
    }
    if (this.handleAppAction(data)) return;
    if (
      this.state.step === "persistent-confirm" &&
      matchesKey(data, "enter") &&
      !this.persistenceSummaryRendered
    ) {
      this.requestRender();
      return;
    }
    const event = this.toEvent(data);
    if (event) this.apply(event);
  }

  private handleTextInput(data: string, mode: "reason" | "edit"): void {
    if (matchesKey(data, "enter")) {
      const event: PromptEvent =
        mode === "reason"
          ? { type: "submitReason", draft: this.reasonBuffer }
          : { type: "submitEdit", draft: this.editBuffer };
      this.apply(event);
      return;
    }
    if (matchesKey(data, "escape")) {
      this.clearBuffer(mode);
      this.apply({ type: "cancel" });
      return;
    }
    if (matchesKey(data, "backspace")) {
      this.setBuffer(mode, this.getBuffer(mode).slice(0, -1));
      this.requestRender();
      return;
    }
    if (data === "\u0015") {
      this.setBuffer(mode, "");
      this.requestRender();
      return;
    }
    if (isPrintable(data)) {
      this.setBuffer(mode, this.getBuffer(mode) + data);
      this.requestRender();
    }
  }

  private getBuffer(mode: "reason" | "edit"): string {
    return mode === "reason" ? this.reasonBuffer : this.editBuffer;
  }

  private setBuffer(mode: "reason" | "edit", value: string): void {
    if (mode === "reason") this.reasonBuffer = value;
    else this.editBuffer = value;
  }

  private clearBuffer(mode: "reason" | "edit"): void {
    this.setBuffer(mode, "");
  }

  private toEvent(data: string): PromptEvent | undefined {
    if (matchesKey(data, "up") || matchesKey(data, "k")) {
      return { type: "nav", direction: "up" };
    }
    if (matchesKey(data, "down") || matchesKey(data, "j")) {
      return { type: "nav", direction: "down" };
    }
    if (matchesKey(data, "enter")) return { type: "confirm" };
    if (matchesKey(data, "escape")) return { type: "cancel" };
    if (this.state.step === "decision") {
      const key = promptKeys(this.config).find((option) =>
        matchesKey(data, option),
      );
      if (key) return { type: "hotkey", key };
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
    if (
      this.state.step === "persistent-confirm" &&
      previous.step !== "persistent-confirm"
    ) {
      this.persistenceSummaryRendered = false;
    }
    this.syncBuffers(previous);
    this.requestRender();
  }

  private syncBuffers(previous: PromptViewState): void {
    if (this.state.step === "reason" && previous.step !== "reason") {
      this.reasonBuffer = "";
    }
    if (
      this.state.step === "edit" &&
      (previous.step !== "edit" || previous.editIndex !== this.state.editIndex)
    ) {
      this.editBuffer =
        this.state.editPatterns?.[this.state.editIndex ?? 0] ?? "";
    }
  }

  private togglePersistenceSummary(): void {
    const enabled = !this.config.showPersistenceSummary;
    if (
      this.setShowPersistenceSummary &&
      !this.setShowPersistenceSummary(enabled)
    ) {
      return;
    }
    this.config = { ...this.config, showPersistenceSummary: enabled };
    this.requestRender();
  }

  private renderDecision(): string[] {
    const lines = [this.theme.fg("accent", this.title), this.message, ""];
    for (const key of promptKeys(this.config)) {
      const label = key === "s" ? this.config.sessionLabel : OPTION_LABELS[key];
      const selected = this.state.highlightedKey === key;
      const marker = selected ? "▶" : " ";
      const row = `${marker} (${key}) ${label}`;
      lines.push(selected ? this.theme.fg("accent", row) : row);
    }
    if (this.config.persistent) {
      lines.push(
        "",
        `  (t) ${this.config.showPersistenceSummary ? "[x]" : "[ ]"} Show summary before saving`,
      );
    }
    lines.push("");
    lines.push(
      this.state.hint ||
        this.theme.fg(
          "muted",
          "↑/↓ or j/k move · enter confirm · esc deny · press a letter, then again to confirm",
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
    lines.push(
      "",
      this.theme.fg("muted", "enter submit · ctrl+u clear · esc back"),
    );
    return lines;
  }

  private renderScope(): string[] {
    const scope = this.config.sessionScope;
    const rows: Array<{ label: string; serving: boolean }> = [
      { label: scope?.subagentLabel ?? "This subagent only", serving: false },
      {
        label: scope?.servingSessionLabel ?? "The whole session",
        serving: true,
      },
    ];
    const lines = [
      this.theme.fg("accent", this.title),
      "Apply this session grant to:",
      "",
    ];
    for (const row of rows) {
      const selected = this.state.scopeServing === row.serving;
      const text = `${selected ? "▶" : " "} ${row.label}`;
      lines.push(selected ? this.theme.fg("accent", text) : text);
    }
    lines.push(
      "",
      this.theme.fg("muted", "↑/↓ or j/k move · enter confirm · esc back"),
    );
    return lines;
  }

  private renderEdit(): string[] {
    const proposal = this.state.proposal;
    const count = this.state.editPatterns?.length ?? 0;
    const editIndex = this.state.editIndex ?? 0;
    const lines = [
      this.theme.fg("accent", this.title),
      `Edit ${proposal?.surface ?? "permission"} pattern ${editIndex + 1}/${count}:`,
      "",
      `Pattern: ${this.editBuffer}\u2588`,
    ];
    if (this.state.editError) {
      lines.push(this.theme.fg("error", this.state.editError));
    }
    lines.push(
      "",
      this.theme.fg(
        "muted",
        "enter accept · backspace edit · ctrl+u clear · esc back",
      ),
    );
    return lines;
  }

  private renderPersistenceConfirmation(): string[] {
    const target = this.state.persistenceTarget;
    const proposal = this.state.proposal;
    const lines = [
      this.theme.fg("accent", this.title),
      `Scope: ${target?.scope === "project" ? "project-local" : "global"}`,
      `Surface: ${proposal?.surface ?? "unknown"}`,
      "Patterns:",
      ...(proposal?.patterns.map((pattern) => `  - ${pattern}`) ?? []),
      "Action: allow",
      `File: ${target?.path ?? "unknown"}`,
      "",
      `  (t) ${this.config.showPersistenceSummary ? "[x]" : "[ ]"} Show summary before saving`,
      "",
      this.theme.fg("muted", "enter save · t toggle · esc back"),
    ];
    return lines;
  }
}

/** Fit every rendered line to the terminal width. */
function fitToWidth(lines: string[], width: number): string[] {
  if (width <= 0) return [];
  return lines.flatMap((line) =>
    wrapTextWithAnsi(line, width).map((wrapped) =>
      truncateToWidth(wrapped, width),
    ),
  );
}

function isPrintable(data: string): boolean {
  if (data.length !== 1) return false;
  const code = data.charCodeAt(0);
  return code >= 0x20 && code !== 0x7f;
}
