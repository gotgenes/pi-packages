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
// Default implementation is identity — lexical tests are unaffected.
const realpathSync = vi.hoisted(() => {
  const fn = vi.fn<(path: string) => string>((p) => p);
  // `native` is the same spy, so the POSIX canonicalizer is controlled too.
  return Object.assign(fn, { native: fn });
});
vi.mock("node:fs", () => ({
  realpathSync,
  default: { realpathSync },
}));

import { AccessPath } from "#src/access-intent/access-path";
import { posixPathFlavor, win32PathFlavor } from "#src/path/path-flavor";

describe("AccessPath.forPath", () => {
  const cwd = "/projects/my-app";

  beforeEach(() => {
    realpathSync.mockReset();
    realpathSync.mockImplementation((p: string) => p);
  });

  describe("matchValues()", () => {
    test("adds the symlink-resolved alias alongside the typed path", () => {
      // /tmp -> /private/tmp (the macOS symlink from the bug report, #418).
      realpathSync.mockImplementation((p: string) =>
        p.startsWith("/tmp") ? `/private${p}` : p,
      );
      expect(
        AccessPath.forPath("/tmp/x", {
          cwd,
          flavor: posixPathFlavor,
        }).matchValues(),
      ).toEqual(["/tmp/x", "/private/tmp/x"]);
    });

    test("deduplicates when the canonical form equals the lexical form", () => {
      expect(
        AccessPath.forPath("/etc/hosts", {
          cwd,
          flavor: posixPathFlavor,
        }).matchValues(),
      ).toEqual(["/etc/hosts"]);
    });

    test("keeps the relative aliases for an in-cwd token without duplicating", () => {
      expect(
        AccessPath.forPath("src/foo.ts", {
          cwd,
          flavor: posixPathFlavor,
        }).matchValues(),
      ).toEqual(["/projects/my-app/src/foo.ts", "src/foo.ts"]);
    });

    test("includes only the lexical aliases when canonical is empty", () => {
      // Force canonicalizePath to return the original (no-op symlink resolution
      // effectively means canonical === lexical, handled by dedup).
      expect(
        AccessPath.forPath("/etc/hosts", {
          cwd,
          flavor: posixPathFlavor,
        }).matchValues(),
      ).not.toHaveLength(0);
    });

    test("resolves a relative token against an explicit resolveBase", () => {
      // The cd-folded effective base differs from cwd (the bash-path case).
      expect(
        AccessPath.forPath("foo.ts", {
          cwd,
          resolveBase: "/projects/my-app/sub",
          flavor: posixPathFlavor,
        }).matchValues(),
      ).toEqual(["/projects/my-app/sub/foo.ts", "sub/foo.ts", "foo.ts"]);
    });

    test("adds the canonical alias resolved against resolveBase", () => {
      realpathSync.mockImplementation((p: string) =>
        p === "/projects/my-app/sub/foo.ts" ? "/real/foo.ts" : p,
      );
      expect(
        AccessPath.forPath("foo.ts", {
          cwd,
          resolveBase: "/projects/my-app/sub",
          flavor: posixPathFlavor,
        }).matchValues(),
      ).toEqual([
        "/projects/my-app/sub/foo.ts",
        "sub/foo.ts",
        "foo.ts",
        "/real/foo.ts",
      ]);
    });
  });

  describe("platform option", () => {
    test("win32: builds lexical/match/boundary values with win32 rules", () => {
      const ap = AccessPath.forPath("src\\foo.ts", {
        cwd: "C:\\Projects\\App",
        flavor: win32PathFlavor,
      });
      expect(ap.value()).toBe("c:\\projects\\app\\src\\foo.ts");
      expect(ap.boundaryValue()).toBe("c:\\projects\\app\\src\\foo.ts");
      expect(ap.matchValues()).toEqual([
        "c:\\projects\\app\\src\\foo.ts",
        "src\\foo.ts",
      ]);
    });

    test("win32: lowercases the symlink-resolved boundary value", () => {
      realpathSync.mockImplementation((p: string) =>
        p === "c:\\projects\\app\\link" ? "C:\\Real\\App" : p,
      );
      expect(
        AccessPath.forPath("link", {
          cwd: "C:\\Projects\\App",
          flavor: win32PathFlavor,
        }).boundaryValue(),
      ).toBe("c:\\real\\app");
    });
  });

  describe("boundaryValue()", () => {
    test("returns the canonical (symlink-resolved) form", () => {
      realpathSync.mockImplementation((p: string) =>
        p.startsWith("/tmp") ? `/private${p}` : p,
      );
      expect(
        AccessPath.forPath("/tmp/x", {
          cwd,
          flavor: posixPathFlavor,
        }).boundaryValue(),
      ).toBe("/private/tmp/x");
    });

    test("returns the lexical form when path has no symlinks", () => {
      expect(
        AccessPath.forPath("/etc/hosts", {
          cwd,
          flavor: posixPathFlavor,
        }).boundaryValue(),
      ).toBe("/etc/hosts");
    });

    test("returns empty string for empty input", () => {
      expect(
        AccessPath.forPath("", {
          cwd,
          flavor: posixPathFlavor,
        }).boundaryValue(),
      ).toBe("");
    });
  });

  describe("value()", () => {
    test("returns the lexical (as-typed, normalized) form", () => {
      realpathSync.mockImplementation((p: string) =>
        p.startsWith("/tmp") ? `/private${p}` : p,
      );
      // Even when the path resolves to a different canonical, value() stays lexical.
      expect(
        AccessPath.forPath("/tmp/x", { cwd, flavor: posixPathFlavor }).value(),
      ).toBe("/tmp/x");
    });

    test("normalizes the path against cwd", () => {
      // A relative path becomes an absolute lexical value.
      expect(
        AccessPath.forPath("src/foo.ts", {
          cwd,
          flavor: posixPathFlavor,
        }).value(),
      ).toBe("/projects/my-app/src/foo.ts");
    });

    test("normalizes a relative path against an explicit resolveBase", () => {
      expect(
        AccessPath.forPath("foo.ts", {
          cwd,
          resolveBase: "/projects/my-app/sub",
          flavor: posixPathFlavor,
        }).value(),
      ).toBe("/projects/my-app/sub/foo.ts");
    });

    test("returns empty string for empty input", () => {
      expect(
        AccessPath.forPath("", { cwd, flavor: posixPathFlavor }).value(),
      ).toBe("");
    });
  });
});

