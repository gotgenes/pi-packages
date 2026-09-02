import { describe, expect, test } from "vitest";
import { posixPathFlavor, win32PathFlavor } from "#src/path/path-flavor";
import type { Rule, RuleOrigin, Ruleset } from "#src/rule";
import {
  evaluate,
  evaluateAnyValue,
  evaluateFirst,
  evaluateMostRestrictive,
  floorAllowsToAsk,
  isSurfaceFullyDenied,
  rewriteAsksToYolo,
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
    const result = evaluate("bash", "git status", ruleset, posixPathFlavor);
    expect(result).toEqual(allowBashGit);
  });

  test("returns synthetic rule with 'ask' when no rules match and no defaultAction", () => {
    const result = evaluate(
      "bash",
      "npm install",
      [allowBashGit],
      posixPathFlavor,
    );
    expect(result.surface).toBe("bash");
    expect(result.pattern).toBe("npm install");
    expect(result.action).toBe("ask");
  });

  test("returns synthetic rule with custom defaultAction when no rules match", () => {
    const result = evaluate(
      "bash",
      "npm install",
      [allowBashGit],
      posixPathFlavor,
      "deny",
    );
    expect(result.surface).toBe("bash");
    expect(result.pattern).toBe("npm install");
    expect(result.action).toBe("deny");
  });

  test("defaultAction does not affect matched rules", () => {
    const result = evaluate(
      "bash",
      "git status",
      [allowBashGit],
      posixPathFlavor,
      "deny",
    );
    expect(result).toEqual(allowBashGit);
  });

  test("returns synthetic rule for empty ruleset", () => {
    const result = evaluate("mcp", "exa_search", [], posixPathFlavor);
    expect(result.surface).toBe("mcp");
    expect(result.pattern).toBe("exa_search");
    expect(result.action).toBe("ask");
  });

  test("matches rules for all permission surfaces", () => {
    expect(
      evaluate("read", "src/foo.ts", [allowRead], posixPathFlavor).action,
    ).toBe("allow");
    expect(
      evaluate("mcp", "exa_search", [askMcp], posixPathFlavor).action,
    ).toBe("ask");
    expect(
      evaluate("skill", "librarian", [allowSkillLibrarian], posixPathFlavor)
        .action,
    ).toBe("allow");
    expect(
      evaluate(
        "special",
        "external_directory",
        [askSpecialExtDir],
        posixPathFlavor,
      ).action,
    ).toBe("ask");
  });

  test("last-match-wins: later conflicting rule overrides earlier", () => {
    const ruleset: Ruleset = [allowBashGit, denyBashGitPush];
    const result = evaluate(
      "bash",
      "git push origin main",
      ruleset,
      posixPathFlavor,
    );
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
    const result = evaluate(
      "bash",
      "git status",
      [denyAll, allowStatus],
      posixPathFlavor,
    );
    expect(result).toEqual(allowStatus);
  });

  test("wildcard surface in rule matches any surface value", () => {
    const universalAllow: Rule = {
      surface: "*",
      pattern: "*",
      action: "allow",
      origin: "global",
    };
    expect(
      evaluate("bash", "anything", [universalAllow], posixPathFlavor).action,
    ).toBe("allow");
    expect(
      evaluate("mcp", "something", [universalAllow], posixPathFlavor).action,
    ).toBe("allow");
    expect(
      evaluate("skill", "librarian", [universalAllow], posixPathFlavor).action,
    ).toBe("allow");
  });

  test("specific surface rule does not match a different surface", () => {
    const ruleset: Ruleset = [allowBashGit];
    // bash rule should not match mcp surface
    const result = evaluate("mcp", "git status", ruleset, posixPathFlavor);
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
    const result = evaluate("bash", "git status", merged, posixPathFlavor);
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
    const result = evaluate("bash", "git status", merged, posixPathFlavor);
    expect(result.action).toBe("allow"); // global rule is the last match for this pattern
  });

  test("empty ruleset returns synthetic default", () => {
    const result = evaluate("bash", "git status", [], posixPathFlavor);
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
    expect(
      evaluate("bash", "git status", [withLayer], posixPathFlavor).action,
    ).toBe("allow");
    expect(
      evaluate("bash", "git status", [withoutLayer], posixPathFlavor).action,
    ).toBe("allow");
    // Layer metadata does not affect last-match-wins ordering.
    const ruleset: Rule[] = [withDefault, withLayer];
    expect(evaluate("bash", "git status", ruleset, posixPathFlavor)).toEqual(
      withLayer,
    );
    // A rule with layer: "default" still wins if it is last in the array.
    const reversedRuleset: Rule[] = [withLayer, withDefault];
    expect(
      evaluate("bash", "git status", reversedRuleset, posixPathFlavor),
    ).toEqual(withDefault);
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
    const result = evaluate("bash", "git status", [rule], posixPathFlavor);
    expect(result.origin).toBe("project");
  });

  test("evaluate() synthetic fallback rule has origin 'builtin'", () => {
    const result = evaluate("bash", "npm install", [], posixPathFlavor);
    expect(result.origin).toBe("builtin");
  });

  test("evaluate() propagates reason from the matched deny rule", () => {
    const rule: Rule = {
      surface: "bash",
      pattern: "npm *",
      action: "deny",
      reason: "Use pnpm instead",
      layer: "config",
      origin: "global",
    };
    const result = evaluate("bash", "npm install", [rule], posixPathFlavor);
    expect(result.action).toBe("deny");
    expect(result.reason).toBe("Use pnpm instead");
  });

  test("evaluate() carries reason through last-match-wins when deny wins", () => {
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
    const result = evaluate(
      "bash",
      "npm install",
      [allowAll, denyNpm],
      posixPathFlavor,
    );
    expect(result.action).toBe("deny");
    expect(result.reason).toBe("Use pnpm");
  });

  test("evaluate() drops reason when a later allow overrides the deny", () => {
    const denyNpm: Rule = {
      surface: "bash",
      pattern: "npm *",
      action: "deny",
      reason: "Use pnpm",
      layer: "config",
      origin: "global",
    };
    const allowInstall: Rule = {
      surface: "bash",
      pattern: "npm install",
      action: "allow",
      layer: "config",
      origin: "global",
    };
    const result = evaluate(
      "bash",
      "npm install",
      [denyNpm, allowInstall],
      posixPathFlavor,
    );
    expect(result.action).toBe("allow");
    expect(result.reason).toBeUndefined();
  });

  test("evaluate() synthetic fallback rule has no reason", () => {
    const result = evaluate("bash", "npm install", [], posixPathFlavor);
    expect(result.reason).toBeUndefined();
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
      expect(evaluate("read", "*", [rule], posixPathFlavor).origin).toBe(
        origin,
      );
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
      win32PathFlavor,
    );
    expect(result.action).toBe("allow");
  });

  test("posix: the same mixed-case override stays case-sensitive (falls through to deny)", () => {
    const result = evaluate(
      "external_directory",
      "c:\\users\\foo\\pi\\docs\\readme.md",
      [denyExternalAll, allowExternalPi],
      posixPathFlavor,
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
      win32PathFlavor,
    );
    expect(result.action).toBe("allow");
  });

  test("win32: a forward-slash path pattern matches a forward-slash value (#653)", () => {
    // A Git Bash device token reaches the `path` surface spelled as typed, so
    // the fold has to normalize the value as well as the rule pattern.
    const askAll: Rule = {
      surface: "path",
      pattern: "*",
      action: "ask",
      layer: "config",
      origin: "global",
    };
    const allowDevice: Rule = {
      surface: "path",
      pattern: "/dev/null",
      action: "allow",
      layer: "config",
      origin: "global",
    };
    const result = evaluate(
      "path",
      "/dev/null",
      [askAll, allowDevice],
      win32PathFlavor,
    );
    expect(result.action).toBe("allow");
  });

  test("win32: bash surface keeps its separators unfolded (not a path surface)", () => {
    const result = evaluate(
      "bash",
      "cat \\tmp\\x",
      [
        {
          surface: "bash",
          pattern: "cat /tmp/x",
          action: "allow",
          origin: "global",
        },
      ],
      win32PathFlavor,
    );
    expect(result.action).toBe("ask");
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
      win32PathFlavor,
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
    const result = evaluateFirst(
      "bash",
      ["git status", "*"],
      rules,
      posixPathFlavor,
    );
    expect(result.rule).toEqual(allowBash);
    expect(result.value).toBe("git status");
  });

  test("skips candidates that only match the default rule", () => {
    // "npm install" matches only the default; "*" also matches only the
    // default — falls back to first candidate.
    const rules: Ruleset = [defaultRule];
    const result = evaluateFirst(
      "bash",
      ["npm install", "*"],
      rules,
      posixPathFlavor,
    );
    expect(result.rule.layer).toBe("default");
    expect(result.value).toBe("npm install");
  });

  test("falls back to first candidate when all candidates match only the default", () => {
    const rules: Ruleset = [defaultRule];
    const result = evaluateFirst(
      "bash",
      ["a", "b", "c"],
      rules,
      posixPathFlavor,
    );
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
    const result = evaluateFirst(
      "mcp",
      ["exa_search", "mcp"],
      rules,
      posixPathFlavor,
    );
    expect(result.rule).toEqual(denyMcp);
    expect(result.value).toBe("exa_search");
  });

  test("skips candidates that match only the default and continues to next", () => {
    // "unknown_tool" matches only the universal default;
    // "exa_search" matches denyMcp (non-default) — that is the result.
    const rules: Ruleset = [defaultRule, denyMcp];
    const result = evaluateFirst(
      "mcp",
      ["unknown_tool", "exa_search"],
      rules,
      posixPathFlavor,
    );
    expect(result.rule).toEqual(denyMcp);
    expect(result.value).toBe("exa_search");
  });

  test("single-candidate array behaves like evaluate()", () => {
    const rules: Ruleset = [defaultRule, allowBash];
    const result = evaluateFirst(
      "bash",
      ["git status"],
      rules,
      posixPathFlavor,
    );
    expect(result.rule).toEqual(allowBash);
    expect(result.value).toBe("git status");
  });

  test("uses '*' as fallback value when values array is empty", () => {
    const rules: Ruleset = [defaultRule];
    const result = evaluateFirst("bash", [], rules, posixPathFlavor);
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
      posixPathFlavor,
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
      posixPathFlavor,
    );
    expect(result.rule).toEqual(absoluteAllow);
    expect(result.value).toBe("/proj/src/foo.ts");
  });

  test("falls back to the first value's default when no rule matches", () => {
    const result = evaluateAnyValue(
      "path",
      ["/proj/src/foo.ts", "src/foo.ts"],
      [],
      posixPathFlavor,
    );
    expect(result.rule.action).toBe("ask");
    expect(result.value).toBe("/proj/src/foo.ts");
  });

  test("uses '*' as fallback value when values array is empty", () => {
    const result = evaluateAnyValue("path", [], [], posixPathFlavor);
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
      posixPathFlavor,
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
      posixPathFlavor,
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
      posixPathFlavor,
    );
    expect(result).toBeNull();
  });

  test("empty values: returns null", () => {
    const rules: Ruleset = [allowAll, denyEnv];
    const result = evaluateMostRestrictive("path", [], rules, posixPathFlavor);
    expect(result).toBeNull();
  });

  test("deny wins over ask", () => {
    const rules: Ruleset = [allowAll, askSsh, denyEnv];
    const result = evaluateMostRestrictive(
      "path",
      ["/home/user/.ssh/id_rsa", ".env"],
      rules,
      posixPathFlavor,
    );
    expect(result).not.toBeNull();
    expect(result!.rule.action).toBe("deny");
    expect(result!.value).toBe(".env");
  });
});

