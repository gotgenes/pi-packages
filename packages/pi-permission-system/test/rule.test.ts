import { describe, expect, test } from "vitest";
import type { Rule, RuleOrigin, Ruleset } from "#src/rule";
import {
  evaluate,
  evaluateAnyValue,
  evaluateFirst,
  evaluateMostRestrictive,
} from "#src/rule";

describe("evaluate", () => {
  const allowBashGit: Rule = {
    surface: "bash",
    pattern: "git *",
    action: "allow",
    origin: "global",
  };
  const denyBashGitPush: Rule = {
    surface: "bash",
    pattern: "git push *",
    action: "deny",
    origin: "global",
  };
  const allowRead: Rule = {
    surface: "read",
    pattern: "*",
    action: "allow",
    origin: "global",
  };
  const askMcp: Rule = {
    surface: "mcp",
    pattern: "*",
    action: "ask",
    origin: "global",
  };
  const allowSkillLibrarian: Rule = {
    surface: "skill",
    pattern: "librarian",
    action: "allow",
    origin: "global",
  };
  const askSpecialExtDir: Rule = {
    surface: "special",
    pattern: "external_directory",
    action: "ask",
    origin: "global",
  };

  test("returns matching rule when a rule matches", () => {
    const ruleset: Ruleset = [allowBashGit];
    const result = evaluate("bash", "git status", ruleset);
    expect(result).toEqual(allowBashGit);
  });

  test("returns synthetic rule with 'ask' when no rules match and no defaultAction", () => {
    const result = evaluate("bash", "npm install", [allowBashGit]);
    expect(result.surface).toBe("bash");
    expect(result.pattern).toBe("npm install");
    expect(result.action).toBe("ask");
  });

  test("returns synthetic rule with custom defaultAction when no rules match", () => {
    const result = evaluate("bash", "npm install", [allowBashGit], "deny");
    expect(result.surface).toBe("bash");
    expect(result.pattern).toBe("npm install");
    expect(result.action).toBe("deny");
  });

  test("defaultAction does not affect matched rules", () => {
    const result = evaluate("bash", "git status", [allowBashGit], "deny");
    expect(result).toEqual(allowBashGit);
  });

  test("returns synthetic rule for empty ruleset", () => {
    const result = evaluate("mcp", "exa_search", []);
    expect(result.surface).toBe("mcp");
    expect(result.pattern).toBe("exa_search");
    expect(result.action).toBe("ask");
  });

  test("matches rules for all permission surfaces", () => {
    expect(evaluate("read", "src/foo.ts", [allowRead]).action).toBe("allow");
    expect(evaluate("mcp", "exa_search", [askMcp]).action).toBe("ask");
    expect(evaluate("skill", "librarian", [allowSkillLibrarian]).action).toBe(
      "allow",
    );
    expect(
      evaluate("special", "external_directory", [askSpecialExtDir]).action,
    ).toBe("ask");
  });

  test("last-match-wins: later conflicting rule overrides earlier", () => {
    const ruleset: Ruleset = [allowBashGit, denyBashGitPush];
    const result = evaluate("bash", "git push origin main", ruleset);
    expect(result).toEqual(denyBashGitPush);
  });

  test("last-match-wins: broad deny followed by specific allow", () => {
    const denyAll: Rule = {
      surface: "bash",
      pattern: "*",
      action: "deny",
      origin: "global",
    };
    const allowStatus: Rule = {
      surface: "bash",
      pattern: "git status",
      action: "allow",
      origin: "global",
    };
    const result = evaluate("bash", "git status", [denyAll, allowStatus]);
    expect(result).toEqual(allowStatus);
  });

  test("wildcard surface in rule matches any surface value", () => {
    const universalAllow: Rule = {
      surface: "*",
      pattern: "*",
      action: "allow",
      origin: "global",
    };
    expect(evaluate("bash", "anything", [universalAllow]).action).toBe("allow");
    expect(evaluate("mcp", "something", [universalAllow]).action).toBe("allow");
    expect(evaluate("skill", "librarian", [universalAllow]).action).toBe(
      "allow",
    );
  });

  test("specific surface rule does not match a different surface", () => {
    const ruleset: Ruleset = [allowBashGit];
    // bash rule should not match mcp surface
    const result = evaluate("mcp", "git status", ruleset);
    expect(result.action).toBe("ask"); // falls back to default
  });

  test("merged rulesets: rules from later scope take priority", () => {
    const globalRules: Ruleset = [
      { surface: "bash", pattern: "git *", action: "ask", origin: "global" },
    ];
    const agentRules: Ruleset = [
      { surface: "bash", pattern: "git *", action: "allow", origin: "agent" },
    ];
    const merged = [...globalRules, ...agentRules];
    const result = evaluate("bash", "git status", merged);
    expect(result.action).toBe("allow"); // agent rule wins
  });

  test("merged rulesets: earlier scope used when later scope has no match", () => {
    const globalRules: Ruleset = [
      { surface: "bash", pattern: "git *", action: "allow", origin: "global" },
    ];
    const agentRules: Ruleset = [
      { surface: "bash", pattern: "npm *", action: "deny", origin: "agent" },
    ];
    // git status matches global but not agent rule
    const merged = [...globalRules, ...agentRules];
    const result = evaluate("bash", "git status", merged);
    expect(result.action).toBe("allow"); // global rule is the last match for this pattern
  });

  test("empty ruleset returns synthetic default", () => {
    const result = evaluate("bash", "git status", []);
    expect(result.surface).toBe("bash");
    expect(result.pattern).toBe("git status");
    expect(result.action).toBe("ask");
  });

  test("rule.layer is ignored by evaluate() — matching is identical with or without it", () => {
    const withLayer: Rule = {
      surface: "bash",
      pattern: "git *",
      action: "allow",
      layer: "config",
      origin: "global",
    };
    const withoutLayer: Rule = {
      surface: "bash",
      pattern: "git *",
      action: "allow",
      origin: "global",
    };
    const withDefault: Rule = {
      surface: "bash",
      pattern: "*",
      action: "ask",
      layer: "default",
      origin: "builtin",
    };
    // Both rules with and without layer field produce the same match.
    expect(evaluate("bash", "git status", [withLayer]).action).toBe("allow");
    expect(evaluate("bash", "git status", [withoutLayer]).action).toBe("allow");
    // Layer metadata does not affect last-match-wins ordering.
    const ruleset: Rule[] = [withDefault, withLayer];
    expect(evaluate("bash", "git status", ruleset)).toEqual(withLayer);
    // A rule with layer: "default" still wins if it is last in the array.
    const reversedRuleset: Rule[] = [withLayer, withDefault];
    expect(evaluate("bash", "git status", reversedRuleset)).toEqual(
      withDefault,
    );
  });

  test("evaluate() preserves origin on a matched rule", () => {
    const origin: RuleOrigin = "project";
    const rule: Rule = {
      surface: "bash",
      pattern: "git *",
      action: "allow",
      layer: "config",
      origin,
    };
    const result = evaluate("bash", "git status", [rule]);
    expect(result.origin).toBe("project");
  });

  test("evaluate() propagates reason from the matched rule", () => {
    const rule: Rule = {
      surface: "bash",
      pattern: "npm *",
      action: "deny",
      reason: "Use pnpm instead",
      layer: "config",
      origin: "global",
    };
    const result = evaluate("bash", "npm install", [rule]);
    expect(result.action).toBe("deny");
    expect(result.reason).toBe("Use pnpm instead");
  });

  test("evaluate() carries reason through last-match-wins", () => {
    const denyNpm: Rule = {
      surface: "bash",
      pattern: "npm *",
      action: "deny",
      reason: "Use pnpm",
      layer: "config",
      origin: "global",
    };
    const allowNpmInstall: Rule = {
      surface: "bash",
      pattern: "npm install",
      action: "allow",
      layer: "config",
      origin: "global",
    };
    // Last rule matches and its action is "allow" → no reason expected.
    const result = evaluate("bash", "npm install", [denyNpm, allowNpmInstall]);
    expect(result.action).toBe("allow");
    expect(result.reason).toBeUndefined();
  });

  test("evaluate() preserves reason when last-match-wins picks a deny with reason", () => {
    const allowAll: Rule = {
      surface: "bash",
      pattern: "*",
      action: "allow",
      layer: "config",
      origin: "global",
    };
    const denyNpm: Rule = {
      surface: "bash",
      pattern: "npm *",
      action: "deny",
      reason: "Use pnpm",
      layer: "config",
      origin: "global",
    };
    const result = evaluate("bash", "npm install", [allowAll, denyNpm]);
    expect(result.action).toBe("deny");
    expect(result.reason).toBe("Use pnpm");
  });

  test("evaluate() synthetic fallback rule has no reason", () => {
    const result = evaluate("bash", "npm install", []);
    expect(result.reason).toBeUndefined();
  });

  test("evaluate() synthetic fallback rule has origin 'builtin'", () => {
    const result = evaluate("bash", "npm install", []);
    expect(result.origin).toBe("builtin");
  });

  test("RuleOrigin covers all seven provenance values", () => {
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
      const rule: Rule = {
        surface: "read",
        pattern: "*",
        action: "allow",
        layer: "config",
        origin,
      };
      expect(evaluate("read", "*", [rule]).origin).toBe(origin);
    }
  });

  // ── Windows: path-surface patterns fold case (last-match-wins) ──────────

  const denyExternalAll: Rule = {
    surface: "external_directory",
    pattern: "*",
    action: "deny",
    layer: "config",
    origin: "global",
  };
  const allowExternalPi: Rule = {
    surface: "external_directory",
    pattern: "C:\\Users\\Foo\\pi\\*",
    action: "allow",
    layer: "config",
    origin: "global",
  };

  test("win32: external_directory allow override matches a lowercased path over a preceding deny", () => {
    const result = evaluate(
      "external_directory",
      "c:\\users\\foo\\pi\\docs\\readme.md",
      [denyExternalAll, allowExternalPi],
      undefined,
      "win32",
    );
    expect(result.action).toBe("allow");
  });

  test("posix: the same mixed-case override stays case-sensitive (falls through to deny)", () => {
    const result = evaluate(
      "external_directory",
      "c:\\users\\foo\\pi\\docs\\readme.md",
      [denyExternalAll, allowExternalPi],
      undefined,
      "linux",
    );
    expect(result.action).toBe("deny");
  });

  test("win32: a forward-slash external_directory pattern matches a backslash value", () => {
    const allowForwardSlash: Rule = {
      surface: "external_directory",
      pattern: "C:/Users/Foo/pi/*",
      action: "allow",
      layer: "config",
      origin: "global",
    };
    const result = evaluate(
      "external_directory",
      "c:\\users\\foo\\pi\\docs\\readme.md",
      [denyExternalAll, allowForwardSlash],
      undefined,
      "win32",
    );
    expect(result.action).toBe("allow");
  });

  test("win32: bash surface stays case-sensitive (not a path surface)", () => {
    const result = evaluate(
      "bash",
      "GIT push",
      [
        {
          surface: "bash",
          pattern: "git *",
          action: "allow",
          origin: "global",
        },
      ],
      undefined,
      "win32",
    );
    expect(result.action).toBe("ask");
  });
});