describe("resolvedAlias()", () => {
  const cwd = "/projects/my-app";

  beforeEach(() => {
    realpathSync.mockReset();
    realpathSync.mockImplementation((p: string) => p);
  });

  test("returns the canonical form when a symlink resolves elsewhere", () => {
    realpathSync.mockImplementation((p: string) =>
      p === "/projects/my-app/demo-symlink-passwd" ? "/etc/passwd" : p,
    );
    expect(
      AccessPath.forPath("demo-symlink-passwd", {
        cwd,
        flavor: posixPathFlavor,
      }).resolvedAlias(),
    ).toBe("/etc/passwd");
  });

  test("returns undefined when the path has no symlinks (canonical equals lexical)", () => {
    expect(
      AccessPath.forPath("/etc/hosts", {
        cwd,
        flavor: posixPathFlavor,
      }).resolvedAlias(),
    ).toBeUndefined();
  });

  test("returns undefined for a literal-only path (no canonical)", () => {
    expect(AccessPath.forLiteral("foo.ts").resolvedAlias()).toBeUndefined();
  });

  test("returns undefined for empty input", () => {
    expect(
      AccessPath.forPath("", { cwd, flavor: posixPathFlavor }).resolvedAlias(),
    ).toBeUndefined();
  });

  test("win32: returns the lowercased canonical form for a real symlink target", () => {
    realpathSync.mockImplementation((p: string) =>
      p === "c:\\projects\\app\\link" ? "C:\\Real\\App" : p,
    );
    expect(
      AccessPath.forPath("link", {
        cwd: "C:\\Projects\\App",
        flavor: win32PathFlavor,
      }).resolvedAlias(),
    ).toBe("c:\\real\\app");
  });

  test("win32: returns undefined for a case-only difference (both forms lowercased)", () => {
    expect(
      AccessPath.forPath("src\\foo.ts", {
        cwd: "C:\\Projects\\App",
        flavor: win32PathFlavor,
      }).resolvedAlias(),
    ).toBeUndefined();
  });
});

