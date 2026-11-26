import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  getSettingsListTheme,
} from "@earendil-works/pi-coding-agent";
import { type SettingItem, SettingsList } from "@earendil-works/pi-tui";
import type { Ruleset } from "#src/policy/rule";
import type { CommandConfigStore } from "./config-store";
import {
  DEFAULT_EXTENSION_CONFIG,
  isRuntimeKnob,
  RUNTIME_KNOB_KEYS,
  type RuntimeKnob,
  type RuntimeKnobValues,
  runtimeKnobValues,
} from "./extension-config";

/**
 * This session's auto-approve, as the modal drives it: on means this session's
 * own asks and every forwarded ask, off means none. In memory only; the modal
 * never writes it to a file (ADR 0016 §5).
 */
export interface SessionAutoApproveToggle {
  isActive(): boolean;
  /** The scopes that are on and what set each, for `show`. */
  describe(): string;
  setAll(on: boolean, ctx: ExtensionCommandContext): void;
}

interface PermissionSystemConfigController {
  config: CommandConfigStore;
  /** Precomputed global config file path. */
  configPath: string;
  /** Returns the composed config-layer ruleset for the active agent scope. */
  getActiveAgentConfigRules(): Ruleset;
  /** This session's auto-approve, shown and toggled beside the knobs. */
  autoApprove: SessionAutoApproveToggle;
}

/** The modal row for this session's auto-approve; not a config knob. */
const AUTO_APPROVE_ITEM = "autoApprove";

const ON_OFF = ["on", "off"];
const KNOB_PRESENTATION: Record<
  RuntimeKnob,
  { label: string; description: string }
> = {
  permissionReviewLog: {
    label: "Permission review log",
    description:
      "Write permission request and decision audit events to the extension logs directory",
  },
  debugLog: {
    label: "Debug logging",
    description:
      "Write verbose permission-system diagnostics to the extension logs directory",
  },
  doublePressToConfirm: {
    label: "Double-press to confirm",
    description:
      "Require a confirming second press of a decision hotkey in the inline TUI permission dialog",
  },
};
const COMMAND_ARGUMENTS = [
  {
    value: "show",
    label: "Show active settings",
    description: "Display the current permission-system config summary",
  },
  {
    value: "path",
    label: "Show config path",
    description: "Display the config.json path used by pi-permission-system",
  },
  {
    value: "reset",
    label: "Reset defaults",
    description:
      "Restore the default logging and dialog settings and persist them",
  },
  {
    value: "help",
    label: "Show help",
    description: "Display command usage",
  },
] as const;
const USAGE_TEXT =
  "Usage: /permission-system [show|path|reset|help] (or run /permission-system with no args to open settings modal)";

function defaultKnobValues(): RuntimeKnobValues {
  return runtimeKnobValues(DEFAULT_EXTENSION_CONFIG);
}

function toOnOff(value: boolean): string {
  return value ? "on" : "off";
}

function formatRulesSummary(rules: Ruleset): string {
  const configRules = rules.filter((r) => r.layer === "config" && r.origin);
  if (configRules.length === 0) return "";
  const formatted = configRules
    .map((r) => {
      const key =
        r.pattern === "*" ? r.surface : `${r.surface}["${r.pattern}"]`;
      return `${key}=${r.action} (${r.origin})`;
    })
    .join(", ");
  return `\n  rules: ${formatted}`;
}

function summarizeConfig(
  knobs: RuntimeKnobValues,
  autoApprove: SessionAutoApproveToggle,
  rules?: Ruleset,
): string {
  const knobSummary = RUNTIME_KNOB_KEYS.map(
    (id) => `${id}=${toOnOff(knobs[id])}`,
  ).join(", ");
  const rulesSuffix = rules ? formatRulesSummary(rules) : "";
  return `${knobSummary}, autoApprove=${autoApprove.describe()}${rulesSuffix}`;
}

function buildSettingItems(
  knobs: RuntimeKnobValues,
  autoApprove: SessionAutoApproveToggle,
): SettingItem[] {
  return [
    {
      id: AUTO_APPROVE_ITEM,
      label: "Auto-approve (this session)",
      description:
        "Allow asks every authorizer link defers, for this session and its subagents; a deny still denies. Never saved to a file",
      currentValue: toOnOff(autoApprove.isActive()),
      values: ON_OFF,
    },
    ...RUNTIME_KNOB_KEYS.map((id) => ({
      id,
      ...KNOB_PRESENTATION[id],
      currentValue: toOnOff(knobs[id]),
      values: ON_OFF,
    })),
  ];
}