describe("evaluateFirst", () => {
  const defaultRule: Rule = {
    surface: "*",
    pattern: "*",
    action: "ask",
    layer: "default",
    origin: "builtin",
  };
  const allowBash: Rule = {
    surface: "bash",
    pattern: "git *",
    action: "allow",
    layer: "config",
    origin: "global",
  };
  const denyMcp: Rule = {
    surface: "mcp",
    pattern: "exa_search",
    action: "deny",
    layer: "config",
    origin: "global",
  };

  test("returns the first candidate that matches a non-default rule", () => {
    const rules: Ruleset = [defaultRule, allowBash];
    const result = evaluateFirst("bash", ["git status", "*"], rules);
    expect(result.rule).toEqual(allowBash);
    expect(result.value).toBe("git status");
  });

  test("skips candidates that only match the default rule", () => {
    // "npm install" matches only the default; "*" also matches only the
    // default — falls back to first candidate.
    const rules: Ruleset = [defaultRule];
    const result = evaluateFirst("bash", ["npm install", "*"], rules);
    expect(result.rule.layer).toBe("default");
    expect(result.value).toBe("npm install");
  });

  test("falls back to first candidate when all candidates match only the default", () => {
    const rules: Ruleset = [defaultRule];
    const result = evaluateFirst("bash", ["a", "b", "c"], rules);
    expect(result.value).toBe("a");
  });

  test("stops at first non-default match, does not continue to remaining candidates", () => {
    // "exa_search" matches denyMcp (non-default). The loop stops there;
    // "mcp" is never evaluated even though it would match a different rule.
    const allowMcpCatchAll: Rule = {
      surface: "mcp",
      pattern: "mcp",
      action: "allow",
      layer: "config",
      origin: "global",
    };
    const rules: Ruleset = [defaultRule, denyMcp, allowMcpCatchAll];
    const result = evaluateFirst("mcp", ["exa_search", "mcp"], rules);
    expect(result.rule).toEqual(denyMcp);
    expect(result.value).toBe("exa_search");
  });

  test("skips candidates that match only the default and continues to next", () => {
    // "unknown_tool" matches only the universal default;
    // "exa_search" matches denyMcp (non-default) — that is the result.
    const rules: Ruleset = [defaultRule, denyMcp];
    const result = evaluateFirst("mcp", ["unknown_tool", "exa_search"], rules);
    expect(result.rule).toEqual(denyMcp);
    expect(result.value).toBe("exa_search");
  });

  test("single-candidate array behaves like evaluate()", () => {
    const rules: Ruleset = [defaultRule, allowBash];
    const result = evaluateFirst("bash", ["git status"], rules);
    expect(result.rule).toEqual(allowBash);
    expect(result.value).toBe("git status");
  });

  test("uses '*' as fallback value when values array is empty", () => {
    const rules: Ruleset = [defaultRule];
    const result = evaluateFirst("bash", [], rules);
    expect(result.value).toBe("*");
  });
});

