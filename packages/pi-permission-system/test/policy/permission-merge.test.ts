import { describe, expect, test } from "vitest";

import { mergeFlatPermissions } from "#src/policy/permission-merge";

describe("mergeFlatPermissions", () => {
  test("string replaces string", () => {
    const result = mergeFlatPermissions({ tools: "ask" }, { tools: "allow" });
    expect(result).toEqual({ tools: "allow" });
  });

  test("both objects → shallow-merge pattern maps", () => {
    const result = mergeFlatPermissions(
      { bash: { "rm *": "deny", "git *": "ask" } },
      { bash: { "rm *": "allow", "npm *": "allow" } },
    );
    expect(result).toEqual({
      bash: { "rm *": "allow", "git *": "ask", "npm *": "allow" },
    });
  });

  test("object replaces string", () => {
    const result = mergeFlatPermissions(
      { tools: "ask" },
      { tools: { Write: "deny" } },
    );
    expect(result).toEqual({ tools: { Write: "deny" } });
  });

  test("string replaces object", () => {
    const result = mergeFlatPermissions(
      { tools: { Write: "deny" } },
      { tools: "allow" },
    );
    expect(result).toEqual({ tools: "allow" });
  });

  test("empty override returns base unchanged", () => {
    const base = { tools: "ask" as const, bash: { "rm *": "deny" as const } };
    const result = mergeFlatPermissions(base, {});
    expect(result).toEqual(base);
  });

  test("empty base returns override", () => {
    const override = { tools: "allow" as const };
    const result = mergeFlatPermissions({}, override);
    expect(result).toEqual(override);
  });

  test("preserves keys only in base", () => {
    const result = mergeFlatPermissions(
      { tools: "ask", bash: "deny" },
      { tools: "allow" },
    );
    expect(result).toEqual({ tools: "allow", bash: "deny" });
  });

  test("adds keys only in override", () => {
    const result = mergeFlatPermissions({ tools: "ask" }, { bash: "allow" });
    expect(result).toEqual({ tools: "ask", bash: "allow" });
  });
});
