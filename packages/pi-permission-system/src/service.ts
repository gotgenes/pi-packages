/**
 * Cross-extension service accessors backed by `Symbol.for()` on `globalThis`.
 *
 * `Symbol.for()` is process-global by spec, so it survives jiti's per-extension
 * module isolation (`moduleCache: false`). A consumer doing
 * `import("@gotgenes/pi-permission-system")` gets a fresh module copy, but the
 * accessors here read from the same `globalThis` slots the provider wrote to —
 * enabling direct, synchronous, type-safe function calls.
 *
 * There are two slots, because one process can host several **nodes** (one Pi
 * session runtime each — a root session and its in-process subagent children
 * all load their own instance of this extension):
 *
 * - A session-keyed map, written by every node under its own session id.
 *   `getPermissionsService(sessionId)` resolves the service whose
 *   registries that node's own gates and chain read (ADR 0012 decision 2).
 * - A single legacy slot holding the process root's service, read by the
 *   deprecated `getRootPermissionsService()`.
 *
 * Best practice: resolve per use rather than caching the reference — this
 * ensures resilience across `/reload` and load-order edge cases.
 */

import type { Authorizer } from "./authority/authorizer";
import type { ToolAccessExtractor } from "./tool-access-extractor-registry";
import type { ToolInputFormatter } from "./tool-input-formatter-registry";
import type { PermissionCheckResult, PermissionState } from "./types";

export type {
  Authorizer,
  AuthorizerVerdict,
} from "./authority/authorizer";

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
// The declaration bundle already inlines these through `PromptPermissionDetails`
// and `PermissionUiPromptEvent`; the named exports are what a consumer needs to
// annotate a variable of their own.
export type {
  PromptAnnotation,
  PromptEvidence,
  PromptPayload,
  PromptPayloadKind,
  PromptRequester,
  PromptRequestFacts,
} from "./presentation/prompt-payload";
export type { PermissionCheckResult, PermissionState, ToolInputFormatter };

/** Process-global key for the legacy (process-root) service slot. */
const SERVICE_KEY = Symbol.for("@gotgenes/pi-permission-system:service");

/** Process-global key for the session-keyed service map (ADR 0012 decision 2). */
const SESSION_SERVICES_KEY = Symbol.for(
  "@gotgenes/pi-permission-system:session-services",
);

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
 * Public interface exposed to other extensions via
 * {@link getPermissionsService} (or the deprecated
 * {@link getRootPermissionsService}).
 *
 * Each instance belongs to one node, and its three registration surfaces are
 * read by that node alone: extractors and formatters by its own gates, chain
 * links by its own chain. Resolve the service of the node whose behavior you
 * mean to affect.
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
   *                    (`(details, query, log) => verdict`); `log` is an
   *                    {@link AuthorizerLog} for recording a decision trail to
   *                    the shared permission review log.
   */
  registerAuthorizer(
    name: string,
    authorize: Authorizer["authorize"],
  ): () => void;
}

/**
 * Store a `PermissionsService` in the legacy process-root slot, read by
 * `getRootPermissionsService()`.
 *
 * Called at `session_start` by the top-level (parent) instance only — an
 * in-process subagent child skips publishing so it cannot clobber the parent's
 * service. Overwrites any previously published service, which keeps `/reload`
 * working: a reloaded parent re-publishes its fresh service.
 */
export function publishRootPermissionsService(
  service: PermissionsService,
): void {
  (globalThis as Record<symbol, unknown>)[SERVICE_KEY] = service;
}

/**
 * Warned at most once per module copy, so a consumer hears it on its first
 * deprecated call and never again. Under jiti isolation each consumer
 * extension holds its own copy, so each hears it for its own call site.
 */
let warnedDeprecatedAccessor = false;

const DEPRECATED_ACCESSOR_WARNING =
  "getRootPermissionsService() is deprecated: it answers with the process root's " +
  "service, which is the wrong node in every node but the root — inside an " +
  "in-process subagent child it hands back the parent's service, so a " +
  "registration lands where the child's gates never read it and a policy " +
  "query answers against the parent's config. Use " +
  "getPermissionsService(sessionId) with the sessionId from the " +
  "permissions:ready payload. See " +
  "https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/cross-extension-api.md";

/**
 * Retrieve the process root's published `PermissionsService`, or `undefined`
 * if the permission-system extension has not loaded (or has been unloaded).
 *
 * @deprecated Use {@link getPermissionsService} with the `sessionId`
 * from the `permissions:ready` payload. This accessor answers "the process
 * root's service", which is the wrong question in every node but the root.
 * Removal is deferred to a future major (ADR 0012 decision 7).
 */
