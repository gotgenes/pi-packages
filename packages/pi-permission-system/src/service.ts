/**
 * Cross-extension service accessor backed by `Symbol.for()` on `globalThis`.
 *
 * `Symbol.for()` is process-global by spec, so it survives jiti's per-extension
 * module isolation (`moduleCache: false`). A consumer doing
 * `import("@gotgenes/pi-permission-system")` gets a fresh module copy, but
 * `getPermissionsService()` reads from the same `globalThis` slot the provider
 * wrote to — enabling direct, synchronous, type-safe function calls.
 *
 * Best practice: call `getPermissionsService()` per use rather than caching the
 * reference — this ensures resilience across `/reload` and load-order edge cases.
 */

import type { ToolInputFormatter } from "./tool-input-formatter-registry";
import type { PermissionCheckResult, PermissionState } from "./types";

export type { PermissionCheckResult, PermissionState, ToolInputFormatter };
export {
  PERMISSIONS_DECISION_CHANNEL,
  PERMISSIONS_PROTOCOL_VERSION,
  PERMISSIONS_READY_CHANNEL,
  PERMISSIONS_RPC_CHECK_CHANNEL,
  PERMISSIONS_RPC_PROMPT_CHANNEL,
  PERMISSIONS_UI_PROMPT_CHANNEL,
} from "./permission-events";
export type {
  PermissionDecisionEvent,
  PermissionsCheckReplyData,
  PermissionsCheckRequest,
  PermissionsPromptReplyData,
  PermissionsPromptRequest,
  PermissionsReadyEvent,
  PermissionsRpcReply,
  PermissionUiPromptEvent,
  PermissionUiPromptSource,
} from "./permission-events";

/** Process-global key for the service slot. */
const SERVICE_KEY = Symbol.for("@gotgenes/pi-permission-system:service");

/**
 * Public interface exposed to other extensions via `getPermissionsService()`.
 *
 * Mirrors the simplified RPC signature — surface + optional value + optional
 * agent name — and delegates to `PermissionManager.checkPermission()` with
 * current session rules internally.
 */
export interface PermissionsService {
  /**
   * Query the permission policy for a surface and value.
   *
   * @param surface   - Permission surface: "bash", "read", "mcp", "skill",
   *                    "external_directory", etc.
   * @param value     - The value to evaluate: command string, tool name, skill
   *                    name, or path. Omit or pass `undefined` for a
   *                    surface-level query.
   * @param agentName - Optional agent name for per-agent policy resolution.
   * @returns Full check result including state, matched pattern, and origin.
   */
  checkPermission(
    surface: string,
    value?: string,
    agentName?: string,
  ): PermissionCheckResult;

  /**
   * Register a custom preview formatter for a specific tool name.
   *
   * The formatter is consulted first inside `ToolPreviewFormatter.formatToolInputForPrompt`;
   * returning `undefined` falls through to the built-in switch (and ultimately
   * the JSON default).
   *
   * Only one formatter may be registered per tool name — a second call for the
   * same name throws.  The returned disposer unregisters the formatter.
   *
   * @param toolName  - Exact tool name to register for (e.g. `"mcp"`, `"my-server:run"`).
   * @param formatter - Receives the raw `input` record; return a string to use
   *                    as the prompt preview, or `undefined` to decline.
   */
  registerToolInputFormatter(
    toolName: string,
    formatter: ToolInputFormatter,
  ): () => void;

  /**
   * Query the tool-level permission state for pre-filtering tools before
   * creating a child session.
   *
   * Returns `"deny"` | `"allow"` | `"ask"` based on the composed policy.
   * Does not consider command-level rules (e.g. per-bash-command patterns) —
   * use `checkPermission` for runtime invocation gates.
   *
   * @param toolName  - Tool name (e.g. `"bash"`, `"read"`, `"my-extension:tool"`).
   * @param agentName - Optional agent name for per-agent policy resolution.
   */
  getToolPermission(toolName: string, agentName?: string): PermissionState;
}

/**
 * Store a `PermissionsService` on `globalThis` so other extensions can
 * retrieve it via `getPermissionsService()`.
 *
 * Called at `session_start` by the top-level (parent) instance only — an
 * in-process subagent child skips publishing so it cannot clobber the parent's
 * service. Overwrites any previously published service, which keeps `/reload`
 * working: a reloaded parent re-publishes its fresh service.
 */
export function publishPermissionsService(service: PermissionsService): void {
  (globalThis as Record<symbol, unknown>)[SERVICE_KEY] = service;
}

/**
 * Retrieve the published `PermissionsService`, or `undefined` if the
 * permission-system extension has not loaded (or has been unloaded).
 */
export function getPermissionsService(): PermissionsService | undefined {
  return (globalThis as Record<symbol, unknown>)[SERVICE_KEY] as
    | PermissionsService
    | undefined;
}

/**
 * Remove `service` from `globalThis`, but only when the current slot still
 * holds it (identity compare-and-delete).
 *
 * Called during `session_shutdown` to avoid stale references after the
 * extension is torn down. Scoping the delete to the publishing instance keeps
 * two cases correct:
 *
 * - An in-process subagent child never published the parent's service, so its
 *   shutdown is a no-op and the parent's slot survives.
 * - A superseded `/reload` generation no longer owns the slot, so its late
 *   shutdown cannot wipe the new generation's freshly published service.
 */
export function unpublishPermissionsService(service: PermissionsService): void {
  if (getPermissionsService() !== service) {
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- Symbol-keyed global property; Map.delete() is not applicable
  delete (globalThis as Record<symbol, unknown>)[SERVICE_KEY];
}
