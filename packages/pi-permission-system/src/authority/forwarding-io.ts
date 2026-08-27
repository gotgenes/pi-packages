import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

import { asDecisionSource } from "#src/authority/decision-source";
import { isPermissionDecisionState } from "#src/authority/permission-dialog";
import {
  createPermissionForwardingLocation,
  type ForwardedAccessIntent,
  type ForwardedPermissionRequest,
  type ForwardedPermissionResponse,
  type ForwardedSessionApproval,
  type PermissionForwardingLocation,
} from "#src/authority/permission-forwarding";
import {
  OWNER_ONLY_DIRECTORY_MODE,
  OWNER_ONLY_FILE_MODE,
} from "#src/log-file-permissions";
import type { PermissionUiPromptSource } from "#src/permission-events";
import { asPromptPayload } from "#src/presentation/prompt-payload";
import type { DebugReviewLogger } from "#src/session-logger";

/** Valid `permissions:ui_prompt` source values, for tolerant request reads. */
const UI_PROMPT_SOURCES = [
  "tool_call",
  "skill_input",
  "skill_read",
] as const satisfies readonly PermissionUiPromptSource[];

/** Narrow an unknown value to a valid prompt source, or `undefined`. */
function asUiPromptSource(
  value: unknown,
): PermissionUiPromptSource | undefined {
  return UI_PROMPT_SOURCES.find((source) => source === value);
}

/** Narrow an unknown value to a nullable display string, or `undefined`. */
function asNullableDisplayString(value: unknown): string | null | undefined {
  if (value === null || typeof value === "string") {
    return value;
  }
  return undefined;
}

/**
 * Narrow an unknown value to a `ForwardedSessionApproval`, or `undefined`.
 *
 * Tolerant read: the child's session-approval suggestion is optional (absent
 * on an older child) and only accepted when well-formed — a non-empty surface
 * and an all-string patterns array.
 */
function asForwardedSessionApproval(
  value: unknown,
): ForwardedSessionApproval | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const candidate = value as Partial<ForwardedSessionApproval>;
  if (
    typeof candidate.surface !== "string" ||
    candidate.surface.length === 0 ||
    !Array.isArray(candidate.patterns) ||
    !candidate.patterns.every((pattern) => typeof pattern === "string")
  ) {
    return undefined;
  }
  return { surface: candidate.surface, patterns: [...candidate.patterns] };
}

/**
 * Narrow an unknown value to a `ForwardedAccessIntent`, or `undefined`.
 *
 * Tolerant read: the child-fixed access intent is optional (absent on an older
 * child) and only accepted when fully well-formed — a string `surface`, an
 * all-string `matchValues` array, a `string | null` `boundaryValue`, a string
 * `requesterCwd`, and a `principal` with string `sessionId`/`agentName`. Any
 * malformed shape → `undefined`, so the serving node floors to `ask` (Step 3)
 * rather than resolving against corrupt facts.
 */
function asForwardedAccessIntent(
  value: unknown,
): ForwardedAccessIntent | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const candidate = value as {
    surface?: unknown;
    matchValues?: unknown;
    boundaryValue?: unknown;
    requesterCwd?: unknown;
    principal?: unknown;
  };
  if (
    typeof candidate.surface !== "string" ||
    !Array.isArray(candidate.matchValues) ||
    !candidate.matchValues.every((entry) => typeof entry === "string") ||
    !(
      candidate.boundaryValue === null ||
      typeof candidate.boundaryValue === "string"
    ) ||
    typeof candidate.requesterCwd !== "string" ||
    typeof candidate.principal !== "object" ||
    candidate.principal === null
  ) {
    return undefined;
  }
  const principal = candidate.principal as {
    sessionId?: unknown;
    agentName?: unknown;
  };
  if (
    typeof principal.sessionId !== "string" ||
    typeof principal.agentName !== "string"
  ) {
    return undefined;
  }
  return {
    surface: candidate.surface,
    matchValues: [...candidate.matchValues],
    boundaryValue: candidate.boundaryValue,
    requesterCwd: candidate.requesterCwd,
    principal: {
      sessionId: principal.sessionId,
      agentName: principal.agentName,
    },
  };
}

export function formatUnknownErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

export function isErrnoCode(error: unknown, code: string): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === code,
  );
}

/**
 * Log a warning to both the review and debug logs.
 * Pass `null` for `logger` to silently no-op (e.g. in unit tests without IO).
 */
