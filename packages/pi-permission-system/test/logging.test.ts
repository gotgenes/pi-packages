import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  DEFAULT_EXTENSION_CONFIG,
  type PermissionSystemExtensionConfig,
} from "#src/extension-config";
import { createPermissionSystemLogger } from "#src/logging";

describe("createPermissionSystemLogger", () => {
  let baseDir: string;
  let logsDir: string;
  let debugLogPath: string;
  let reviewLogPath: string;
  let config: PermissionSystemExtensionConfig;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "pi-permission-system-logs-"));
    logsDir = join(baseDir, "logs");
    debugLogPath = join(logsDir, "debug.jsonl");
    reviewLogPath = join(logsDir, "review.jsonl");
    config = { ...DEFAULT_EXTENSION_CONFIG };
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  function makeLogger() {
    return createPermissionSystemLogger({
      getConfig: () => config,
      debugLogPath,
      reviewLogPath,
      ensureLogsDirectory: () => {
        mkdirSync(logsDir, { recursive: true });
        return undefined;
      },
    });
  }

  describe("file permissions", () => {
    test("creates the review log owner-only", () => {
      makeLogger().review("permission_request.waiting", { toolName: "write" });

      expect(statSync(reviewLogPath).mode & 0o777).toBe(0o600);
    });

    test("creates the debug log owner-only", () => {
      config.debugLog = true;
      makeLogger().debug("permission.decision", { toolName: "write" });

      expect(statSync(debugLogPath).mode & 0o777).toBe(0o600);
    });

    test("tightens a log inherited from an earlier version on next write", () => {
      mkdirSync(logsDir, { recursive: true });
      writeFileSync(reviewLogPath, "{}\n", "utf-8");
      chmodSync(reviewLogPath, 0o644);

      makeLogger().review("permission_request.waiting", { toolName: "write" });

      expect(statSync(reviewLogPath).mode & 0o777).toBe(0o600);
    });
  });

  describe("redaction", () => {
    test("masks sensitive-keyed values before they reach the review log", () => {
      const logger = makeLogger();

      logger.review("permission_request.waiting", {
        toolName: "http",
        headers: { authorization: "Bearer TEST_VALUE" },
      });

      const written = readFileSync(reviewLogPath, "utf8");
      expect(written).not.toContain("TEST_VALUE");
      expect(JSON.parse(written.trim())).toMatchObject({
        toolName: "http",
        headers: { authorization: "[redacted]" },
      });
    });

    test("masks sensitive-keyed values in the debug log too", () => {
      config.debugLog = true;
      const logger = makeLogger();

      logger.debug("permission.decision", {
        toolName: "http",
        apiKey: "sk-real-value",
      });

      const written = readFileSync(debugLogPath, "utf8");
      expect(written).not.toContain("sk-real-value");
      expect(JSON.parse(written.trim())).toMatchObject({
        toolName: "http",
        apiKey: "[redacted]",
      });
    });

    test("leaves a bash command string unredacted, as documented", () => {
      const logger = makeLogger();

      logger.review("permission_request.waiting", {
        toolName: "bash",
        command: "deploy --token abc123",
      });

      expect(readFileSync(reviewLogPath, "utf8")).toContain(
        "deploy --token abc123",
      );
    });
  });

  describe("the review log's field-width bound", () => {
    /** The single review entry the log holds, parsed. */
    function writtenReviewEntry(): Record<string, unknown> {
      return JSON.parse(readFileSync(reviewLogPath, "utf8").trim()) as Record<
        string,
        unknown
      >;
    }

    test("shortens an oversized value at the configured width", () => {
      config.reviewLogFieldMaxWidth = 20;

      makeLogger().review("permission_request.waiting", {
        toolName: "bash",
        command: "a".repeat(500),
      });

      expect(writtenReviewEntry().command).toBe(`${"a".repeat(20)}\u2026`);
    });

    test("bounds every value the entry carries, not one chosen field", () => {
      config.reviewLogFieldMaxWidth = 5;

      makeLogger().review("permission_request.waiting", {
        command: "b".repeat(50),
        path: "c".repeat(50),
        toolInputPreview: "d".repeat(50),
      });

      expect(writtenReviewEntry()).toMatchObject({
        command: `${"b".repeat(5)}\u2026`,
        path: `${"c".repeat(5)}\u2026`,
        toolInputPreview: `${"d".repeat(5)}\u2026`,
      });
    });

    test("defaults to a width that leaves ordinary commands whole", () => {
      const command = "pnpm run test --filter @gotgenes/pi-permission-system";

      makeLogger().review("permission_request.waiting", {
        toolName: "bash",
        command,
      });

      expect(writtenReviewEntry().command).toBe(command);
    });

    test("masks a sensitive-keyed value whole, however long it was", () => {
      config.reviewLogFieldMaxWidth = 10;

      makeLogger().review("permission_request.waiting", {
        headers: { authorization: `Bearer ${"TEST_VALUE".repeat(20)}` },
      });

      const written = readFileSync(reviewLogPath, "utf8");
      expect(written).not.toContain("TEST_VALUE");
      expect(writtenReviewEntry()).toMatchObject({
        headers: { authorization: "[redacted]" },
      });
    });

    test("bounds a string nested inside the decision provenance record", () => {
      config.reviewLogFieldMaxWidth = 20;

      makeLogger().review("permission_request.denied", {
        decidedBy: {
          kind: "authorizer",
          name: "model-judge",
          verdict: "deny",
          reason: "f".repeat(500),
        },
      });

      // decidedBy is the first nested object the review stream carries, and
      // the bound lives at writeLine rather than at each producer precisely so
      // a new record shape cannot escape it.
      expect(writtenReviewEntry().decidedBy).toEqual({
        kind: "authorizer",
        name: "model-judge",
        verdict: "deny",
        reason: `${"f".repeat(20)}\u2026`,
      });
    });

    test("bounds a string nested two frames deep in a relayed provenance record", () => {
      config.reviewLogFieldMaxWidth = 10;

      makeLogger().review("permission_request.approved", {
        decidedBy: {
          kind: "forwarded",
          responderSessionId: "parent-session",
          decision: {
            kind: "unavailable",
            reason: "g".repeat(500),
          },
        },
      });

      expect(writtenReviewEntry()).toMatchObject({
        decidedBy: {
          decision: { reason: `${"g".repeat(10)}\u2026` },
        },
      });
    });

    test("masks a sensitive-keyed value nested in a provenance record", () => {
      makeLogger().review("permission_request.denied", {
        decidedBy: {
          kind: "authorizer",
          name: "model-judge",
          verdict: "deny",
          apiKey: "TEST_VALUE_SECRET",
        },
      });

      // A cap is not redaction, and both have to reach the nested record.
      expect(readFileSync(reviewLogPath, "utf8")).not.toContain(
        "TEST_VALUE_SECRET",
      );
      expect(writtenReviewEntry()).toMatchObject({
        decidedBy: { apiKey: "[redacted]" },
      });
    });

    test("leaves the debug log unbounded, since it exists to be read in full", () => {
      config.debugLog = true;
      config.reviewLogFieldMaxWidth = 10;

      makeLogger().debug("permission.decision", { command: "e".repeat(500) });

      expect(readFileSync(debugLogPath, "utf8")).toContain("e".repeat(500));
    });
  });

  test("respects debug toggle and keeps review log enabled by default", () => {
    const logger = makeLogger();

    const initialDebugWarning = logger.debug("debug.disabled", {
      sample: true,
    });
    const reviewWarning = logger.review("permission_request.waiting", {
      toolName: "write",
    });

    expect(initialDebugWarning).toBe(undefined);
    expect(reviewWarning).toBe(undefined);
    expect(existsSync(debugLogPath)).toBe(false);
    expect(existsSync(reviewLogPath)).toBe(true);

    config.debugLog = true;
    const enabledDebugWarning = logger.debug("debug.enabled", { sample: true });
    expect(enabledDebugWarning).toBe(undefined);
    expect(existsSync(debugLogPath)).toBe(true);
    expect(readFileSync(debugLogPath, "utf8")).toMatch(/debug\.enabled/);
  });
});
