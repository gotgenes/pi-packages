// ---- Narrow interfaces ----

/** The toast a settings mutation returns for the UI to display. */
export interface SettingsToast {
  message: string;
  level: "info" | "warning";
}

/** Narrow settings interface required by the subagents:settings command. */
export interface SubagentsSettingsManager {
  readonly maxConcurrent: number;
  readonly defaultMaxTurns: number | undefined;
  readonly graceTurns: number;
  readonly consumedSessionRetentionMinutes: number;
  readonly unconsumedSessionRetentionMinutes: number;
  readonly abortAllOnInterrupt: boolean;
  readonly midRunUpdates: boolean;
  applyMaxConcurrent(n: number): SettingsToast;
  applyDefaultMaxTurns(n: number): SettingsToast;
  applyGraceTurns(n: number): SettingsToast;
  applyConsumedSessionRetentionMinutes(n: number): SettingsToast;
  applyUnconsumedSessionRetentionMinutes(n: number): SettingsToast;
  toggleAbortAllOnInterrupt(): SettingsToast;
  toggleMidRunUpdates(): SettingsToast;
}

/** Narrow UI interface — only the ctx.ui methods the settings handler calls. */
export interface SubagentsSettingsUI {
  select(title: string, options: string[]): Promise<string | undefined>;
  input(title: string, defaultValue?: string): Promise<string | undefined>;
  notify(message: string, level: "info" | "warning" | "error"): void;
}

// ---- Descriptor table ----

/** Fields every setting needs to render its line in the select list. */
interface SettingDescriptorBase {
  /** Prefix used both to build the select option and to match the user's choice. */
  label: string;
  /** Current value rendered in the select option (e.g. "unlimited" for an unset default). */
  currentDisplay: (settings: SubagentsSettingsManager) => string | number;
}

/** Describes one numeric setting's prompt, validation, and apply behavior. */
interface NumericSettingDescriptor extends SettingDescriptorBase {
  kind: "numeric";
  /** Title shown on the input prompt. */
  inputTitle: string;
  /** Value pre-filled into the input box. */
  inputDefault: (settings: SubagentsSettingsManager) => string;
  /** Minimum accepted integer, inclusive. */
  minimum: number;
  /** Warning shown when the parsed value is below the minimum. */
  validationMessage: string;
  /** Applies the validated value and returns the toast to display. */
  apply: (settings: SubagentsSettingsManager, n: number) => SettingsToast;
}

/** Describes one boolean setting, flipped directly from the select list. */
interface ToggleSettingDescriptor extends SettingDescriptorBase {
  kind: "toggle";
  /** Flips the setting and returns the toast to display. */
  toggle: (settings: SubagentsSettingsManager) => SettingsToast;
}

type SettingDescriptor = NumericSettingDescriptor | ToggleSettingDescriptor;

const SETTINGS: readonly SettingDescriptor[] = [
  {
    kind: "numeric",
    label: "Max concurrency",
    currentDisplay: (settings) => settings.maxConcurrent,
    inputTitle: "Max concurrent background agents",
    inputDefault: (settings) => String(settings.maxConcurrent),
    minimum: 1,
    validationMessage: "Must be a positive integer.",
    apply: (settings, n) => settings.applyMaxConcurrent(n),
  },
  {
    kind: "numeric",
    label: "Default max turns",
    currentDisplay: (settings) => settings.defaultMaxTurns ?? "unlimited",
    inputTitle: "Default max turns before wrap-up (0 = unlimited)",
    inputDefault: (settings) => String(settings.defaultMaxTurns ?? 0),
    minimum: 0,
    validationMessage: "Must be 0 (unlimited) or a positive integer.",
    apply: (settings, n) => settings.applyDefaultMaxTurns(n),
  },
  {
    kind: "numeric",
    label: "Grace turns",
    currentDisplay: (settings) => settings.graceTurns,
    inputTitle: "Grace turns after wrap-up steer",
    inputDefault: (settings) => String(settings.graceTurns),
    minimum: 1,
    validationMessage: "Must be a positive integer.",
    apply: (settings, n) => settings.applyGraceTurns(n),
  },
  {
    kind: "numeric",
    label: "Consumed-session retention",
    currentDisplay: (settings) => `${settings.consumedSessionRetentionMinutes} min`,
    inputTitle: "Minutes to retain a consumed agent's session",
    inputDefault: (settings) => String(settings.consumedSessionRetentionMinutes),
    minimum: 1,
    validationMessage: "Must be a positive integer.",
    apply: (settings, n) => settings.applyConsumedSessionRetentionMinutes(n),
  },
  {
    kind: "numeric",
    label: "Unconsumed-session retention",
    currentDisplay: (settings) => `${settings.unconsumedSessionRetentionMinutes} min`,
    inputTitle: "Minutes to retain an unconsumed agent's session (safety cap)",
    inputDefault: (settings) => String(settings.unconsumedSessionRetentionMinutes),
    minimum: 1,
    validationMessage: "Must be a positive integer.",
    apply: (settings, n) => settings.applyUnconsumedSessionRetentionMinutes(n),
  },
  {
    kind: "toggle",
    label: "Abort all subagents on ESC",
    currentDisplay: (settings) => (settings.abortAllOnInterrupt ? "on" : "off"),
    toggle: (settings) => settings.toggleAbortAllOnInterrupt(),
  },
  {
    kind: "toggle",
    label: "Mid-run updates from background subagents",
    currentDisplay: (settings) => (settings.midRunUpdates ? "on" : "off"),
    toggle: (settings) => settings.toggleMidRunUpdates(),
  },
];

// ---- Class ----

/**
 * Handler for the `/subagents:settings` slash command.
 *
 * Call `handle({ ui })` from the Pi command registration to open the interactive
 * settings list. Lifted from `AgentsMenuHandler.showSettings`.
 */
export class SubagentsSettingsHandler {
  constructor(private readonly settings: SubagentsSettingsManager) {}

  async handle({ ui }: { ui: SubagentsSettingsUI }): Promise<void> {
    const options = SETTINGS.map(
      (d) => `${d.label} (current: ${d.currentDisplay(this.settings)})`,
    );
    const choice = await ui.select("Settings", options);
    if (!choice) return;

    const descriptor = SETTINGS.find((d) => choice.startsWith(d.label));
    if (!descriptor) return;

    if (descriptor.kind === "toggle") {
      const toast = descriptor.toggle(this.settings);
      ui.notify(toast.message, toast.level);
      return;
    }

    await this.promptNumeric(ui, descriptor);
  }

  /** Ask for a number, validate it against the descriptor, apply it, and notify. */
  private async promptNumeric(
    ui: SubagentsSettingsUI,
    descriptor: NumericSettingDescriptor,
  ): Promise<void> {
    const val = await ui.input(descriptor.inputTitle, descriptor.inputDefault(this.settings));
    if (!val) return;

    const n = parseInt(val, 10);
    if (n >= descriptor.minimum) {
      const toast = descriptor.apply(this.settings, n);
      ui.notify(toast.message, toast.level);
    } else {
      ui.notify(descriptor.validationMessage, "warning");
    }
  }
}
