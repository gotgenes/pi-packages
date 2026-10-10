import { expect, test } from "vitest";
import { PERMISSION_SYSTEM_STATUS_KEY } from "#src/config/status";
import {
  parseYoloArgs,
  registerYoloCommand,
  type YoloCommandController,
} from "#src/session/yolo-command";
import { SessionYoloOverride } from "#src/session/yolo-override";

type Notification = { message: string; level: "info" | "warning" };
type StatusWrite = { key: string; value: string | undefined };
type CommandDefinition = {
  description: string;
  getArgumentCompletions?: (
    argumentPrefix: string,
  ) => Array<{ value: string; label: string; description?: string }> | null;
  handler: (args: string, ctx: unknown) => void;
};

function makeHarness(initialConfigYolo: boolean) {
  const override = new SessionYoloOverride();
  const notifications: Notification[] = [];
  const statuses: StatusWrite[] = [];
  let configYolo = initialConfigYolo;
  let registeredName: string | null = null;
  let definition: CommandDefinition | null = null;

  const controller: YoloCommandController = {
    override,
    getConfigYolo: () => configYolo,
  };
  registerYoloCommand(
    {
      registerCommand(name: string, next: CommandDefinition) {
        registeredName = name;
        definition = next;
      },
    } as never,
    controller,
  );

  const run = (args: string): void => {
    definition?.handler(args, {
      ui: {
        notify: (message: string, level: "info" | "warning") => {
          notifications.push({ message, level });
        },
        setStatus: (key: string, value: string | undefined) => {
          statuses.push({ key, value });
        },
      },
    });
  };

  return {
    run,
    override,
    notifications,
    statuses,
    // A closure, not a snapshot: TS flow analysis cannot see the callback
    // assignment, so a bare `definition` property narrows to `null`.
    definition: (): CommandDefinition | null => definition,
    name: (): string | null => registeredName,
    /** Stand in for the per-turn config reload. */
    reloadConfig: (next: boolean): void => {
      configYolo = next;
    },
    configYolo: (): boolean => configYolo,
    lastMessage: (): string => notifications[notifications.length - 1].message,
  };
}

test("the command is registered as /yolo", () => {
  expect(makeHarness(false).name()).toBe("yolo");
});

test("bare /yolo toggles the session on without writing config", () => {
  const harness = makeHarness(false);

  harness.run("");

  expect(harness.override.resolve(false)).toBe(true);
  expect(harness.statuses).toEqual([
    { key: PERMISSION_SYSTEM_STATUS_KEY, value: "yolo" },
  ]);
  expect(harness.lastMessage()).toBe(
    "yolo mode: ON (session only; config yoloMode stays false)",
  );

  harness.run("");

  expect(harness.override.resolve(false)).toBe(false);
  expect(harness.statuses.at(-1)).toEqual({
    key: PERMISSION_SYSTEM_STATUS_KEY,
    value: undefined,
  });
});

test("/yolo on and /yolo off set the session state outright", () => {
  const harness = makeHarness(true);

  harness.run("on");
  expect(harness.override.resolve(true)).toBe(true);
  expect(harness.lastMessage()).toBe(
    "yolo mode: ON (matches config yoloMode: true)",
  );

  harness.run("off");
  expect(harness.override.resolve(true)).toBe(false);
  expect(harness.statuses.at(-1)?.value).toBe(undefined);
  expect(harness.lastMessage()).toBe(
    "yolo mode: OFF (session only; config yoloMode stays true)",
  );
});

test("/yolo status reports without changing state or the status bar", () => {
  const harness = makeHarness(false);

  harness.run("status");

  expect(harness.statuses).toEqual([]);
  expect(harness.override.resolve(false)).toBe(false);
  expect(harness.lastMessage()).toBe(
    "yolo mode: OFF (matches config yoloMode: false)",
  );
});

test("an override survives a config reload that changes yoloMode", () => {
  const harness = makeHarness(false);

  harness.run("on");
  harness.reloadConfig(true);

  // The command pinned this session on; the reloaded config now agreeing with
  // it is a coincidence of values, not the source of the state.
  expect(harness.override.resolve(harness.configYolo())).toBe(true);

  harness.run("off");
  expect(harness.override.resolve(harness.configYolo())).toBe(false);
  expect(harness.lastMessage()).toBe(
    "yolo mode: OFF (session only; config yoloMode stays true)",
  );
});

test("help and an unknown argument both explain the usage", () => {
  const harness = makeHarness(false);

  harness.run("help");
  expect(harness.notifications.at(-1)?.level).toBe("info");
  expect(harness.lastMessage()).toContain("/yolo [on|off|status|help]");

  harness.run("nonsense");
  expect(harness.notifications.at(-1)?.level).toBe("warning");
  expect(harness.override.resolve(false)).toBe(false);
  expect(harness.statuses).toEqual([]);
});

test("argument completions offer the subcommands", () => {
  const harness = makeHarness(false);
  const completions = harness.definition()?.getArgumentCompletions;
  expect(completions).toBeDefined();

  expect((completions?.("") ?? []).map((item) => item.value)).toEqual([
    "on",
    "off",
    "status",
    "help",
  ]);
  expect((completions?.("o") ?? []).map((item) => item.value)).toEqual([
    "on",
    "off",
  ]);
  expect(completions?.("zzz")).toBe(null);
  expect(completions?.("on extra")).toBe(null);
});

test("parsing is pure over the argument string", () => {
  expect(parseYoloArgs("")).toEqual({ kind: "toggle" });
  expect(parseYoloArgs("  ON  ")).toEqual({ kind: "set", active: true });
  expect(parseYoloArgs("Off")).toEqual({ kind: "set", active: false });
  expect(parseYoloArgs("status")).toEqual({ kind: "report" });
  expect(parseYoloArgs("help")).toEqual({ kind: "usage", warn: false });
  expect(parseYoloArgs("maybe")).toEqual({ kind: "usage", warn: true });
});
