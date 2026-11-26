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
import { z } from "zod";
import {
  OWNER_ONLY_DIRECTORY_MODE,
  OWNER_ONLY_FILE_MODE,
} from "#src/logging/log-file-permissions";
import type { DebugReviewLogger } from "#src/logging/session-logger";
import {
  type ApprovalGrant,
  isSessionGrantWidth,
} from "#src/session/approval-grant";
import { asDecisionSource } from "./decision-source";
import {
  approvalGrantSchema,
  forwardedPermissionRequestSchema,
} from "./forwarded-request-schema";
import { isPermissionDecisionState } from "./permission-dialog";
import {
  createPermissionForwardingLocation,
  type ForwardedPermissionRequest,
  type ForwardedPermissionResponse,
  type PermissionForwardingLocation,
} from "./permission-forwarding";
import {
  retryOnTransientFsError,
  type TransientFsRetryRecord,
} from "./transient-fs-retry";

/**
 * Read a response's narrowed grants, granting nothing when they are malformed.
 *
 * Unlike every other tolerant field here, a dropped list is not the restrictive
 * reading: absence means "the requester's own suggestion", which is the wider
 * grant the narrowing removed. So a list that cannot be read is read as empty,
 * and the decision still reaches the requester.
 */
function asNarrowedGrants(value: unknown): ApprovalGrant[] {
  const parsed = z.array(approvalGrantSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
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
    recordFsRetry(
      logger,
      "mkdir",
      path,
      retryOnTransientFsError(() => {
        mkdirSync(path, { recursive: true, mode: OWNER_ONLY_DIRECTORY_MODE });
      }),
    );
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
    // The temp write is deliberately outside the retry: its failure shape is a
    // write-denied directory, which no number of attempts resolves.
    writeFileSync(tempPath, JSON.stringify(value), {
      encoding: "utf-8",
      mode: OWNER_ONLY_FILE_MODE,
    });
    recordFsRetry(
      logger,
      "rename",
      filePath,
      retryOnTransientFsError(() => {
        renameSync(tempPath, filePath);
      }),
    );
  } catch (error) {
    safeDeleteFile(logger, tempPath, "temporary permission-forwarding");
    throw error;
  }
}

/**
 * Record a filesystem operation that only succeeded after retrying.
 *
 * Debug-only: a recovered write decided nothing, so it does not belong in the
 * permission-decision record — but `attempts` and `code` are the whole
 * diagnosis when a host keeps losing writes, and `debugLog` is exactly the
 * switch a user reaching for that diagnosis turns on.
 */
function recordFsRetry(
  logger: DebugReviewLogger | null,
  operation: "rename" | "mkdir",
  path: string,
  record: TransientFsRetryRecord,
): void {
  if (record.attempts === 1) {
    return;
  }
  logger?.debug("permission_forwarding.fs_retried", {
    operation,
    path,
    attempts: record.attempts,
    code: record.code,
  });
}

export function readForwardedPermissionRequest(
  logger: DebugReviewLogger | null,
  filePath: string,
): ForwardedPermissionRequest | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(filePath, "utf-8"));
    const parsed = forwardedPermissionRequestSchema.safeParse(raw);
    if (!parsed.success) {
      logPermissionForwardingWarning(
        logger,
        `Ignoring invalid forwarded permission request format in '${filePath}'`,
        z.prettifyError(parsed.error),
      );
      return null;
    }
    return parsed.data;
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
      // Tolerant for the same reason, and least-privilege when it fires: a
      // dropped width records the grant on the surface the gate proved.
      sessionGrantWidth: isSessionGrantWidth(parsed.sessionGrantWidth)
        ? parsed.sessionGrantWidth
        : undefined,
      ...(parsed.narrowedGrants === undefined
        ? {}
        : { narrowedGrants: asNarrowedGrants(parsed.narrowedGrants) }),
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
