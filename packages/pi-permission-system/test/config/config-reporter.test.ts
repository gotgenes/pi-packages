import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildResolvedConfigLogEntry } from "#src/config/config-reporter";
import type { ResolvedPolicyPaths } from "#src/config/policy-loader";
import { createPermissionSystemLogger } from "#src/logging/logging";
import { createManagerFromPaths } from "#test/helpers/manager-harness";
import { createTmpFixture, type TmpFixture } from "#test/helpers/tmp-fixture";

const policyPaths: ResolvedPolicyPaths = [
  {
    name: "global",
    path: "/home/user/.pi/agent/extensions/pi-permission-system/config.json",
    exists: true,
  },
  {
    name: "project",
    path: "/projects/my-app/.pi/extensions/pi-permission-system/config.json",
    exists: false,
  },
  { name: "agent", path: "/home/user/.pi/agent/agents", exists: true },
  { name: "project-agent", path: null, exists: false },
];

describe("buildResolvedConfigLogEntry", () => {
  it("carries the scopes in the order given, with legacy flags off by default", () => {
    expect(buildResolvedConfigLogEntry({ policyPaths })).toStrictEqual({
      scopes: policyPaths,
      legacyGlobalPolicyDetected: false,
      legacyProjectPolicyDetected: false,
      legacyExtensionConfigDetected: false,
    });
  });

  it("surfaces legacy detection flags", () => {
    const result = buildResolvedConfigLogEntry({
      policyPaths,
      legacyGlobalPolicyDetected: true,
      legacyExtensionConfigDetected: true,
    });

    expect(result.legacyGlobalPolicyDetected).toBe(true);
    expect(result.legacyProjectPolicyDetected).toBe(false);
    expect(result.legacyExtensionConfigDetected).toBe(true);
  });
});

describe("the config.resolved review-log entry", () => {
  let fixture: TmpFixture;

  beforeEach(() => {
    fixture = createTmpFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it("lists every scope lowest precedence first, in place of per-scope fields", () => {
    const tempDir = fixture.dir("config-resolved-log-");
    const logsDir = fixture.subdir(tempDir, "logs");
    const reviewLogPath = join(logsDir, "review.jsonl");
    const globalConfigPath = fixture.file(
      tempDir,
      "pi-permissions.jsonc",
      "{}",
    );
    const agentsDir = join(tempDir, "agents");

    const pm = createManagerFromPaths({ globalConfigPath, agentsDir });
    const logger = createPermissionSystemLogger({
      getConfig: () => ({
        debugLog: false,
        permissionReviewLog: true,
        yoloMode: false,
        doublePressToConfirm: true,
      }),
      debugLogPath: join(logsDir, "debug.jsonl"),
      reviewLogPath,
      ensureLogsDirectory: () => undefined,
    });

    const entry = buildResolvedConfigLogEntry({
      policyPaths: pm.getResolvedPolicyPaths(),
    });
    logger.review("config.resolved", { ...entry });

    const parsed = JSON.parse(
      readFileSync(reviewLogPath, "utf-8").trim(),
    ) as Record<string, unknown>;

    expect(parsed.event).toBe("config.resolved");
    expect(parsed.scopes).toEqual([
      { name: "global", path: globalConfigPath, exists: true },
      { name: "project", path: null, exists: false },
      { name: "agent", path: agentsDir, exists: false },
      { name: "project-agent", path: null, exists: false },
    ]);
    expect(parsed).not.toHaveProperty("globalConfigPath");
    expect(parsed.legacyGlobalPolicyDetected).toBe(false);
    expect(parsed.legacyProjectPolicyDetected).toBe(false);
    expect(parsed.legacyExtensionConfigDetected).toBe(false);
  });
});
