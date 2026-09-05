import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDiscoverGlobalNodeModulesRoot } = vi.hoisted(() => ({
  mockDiscoverGlobalNodeModulesRoot: vi.fn<() => string | null>(),
}));

vi.mock("#src/path/node-modules-discovery", () => ({
  discoverGlobalNodeModulesRoot: mockDiscoverGlobalNodeModulesRoot,
}));

import { getGlobalLogsDir } from "#src/config/config-paths";
import { computeExtensionPaths } from "#src/config/extension-paths";

describe("computeExtensionPaths", () => {
  beforeEach(() => {
    mockDiscoverGlobalNodeModulesRoot.mockReset();
    mockDiscoverGlobalNodeModulesRoot.mockReturnValue(
      "/mock/global/node_modules",
    );
  });

  it("sets agentDir from argument", () => {
    const paths = computeExtensionPaths("/test/agent");
    expect(paths.agentDir).toBe("/test/agent");
  });

  it("derives sessionsDir as agentDir/sessions", () => {
    const paths = computeExtensionPaths("/test/agent");
    expect(paths.sessionsDir).toBe("/test/agent/sessions");
  });

  it("derives subagentSessionsDir as agentDir/subagent-sessions", () => {
    const paths = computeExtensionPaths("/test/agent");
    expect(paths.subagentSessionsDir).toBe("/test/agent/subagent-sessions");
  });

  it("derives forwardingDir as sessionsDir/permission-forwarding", () => {
    const paths = computeExtensionPaths("/test/agent");
    expect(paths.forwardingDir).toBe(
      join("/test/agent/sessions", "permission-forwarding"),
    );
  });

  it("derives globalLogsDir via getGlobalLogsDir(agentDir)", () => {
    const paths = computeExtensionPaths("/test/agent");
    expect(paths.globalLogsDir).toBe(getGlobalLogsDir("/test/agent"));
  });

  it("includes agentDir in piInfrastructureDirs", () => {
    const paths = computeExtensionPaths("/test/agent");
    expect(paths.piInfrastructureDirs).toContain("/test/agent");
  });

  it("includes agentDir/git in piInfrastructureDirs", () => {
    const paths = computeExtensionPaths("/test/agent");
    expect(paths.piInfrastructureDirs).toContain("/test/agent/git");
  });

  it("includes discovered global node_modules root in piInfrastructureDirs", () => {
    const paths = computeExtensionPaths("/test/agent");
    expect(paths.piInfrastructureDirs).toContain("/mock/global/node_modules");
  });

  it("omits global node_modules from piInfrastructureDirs when discovery returns null", () => {
    mockDiscoverGlobalNodeModulesRoot.mockReturnValue(null);
    const paths = computeExtensionPaths("/test/agent");
    expect(paths.piInfrastructureDirs).toHaveLength(2);
    expect(paths.piInfrastructureDirs).toContain("/test/agent");
    expect(paths.piInfrastructureDirs).toContain("/test/agent/git");
  });

  it("all entries in piInfrastructureDirs are strings (no null)", () => {
    mockDiscoverGlobalNodeModulesRoot.mockReturnValue(null);
    const paths = computeExtensionPaths("/test/agent");
    for (const dir of paths.piInfrastructureDirs) {
      expect(typeof dir).toBe("string");
    }
  });

  it("includes piPackageDir in piInfrastructureDirs when provided", () => {
    const paths = computeExtensionPaths("/test/agent", "/pi/install");
    expect(paths.piInfrastructureDirs).toContain("/pi/install");
  });

  it("omits piPackageDir when not provided (current behavior preserved)", () => {
    const paths = computeExtensionPaths("/test/agent");
    expect(paths.piInfrastructureDirs).toEqual([
      "/test/agent",
      "/test/agent/git",
      "/mock/global/node_modules",
    ]);
  });

  it("omits piPackageDir when given an empty string", () => {
    const paths = computeExtensionPaths("/test/agent", "");
    expect(paths.piInfrastructureDirs).not.toContain("");
  });

  it("two calls with different agentDirs produce independent results", () => {
    const a = computeExtensionPaths("/agent/a");
    const b = computeExtensionPaths("/agent/b");
    expect(a.agentDir).toBe("/agent/a");
    expect(b.agentDir).toBe("/agent/b");
    expect(a.sessionsDir).toBe("/agent/a/sessions");
    expect(b.sessionsDir).toBe("/agent/b/sessions");
  });
});