export function logPermissionForwardingWarning(
  logger: DebugReviewLogger | null,
  message: string,
  error?: unknown,
): void {
  const details =
    typeof error === "undefined"
      ? { message }
      : { message, error: formatUnknownErrorMessage(error) };

  logger?.review("permission_forwarding.warning", details);
  logger?.debug("permission_forwarding.warning", details);
}

/**
 * Log an error to both the review and debug logs.
 * Pass `null` for `logger` to silently no-op (e.g. in unit tests without IO).
 */
export function logPermissionForwardingError(
  logger: DebugReviewLogger | null,
  message: string,
  error?: unknown,
): void {
  const details =
    typeof error === "undefined"
      ? { message }
      : { message, error: formatUnknownErrorMessage(error) };

  logger?.review("permission_forwarding.error", details);
  logger?.debug("permission_forwarding.error", details);
}

export function ensureDirectoryExists(
  logger: DebugReviewLogger | null,
  path: string,
  description: string,
): boolean {
  try {
    mkdirSync(path, { recursive: true, mode: OWNER_ONLY_DIRECTORY_MODE });
    return true;
  } catch (error) {
    logPermissionForwardingError(
      logger,
      `Failed to create ${description} directory '${path}'`,
      error,
    );
    return false;
  }
}

export function getPermissionForwardingLocationForSession(
  forwardingDir: string,
  sessionId: string,
): PermissionForwardingLocation {
  return createPermissionForwardingLocation(forwardingDir, sessionId);
}

export function ensurePermissionForwardingLocation(
  logger: DebugReviewLogger | null,
  forwardingDir: string,
  sessionId: string,
): PermissionForwardingLocation | null {
  let location: PermissionForwardingLocation;
  try {
    location = getPermissionForwardingLocationForSession(
      forwardingDir,
      sessionId,
    );
  } catch (error) {
    logPermissionForwardingError(
      logger,
      "Failed to resolve permission forwarding location",
      error,
    );
    return null;
  }

  const sessionRootReady = ensureDirectoryExists(
    logger,
    location.sessionRootDir,
    "permission forwarding session root",
  );
  const requestsReady = ensureDirectoryExists(
    logger,
    location.requestsDir,
    "permission forwarding requests",
  );
  const responsesReady = ensureDirectoryExists(
    logger,
    location.responsesDir,
    "permission forwarding responses",
  );

  return sessionRootReady && requestsReady && responsesReady ? location : null;
}

export function getExistingPermissionForwardingLocation(
  forwardingDir: string,
  sessionId: string,
): PermissionForwardingLocation | null {
  let location: PermissionForwardingLocation;
  try {
    location = getPermissionForwardingLocationForSession(
      forwardingDir,
      sessionId,
    );
  } catch {
    return null;
  }

  return existsSync(location.requestsDir) ? location : null;
}

/**
 * Attempt to remove a directory if it is empty.
 *
 * Returns `true` when the directory is absent after the call (successfully
 * removed, or never existed).  Returns `false` when the directory still exists
 * (non-empty, or a filesystem error prevented removal).
 */
export function tryRemoveDirectoryIfEmpty(
  logger: DebugReviewLogger | null,
  path: string,
  description: string,
): boolean {
  if (!existsSync(path)) {
    return true;
  }

  let entries: string[];
  try {
    entries = readdirSync(path);
  } catch (error) {
    logPermissionForwardingWarning(
      logger,
      `Failed to inspect ${description} directory '${path}'`,
      error,
    );
    return false;
  }

  if (entries.length > 0) {
    return false;
  }

  try {
    rmdirSync(path);
    return true;
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) {
      return true;
    }
    if (isErrnoCode(error, "ENOTEMPTY")) {
      return false;
    }

    logPermissionForwardingWarning(
      logger,
      `Failed to remove empty ${description} directory '${path}'`,
      error,
    );
    return false;
  }
}

export function cleanupPermissionForwardingLocationIfEmpty(
  logger: DebugReviewLogger | null,
  location: PermissionForwardingLocation,
): void {
  // Only remove responses/ when requests/ is already gone — removing responses/
  // while a request is still pending causes the ENOENT write loop (issue #398).
  const requestsGone = tryRemoveDirectoryIfEmpty(
    logger,
    location.requestsDir,
    `${location.label} permission forwarding requests`,
  );
  if (requestsGone) {
    tryRemoveDirectoryIfEmpty(
      logger,
      location.responsesDir,
      `${location.label} permission forwarding responses`,
    );
  }
  tryRemoveDirectoryIfEmpty(
    logger,
    location.sessionRootDir,
    `${location.label} permission forwarding session root`,
  );
}

