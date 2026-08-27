import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, test } from "vitest";

import type { PermissionSystemExtensionConfig } from "#src/extension-config";
import {
  detectMisplacedPermissionKeys,
  ensurePermissionSystemLogsDirectory,
  isYoloModeEnabled,
  normalizePermissionSystemConfig,
} from "#src/extension-config";

function makeConfig(
  yoloMode: boolean | undefined,
): PermissionSystemExtensionConfig {
  return { yoloMode } as PermissionSystemExtensionConfig;
}

describe("detectMisplacedPermissionKeys", () => {
  it("returns an empty array for a record with only valid extension keys", () => {
    const result = detectMisplacedPermissionKeys({
      debugLog: true,
      permissionReviewLog: true,
      yoloMode: false,
    });
    expect(result).toEqual([]);
  });

  it("returns an empty array for an empty record", () => {
    const result = detectMisplacedPermissionKeys({});
    expect(result).toEqual([]);
  });

  it("returns misplaced key names when legacy permission-rule keys are present", () => {
    const result = detectMisplacedPermissionKeys({
      debugLog: true,
      defaultPolicy: { tools: "ask" },
      bash: { "git status": "allow" },
    });
    expect(result).toEqual(["defaultPolicy", "bash"]);
  });

  it("detects all known legacy permission-rule keys", () => {
    const result = detectMisplacedPermissionKeys({
      defaultPolicy: {},
      tools: {},
      bash: {},
      mcp: {},
      skills: {},
      special: {},
      external_directory: {},
    });
    expect(result).toEqual([
      "defaultPolicy",
      "tools",
      "bash",
      "mcp",
      "skills",
      "special",
      "external_directory",
    ]);
  });

  it("does not detect doom_loop as a misplaced permission key", () => {
    const result = detectMisplacedPermissionKeys({
      doom_loop: {},
    });
    expect(result).toEqual([]);
  });

  it("does not flag the new flat-format permission key as misplaced", () => {
    const result = detectMisplacedPermissionKeys({
      debugLog: false,
      permission: { "*": "ask" },
    });
    expect(result).toEqual([]);
  });

  it("ignores unknown keys that are not permission-rule keys", () => {
    const result = detectMisplacedPermissionKeys({
      debugLog: true,
      someRandomKey: "value",
    });
    expect(result).toEqual([]);
  });
});

