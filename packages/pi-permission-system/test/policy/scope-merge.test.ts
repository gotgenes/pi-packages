import { describe, expect, it } from "vitest";
import type { MergedScopes } from "#src/policy/scope-merge";
import { mergeScopesWithOrigins } from "#src/policy/scope-merge";

describe("mergeScopesWithOrigins", () => {
  it("returns empty result for empty scopes array", () => {
    const result: MergedScopes = mergeScopesWithOrigins([]);
    expect(result.mergedPermission).toEqual({});
    expect(result.origins.size).toBe(0);
  });

  it("attributes a string surface value to the contributing scope via the '*' pattern", () => {
    const result = mergeScopesWithOrigins([
      ["global", { permission: { bash: "allow" } }],
    ]);
    expect(result.mergedPermission).toEqual({ bash: "allow" });
    expect(result.origins.get("bash")?.get("*")).toBe("global");
  });

  it("attributes each pattern of an object surface value to the contributing scope", () => {
    const result = mergeScopesWithOrigins([
      [
        "project",
        { permission: { bash: { "git *": "allow", "npm *": "deny" } } },
      ],
    ]);
    expect(result.mergedPermission).toEqual({
      bash: { "git *": "allow", "npm *": "deny" },
    });
    expect(result.origins.get("bash")?.get("git *")).toBe("project");
    expect(result.origins.get("bash")?.get("npm *")).toBe("project");
  });

  it(
    "shallow-merge: patterns not redefined by the higher scope keep their lower-scope origin;" +
      " patterns the higher scope defines switch to the higher scope",
    () => {
      const result = mergeScopesWithOrigins([
        [
          "global",
          { permission: { bash: { "ls *": "allow", "git *": "allow" } } },
        ],
        ["project", { permission: { bash: { "git *": "deny" } } }],
      ]);
      expect(result.mergedPermission).toEqual({
        bash: { "ls *": "allow", "git *": "deny" },
      });
      // "ls *" was not touched by project — retains global attribution
      expect(result.origins.get("bash")?.get("ls *")).toBe("global");
      // "git *" was overridden by project — switches to project attribution
      expect(result.origins.get("bash")?.get("git *")).toBe("project");
    },
  );

  it("full replacement (string over object): higher scope re-attributes the entire surface to its own origin", () => {
    const result = mergeScopesWithOrigins([
      ["global", { permission: { bash: { "ls *": "allow" } } }],
      ["project", { permission: { bash: "deny" } }],
    ]);
    expect(result.mergedPermission).toEqual({ bash: "deny" });
    // The string value produces a single "*" pattern for the replacing scope
    expect(result.origins.get("bash")?.get("*")).toBe("project");
    // The former "ls *" pattern from global is gone — origins are replaced, not merged
    expect(result.origins.get("bash")?.has("ls *")).toBe(false);
  });

  it("full replacement (object over string): higher scope re-attributes the entire surface to its own origin", () => {
    const result = mergeScopesWithOrigins([
      ["global", { permission: { bash: "ask" } }],
      ["project", { permission: { bash: { "git *": "deny" } } }],
    ]);
    expect(result.mergedPermission).toEqual({ bash: { "git *": "deny" } });
    // The object value attributes each pattern to the replacing scope
    expect(result.origins.get("bash")?.get("git *")).toBe("project");
    // The former "*" attribution from global is gone
    expect(result.origins.get("bash")?.has("*")).toBe(false);
  });

  it("applies four-scope precedence in lowest→highest order (global → project → agent → project-agent)", () => {
    const result = mergeScopesWithOrigins([
      ["global", { permission: { read: "ask" } }],
      ["project", { permission: { write: "deny" } }],
      ["agent", { permission: { bash: "deny" } }],
      ["project-agent", { permission: { mcp: "allow" } }],
    ]);
    expect(result.mergedPermission).toEqual({
      read: "ask",
      write: "deny",
      bash: "deny",
      mcp: "allow",
    });
    expect(result.origins.get("read")?.get("*")).toBe("global");
    expect(result.origins.get("write")?.get("*")).toBe("project");
    expect(result.origins.get("bash")?.get("*")).toBe("agent");
    expect(result.origins.get("mcp")?.get("*")).toBe("project-agent");
  });

  it("skips scopes with no permission key, contributing nothing to either map", () => {
    const result = mergeScopesWithOrigins([
      ["global", {}],
      ["project", { permission: { bash: "allow" } }],
    ]);
    expect(result.mergedPermission).toEqual({ bash: "allow" });
    expect(result.origins.get("bash")?.get("*")).toBe("project");
  });

  it("attributes the universal '*' surface like any other (downstream reads origins.get('*')?.get('*') for universalFallbackOrigin)", () => {
    const result = mergeScopesWithOrigins([
      ["global", { permission: { "*": "deny" } }],
      ["project", { permission: { "*": "allow" } }],
    ]);
    expect(result.mergedPermission).toEqual({ "*": "allow" });
    // Both scopes write a string — each is a full replacement; project wins last
    expect(result.origins.get("*")?.get("*")).toBe("project");
  });
});
