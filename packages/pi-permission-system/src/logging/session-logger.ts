import { join } from "node:path";
import { DEBUG_LOG_FILENAME, REVIEW_LOG_FILENAME } from "#src/config-paths";
import {
  ensurePermissionSystemLogsDirectory,
  type PermissionSystemExtensionConfig,
} from "#src/extension-config";
import {
  createPermissionSystemLogger,
  type PermissionSystemLogger,
} from "./logging";

/**
 * Narrowest logging seam — consumers that only write review-log entries.
 * Injected into `PermissionPrompter` and the RPC handlers.
 */
export interface ReviewLogger {
  review(event: string, details?: Record<string, unknown>): void;
}

/**
 * Narrowest logging seam — consumers that only write debug-log entries.
 * Injected into `AgentPrepHandler`.
 */
export interface DebugLogger {
  debug(event: string, details?: Record<string, unknown>): void;
}

/**
 * Logging seam for consumers that write both debug and review entries.
 * Injected into `ConfigStore`, `ParentAuthorizer`, and `ForwardedRequestServer`.
 */
export interface DebugReviewLogger extends ReviewLogger, DebugLogger {}

/**
 * Unified logging + notification surface for handler deps.
 *
 * Replaces three separate logging fields (`writeDebugLog`,
 * `writeReviewLog`, `notifyWarning`) with a single typed collaborator.
 * This is an intermediate abstraction on the path to PermissionSession (#129).
 */
export interface SessionLogger extends DebugReviewLogger {
  warn(message: string): void;
}

/** Narrow dependencies for constructing a {@link SessionLogger}. */
export interface SessionLoggerDeps {
  /** Root logs directory; the debug + review log file paths derive from it. */
  globalLogsDir: string;
  /** Reads current config for the debug/review write toggles (call-time). */
  getConfig: () => PermissionSystemExtensionConfig;
  /** Surfaces a warning message to the user; called at warn/IO-failure time. */
  notify: (message: string) => void;
}

/**
 * Concrete `SessionLogger` implementation.
 *
 * Composes the JSONL log writer, privately owns the IO-failure warning
 * dedup Set, and routes both IO-failure warnings and explicit warn() calls
 * through the injected notify sink. No ExtensionRuntime reference required.
 */
export class PermissionSessionLogger implements SessionLogger {
  private readonly writer: PermissionSystemLogger;
  private readonly reported = new Set<string>();
  private readonly notify: (message: string) => void;

  constructor(deps: SessionLoggerDeps) {
    this.writer = createPermissionSystemLogger({
      getConfig: deps.getConfig,
      debugLogPath: join(deps.globalLogsDir, DEBUG_LOG_FILENAME),
      reviewLogPath: join(deps.globalLogsDir, REVIEW_LOG_FILENAME),
      ensureLogsDirectory: () =>
        ensurePermissionSystemLogsDirectory(deps.globalLogsDir),
    });
    this.notify = deps.notify;
  }

  debug(event: string, details?: Record<string, unknown>): void {
    const warning = this.writer.debug(event, details);
    if (warning) this.reportOnce(warning);
  }

  review(event: string, details?: Record<string, unknown>): void {
    const warning = this.writer.review(event, details);
    if (warning) this.reportOnce(warning);
  }

  warn(message: string): void {
    this.notify(message);
  }

  private reportOnce(warning: string): void {
    if (this.reported.has(warning)) return;
    this.reported.add(warning);
    this.notify(warning);
  }
}
