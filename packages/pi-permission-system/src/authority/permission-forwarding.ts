import { join } from "node:path";
import type { DecisionSource } from "#src/authority/decision-source";
import type { PermissionUiPromptSource } from "#src/permission-events";
import type { PromptPayload } from "#src/presentation/prompt-payload";
import type { PermissionDecisionState } from "./permission-dialog";
import type { SubagentSessionRegistry } from "./subagent-registry";

export const PERMISSION_FORWARDING_POLL_INTERVAL_MS = 250;
export const PERMISSION_FORWARDING_TIMEOUT_MS = 10 * 60 * 1000;
/**
 * How long an in-process forwarding target may go unserved before the child
 * gives up on it — eight poll ticks.
 *
 * A window rather than a single check because `ForwardingManager` withdraws and
 * re-announces across a session switch, and a request that arrives inside that
 * gap is about to be picked up. Not configurable: the operator-facing knob is
 * the overall timeout, and this only decides how fast a hopeless wait ends.
 */
export const PERMISSION_FORWARDING_SERVING_GRACE_MS =
  8 * PERMISSION_FORWARDING_POLL_INTERVAL_MS;
/** Ordered list of env var names to check for the parent session ID. First match wins. */
export const SUBAGENT_PARENT_SESSION_ENV_CANDIDATES: readonly string[] = [
  // pi-agent-router (original)
  "PI_AGENT_ROUTER_PARENT_SESSION_ID",
  // Shared convention for CLI-based subagent extensions
  // (nicobailon/pi-subagents, HazAT/pi-interactive-subagents, etc.)
  "PI_SUBAGENT_PARENT_SESSION",
] as const;

/** Per-extension markers set by known process-based subagent extensions. */
const THIRD_PARTY_SUBAGENT_ENV_HINTS = [
  // pi-agent-router (original)
  "PI_IS_SUBAGENT",
  "PI_SUBAGENT_SESSION_ID",
  "PI_AGENT_ROUTER_SUBAGENT",
  // nicobailon/pi-subagents
  "PI_SUBAGENT_CHILD",
  "PI_SUBAGENT_RUN_ID",
  "PI_SUBAGENT_CHILD_AGENT",
  "PI_SUBAGENT_DEPTH",
  // HazAT/pi-interactive-subagents
  "PI_SUBAGENT_NAME",
  "PI_SUBAGENT_ID",
  "PI_SUBAGENT_SESSION",
  "PI_SUBAGENT_ACTIVITY_FILE",
] as const;

/**
 * Env vars whose presence marks the current process as a subagent child.
 *
 * A process that names a parent session is a child by definition, so every
 * parent-session candidate is a detection hint too. That is what makes the
 * subagent adapter convention's single out-of-process obligation — set
 * `PI_SUBAGENT_PARENT_SESSION` — sufficient on its own: an implementation owes
 * the announcement and nothing else, and detection is this package's job.
 */
export const SUBAGENT_ENV_HINT_KEYS: readonly string[] = [
  ...THIRD_PARTY_SUBAGENT_ENV_HINTS,
  ...SUBAGENT_PARENT_SESSION_ENV_CANDIDATES,
];

/** @deprecated Use SUBAGENT_PARENT_SESSION_ENV_CANDIDATES */
export const SUBAGENT_PARENT_SESSION_ENV_KEY =
  SUBAGENT_PARENT_SESSION_ENV_CANDIDATES[0];

const SESSION_FORWARDING_ROOT_DIRECTORY_NAME = "sessions";
const SESSION_FORWARDING_REQUESTS_DIRECTORY_NAME = "requests";
const SESSION_FORWARDING_RESPONSES_DIRECTORY_NAME = "responses";

/**
 * Display fields relayed from a forwarding child to the parent UI so the parent
 * can emit a non-degraded `permissions:ui_prompt` event.
 *
 * Carried separately from the prompt payload because the parent reconstructs
 * the original event from the escalated ask's details (`buildUiPrompt`), not
 * from the payload's own facts.
 */
export interface ForwardedPromptDisplay {
  source: PermissionUiPromptSource;
  surface: string | null;
  value: string | null;
}

