import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { syncYoloStatus } from "#src/config/status";
import type { SessionYoloOverride } from "./yolo-override";

/**
 * yolo-command.ts — `/yolo`, a session-scoped switch over the `yoloMode` config.
 *
 * The config file is the persistent answer; this command is the transient one.
 * `/yolo` writes nothing — it flips the {@link SessionYoloOverride} the
 * composition root built this factory's `isYoloEnabled` reader over, so every
 * consumer of the effective yolo state (the `ask`→`allow` rewrite in
 * `PermissionManager` and the synthesized asks the gate runner extends it to)
 * moves with the command, and nothing survives the session.
 *
 * Every node runs its own factory, so `/yolo` in a subagent session governs
 * that node only — the same scope the node's own `PermissionSession` has.
 */
export interface YoloCommandController {
  /** The session-scoped override this command mutates. */
  override: SessionYoloOverride;
  /**
   * The persisted `yoloMode` value, which the override sits on top of.
   *
   * A reader rather than a snapshot: the config is reloaded on every turn, so
   * holding a value would report a state the session no longer has.
   */
  getConfigYolo(): boolean;
}

/** What the arguments asked for; parsing is pure so it can be tested without a host. */
type YoloRequest =
  | { kind: "set"; active: boolean }
  | { kind: "toggle" }
  | { kind: "report" }
  | { kind: "usage"; warn: boolean };

const COMMAND_ARGUMENTS = [
  {
    value: "on",
    label: "Enable for this session",
    description: "Auto-approve asks for this session without writing config",
  },
  {
    value: "off",
    label: "Disable for this session",
    description: "Restore the session to the config's yoloMode value",
  },
  {
    value: "status",
    label: "Show effective state",
    description: "Report whether yolo is on here, and what the config says",
  },
  {
    value: "help",
    label: "Show help",
    description: "Display command usage",
  },
] as const;
const USAGE_TEXT =
  "Usage: /yolo [on|off|status|help] (or run /yolo with no args to toggle yolo mode for this session; the config file is never written)";

export function parseYoloArgs(args: string): YoloRequest {
  const normalized = args.trim().toLowerCase();

  if (normalized === "on") return { kind: "set", active: true };
  if (normalized === "off") return { kind: "set", active: false };
  if (normalized === "status") return { kind: "report" };
  if (normalized === "help") return { kind: "usage", warn: false };
  if (normalized === "") return { kind: "toggle" };
  return { kind: "usage", warn: true };
}

/**
 * One line naming the effective state and where it came from, so an operator
 * who ran `/yolo on` can still tell that `yoloMode` in the config is untouched.
 */
function describeYolo(active: boolean, configYolo: boolean): string {
  const where =
    active === configYolo
      ? `matches config yoloMode: ${configYolo}`
      : `session only; config yoloMode stays ${configYolo}`;
  return `yolo mode: ${active ? "ON" : "OFF"} (${where})`;
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

function handleArgs(
  args: string,
  ctx: ExtensionCommandContext,
  controller: YoloCommandController,
): void {
  const request = parseYoloArgs(args);
  if (request.kind === "usage") {
    ctx.ui.notify(USAGE_TEXT, request.warn ? "warning" : "info");
    return;
  }

  const configYolo = controller.getConfigYolo();
  if (request.kind === "report") {
    // A query, so it leaves the status bar alone rather than re-asserting it.
    const active = controller.override.resolve(configYolo);
    ctx.ui.notify(describeYolo(active, configYolo), "info");
    return;
  }

  let active: boolean;
  if (request.kind === "set") {
    controller.override.set(request.active);
    active = request.active;
  } else {
    active = controller.override.toggle(configYolo);
  }
  syncYoloStatus(ctx, active);
  ctx.ui.notify(describeYolo(active, configYolo), "info");
}

export function registerYoloCommand(
  pi: ExtensionAPI,
  controller: YoloCommandController,
): void {
  pi.registerCommand("yolo", {
    description:
      "Toggle yolo mode for this session only, without writing the config",
    getArgumentCompletions,
    // eslint-disable-next-line @typescript-eslint/require-await -- the SDK types the handler as returning a Promise; flipping an in-memory flag has nothing to await
    handler: async (args, ctx) => {
      handleArgs(args, ctx, controller);
    },
  });
}
