import { beforeEach, describe, expect, test, vi } from "vitest";

// `native` is a separate spy from the JS `realpathSync`, so a test can tell
// which of the two a flavor resolves through.
const { realpathSync, nativeRealpath } = vi.hoisted(() => {
  const nativeRealpath = vi.fn<(path: string) => string>();
  const realpathSync = Object.assign(vi.fn<(path: string) => string>(), {
    native: nativeRealpath,
  });
  return { realpathSync, nativeRealpath };
});

vi.mock("node:fs", () => ({
  realpathSync,
  default: { realpathSync },
}));

import { canonicalizePath } from "#src/path/canonicalize-path";
import { posixPathFlavor, win32PathFlavor } from "#src/path/path-flavor";

function enoent(p: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`ENOENT: no such file or directory '${p}'`), {
    code: "ENOENT",
  });
}

describe("canonicalizePath", () => {
  beforeEach(() => {
    realpathSync.mockReset();
    nativeRealpath.mockReset();
  });

  test("returns empty string for empty input", () => {
    expect(canonicalizePath("", posixPathFlavor)).toBe("");
  });

  describe("posix: resolves through the native realpath", () => {
    test("returns the spelling the filesystem stores for an existing path", () => {
      nativeRealpath.mockImplementation((p) =>
        p === "/real/upper.txt" ? "/real/Upper.txt" : p,
      );
      expect(canonicalizePath("/real/upper.txt", posixPathFlavor)).toBe(
        "/real/Upper.txt",
      );
      expect(realpathSync).not.toHaveBeenCalled();
    });

    test("returns the realpath result when the path exists", () => {
      nativeRealpath.mockReturnValueOnce("/real/projects/app");
      expect(canonicalizePath("/projects/link", posixPathFlavor)).toBe(
        "/real/projects/app",
      );
    });

    test("re-appends a non-existent leaf to the canonical parent", () => {
      nativeRealpath
        .mockImplementationOnce(() => {
          throw enoent("/projects/app/new-file.ts");
        })
        .mockReturnValueOnce("/canonical/app");
      expect(
        canonicalizePath("/projects/app/new-file.ts", posixPathFlavor),
      ).toBe("/canonical/app/new-file.ts");
    });

    test("walks up multiple levels for a deeply non-existent path", () => {
      nativeRealpath
        .mockImplementationOnce(() => {
          throw enoent("/projects/app/src/new-file.ts");
        })
        .mockImplementationOnce(() => {
          throw enoent("/projects/app/src");
        })
        .mockImplementationOnce(() => {
          throw enoent("/projects/app");
        })
        .mockReturnValueOnce("/canonical/projects");
      expect(
        canonicalizePath("/projects/app/src/new-file.ts", posixPathFlavor),
      ).toBe("/canonical/projects/app/src/new-file.ts");
    });

    test("returns input unchanged when walk reaches filesystem root (all ENOENT)", () => {
      nativeRealpath.mockImplementation(() => {
        throw enoent("");
      });
      expect(
        canonicalizePath("/nonexistent/path/file.ts", posixPathFlavor),
      ).toBe("/nonexistent/path/file.ts");
    });

    test("returns input unchanged on ELOOP (symlink loop)", () => {
      nativeRealpath.mockImplementation(() => {
        throw Object.assign(new Error("ELOOP"), { code: "ELOOP" });
      });
      expect(canonicalizePath("/some/looping/path", posixPathFlavor)).toBe(
        "/some/looping/path",
      );
    });

    test("returns input unchanged on EACCES (permission denied)", () => {
      nativeRealpath.mockImplementation(() => {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      });
      expect(canonicalizePath("/restricted/path", posixPathFlavor)).toBe(
        "/restricted/path",
      );
    });

    test("handles ENOTDIR by walking up (like ENOENT)", () => {
      nativeRealpath
        .mockImplementationOnce(() => {
          throw Object.assign(new Error("ENOTDIR"), { code: "ENOTDIR" });
        })
        .mockReturnValueOnce("/real/parent");
      expect(canonicalizePath("/real/parent/not-a-dir", posixPathFlavor)).toBe(
        "/real/parent/not-a-dir",
      );
    });
  });

  describe("win32: resolves through the JS realpath", () => {
    test("splits and rejoins on the backslash separator", () => {
      realpathSync
        .mockImplementationOnce(() => {
          throw enoent("C:\\projects\\link\\file.ts");
        })
        .mockReturnValueOnce("C:\\real\\app");
      expect(
        canonicalizePath("C:\\projects\\link\\file.ts", win32PathFlavor),
      ).toBe("C:\\real\\app\\file.ts");
      expect(nativeRealpath).not.toHaveBeenCalled();
    });

    test("resolves an existing path via realpathSync", () => {
      realpathSync.mockReturnValueOnce("C:\\real\\app");
      expect(canonicalizePath("C:\\projects\\link", win32PathFlavor)).toBe(
        "C:\\real\\app",
      );
      expect(nativeRealpath).not.toHaveBeenCalled();
    });
  });
});
