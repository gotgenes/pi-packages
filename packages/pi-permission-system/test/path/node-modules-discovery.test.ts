import { beforeEach, describe, expect, test, vi } from "vitest";

// Hoisted stubs for mocks that reference them in vi.mock factories.
const { mockSpawnSync, mockExistsSync } = vi.hoisted(() => ({
  mockSpawnSync: vi.fn(),
  mockExistsSync: vi.fn(),
}));

// Mock node:child_process so tests don't spawn real subprocesses.
vi.mock("node:child_process", () => ({
  spawnSync: mockSpawnSync,
  default: { spawnSync: mockSpawnSync },
}));

// Mock node:fs so existsSync is controllable.
vi.mock("node:fs", () => ({
  existsSync: mockExistsSync,
  default: { existsSync: mockExistsSync },
}));

import { discoverGlobalNodeModulesRoot } from "#src/path/node-modules-discovery";

describe("discoverGlobalNodeModulesRoot", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
    mockExistsSync.mockReset();
  });

  test("returns node_modules root when URL is inside a node_modules tree", () => {
    const fakeUrl =
      "file:///opt/homebrew/lib/node_modules/@gotgenes/pi-permission-system/dist/external-directory.js";
    const result = discoverGlobalNodeModulesRoot(fakeUrl);
    expect(result).toBe("/opt/homebrew/lib/node_modules");
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  test("calls npm root -g as fallback when walk-up finds no node_modules ancestor", () => {
    const npmRootPath = "/opt/homebrew/lib/node_modules";
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: `${npmRootPath}\n`,
    });
    mockExistsSync.mockReturnValue(true);

    const fakeUrl = "file:///Users/dev/my-project/src/external-directory.ts";
    const result = discoverGlobalNodeModulesRoot(fakeUrl);

    expect(mockSpawnSync).toHaveBeenCalledWith(
      "npm",
      ["root", "-g"],
      expect.objectContaining({ encoding: "utf-8" }),
    );
    expect(result).toBe(npmRootPath);
  });

  test("returns null when walk-up fails and npm root -g returns non-zero exit", () => {
    mockSpawnSync.mockReturnValue({ status: 1, stdout: "" });

    const fakeUrl = "file:///Users/dev/my-project/src/external-directory.ts";
    const result = discoverGlobalNodeModulesRoot(fakeUrl);

    expect(result).toBeNull();
  });

  test("returns null when walk-up fails and spawnSync throws", () => {
    mockSpawnSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const fakeUrl = "file:///Users/dev/my-project/src/external-directory.ts";
    const result = discoverGlobalNodeModulesRoot(fakeUrl);

    expect(result).toBeNull();
  });

  test("returns null when walk-up fails and npm root -g returns non-existent path", () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: "/some/nonexistent/node_modules\n",
    });
    mockExistsSync.mockReturnValue(false);

    const fakeUrl = "file:///Users/dev/my-project/src/external-directory.ts";
    const result = discoverGlobalNodeModulesRoot(fakeUrl);

    expect(result).toBeNull();
  });

  test("returns null when walk-up fails and npm root -g returns empty stdout", () => {
    mockSpawnSync.mockReturnValue({ status: 0, stdout: "   " });

    const fakeUrl = "file:///Users/dev/my-project/src/external-directory.ts";
    const result = discoverGlobalNodeModulesRoot(fakeUrl);

    expect(result).toBeNull();
  });
});
