import { describe, expect, it, vi } from "vitest";
import { registerPermissionSystemCommand } from "#src/config/config-modal";
import type { CommandConfigStore } from "#src/config/config-store";
import {
  DEFAULT_EXTENSION_CONFIG,
  type PermissionSystemExtensionConfig,
} from "#src/config/extension-config";
import type { Rule, Ruleset } from "#src/policy/rule";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getSettingsListTheme: () => ({}),
}));

vi.mock("@earendil-works/pi-tui", () => ({
  SettingsList: class {
    handleInput(): void {}
    updateValue(): void {}
    render(): string[] {
      return [];
    }
    invalidate(): void {}
  },
}));

type Notification = { message: string; level: "info" | "warning" | "error" };

type CommandContextStub = {
  hasUI: boolean;
  ui: {
    notify(message: string, level: "info" | "warning" | "error"): void;
    custom<T>(
      renderer: (...args: unknown[]) => unknown,
      options?: unknown,
    ): Promise<T>;
  };
};

interface CommandDefinition {
  description: string;
  getArgumentCompletions?: (
    argumentPrefix: string,
  ) => Array<{ value: string; label: string; description?: string }> | null;
  handler: (args: string, ctx: CommandContextStub) => Promise<void>;
}

function createCommandContext(hasUI: boolean): {
  ctx: CommandContextStub;
  notifications: Notification[];
  getCustomCalls(): number;
} {
  const notifications: Notification[] = [];
  let customCalls = 0;

  return {
    ctx: {
      hasUI,
      ui: {
        notify(message: string, level: "info" | "warning" | "error") {
          notifications.push({ message, level });
        },
        async custom<T>(
          _renderer: (...args: unknown[]) => unknown,
          _options?: unknown,
        ): Promise<T> {
          customCalls += 1;
          return undefined as T;
        },
      },
    },
    notifications,
    getCustomCalls: () => customCalls,
  };
}

function lastNotification(notifications: Notification[]): Notification {
  return notifications[notifications.length - 1];
}

/** A store that keeps whatever it is told to save. */
function makeConfigStore(initial: PermissionSystemExtensionConfig) {
  let config = { ...initial };
  const save = vi.fn((next: PermissionSystemExtensionConfig): void => {
    config = next;
  });
  const store: CommandConfigStore = { current: () => config, save };
  return { store, save };
}

/** Register the command against a recorder and return what was registered. */
function captureCommand(options: {
  store: CommandConfigStore;
  rules?: Ruleset;
  configPath?: string;
}): { name: string; definition: CommandDefinition } {
  const registered: { name: string; definition: CommandDefinition }[] = [];
  registerPermissionSystemCommand(
    {
      registerCommand(name: string, definition: CommandDefinition) {
        registered.push({ name, definition });
      },
    } as never,
    {
      config: options.store,
      configPath: options.configPath ?? "/fake/config.json",
      getActiveAgentConfigRules: () => options.rules ?? [],
    },
  );
  expect(registered).toHaveLength(1);
  return registered[0];
}

