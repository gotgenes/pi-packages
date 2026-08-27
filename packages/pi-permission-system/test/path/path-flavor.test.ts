import { posix as posixPath, win32 as winPath } from "node:path";

import { describe, expect, it } from "vitest";

import {
  pathFlavorForPlatform,
  posixPathFlavor,
  win32PathFlavor,
} from "#src/path/path-flavor";

describe("win32PathFlavor", () => {
  it("exposes the win32 path implementation", () => {
    expect(win32PathFlavor.impl).toBe(winPath);
  });

  it("carries the win32 case/separator match options", () => {
    expect(win32PathFlavor.matchOptions).toEqual({
      caseInsensitive: true,
      windowsSeparators: true,
    });
  });

  it("folds to lower case", () => {
    expect(win32PathFlavor.fold("C:\\Foo\\Bar")).toBe("c:\\foo\\bar");
  });

  it("resolves, normalizes, and folds a comparable value against a base", () => {
    expect(win32PathFlavor.comparable("Foo/Bar", "C:\\base")).toBe(
      "c:\\base\\foo\\bar",
    );
  });

  it("decides containment with win32 (case-folding) geometry", () => {
    expect(win32PathFlavor.isWithin("C:\\base\\sub", "C:\\base")).toBe(true);
    expect(win32PathFlavor.isWithin("C:\\base", "C:\\base")).toBe(true);
    expect(win32PathFlavor.isWithin("C:\\other", "C:\\base")).toBe(false);
  });

  it("folds case for a case-different descendant", () => {
    expect(
      win32PathFlavor.isWithin(
        "c:\\users\\foo\\dir\\sub\\x.md",
        "C:\\Users\\Foo\\dir",
      ),
    ).toBe(true);
  });

  it("folds case when path equals directory in a different case", () => {
    expect(
      win32PathFlavor.isWithin(
        "c:\\users\\foo\\dir\\sub",
        "C:\\USERS\\foo\\DIR",
      ),
    ).toBe(true);
  });

  it("rejects a win32 sibling directory", () => {
    expect(
      win32PathFlavor.isWithin("C:\\Users\\Foo\\other", "C:\\Users\\Foo\\dir"),
    ).toBe(false);
  });

  it("recognizes either separator as a path separator", () => {
    expect(win32PathFlavor.hasPathSeparator("dir/file")).toBe(true);
    expect(win32PathFlavor.hasPathSeparator("dir\\file")).toBe(true);
    expect(win32PathFlavor.hasPathSeparator("plain")).toBe(false);
  });

  it("locates the last separator of either spelling", () => {
    expect(win32PathFlavor.lastSeparatorIndex("C:\\a\\b")).toBe(4);
    expect(win32PathFlavor.lastSeparatorIndex("/a/b")).toBe(2);
    expect(win32PathFlavor.lastSeparatorIndex("C:\\a/b")).toBe(4);
    expect(win32PathFlavor.lastSeparatorIndex("dir\\file")).toBe(3);
    expect(win32PathFlavor.lastSeparatorIndex("/")).toBe(0);
    expect(win32PathFlavor.lastSeparatorIndex("plain")).toBe(-1);
    expect(win32PathFlavor.lastSeparatorIndex("")).toBe(-1);
  });

  it("answers hasPathSeparator consistently with lastSeparatorIndex", () => {
    for (const token of ["dir/file", "dir\\file", "plain", "", "/"]) {
      expect(win32PathFlavor.hasPathSeparator(token)).toBe(
        win32PathFlavor.lastSeparatorIndex(token) >= 0,
      );
    }
  });

  it("classifies bash tokens with MSYS semantics", () => {
    expect(win32PathFlavor.bashTokenShape("/dev/null")).toEqual({
      kind: "device",
    });
    expect(win32PathFlavor.bashTokenShape("/c/Users/x")).toEqual({
      kind: "drive-mount",
      windowsPath: "C:\\Users\\x",
    });
    expect(win32PathFlavor.bashTokenShape("/tmp/x")).toEqual({
      kind: "posix-absolute",
    });
    expect(win32PathFlavor.bashTokenShape("relative/x")).toEqual({
      kind: "plain",
    });
  });
});

