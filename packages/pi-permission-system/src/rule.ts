import { PATH_SURFACES } from "#src/access-intent/path-surfaces";
import { expandHomePath } from "#src/path/expand-home";
import type { PathFlavor } from "#src/path/path-flavor";
import type { PermissionState } from "./types";
import { type WildcardMatchOptions, wildcardMatch } from "./wildcard-matcher";

/**
 * Provenance of a rule — which source contributed it.
 *
 * Config scopes: "global", "project", "agent", "project-agent".
 * Synthesized:   "builtin" (universal default / evaluate() fallback),
 *                "baseline" (conditional MCP metadata auto-allow).
 * Runtime:       "session" (session approvals).
 * Rewrite:       "yolo" (composition-stage ask→allow rewrite under yolo mode),
 *                "fail-closed" (composition-stage allow→ask floor when an
 *                invalid non-global config scope is detected).
 */
export type RuleOrigin =
  | "global"
  | "project"
  | "agent"
  | "project-agent"
  | "builtin"
  | "baseline"
  | "session"
  | "yolo"
  | "fail-closed";

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
 * Rewrite every `ask` rule to `allow`, tagged `origin: "yolo"`.
 *
 * The composition-stage expression of yolo mode as recorded authority: when
 * enabled, an `ask` becomes a standing `allow` grant in the ruleset rather than
 * a live prompt-path concern. `deny` and existing `allow` rules pass through
 * untouched, so yolo suppresses prompts but preserves hard denies.
 *
 * Pure and non-mutating — `surface`, `pattern`, and `layer` are preserved so
 * downstream `matchedPattern` / source derivation is unaffected; only `action`
 * and `origin` change.
 */
export function rewriteAsksToYolo(rules: Ruleset): Ruleset {
  return rules.map((rule) =>
    rule.action === "ask" ? { ...rule, action: "allow", origin: "yolo" } : rule,
  );
}

/**
 * Floor every `allow` rule to `ask`, tagged `origin: "fail-closed"`.
 *
 * The mirror image of {@link rewriteAsksToYolo}: the composition-stage
 * expression of the fail-closed clamp applied when an invalid non-global config
 * scope is detected. A permissive `allow` inherited from a lower-precedence
 * scope becomes an `ask` prompt rather than a silent grant, while `deny` and
 * existing `ask` rules pass through untouched — so the clamp removes only
 * permissive inheritance and never weakens a hard deny.
 *
 * Pure and non-mutating — `surface`, `pattern`, and `layer` are preserved so
 * downstream `matchedPattern` / source derivation is unaffected; only `action`
 * and `origin` change.
 */
export function floorAllowsToAsk(rules: Ruleset): Ruleset {
  return rules.map((rule) =>
    rule.action === "allow"
      ? { ...rule, action: "ask", origin: "fail-closed" }
      : rule,
  );
}

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
  flavor: PathFlavor,
  defaultAction?: PermissionState,
): Rule {
  const rule = rules.findLast((r) => ruleMatches(r, surface, pattern, flavor));
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
export function pathMatchOptions(
  surface: string,
  flavor: PathFlavor,
): WildcardMatchOptions | undefined {
  return PATH_SURFACES.has(surface) ? flavor.matchOptions : undefined;
}

function ruleMatches(
  rule: Rule,
  surface: string,
  value: string,
  flavor: PathFlavor,
): boolean {
  const matchOptions = pathMatchOptions(surface, flavor);
  return (
    wildcardMatch(rule.surface, surface) &&
    wildcardMatch(rule.pattern, value, matchOptions)
  );
}

/**
 * Whether every value on `surface` resolves to `deny`.
 *
 * This is a different question from "what does the surface's catch-all say?",
 * and it carries a different burden of proof: the catch-all answers *what this
 * surface is*, while this answers *whether anything at all could get through* —
 * the question tool exposure has to ask before withholding a tool from the
 * agent entirely.
 *
 * Reachability is decided by probing each pattern configured on the surface as
 * a representative value through {@link evaluate}, so last-match-wins shadowing
 * is honored: an exception written *after* a `deny` catch-all is reachable,
 * while one written *before* it is not.
 *
 * The probe is an approximation of "does any string resolve non-deny", not a
 * decision procedure for it. Being wrong in either direction only changes
 * whether the agent sees the tool — the invocation gate re-evaluates the real
 * value against the same ruleset either way.
 */
export function isSurfaceFullyDenied(
  surface: string,
  rules: Ruleset,
  flavor: PathFlavor,
): boolean {
  for (const value of probeValuesForSurface(surface, rules)) {
    if (evaluate(surface, value, rules, flavor).action !== "deny") return false;
  }
  return true;
}

/**
 * The representative values {@link isSurfaceFullyDenied} probes: the catch-all,
 * plus every pattern configured on a rule whose surface reaches `surface`.
 *
 * Each pattern is home-expanded because {@link compileWildcardPattern} expands
 * the *pattern* side only; an unexpanded `~/notes/*` probe would fail to match
 * its own rule and report the surface denied.
 */
function probeValuesForSurface(surface: string, rules: Ruleset): Set<string> {
  const values = new Set<string>(["*"]);
  for (const rule of rules) {
    if (wildcardMatch(rule.surface, surface)) {
      values.add(expandHomePath(rule.pattern));
    }
  }
  return values;
}

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
  flavor: PathFlavor,
): { rule: Rule; value: string } | null {
  let worst: { rule: Rule; value: string } | null = null;
  for (const value of values) {
    const rule = evaluate(surface, value, rules, flavor);
    if (rule.action === "deny") return { rule, value };
    if (rule.action === "ask" && worst?.rule.action !== "ask") {
      worst = { rule, value };
    }
  }
  return worst;
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
export function evaluateFirst(
  surface: string,
  values: string[],
  rules: Ruleset,
  flavor: PathFlavor,
): { rule: Rule; value: string } {
  for (const value of values) {
    const rule = evaluate(surface, value, rules, flavor);
    if (rule.layer !== "default") {
      return { rule, value };
    }
  }
  // All candidates matched only the synthesized default — use the first.
  const fallbackValue = values[0] ?? "*";
  return {
    rule: evaluate(surface, fallbackValue, rules, flavor),
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
  flavor: PathFlavor,
): { rule: Rule; value: string } {
  const fallbackValue = values[0] ?? "*";
  const rule = rules.findLast((r) =>
    values.some((value) => ruleMatches(r, surface, value, flavor)),
  );
  if (rule !== undefined) {
    return {
      rule,
      value:
        values.find((value) => ruleMatches(rule, surface, value, flavor)) ??
        fallbackValue,
    };
  }
  return {
    rule: evaluate(surface, fallbackValue, rules, flavor),
    value: fallbackValue,
  };
}