/**
 * The child's session-approval suggestion, relayed to the serving node so a
 * human who grants "the whole session" records the same pattern the child
 * would have recorded locally.
 *
 * A plain data shape (not the `SessionApproval` value object) so it serializes
 * onto the forwarded request; the serving node rebuilds a `SessionApproval`
 * from it via `SessionApproval.multiple`.
 */
export interface ForwardedSessionApproval {
  surface: string;
  patterns: readonly string[];
}

/**
 * The child-fixed facts a gate emits: the surface it evaluated and the match
 * set it computed. `requesterCwd` and `principal` are stamped at the escalation
 * edge (`ParentAuthorizer`), so a gate carries only what it alone can produce.
 *
 * Strings only — an `AccessPath` never crosses onto the wire
 * (`docs/decisions/0002-path-values-string-boundary.md`).
 */
export interface ForwardedAccessFacts {
  /** Gate surface: `"path"`, `"external_directory"`, `"bash"`, a tool name, or a skill name. */
  surface: string;
  /**
   * The child-fixed match set. Path surface: `AccessPath.matchValues()`
   * (absolute ∪ cwd-relative ∪ canonical), computed at the child. Non-path
   * surface: the already-portable single value as a one-element array.
   */
  matchValues: string[];
  /** `AccessPath.boundaryValue()` (canonical) for a path surface; `null` for a non-path surface. */
  boundaryValue: string | null;
}

/**
 * The forwarded-wire access intent (ADR 0008 §2): the child-fixed access facts
 * plus the requester identity the escalation edge stamps.
 *
 * The serving node resolves against this intent directly (Step 3, [#597]),
 * using `matchValues` as-is — it never re-derives a path through its own
 * `PathNormalizer`/cwd. See
 * `docs/decisions/0008-cross-session-access-intent.md`.
 */
export interface ForwardedAccessIntent extends ForwardedAccessFacts {
  /** The requester's cwd, for provenance/disclosure — never for parent re-derivation. */
  requesterCwd: string;
  /** Who is requesting. */
  principal: {
    sessionId: string;
    agentName: string;
  };
}

export type ForwardedPermissionRequest = {
  id: string;
  createdAt: number;
  requesterSessionId: string;
  targetSessionId: string;
  requesterAgentName: string;
  /**
   * The child's complete prompt payload (ADR 0011 §2), so the serving node
   * renders the child's own facts under the *parent's* budget rather than
   * relaying a sentence the child assembled under its own configuration.
   *
   * Optional for version-skew tolerance: an older child omits it, and the
   * serving node renders from the display fields it does carry (ADR 0011 §9).
   */
  payload?: PromptPayload;
  /**
   * Original prompt display fields, persisted so the parent emits a
   * non-degraded event. Optional for version-skew tolerance: a parent on a
   * newer version may read a request written by an older child during an
   * upgrade, in which case the reader defaults `source` to `"tool_call"`.
   */
  source?: PermissionUiPromptSource;
  surface?: string | null;
  value?: string | null;
  /**
   * The child's session-approval suggestion. Present when the child computed a
   * "for this session" pattern for the ask; lets the serving node record a
   * whole-session grant. Optional for version-skew tolerance (an older child
   * omits it, and the serving dialog then offers no scope choice).
   */
  sessionApproval?: ForwardedSessionApproval;
  /**
   * The child-fixed access intent (ADR 0008 §2). Optional for version-skew
   * tolerance: an older child omits it, and the serving node floors to `ask`
   * (Step 3). Present on a current child's request for every gate surface.
   */
  accessIntent?: ForwardedAccessIntent;
};

export type ForwardedPermissionResponse = {
  approved: boolean;
  state: PermissionDecisionState;
  denialReason?: string;
  responderSessionId: string;
  respondedAt: number;
  /**
   * What decided, inside the responding session (#726).
   *
   * `responderSessionId` names *where* the decision was made; this names
   * *what* made it, which is the difference between a human at the parent's
   * dialog and the parent's policy answering on their behalf.
   *
   * Optional for version-skew tolerance: an older responder omits it, and the
   * requester records the hop with a `null` inner decision rather than
   * rejecting the answer.
   */
  decidedBy?: DecisionSource;
};