describe("evaluateAnyValue", () => {
  const catchAllAllow: Rule = {
    surface: "path",
    pattern: "*",
    action: "allow",
    layer: "config",
    origin: "global",
  };
  const catchAllAsk: Rule = {
    surface: "path",
    pattern: "*",
    action: "ask",
    layer: "config",
    origin: "global",
  };
  const relativeDeny: Rule = {
    surface: "path",
    pattern: "src/*",
    action: "deny",
    layer: "config",
    origin: "global",
  };
  const absoluteAllow: Rule = {
    surface: "path",
    pattern: "/proj/*",
    action: "allow",
    layer: "config",
    origin: "global",
  };

  test("a later relative rule wins over a catch-all matched by another alias", () => {
    const rules: Ruleset = [catchAllAllow, relativeDeny];
    const result = evaluateAnyValue(
      "path",
      ["/proj/src/foo.ts", "src/foo.ts"],
      rules,
    );
    expect(result.rule).toEqual(relativeDeny);
    expect(result.value).toBe("src/foo.ts");
  });

  test("uses an absolute alias when no later relative rule matches", () => {
    const rules: Ruleset = [catchAllAsk, absoluteAllow];
    const result = evaluateAnyValue(
      "path",
      ["/proj/src/foo.ts", "src/foo.ts"],
      rules,
    );
    expect(result.rule).toEqual(absoluteAllow);
    expect(result.value).toBe("/proj/src/foo.ts");
  });

  test("falls back to the first value's default when no rule matches", () => {
    const result = evaluateAnyValue(
      "path",
      ["/proj/src/foo.ts", "src/foo.ts"],
      [],
    );
    expect(result.rule.action).toBe("ask");
    expect(result.value).toBe("/proj/src/foo.ts");
  });

  test("uses '*' as fallback value when values array is empty", () => {
    const result = evaluateAnyValue("path", [], []);
    expect(result.value).toBe("*");
  });
});

