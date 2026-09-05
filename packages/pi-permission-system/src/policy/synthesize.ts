import type { PermissionState } from "#src/types";
import type { Rule, RuleOrigin, Ruleset } from "./rule";

/**
 * Synthesize a single universal catch-all rule from the universal default.
 *
 * Produces one rule:
 * `{ surface: "*", pattern: "*", action: universalDefault, layer: "default" }`
 *
 * Per-surface catch-alls (`bash["*"]`, `mcp["*"]`, etc.) are expressed as
 * regular config rules from `normalizeFlatConfig()` and sit at higher indices
 * in the composed array, so they override this default via last-match-wins.
 */
export function synthesizeDefaults(
  universalDefault: PermissionState,
  origin: RuleOrigin = "builtin",
): Ruleset {
  return [
    {
      surface: "*",
      pattern: "*",
      action: universalDefault,
      layer: "default",
      origin,
    },
  ];
}

/**
 * MCP metadata operation targets that are auto-allowed when any explicit MCP
 * allow rule exists in the config layer.
 */
const MCP_BASELINE_TARGETS: readonly string[] = [
  "mcp_status",
  "mcp_list",
  "mcp_search",
  "mcp_describe",
  "mcp_connect",
];

/**
 * Conditionally synthesize MCP baseline auto-allow rules.
 *
 * Emits allow rules for the 5 MCP metadata targets only when `configRules`
 * contains at least one `surface: "mcp", action: "allow"` rule. This replicates
 * the `hasAnyMcpAllowRule` heuristic as actual rules.
 *
 * When `permission["mcp"]` is `"allow"` (or `mcp["*"]` is `"allow"`), the
 * synthesized config catch-all already covers all MCP targets — no separate
 * baseline rules are needed (and this function is not called in that case).
 *
 * Baseline rules are placed BEFORE config rules in the composed array so
 * that explicit config deny rules can still override them.
 *
 * All rules carry `layer: "baseline"`.
 */
export function synthesizeBaseline(configRules: Ruleset): Ruleset {
  const hasAnyMcpAllow = configRules.some(
    (r) => r.surface === "mcp" && r.action === "allow",
  );
  if (!hasAnyMcpAllow) {
    return [];
  }
  return MCP_BASELINE_TARGETS.map(
    (target): Rule => ({
      surface: "mcp",
      pattern: target,
      action: "allow",
      layer: "baseline",
      origin: "baseline",
    }),
  );
}

/**
 * Concatenate all rule layers into a single flat ruleset.
 *
 * Priority order (lowest → highest, i.e. earlier index → later index):
 *   defaults → baseline → config
 *
 * Session rules are NOT included here — they are appended at call-time inside
 * `checkPermission()` so that the cached composed ruleset remains session-agnostic.
 *
 * `evaluate()` scans from the end, so later layers override earlier ones.
 */
export function composeRuleset(
  defaults: Ruleset,
  baseline: Ruleset,
  config: Ruleset,
): Ruleset {
  return [...defaults, ...baseline, ...config];
}
