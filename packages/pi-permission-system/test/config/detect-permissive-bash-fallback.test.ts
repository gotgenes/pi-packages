import { describe, expect, it } from "vitest";

import { detectPermissiveBashFallback } from "#src/config/config-loader";
import type { FlatPermissionConfig } from "#src/types";

describe("detectPermissiveBashFallback", () => {
  it("warns when top-level '*' is allow and bash is absent", () => {
    const permission: FlatPermissionConfig = { "*": "allow" };

    const issue = detectPermissiveBashFallback(permission);

    expect(issue).toBeDefined();
    expect(issue).toContain("bash");
    expect(issue).toContain("allow");
  });

  it("warns when top-level '*' is allow and bash map has no '*' key", () => {
    const permission: FlatPermissionConfig = {
      "*": "allow",
      bash: { "git *": "ask" },
    };

    expect(detectPermissiveBashFallback(permission)).toBeDefined();
  });

  it("does not warn when bash is a bare string surface", () => {
    const permission: FlatPermissionConfig = { "*": "allow", bash: "ask" };

    expect(detectPermissiveBashFallback(permission)).toBeUndefined();
  });

  it("does not warn when bash map has an explicit '*' key", () => {
    const permission: FlatPermissionConfig = {
      "*": "allow",
      bash: { "*": "ask", "git *": "allow" },
    };

    expect(detectPermissiveBashFallback(permission)).toBeUndefined();
  });

  it("does not warn when top-level '*' is not allow", () => {
    const permission: FlatPermissionConfig = { "*": "ask" };

    expect(detectPermissiveBashFallback(permission)).toBeUndefined();
  });

  it("does not warn when top-level '*' is absent", () => {
    const permission: FlatPermissionConfig = { bash: { "git *": "ask" } };

    expect(detectPermissiveBashFallback(permission)).toBeUndefined();
  });

  it("does not warn when permission is undefined", () => {
    expect(detectPermissiveBashFallback(undefined)).toBeUndefined();
  });
});