// Shared Rule fixtures for the composition-stage overlay blocks
// (rewriteAsksToYolo and floorAllowsToAsk), which mirror each other.
const overlayAskBash: Rule = {
  surface: "bash",
  pattern: "*",
  action: "ask",
  layer: "config",
  origin: "global",
};
const overlayDenyEnv: Rule = {
  surface: "path",
  pattern: ".env",
  action: "deny",
  layer: "config",
  origin: "project",
};
const overlayAllowRead: Rule = {
  surface: "read",
  pattern: "*",
  action: "allow",
  layer: "config",
  origin: "agent",
};
const overlayAskDefault: Rule = {
  surface: "*",
  pattern: "*",
  action: "ask",
  layer: "default",
  origin: "builtin",
};

describe("rewriteAsksToYolo", () => {
  test("rewrites an ask rule to allow tagged origin 'yolo'", () => {
    const result = rewriteAsksToYolo([overlayAskBash]);
    expect(result).toEqual([
      {
        surface: "bash",
        pattern: "*",
        action: "allow",
        layer: "config",
        origin: "yolo",
      },
    ]);
  });

  test("preserves surface, pattern, and layer while flipping ask", () => {
    const [rewritten] = rewriteAsksToYolo([overlayAskBash]);
    expect(rewritten.surface).toBe("bash");
    expect(rewritten.pattern).toBe("*");
    expect(rewritten.layer).toBe("config");
    expect(rewritten.action).toBe("allow");
    expect(rewritten.origin).toBe("yolo");
  });

  test("rewrites the synthesized universal default ask rule", () => {
    const result = rewriteAsksToYolo([overlayAskDefault]);
    expect(result[0]?.action).toBe("allow");
    expect(result[0]?.origin).toBe("yolo");
    expect(result[0]?.layer).toBe("default");
  });

  test("passes deny rules through untouched (preserves hard denies)", () => {
    const result = rewriteAsksToYolo([overlayDenyEnv]);
    expect(result).toEqual([overlayDenyEnv]);
  });

  test("passes allow rules through untouched", () => {
    const result = rewriteAsksToYolo([overlayAllowRead]);
    expect(result).toEqual([overlayAllowRead]);
  });

  test("rewrites only ask rules in a mixed ruleset, preserving order", () => {
    const ruleset: Ruleset = [
      overlayAskDefault,
      overlayAllowRead,
      overlayAskBash,
      overlayDenyEnv,
    ];
    const result = rewriteAsksToYolo(ruleset);
    expect(result.map((r) => r.action)).toEqual([
      "allow",
      "allow",
      "allow",
      "deny",
    ]);
    expect(result.map((r) => r.origin)).toEqual([
      "yolo",
      "agent",
      "yolo",
      "project",
    ]);
  });

  test("does not mutate the input ruleset", () => {
    const ruleset: Ruleset = [overlayAskBash];
    rewriteAsksToYolo(ruleset);
    expect(ruleset[0]?.action).toBe("ask");
    expect(ruleset[0]?.origin).toBe("global");
  });

  test("'yolo' is a valid RuleOrigin", () => {
    const origin: RuleOrigin = "yolo";
    expect(origin).toBe("yolo");
  });
});

