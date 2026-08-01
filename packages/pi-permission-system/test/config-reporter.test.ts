import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildResolvedConfigLogEntry } from "#src/config-reporter";
import { createPermissionSystemLogger } from "#src/logging";
import type { ResolvedPolicyPaths } from "#src/permission-manager";
import { PermissionManager } from "#src/permission-manager";

test("buildResolvedConfigLogEntry includes policy paths and legacy detection flags", () => {
  const policyPaths: ResolvedPolicyPaths = {
    globalConfigPath:
      "/home/user/.pi/agent/extensions/pi-permission-system/config.json",
    globalConfigExists: true,
    projectConfigPath:
      "/projects/my-app/.pi/extensions/pi-permission-system/config.json",
    projectConfigExists: false,
    projectLocalConfigPath:
      "/projects/my-app/.pi/extensions/pi-permission-system/config.local.json",
    projectLocalConfigExists: false,
    agentsDir: "/home/user/.pi/agent/agents",
    agentsDirExists: true,
    projectAgentsDir: "/projects/my-app/.pi/agent/agents",
    projectAgentsDirExists: false,
  };

  const result = buildResolvedConfigLogEntry({ policyPaths });

  expect(result.globalConfigPath).toBe(
    "/home/user/.pi/agent/extensions/pi-permission-system/config.json",
  );
  expect(result.globalConfigExists).toBe(true);
  expect(result.projectConfigPath).toBe(
    "/projects/my-app/.pi/extensions/pi-permission-system/config.json",
  );
  expect(result.projectConfigExists).toBe(false);
  expect(result.projectLocalConfigPath).toBe(
    "/projects/my-app/.pi/extensions/pi-permission-system/config.local.json",
  );
  expect(result.projectLocalConfigExists).toBe(false);
  expect(result.agentsDir).toBe("/home/user/.pi/agent/agents");
  expect(result.agentsDirExists).toBe(true);
  expect(result.projectAgentsDir).toBe("/projects/my-app/.pi/agent/agents");
  expect(result.projectAgentsDirExists).toBe(false);
  expect(result.legacyGlobalPolicyDetected).toBe(false);
  expect(result.legacyProjectPolicyDetected).toBe(false);
  expect(result.legacyExtensionConfigDetected).toBe(false);
});

test("buildResolvedConfigLogEntry handles null project paths", () => {
  const policyPaths: ResolvedPolicyPaths = {
    globalConfigPath:
      "/home/user/.pi/agent/extensions/pi-permission-system/config.json",
    globalConfigExists: false,
    projectConfigPath: null,
    projectConfigExists: false,
    projectLocalConfigPath: null,
    projectLocalConfigExists: false,
    agentsDir: "/home/user/.pi/agent/agents",
    agentsDirExists: false,
    projectAgentsDir: null,
    projectAgentsDirExists: false,
  };

  const result = buildResolvedConfigLogEntry({ policyPaths });

  expect(result.projectConfigPath).toBe(null);
  expect(result.projectConfigExists).toBe(false);
  expect(result.projectAgentsDir).toBe(null);
  expect(result.projectAgentsDirExists).toBe(false);
});

test("buildResolvedConfigLogEntry surfaces legacy detection flags", () => {
  const policyPaths: ResolvedPolicyPaths = {
    globalConfigPath:
      "/home/user/.pi/agent/extensions/pi-permission-system/config.json",
    globalConfigExists: true,
    projectConfigPath: null,
    projectConfigExists: false,
    projectLocalConfigPath: null,
    projectLocalConfigExists: false,
    agentsDir: "/home/user/.pi/agent/agents",
    agentsDirExists: false,
    projectAgentsDir: null,
    projectAgentsDirExists: false,
  };

  const result = buildResolvedConfigLogEntry({
    policyPaths,
    legacyGlobalPolicyDetected: true,
    legacyExtensionConfigDetected: true,
  });

  expect(result.legacyGlobalPolicyDetected).toBe(true);
  expect(result.legacyProjectPolicyDetected).toBe(false);
  expect(result.legacyExtensionConfigDetected).toBe(true);
});

test("config.resolved entry appears in review log via logger", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "config-resolved-log-"));
  try {
    const logsDir = join(tempDir, "logs");
    mkdirSync(logsDir, { recursive: true });
    const reviewLogPath = join(logsDir, "review.jsonl");
    const debugLogPath = join(logsDir, "debug.jsonl");

    const globalConfigPath = join(tempDir, "pi-permissions.jsonc");
    writeFileSync(globalConfigPath, "{}", "utf-8");
    const agentsDir = join(tempDir, "agents");

    const pm = new PermissionManager({
      globalConfigPath,
      agentsDir,
    });

    const logger = createPermissionSystemLogger({
      getConfig: () => ({
        debugLog: false,
        permissionReviewLog: true,
        yoloMode: false,
        doublePressToConfirm: true,
        showPersistenceSummary: true,
      }),
      debugLogPath,
      reviewLogPath,
      ensureLogsDirectory: () => undefined,
    });

    const policyPaths = pm.getResolvedPolicyPaths();
    const entry = buildResolvedConfigLogEntry({ policyPaths });
    logger.review(
      "config.resolved",
      entry as unknown as Record<string, unknown>,
    );

    const logContent = readFileSync(reviewLogPath, "utf-8").trim();
    const parsed = JSON.parse(logContent) as Record<string, unknown>;

    expect(parsed.event).toBe("config.resolved");
    expect(parsed.globalConfigPath).toBe(globalConfigPath);
    expect(parsed.globalConfigExists).toBe(true);
    expect(parsed.agentsDir).toBe(agentsDir);
    expect(parsed.agentsDirExists).toBe(false);
    expect(parsed.projectConfigPath).toBe(null);
    expect(parsed.projectConfigExists).toBe(false);
    expect(parsed.projectAgentsDir).toBe(null);
    expect(parsed.projectAgentsDirExists).toBe(false);
    expect(parsed.legacyGlobalPolicyDetected).toBe(false);
    expect(parsed.legacyProjectPolicyDetected).toBe(false);
    expect(parsed.legacyExtensionConfigDetected).toBe(false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