export function getRootPermissionsService(): PermissionsService | undefined {
  if (!warnedDeprecatedAccessor) {
    warnedDeprecatedAccessor = true;
    process.emitWarning(DEPRECATED_ACCESSOR_WARNING, {
      type: "DeprecationWarning",
      code: "PI_PERMISSION_SYSTEM_DEP0001",
    });
  }
  return readRootService();
}

/**
 * The undeprecated read of the root slot, for this package's own lifecycle.
 *
 * `unpublishRootPermissionsService` must compare identities without warning the
 * host about a call the host did not make.
 */
function readRootService(): PermissionsService | undefined {
  return (globalThis as Record<symbol, unknown>)[SERVICE_KEY] as
    | PermissionsService
    | undefined;
}

/**
 * The process-global map of session id → that node's service, created on first
 * use.
 *
 * Backed by `globalThis` + `Symbol.for()` for the same reason the single slot
 * above is: each session's `ResourceLoader` builds its own jiti instance, so a
 * parent and its in-process child share no module state — only process globals.
 */
function sessionServices(): Map<string, PermissionsService> {
  const store = globalThis as Record<symbol, unknown>;
  const existing = store[SESSION_SERVICES_KEY] as
    | Map<string, PermissionsService>
    | undefined;
  if (existing) {
    return existing;
  }
  const services = new Map<string, PermissionsService>();
  store[SESSION_SERVICES_KEY] = services;
  return services;
}

/**
 * Publish `service` as the service of the node whose session is `sessionId`
 * (ADR 0012 decision 2 — node-locality).
 *
 * Every node publishes under its own key, including an in-process subagent
 * child, so there is nothing to clobber: a child's sibling extension registers
 * an extractor, formatter, or chain link into the registry the child's own
 * gates and chain read.
 */
export function publishPermissionsService(
  sessionId: string,
  service: PermissionsService,
): void {
  sessionServices().set(sessionId, service);
}

/**
 * Retrieve the service belonging to the node whose session is `sessionId`, or
 * `undefined` when that node has published none.
 *
 * This is the supported way to obtain a node's service, for registration and
 * for policy queries alike. Take `sessionId` from the `permissions:ready`
 * payload (or from `ctx.sessionManager.getSessionId()` inside your own session
 * handler), and resolve per use rather than caching the reference.
 *
 * A caller the type checker cannot reach — JavaScript, or a consumer compiled
 * against an earlier major — may still call this with no argument. That answers
 * `undefined` rather than another node's service, and warns once so the missing
 * registration is not silent.
 */
export function getPermissionsService(
  sessionId: string,
): PermissionsService | undefined {
  if (typeof sessionId !== "string") {
    warnMissingSessionId();
    return undefined;
  }
  return sessionServices().get(sessionId);
}

const MISSING_SESSION_ID_WARNING =
  "getPermissionsService() was called without a session id and answered " +
  "undefined. It resolves the service of one node, so it needs the sessionId " +
  "from the permissions:ready payload: getPermissionsService(sessionId). To " +
  "read the process root's service — what the zero-arg call used to do — use " +
  "the deprecated getRootPermissionsService(). See " +
  "https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/cross-extension-api.md";

/**
 * Warned at most once per module copy, like the deprecation guard above, so a
 * consumer polling the locator every turn reports the defect once.
 *
 * Deliberately not a `DeprecationWarning`: an operator who silences those with
 * `--no-deprecation` still needs to hear that a registration never landed.
 */
let warnedMissingSessionId = false;

function warnMissingSessionId(): void {
  if (warnedMissingSessionId) {
    return;
  }
  warnedMissingSessionId = true;
  process.emitWarning(MISSING_SESSION_ID_WARNING, {
    type: "Warning",
    code: "PI_PERMISSION_SYSTEM_WARN0001",
  });
}

/**
 * Remove the `sessionId` entry, but only when it still holds `service`
 * (identity compare-and-delete, like {@link unpublishRootPermissionsService}).
 *
 * Scoping the delete to the publishing instance keeps a superseded `/reload`
 * generation's late shutdown from wiping the new generation's freshly
 * published service.
 */
export function unpublishPermissionsService(
  sessionId: string,
  service: PermissionsService,
): void {
  const services = sessionServices();
  if (services.get(sessionId) === service) {
    services.delete(sessionId);
  }
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
export function unpublishRootPermissionsService(
  service: PermissionsService,
): void {
  if (readRootService() !== service) {
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- Symbol-keyed global property; Map.delete() is not applicable
  delete (globalThis as Record<symbol, unknown>)[SERVICE_KEY];
}