describe("floorAllowsToAsk", () => {
  test("floors an allow rule to ask tagged origin 'fail-closed'", () => {
    const result = floorAllowsToAsk([overlayAllowRead]);
    expect(result).toEqual([
      {
        surface: "read",
        pattern: "*",
        action: "ask",
        layer: "config",
        origin: "fail-closed",
      },
    ]);
  });

  test("preserves surface, pattern, and layer while flooring allow", () => {
    const [floored] = floorAllowsToAsk([overlayAllowRead]);
    expect(floored.surface).toBe("read");
    expect(floored.pattern).toBe("*");
    expect(floored.layer).toBe("config");
    expect(floored.action).toBe("ask");
    expect(floored.origin).toBe("fail-closed");
  });

  test("passes deny rules through untouched (preserves hard denies)", () => {
    const result = floorAllowsToAsk([overlayDenyEnv]);
    expect(result).toEqual([overlayDenyEnv]);
  });

  test("passes ask rules through untouched", () => {
    const result = floorAllowsToAsk([overlayAskBash]);
    expect(result).toEqual([overlayAskBash]);
  });

  test("floors only allow rules in a mixed ruleset, preserving order", () => {
    const ruleset: Ruleset = [
      overlayAskDefault,
      overlayAllowRead,
      overlayAskBash,
      overlayDenyEnv,
    ];
    const result = floorAllowsToAsk(ruleset);
    expect(result.map((r) => r.action)).toEqual(["ask", "ask", "ask", "deny"]);
    expect(result.map((r) => r.origin)).toEqual([
      "builtin",
      "fail-closed",
      "global",
      "project",
    ]);
  });

  test("does not mutate the input ruleset", () => {
    const ruleset: Ruleset = [overlayAllowRead];
    floorAllowsToAsk(ruleset);
    expect(ruleset[0]?.action).toBe("allow");
    expect(ruleset[0]?.origin).toBe("agent");
  });

  test("'fail-closed' is a valid RuleOrigin", () => {
    const origin: RuleOrigin = "fail-closed";
    expect(origin).toBe("fail-closed");
  });
});

