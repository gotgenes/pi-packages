import { describe, expect, test } from "vitest";

import { classifyWin32BashToken } from "#src/access-intent/bash/msys-bash-tokens";

describe("classifyWin32BashToken", () => {
  describe("device paths", () => {
    test.each(["/dev/null", "/dev/stdin", "/dev/stdout", "/dev/stderr"])(
      "%s is a device",
      (token) => {
        expect(classifyWin32BashToken(token)).toEqual({ kind: "device" });
      },
    );
  });

  describe("MSYS drive mounts", () => {
    test("translates /c/Users/x to C:\\Users\\x", () => {
      expect(classifyWin32BashToken("/c/Users/x")).toEqual({
        kind: "drive-mount",
        windowsPath: "C:\\Users\\x",
      });
    });

    test("uppercases the drive letter", () => {
      expect(classifyWin32BashToken("/d/secrets/pw.txt")).toEqual({
        kind: "drive-mount",
        windowsPath: "D:\\secrets\\pw.txt",
      });
    });

    test("accepts an already-uppercase mount letter", () => {
      expect(classifyWin32BashToken("/C/x")).toEqual({
        kind: "drive-mount",
        windowsPath: "C:\\x",
      });
    });

    test("bare /c translates to the drive root C:\\", () => {
      expect(classifyWin32BashToken("/c")).toEqual({
        kind: "drive-mount",
        windowsPath: "C:\\",
      });
    });

    test("trailing-slash /c/ translates to the drive root C:\\", () => {
      expect(classifyWin32BashToken("/c/")).toEqual({
        kind: "drive-mount",
        windowsPath: "C:\\",
      });
    });
  });

  describe("other POSIX absolutes", () => {
    test.each(["/tmp/foo", "/usr/bin", "/etc/hosts", "/mingw64/bin"])(
      "%s is a posix-absolute",
      (token) => {
        expect(classifyWin32BashToken(token)).toEqual({
          kind: "posix-absolute",
        });
      },
    );

    test("a two-letter first segment is not a drive mount", () => {
      expect(classifyWin32BashToken("/cc/x")).toEqual({
        kind: "posix-absolute",
      });
    });
  });

  describe("plain tokens", () => {
    test.each(["src/foo.ts", "foo.ts", "C:\\Users\\x", "C:/Users/x", "../up"])(
      "%s is plain",
      (token) => {
        expect(classifyWin32BashToken(token)).toEqual({ kind: "plain" });
      },
    );
  });
});