describe("/permission-system command", () => {
  it("registers under the permission-system name", () => {
    const { store } = makeConfigStore(DEFAULT_EXTENSION_CONFIG);
    const { name, definition } = captureCommand({ store });
    expect(name).toBe("permission-system");
    expect(definition.description).toContain("Configure pi-permission-system");
  });

  describe("argument completions", () => {
    it("expose the top-level config actions, filtered by prefix", () => {
      const { store } = makeConfigStore(DEFAULT_EXTENSION_CONFIG);
      const { definition } = captureCommand({ store });

      expect(definition.getArgumentCompletions).toBeTypeOf("function");
      const topLevel = definition.getArgumentCompletions?.("");
      expect(topLevel?.map((item) => item.value)).toEqual([
        "show",
        "path",
        "reset",
        "help",
      ]);
      expect(
        definition.getArgumentCompletions?.("pa")?.map((item) => item.value),
      ).toEqual(["path"]);
      expect(definition.getArgumentCompletions?.("path extra")).toBe(null);
      expect(definition.getArgumentCompletions?.("zzz")).toBe(null);
    });
  });

  describe("show", () => {
    it("summarizes the runtime knobs", async () => {
      const { store } = makeConfigStore({
        ...DEFAULT_EXTENSION_CONFIG,
        debugLog: true,
        permissionReviewLog: false,
        yoloMode: true,
      });
      const { definition } = captureCommand({ store });
      const { ctx, notifications } = createCommandContext(true);

      await definition.handler("show", ctx);

      expect(lastNotification(notifications)).toEqual({
        message:
          "permission-system: yoloMode=on, permissionReviewLog=off, debugLog=on",
        level: "info",
      });
    });

    it("lists each config rule with its origin", async () => {
      const rules: Rule[] = [
        {
          surface: "read",
          pattern: "*",
          action: "allow",
          layer: "config",
          origin: "global",
        },
        {
          surface: "bash",
          pattern: "rm *",
          action: "deny",
          layer: "config",
          origin: "project",
        },
      ];
      const { store } = makeConfigStore(DEFAULT_EXTENSION_CONFIG);
      const { definition } = captureCommand({ store, rules });
      const { ctx, notifications } = createCommandContext(true);

      await definition.handler("show", ctx);

      const msg = lastNotification(notifications).message;
      expect(msg).toContain("global");
      expect(msg).toContain("project");
      expect(msg).toContain("read");
      expect(msg).toContain("bash");
    });

    it("omits the rule summary when no config rule applies", async () => {
      const { store } = makeConfigStore({
        ...DEFAULT_EXTENSION_CONFIG,
        yoloMode: true,
      });
      const { definition } = captureCommand({ store });
      const { ctx, notifications } = createCommandContext(true);

      await definition.handler("show", ctx);

      const msg = lastNotification(notifications).message;
      expect(msg).toContain("yoloMode=on");
      expect(msg).not.toContain("(global)");
    });
  });

  describe("path", () => {
    it("names the global config file", async () => {
      const { store } = makeConfigStore(DEFAULT_EXTENSION_CONFIG);
      const { definition } = captureCommand({
        store,
        configPath: "/agent/config.json",
      });
      const { ctx, notifications } = createCommandContext(true);

      await definition.handler("path", ctx);

      expect(lastNotification(notifications)).toEqual({
        message: "permission-system config: /agent/config.json",
        level: "info",
      });
    });
  });

  describe("help", () => {
    it("shows the usage", async () => {
      const { store } = makeConfigStore(DEFAULT_EXTENSION_CONFIG);
      const { definition } = captureCommand({ store });
      const { ctx, notifications } = createCommandContext(true);

      await definition.handler("help", ctx);

      expect(lastNotification(notifications).level).toBe("info");
      expect(lastNotification(notifications).message).toContain(
        "Usage: /permission-system",
      );
    });
  });

  describe("reset", () => {
    it("saves the default knobs and says so", async () => {
      const { store, save } = makeConfigStore({
        ...DEFAULT_EXTENSION_CONFIG,
        debugLog: true,
        permissionReviewLog: false,
        yoloMode: true,
        doublePressToConfirm: false,
      });
      const { definition } = captureCommand({ store });
      const { ctx, notifications } = createCommandContext(true);

      await definition.handler("reset", ctx);

      expect(save).toHaveBeenCalledWith(DEFAULT_EXTENSION_CONFIG, ctx);
      expect(store.current()).toEqual(DEFAULT_EXTENSION_CONFIG);
      expect(lastNotification(notifications)).toEqual({
        message: "Permission system settings reset to defaults.",
        level: "info",
      });
    });
  });

  describe("an unknown argument", () => {
    it("warns with the usage", async () => {
      const { store } = makeConfigStore(DEFAULT_EXTENSION_CONFIG);
      const { definition } = captureCommand({ store });
      const { ctx, notifications } = createCommandContext(true);

      await definition.handler("unknown", ctx);

      expect(lastNotification(notifications).level).toBe("warning");
      expect(lastNotification(notifications).message).toContain(
        "Usage: /permission-system",
      );
    });
  });

  describe("no argument", () => {
    it("refuses without an interactive UI", async () => {
      const { store } = makeConfigStore(DEFAULT_EXTENSION_CONFIG);
      const { definition } = captureCommand({ store });
      const { ctx, notifications, getCustomCalls } =
        createCommandContext(false);

      await definition.handler("", ctx);

      expect(lastNotification(notifications)).toEqual({
        message: "/permission-system requires interactive TUI mode.",
        level: "warning",
      });
      expect(getCustomCalls()).toBe(0);
    });

    it("opens the settings modal", async () => {
      const { store } = makeConfigStore(DEFAULT_EXTENSION_CONFIG);
      const { definition } = captureCommand({ store });
      const { ctx, getCustomCalls } = createCommandContext(true);

      await definition.handler("", ctx);

      expect(getCustomCalls()).toBe(1);
    });
  });
});
