/**
 * Permission event channel — public contract.
 *
 * Exports channel name constants, protocol version, TypeScript types for all
 * emitted events and RPC envelopes, and thin emit helpers.
 *
 * Stability guarantee: fields may be added, but existing fields will not be
 * removed or renamed without a semver-major version bump.
 */

/** Minimal event bus interface required by the emit helpers and RPC handlers. */
export interface PermissionEventBus {
  emit(channel: string, data: unknown): void;
  on(channel: string, handler: (data: unknown) => void): () => void;
}

// ── Protocol version ───────────────────────────────────────────────────────

/**
 * RPC protocol version.
 * Bumped when the envelope shape or method contracts change in a breaking way.
 */
export const PERMISSIONS_PROTOCOL_VERSION = 1;

// ── Channel name constants ─────────────────────────────────────────────────

/** Emitted at `session_start`, after the service is published. */
export const PERMISSIONS_READY_CHANNEL = "permissions:ready";

/** Emitted when a permission request is committed to the active UI prompt path. */
export const PERMISSIONS_UI_PROMPT_CHANNEL = "permissions:ui_prompt";

/** Emitted after every permission gate resolution. */
export const PERMISSIONS_DECISION_CHANNEL = "permissions:decision";

/**
 * RPC request channel — query the permission policy (no prompting).
 *
 * @deprecated Use the `Symbol.for()`-backed service accessor instead:
 * ```typescript
 * const { getPermissionsService } = await import("@gotgenes/pi-permission-system");
 * const service = getPermissionsService();
 * if (service) {
 *   const result = service.checkPermission("bash", "git push");
 * }
 * ```
 * The event-bus RPC remains available as a zero-dependency fallback.
 */
export const PERMISSIONS_RPC_CHECK_CHANNEL = "permissions:rpc:check";

/** RPC request channel — forward a permission prompt to the parent UI. */
export const PERMISSIONS_RPC_PROMPT_CHANNEL = "permissions:rpc:prompt";

// ── Shared RPC envelope ────────────────────────────────────────────────────

/**
 * Standard RPC reply envelope.
 * Success: `{ success: true, protocolVersion, data? }`.
 * Error:   `{ success: false, protocolVersion, error }`.
 */
export type PermissionsRpcReply<T = void> =
  | { success: true; protocolVersion: number; data?: T }
  | { success: false; protocolVersion: number; error: string };

// ── permissions:ready ──────────────────────────────────────────────────────

/** Payload emitted on `permissions:ready`. */
export interface PermissionsReadyEvent {
  protocolVersion: number;
}

// ── permissions:ui_prompt ──────────────────────────────────────────────────

/** Payload emitted on `permissions:ui_prompt`. */
export type PermissionUiPromptSource =
  | "tool_call"
  | "skill_input"
  | "skill_read"
  | "rpc_prompt"
  | "forwarded_permission";

export interface PermissionUiPromptEvent {
  /** Protocol version for the cross-extension event contract. */
  protocolVersion: number;
  /** Unique ID for the permission request being prompted. */
  requestId: string;
  /** Prompt source: tool call, skill input/read, RPC, forwarded subagent request, etc. */
  source: PermissionUiPromptSource;
  /** Permission surface being evaluated, when known. */
  surface: string | null;
  /** Value being evaluated: command, path, skill name, tool target, etc. */
  value: string | null;
  /** Agent name (when known). */
  agentName: string | null;
  /** Message displayed to the user. */
  message: string;
  /** Tool call ID (when the prompt is for a tool call). */
  toolCallId: string | null;
  /** Tool name (when the prompt is for a tool call). */
  toolName: string | null;
  /** Skill name (when the prompt is for a skill request). */
  skillName: string | null;
  /** Path being evaluated (when available). */
  path: string | null;
  /** Command being evaluated (when available). */
  command: string | null;
  /** Target being evaluated (when available). */
  target: string | null;
  /** Tool input preview shown in logs/prompts (when available). */
  toolInputPreview: string | null;
  /** Override label for the "for this session" dialog option. */
  sessionLabel: string | null;
}

// ── permissions:decision ───────────────────────────────────────────────────

