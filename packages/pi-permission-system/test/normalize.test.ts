import { describe, expect, test } from "vitest";
import { expandDirectionalSugar, normalizeFlatConfig } from "#src/normalize";

describe("normalizeFlatConfig", () => {
  describe("string shorthand", () => {
    test("string value produces a single catch-all rule for the surface", () => {
      const result = normalizeFlatConfig({ read: "allow" });
      expect(result).toEqual([
        { surface: "read", pattern: "*", action: "allow", origin: "builtin" },
      ]);
    });

    test("string shorthand works for multiple surfaces", () => {
      const result = normalizeFlatConfig({ read: "allow", write: "deny" });
      expect(result).toEqual([
        { surface: "read", pattern: "*", action: "allow", origin: "builtin" },
        { surface: "write", pattern: "*", action: "deny", origin: "builtin" },
      ]);
    });

    test("universal fallback '*' becomes a catch-all rule with surface '*'", () => {
      const result = normalizeFlatConfig({ "*": "ask" });
      expect(result).toEqual([
        { surface: "*", pattern: "*", action: "ask", origin: "builtin" },
      ]);
    });

    test("external_directory string shorthand maps directly to its surface", () => {
      const result = normalizeFlatConfig({ external_directory: "ask" });
      expect(result).toEqual([
        {
          surface: "external_directory",
          pattern: "*",
          action: "ask",
          origin: "builtin",
        },
      ]);
    });

    test("invalid string values (non-PermissionState) are ignored", () => {
      const result = normalizeFlatConfig({
        read: "allow",
        write: "invalid" as never,
      });
      expect(result).toEqual([
        { surface: "read", pattern: "*", action: "allow", origin: "builtin" },
      ]);
    });
  });

  describe("object pattern map", () => {
    test("object value produces one rule per pattern", () => {
      const result = normalizeFlatConfig({
        bash: { "*": "ask", "git *": "allow" },
      });
      expect(result).toEqual([
        { surface: "bash", pattern: "*", action: "ask", origin: "builtin" },
        {
          surface: "bash",
          pattern: "git *",
          action: "allow",
          origin: "builtin",
        },
      ]);
    });

    test("mcp object map produces rules with surface 'mcp'", () => {
      const result = normalizeFlatConfig({
        mcp: { "*": "ask", mcp_status: "allow" },
      });
      expect(result).toEqual([
        { surface: "mcp", pattern: "*", action: "ask", origin: "builtin" },
        {
          surface: "mcp",
          pattern: "mcp_status",
          action: "allow",
          origin: "builtin",
        },
      ]);
    });

    test("skill object map produces rules with surface 'skill'", () => {
      const result = normalizeFlatConfig({
        skill: { "*": "ask", librarian: "allow" },
      });
      expect(result).toEqual([
        { surface: "skill", pattern: "*", action: "ask", origin: "builtin" },
        {
          surface: "skill",
          pattern: "librarian",
          action: "allow",
          origin: "builtin",
        },
      ]);
    });

    test("invalid action values in object map are ignored", () => {
      const result = normalizeFlatConfig({
        bash: { "git *": "allow", "rm -rf *": "bad" as never },
      });
      expect(result).toEqual([
        {
          surface: "bash",
          pattern: "git *",
          action: "allow",
          origin: "builtin",
        },
      ]);
    });
  });

  describe("mixed surfaces", () => {
    test("full mixed config produces rules in insertion order", () => {
      const result = normalizeFlatConfig({
        "*": "ask",
        read: "allow",
        write: "deny",
        bash: { "*": "ask", "git *": "allow" },
        mcp: { mcp_status: "allow" },
        skill: { "*": "ask" },
        external_directory: "ask",
      });
      expect(result).toEqual([
        { surface: "*", pattern: "*", action: "ask", origin: "builtin" },
        { surface: "read", pattern: "*", action: "allow", origin: "builtin" },
        { surface: "write", pattern: "*", action: "deny", origin: "builtin" },
        { surface: "bash", pattern: "*", action: "ask", origin: "builtin" },
        {
          surface: "bash",
          pattern: "git *",
          action: "allow",
          origin: "builtin",
        },
        {
          surface: "mcp",
          pattern: "mcp_status",
          action: "allow",
          origin: "builtin",
        },
        { surface: "skill", pattern: "*", action: "ask", origin: "builtin" },
        {
          surface: "external_directory",
          pattern: "*",
          action: "ask",
          origin: "builtin",
        },
      ]);
    });
  });

  describe("empty and edge cases", () => {
    test("empty permission object produces empty ruleset", () => {
      expect(normalizeFlatConfig({})).toEqual([]);
    });

    test("non-object values (null, array) nested in map are skipped", () => {
      const result = normalizeFlatConfig({
        bash: null as never,
        read: "allow",
      });
      expect(result).toEqual([
        { surface: "read", pattern: "*", action: "allow", origin: "builtin" },
      ]);
    });
  });

  describe("deny with reason", () => {
    test("{ action: 'deny', reason } produces a deny rule carrying the reason", () => {
      const result = normalizeFlatConfig({
        bash: { "npm *": { action: "deny", reason: "Use pnpm instead" } },
      });
      expect(result).toEqual([
        {
          surface: "bash",
          pattern: "npm *",
          action: "deny",
          reason: "Use pnpm instead",
          origin: "builtin",
        },
      ]);
    });

    test("{ action: 'deny' } without a reason produces a deny rule without reason", () => {
      const result = normalizeFlatConfig({
        bash: { "rm -rf *": { action: "deny" } },
      });
      expect(result).toEqual([
        {
          surface: "bash",
          pattern: "rm -rf *",
          action: "deny",
          origin: "builtin",
        },
      ]);
    });

    test("deny-with-reason and plain strings coexist in the same surface", () => {
      const result = normalizeFlatConfig({
        bash: {
          "git *": "allow",
          "npm *": { action: "deny", reason: "Use pnpm" },
          "*": "ask",
        },
      });
      expect(result).toEqual([
        {
          surface: "bash",
          pattern: "git *",
          action: "allow",
          origin: "builtin",
        },
        {
          surface: "bash",
          pattern: "npm *",
          action: "deny",
          reason: "Use pnpm",
          origin: "builtin",
        },
        { surface: "bash", pattern: "*", action: "ask", origin: "builtin" },
      ]);
    });

    test("top-level deny-with-reason object is treated as a pattern map", () => {
      // At the surface level, { action: "deny", reason: "..." } is parsed as a
      // pattern→action map: "action" is a pattern key with action "deny", and
      // "reason" maps to a non-PermissionState string that is dropped.
      const result = normalizeFlatConfig({
        bash: { action: "deny", reason: "Not allowed" } as never,
      });
      expect(result).toEqual([
        {
          surface: "bash",
          pattern: "action",
          action: "deny",
          origin: "builtin",
        },
      ]);
    });

    test("non-string reason is rejected (malformed config)", () => {
      const result = normalizeFlatConfig({
        bash: { "npm *": { action: "deny", reason: 42 } as never },
      });
      expect(result).toEqual([]);
    });
  });
});

