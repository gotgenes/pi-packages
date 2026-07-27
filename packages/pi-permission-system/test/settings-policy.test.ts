import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadSettingsPolicy } from "#src/settings-policy";

describe("loadSettingsPolicy", () => {
  let tempDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "settings-policy-test-"));
    settingsPath = join(tempDir, "settings.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loads global and per-agent permission policies", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        piPermissionSystem: {
          permission: { "*": "ask", read: "allow" },
          agents: {
            worker: { bash: "deny", edit: "allow", write: "allow" },
          },
        },
      }),
    );

    expect(loadSettingsPolicy(settingsPath)).toEqual({
      permission: { "*": "ask", read: "allow" },
      agents: {
        worker: { bash: "deny", edit: "allow", write: "allow" },
      },
      issues: [],
    });
  });

  it("ignores settings without a permission-system section", () => {
    writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));

    expect(loadSettingsPolicy(settingsPath)).toEqual({ issues: [] });
  });

  it("rejects an invalid permission-system section", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        piPermissionSystem: {
          permission: { bash: "invalid" },
        },
      }),
    );

    const result = loadSettingsPolicy(settingsPath);
    expect(result.permission).toBeUndefined();
    expect(result.agents).toBeUndefined();
    expect(result.issues.join("\n")).toContain(
      "piPermissionSystem.permission.bash",
    );
  });

  it("returns no policy when the settings file is absent", () => {
    expect(loadSettingsPolicy(settingsPath)).toEqual({ issues: [] });
  });
});
