import { join } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Mock node:os so tilde-expansion is deterministic across platforms.
vi.mock("node:os", () => {
  const homedir = vi.fn(() => "/mock/home");
  return {
    homedir,
    default: { homedir },
  };
});

// Mock node:fs so realpathSync (used by canonicalizePath) is controllable.
// Default implementation is identity — existing lexical tests are unaffected.
const realpathSync = vi.hoisted(() =>
  vi.fn<(path: string) => string>((p) => p),
);
vi.mock("node:fs", () => ({
  realpathSync,
  default: { realpathSync },
}));

import {
  canonicalNormalizePathForComparison,
  getPathPolicyValues,
  normalizePathForComparison,
  normalizePathPolicyLiteral,
} from "#src/access-intent/path-normalization";
import { posixPathFlavor, win32PathFlavor } from "#src/path/path-flavor";

describe("normalizePathForComparison", () => {
  const cwd = "/projects/my-app";

  test("resolves absolute path unchanged", () => {
    expect(
      normalizePathForComparison("/usr/local/bin", cwd, posixPathFlavor),
    ).toBe("/usr/local/bin");
  });

  test("resolves relative path against cwd", () => {
    expect(normalizePathForComparison("src/foo.ts", cwd, posixPathFlavor)).toBe(
      "/projects/my-app/src/foo.ts",
    );
  });

  test("expands bare ~ to homedir", () => {
    expect(normalizePathForComparison("~", cwd, posixPathFlavor)).toBe(
      "/mock/home",
    );
  });

  test("expands ~/... to homedir-relative path", () => {
    expect(
      normalizePathForComparison("~/docs/readme.md", cwd, posixPathFlavor),
    ).toBe(join("/mock/home", "docs/readme.md"));
  });

  test("expands bare $HOME to homedir", () => {
    expect(normalizePathForComparison("$HOME", cwd, posixPathFlavor)).toBe(
      "/mock/home",
    );
  });

  test("expands $HOME/... to homedir-relative path", () => {
    expect(
      normalizePathForComparison("$HOME/.ssh/config", cwd, posixPathFlavor),
    ).toBe(join("/mock/home", ".ssh/config"));
  });

  test("strips leading @ before resolving", () => {
    expect(
      normalizePathForComparison("@/usr/local/bin", cwd, posixPathFlavor),
    ).toBe("/usr/local/bin");
  });

  test("strips surrounding quotes", () => {
    expect(
      normalizePathForComparison("'/usr/local/bin'", cwd, posixPathFlavor),
    ).toBe("/usr/local/bin");
    expect(
      normalizePathForComparison('"/usr/local/bin"', cwd, posixPathFlavor),
    ).toBe("/usr/local/bin");
  });

  test("returns empty string for blank/whitespace-only path", () => {
    expect(normalizePathForComparison("", cwd, posixPathFlavor)).toBe("");
    expect(normalizePathForComparison("   ", cwd, posixPathFlavor)).toBe("");
  });

  // ── injected platform flavor (Windows is case-folded, win32-resolved) ────

  test("win32: lowercases the resolved absolute path", () => {
    expect(
      normalizePathForComparison(
        "C:\\Users\\Foo\\Bar.txt",
        "C:\\Projects",
        win32PathFlavor,
      ),
    ).toBe("c:\\users\\foo\\bar.txt");
  });

  test("win32: resolves a relative path against cwd with win32 rules", () => {
    expect(
      normalizePathForComparison(
        "src\\foo.ts",
        "C:\\Projects\\App",
        win32PathFlavor,
      ),
    ).toBe("c:\\projects\\app\\src\\foo.ts");
  });

  test("posix platform leaves case untouched", () => {
    expect(
      normalizePathForComparison("/Projects/App/Src.ts", cwd, posixPathFlavor),
    ).toBe("/Projects/App/Src.ts");
  });
});

