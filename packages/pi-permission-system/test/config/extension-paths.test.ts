import { homedir } from "node:os";
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

  it("roots sessionsDir and forwardingDir at a configured session dir", () => {
    const paths = computeExtensionPaths("/test/agent", undefined, "/data/pi");
    expect(paths.sessionsDir).toBe("/data/pi");
    expect(paths.forwardingDir).toBe(join("/data/pi", "permission-forwarding"));
  });

  it("expands a leading ~ in a configured session dir", () => {
    const paths = computeExtensionPaths("/test/agent", undefined, "~/pi-data");
    expect(paths.sessionsDir).toBe(join(homedir(), "pi-data"));
  });

  it("ignores an empty configured session dir", () => {
    const paths = computeExtensionPaths("/test/agent", undefined, "");
    expect(paths.sessionsDir).toBe("/test/agent/sessions");
  });

  it("keeps subagentSessionsDir under agentDir with a configured session dir", () => {
    const paths = computeExtensionPaths("/test/agent", undefined, "/data/pi");
    expect(paths.subagentSessionsDir).toBe("/test/agent/subagent-sessions");
  });

  it("derives globalLogsDir via getGlobalLogsDir(agentDir)", () => {
    const paths = computeExtensionPaths("/test/agent");
    expect(paths.globalLogsDir).toBe(getGlobalLogsDir("/test/agent"));
  });

  it("excludes the package's own logs dir from infrastructure reads", () => {
    const paths = computeExtensionPaths("/test/agent");
    expect(paths.piInfrastructureExcludedDirs).toEqual([
      getGlobalLogsDir("/test/agent"),
    ]);
  });

  /** Pi's harness entries under agentDir, in the order the list carries them. */
  const HARNESS_ENTRIES = [
    "/test/agent/agents",
    "/test/agent/extensions",
    "/test/agent/git",
    "/test/agent/npm",
    "/test/agent/prompts",
    "/test/agent/skills",
    "/test/agent/themes",
    "/test/agent/settings.json",
    "/test/agent/SYSTEM.md",
    "/test/agent/APPEND_SYSTEM.md",
    "/test/agent/AGENTS.md",
  ];

  it("lists Pi's harness entries, the discovered root, and piPackageDir", () => {
    const paths = computeExtensionPaths("/test/agent", "/pi/install");
    expect(paths.piInfrastructureDirs).toEqual([
      ...HARNESS_ENTRIES,
      "/mock/global/node_modules",
      "/pi/install",
    ]);
  });

  it("does not list agentDir itself, so its other entries are not infrastructure", () => {
    const paths = computeExtensionPaths("/test/agent");
    expect(paths.piInfrastructureDirs).not.toContain("/test/agent");
  });

  it("omits global node_modules from piInfrastructureDirs when discovery returns null", () => {
    mockDiscoverGlobalNodeModulesRoot.mockReturnValue(null);
    const paths = computeExtensionPaths("/test/agent");
    expect(paths.piInfrastructureDirs).toEqual(HARNESS_ENTRIES);
  });

  it("omits piPackageDir when not provided", () => {
    const paths = computeExtensionPaths("/test/agent");
    expect(paths.piInfrastructureDirs).toEqual([
      ...HARNESS_ENTRIES,
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