describe("posixPathFlavor", () => {
  it("exposes the posix path implementation", () => {
    expect(posixPathFlavor.impl).toBe(posixPath);
  });

  it("carries no win32 match options", () => {
    expect(posixPathFlavor.matchOptions).toBeUndefined();
  });

  it("does not fold case", () => {
    expect(posixPathFlavor.fold("/Foo/Bar")).toBe("/Foo/Bar");
  });

  it("resolves and normalizes a comparable value without folding", () => {
    expect(posixPathFlavor.comparable("Foo/Bar", "/base")).toBe(
      "/base/Foo/Bar",
    );
  });

  it("decides containment with posix geometry", () => {
    expect(posixPathFlavor.isWithin("/base/sub", "/base")).toBe(true);
    expect(posixPathFlavor.isWithin("/base", "/base")).toBe(true);
    expect(posixPathFlavor.isWithin("/a/b/c/d/e", "/a/b")).toBe(true);
    expect(posixPathFlavor.isWithin("/other", "/base")).toBe(false);
  });

  it("rejects a sibling directory sharing a name prefix", () => {
    expect(posixPathFlavor.isWithin("/a/bc", "/a/b")).toBe(false);
  });

  it("stays case-sensitive", () => {
    expect(posixPathFlavor.isWithin("/a/B/c", "/a/b")).toBe(false);
  });

  it("returns false for empty operands", () => {
    expect(posixPathFlavor.isWithin("", "/a/b")).toBe(false);
    expect(posixPathFlavor.isWithin("/a/b", "")).toBe(false);
  });

  it("recognizes only the forward slash as a path separator", () => {
    expect(posixPathFlavor.hasPathSeparator("dir/file")).toBe(true);
    expect(posixPathFlavor.hasPathSeparator("dir\\file")).toBe(false);
    expect(posixPathFlavor.hasPathSeparator("plain")).toBe(false);
  });

  it("locates the last forward slash only", () => {
    expect(posixPathFlavor.lastSeparatorIndex("/a/b")).toBe(2);
    expect(posixPathFlavor.lastSeparatorIndex("dir\\file")).toBe(-1);
    expect(posixPathFlavor.lastSeparatorIndex("/")).toBe(0);
    expect(posixPathFlavor.lastSeparatorIndex("plain")).toBe(-1);
    expect(posixPathFlavor.lastSeparatorIndex("")).toBe(-1);
  });

  it("answers hasPathSeparator consistently with lastSeparatorIndex", () => {
    for (const token of ["dir/file", "dir\\file", "plain", "", "/"]) {
      expect(posixPathFlavor.hasPathSeparator(token)).toBe(
        posixPathFlavor.lastSeparatorIndex(token) >= 0,
      );
    }
  });

  it("treats every bash token as an ordinary path", () => {
    expect(posixPathFlavor.bashTokenShape("/dev/null")).toEqual({
      kind: "plain",
    });
    expect(posixPathFlavor.bashTokenShape("/c/Users/x")).toEqual({
      kind: "plain",
    });
    expect(posixPathFlavor.bashTokenShape("/tmp/x")).toEqual({ kind: "plain" });
  });
});

describe("pathFlavorForPlatform", () => {
  it("selects the win32 flavor for win32", () => {
    expect(pathFlavorForPlatform("win32")).toBe(win32PathFlavor);
  });

  it("selects the posix flavor for every other platform", () => {
    expect(pathFlavorForPlatform("linux")).toBe(posixPathFlavor);
    expect(pathFlavorForPlatform("darwin")).toBe(posixPathFlavor);
  });
});