describe("isSurfaceFullyDenied", () => {
  function rule(
    surface: string,
    pattern: string,
    action: Rule["action"],
    layer?: Rule["layer"],
  ): Rule {
    return {
      surface,
      pattern,
      action,
      origin: "global",
      ...(layer && { layer }),
    };
  }

  const denyBashAll = rule("bash", "*", "deny");
  const askBashGit = rule("bash", "git *", "ask");
  const universalDeny = rule("*", "*", "deny", "default");

  describe("surfaces with no reachable exception", () => {
    test("a bare deny catch-all denies the whole surface", () => {
      expect(isSurfaceFullyDenied("bash", [denyBashAll], posixPathFlavor)).toBe(
        true,
      );
    });

    test("an exception written before the deny catch-all is shadowed", () => {
      expect(
        isSurfaceFullyDenied(
          "bash",
          [askBashGit, denyBashAll],
          posixPathFlavor,
        ),
      ).toBe(true);
    });

    test("a universal deny rule denies every surface", () => {
      expect(
        isSurfaceFullyDenied("bash", [universalDeny], posixPathFlavor),
      ).toBe(true);
      expect(
        isSurfaceFullyDenied("read", [universalDeny], posixPathFlavor),
      ).toBe(true);
    });

    test("a permissive rule on another surface does not reach this one", () => {
      expect(
        isSurfaceFullyDenied(
          "bash",
          [denyBashAll, rule("read", "*.md", "allow")],
          posixPathFlavor,
        ),
      ).toBe(true);
    });
  });

  describe("surfaces with a reachable exception", () => {
    test("an exception written after the deny catch-all keeps the surface reachable", () => {
      expect(
        isSurfaceFullyDenied(
          "bash",
          [denyBashAll, askBashGit],
          posixPathFlavor,
        ),
      ).toBe(false);
    });

    test("a surface with no rules at all falls to the synthesized ask", () => {
      expect(isSurfaceFullyDenied("bash", [], posixPathFlavor)).toBe(false);
    });

    test("a surface exception escapes a universal deny", () => {
      expect(
        isSurfaceFullyDenied(
          "bash",
          [universalDeny, askBashGit],
          posixPathFlavor,
        ),
      ).toBe(false);
    });

    test("a narrower deny below the exception does not re-deny the whole surface", () => {
      expect(
        isSurfaceFullyDenied(
          "bash",
          [denyBashAll, askBashGit, rule("bash", "git push *", "deny")],
          posixPathFlavor,
        ),
      ).toBe(false);
    });

    test("a per-tool path map with a permissive pattern keeps the tool reachable", () => {
      expect(
        isSurfaceFullyDenied(
          "read",
          [rule("read", "*", "deny"), rule("read", "*.md", "allow")],
          posixPathFlavor,
        ),
      ).toBe(false);
    });
  });

  describe("home-directory patterns", () => {
    // compileWildcardPattern home-expands the pattern side only, so a probe
    // value must be expanded the same way or the pattern cannot match itself.
    test.each(["~/notes/*", "$HOME/notes/*", "${HOME}/notes/*", "~", "$HOME"])(
      "%s reaches through a deny catch-all",
      (pattern) => {
        expect(
          isSurfaceFullyDenied(
            "read",
            [rule("read", "*", "deny"), rule("read", pattern, "allow")],
            posixPathFlavor,
          ),
        ).toBe(false);
      },
    );
  });

  describe("pattern shapes", () => {
    test.each([
      "*",
      "**",
      "git *",
      "git",
      "npm i*",
      "a?c",
      "*.env",
      "exa:*",
      "cargo build --release",
    ])("%s reaches through a deny catch-all", (pattern) => {
      expect(
        isSurfaceFullyDenied(
          "bash",
          [denyBashAll, rule("bash", pattern, "ask")],
          posixPathFlavor,
        ),
      ).toBe(false);
    });
  });

  test("a win32 path surface folds separators and case when probing", () => {
    expect(
      isSurfaceFullyDenied(
        "read",
        [rule("read", "*", "deny"), rule("read", "C:/Notes/*", "allow")],
        win32PathFlavor,
      ),
    ).toBe(false);
  });
});
