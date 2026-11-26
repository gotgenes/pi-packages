import { describe, expect, it } from "vitest";

import { forwardedPermissionRequestSchema } from "#src/authority/forwarded-request-schema";
import { createPermissionRequestId } from "#src/permission-request-id";

function requestWithId(id: string): Record<string, unknown> {
  return {
    id,
    createdAt: 1000,
    requesterSessionId: "child-session",
    targetSessionId: "parent-session",
    requesterAgentName: "researcher",
  };
}

describe("forwardedPermissionRequestSchema", () => {
  describe("request id", () => {
    it("accepts an id this package mints", () => {
      const id = createPermissionRequestId();
      const parsed = forwardedPermissionRequestSchema.safeParse(
        requestWithId(id),
      );
      expect(parsed.success && parsed.data.id).toBe(id);
    });

    it.each([
      ["a parent-directory traversal", "../../escape-test"],
      ["an absolute path", "/tmp/escape-test"],
      ["an id past the length bound", "a".repeat(129)],
    ])("rejects %s, naming the id as the problem", (_, id) => {
      const parsed = forwardedPermissionRequestSchema.safeParse(
        requestWithId(id),
      );
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.path)).toEqual([["id"]]);
    });
  });

  describe("creation time", () => {
    // JSON `1e400` parses to Infinity. No requester writes one (they stamp
    // `Date.now()`), and Zod's `z.number()` refuses a non-finite number, so
    // such a request is dropped rather than served.
    it("rejects a non-finite creation time", () => {
      const parsed = forwardedPermissionRequestSchema.safeParse({
        ...requestWithId("req-1"),
        createdAt: Number.POSITIVE_INFINITY,
      });
      expect(parsed.success).toBe(false);
    });
  });
});
