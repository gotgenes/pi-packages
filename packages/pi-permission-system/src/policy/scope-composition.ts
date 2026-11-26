import type { PolicyScope } from "#src/config/policy-loader";
import type { FlatPermissionConfig, PermissionState } from "#src/types";
import { isPermissionState } from "#src/types";
import {
  expandDirectionalSugar,
  normalizeFlatConfig,
  relocateMcpToolKeyRules,
} from "./normalize";
import type { Rule, RuleOrigin, Ruleset } from "./rule";

/** The universal fallback and the scope that set it. */
export interface UniversalFallback {
  action: PermissionState;
  origin: RuleOrigin;
}

/** The config layer composed from the scopes in precedence order. */
export interface ComposedScopes {
  /**
   * Config-layer rules, each scope's placed after the scopes before it. A
   * `(surface, pattern)` a later scope redefines appears once, at the later
   * scope's position (ADR 0016 §2). Includes each scope's relocated Pi MCP
   * tool keys, placed after that scope's own rules.
   */
  rules: Ruleset;
  /**
   * The same composition over the rules as written, before relocation — the
   * MCP baseline reads these. It is its own fold, not `rules` without the
   * copies: a later scope's copy can redefine (and so drop) an earlier
   * scope's written `mcp` rule in `rules`.
   */
  writtenRules: Ruleset;
  /** Absent when no scope sets the universal `"*"`. */
  universalFallback: UniversalFallback | undefined;
  /** Each relocated top-level `mcp__` key, in scope order. */
  relocatedMcpToolKeys: string[];
}

/**
 * Compose the config layer from the scopes, lowest precedence first.
 *
 * Each scope's permission is expanded (directional sugar, ADR 0013 §9) and
 * normalized on its own, so every rule carries the scope that wrote it, and a
 * later scope's catch-all lands after an earlier scope's specific patterns.
 * The universal `"*"` is not a rule: the last scope that sets it decides the
 * fallback for checks no rule matches.
 */
export function composeScopes(
  scopes: readonly Pick<PolicyScope, "name" | "config">[],
): ComposedScopes {
  let rules: Ruleset = [];
  let writtenRules: Ruleset = [];
  let universalFallback: UniversalFallback | undefined;
  const relocatedMcpToolKeys: string[] = [];

  for (const { name, config } of scopes) {
    if (!config.permission) continue;
    const permission = expandDirectionalSugar(config.permission);
    if (Object.hasOwn(permission, "*")) {
      universalFallback = universalFallbackOf(permission["*"], name);
    }
    const written = scopeRules(permission, name);
    const relocation = relocateMcpToolKeyRules(written);
    rules = redefine(rules, relocation.rules);
    writtenRules = redefine(writtenRules, written);
    relocatedMcpToolKeys.push(...relocation.relocatedKeys);
  }

  return { rules, writtenRules, universalFallback, relocatedMcpToolKeys };
}

/**
 * A scope's universal `"*"` as the fallback. A value that is not an action (a
 * pattern map, which the schema admits) falls back to `ask`.
 */
function universalFallbackOf(
  value: FlatPermissionConfig["*"],
  origin: RuleOrigin,
): UniversalFallback {
  return { action: isPermissionState(value) ? value : "ask", origin };
}

/** One scope's config-layer rules: every key but the universal `"*"`. */
function scopeRules(
  permission: FlatPermissionConfig,
  origin: RuleOrigin,
): Ruleset {
  const surfaces: FlatPermissionConfig = Object.fromEntries(
    Object.entries(permission).filter(([surface]) => surface !== "*"),
  );
  return normalizeFlatConfig(surfaces).map(
    (rule): Rule => ({ ...rule, layer: "config", origin }),
  );
}

/**
 * `later` placed after `earlier`, with every earlier rule `later` redefines
 * (the same surface and pattern) dropped: an identical later rule matches
 * whenever the earlier one does, so the earlier one could never decide.
 */
function redefine(earlier: Ruleset, later: Ruleset): Ruleset {
  const redefined = new Set(later.map(ruleKey));
  return [...earlier.filter((rule) => !redefined.has(ruleKey(rule))), ...later];
}

function ruleKey(rule: Rule): string {
  return JSON.stringify([rule.surface, rule.pattern]);
}
