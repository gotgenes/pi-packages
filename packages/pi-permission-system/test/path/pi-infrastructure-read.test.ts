import { homedir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Hoisted stub so the vi.mock factory can reference it.
const { mockSpawnSync } = vi.hoisted(() => ({
  mockSpawnSync: vi.fn(),
}));

// Mock node:child_process so tests that exercise the subprocess fallback path
// don't actually invoke npm.  Default: subprocess fails (non-zero exit), so
// tests focused on the walk-up strategy continue to expect null.
vi.mock("node:child_process", () => ({
  spawnSync: mockSpawnSync,
  default: { spawnSync: mockSpawnSync },
}));

import { discoverGlobalNodeModulesRoot } from "#src/path/node-modules-discovery";
import { posixPathFlavor, win32PathFlavor } from "#src/path/path-flavor";
import { isPiInfrastructureRead } from "#src/path/pi-infrastructure-read";

// ── discoverGlobalNodeModulesRoot ──────────────────────────────────────────

describe("discoverGlobalNodeModulesRoot", () => {
  beforeEach(() => {
    // Default: subprocess fails, so walk-up-focused tests see null for URLs
    // with no node_modules ancestor.
    mockSpawnSync.mockReset();
    mockSpawnSync.mockReturnValue({ status: 1, stdout: "" });
  });

  test("returns the node_modules dir when the file is inside one", () => {
    const url =
      "file:///opt/homebrew/lib/node_modules/pi-permission-system/dist/external-directory.js";
    expect(discoverGlobalNodeModulesRoot(url)).toBe(
      "/opt/homebrew/lib/node_modules",
    );
  });

  test("returns node_modules for a deeply nested file", () => {
    const url =
      "file:///home/user/.nvm/versions/node/v20/lib/node_modules/pi-permission-system/src/external-directory.js";
    expect(discoverGlobalNodeModulesRoot(url)).toBe(
      "/home/user/.nvm/versions/node/v20/lib/node_modules",
    );
  });

  test("returns node_modules for a bun global install path", () => {
    const url =
      "file:///home/user/.bun/install/global/node_modules/pi-permission-system/dist/external-directory.js";
    expect(discoverGlobalNodeModulesRoot(url)).toBe(
      "/home/user/.bun/install/global/node_modules",
    );
  });

  test("returns the innermost (closest-to-file) node_modules ancestor", () => {
    // The walk-up algorithm stops at the first node_modules dir it encounters,
    // which is the innermost one when the file is inside a nested install.
    // In practice this never happens for a real global install — the extension
    // is always directly at <global_root>/node_modules/pi-permission-system/…
    const url =
      "file:///opt/lib/node_modules/some-pkg/node_modules/pi-permission-system/dist/index.js";
    expect(discoverGlobalNodeModulesRoot(url)).toBe(
      "/opt/lib/node_modules/some-pkg/node_modules",
    );
  });

  test("returns null when the file is not inside any node_modules directory", () => {
    const url =
      "file:///home/user/development/pi-permission-system/dist/external-directory.js";
    expect(discoverGlobalNodeModulesRoot(url)).toBeNull();
  });

  test("returns null for a root-level file", () => {
    const url = "file:///external-directory.js";
    expect(discoverGlobalNodeModulesRoot(url)).toBeNull();
  });

  test("returns null for an invalid URL", () => {
    expect(discoverGlobalNodeModulesRoot("not-a-url")).toBeNull();
  });

  test("works with the real import.meta.url of this extension (smoke test)", () => {
    // The extension IS installed inside a node_modules tree when running in CI
    // or global install. In a local dev checkout the result may be null — that's
    // the documented graceful-degradation path.
    const result = discoverGlobalNodeModulesRoot();
    expect(result === null || result.endsWith("node_modules")).toBe(true);
  });

  test("the discovered path includes the pi-permission-system package directory", () => {
    const url =
      "file:///opt/homebrew/lib/node_modules/pi-permission-system/dist/external-directory.js";
    const root = discoverGlobalNodeModulesRoot(url);
    expect(root).not.toBeNull();
    expect(join(root!, "pi-permission-system")).toBe(
      "/opt/homebrew/lib/node_modules/pi-permission-system",
    );
  });
});

// ── isPiInfrastructureRead ─────────────────────────────────────────────────

const INFRA_DIRS = [
  "/home/user/.pi/agent",
  "/home/user/.pi/agent/git",
  "/opt/homebrew/lib/node_modules",
];
const CWD = "/home/user/project";

describe("isPiInfrastructureRead", () => {
  // ── read tools allowed for infra paths ──────────────────────────────────

  test("allows 'read' tool for a file inside agentDir", () => {
    expect(
      isPiInfrastructureRead(
        "read",
        "/home/user/.pi/agent/extensions/pi-permission-system/config.json",
        INFRA_DIRS,
        CWD,
        posixPathFlavor,
      ),
    ).toBe(true);
  });

  test("allows 'find' tool for a path inside node_modules infra dir", () => {
    expect(
      isPiInfrastructureRead(
        "find",
        "/opt/homebrew/lib/node_modules/pi-ask-user/skills",
        INFRA_DIRS,
        CWD,
        posixPathFlavor,
      ),
    ).toBe(true);
  });

  test("allows 'grep' tool for a path inside agentDir/git", () => {
    expect(
      isPiInfrastructureRead(
        "grep",
        "/home/user/.pi/agent/git/some-package/README.md",
        INFRA_DIRS,
        CWD,
        posixPathFlavor,
      ),
    ).toBe(true);
  });

  test("allows 'ls' tool for a path inside node_modules infra dir", () => {
    expect(
      isPiInfrastructureRead(
        "ls",
        "/opt/homebrew/lib/node_modules/pi-permission-system",
        INFRA_DIRS,
        CWD,
        posixPathFlavor,
      ),
    ).toBe(true);
  });

  // ── write tools never allowed even for infra paths ───────────────────────

  test("blocks 'write' tool for a file inside agentDir", () => {
    expect(
      isPiInfrastructureRead(
        "write",
        "/home/user/.pi/agent/extensions/pi-permission-system/config.json",
        INFRA_DIRS,
        CWD,
        posixPathFlavor,
      ),
    ).toBe(false);
  });

  test("blocks 'edit' tool for a file inside node_modules", () => {
    expect(
      isPiInfrastructureRead(
        "edit",
        "/opt/homebrew/lib/node_modules/pi-ask-user/skills/ask-user/SKILL.md",
        INFRA_DIRS,
        CWD,
        posixPathFlavor,
      ),
    ).toBe(false);
  });

  test("blocks 'bash' tool regardless of path", () => {
    expect(
      isPiInfrastructureRead(
        "bash",
        "/opt/homebrew/lib/node_modules/pi-ask-user/SKILL.md",
        INFRA_DIRS,
        CWD,
        posixPathFlavor,
      ),
    ).toBe(false);
  });

  // ── non-infra paths not allowed ──────────────────────────────────────────

  test("does not allow 'read' for a path outside all infra dirs", () => {
    expect(
      isPiInfrastructureRead(
        "read",
        "/etc/passwd",
        INFRA_DIRS,
        CWD,
        posixPathFlavor,
      ),
    ).toBe(false);
  });

  test("does not allow 'read' for a path only partially matching an infra dir prefix", () => {
    // /home/user/.pi/agent-other should not match /home/user/.pi/agent
    expect(
      isPiInfrastructureRead(
        "read",
        "/home/user/.pi/agent-other/config.json",
        INFRA_DIRS,
        CWD,
        posixPathFlavor,
      ),
    ).toBe(false);
  });

  // ── project-local Pi packages (.pi/npm, .pi/git) ─────────────────────────

  test("allows 'read' for a path inside project-local .pi/npm/", () => {
    expect(
      isPiInfrastructureRead(
        "read",
        `${CWD}/.pi/npm/node_modules/some-skill/SKILL.md`,
        INFRA_DIRS,
        CWD,
        posixPathFlavor,
      ),
    ).toBe(true);
  });

  test("allows 'read' for a path inside project-local .pi/git/", () => {
    expect(
      isPiInfrastructureRead(
        "read",
        `${CWD}/.pi/git/github.com/org/skill-repo/SKILL.md`,
        INFRA_DIRS,
        CWD,
        posixPathFlavor,
      ),
    ).toBe(true);
  });

  test("blocks 'write' for a path inside project-local .pi/npm/", () => {
    expect(
      isPiInfrastructureRead(
        "write",
        `${CWD}/.pi/npm/node_modules/some-skill/SKILL.md`,
        INFRA_DIRS,
        CWD,
        posixPathFlavor,
      ),
    ).toBe(false);
  });

  // ── empty / edge cases ───────────────────────────────────────────────────

  test("returns false when infrastructureDirs is empty and path is not project-local", () => {
    expect(
      isPiInfrastructureRead("read", "/etc/passwd", [], CWD, posixPathFlavor),
    ).toBe(false);
  });

  test("returns false when infrastructureDirs is empty but path IS project-local .pi/npm", () => {
    // Project-local paths are checked separately from the dirs array.
    expect(
      isPiInfrastructureRead(
        "read",
        `${CWD}/.pi/npm/node_modules/x/SKILL.md`,
        [],
        CWD,
        posixPathFlavor,
      ),
    ).toBe(true);
  });
});

// ── isPiInfrastructureRead — glob patterns ─────────────────────────────────

describe("isPiInfrastructureRead with glob patterns", () => {
  test("glob entry matches a versioned nested path", () => {
    expect(
      isPiInfrastructureRead(
        "read",
        "/opt/homebrew/Cellar/pi-coding-agent/0.74.0/libexec/lib/node_modules/@earendil-works/pi-coding-agent/SKILL.md",
        ["/opt/homebrew/*/@earendil-works/pi-coding-agent/*"],
        CWD,
        posixPathFlavor,
      ),
    ).toBe(true);
  });

  test("** behaves the same as * (matches across path separators)", () => {
    expect(
      isPiInfrastructureRead(
        "read",
        "/opt/homebrew/Cellar/pi-coding-agent/0.74.0/libexec/lib/node_modules/@earendil-works/pi-coding-agent/SKILL.md",
        ["/opt/homebrew/**/@earendil-works/pi-coding-agent/**"],
        CWD,
        posixPathFlavor,
      ),
    ).toBe(true);
  });

  test("glob entry does not match an unrelated path", () => {
    expect(
      isPiInfrastructureRead(
        "read",
        "/etc/passwd",
        ["/opt/homebrew/*/@earendil-works/pi-coding-agent/*"],
        CWD,
        posixPathFlavor,
      ),
    ).toBe(false);
  });

  test("? matches exactly one character", () => {
    expect(
      isPiInfrastructureRead(
        "read",
        "/opt/homebrew/X/file.md",
        ["/opt/homebrew/?/file.md"],
        CWD,
        posixPathFlavor,
      ),
    ).toBe(true);
  });

  test("? does not match multiple characters", () => {
    expect(
      isPiInfrastructureRead(
        "read",
        "/opt/homebrew/abc/file.md",
        ["/opt/homebrew/?/file.md"],
        CWD,
        posixPathFlavor,
      ),
    ).toBe(false);
  });

  test("mixed array of plain dirs and glob patterns — both branches work", () => {
    const dirs = [
      "/home/user/.pi/agent",
      "/opt/homebrew/*/@earendil-works/pi-coding-agent/*",
    ];
    expect(
      isPiInfrastructureRead(
        "read",
        "/home/user/.pi/agent/config.json",
        dirs,
        CWD,
        posixPathFlavor,
      ),
    ).toBe(true);
    expect(
      isPiInfrastructureRead(
        "read",
        "/opt/homebrew/Cellar/pi-coding-agent/0.74.0/libexec/lib/node_modules/@earendil-works/pi-coding-agent/SKILL.md",
        dirs,
        CWD,
        posixPathFlavor,
      ),
    ).toBe(true);
  });

  test("plain entry with ~ prefix matches after home expansion", () => {
    const home = homedir();
    expect(
      isPiInfrastructureRead(
        "read",
        `${home}/.pi/agent/config.json`,
        ["~/.pi/agent"],
        CWD,
        posixPathFlavor,
      ),
    ).toBe(true);
  });

  test("write tool with a glob-matching path is still rejected", () => {
    expect(
      isPiInfrastructureRead(
        "write",
        "/opt/homebrew/Cellar/pi-coding-agent/0.74.0/libexec/lib/node_modules/@earendil-works/pi-coding-agent/SKILL.md",
        ["/opt/homebrew/**/@earendil-works/pi-coding-agent/**"],
        CWD,
        posixPathFlavor,
      ),
    ).toBe(false);
  });
});

// ── isPiInfrastructureRead — win32 case-insensitive matching ───────────────

describe("isPiInfrastructureRead on win32", () => {
  test("plain infra dir matches a case-different path", () => {
    expect(
      isPiInfrastructureRead(
        "read",
        "c:\\users\\foo\\.pi\\agent\\config.json",
        ["C:\\Users\\Foo\\.pi\\agent"],
        "C:\\proj",
        win32PathFlavor,
      ),
    ).toBe(true);
  });

  test("glob infra dir matches case-insensitively", () => {
    expect(
      isPiInfrastructureRead(
        "read",
        "c:\\users\\foo\\npm\\node_modules\\@earendil-works\\pi-coding-agent\\skill.md",
        ["C:\\Users\\Foo\\**\\pi-coding-agent\\**"],
        "C:\\proj",
        win32PathFlavor,
      ),
    ).toBe(true);
  });

  test("rejects a path outside every infra dir", () => {
    expect(
      isPiInfrastructureRead(
        "read",
        "c:\\windows\\system32\\drivers\\etc\\hosts",
        ["C:\\Users\\Foo\\.pi\\agent"],
        "C:\\proj",
        win32PathFlavor,
      ),
    ).toBe(false);
  });
});
