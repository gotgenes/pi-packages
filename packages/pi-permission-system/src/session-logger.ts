import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { DEBUG_LOG_FILENAME, REVIEW_LOG_FILENAME } from "./config-paths";
import { expandHomePath } from "./expand-home";
import {
  ensurePermissionSystemLogsDirectory,
  type PermissionSystemExtensionConfig,
} from "./extension-config";
import {
  OWNER_ONLY_FILE_MODE,
  restrictExistingPathToOwner,
} from "./log-file-permissions";
import {
  createPermissionSystemLogger,
  type LogStream,
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
 * Logging seam for consumers that write both debug and review entries.
 * Injected into `ConfigStore`, `ParentAuthorizer`, and `ForwardedRequestServer`.
 */
export interface DebugReviewLogger extends ReviewLogger {
  debug(event: string, details?: Record<string, unknown>): void;
}

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
  /**
   * Default logs directory for the `file` destination; the debug + review log
   * file paths derive from it. A configured `logging.directory` overrides it.
   */
  globalLogsDir: string;
  /**
   * Reads current config at call time — for the debug/review write toggles and
   * the `logging` destination, so a mid-session reload takes effect.
   */
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
  private readonly globalLogsDir: string;
  private readonly getConfig: () => PermissionSystemExtensionConfig;
  // Tightens a log inherited from an earlier version to owner-only on its first
  // write rather than on every line. Per-session, like the logger itself.
  private readonly hardened = new Set<string>();

  constructor(deps: SessionLoggerDeps) {
    this.globalLogsDir = deps.globalLogsDir;
    this.getConfig = deps.getConfig;
    this.notify = deps.notify;
    this.writer = createPermissionSystemLogger({
      getConfig: deps.getConfig,
      emit: (stream, line) => this.emit(stream, line),
    });
  }

  /**
   * Route one line to the configured destination, re-read each write so a
   * mid-session reload takes effect. A `stdout`/`stderr` destination creates no
   * directory — the fix for a read-only filesystem where the default logs
   * directory cannot be made.
   */
  private emit(stream: LogStream, line: string): string | undefined {
    const logging = this.getConfig().logging;
    const destination = logging?.destination ?? "file";
    if (destination === "stdout") {
      process.stdout.write(`${line}\n`);
      return undefined;
    }
    if (destination === "stderr") {
      process.stderr.write(`${line}\n`);
      return undefined;
    }

    const dir = logging?.directory
      ? expandHomePath(logging.directory)
      : this.globalLogsDir;
    const directoryError = ensurePermissionSystemLogsDirectory(dir);
    if (directoryError) {
      return directoryError;
    }

    const path = join(
      dir,
      stream === "debug" ? DEBUG_LOG_FILENAME : REVIEW_LOG_FILENAME,
    );
    try {
      appendFileSync(path, `${line}\n`, {
        encoding: "utf-8",
        mode: OWNER_ONLY_FILE_MODE,
      });
      if (!this.hardened.has(path)) {
        this.hardened.add(path);
        restrictExistingPathToOwner(path, OWNER_ONLY_FILE_MODE);
      }
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Failed to write permission-system ${stream} log '${path}': ${message}`;
    }
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