describe("normalizePermissionSystemConfig", () => {
  it("normalizes a valid config object", () => {
    const result = normalizePermissionSystemConfig({
      debugLog: true,
      permissionReviewLog: false,
      yoloMode: true,
    });
    expect(result).toEqual({
      debugLog: true,
      permissionReviewLog: false,
      yoloMode: true,
      doublePressToConfirm: true,
    });
  });

  it("defaults debugLog to false when missing", () => {
    const result = normalizePermissionSystemConfig({});
    expect(result.debugLog).toBe(false);
  });

  it("defaults permissionReviewLog to true when missing", () => {
    const result = normalizePermissionSystemConfig({});
    expect(result.permissionReviewLog).toBe(true);
  });

  it("defaults yoloMode to false when missing", () => {
    const result = normalizePermissionSystemConfig({});
    expect(result.yoloMode).toBe(false);
  });

  it("defaults doublePressToConfirm to true when missing", () => {
    const result = normalizePermissionSystemConfig({});
    expect(result.doublePressToConfirm).toBe(true);
  });

  it("sets doublePressToConfirm false when explicitly disabled", () => {
    const result = normalizePermissionSystemConfig({
      doublePressToConfirm: false,
    });
    expect(result.doublePressToConfirm).toBe(false);
  });

  it("includes forwardingTimeoutMs when a valid positive integer is provided", () => {
    const result = normalizePermissionSystemConfig({
      forwardingTimeoutMs: 120_000,
    });
    expect(result.forwardingTimeoutMs).toBe(120_000);
  });

  it("omits forwardingTimeoutMs when absent", () => {
    const result = normalizePermissionSystemConfig({});
    expect("forwardingTimeoutMs" in result).toBe(false);
  });

  it("includes the prompt-budget knobs when provided", () => {
    const result = normalizePermissionSystemConfig({
      promptMaxRows: 12,
      promptFieldMaxWidth: 80,
    });
    expect(result.promptMaxRows).toBe(12);
    expect(result.promptFieldMaxWidth).toBe(80);
  });

  it("omits the prompt-budget knobs when absent, leaving the renderer's defaults", () => {
    const result = normalizePermissionSystemConfig({});
    expect("promptMaxRows" in result).toBe(false);
    expect("promptFieldMaxWidth" in result).toBe(false);
  });

  it("includes the review-log field width when provided", () => {
    expect(
      normalizePermissionSystemConfig({ reviewLogFieldMaxWidth: 200 })
        .reviewLogFieldMaxWidth,
    ).toBe(200);
  });

  it("omits the review-log field width when absent, leaving the writer's default", () => {
    expect(
      "reviewLogFieldMaxWidth" in normalizePermissionSystemConfig({}),
    ).toBe(false);
  });

  // Deliberately dropped rather than carried: a declared config field no
  // runtime consumer reads is a maintenance trap, so the deprecated caps stop
  // at the merge intermediate the detector reads (#745).
  it("drops the deprecated preview caps even when the config sets them", () => {
    const result = normalizePermissionSystemConfig({
      toolInputPreviewMaxLength: 400,
      toolTextSummaryMaxLength: 120,
    });
    expect("toolInputPreviewMaxLength" in result).toBe(false);
    expect("toolTextSummaryMaxLength" in result).toBe(false);
  });

  it("includes shellTools when provided", () => {
    const result = normalizePermissionSystemConfig({
      shellTools: {
        exec_command: { commandArgument: "cmd", workdirArgument: "workdir" },
      },
    });
    expect(result.shellTools).toEqual({
      exec_command: { commandArgument: "cmd", workdirArgument: "workdir" },
    });
  });

  it("omits shellTools when absent", () => {
    const result = normalizePermissionSystemConfig({});
    expect("shellTools" in result).toBe(false);
  });

  it("includes authorizerChain when provided", () => {
    const result = normalizePermissionSystemConfig({
      authorizerChain: ["model-judge", "typo-reviewer"],
    });
    expect(result.authorizerChain).toEqual(["model-judge", "typo-reviewer"]);
  });

  it("omits authorizerChain when absent", () => {
    const result = normalizePermissionSystemConfig({});
    expect("authorizerChain" in result).toBe(false);
  });
});

describe("ensurePermissionSystemLogsDirectory", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "pi-permission-system-logsdir-"));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  test("creates the logs directory owner-only", () => {
    const logsDir = join(baseDir, "extensions", "pi-permission-system", "logs");

    expect(ensurePermissionSystemLogsDirectory(logsDir)).toBe(undefined);
    expect(statSync(logsDir).mode & 0o777).toBe(0o700);
  });

  test("tightens a directory inherited from an earlier version", () => {
    const logsDir = join(baseDir, "logs");
    mkdirSync(logsDir);
    chmodSync(logsDir, 0o755);

    expect(ensurePermissionSystemLogsDirectory(logsDir)).toBe(undefined);
    expect(statSync(logsDir).mode & 0o777).toBe(0o700);
  });
});

describe("isYoloModeEnabled", () => {
  it("returns true when yoloMode is true", () => {
    expect(isYoloModeEnabled(makeConfig(true))).toBe(true);
  });

  it("returns false when yoloMode is false", () => {
    expect(isYoloModeEnabled(makeConfig(false))).toBe(false);
  });

  it("returns false when yoloMode is undefined", () => {
    expect(isYoloModeEnabled(makeConfig(undefined))).toBe(false);
  });
});
