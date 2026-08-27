import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Mock node:os so tilde-expansion is deterministic across platforms.
// Every other binding passes through, so `tmpdir()` reaches the real module
// for the filesystem-backed `entryExists` fixtures below.
vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  const homedir = vi.fn(() => "/mock/home");
  return {
    ...actual,
    homedir,
    default: { ...actual, homedir },
  };
});

// Mock node:fs so realpathSync (used by canonicalizePath) is controllable.
// Default implementation is identity — lexical assertions are unaffected.
// Every other fs binding passes through to the real module, so filesystem-
// backed helpers (lstatSync, mkdtempSync, symlinkSync, …) stay usable here.
const realpathSync = vi.hoisted(() =>
  vi.fn<(path: string) => string>((p) => p),
);
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    realpathSync,
    default: { ...actual, realpathSync },
  };
});

import { posixPathFlavor, win32PathFlavor } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path-normalizer";
import { createTmpFixture } from "#test/helpers/tmp-fixture";

describe("PathNormalizer", () => {
  beforeEach(() => {
    realpathSync.mockReset();
    realpathSync.mockImplementation((p: string) => p);
  });

  describe("posix flavor", () => {
    const normalizer = new PathNormalizer(posixPathFlavor, "/projects/my-app");

    test("forPath builds an AccessPath resolved against the baked cwd", () => {
      const ap = normalizer.forPath("src/foo.ts");
      expect(ap.value()).toBe("/projects/my-app/src/foo.ts");
      expect(ap.matchValues()).toEqual([
        "/projects/my-app/src/foo.ts",
        "src/foo.ts",
      ]);
    });

    test("forPath honors an explicit resolveBase", () => {
      const ap = normalizer.forPath("foo.ts", {
        resolveBase: "/projects/my-app/sub",
      });
      expect(ap.value()).toBe("/projects/my-app/sub/foo.ts");
    });

    test("forLiteral builds a literal-only AccessPath", () => {
      const ap = normalizer.forLiteral("foo.ts");
      expect(ap.matchValues()).toEqual(["foo.ts"]);
      expect(ap.boundaryValue()).toBe("");
    });

    test("isAbsolute uses posix rules", () => {
      expect(normalizer.isAbsolute("/etc/hosts")).toBe(true);
      expect(normalizer.isAbsolute("rel/path")).toBe(false);
    });

    test("resolveBase resolves an offset against the baked cwd", () => {
      expect(normalizer.resolveBase("sub")).toBe("/projects/my-app/sub");
      expect(normalizer.resolveBase("/abs")).toBe("/abs");
    });

    test("joinBase joins an offset with a relative target", () => {
      expect(normalizer.joinBase("sub", "nested")).toBe("sub/nested");
    });

    test("isWithinDirectory decides containment", () => {
      expect(normalizer.isWithinDirectory("/a/b/c", "/a/b")).toBe(true);
      expect(normalizer.isWithinDirectory("/a/x", "/a/b")).toBe(false);
    });

    test("isOutsideWorkingDirectory tests against the baked cwd", () => {
      expect(normalizer.isOutsideWorkingDirectory("/projects/my-app/src")).toBe(
        false,
      );
      expect(normalizer.isOutsideWorkingDirectory("/etc/hosts")).toBe(true);
    });

    test("isOutsideWorkingDirectory expands a home-relative token", () => {
      expect(normalizer.isOutsideWorkingDirectory("~/secrets")).toBe(true);
    });

    test("isOutsideWorkingDirectory resolves a relative token inside cwd", () => {
      expect(normalizer.isOutsideWorkingDirectory("src/index.ts")).toBe(false);
    });

    test("isOutsideWorkingDirectory follows an in-cwd symlink to an external target", () => {
      // ./link -> /etc: realpathSync resolves the full token in one call.
      realpathSync.mockImplementation((p: string) => {
        if (p === "/projects/my-app/link/hosts") return "/etc/hosts";
        return p;
      });
      expect(normalizer.isOutsideWorkingDirectory("./link/hosts")).toBe(true);
    });

    test("isOutsideWorkingDirectory keeps a path inside a symlinked cwd", () => {
      // /tmp -> /private/tmp on macOS; cwd reported as the resolved /private/tmp.
      realpathSync.mockImplementation((p: string) => {
        if (p.startsWith("/tmp/")) return `/private/tmp${p.slice(4)}`;
        if (p === "/tmp") return "/private/tmp";
        return p;
      });
      const symlinkNormalizer = new PathNormalizer(
        posixPathFlavor,
        "/private/tmp",
      );
      expect(
        symlinkNormalizer.isOutsideWorkingDirectory("/tmp/workspace/file.ts"),
      ).toBe(false);
    });

    test("comparableValue returns the lexical absolute form (no FS)", () => {
      expect(normalizer.comparableValue("src/foo.ts")).toBe(
        "/projects/my-app/src/foo.ts",
      );
      expect(normalizer.comparableValue("/etc/hosts")).toBe("/etc/hosts");
    });

    test("forBashToken delegates to forPath on posix", () => {
      const ap = normalizer.forBashToken("src/foo.ts");
      expect(ap.value()).toBe("/projects/my-app/src/foo.ts");
    });

    test("isBoundaryOutsideWorkingDirectory tests a canonical path against cwd", () => {
      expect(
        normalizer.isBoundaryOutsideWorkingDirectory("/projects/my-app/src"),
      ).toBe(false);
      expect(normalizer.isBoundaryOutsideWorkingDirectory("/etc/hosts")).toBe(
        true,
      );
    });

    test("isBoundaryOutsideWorkingDirectory excludes a safe device path", () => {
      expect(normalizer.isBoundaryOutsideWorkingDirectory("/dev/null")).toBe(
        false,
      );
    });

    test("interpretBashCdTarget maps an absolute target to absolute (posix)", () => {
      expect(normalizer.interpretBashCdTarget("/etc")).toEqual({
        kind: "absolute",
        value: "/etc",
      });
    });

    test("interpretBashCdTarget maps a relative target to relative (posix)", () => {
      expect(normalizer.interpretBashCdTarget("sub")).toEqual({
        kind: "relative",
      });
    });

    test("approvalPatternFor scopes a resolved path to its directory", () => {
      expect(
        normalizer.approvalPatternFor(normalizer.forPath("src/foo.ts")),
      ).toBe("/projects/my-app/src/*");
    });

    test("approvalPatternFor scopes an absolute path outside the cwd", () => {
      expect(
        normalizer.approvalPatternFor(normalizer.forPath("/other/pkg/x.ts")),
      ).toBe("/other/pkg/*");
    });
  });

  describe("win32 flavor", () => {
    const normalizer = new PathNormalizer(win32PathFlavor, "C:\\Projects\\App");

    test("forPath builds a case-folded AccessPath with win32 rules", () => {
      const ap = normalizer.forPath("src\\foo.ts");
      expect(ap.value()).toBe("c:\\projects\\app\\src\\foo.ts");
      expect(ap.matchValues()).toEqual([
        "c:\\projects\\app\\src\\foo.ts",
        "src\\foo.ts",
      ]);
    });

    test("isAbsolute uses win32 rules", () => {
      expect(normalizer.isAbsolute("C:\\Users\\foo")).toBe(true);
      expect(normalizer.isAbsolute("rel\\path")).toBe(false);
    });

    test("resolveBase resolves an offset against the baked cwd", () => {
      expect(normalizer.resolveBase("sub")).toBe("C:\\Projects\\App\\sub");
    });

    test("joinBase joins an offset with a relative target", () => {
      expect(normalizer.joinBase("sub", "nested")).toBe("sub\\nested");
    });

    test("isWithinDirectory folds case", () => {
      expect(
        normalizer.isWithinDirectory(
          "c:\\users\\foo\\dir\\sub",
          "C:\\Users\\Foo\\dir",
        ),
      ).toBe(true);
    });

    test("isOutsideWorkingDirectory case-folds against the baked cwd", () => {
      expect(
        normalizer.isOutsideWorkingDirectory("c:\\projects\\app\\src"),
      ).toBe(false);
      expect(normalizer.isOutsideWorkingDirectory("C:\\Other\\dir")).toBe(true);
    });

    test("comparableValue case-folds the lexical absolute form", () => {
      expect(normalizer.comparableValue("src\\foo.ts")).toBe(
        "c:\\projects\\app\\src\\foo.ts",
      );
    });

    test("forBashToken preserves a POSIX device path as a safe device", () => {
      const ap = normalizer.forBashToken("/dev/null");
      expect(ap.value()).toBe("/dev/null");
      expect(ap.boundaryValue()).toBe("/dev/null");
      expect(
        normalizer.isBoundaryOutsideWorkingDirectory(ap.boundaryValue()),
      ).toBe(false);
    });

    test("forBashToken preserves all four safe device paths", () => {
      for (const device of [
        "/dev/null",
        "/dev/stdin",
        "/dev/stdout",
        "/dev/stderr",
      ]) {
        expect(normalizer.forBashToken(device).boundaryValue()).toBe(device);
      }
    });

    test("forBashToken translates an MSYS drive mount to a Windows path", () => {
      const ap = normalizer.forBashToken("/c/Other/x");
      expect(ap.value()).toBe("c:\\other\\x");
      expect(
        normalizer.isBoundaryOutsideWorkingDirectory(ap.boundaryValue()),
      ).toBe(true);
    });

    test("forBashToken translates an in-cwd drive mount (not external)", () => {
      const ap = normalizer.forBashToken("/c/projects/app/inside.txt");
      expect(ap.value()).toBe("c:\\projects\\app\\inside.txt");
      expect(
        normalizer.isBoundaryOutsideWorkingDirectory(ap.boundaryValue()),
      ).toBe(false);
    });

    test("forBashToken keeps a non-mount POSIX absolute as a literal", () => {
      const ap = normalizer.forBashToken("/tmp/foo");
      // Matched and displayed as typed: the matcher folds separators on both
      // the rule and the value, so a /tmp/* rule resolves without an alias.
      expect(ap.value()).toBe("/tmp/foo");
      expect(ap.boundaryValue()).toBe("");
      expect(ap.matchValues()).toEqual(["/tmp/foo"]);
    });

    test("interpretBashCdTarget translates a drive-mount target to absolute", () => {
      expect(normalizer.interpretBashCdTarget("/c/Other")).toEqual({
        kind: "absolute",
        value: "C:\\Other",
      });
    });

    test("interpretBashCdTarget maps a non-mount POSIX absolute to unknown", () => {
      expect(normalizer.interpretBashCdTarget("/tmp")).toEqual({
        kind: "unknown",
      });
    });

    test("interpretBashCdTarget maps a native drive path to absolute", () => {
      expect(normalizer.interpretBashCdTarget("C:\\Other")).toEqual({
        kind: "absolute",
        value: "C:\\Other",
      });
    });

    test("interpretBashCdTarget maps a relative target to relative (win32)", () => {
      expect(normalizer.interpretBashCdTarget("sub")).toEqual({
        kind: "relative",
      });
    });

    test("isBoundaryOutsideWorkingDirectory case-folds against the baked cwd", () => {
      expect(
        normalizer.isBoundaryOutsideWorkingDirectory("c:\\projects\\app\\src"),
      ).toBe(false);
      expect(
        normalizer.isBoundaryOutsideWorkingDirectory("c:\\other\\dir"),
      ).toBe(true);
    });

    test("approvalPatternFor scopes a native windows path with backslashes", () => {
      expect(
        normalizer.approvalPatternFor(normalizer.forPath("src\\foo.ts")),
      ).toBe("c:\\projects\\app\\src\\*");
    });

    test("approvalPatternFor keeps a Git Bash device token POSIX-shaped", () => {
      expect(
        normalizer.approvalPatternFor(normalizer.forBashToken("/dev/null")),
      ).toBe("/dev/*");
    });

    test("approvalPatternFor scopes a POSIX-absolute directory token to itself", () => {
      // A trailing separator names the directory, so the grant must not widen
      // to its parent — the win32 defect #655 fixes.
      expect(
        normalizer.approvalPatternFor(normalizer.forBashToken("/tmp/logs/")),
      ).toBe("/tmp/logs/*");
    });

    test("approvalPatternFor scopes a POSIX-absolute file token to its parent", () => {
      expect(
        normalizer.approvalPatternFor(normalizer.forBashToken("/tmp/logs")),
      ).toBe("/tmp/*");
    });
  });

  describe("isInfrastructureRead", () => {
    const normalizer = new PathNormalizer(posixPathFlavor, "/projects/my-app");

    test("allows a read-only tool targeting a configured infra dir", () => {
      const ap = normalizer.forPath("/infra/git/pkg/SKILL.md");
      expect(normalizer.isInfrastructureRead("read", ap, ["/infra"])).toBe(
        true,
      );
    });

    test("does not allow a write tool targeting an infra dir", () => {
      const ap = normalizer.forPath("/infra/git/pkg/file.ts");
      expect(normalizer.isInfrastructureRead("write", ap, ["/infra"])).toBe(
        false,
      );
    });

    test("does not allow a read-only tool outside any infra dir", () => {
      const ap = normalizer.forPath("/elsewhere/file.ts");
      expect(normalizer.isInfrastructureRead("read", ap, ["/infra"])).toBe(
        false,
      );
    });

    test("allows a read targeting the project-local .pi/npm dir (from baked cwd)", () => {
      const ap = normalizer.forPath("/projects/my-app/.pi/npm/dep/index.js");
      expect(normalizer.isInfrastructureRead("read", ap, [])).toBe(true);
    });
  });

  describe("entryExists", () => {
    // Real filesystem: the probe's whole purpose is to consult fs state, so
    // these use actual temp files rather than the mocked realpathSync above.
    const tmp = createTmpFixture();
    let root: string;
    let normalizer: PathNormalizer;

    beforeEach(() => {
      root = tmp.dir("pi-perm-exists-");
      normalizer = new PathNormalizer(posixPathFlavor, root);
    });

    afterEach(() => {
      tmp.cleanup();
    });

    test("existing regular file → true", () => {
      const file = tmp.file(root, "secret.txt", "contents");
      expect(normalizer.entryExists(file)).toBe(true);
    });

    test("existing directory → true", () => {
      const dir = tmp.subdir(root, "nested");
      expect(normalizer.entryExists(dir)).toBe(true);
    });

    test("symlink to an existing target → true", () => {
      const target = tmp.file(root, "target.txt");
      const link = tmp.symlink(root, "link", target);
      expect(normalizer.entryExists(link)).toBe(true);
    });

    test("dangling symlink → true (lstat: the link itself is an entry)", () => {
      const link = tmp.symlink(root, "dangling", join(root, "gone.txt"));
      expect(normalizer.entryExists(link)).toBe(true);
    });

    test("nonexistent path → false", () => {
      expect(normalizer.entryExists(join(root, "missing.txt"))).toBe(false);
    });

    test("path under a nonexistent parent → false (ENOTDIR/ENOENT)", () => {
      expect(normalizer.entryExists(join(root, "no-dir", "file.txt"))).toBe(
        false,
      );
    });

    test("empty path → false", () => {
      expect(normalizer.entryExists("")).toBe(false);
    });

    test("answers from the filesystem, not the flavor — win32 normalizer agrees", () => {
      const file = tmp.file(root, "flavor-independent.txt");
      const win32Normalizer = new PathNormalizer(win32PathFlavor, root);
      expect(win32Normalizer.entryExists(file)).toBe(true);
      expect(win32Normalizer.entryExists(join(root, "nope.txt"))).toBe(false);
    });
  });
});
