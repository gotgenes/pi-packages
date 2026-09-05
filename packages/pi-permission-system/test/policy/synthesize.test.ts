import { describe, expect, test } from "vitest";
import { posixPathFlavor } from "#src/path/path-flavor";
import type { RuleOrigin } from "#src/policy/rule";
import { evaluate } from "#src/policy/rule";
import {
  composeRuleset,
  synthesizeBaseline,
  synthesizeDefaults,
} from "#src/policy/synthesize";

// ── synthesizeDefaults ─────────────────────────────────────────────────────

describe("synthesizeDefaults", () => {
  test("emits a single universal catch-all rule with layer 'default' and origin 'builtin'", () => {
    const rules = synthesizeDefaults("ask");
    expect(rules).toHaveLength(1);
    expect(rules[0]).toEqual({
      surface: "*",
      pattern: "*",
      action: "ask",
      layer: "default",
      origin: "builtin",
    });
  });

  test("reflects the supplied PermissionState as the action", () => {
    expect(synthesizeDefaults("allow")[0].action).toBe("allow");
    expect(synthesizeDefaults("deny")[0].action).toBe("deny");
    expect(synthesizeDefaults("ask")[0].action).toBe("ask");
  });

  test("universal rule catches any surface via wildcardMatch", () => {
    const rules = synthesizeDefaults("ask");
    expect(evaluate("read", "*", rules, posixPathFlavor).action).toBe("ask");
    expect(evaluate("bash", "git status", rules, posixPathFlavor).action).toBe(
      "ask",
    );
    expect(
      evaluate("external_directory", "*", rules, posixPathFlavor).action,
    ).toBe("ask");
    expect(evaluate("future_surface", "*", rules, posixPathFlavor).action).toBe(
      "ask",
    );
  });

  test("universal rule has layer 'default'", () => {
    const rules = synthesizeDefaults("allow");
    expect(evaluate("read", "*", rules, posixPathFlavor).layer).toBe("default");
  });

  test("defaults to origin 'builtin' when no origin supplied", () => {
    const rules = synthesizeDefaults("ask");
    expect(rules[0].origin).toBe("builtin");
  });

  test("universal rule carries config scope origin when supplied", () => {
    const origin: RuleOrigin = "global";
    const rules = synthesizeDefaults("ask", origin);
    expect(rules[0].origin).toBe("global");
  });

  test("origin is preserved through evaluate()", () => {
    const rules = synthesizeDefaults("allow", "project");
    const result = evaluate("read", "*", rules, posixPathFlavor);
    expect(result.origin).toBe("project");
  });

  test("all RuleOrigin values are accepted", () => {
    const origins: RuleOrigin[] = [
      "global",
      "project",
      "agent",
      "project-agent",
      "builtin",
      "baseline",
      "session",
    ];
    for (const origin of origins) {
      const rules = synthesizeDefaults("ask", origin);
      expect(rules[0].origin).toBe(origin);
    }
  });
});

// ── synthesizeBaseline ─────────────────────────────────────────────────────

describe("synthesizeBaseline", () => {
  test("returns empty ruleset when config has no mcp allow rules", () => {
    const configRules = [
      {
        surface: "mcp",
        pattern: "*",
        action: "deny" as const,
        layer: "config" as const,
        origin: "global" as const,
      },
    ];
    expect(synthesizeBaseline(configRules)).toEqual([]);
  });

  test("returns empty ruleset for empty config rules", () => {
    expect(synthesizeBaseline([])).toEqual([]);
  });

  test("synthesizes 5 baseline rules when at least one mcp allow config rule exists", () => {
    const configRules = [
      {
        surface: "mcp",
        pattern: "exa:*",
        action: "allow" as const,
        layer: "config" as const,
        origin: "global" as const,
      },
    ];
    const rules = synthesizeBaseline(configRules);
    expect(rules).toHaveLength(5);
  });

  test("baseline rules all have layer 'baseline', action 'allow', and origin 'baseline'", () => {
    const configRules = [
      {
        surface: "mcp",
        pattern: "exa:*",
        action: "allow" as const,
        layer: "config" as const,
        origin: "global" as const,
      },
    ];
    const rules = synthesizeBaseline(configRules);
    for (const rule of rules) {
      expect(rule.layer).toBe("baseline");
      expect(rule.action).toBe("allow");
      expect(rule.surface).toBe("mcp");
      expect(rule.origin).toBe("baseline");
    }
  });

  test("baseline rules cover the 5 MCP metadata targets", () => {
    const configRules = [
      {
        surface: "mcp",
        pattern: "exa:*",
        action: "allow" as const,
        layer: "config" as const,
        origin: "global" as const,
      },
    ];
    const rules = synthesizeBaseline(configRules);
    const patterns = rules.map((r) => r.pattern);
    expect(patterns).toContain("mcp_status");
    expect(patterns).toContain("mcp_list");
    expect(patterns).toContain("mcp_search");
    expect(patterns).toContain("mcp_describe");
    expect(patterns).toContain("mcp_connect");
  });

  test("baseline is NOT synthesized when allow rule is on a non-mcp surface", () => {
    const configRules = [
      {
        surface: "bash",
        pattern: "git *",
        action: "allow" as const,
        layer: "config" as const,
        origin: "global" as const,
      },
    ];
    expect(synthesizeBaseline(configRules)).toEqual([]);
  });

  test("baseline auto-allows mcp_status when an mcp allow rule exists", () => {
    const configRules = [
      {
        surface: "mcp",
        pattern: "exa:*",
        action: "allow" as const,
        layer: "config" as const,
        origin: "global" as const,
      },
    ];
    const rules = synthesizeBaseline(configRules);
    const result = evaluate("mcp", "mcp_status", rules, posixPathFlavor);
    expect(result.action).toBe("allow");
    expect(result.layer).toBe("baseline");
    expect(result.origin).toBe("baseline");
  });
});

