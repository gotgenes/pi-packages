/* eslint-disable @typescript-eslint/no-deprecated -- this module implements the deprecated event-bus RPC channel; references to its own deprecated symbols are intentional */
/**
 * Permission event bus RPC handlers.
 *
 * Registers `permissions:rpc:check` and `permissions:rpc:prompt` handlers on
 * the Pi event bus so other extensions can query our policy and forward
 * permission prompts without importing this package.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildInputForSurface } from "./input-normalizer";
import type {
  PermissionPromptDecision,
  RequestPermissionOptions,
} from "./permission-dialog";
import type {
  PermissionEventBus,
  PermissionsCheckReplyData,
  PermissionsCheckRequest,
  PermissionsPromptReplyData,
  PermissionsPromptRequest,
  PermissionsRpcReply,
} from "./permission-events";
import {
  emitUiPromptEvent,
  PERMISSIONS_PROTOCOL_VERSION,
  PERMISSIONS_RPC_CHECK_CHANNEL,
  PERMISSIONS_RPC_PROMPT_CHANNEL,
} from "./permission-events";
import type { PermissionManager } from "./permission-manager";
import type { Rule } from "./rule";

/** Dependencies injected into the RPC handler registry. */
export interface PermissionRpcDeps {
  /** Returns the current PermissionManager (refreshed on session start). */
  getPermissionManager(): Pick<PermissionManager, "checkPermission">;
  /** Returns the current session rules (highest-priority approvals). */
  getSessionRules(): Rule[];
  /**
   * Returns the current ExtensionContext, or null if no session is active.
   * Used by the prompt handler to check hasUI and access the UI dialog.
   */
  getRuntimeContext(): ExtensionContext | null;
  /** Show the interactive permission dialog in the parent session UI. */
  requestPermissionDecisionFromUi(
    ui: ExtensionContext["ui"],
    title: string,
    message: string,
    options?: RequestPermissionOptions,
  ): Promise<PermissionPromptDecision>;
  /** Write structured entries to the permission review log. */
  writeReviewLog(event: string, details: Record<string, unknown>): void;
}

/** Unsubscribe handles returned from registerPermissionRpcHandlers. */
export interface PermissionRpcHandles {
  /** Stop the permissions:rpc:check handler. */
  unsubCheck: () => void;
  /** Stop the permissions:rpc:prompt handler. */
  unsubPrompt: () => void;
}

// ── Internal helpers ───────────────────────────────────────────────────────

/** Build a success reply envelope. */
function successReply<T>(data?: T): PermissionsRpcReply<T> {
  if (data !== undefined) {
    return {
      success: true,
      protocolVersion: PERMISSIONS_PROTOCOL_VERSION,
      data,
    };
  }
  return { success: true, protocolVersion: PERMISSIONS_PROTOCOL_VERSION };
}

/** Build an error reply envelope. */
function errorReply(error: string): PermissionsRpcReply {
  return {
    success: false,
    protocolVersion: PERMISSIONS_PROTOCOL_VERSION,
    error,
  };
}

// ── RPC handler: permissions:rpc:check ────────────────────────────────────

function handleCheckRpc(
  raw: unknown,
  events: PermissionEventBus,
  deps: PermissionRpcDeps,
): void {
  const req = raw as Partial<PermissionsCheckRequest>;
  const { requestId, surface, value, agentName } = req;

  if (typeof requestId !== "string" || !requestId) {
    // Cannot reply without a requestId — silently discard.
    return;
  }

  const replyChannel = `${PERMISSIONS_RPC_CHECK_CHANNEL}:reply:${requestId}`;

  try {
    if (typeof surface !== "string" || !surface) {
      events.emit(replyChannel, errorReply("surface is required"));
      return;
    }

    const input = buildInputForSurface(surface, value);
    const sessionRules = deps.getSessionRules();
    const result = deps
      .getPermissionManager()
      .checkPermission(surface, input, agentName ?? undefined, sessionRules);

    const data: PermissionsCheckReplyData = {
      result: result.state,
      matchedPattern: result.matchedPattern ?? null,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- ?? null normalises undefined to null for the reply record
      origin: result.origin ?? null,
    };
    events.emit(replyChannel, successReply(data));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    events.emit(replyChannel, errorReply(message));
  }
}

// ── RPC handler: permissions:rpc:prompt ───────────────────────────────────

async function handlePromptRpc(
  raw: unknown,
  events: PermissionEventBus,
  deps: PermissionRpcDeps,
): Promise<void> {
  const req = raw as Partial<PermissionsPromptRequest>;
  const { requestId, surface, value, agentName, message, sessionLabel } = req;

  if (typeof requestId !== "string" || !requestId) {
    return;
  }

  const replyChannel = `${PERMISSIONS_RPC_PROMPT_CHANNEL}:reply:${requestId}`;

  const ctx = deps.getRuntimeContext();
  if (!ctx?.hasUI) {
    events.emit(replyChannel, errorReply("no_ui"));
    return;
  }

  if (typeof message !== "string" || !message) {
    events.emit(replyChannel, errorReply("message is required"));
    return;
  }

  try {
    const title = surface
      ? `Permission request${agentName ? ` from ${agentName}` : ""}`
      : "Permission request";

    emitUiPromptEvent(events, {
      protocolVersion: PERMISSIONS_PROTOCOL_VERSION,
      requestId,
      source: "rpc_prompt",
      surface: surface ?? null,
      value: value ?? null,
      agentName: agentName ?? null,
      message,
      toolCallId: null,
      toolName: null,
      skillName: null,
      path: null,
      command: null,
      target: value ?? null,
      toolInputPreview: null,
      sessionLabel: sessionLabel ?? null,
    });

    const decision = await deps.requestPermissionDecisionFromUi(
      ctx.ui,
      title,
      message,
      sessionLabel ? { sessionLabel } : undefined,
    );

    deps.writeReviewLog("permission_request.rpc_prompt", {
      requestId,
      surface: surface ?? null,
      value: value ?? null,
      agentName: agentName ?? null,
      message,
      approved: decision.approved,
      resolution: decision.state,
      denialReason: decision.denialReason ?? null,
    });

    const data: PermissionsPromptReplyData = {
      approved: decision.approved,
      state: decision.state,
      ...(decision.denialReason !== undefined
        ? { denialReason: decision.denialReason }
        : {}),
    };
    events.emit(replyChannel, successReply(data));
  } catch (err) {
    const message_ = err instanceof Error ? err.message : String(err);
    events.emit(replyChannel, errorReply(message_));
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Register `permissions:rpc:check` and `permissions:rpc:prompt` handlers on
 * the event bus.
 *
 * Returns unsubscribe handles — call them in session_shutdown to stop the
 * handlers and prevent memory leaks.
 */
export function registerPermissionRpcHandlers(
  events: PermissionEventBus,
  deps: PermissionRpcDeps,
): PermissionRpcHandles {
  const unsubCheck = events.on(PERMISSIONS_RPC_CHECK_CHANNEL, (raw) => {
    handleCheckRpc(raw, events, deps);
  });

  const unsubPrompt = events.on(PERMISSIONS_RPC_PROMPT_CHANNEL, (raw) => {
    void handlePromptRpc(raw, events, deps);
  });

  return { unsubCheck, unsubPrompt };
}
