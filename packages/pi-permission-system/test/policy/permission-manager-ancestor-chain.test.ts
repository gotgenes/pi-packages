/**
 * End-to-end tests for the ancestor project-scope chain: a session whose cwd
 * sits in a nested directory honors `.pi` configs from every parent directory,
 * top-most first with the nearest scope winning.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { posixPathFlavor } from "#src/path/path-flavor";
import { PermissionManager } from "#src/policy/permission-manager";

describe("PermissionManager ancestor project chain", () => {
  let baseDir: string;
  let agentDir: string;
  let parentDir: string;
  let childCwd: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "permission-ancestor-test-"));
    agentDir = join(baseDir, "agent");
    parentDir = join(baseDir, "project");
    childCwd = join(parentDir, "packages", "api");
    mkdirSync(childCwd, { recursive: true });
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  function writeProjectConfig(
    dir: string,
    content: Record<string, unknown>,
  ): void {
    const configDir = join(dir, ".pi", "extensions", "pi-permission-system");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.json"), JSON.stringify(content));
  }

  function managerForChild(): PermissionManager {
    const manager = new PermissionManager({
      agentDir,
      flavor: posixPathFlavor,
    });
    manager.configureForCwd(childCwd);
    return manager;
  }

  it("honors a parent scope's bash rule from a nested cwd", () => {
    writeProjectConfig(parentDir, {
      permission: { "*": "ask", bash: { "git status": "allow" } },
    });

    const manager = managerForChild();
    const result = manager.check({
      kind: "tool",
      surface: "bash",
      input: { command: "git status" },
    });
    expect(result.state).toBe("allow");
    expect(result.origin).toBe("project");
  });

  it("scopes an ancestor's relative path rule to the ancestor directory", () => {
    writeProjectConfig(parentDir, {
      permission: {
        "*": "ask",
        read: { "data/*": "allow" },
      },
    });

    const manager = managerForChild();
    const insideAncestor = manager.check({
      kind: "path-values",
      surface: "read",
      values: [join(parentDir, "data", "export.csv")],
    });
    expect(insideAncestor.state).toBe("allow");

    // The same relative layout under the nested cwd is not covered by the
    // ancestor's rule — it falls through to the universal fallback.
    const insideChild = manager.check({
      kind: "path-values",
      surface: "read",
      values: [join(childCwd, "data", "export.csv")],
    });
    expect(insideChild.state).toBe("ask");
  });

  it("gives the nearest scope the final say over an ancestor", () => {
    writeProjectConfig(parentDir, {
      permission: { bash: "allow" },
    });
    writeProjectConfig(childCwd, {
      permission: { bash: "deny" },
    });

    const manager = managerForChild();
    const result = manager.check({
      kind: "tool",
      surface: "bash",
      input: { command: "git status" },
    });
    expect(result.state).toBe("deny");
    expect(result.origin).toBe("project");
  });

  it("withholds the whole chain when configured without a cwd", () => {
    writeProjectConfig(parentDir, {
      permission: { bash: "allow" },
    });

    const manager = new PermissionManager({
      agentDir,
      flavor: posixPathFlavor,
    });
    manager.configureForCwd(undefined);
    const result = manager.check({
      kind: "tool",
      surface: "bash",
      input: { command: "git status" },
    });
    expect(result.state).toBe("ask");
  });
});
