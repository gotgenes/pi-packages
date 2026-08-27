import { appendFileSync } from "node:fs";

import {
  EXTENSION_ID,
  type PermissionSystemExtensionConfig,
} from "./extension-config";
import { capLogFieldWidths, resolveReviewLogFieldWidth } from "./log-field-cap";
import {
  OWNER_ONLY_FILE_MODE,
  restrictExistingPathToOwner,
} from "./log-file-permissions";
import { redactedJsonStringify } from "./log-redaction";

export interface PermissionSystemLogger {
  debug: (
    event: string,
    details?: Record<string, unknown>,
  ) => string | undefined;
  review: (
    event: string,
    details?: Record<string, unknown>,
  ) => string | undefined;
}

interface PermissionSystemLoggerOptions {
  getConfig: () => PermissionSystemExtensionConfig;
  debugLogPath: string;
  reviewLogPath: string;
  ensureLogsDirectory: () => string | undefined;
}

export function createPermissionSystemLogger(
  options: PermissionSystemLoggerOptions,
): PermissionSystemLogger {
  const { debugLogPath, reviewLogPath, ensureLogsDirectory } = options;
  // Per-session, so a log inherited from an earlier version is tightened once
  // rather than on every line. Lives in the closure because the factory is
  // re-invoked per session, unlike module scope, which now outlives one.
  const hardened = new Set<string>();

  /**
   * The only place a log line is produced.
   *
   * `maxFieldWidth` bounds every string the line carries; it is supplied for
   * the review stream and withheld for the debug stream, which is opt-in and
   * exists to be read in full. Capping happens before redaction, which masks
   * by key name and so still masks a sensitive value whole.
   */
  const writeLine = (
    stream: "debug" | "review",
    path: string,
    event: string,
    details: Record<string, unknown>,
    maxFieldWidth?: number,
  ): string | undefined => {
    const directoryError = ensureLogsDirectory();
    if (directoryError) {
      return directoryError;
    }

    try {
      const bounded =
        maxFieldWidth === undefined
          ? details
          : capLogFieldWidths(details, maxFieldWidth);
      const line = redactedJsonStringify({
        timestamp: new Date().toISOString(),
        extension: EXTENSION_ID,
        stream,
        event,
        ...bounded,
      });
      if (!line) {
        return `Failed to write permission-system ${stream} log '${path}': event could not be serialized.`;
      }
      appendFileSync(path, `${line}\n`, {
        encoding: "utf-8",
        mode: OWNER_ONLY_FILE_MODE,
      });
      if (!hardened.has(path)) {
        hardened.add(path);
        restrictExistingPathToOwner(path, OWNER_ONLY_FILE_MODE);
      }
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Failed to write permission-system ${stream} log '${path}': ${message}`;
    }
  };

  const debug = (
    event: string,
    details: Record<string, unknown> = {},
  ): string | undefined => {
    if (!options.getConfig().debugLog) {
      return undefined;
    }

    return writeLine("debug", debugLogPath, event, details);
  };

  const review = (
    event: string,
    details: Record<string, unknown> = {},
  ): string | undefined => {
    const config = options.getConfig();
    if (!config.permissionReviewLog) {
      return undefined;
    }

    return writeLine(
      "review",
      reviewLogPath,
      event,
      details,
      resolveReviewLogFieldWidth(config),
    );
  };

  return { debug, review };
}