/** How a permission decision was reached. */
export type PermissionDecisionResolution =
  | "policy_allow"
  | "policy_deny"
  | "session_approved"
  | "infrastructure_auto_allowed"
  | "user_approved"
  | "user_approved_for_session"
  | "user_denied"
  | "auto_approved"
  | "confirmation_unavailable";

/** Payload emitted on `permissions:decision`. */
export interface PermissionDecisionEvent {
  /** Permission surface: "bash", "read", "mcp", "skill", "external_directory", etc. */
  surface: string;
  /** The value that was evaluated (command, tool name, skill name, path). */
  value: string;
  /** Final decision. */
  result: "allow" | "deny";
  /** How the decision was reached. */
  resolution: PermissionDecisionResolution;
  /** Which config scope contributed the winning rule (when available). */
  origin: string | null;
  /** Agent name (when known). */
  agentName: string | null;
  /** Matched pattern from the winning rule (when available). */
  matchedPattern: string | null;
}

// ── permissions:rpc:check ──────────────────────────────────────────────────

/**
 * Request payload for `permissions:rpc:check`.
 *
 * @deprecated Prefer `getPermissionsService().checkPermission()` from the
 * service accessor module. See `PERMISSIONS_RPC_CHECK_CHANNEL` for details.
 */
export interface PermissionsCheckRequest {
  requestId: string;
  /** Permission surface to evaluate. */
  surface: string;
  /** The value to evaluate: command string, tool name, skill name, or path. */
  value?: string;
  /** Optional agent name for per-agent policy resolution. */
  agentName?: string;
}

/**
 * Data field in a successful `permissions:rpc:check` reply.
 *
 * @deprecated Prefer `getPermissionsService().checkPermission()` from the
 * service accessor module. See `PERMISSIONS_RPC_CHECK_CHANNEL` for details.
 */
export interface PermissionsCheckReplyData {
  result: "allow" | "deny" | "ask";
  matchedPattern: string | null;
  origin: string | null;
}

// ── permissions:rpc:prompt ─────────────────────────────────────────────────

/** Request payload for `permissions:rpc:prompt`. */
export interface PermissionsPromptRequest {
  requestId: string;
  /** Permission surface being evaluated. */
  surface: string;
  /** Value being evaluated (shown in the dialog). */
  value: string;
  /** Optional agent name for display. */
  agentName?: string;
  /** Message to display in the permission dialog. */
  message: string;
  /** Optional label for the "for this session" option. */
  sessionLabel?: string;
}

/** Data field in a successful `permissions:rpc:prompt` reply. */
export interface PermissionsPromptReplyData {
  approved: boolean;
  /**
   * Detailed state: "approved", "approved_for_session",
   * "denied", or "denied_with_reason".
   */
  state: string;
  denialReason?: string;
}

// ── Emit helpers ───────────────────────────────────────────────────────────

/**
 * Emit the `permissions:ready` broadcast.
 * Call at `session_start`, after the service is published, so a consumer
 * reacting to ready can immediately resolve `getPermissionsService()`.
 */
export function emitReadyEvent(events: PermissionEventBus): void {
  const payload: PermissionsReadyEvent = {
    protocolVersion: PERMISSIONS_PROTOCOL_VERSION,
  };
  events.emit(PERMISSIONS_READY_CHANNEL, payload);
}

/**
 * Emit a `permissions:ui_prompt` broadcast.
 * Call immediately before invoking the active user-facing permission UI.
 */
export function emitUiPromptEvent(
  events: PermissionEventBus,
  event: PermissionUiPromptEvent,
): void {
  try {
    events.emit(PERMISSIONS_UI_PROMPT_CHANNEL, event);
  } catch {
    // UI-prompt broadcasts are observational. A consumer failure must not block
    // the permission dialog itself.
  }
}

/**
 * Emit a `permissions:decision` broadcast.
 * Call after every permission gate resolution.
 */
export function emitDecisionEvent(
  events: PermissionEventBus,
  event: PermissionDecisionEvent,
): void {
  events.emit(PERMISSIONS_DECISION_CHANNEL, event);
}
