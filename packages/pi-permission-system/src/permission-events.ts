/**
 * Permission event channel — public contract.
 *
 * Exports channel name constants, TypeScript types for all emitted events,
 * and thin emit helpers.
 *
 * Stability guarantee: fields may be added, but existing fields will not be
 * removed or renamed without a semver-major version bump.
 */

import type { PromptRequestFacts } from "#src/presentation/prompt-payload";

/** Minimal event bus interface required by the emit helpers. */
export interface PermissionEventBus {
  emit(channel: string, data: unknown): void;
  on(channel: string, handler: (data: unknown) => void): () => void;
}

// ── Channel name constants ─────────────────────────────────────────────────

/**
 * Emitted at `session_start` after the emitting node published its service, and
 * again at that node's first `before_agent_start` (ADR 0012 decision 3).
 *
 * Fires at least once per session and may repeat, so a handler must be
 * idempotent — registering on every emission hits the duplicate-registration
 * throw.
 */
export const PERMISSIONS_READY_CHANNEL = "permissions:ready";

/** Emitted when a permission request is committed to the active UI prompt path. */
export const PERMISSIONS_UI_PROMPT_CHANNEL = "permissions:ui_prompt";

/** Emitted after every permission gate resolution. */
export const PERMISSIONS_DECISION_CHANNEL = "permissions:decision";

// ── permissions:ready ──────────────────────────────────────────────────────

/**
 * Payload emitted on `permissions:ready`: plain facts about the node that
 * emitted it (ADR 0012 decision 2).
 *
 * The bus announces; the locator provides. The payload carries data a consumer
 * can log, serialize, and replay — never a live capability — so the service
 * itself is fetched with `getPermissionsService(sessionId)`.
 *
 * There is no `protocolVersion` — the published types plus package semver
 * define the broadcast contract.
 */
export interface PermissionsReadyEvent {
  /**
   * The emitting node's session id: the key for
   * `getPermissionsService`. `null` when the host exposed no session
   * id, in which case this node published no keyed service.
   */
  sessionId: string | null;
  /**
   * Whether this node adjudicates its own asks (its authorizer chain runs) or
   * relays them to a serving node, which runs *its* chain over the same facts
   * (ADR 0007 §7).
   *
   * A registration needs no branch on this: extractors and formatters are read
   * by every node's own gates, and a chain link registered where no chain runs
   * is accepted and recorded rather than refused (ADR 0012 decision 4).
   */
  adjudicatesLocally: boolean;
}

// ── permissions:ui_prompt ──────────────────────────────────────────────────

/**
 * Origin of a UI prompt.
 *
 * Forwarding is orthogonal to origin: a forwarded subagent prompt keeps its
 * original source and is identified by a non-null `forwarding` field, not by a
 * dedicated source value.
 */
export type PermissionUiPromptSource =
  | "tool_call"
  | "skill_input"
  | "skill_read";

/** Forwarding context, present only when a prompt was forwarded from a non-UI subagent. */
export interface ForwardedPromptContext {
  /** Requesting subagent's display name, when known. */
  requesterAgentName: string | null;
  /** Requesting subagent's session id, when known. */
  requesterSessionId: string | null;
}

/**
 * Payload emitted on `permissions:ui_prompt`, immediately before the active
 * user-facing permission UI is shown.
 *
 * Lean by design: `surface`/`value` are the normalized display projection a
 * notification consumer reads; `source` is the origin; `forwarding` is non-null
 * only for forwarded subagent prompts. There is no `protocolVersion` — the
 * published types plus package semver define the broadcast contract, and
 * consumers should read defensively.
 */
export interface PermissionUiPromptEvent {
  /** Unique ID for the permission request being prompted. */
  requestId: string;
  /** Prompt origin. */
  source: PermissionUiPromptSource;
  /** Normalized display surface (e.g. "bash", "skill"), when known. */
  surface: string | null;
  /** Normalized display value (command, path, skill name, etc.), when known. */
  value: string | null;
  /** Agent name (when known). */
  agentName: string | null;
  /**
   * The ask's invariant core (ADR 0011 §3), verbatim from the prompt payload.
   *
   * Nested rather than flattened so the event and the payload share one shape:
   * a fact added to `PromptRequestFacts` reaches the bus without a second
   * hand-maintained declaration. Carries no evidence and no annotations — the
   * bus is the narrowest renderer (ADR 0011 §6), observable by any loaded
   * extension without the operator having named it.
   *
   * `request.surface` is the *gate* surface the rule fired on; the top-level
   * `surface` is the display projection. Both are here on purpose.
   */
  request: PromptRequestFacts;
  /** Forwarding context, or null for a direct prompt. */
  forwarding: ForwardedPromptContext | null;
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
  | "confirmation_unavailable"
  /** The gate threw, or an escalation failed, and the request was blocked. */
  | "gate_error";

/** Payload emitted on `permissions:decision`. */
export interface PermissionDecisionEvent {
  /**
   * Identifies the permission request this decision resolves, minted when the
   * request was created. Distinct from the host's tool-call id: one tool call
   * runs several gates and so raises several requests.
   */
  requestId: string;
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
  /**
   * Forwarding context for a decision this session made while serving another
   * session's forwarded request; absent on an ordinary local decision.
   *
   * The same `ForwardedPromptContext` the request's `permissions:ui_prompt`
   * carried, so a consumer that never saw the prompt can still tell a served
   * ask from a local one. Requester identity beyond it — the requester's cwd
   * and principal — stays off the bus.
   */
  forwarding?: ForwardedPromptContext | null;
}

// ── Emit helpers ───────────────────────────────────────────────────────────

/**
 * Emit the `permissions:ready` broadcast.
 * Call after the node published its service, so a consumer reacting to ready
 * can immediately resolve `getPermissionsService(event.sessionId)`.
 * Called twice per session: at `session_start`, and at the first
 * `before_agent_start` so a consumer whose own `session_start` ran later still
 * hears it (ADR 0012 decision 3).
 */
export function emitReadyEvent(
  events: PermissionEventBus,
  event: PermissionsReadyEvent,
): void {
  try {
    events.emit(PERMISSIONS_READY_CHANNEL, event);
  } catch {
    // Broadcasts are best-effort. A throwing listener must not block the
    // permission system from completing session startup.
  }
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
  try {
    events.emit(PERMISSIONS_DECISION_CHANNEL, event);
  } catch {
    // Broadcasts are best-effort. A throwing listener must not block the
    // permission gate from resolving.
  }
}
