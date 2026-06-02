import { join } from "node:path";

import type { PermissionDecisionState } from "./permission-dialog";
import type { PermissionUiPromptSource } from "./permission-events";
import type { SubagentSessionRegistry } from "./subagent-registry";

export const PERMISSION_FORWARDING_POLL_INTERVAL_MS = 250;
export const PERMISSION_FORWARDING_TIMEOUT_MS = 10 * 60 * 1000;
export const SUBAGENT_ENV_HINT_KEYS = [
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
/** Ordered list of env var names to check for the parent session ID. First match wins. */
export const SUBAGENT_PARENT_SESSION_ENV_CANDIDATES: readonly string[] = [
  // pi-agent-router (original)
  "PI_AGENT_ROUTER_PARENT_SESSION_ID",
  // Shared convention for CLI-based subagent extensions
  // (nicobailon/pi-subagents, HazAT/pi-interactive-subagents, etc.)
  "PI_SUBAGENT_PARENT_SESSION",
] as const;

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
 * Carried separately from the prompt message because the parent reconstructs
 * the original event through `buildForwardedUiPrompt`, not from the message text.
 */
export interface ForwardedPromptDisplay {
  source: PermissionUiPromptSource;
  surface: string | null;
  value: string | null;
}

export type ForwardedPermissionRequest = {
  id: string;
  createdAt: number;
  requesterSessionId: string;
  targetSessionId: string;
  requesterAgentName: string;
  message: string;
  /**
   * Original prompt display fields, persisted so the parent emits a
   * non-degraded event. Optional for version-skew tolerance: a parent on a
   * newer version may read a request written by an older child during an
   * upgrade, in which case the reader defaults `source` to `"tool_call"`.
   */
  source?: PermissionUiPromptSource;
  surface?: string | null;
  value?: string | null;
};

export type ForwardedPermissionResponse = {
  approved: boolean;
  state: PermissionDecisionState;
  denialReason?: string;
  responderSessionId: string;
  respondedAt: number;
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

function encodeSessionIdForPath(sessionId: string): string {
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

export function resolvePermissionForwardingTargetSessionId(options: {
  hasUI: boolean;
  isSubagent: boolean;
  currentSessionId?: string | null;
  env?: NodeJS.ProcessEnv;
  /** Child session id for registry lookup. */
  sessionId?: string;
  /** In-process subagent session registry (checked before env vars). */
  registry?: SubagentSessionRegistry;
}): string | null {
  if (options.hasUI) {
    return normalizePermissionForwardingSessionId(options.currentSessionId);
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
    if (resolved) return resolved;
  }

  // 2. Env vars — process-based subagent extensions.
  const env = options.env ?? process.env;
  for (const key of SUBAGENT_PARENT_SESSION_ENV_CANDIDATES) {
    const resolved = normalizePermissionForwardingSessionId(env[key]);
    if (resolved) return resolved;
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