describe("expandDirectionalSugar", () => {
  test("expands a bare path key into both directional keys", () => {
    expect(
      expandDirectionalSugar({
        path: { "*": "ask", "~/.ssh/*": "deny" },
      }),
    ).toEqual({
      path_read: { "*": "ask", "~/.ssh/*": "deny" },
      path_write: { "*": "ask", "~/.ssh/*": "deny" },
    });
  });

  test("expands a bare external_directory key the same way", () => {
    expect(expandDirectionalSugar({ external_directory: "ask" })).toEqual({
      external_directory_read: "ask",
      external_directory_write: "ask",
    });
  });

  test("leaves the bare surfaces empty — no rule survives on them", () => {
    const expanded = expandDirectionalSugar({ path: "deny" });
    expect(Object.hasOwn(expanded, "path")).toBe(false);
  });

  test("passes a non-family surface through untouched", () => {
    const written = { read: "allow", bash: { "git *": "ask" } } as const;
    expect(expandDirectionalSugar(written)).toEqual(written);
  });

  test("passes an explicit directional key through when no sugar key is present", () => {
    expect(
      expandDirectionalSugar({ path_read: { "~/dev/**": "allow" } }),
    ).toEqual({ path_read: { "~/dev/**": "allow" } });
  });

  describe("intra-surface merge order (ADR 0013 §4)", () => {
    test("appends explicit directional entries after the sugar-derived ones", () => {
      expect(
        expandDirectionalSugar({
          path: { "*": "ask", "~/.ssh/*": "deny" },
          path_read: { "~/dev/**": "allow" },
        }),
      ).toEqual({
        path_read: {
          "*": "ask",
          "~/.ssh/*": "deny",
          "~/dev/**": "allow",
        },
        path_write: { "*": "ask", "~/.ssh/*": "deny" },
      });
    });

    test("means the same thing when the two keys are written in the other order", () => {
      const sugarFirst = expandDirectionalSugar({
        external_directory: { "*": "ask" },
        external_directory_read: { "~/dev/**": "allow" },
      });
      const directionalFirst = expandDirectionalSugar({
        external_directory_read: { "~/dev/**": "allow" },
        external_directory: { "*": "ask" },
      });
      expect(Object.entries(sugarFirst)).toEqual(
        Object.entries(directionalFirst),
      );
      expect(sugarFirst).toEqual({
        external_directory_read: { "*": "ask", "~/dev/**": "allow" },
        external_directory_write: { "*": "ask" },
      });
    });

    test("moves a pattern the explicit entry redefines to the end", () => {
      expect(
        expandDirectionalSugar({
          path: { "*": "ask", "~/.ssh/*": "deny" },
          path_read: { "*": "allow" },
        }),
      ).toEqual({
        path_read: { "~/.ssh/*": "deny", "*": "allow" },
        path_write: { "*": "ask", "~/.ssh/*": "deny" },
      });
      expect(
        Object.keys(
          expandDirectionalSugar({
            path: { "*": "ask", "~/.ssh/*": "deny" },
            path_read: { "*": "allow" },
          }).path_read as Record<string, unknown>,
        ),
      ).toEqual(["~/.ssh/*", "*"]);
    });

    test("normalizes a string sugar value to a catch-all when merging", () => {
      expect(
        expandDirectionalSugar({
          path: "ask",
          path_write: { "~/scratch/**": "allow" },
        }),
      ).toEqual({
        path_read: "ask",
        path_write: { "*": "ask", "~/scratch/**": "allow" },
      });
    });
  });

  test("does not share a pattern map between the two directional keys", () => {
    const expanded = expandDirectionalSugar({ path: { "*": "ask" } });
    const read = expanded.path_read as Record<string, unknown>;
    read.injected = "allow";
    expect(expanded.path_write).toEqual({ "*": "ask" });
  });
});