export function safeDeleteFile(
  logger: DebugReviewLogger | null,
  filePath: string,
  description: string,
): void {
  try {
    unlinkSync(filePath);
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) {
      return;
    }

    logPermissionForwardingWarning(
      logger,
      `Failed to delete ${description} file '${filePath}'`,
      error,
    );
  }
}

export function writeJsonFileAtomic(
  logger: DebugReviewLogger | null,
  filePath: string,
  value: unknown,
): void {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  try {
    // `rename` preserves the temp file's mode, so setting it here is enough —
    // a response overwriting an existing file also comes through a fresh temp.
    writeFileSync(tempPath, JSON.stringify(value), {
      encoding: "utf-8",
      mode: OWNER_ONLY_FILE_MODE,
    });
    renameSync(tempPath, filePath);
  } catch (error) {
    safeDeleteFile(logger, tempPath, "temporary permission-forwarding");
    throw error;
  }
}

export function readForwardedPermissionRequest(
  logger: DebugReviewLogger | null,
  filePath: string,
): ForwardedPermissionRequest | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ForwardedPermissionRequest>;
    if (
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- JSON.parse can return null for the string "null"
      !parsed ||
      typeof parsed.id !== "string" ||
      typeof parsed.createdAt !== "number" ||
      typeof parsed.requesterSessionId !== "string" ||
      typeof parsed.targetSessionId !== "string" ||
      typeof parsed.requesterAgentName !== "string"
    ) {
      logPermissionForwardingWarning(
        logger,
        `Ignoring invalid forwarded permission request format in '${filePath}'`,
      );
      return null;
    }

    return {
      id: parsed.id,
      createdAt: parsed.createdAt,
      requesterSessionId: parsed.requesterSessionId,
      targetSessionId: parsed.targetSessionId,
      requesterAgentName: parsed.requesterAgentName,
      // Tolerant read: the payload and display fields are optional and may be
      // absent (older child) or malformed; reconstruct only the well-formed
      // ones. An older child's `message` is deliberately not salvaged — a
      // skewed ask renders from the fields it does carry (ADR 0011 §9).
      payload: asPromptPayload(parsed.payload),
      source: asUiPromptSource(parsed.source),
      surface: asNullableDisplayString(parsed.surface),
      value: asNullableDisplayString(parsed.value),
      sessionApproval: asForwardedSessionApproval(parsed.sessionApproval),
      accessIntent: asForwardedAccessIntent(parsed.accessIntent),
    };
  } catch (error) {
    logPermissionForwardingWarning(
      logger,
      `Failed to read forwarded permission request '${filePath}'`,
      error,
    );
    return null;
  }
}

export function readForwardedPermissionResponse(
  logger: DebugReviewLogger | null,
  filePath: string,
): ForwardedPermissionResponse | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ForwardedPermissionResponse>;
    if (
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- JSON.parse can return null for the string "null"
      !parsed ||
      typeof parsed.approved !== "boolean" ||
      !isPermissionDecisionState(parsed.state) ||
      typeof parsed.responderSessionId !== "string"
    ) {
      logPermissionForwardingWarning(
        logger,
        `Ignoring invalid forwarded permission response format in '${filePath}'`,
      );
      return null;
    }

    return {
      approved: parsed.approved,
      state: parsed.state,
      denialReason:
        typeof parsed.denialReason === "string"
          ? parsed.denialReason
          : undefined,
      responderSessionId: parsed.responderSessionId,
      respondedAt:
        typeof parsed.respondedAt === "number"
          ? parsed.respondedAt
          : Date.now(),
      // Tolerant like the request's `accessIntent`: an unusable provenance
      // record is dropped, but the decision itself still has to reach the
      // requester, so it never rejects the response.
      decidedBy: asDecisionSource(parsed.decidedBy),
    };
  } catch (error) {
    logPermissionForwardingWarning(
      logger,
      `Failed to read forwarded permission response '${filePath}'`,
      error,
    );
    return null;
  }
}

export function listRequestFiles(
  logger: DebugReviewLogger | null,
  requestsDir: string,
): string[] {
  try {
    return readdirSync(requestsDir)
      .filter((name) => name.endsWith(".json"))
      .sort();
  } catch (error) {
    logPermissionForwardingWarning(
      logger,
      `Failed to read permission forwarding requests from '${requestsDir}'`,
      error,
    );
    return [];
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
