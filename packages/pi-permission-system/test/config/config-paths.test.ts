import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEBUG_LOG_FILENAME,
  getGlobalConfigDir,
  getGlobalConfigPath,
  getGlobalLogsDir,
  getLegacyExtensionConfigPath,
  getLegacyGlobalPolicyPath,
  getLegacyProjectPolicyPath,
  getProjectAgentsDir,
  getProjectConfigPath,
  REVIEW_LOG_FILENAME,
} from "#src/config/config-paths";

describe("config-paths", () => {
  const agentDir = "/home/user/.pi/agent";
  const cwd = "/projects/my-app";
  const extensionRoot = "/opt/extensions/pi-permission-system";

  describe("new layout paths", () => {
    it("getGlobalConfigDir returns extensions/pi-permission-system under agentDir", () => {
      expect(getGlobalConfigDir(agentDir)).toBe(
        join(agentDir, "extensions", "pi-permission-system"),
      );
    });

    it("getGlobalConfigPath returns config.json under the global config dir", () => {
      expect(getGlobalConfigPath(agentDir)).toBe(
        join(agentDir, "extensions", "pi-permission-system", "config.json"),
      );
    });

    it("getGlobalLogsDir returns logs under the global config dir", () => {
      expect(getGlobalLogsDir(agentDir)).toBe(
        join(agentDir, "extensions", "pi-permission-system", "logs"),
      );
    });

    it("getProjectConfigPath returns .pi/extensions/pi-permission-system/config.json under cwd", () => {
      expect(getProjectConfigPath(cwd)).toBe(
        join(cwd, ".pi", "extensions", "pi-permission-system", "config.json"),
      );
    });

    it("getProjectAgentsDir returns .pi/agents under cwd", () => {
      expect(getProjectAgentsDir(cwd)).toBe(join(cwd, ".pi", "agents"));
    });
  });

  describe("legacy paths", () => {
    it("getLegacyGlobalPolicyPath returns pi-permissions.jsonc under agentDir", () => {
      expect(getLegacyGlobalPolicyPath(agentDir)).toBe(
        join(agentDir, "pi-permissions.jsonc"),
      );
    });

    it("getLegacyProjectPolicyPath returns .pi/agent/pi-permissions.jsonc under cwd", () => {
      expect(getLegacyProjectPolicyPath(cwd)).toBe(
        join(cwd, ".pi", "agent", "pi-permissions.jsonc"),
      );
    });

    it("getLegacyExtensionConfigPath returns config.json under extensionRoot", () => {
      expect(getLegacyExtensionConfigPath(extensionRoot)).toBe(
        join(extensionRoot, "config.json"),
      );
    });
  });

  describe("log filenames", () => {
    it("DEBUG_LOG_FILENAME is a .jsonl file", () => {
      expect(DEBUG_LOG_FILENAME).toBe("pi-permission-system-debug.jsonl");
    });

    it("REVIEW_LOG_FILENAME is a .jsonl file", () => {
      expect(REVIEW_LOG_FILENAME).toBe(
        "pi-permission-system-permission-review.jsonl",
      );
    });
  });
});