describe("evaluateMostRestrictive", () => {
  const denyEnv: Rule = {
    surface: "path",
    pattern: "*.env",
    action: "deny",
    layer: "config",
    origin: "global",
  };
  const askSsh: Rule = {
    surface: "path",
    pattern: "/home/user/.ssh/*",
    action: "ask",
    layer: "config",
    origin: "global",
  };
  const allowAll: Rule = {
    surface: "path",
    pattern: "*",
    action: "allow",
    layer: "config",
    origin: "global",
  };

  test("deny short-circuits: returns immediately without evaluating remaining values", () => {
    const rules: Ruleset = [allowAll, denyEnv];
    const result = evaluateMostRestrictive(
      "path",
      [".env", "README.md"],
      rules,
    );
    expect(result).not.toBeNull();
    expect(result!.rule.action).toBe("deny");
    expect(result!.value).toBe(".env");
  });

  test("ask accumulates: returns first ask when no deny found", () => {
    const rules: Ruleset = [allowAll, askSsh];
    const result = evaluateMostRestrictive(
      "path",
      ["/home/user/.ssh/id_rsa", "README.md"],
      rules,
    );
    expect(result).not.toBeNull();
    expect(result!.rule.action).toBe("ask");
    expect(result!.value).toBe("/home/user/.ssh/id_rsa");
  });

  test("all allow: returns null", () => {
    const rules: Ruleset = [allowAll];
    const result = evaluateMostRestrictive(
      "path",
      ["README.md", "src/index.ts"],
      rules,
    );
    expect(result).toBeNull();
  });

  test("empty values: returns null", () => {
    const rules: Ruleset = [allowAll, denyEnv];
    const result = evaluateMostRestrictive("path", [], rules);
    expect(result).toBeNull();
  });

  test("deny wins over ask", () => {
    const rules: Ruleset = [allowAll, askSsh, denyEnv];
    const result = evaluateMostRestrictive(
      "path",
      ["/home/user/.ssh/id_rsa", ".env"],
      rules,
    );
    expect(result).not.toBeNull();
    expect(result!.rule.action).toBe("deny");
    expect(result!.value).toBe(".env");
  });
});
