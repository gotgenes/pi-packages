import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { AdjudicationRole } from "./authorizer-selection";
import type { AutoApproval, AutoApproveScope } from "./auto-approval";

/** The command's name, inside the package's `/permission-system:` namespace. */
export const AUTO_APPROVE_COMMAND = "permission-system:auto-approve";

/** What the arguments asked for; parsed purely so it is testable without a host. */
export type AutoApproveRequest =
  | { kind: "on"; scopes: AutoApproveScope[] }
  | { kind: "off"; scope?: AutoApproveScope }
  | { kind: "status" }
  | { kind: "help" }
  | { kind: "usage" };

const USAGE_TEXT =
  `Usage: /${AUTO_APPROVE_COMMAND} [on|off] [own|forwarded|agent <name>] | status | help\n` +
  "  on       auto-approve this session's own asks and every forwarded ask\n" +
  "  on own | on forwarded | on agent <name>   turn on one scope\n" +
  "  off      turn every scope off; off <scope> turns one off\n" +
  "Asks every authorizer link defers are allowed instead of prompted; a deny still denies. Nothing is written to a file.";

const COMMAND_ARGUMENTS = [
  {
    value: "on",
    label: "Turn auto-approve on",
    description: "Auto-approve this session's own and forwarded asks",
  },
  {
    value: "off",
    label: "Turn auto-approve off",
    description: "Prompt again for every ask",
  },
  {
    value: "status",
    label: "Show auto-approve",
    description: "Report which scopes are on and what set each",
  },
  {
    value: "help",
    label: "Show help",
    description: "Display command usage",
  },
] as const;

/** Parse the command's arguments into a request. */
export function parseAutoApproveArgs(args: string): AutoApproveRequest {
  const [verb = "", ...rest] = args.trim().split(/\s+/).filter(Boolean);
  switch (verb.toLowerCase()) {
    case "":
    case "status":
      return rest.length === 0 ? { kind: "status" } : { kind: "usage" };
    case "help":
      return { kind: "help" };
    case "on": {
      if (rest.length === 0) {
        return { kind: "on", scopes: [{ kind: "own" }, { kind: "forwarded" }] };
      }
      const scope = parseScope(rest);
      return scope === undefined
        ? { kind: "usage" }
        : { kind: "on", scopes: [scope] };
    }
    case "off": {
      if (rest.length === 0) return { kind: "off" };
      const scope = parseScope(rest);
      return scope === undefined ? { kind: "usage" } : { kind: "off", scope };
    }
    default:
      return { kind: "usage" };
  }
}

function parseScope(words: readonly string[]): AutoApproveScope | undefined {
  const [kind = "", ...rest] = words;
  switch (kind.toLowerCase()) {
    case "own":
      return rest.length === 0 ? { kind: "own" } : undefined;
    case "forwarded":
      return rest.length === 0 ? { kind: "forwarded" } : undefined;
    case "agent":
      return rest.length === 1
        ? { kind: "agent", agentName: rest[0] }
        : undefined;
    default:
      return undefined;
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

/** What the command drives: the session's state, and this node's chain role. */
export interface AutoApproveCommandController {
  approval: Pick<
    AutoApproval,
    "enable" | "disable" | "describe" | "syncStatus" | "isActive"
  >;
  /** Whether this node decides its own asks or relays them (ADR 0007 §7). */
  role: AdjudicationRole;
}

/** The part of a command context the command uses: notify and the status bar. */
export interface AutoApproveCommandContext {
  ui: Pick<ExtensionCommandContext["ui"], "notify" | "setStatus">;
}

/** Carry out one request against the session's state. */
export function handleAutoApproveCommand(
  args: string,
  ctx: AutoApproveCommandContext,
  controller: AutoApproveCommandController,
): void {
  const request = parseAutoApproveArgs(args);
  const { approval } = controller;
  switch (request.kind) {
    case "usage":
      ctx.ui.notify(USAGE_TEXT, "warning");
      return;
    case "help":
      ctx.ui.notify(USAGE_TEXT, "info");
      return;
    case "status":
      ctx.ui.notify(`auto-approve: ${approval.describe()}`, "info");
      return;
    case "on":
      for (const scope of request.scopes) {
        approval.enable(scope, "command");
      }
      break;
    case "off":
      approval.disable(request.scope);
      break;
  }
  approval.syncStatus(ctx);
  ctx.ui.notify(`auto-approve: ${approval.describe()}`, "info");
  if (approval.isActive() && !controller.role.adjudicatesLocally()) {
    ctx.ui.notify(
      "This session relays its asks to the session serving it, so its own auto-approve does not apply while it does; turn auto-approve on in the serving session.",
      "warning",
    );
  }
}

/** Register `/permission-system:auto-approve`. */
export function registerAutoApproveCommand(
  pi: Pick<ExtensionAPI, "registerCommand">,
  controller: AutoApproveCommandController,
): void {
  pi.registerCommand(AUTO_APPROVE_COMMAND, {
    description:
      "Auto-approve asks every authorizer link defers, for this session only",
    getArgumentCompletions,
    handler: (args, ctx) => {
      handleAutoApproveCommand(args, ctx, controller);
      return Promise.resolve();
    },
  });
}