describe("AccessPath.forDevice", () => {
  test("lexical, boundary, and match values are all the device path", () => {
    const ap = AccessPath.forDevice("/dev/null");
    expect(ap.value()).toBe("/dev/null");
    expect(ap.boundaryValue()).toBe("/dev/null");
    expect(ap.matchValues()).toEqual(["/dev/null"]);
  });

  test("resolvedAlias is undefined (canonical equals lexical)", () => {
    expect(AccessPath.forDevice("/dev/null").resolvedAlias()).toBeUndefined();
  });
});

describe("AccessPath.forLiteral", () => {
  beforeEach(() => {
    realpathSync.mockReset();
    realpathSync.mockImplementation((p: string) => p);
  });

  test("matchValues() carries only the literal — no canonical, no absolute", () => {
    expect(AccessPath.forLiteral("foo.ts").matchValues()).toEqual(["foo.ts"]);
  });

  test("boundaryValue() is empty (no outside-cwd notion for an unknown base)", () => {
    expect(AccessPath.forLiteral("foo.ts").boundaryValue()).toBe("");
  });

  test("value() returns the literal", () => {
    expect(AccessPath.forLiteral("foo.ts").value()).toBe("foo.ts");
  });

  test("an empty literal yields no match values", () => {
    expect(AccessPath.forLiteral("").matchValues()).toEqual([]);
    expect(AccessPath.forLiteral("").value()).toBe("");
  });
});

describe("AccessPath.forNativeTarget", () => {
  const cwd = "/projects/my-app";
  const options = { cwd, flavor: posixPathFlavor };

  beforeEach(() => {
    realpathSync.mockReset();
    realpathSync.mockImplementation((p: string) => p);
  });

  describe("matchValues()", () => {
    test("equals forPath's for an unrewritten relative spelling", () => {
      const native = AccessPath.forNativeTarget(
        {
          target: "/projects/my-app/.env",
          rewritten: false,
          relativeSpelling: ".env",
        },
        options,
      );
      expect(native).toEqual(AccessPath.forPath(".env", options));
      expect(native.matchValues()).toEqual(["/projects/my-app/.env", ".env"]);
    });

    test("keeps a relative spelling that escapes cwd", () => {
      expect(
        AccessPath.forNativeTarget(
          {
            target: "/projects/other/x",
            rewritten: false,
            relativeSpelling: "../other/x",
          },
          options,
        ).matchValues(),
      ).toEqual(["/projects/other/x", "../other/x"]);
    });

    test("adds the symlink-resolved alias", () => {
      realpathSync.mockImplementation((p: string) =>
        p.startsWith("/tmp") ? `/private${p}` : p,
      );
      expect(
        AccessPath.forNativeTarget(
          { target: "/tmp/x", rewritten: false },
          options,
        ).matchValues(),
      ).toEqual(["/tmp/x", "/private/tmp/x"]);
    });
  });

  describe("value()", () => {
    test.each([
      ["a trailing quote", "/projects/my-app/x'"],
      ["a trailing space", "/projects/my-app/x "],
      ["a $HOME segment", "/projects/my-app/$HOME/x"],
    ])("keeps %s the tool opens", (_label, target) => {
      expect(
        AccessPath.forNativeTarget(
          { target, rewritten: false },
          options,
        ).value(),
      ).toBe(target);
    });

    test("folds case under the win32 flavor", () => {
      expect(
        AccessPath.forNativeTarget(
          { target: "C:\\Proj\\A.txt", rewritten: false },
          { cwd: "C:\\Proj", flavor: win32PathFlavor },
        ).value(),
      ).toBe("c:\\proj\\a.txt");
    });
  });

  describe("resolvedAlias()", () => {
    test("discloses a rewritten target", () => {
      expect(
        AccessPath.forNativeTarget(
          { target: "/x/d\u2019x.txt", rewritten: true },
          options,
        ).resolvedAlias(),
      ).toBe("/x/d\u2019x.txt");
    });

    test("discloses the canonical form when it differs", () => {
      realpathSync.mockImplementation((p: string) =>
        p.startsWith("/tmp") ? `/private${p}` : p,
      );
      expect(
        AccessPath.forNativeTarget(
          { target: "/tmp/x", rewritten: true },
          options,
        ).resolvedAlias(),
      ).toBe("/private/tmp/x");
    });

    test("discloses nothing for an unrewritten target", () => {
      expect(
        AccessPath.forNativeTarget(
          { target: "/x/a.txt", rewritten: false },
          options,
        ).resolvedAlias(),
      ).toBeUndefined();
    });
  });
});