function applySetting(
  knobs: RuntimeKnobValues,
  id: string,
  value: string,
): RuntimeKnobValues {
  if (!isRuntimeKnob(id)) return knobs;
  return { ...knobs, [id]: value === "on" };
}

function syncSettingValues(
  settingsList: SettingsList,
  knobs: RuntimeKnobValues,
  autoApprove: SessionAutoApproveToggle,
): void {
  settingsList.updateValue(AUTO_APPROVE_ITEM, toOnOff(autoApprove.isActive()));
  for (const id of RUNTIME_KNOB_KEYS) {
    settingsList.updateValue(id, toOnOff(knobs[id]));
  }
}

function getArgumentCompletions(
  argumentPrefix: string,
): Array<{ value: string; label: string; description: string }> | null {
  const normalized = argumentPrefix.trim().toLowerCase();
  if (normalized.includes(" ")) {
    return null;
  }

  const filtered = COMMAND_ARGUMENTS.filter((item) =>
    item.value.startsWith(normalized),
  );
  return filtered.length > 0 ? [...filtered] : null;
}

async function openSettingsModal(
  ctx: ExtensionCommandContext,
  controller: PermissionSystemConfigController,
): Promise<void> {
  const overlayOptions = {
    anchor: "center" as const,
    width: 82,
    maxHeight: "85%" as const,
    margin: 1,
  };

  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- ctx.ui.custom<void> is valid; rule does not allow void in generic fn call type args
  await ctx.ui.custom<void>(
    (_tui, _theme, _keybindings, done) => {
      const settingsList = new SettingsList(
        buildSettingItems(controller.config.current(), controller.autoApprove),
        10,
        getSettingsListTheme(),
        (id, newValue) => {
          applyChange(controller, ctx, id, newValue);
          syncSettingValues(
            settingsList,
            controller.config.current(),
            controller.autoApprove,
          );
        },
        () => done(),
      );

      return settingsList;
    },
    { overlay: true, overlayOptions },
  );
}

/**
 * Carry out one modal toggle: this session's auto-approve stays in memory, and
 * a knob is saved to the global config file.
 */
function applyChange(
  controller: PermissionSystemConfigController,
  ctx: ExtensionCommandContext,
  id: string,
  newValue: string,
): void {
  if (id === AUTO_APPROVE_ITEM) {
    controller.autoApprove.setAll(newValue === "on", ctx);
    return;
  }
  controller.config.save(
    applySetting(runtimeKnobValues(controller.config.current()), id, newValue),
    ctx,
  );
}

function handleArgs(
  args: string,
  ctx: ExtensionCommandContext,
  controller: PermissionSystemConfigController,
): boolean {
  const normalized = args.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (normalized === "show") {
    const rules = controller.getActiveAgentConfigRules();
    ctx.ui.notify(
      `permission-system: ${summarizeConfig(controller.config.current(), controller.autoApprove, rules)}`,
      "info",
    );
    return true;
  }

  if (normalized === "path") {
    ctx.ui.notify(`permission-system config: ${controller.configPath}`, "info");
    return true;
  }

  if (normalized === "reset") {
    if (controller.config.save(defaultKnobValues(), ctx)) {
      ctx.ui.notify("Permission system settings reset to defaults.", "info");
    }
    return true;
  }

  if (normalized === "help") {
    ctx.ui.notify(USAGE_TEXT, "info");
    return true;
  }

  ctx.ui.notify(USAGE_TEXT, "warning");
  return true;
}

export function registerPermissionSystemCommand(
  pi: ExtensionAPI,
  controller: PermissionSystemConfigController,
): void {
  pi.registerCommand("permission-system", {
    description:
      "Configure pi-permission-system logging, the permission dialog, and this session's auto-approve",
    getArgumentCompletions,
    handler: async (args, ctx) => {
      if (handleArgs(args, ctx, controller)) {
        return;
      }

      if (!ctx.hasUI) {
        ctx.ui.notify(
          "/permission-system requires interactive TUI mode.",
          "warning",
        );
        return;
      }

      await openSettingsModal(ctx, controller);
    },
  });
}
