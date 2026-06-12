import { PATH_SURFACES } from "./path-utils";
import type { PermissionState } from "./types";
import { wildcardMatch } from "./wildcard-matcher";

/**
 * Provenance of a rule — which source contributed it.
 *
 * Config scopes: "global", "project", "agent", "project-agent".
 * Synthesized:   "builtin" (universal default / evaluate() fallback),
 *                "baseline" (conditional MCP metadata auto-allow).
 * Runtime:       "session" (session approvals).
 */
export type RuleOrigin =
  | "global"
  | "project"
  | "agent"
  | "project-agent"
  | "builtin"
  | "baseline"
  | "session";

/** A single permission rule — the atomic unit of policy. */
export interface Rule {
  /** The permission surface: "bash", "read", "mcp", "skill", "external_directory", etc. */
  surface: string;
  /** The match pattern: a command glob, tool name, skill name, or "*". */
  pattern: string;
  /** The permission decision. */
  action: PermissionState;
  /** Custom denial reason for deny rules (optional). */
  reason?: string;
  /**
   * Origin layer — used to derive PermissionCheckResult.source after evaluation.
   * Not used by evaluate(); purely informational metadata.
   */
  layer?: "default" | "baseline" | "config" | "session";
  /** Which source contributed this rule. */
  origin: RuleOrigin;
}

/** An ordered list of rules. Later rules take priority (last-match-wins). */
export type Ruleset = Rule[];

/**
 * Pure permission evaluation.
 *
 * Returns the last rule in `rules` whose surface and pattern both
 * wildcard-match the supplied values (last-match-wins).
 *
 * When no rule matches, returns a synthetic rule with `defaultAction`
 * (defaults to "ask" — least privilege).
 */
export function evaluate(
  surface: string,
  pattern: string,
  rules: Ruleset,
  defaultAction?: PermissionState,
  platform: NodeJS.Platform = process.platform,
): Rule {
  const rule = rules.findLast((r) =>
    ruleMatches(r, surface, pattern, platform),
  );
  if (rule !== undefined) return rule;
  return {
    surface,
    pattern,
    action: defaultAction ?? "ask",
    origin: "builtin",
  };
}

/**
 * On Windows, path-surface values are canonicalized + lowercased; fold the
 * pattern→value match (case and separators) so mixed-case / forward-slash
 * overrides still match. The surface→surface match stays exact.
 */
function pathMatchOptions(
  surface: string,
  platform: NodeJS.Platform,
): { caseInsensitive: true; windowsSeparators: true } | undefined {
  return platform === "win32" && PATH_SURFACES.has(surface)
    ? { caseInsensitive: true, windowsSeparators: true }
    : undefined;
}

function ruleMatches(
  rule: Rule,
  surface: string,
  value: string,
  platform: NodeJS.Platform,
): boolean {
  const matchOptions = pathMatchOptions(surface, platform);
  return (
    wildcardMatch(rule.surface, surface) &&
    wildcardMatch(rule.pattern, value, matchOptions)
  );
}

/**
 * Evaluate a surface against an ordered list of candidate values, stopping at
 * the first candidate that matches a non-default rule (last-match-wins within
 * each candidate, first-non-default-wins across candidates).
 *
 * Used by MCP (multi-candidate target list) and, uniformly, by all other
 * surfaces (single-element candidate list).
 *
 * Returns the matched rule and the candidate value that produced it.
 * When every candidate matches only the synthesized default, falls back to
 * evaluating the first candidate so the caller always receives a concrete
 * result.
 */
/**
 * Evaluate a surface against multiple values, returning the most restrictive
 * non-allow result (deny > ask > allow).
 *
 * Used by the cross-cutting `path` surface to aggregate permission decisions
 * across multiple file paths extracted from a single tool call or bash command.
 *
 * Returns `null` when all values evaluate to `allow` (no restriction).
 * Returns the first `deny` immediately (short-circuit).
 * Returns the first `ask` if no `deny` is found.
 */
export function evaluateMostRestrictive(
  surface: string,
  values: string[],
  rules: Ruleset,
): { rule: Rule; value: string } | null {
  let worst: { rule: Rule; value: string } | null = null;
  for (const value of values) {
    const rule = evaluate(surface, value, rules);
    if (rule.action === "deny") return { rule, value };
    if (rule.action === "ask" && worst?.rule.action !== "ask") {
      worst = { rule, value };
    }
  }
  return worst;
}

export function evaluateFirst(
  surface: string,
  values: string[],
  rules: Ruleset,
): { rule: Rule; value: string } {
  for (const value of values) {
    const rule = evaluate(surface, value, rules);
    if (rule.layer !== "default") {
      return { rule, value };
    }
  }
  // All candidates matched only the synthesized default — use the first.
  const fallbackValue = values[0] ?? "*";
  return {
    rule: evaluate(surface, fallbackValue, rules),
    value: fallbackValue,
  };
}

/**
 * Evaluate equivalent lookup values as aliases of the same path.
 *
 * Unlike `evaluateFirst()`, this preserves rule ordering across aliases: the
 * last rule that matches any alias wins. This lets absolute allowlists and
 * legacy relative rules coexist without a catch-all match on the first alias
 * masking a later, more specific rule on another alias.
 */
export function evaluateAnyValue(
  surface: string,
  values: string[],
  rules: Ruleset,
  platform: NodeJS.Platform = process.platform,
): { rule: Rule; value: string } {
  const fallbackValue = values[0] ?? "*";
  const rule = rules.findLast((r) =>
    values.some((value) => ruleMatches(r, surface, value, platform)),
  );
  if (rule !== undefined) {
    return {
      rule,
      value:
        values.find((value) => ruleMatches(rule, surface, value, platform)) ??
        fallbackValue,
    };
  }
  return {
    rule: evaluate(surface, fallbackValue, rules),
    value: fallbackValue,
  };
}