describe("canonicalNormalizePathForComparison", () => {
  const cwd = "/projects/my-app";

  beforeEach(() => {
    realpathSync.mockReset();
    realpathSync.mockImplementation((p: string) => p);
  });

  test("returns canonical form of an existing path", () => {
    realpathSync.mockImplementation((p: string) => {
      if (p === "/projects/link") return "/real/projects/app";
      return p;
    });
    expect(
      canonicalNormalizePathForComparison(
        "/projects/link",
        cwd,
        posixPathFlavor,
      ),
    ).toBe("/real/projects/app");
  });

  test("returns empty string for empty input", () => {
    expect(canonicalNormalizePathForComparison("", cwd, posixPathFlavor)).toBe(
      "",
    );
  });

  test("returns lexical form when no symlinks (identity realpathSync)", () => {
    expect(
      canonicalNormalizePathForComparison(
        "/projects/my-app/src/index.ts",
        cwd,
        posixPathFlavor,
      ),
    ).toBe("/projects/my-app/src/index.ts");
  });

  test("win32: lowercases the canonical form", () => {
    expect(
      canonicalNormalizePathForComparison(
        "C:\\Projects\\App\\Src",
        "C:\\Projects\\App",
        win32PathFlavor,
      ),
    ).toBe("c:\\projects\\app\\src");
  });
});

describe("normalizePathPolicyLiteral", () => {
  test("returns a relative token unchanged", () => {
    expect(normalizePathPolicyLiteral("src/foo.ts")).toBe("src/foo.ts");
  });

  test("trims and strips simple wrapping quotes", () => {
    expect(normalizePathPolicyLiteral("  'src/foo.ts'  ")).toBe("src/foo.ts");
    expect(normalizePathPolicyLiteral('"a/b"')).toBe("a/b");
  });

  test("strips a leading @ prefix", () => {
    expect(normalizePathPolicyLiteral("@src/foo.ts")).toBe("src/foo.ts");
  });

  test("expands ~ to the home directory", () => {
    expect(normalizePathPolicyLiteral("~/docs/readme.md")).toBe(
      join("/mock/home", "docs/readme.md"),
    );
  });

  test("does not resolve a relative value against any cwd", () => {
    expect(normalizePathPolicyLiteral("foo.ts")).toBe("foo.ts");
  });

  test("returns empty string for blank input", () => {
    expect(normalizePathPolicyLiteral("   ")).toBe("");
  });

  test("preserves the surface catch-all", () => {
    expect(normalizePathPolicyLiteral("*")).toBe("*");
  });
});

describe("getPathPolicyValues", () => {
  const cwd = "/projects/my-app";

  test("returns only the literal when no base is available", () => {
    expect(getPathPolicyValues("src/foo.ts", {}, posixPathFlavor)).toEqual([
      "src/foo.ts",
    ]);
    expect(getPathPolicyValues("src/foo.ts", {}, posixPathFlavor)).toEqual([
      "src/foo.ts",
    ]);
  });

  test("adds absolute and project-relative aliases for a relative token", () => {
    expect(getPathPolicyValues("src/foo.ts", { cwd }, posixPathFlavor)).toEqual(
      ["/projects/my-app/src/foo.ts", "src/foo.ts"],
    );
  });

  test("omits the relative alias for a token outside cwd", () => {
    expect(getPathPolicyValues("/etc/hosts", { cwd }, posixPathFlavor)).toEqual(
      ["/etc/hosts"],
    );
  });

  test("resolves against resolveBase while aliasing relative to cwd", () => {
    expect(
      getPathPolicyValues(
        "foo.txt",
        {
          cwd,
          resolveBase: "/projects/my-app/nested",
        },
        posixPathFlavor,
      ),
    ).toEqual(["/projects/my-app/nested/foo.txt", "nested/foo.txt", "foo.txt"]);
  });

  test("preserves the surface catch-all", () => {
    expect(getPathPolicyValues("*", { cwd }, posixPathFlavor)).toEqual(["*"]);
  });

  test("returns empty for blank input", () => {
    expect(getPathPolicyValues("   ", { cwd }, posixPathFlavor)).toEqual([]);
  });
});
