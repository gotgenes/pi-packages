import { describe, expect, test } from "vitest";

import {
  isSafeSystemPath,
  SAFE_SYSTEM_PATHS,
} from "#src/path/safe-system-paths";

describe("SAFE_SYSTEM_PATHS", () => {
  test("contains /dev/null, /dev/stdin, /dev/stdout, /dev/stderr", () => {
    expect(SAFE_SYSTEM_PATHS.has("/dev/null")).toBe(true);
    expect(SAFE_SYSTEM_PATHS.has("/dev/stdin")).toBe(true);
    expect(SAFE_SYSTEM_PATHS.has("/dev/stdout")).toBe(true);
    expect(SAFE_SYSTEM_PATHS.has("/dev/stderr")).toBe(true);
  });
});

describe("isSafeSystemPath", () => {
  test("returns true for /dev/null", () => {
    expect(isSafeSystemPath("/dev/null")).toBe(true);
  });

  test("returns true for /dev/stdin", () => {
    expect(isSafeSystemPath("/dev/stdin")).toBe(true);
  });

  test("returns true for /dev/stdout", () => {
    expect(isSafeSystemPath("/dev/stdout")).toBe(true);
  });

  test("returns true for /dev/stderr", () => {
    expect(isSafeSystemPath("/dev/stderr")).toBe(true);
  });

  test("returns false for an arbitrary absolute path", () => {
    expect(isSafeSystemPath("/etc/passwd")).toBe(false);
  });

  test("returns false for a path prefixed with a safe system path", () => {
    expect(isSafeSystemPath("/dev/null/subdir")).toBe(false);
  });

  test("returns false for an empty string", () => {
    expect(isSafeSystemPath("")).toBe(false);
  });

  test("returns false for a relative path", () => {
    expect(isSafeSystemPath("dev/null")).toBe(false);
  });
});
