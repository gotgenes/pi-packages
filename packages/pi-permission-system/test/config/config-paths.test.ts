import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEBUG_LOG_FILENAME,
  getAncestorDirs,
  getAncestorProjectScopes,
  getGlobalConfigDir,
  getGlobalConfigPath,
  getGlobalLogsDir,
  getLegacyExtensionConfigPath,
  getLegacyGlobalPolicyPath,
  getLegacyProjectPolicyPath,
  getProjectAgentsDir,
  getProjectConfigPath,
  getProjectMcpPath,
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

  describe("ancestor project scopes", () => {
    it("getProjectMcpPath returns .pi/mcp.json under cwd", () => {
      expect(getProjectMcpPath(cwd)).toBe(join(cwd, ".pi", "mcp.json"));
    });

    it("getAncestorDirs runs from the filesystem root down to cwd", () => {
      const dirs = getAncestorDirs(join("a", "b", "c"));
      // The first entry is a filesystem root: its own parent.
      expect(dirname(dirs[0])).toBe(dirs[0]);
      expect(dirs[dirs.length - 1].endsWith(join("a", "b", "c"))).toBe(true);
      // Strictly nesting: each entry is the parent of the next.
      for (let i = 1; i < dirs.length; i++) {
        expect(dirname(dirs[i])).toBe(dirs[i - 1]);
      }
    });

    it("getAncestorProjectScopes lists every scope top-most first", () => {
      const nested = join(cwd, "packages", "api");
      const scopes = getAncestorProjectScopes(nested);
      expect(scopes.length).toBeGreaterThan(2);
      // The first entry is a filesystem root: its own parent.
      expect(dirname(scopes[0].dir)).toBe(scopes[0].dir);
      const nearest = scopes[scopes.length - 1];
      expect(nearest.dir).toBe(nested);
      expect(nearest.configPath).toBe(getProjectConfigPath(nested));
      expect(nearest.agentsDir).toBe(getProjectAgentsDir(nested));
      expect(nearest.mcpPath).toBe(getProjectMcpPath(nested));
      expect(nearest.legacyPolicyPath).toBe(getLegacyProjectPolicyPath(nested));
      // The scope owning `cwd` sits exactly one before the nearest entry.
      const parent = scopes[scopes.length - 2];
      expect(parent.dir).toBe(join(cwd, "packages"));
      expect(parent.configPath).toBe(
        getProjectConfigPath(join(cwd, "packages")),
      );
    });

    it("getAncestorProjectScopes returns [] for an empty cwd", () => {
      expect(getAncestorProjectScopes("")).toEqual([]);
    });
  });
});
