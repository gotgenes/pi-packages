import { describe, expect, it } from "vitest";

import { createPermissionRequestId } from "#src/permission-request-id";

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