// ── composeRuleset ─────────────────────────────────────────────────────────

describe("composeRuleset", () => {
  test("returns concatenation of all layers in order", () => {
    const defaults = synthesizeDefaults("ask");
    const baseline = synthesizeBaseline([
      {
        surface: "mcp",
        pattern: "exa:*",
        action: "allow",
        layer: "config",
        origin: "global" as const,
      },
    ]);
    const config = [
      {
        surface: "bash",
        pattern: "rm -rf *",
        action: "deny" as const,
        origin: "global" as const,
      },
    ];
    const composed = composeRuleset(defaults, baseline, config);
    expect(composed.length).toBe(
      defaults.length + baseline.length + config.length,
    );
  });

  test("defaults come first (lowest priority), config comes last (highest priority)", () => {
    const defaults = synthesizeDefaults("ask");
    const config = [
      {
        surface: "bash",
        pattern: "*",
        action: "deny" as const,
        layer: "config" as const,
        origin: "global" as const,
      },
    ];
    const composed = composeRuleset(defaults, [], config);
    const result = evaluate("bash", "echo hello", composed, posixPathFlavor);
    expect(result.action).toBe("deny");
    expect(result.layer).toBe("config");
  });

  test("config beats default for matching patterns", () => {
    const defaults = synthesizeDefaults("ask");
    const config = [
      {
        surface: "read",
        pattern: "*",
        action: "allow" as const,
        layer: "config" as const,
        origin: "global" as const,
      },
    ];
    const composed = composeRuleset(defaults, [], config);
    const result = evaluate("read", "*", composed, posixPathFlavor);
    expect(result.action).toBe("allow");
    expect(result.layer).toBe("config");
  });

  test("baseline beats default but config beats baseline", () => {
    const defaults = synthesizeDefaults("ask");
    const baseline = [
      {
        surface: "mcp",
        pattern: "mcp_status",
        action: "allow" as const,
        layer: "baseline" as const,
        origin: "baseline" as const,
      },
    ];
    const config = [
      {
        surface: "mcp",
        pattern: "mcp_status",
        action: "deny" as const,
        layer: "config" as const,
        origin: "global" as const,
      },
    ];
    const composed = composeRuleset(defaults, baseline, config);
    const result = evaluate("mcp", "mcp_status", composed, posixPathFlavor);
    expect(result.action).toBe("deny");
    expect(result.layer).toBe("config");
  });

  test("config beats baseline for specific patterns", () => {
    const defaults = synthesizeDefaults("ask");
    const baseline = [
      {
        surface: "mcp",
        pattern: "mcp_status",
        action: "allow" as const,
        layer: "baseline" as const,
        origin: "baseline" as const,
      },
    ];
    const config = [
      {
        surface: "mcp",
        pattern: "exa_web_search",
        action: "allow" as const,
        layer: "config" as const,
        origin: "global" as const,
      },
    ];
    const composed = composeRuleset(defaults, baseline, config);
    const result = evaluate("mcp", "exa_web_search", composed, posixPathFlavor);
    expect(result.action).toBe("allow");
    expect(result.layer).toBe("config");
  });

  test("handles empty layers gracefully", () => {
    const defaults = synthesizeDefaults("ask");
    const composed = composeRuleset(defaults, [], []);
    expect(composed).toEqual(defaults);
  });
});
