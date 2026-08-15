import {
  EXTENSION_ID,
  type PermissionSystemExtensionConfig,
} from "./extension-config";
import { redactedJsonStringify } from "./log-redaction";

/** The two log streams the extension emits. Each line is tagged with its value. */
export type LogStream = "debug" | "review";

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
  /**
   * Write one already-serialized, newline-free line to its destination.
   *
   * Owns everything destination-specific (file vs stdout/stderr) and returns a
   * human-readable error message on failure, or `undefined` on success. Called
   * per line so a mid-session config reload can redirect the destination.
   */
  emit: (stream: LogStream, line: string) => string | undefined;
}

export function createPermissionSystemLogger(
  options: PermissionSystemLoggerOptions,
): PermissionSystemLogger {
  const writeLine = (
    stream: LogStream,
    event: string,
    details: Record<string, unknown>,
  ): string | undefined => {
    const line = redactedJsonStringify({
      timestamp: new Date().toISOString(),
      extension: EXTENSION_ID,
      stream,
      event,
      ...details,
    });
    if (!line) {
      return `Failed to write permission-system ${stream} log: event could not be serialized.`;
    }
    return options.emit(stream, line);
  };

  const debug = (
    event: string,
    details: Record<string, unknown> = {},
  ): string | undefined => {
    if (!options.getConfig().debugLog) {
      return undefined;
    }

    return writeLine("debug", event, details);
  };

  const review = (
    event: string,
    details: Record<string, unknown> = {},
  ): string | undefined => {
    if (!options.getConfig().permissionReviewLog) {
      return undefined;
    }

    return writeLine("review", event, details);
  };

  return { debug, review };
}
