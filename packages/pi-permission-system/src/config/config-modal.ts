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
  type PermissionSystemExtensionConfig,
  RUNTIME_KNOB_KEYS,
  type RuntimeKnob,
  runtimeKnobValues,
} from "./extension-config";

interface PermissionSystemConfigController {
  config: CommandConfigStore;
  /** Precomputed global config file path. */
  configPath: string;
  /** Returns the composed config-layer ruleset for the active agent scope. */
  getActiveAgentConfigRules(): Ruleset;
}

const ON_OFF = ["on", "off"];
const KNOB_PRESENTATION: Record<
  RuntimeKnob,
  { label: string; description: string }
> = {
  yoloMode: {
    label: "YOLO mode",
    description:
      "Auto-approve ask-state permission checks, including subagent approval forwarding",
  },
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
    description: "Restore default yolo/logging settings and persist them",
  },
  {
    value: "help",
    label: "Show help",
    description: "Display command usage",
  },
] as const;
const USAGE_TEXT =
  "Usage: /permission-system [show|path|reset|help] (or run /permission-system with no args to open settings modal)";

function cloneDefaultConfig(): PermissionSystemExtensionConfig {
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
  config: PermissionSystemExtensionConfig,
  rules?: Ruleset,
): string {
  const knobs = RUNTIME_KNOB_KEYS.map(
    (id) => `${id}=${toOnOff(config[id])}`,
  ).join(", ");
  const rulesSuffix = rules ? formatRulesSummary(rules) : "";
  return `${knobs}${rulesSuffix}`;
}

function buildSettingItems(
  config: PermissionSystemExtensionConfig,
): SettingItem[] {
  return RUNTIME_KNOB_KEYS.map((id) => ({
    id,
    ...KNOB_PRESENTATION[id],
    currentValue: toOnOff(config[id]),
    values: ON_OFF,
  }));
}

function applySetting(
  config: PermissionSystemExtensionConfig,
  id: string,
  value: string,
): PermissionSystemExtensionConfig {
  if (!isRuntimeKnob(id)) return config;
  return { ...config, [id]: value === "on" };
}

function syncSettingValues(
  settingsList: SettingsList,
  config: PermissionSystemExtensionConfig,
): void {
  for (const id of RUNTIME_KNOB_KEYS) {
    settingsList.updateValue(id, toOnOff(config[id]));
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
      let current = controller.config.current();
      const settingsList = new SettingsList(
        buildSettingItems(current),
        10,
        getSettingsListTheme(),
        (id, newValue) => {
          current = applySetting(current, id, newValue);
          controller.config.save(current, ctx);
          current = controller.config.current();
          syncSettingValues(settingsList, current);
        },
        () => done(),
      );

      return settingsList;
    },
    { overlay: true, overlayOptions },
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
      `permission-system: ${summarizeConfig(controller.config.current(), rules)}`,
      "info",
    );
    return true;
  }

  if (normalized === "path") {
    ctx.ui.notify(`permission-system config: ${controller.configPath}`, "info");
    return true;
  }

  if (normalized === "reset") {
    controller.config.save(cloneDefaultConfig(), ctx);
    ctx.ui.notify("Permission system settings reset to defaults.", "info");
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
      "Configure pi-permission-system logging and yolo-mode behavior",
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
