import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getGlobalConfigPath,
  getGlobalSettingsPath,
  getProjectConfigPath,
  getProjectSettingsPath,
} from "#src/config-paths";
import { PermissionManager } from "#src/permission-manager";

describe("Pi settings policy integration", () => {
  let root: string;
  let agentDir: string;
  let cwd: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "settings-policy-integration-"));
    agentDir = join(root, "agent");
    cwd = join(root, "project");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("derives global settings and applies agent overrides", () => {
    const configPath = getGlobalConfigPath(agentDir);
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({ permission: { "*": "ask", read: "allow" } }),
    );
    writeFileSync(
      getGlobalSettingsPath(agentDir),
      JSON.stringify({
        piPermissionSystem: {
          permission: { read: "deny", write: "allow" },
          agents: { worker: { write: "deny" } },
        },
      }),
    );

    const manager = new PermissionManager({ agentDir });
    expect(manager.getToolPermission("read")).toBe("allow");
    expect(manager.getToolPermission("write")).toBe("allow");
    expect(manager.getToolPermission("write", "worker")).toBe("deny");
  });

  it("loads trusted project settings below project config", () => {
    const globalConfigPath = getGlobalConfigPath(agentDir);
    mkdirSync(dirname(globalConfigPath), { recursive: true });
    writeFileSync(
      globalConfigPath,
      JSON.stringify({ permission: { "*": "ask", bash: "allow" } }),
    );
    const projectSettingsPath = getProjectSettingsPath(cwd);
    mkdirSync(dirname(projectSettingsPath), { recursive: true });
    writeFileSync(
      projectSettingsPath,
      JSON.stringify({
        piPermissionSystem: { permission: { bash: "deny", read: "deny" } },
      }),
    );
    const projectConfigPath = getProjectConfigPath(cwd);
    mkdirSync(dirname(projectConfigPath), { recursive: true });
    writeFileSync(
      projectConfigPath,
      JSON.stringify({ permission: { bash: "allow" } }),
    );

    const manager = new PermissionManager({ agentDir });
    manager.configureForCwd(cwd);
    expect(manager.getToolPermission("bash")).toBe("allow");
    expect(manager.getToolPermission("read")).toBe("deny");

    manager.configureForCwd(undefined);
    expect(manager.getToolPermission("read")).toBe("ask");
  });
});
