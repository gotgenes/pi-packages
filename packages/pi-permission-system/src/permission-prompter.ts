import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PermissionSystemExtensionConfig } from "./extension-config";
import type { ForwardedPermissionLogger } from "./forwarded-permissions/io";
import {
  confirmPermission,
  type PermissionForwardingDeps,
} from "./forwarded-permissions/polling";
import type {
  PermissionPromptDecision,
  RequestPermissionOptions,
} from "./permission-dialog";
import {
  PERMISSIONS_PROTOCOL_VERSION,
  type PermissionEventBus,
  type PermissionUiPromptEvent,
} from "./permission-events";
import type { SubagentSessionRegistry } from "./subagent-registry";
import { shouldAutoApprovePermissionState } from "./yolo-mode";

export type PermissionReviewSource = "tool_call" | "skill_input" | "skill_read";

/** Details passed when prompting the user for a permission decision. */
export interface PromptPermissionDetails {
  requestId: string;
  source: PermissionReviewSource;
  agentName: string | null;
  message: string;
  toolCallId?: string;
  toolName?: string;
  skillName?: string;
  path?: string;
  command?: string;
  target?: string;
  toolInputPreview?: string;
  /** Override label for the "for this session" dialog option. */
  sessionLabel?: string;
}

function promptSurface(details: PromptPermissionDetails): string | null {
  if (details.source === "skill_input" || details.source === "skill_read") {
    return "skill";
  }
  return details.toolName ?? null;
}

function promptValue(details: PromptPermissionDetails): string | null {
  return (
    details.command ??
    details.path ??
    details.target ??
    details.skillName ??
    details.toolName ??
    null
  );
}

function buildUiPromptEvent(
  details: PromptPermissionDetails,
): PermissionUiPromptEvent {
  return {
    protocolVersion: PERMISSIONS_PROTOCOL_VERSION,
    requestId: details.requestId,
    source: details.source,
    surface: promptSurface(details),
    value: promptValue(details),
    agentName: details.agentName,
    message: details.message,
    toolCallId: details.toolCallId ?? null,
    toolName: details.toolName ?? null,
    skillName: details.skillName ?? null,
    path: details.path ?? null,
    command: details.command ?? null,
    target: details.target ?? null,
    toolInputPreview: details.toolInputPreview ?? null,
    sessionLabel: details.sessionLabel ?? null,
  };
}

/** Mockable contract for permission prompting. */
export interface PermissionPrompterApi {
  prompt(
    ctx: ExtensionContext,
    details: PromptPermissionDetails,
  ): Promise<PermissionPromptDecision>;
}

/**
 * Dependencies required by PermissionPrompter.
 *
 * Keeps the prompter's external surface narrow: callers provide config
 * access, review-log writing, path constants, and the UI dialog function.
 * The prompter synthesises the PermissionForwardingDeps it needs internally.
 */
export interface PermissionPrompterDeps {
  /** Read current config for yolo-mode check (called at prompt time). */
  getConfig(): PermissionSystemExtensionConfig;
  /** Write structured entries to the permission review log. */
  writeReviewLog(event: string, details: Record<string, unknown>): void;
  /** Directory containing subagent session state. */
  subagentSessionsDir: string;
  /** Directory used for file-based permission forwarding requests/responses. */
  forwardingDir: string;
  /** In-process subagent session registry for detection and forwarding target resolution. */
  registry?: SubagentSessionRegistry;
  /** Event bus used for UI prompt broadcasts. */
  events: PermissionEventBus;
  /** Show the interactive permission dialog in the UI. */
  requestPermissionDecisionFromUi(
    ui: ExtensionContext["ui"],
    title: string,
    message: string,
    options?: RequestPermissionOptions,
  ): Promise<PermissionPromptDecision>;
}

/**
 * Encapsulates the full permission-prompt flow:
 *   1. Yolo-mode auto-approval check.
 *   2. Review-log "waiting" entry.
 *   3. UI-present vs. subagent-forwarding branching (via confirmPermission).
 *   4. Review-log "approved" / "denied" entry.
 *
 * Injecting a single PermissionPrompter instance means adding a new prompt
 * parameter (e.g. a future sessionLabel variant) only requires changing
 * PromptPermissionDetails and this class — not the full threading chain.
 */
export class PermissionPrompter implements PermissionPrompterApi {
  constructor(private readonly deps: PermissionPrompterDeps) {}

  async prompt(
    ctx: ExtensionContext,
    details: PromptPermissionDetails,
  ): Promise<PermissionPromptDecision> {
    if (shouldAutoApprovePermissionState("ask", this.deps.getConfig())) {
      this.writeReviewEntry("permission_request.auto_approved", details);
      return { approved: true, state: "approved", autoApproved: true };
    }

    this.writeReviewEntry("permission_request.waiting", details);

    const decision = await confirmPermission(
      ctx,
      details.message,
      this.buildForwardingDeps(),
      details.sessionLabel ? { sessionLabel: details.sessionLabel } : undefined,
      buildUiPromptEvent(details),
    );

    this.writeReviewEntry(
      decision.approved
        ? "permission_request.approved"
        : "permission_request.denied",
      {
        ...details,
        resolution: decision.state,
        denialReason: decision.denialReason,
      },
    );

    return decision;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private writeReviewEntry(
    event: string,
    details: PromptPermissionDetails & {
      resolution?: string;
      denialReason?: string;
    },
  ): void {
    this.deps.writeReviewLog(event, {
      requestId: details.requestId,
      source: details.source,
      agentName: details.agentName,
      message: details.message,
      toolCallId: details.toolCallId ?? null,
      toolName: details.toolName ?? null,
      skillName: details.skillName ?? null,
      path: details.path ?? null,
      command: details.command ?? null,
      target: details.target ?? null,
      toolInputPreview: details.toolInputPreview ?? null,
      resolution: details.resolution ?? null,
      denialReason: details.denialReason ?? null,
    });
  }

  /**
   * Build a PermissionForwardingDeps to pass to confirmPermission.
   *
   * Yolo-mode is already handled at the prompter level, so shouldAutoApprove
   * returns false here (confirmPermission does not call it; only
   * processForwardedPermissionRequests does, and that has its own deps).
   *
   * The logger delegates writeReviewLog to deps and uses a no-op writeDebugLog
   * (trace-level forwarding debug is deferred — see open question in the plan).
   */
  private buildForwardingDeps(): PermissionForwardingDeps {
    const { deps } = this;
    const logger: ForwardedPermissionLogger = {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- logger methods are plain function closures; no this-binding issue
      writeReviewLog: deps.writeReviewLog,
      writeDebugLog: () => undefined,
    };
    return {
      forwardingDir: deps.forwardingDir,
      subagentSessionsDir: deps.subagentSessionsDir,
      registry: deps.registry,
      events: deps.events,
      logger,
      // eslint-disable-next-line @typescript-eslint/unbound-method -- logger methods are plain function closures; no this-binding issue
      writeReviewLog: deps.writeReviewLog,
      // eslint-disable-next-line @typescript-eslint/unbound-method -- same as above
      requestPermissionDecisionFromUi: deps.requestPermissionDecisionFromUi,
      shouldAutoApprove: () => false,
    };
  }
}
