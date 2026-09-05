import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEBUG_LOG_FILENAME,
  REVIEW_LOG_FILENAME,
} from "#src/config/config-paths";
import {
  DEFAULT_EXTENSION_CONFIG,
  type PermissionSystemExtensionConfig,
} from "#src/config/extension-config";
import type { SessionLoggerDeps } from "#src/logging/session-logger";
import { PermissionSessionLogger } from "#src/logging/session-logger";

// ── helpers ────────────────────────────────────────────────────────────────

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ps-session-logger-"));
});

function makeDeps(
  overrides: {
    globalLogsDir?: string;
    getConfig?: () => PermissionSystemExtensionConfig;
  } = {},
) {
  return {
    globalLogsDir: overrides.globalLogsDir ?? tempDir,
    getConfig:
      overrides.getConfig ??
      ((): PermissionSystemExtensionConfig => ({
        ...DEFAULT_EXTENSION_CONFIG,
      })),
    notify: vi.fn<(message: string) => void>(),
  };
}

/** A `globalLogsDir` that cannot be created: a file at the parent path blocks it. */
function makeBlockedLogsDir(): string {
  const barrier = join(tempDir, "barrier");
  writeFileSync(barrier, "");
  return join(barrier, "logs");
}

// ── PermissionSessionLogger ────────────────────────────────────────────────────

describe("PermissionSessionLogger", () => {
  // ── debug ────────────────────────────────────────────────────────────────

  describe("debug", () => {
    it("writes a JSONL line to the debug log file when debugLog is true", () => {
      const deps = makeDeps({
        getConfig: () => ({ ...DEFAULT_EXTENSION_CONFIG, debugLog: true }),
      });
      const logger = new PermissionSessionLogger(deps);

      logger.debug("test.event", { key: "value" });

      expect(existsSync(join(tempDir, DEBUG_LOG_FILENAME))).toBe(true);
      expect(deps.notify).not.toHaveBeenCalled();
    });

    it("does not write to the debug log when debugLog is false", () => {
      // DEFAULT_EXTENSION_CONFIG.debugLog === false
      const deps = makeDeps();
      const logger = new PermissionSessionLogger(deps);

      logger.debug("test.event");

      expect(existsSync(join(tempDir, DEBUG_LOG_FILENAME))).toBe(false);
      expect(deps.notify).not.toHaveBeenCalled();
    });

    it("reads getConfig at write time — a mid-session toggle change takes effect", () => {
      let debugLog = true;
      const deps = makeDeps({
        getConfig: () => ({ ...DEFAULT_EXTENSION_CONFIG, debugLog }),
      });
      const logger = new PermissionSessionLogger(deps);
      debugLog = false;

      logger.debug("test.event");

      expect(existsSync(join(tempDir, DEBUG_LOG_FILENAME))).toBe(false);
    });
  });

  // ── review ───────────────────────────────────────────────────────────────

  describe("review", () => {
    it("writes a JSONL line to the review log file when permissionReviewLog is true", () => {
      // DEFAULT_EXTENSION_CONFIG.permissionReviewLog === true
      const deps = makeDeps();
      const logger = new PermissionSessionLogger(deps);

      logger.review("permission.granted", { agentName: "coder" });

      expect(existsSync(join(tempDir, REVIEW_LOG_FILENAME))).toBe(true);
      expect(deps.notify).not.toHaveBeenCalled();
    });

    it("does not write to the review log when permissionReviewLog is false", () => {
      const deps = makeDeps({
        getConfig: () => ({
          ...DEFAULT_EXTENSION_CONFIG,
          permissionReviewLog: false,
        }),
      });
      const logger = new PermissionSessionLogger(deps);

      logger.review("permission.granted");

      expect(existsSync(join(tempDir, REVIEW_LOG_FILENAME))).toBe(false);
      expect(deps.notify).not.toHaveBeenCalled();
    });
  });

  // ── IO-failure warnings ───────────────────────────────────────────────────

  describe("IO-failure warnings", () => {
    it("calls notify with the error message when the logs directory cannot be created", () => {
      const deps = makeDeps({
        globalLogsDir: makeBlockedLogsDir(),
        getConfig: () => ({ ...DEFAULT_EXTENSION_CONFIG, debugLog: true }),
      });
      const logger = new PermissionSessionLogger(deps);

      logger.debug("test.event");

      expect(deps.notify).toHaveBeenCalledOnce();
      expect(deps.notify).toHaveBeenCalledWith(
        expect.stringContaining("Failed to"),
      );
    });

    it("deduplicates the same IO-failure warning across multiple writes", () => {
      const deps = makeDeps({
        globalLogsDir: makeBlockedLogsDir(),
        getConfig: () => ({ ...DEFAULT_EXTENSION_CONFIG, debugLog: true }),
      });
      const logger = new PermissionSessionLogger(deps);

      logger.debug("event.one");
      logger.debug("event.two");

      expect(deps.notify).toHaveBeenCalledOnce();
    });

    it("shares the dedup set across debug and review — same message notified only once", () => {
      const deps = makeDeps({
        globalLogsDir: makeBlockedLogsDir(),
        getConfig: () => ({
          ...DEFAULT_EXTENSION_CONFIG,
          debugLog: true,
          permissionReviewLog: true,
        }),
      });
      const logger = new PermissionSessionLogger(deps);

      logger.debug("event.one"); // emits warning
      logger.review("event.two"); // same error message → suppressed

      expect(deps.notify).toHaveBeenCalledOnce();
    });
  });

  // ── warn ──────────────────────────────────────────────────────────────────

  describe("warn", () => {
    it("calls notify with the message directly", () => {
      const deps = makeDeps();
      const logger = new PermissionSessionLogger(deps);

      logger.warn("Something went wrong");

      expect(deps.notify).toHaveBeenCalledWith("Something went wrong");
    });

    it("calls notify for every warn — not deduplicated", () => {
      const deps = makeDeps();
      const logger = new PermissionSessionLogger(deps);

      logger.warn("same message");
      logger.warn("same message");

      expect(deps.notify).toHaveBeenCalledTimes(2);
    });

    it("does not throw when notify is a no-op", () => {
      const deps: SessionLoggerDeps = {
        globalLogsDir: tempDir,
        getConfig: () => ({ ...DEFAULT_EXTENSION_CONFIG }),
        notify: () => {},
      };
      const logger = new PermissionSessionLogger(deps);

      expect(() => logger.warn("test")).not.toThrow();
    });
  });
});
