import { describe, expect, it } from "vitest";

import {
  createPermissionRequestId,
  isFilenameSafeRequestId,
} from "#src/permission-request-id";

describe("createPermissionRequestId", () => {
  it("prefixes the id so it is distinguishable from an SDK tool call id", () => {
    expect(createPermissionRequestId()).toMatch(
      /^perm-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("mints a distinct id on every call", () => {
    const ids = new Set(
      Array.from({ length: 100 }, () => createPermissionRequestId()),
    );
    expect(ids.size).toBe(100);
  });
});

describe("isFilenameSafeRequestId", () => {
  describe("accepts", () => {
    it("every id this package mints", () => {
      expect(isFilenameSafeRequestId(createPermissionRequestId())).toBe(true);
    });

    it("the timestamp-random-pid id an older escalator minted", () => {
      expect(isFilenameSafeRequestId("1723750000000-k3j5h2a9-4242")).toBe(true);
    });

    it("an id at the length bound", () => {
      expect(isFilenameSafeRequestId("a".repeat(128))).toBe(true);
    });
  });

  describe("rejects", () => {
    it.each([
      ["the empty string", ""],
      ["a parent-directory traversal", "../../escape"],
      ["a POSIX separator", "a/b"],
      ["a Windows separator", "a\\b"],
      ["the current-directory segment", "."],
      ["the parent-directory segment", ".."],
      ["a dot anywhere", "req.1"],
      ["a space", "req 1"],
      ["an id past the length bound", "a".repeat(129)],
    ])("%s", (_, id) => {
      expect(isFilenameSafeRequestId(id)).toBe(false);
    });
  });
});
