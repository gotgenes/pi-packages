import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { PermissionManager } from "#src/permission-manager";
import { PermissionResolver } from "#src/permission-resolver";
import { SessionRules } from "#src/session-rules";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeManager(
  config: Record<string, unknown>,
  isSubagent: () => boolean,
  settings?: Record<string, unknown>,
): PermissionManager {
  const root = mkdtempSync(join(tmpdir(), "subagent-permission-"));
  tempDirs.push(root);
  const configPath = join(root, "config.json");
  const agentsDir = join(root, "agents");
  mkdirSync(agentsDir);
  writeFileSync(configPath, JSON.stringify(config));
  const globalSettingsPath = join(root, "settings.json");
  if (settings) writeFileSync(globalSettingsPath, JSON.stringify(settings));
  return new PermissionManager({
    globalConfigPath: configPath,
    globalSettingsPath,
    agentsDir,
    isSubagent,
  });
}

function checkBash(manager: PermissionManager, command: string) {
  return manager.check({
    kind: "tool" as const,
    surface: "bash",
    input: { command },
  });
}

describe("subagentPermission", () => {
  const config = {
    permission: {
      "*": "allow",
      bash: { "*": "allow", "git reset *": "ask" },
      path: "deny",
    },
    subagentPermission: {
      bash: {
        "**": "deny",
        "git status *": "allow",
        "git diff *": "allow",
      },
      path: "allow",
    },
  };

  it("does not affect a parent session", () => {
    const manager = makeManager(config, () => false);

    expect(checkBash(manager, "git status --short").state).toBe("allow");
    expect(checkBash(manager, "git reset --hard").state).toBe("ask");
  });

  it("restricts every detected subagent while retaining explicit read-only allows", () => {
    const manager = makeManager(config, () => true);

    expect(manager.getToolPermission("bash")).toBe("allow");
    expect(checkBash(manager, "git status --short").state).toBe("allow");
    expect(checkBash(manager, "git diff --cached").state).toBe("allow");
    expect(checkBash(manager, "git add --dry-run -- .").state).toBe("deny");
    expect(checkBash(manager, "git reset --hard").state).toBe("deny");
  });

  it("still hides a tool with no permitted subagent operation", () => {
    const manager = makeManager(
      {
        permission: { "*": "allow" },
        subagentPermission: { write: "deny" },
      },
      () => true,
    );

    expect(manager.getToolPermission("write")).toBe("deny");
  });

  it("acts as a ceiling and cannot loosen the regular policy", () => {
    const manager = makeManager(config, () => true);
    const result = manager.check({
      kind: "path-values",
      surface: "path",
      values: ["/tmp/example"],
    });

    expect(result.state).toBe("deny");
  });

  it("loads the ceiling from Pi settings below the dedicated config", () => {
    const manager = makeManager(
      {
        permission: { "*": "allow" },
        subagentPermission: {
          bash: { "git status *": "allow" },
        },
      },
      () => true,
      {
        piPermissionSystem: {
          subagentPermission: {
            bash: { "**": "deny", "git status *": "ask" },
          },
        },
      },
    );

    expect(checkBash(manager, "git status --short").state).toBe("allow");
    expect(checkBash(manager, "git add --dry-run -- .").state).toBe("deny");
  });

  it("allows a session grant to satisfy a ceiling ask", () => {
    const manager = makeManager(
      {
        permission: { "*": "allow" },
        subagentPermission: { bash: { "git push *": "ask" } },
      },
      () => true,
    );
    const sessionRules = new SessionRules();
    sessionRules.approve("bash", "git push origin main");

    expect(
      manager.check(
        {
          kind: "tool",
          surface: "bash",
          input: { command: "git push origin main" },
        },
        sessionRules.getRuleset(),
      ).state,
    ).toBe("allow");
  });

  it("keeps a ceiling deny authoritative for forwarded requests with a session grant", () => {
    const manager = makeManager(config, () => false);
    const sessionRules = new SessionRules();
    sessionRules.approve("bash", "git reset --hard");
    const resolver = new PermissionResolver(manager, sessionRules);

    expect(
      resolver.resolve(
        {
          kind: "tool",
          surface: "bash",
          input: { command: "git reset --hard" },
        },
        { isSubagent: true },
      ).state,
    ).toBe("deny");
  });
});
