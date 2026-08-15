import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEBUG_LOG_FILENAME, REVIEW_LOG_FILENAME } from "#src/config-paths";
import {
  DEFAULT_EXTENSION_CONFIG,
  type PermissionSystemExtensionConfig,
} from "#src/extension-config";
import type { SessionLoggerDeps } from "#src/session-logger";
import { PermissionSessionLogger } from "#src/session-logger";

// ── helpers ────────────────────────────────────────────────────────────────

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ps-session-logger-"));
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Spy on a process stream's `write`, suppressing real output and recording calls. */
function spyOnStream(name: "stdout" | "stderr") {
  return vi.spyOn(process[name], "write").mockImplementation(() => true);
}

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

  // ── file permissions ──────────────────────────────────────────────────────

  describe("file permissions", () => {
    it("creates the review log owner-only", () => {
      new PermissionSessionLogger(makeDeps()).review(
        "permission_request.waiting",
        { toolName: "write" },
      );

      expect(statSync(join(tempDir, REVIEW_LOG_FILENAME)).mode & 0o777).toBe(
        0o600,
      );
    });

    it("creates the debug log owner-only", () => {
      new PermissionSessionLogger(
        makeDeps({
          getConfig: () => ({ ...DEFAULT_EXTENSION_CONFIG, debugLog: true }),
        }),
      ).debug("permission.decision", { toolName: "write" });

      expect(statSync(join(tempDir, DEBUG_LOG_FILENAME)).mode & 0o777).toBe(
        0o600,
      );
    });

    it("tightens a log inherited from an earlier version on next write", () => {
      const reviewLogPath = join(tempDir, REVIEW_LOG_FILENAME);
      writeFileSync(reviewLogPath, "{}\n", "utf-8");
      chmodSync(reviewLogPath, 0o644);

      new PermissionSessionLogger(makeDeps()).review(
        "permission_request.waiting",
        { toolName: "write" },
      );

      expect(statSync(reviewLogPath).mode & 0o777).toBe(0o600);
    });
  });

  // ── logging destination ─────────────────────────────────────────────────

  describe("logging destination", () => {
    it("writes review lines to stderr instead of a file", () => {
      const stderr = spyOnStream("stderr");
      const deps = makeDeps({
        getConfig: () => ({
          ...DEFAULT_EXTENSION_CONFIG,
          logging: { destination: "stderr" },
        }),
      });

      new PermissionSessionLogger(deps).review("permission.granted", {
        agentName: "coder",
      });

      expect(existsSync(join(tempDir, REVIEW_LOG_FILENAME))).toBe(false);
      expect(stderr).toHaveBeenCalledOnce();
      const line = String(stderr.mock.calls[0][0]);
      expect(line.endsWith("\n")).toBe(true);
      expect(JSON.parse(line)).toMatchObject({
        stream: "review",
        event: "permission.granted",
        agentName: "coder",
      });
      expect(deps.notify).not.toHaveBeenCalled();
    });

    it("routes debug lines to stdout when destination is stdout", () => {
      const stdout = spyOnStream("stdout");
      const deps = makeDeps({
        getConfig: () => ({
          ...DEFAULT_EXTENSION_CONFIG,
          debugLog: true,
          logging: { destination: "stdout" },
        }),
      });

      new PermissionSessionLogger(deps).debug("permission.decision", {
        toolName: "write",
      });

      expect(existsSync(join(tempDir, DEBUG_LOG_FILENAME))).toBe(false);
      expect(stdout).toHaveBeenCalledOnce();
      expect(JSON.parse(String(stdout.mock.calls[0][0]))).toMatchObject({
        stream: "debug",
        event: "permission.decision",
      });
    });

    it("keeps logging on a read-only filesystem when destination is a stream", () => {
      // The whole point of the feature: the default logs directory cannot be
      // created, but a stream destination never tries to, so no warning fires.
      const stderr = spyOnStream("stderr");
      const deps = makeDeps({
        globalLogsDir: makeBlockedLogsDir(),
        getConfig: () => ({
          ...DEFAULT_EXTENSION_CONFIG,
          logging: { destination: "stderr" },
        }),
      });

      new PermissionSessionLogger(deps).review("permission_request.waiting", {
        toolName: "write",
      });

      expect(stderr).toHaveBeenCalledOnce();
      expect(deps.notify).not.toHaveBeenCalled();
    });

    it("writes to a configured file directory instead of the default logs dir", () => {
      const customDir = join(tempDir, "nested", "custom-logs");
      const deps = makeDeps({
        getConfig: () => ({
          ...DEFAULT_EXTENSION_CONFIG,
          logging: { destination: "file", directory: customDir },
        }),
      });

      new PermissionSessionLogger(deps).review("permission.granted");

      expect(existsSync(join(tempDir, REVIEW_LOG_FILENAME))).toBe(false);
      expect(existsSync(join(customDir, REVIEW_LOG_FILENAME))).toBe(true);
      expect(deps.notify).not.toHaveBeenCalled();
    });

    it("defaults to the file destination when no logging config is present", () => {
      new PermissionSessionLogger(makeDeps()).review("permission.granted");

      expect(readdirSync(tempDir)).toContain(REVIEW_LOG_FILENAME);
    });

    it("follows a mid-session switch from file to stderr", () => {
      const stderr = spyOnStream("stderr");
      let destination: "file" | "stderr" = "file";
      const deps = makeDeps({
        getConfig: () => ({
          ...DEFAULT_EXTENSION_CONFIG,
          logging: { destination },
        }),
      });
      const logger = new PermissionSessionLogger(deps);

      logger.review("first.event");
      expect(readFileSync(join(tempDir, REVIEW_LOG_FILENAME), "utf8")).toMatch(
        /first\.event/,
      );

      destination = "stderr";
      logger.review("second.event");
      expect(stderr).toHaveBeenCalledOnce();
      expect(String(stderr.mock.calls[0][0])).toMatch(/second\.event/);
      // The file did not gain the second line.
      expect(
        readFileSync(join(tempDir, REVIEW_LOG_FILENAME), "utf8"),
      ).not.toMatch(/second\.event/);
    });
  });
});
