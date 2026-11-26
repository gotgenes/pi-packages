import { describe, expect, it } from "vitest";
import { composeScopes } from "#src/policy/scope-composition";

describe("composeScopes", () => {
  describe("rule placement", () => {
    it("composes nothing from no scopes", () => {
      expect(composeScopes([]).rules).toEqual([]);
    });

    it("places a later scope's catch-all after an earlier scope's specific pattern", () => {
      const { rules } = composeScopes([
        {
          name: "global",
          config: { permission: { bash: { "*": "ask", "git *": "allow" } } },
        },
        { name: "agent", config: { permission: { bash: { "*": "deny" } } } },
      ]);
      expect(rules).toEqual([
        {
          surface: "bash",
          pattern: "git *",
          action: "allow",
          layer: "config",
          origin: "global",
        },
        {
          surface: "bash",
          pattern: "*",
          action: "deny",
          layer: "config",
          origin: "agent",
        },
      ]);
    });

    it("moves a pattern a later scope redefines to the later scope's position", () => {
      const { rules } = composeScopes([
        {
          name: "global",
          config: { permission: { bash: { "git *": "ask", "ls *": "allow" } } },
        },
        {
          name: "project",
          config: { permission: { bash: { "git *": "allow" } } },
        },
      ]);
      expect(rules).toEqual([
        {
          surface: "bash",
          pattern: "ls *",
          action: "allow",
          layer: "config",
          origin: "global",
        },
        {
          surface: "bash",
          pattern: "git *",
          action: "allow",
          layer: "config",
          origin: "project",
        },
      ]);
    });

    it("keeps an earlier scope's string catch-all ahead of a later scope's pattern map", () => {
      const { rules } = composeScopes([
        { name: "global", config: { permission: { bash: "allow" } } },
        {
          name: "project",
          config: { permission: { bash: { "rm *": "deny" } } },
        },
      ]);
      expect(rules).toEqual([
        {
          surface: "bash",
          pattern: "*",
          action: "allow",
          layer: "config",
          origin: "global",
        },
        {
          surface: "bash",
          pattern: "rm *",
          action: "deny",
          layer: "config",
          origin: "project",
        },
      ]);
    });

    it("places a later scope's string catch-all after an earlier scope's pattern map", () => {
      const { rules } = composeScopes([
        {
          name: "global",
          config: { permission: { bash: { "git *": "allow" } } },
        },
        { name: "project", config: { permission: { bash: "deny" } } },
      ]);
      expect(rules).toEqual([
        {
          surface: "bash",
          pattern: "git *",
          action: "allow",
          layer: "config",
          origin: "global",
        },
        {
          surface: "bash",
          pattern: "*",
          action: "deny",
          layer: "config",
          origin: "project",
        },
      ]);
    });

    it("places the scopes in the order given, each rule stamped with its scope", () => {
      const { rules } = composeScopes([
        { name: "global", config: { permission: { read: "ask" } } },
        { name: "project", config: { permission: { write: "deny" } } },
        { name: "agent", config: { permission: { bash: "deny" } } },
        { name: "project-agent", config: { permission: { mcp: "allow" } } },
      ]);
      expect(rules.map((rule) => [rule.surface, rule.origin])).toEqual([
        ["read", "global"],
        ["write", "project"],
        ["bash", "agent"],
        ["mcp", "project-agent"],
      ]);
    });

    it("skips a scope with no permission key", () => {
      const { rules } = composeScopes([
        { name: "global", config: {} },
        { name: "project", config: { permission: { bash: "allow" } } },
      ]);
      expect(rules).toEqual([
        {
          surface: "bash",
          pattern: "*",
          action: "allow",
          layer: "config",
          origin: "project",
        },
      ]);
    });

    it("expands directional sugar per scope, attributed to the authoring scope", () => {
      const { rules } = composeScopes([
        { name: "global", config: { permission: { bash: "ask" } } },
        { name: "project", config: { permission: { path: { "*": "ask" } } } },
      ]);
      expect(rules).toEqual([
        {
          surface: "bash",
          pattern: "*",
          action: "ask",
          layer: "config",
          origin: "global",
        },
        {
          surface: "path_read",
          pattern: "*",
          action: "ask",
          layer: "config",
          origin: "project",
        },
        {
          surface: "path_write",
          pattern: "*",
          action: "ask",
          layer: "config",
          origin: "project",
        },
      ]);
    });
  });

  describe("relocated Pi MCP tool keys", () => {
    it("relocates a top-level key within its own scope, ahead of a later scope's mcp rules", () => {
      const { rules } = composeScopes([
        {
          name: "global",
          config: { permission: { mcp__srv__tool: "allow" } },
        },
        { name: "agent", config: { permission: { mcp: { "*": "deny" } } } },
      ]);
      expect(rules).toEqual([
        {
          surface: "mcp__srv__tool",
          pattern: "*",
          action: "allow",
          layer: "config",
          origin: "global",
        },
        {
          surface: "mcp",
          pattern: "mcp__srv__tool",
          action: "allow",
          layer: "config",
          origin: "global",
        },
        {
          surface: "mcp",
          pattern: "*",
          action: "deny",
          layer: "config",
          origin: "agent",
        },
      ]);
    });

    it("composes the rules as written separately, so a relocated copy never drops a written rule from them", () => {
      const composed = composeScopes([
        {
          name: "global",
          config: { permission: { mcp: { mcp__srv__x: "allow" } } },
        },
        { name: "agent", config: { permission: { mcp__srv__x: "deny" } } },
      ]);
      expect(composed.rules).toEqual([
        {
          surface: "mcp__srv__x",
          pattern: "*",
          action: "deny",
          layer: "config",
          origin: "agent",
        },
        {
          surface: "mcp",
          pattern: "mcp__srv__x",
          action: "deny",
          layer: "config",
          origin: "agent",
        },
      ]);
      expect(composed.writtenRules).toEqual([
        {
          surface: "mcp",
          pattern: "mcp__srv__x",
          action: "allow",
          layer: "config",
          origin: "global",
        },
        {
          surface: "mcp__srv__x",
          pattern: "*",
          action: "deny",
          layer: "config",
          origin: "agent",
        },
      ]);
    });

    it("lists each relocated key in scope order", () => {
      const composed = composeScopes([
        { name: "global", config: { permission: { mcp__a__x: "deny" } } },
        { name: "project", config: { permission: { mcp__b__y: "deny" } } },
      ]);
      expect(composed.relocatedMcpToolKeys).toEqual(["mcp__a__x", "mcp__b__y"]);
    });
  });

  describe("universal fallback", () => {
    it("is absent when no scope sets the universal key", () => {
      const composed = composeScopes([
        { name: "global", config: { permission: { bash: "ask" } } },
      ]);
      expect(composed.universalFallback).toBeUndefined();
    });

    it("is decided by the last scope that sets it, and is not a rule", () => {
      const composed = composeScopes([
        {
          name: "global",
          config: { permission: { "*": "ask", bash: "allow" } },
        },
        { name: "project", config: { permission: { "*": "deny" } } },
        { name: "agent", config: { permission: { read: "allow" } } },
      ]);
      expect(composed.universalFallback).toEqual({
        action: "deny",
        origin: "project",
      });
      expect(composed.rules.map((rule) => rule.surface)).toEqual([
        "bash",
        "read",
      ]);
    });

    it("falls back to ask, attributed to the scope, when that scope's value is not an action", () => {
      const composed = composeScopes([
        { name: "global", config: { permission: { "*": "allow" } } },
        { name: "agent", config: { permission: { "*": { "*": "deny" } } } },
      ]);
      expect(composed.universalFallback).toEqual({
        action: "ask",
        origin: "agent",
      });
    });
  });
});