export type PermissionForwardingLocation = {
  sessionId: string;
  sessionRootDir: string;
  requestsDir: string;
  responsesDir: string;
  label: "primary";
};

export function normalizePermissionForwardingSessionId(
  value: unknown,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown") {
    return null;
  }

  return trimmed;
}

/**
 * Make a session id safe to name a path segment.
 *
 * Exported because the forwarding tree has two layouts keyed by session id —
 * `sessions/<id>/` and the serving-heartbeat records beside it — and a second
 * encoding would be a silent way for the two to disagree about which file
 * belongs to which session.
 */
export function encodeSessionIdForPath(sessionId: string): string {
  return encodeURIComponent(sessionId);
}

export function createPermissionForwardingLocation(
  forwardingRootDir: string,
  sessionId: string,
): PermissionForwardingLocation {
  const normalizedSessionId = normalizePermissionForwardingSessionId(sessionId);
  if (!normalizedSessionId) {
    throw new Error(
      "Permission forwarding session id must be a non-empty string.",
    );
  }

  const sessionRootDir = join(
    forwardingRootDir,
    SESSION_FORWARDING_ROOT_DIRECTORY_NAME,
    encodeSessionIdForPath(normalizedSessionId),
  );

  return {
    sessionId: normalizedSessionId,
    sessionRootDir,
    requestsDir: join(
      sessionRootDir,
      SESSION_FORWARDING_REQUESTS_DIRECTORY_NAME,
    ),
    responsesDir: join(
      sessionRootDir,
      SESSION_FORWARDING_RESPONSES_DIRECTORY_NAME,
    ),
    label: "primary",
  };
}

/**
 * How a forwarding target was resolved.
 *
 * `"registry"` is the load-bearing value: it means the requester is an
 * **in-process** child of `sessionId`, so the two share a `globalThis` and the
 * requester may consult the serving-session registry to decide whether anyone
 * is draining its inbox. `"env"` means the target lives in another process,
 * where that signal is unavailable; `"self"` is the UI host owning its own
 * forwarding location.
 */
export type PermissionForwardingTargetSource = "self" | "registry" | "env";

/** The resolved forwarding target together with how it was found. */
export interface PermissionForwardingTarget {
  sessionId: string;
  source: PermissionForwardingTargetSource;
}

export function resolvePermissionForwardingTarget(options: {
  hasUI: boolean;
  isSubagent: boolean;
  currentSessionId?: string | null;
  env?: NodeJS.ProcessEnv;
  /** Child session id for registry lookup. */
  sessionId?: string;
  /** In-process subagent session registry (checked before env vars). */
  registry?: SubagentSessionRegistry;
}): PermissionForwardingTarget | null {
  if (options.hasUI) {
    const own = normalizePermissionForwardingSessionId(
      options.currentSessionId,
    );
    return own === null ? null : { sessionId: own, source: "self" };
  }

  if (!options.isSubagent) {
    return null;
  }

  // 1. Registry — in-process subagents register parentSessionId explicitly.
  if (options.registry && options.sessionId) {
    const entry = options.registry.get(options.sessionId);
    const resolved = normalizePermissionForwardingSessionId(
      entry?.parentSessionId,
    );
    if (resolved) return { sessionId: resolved, source: "registry" };
  }

  // 2. Env vars — process-based subagent extensions.
  const env = options.env ?? process.env;
  for (const key of SUBAGENT_PARENT_SESSION_ENV_CANDIDATES) {
    const resolved = normalizePermissionForwardingSessionId(env[key]);
    if (resolved) return { sessionId: resolved, source: "env" };
  }
  return null;
}

export function isForwardedPermissionRequestForSession(
  request: Pick<ForwardedPermissionRequest, "targetSessionId">,
  sessionId: string | null | undefined,
): boolean {
  const normalizedRequestSessionId = normalizePermissionForwardingSessionId(
    request.targetSessionId,
  );
  const normalizedSessionId = normalizePermissionForwardingSessionId(sessionId);
  return (
    normalizedRequestSessionId !== null &&
    normalizedRequestSessionId === normalizedSessionId
  );
}
