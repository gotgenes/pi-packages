import { describe, expect, test, vi } from "vitest";

// Mock node:fs so the discriminator test can assert realpathSync is untouched.
const realpathSync = vi.hoisted(() => {
  const fn = vi.fn<(path: string) => string>((p) => p);
  // `native` is the same spy, so the POSIX canonicalizer is controlled too.
  return Object.assign(fn, { native: fn });
});
vi.mock("node:fs", () => ({
  realpathSync,
  default: { realpathSync },
}));

import { isPathOutsideWorkingDirectory } from "#src/path/path-containment";
import { posixPathFlavor } from "#src/path/path-flavor";

describe("isPathOutsideWorkingDirectory", () => {
  // Pure geometry over already-canonical operands: the caller (PathNormalizer)
  // prepares the canonical path and cwd; this predicate never canonicalizes.
  const canonicalCwd = "/projects/my-app";

  test("does not canonicalize its operands (no filesystem access)", () => {
    realpathSync.mockClear();
    isPathOutsideWorkingDirectory(
      "/projects/my-app/src",
      canonicalCwd,
      posixPathFlavor,
    );
    expect(realpathSync).not.toHaveBeenCalled();
  });

  test("returns false when path is inside cwd", () => {
    expect(
      isPathOutsideWorkingDirectory(
        "/projects/my-app/src",
        canonicalCwd,
        posixPathFlavor,
      ),
    ).toBe(false);
  });

  test("returns false when path equals cwd", () => {
    expect(
      isPathOutsideWorkingDirectory(
        "/projects/my-app",
        canonicalCwd,
        posixPathFlavor,
      ),
    ).toBe(false);
  });

  test("returns true when path is outside cwd", () => {
    expect(
      isPathOutsideWorkingDirectory(
        "/etc/passwd",
        canonicalCwd,
        posixPathFlavor,
      ),
    ).toBe(true);
  });

  test("returns false for an empty canonical path", () => {
    expect(
      isPathOutsideWorkingDirectory("", canonicalCwd, posixPathFlavor),
    ).toBe(false);
  });

  test("returns false for an empty canonical cwd", () => {
    expect(
      isPathOutsideWorkingDirectory("/etc/passwd", "", posixPathFlavor),
    ).toBe(false);
  });

  test("returns false for /dev/null (safe system path)", () => {
    expect(
      isPathOutsideWorkingDirectory("/dev/null", canonicalCwd, posixPathFlavor),
    ).toBe(false);
  });

  test("returns false for /dev/stdin (safe system path)", () => {
    expect(
      isPathOutsideWorkingDirectory(
        "/dev/stdin",
        canonicalCwd,
        posixPathFlavor,
      ),
    ).toBe(false);
  });

  test("returns false for /dev/stdout (safe system path)", () => {
    expect(
      isPathOutsideWorkingDirectory(
        "/dev/stdout",
        canonicalCwd,
        posixPathFlavor,
      ),
    ).toBe(false);
  });

  test("returns false for /dev/stderr (safe system path)", () => {
    expect(
      isPathOutsideWorkingDirectory(
        "/dev/stderr",
        canonicalCwd,
        posixPathFlavor,
      ),
    ).toBe(false);
  });

  test("returns true for /dev/null/subdir (not a safe path)", () => {
    expect(
      isPathOutsideWorkingDirectory(
        "/dev/null/subdir",
        canonicalCwd,
        posixPathFlavor,
      ),
    ).toBe(true);
  });
});
