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

import type { Authorizer } from "./authority/authorizer";
import type { ToolAccessExtractor } from "./tool-access-extractor-registry";
import type { ToolInputFormatter } from "./tool-input-formatter-registry";
import type { PermissionCheckResult, PermissionState } from "./types";

export type {
  Authorizer,
  AuthorizerVerdict,
} from "./authority/authorizer";
export { isAuthorizerAlreadyRegisteredError } from "./authority/authorizer-registry";
export { isRegisteredSubagentChild } from "./authority/subagent-context";

/**
 * The narrow review-log seam handed to a chain link at `authorize` time
 * (ADR 0007 §3, same injection pattern as {@link PermissionQuery}).
 *
 * A link uses it to record a positive decision trail to the permission review
 * log — `review` for the durable, default-on audit entry (one per handled
 * ask), `debug` for verbose or short-circuit detail gated behind the
 * `debugLog` toggle. The session's own logger is passed straight through, so a
 * link's entries land in the same `pi-permission-system-permission-review.jsonl`
 * as the gate decisions, keying to a gate entry by `requestId`.
 */
export interface AuthorizerLog {
  review(event: string, details?: Record<string, unknown>): void;
  debug(event: string, details?: Record<string, unknown>): void;
}
export type { PromptPermissionDetails } from "./authority/permission-prompter";
export type {
  ForwardedPromptContext,
  PermissionDecisionEvent,
  PermissionsReadyEvent,
  PermissionUiPromptEvent,
  PermissionUiPromptSource,
} from "./permission-events";
export {
  PERMISSIONS_DECISION_CHANNEL,
  PERMISSIONS_READY_CHANNEL,
  PERMISSIONS_UI_PROMPT_CHANNEL,
} from "./permission-events";
export type { PermissionCheckResult, PermissionState, ToolInputFormatter };

/** Process-global key for the service slot. */
const SERVICE_KEY = Symbol.for("@gotgenes/pi-permission-system:service");

/**
 * The narrow, read-only projection of {@link PermissionsService}: answer a
 * policy query for a surface, and report a tool-level state. This is the
 * capability an Authorizer chain link is handed (ISP) — it never sees the
 * registration surface.
 */
export interface PermissionQuery {
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
 * Public interface exposed to other extensions via `getPermissionsService()`.
 *
 * `checkPermission` takes a surface + optional value + optional agent name,
 * and delegates to `PermissionManager.checkPermission()` with current session
 * rules internally.
 */
export interface PermissionsService extends PermissionQuery {
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
   * Register a custom access-intent extractor for a specific tool name.
   *
   * The extractor declares the filesystem path a tool will access so the
   * cross-cutting `path` and `external_directory` gates can see it. Use it for
   * tools whose path lives under a non-standard key — built-in file tools and
   * any tool exposing `input.path` (plus MCP via `input.arguments.path`) are
   * already covered by convention without registration.
   *
   * The extractor receives the raw `input` record and returns the path string,
   * or `undefined` to decline. Only one extractor may be registered per tool
   * name — a second call for the same name throws. The returned disposer
   * unregisters the extractor.
   *
   * @param toolName  - Exact tool name to register for (e.g. `"ffgrep"`).
   * @param extractor - Receives the raw `input` record; return the path string,
   *                    or `undefined` to decline.
   */
  registerToolAccessExtractor(
    toolName: string,
    extractor: ToolAccessExtractor,
  ): () => void;

  /**
   * Register a named live-authority chain link (ADR 0007 §4).
   *
   * A link reviews an `ask` and returns `allow` / `deny` (with an optional
   * teaching `reason`) / `defer`. It is handed a narrow, session-scoped
   * {@link PermissionQuery} at `authorize` time so it can query the
   * deterministic engine at gate parity. Register from a `permissions:ready`
   * handler so registration is robust to load order and survives `/reload`.
   *
   * Registration alone grants **no authority**: the link decides nothing until
   * the operator names it in the `authorizerChain` config (opt-in activation),
   * and the chain owner caps every verdict with the bounded-delegation
   * checkpoint (an `allow` on an excluded surface downgrades to `defer`). Only
   * one link may be registered per name — a second call for the same name
   * throws. The returned disposer unregisters the link.
   *
   * @param name      - Operator-facing link name referenced from `authorizerChain`.
   * @param authorize - The link's decision callback
   *                    (`(details, query, log, signal?) => verdict`); `log` is
   *                    an {@link AuthorizerLog} for recording a decision trail
   *                    to the shared permission review log, and `signal` is the
   *                    active session's `ctx.signal` so long-running link work
   *                    can cancel promptly when the session is interrupted.
   */
  registerAuthorizer(
    name: string,
    authorize: Authorizer["authorize"],
  ): () => void;
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
