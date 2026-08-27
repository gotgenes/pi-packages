import { surfaceFamilyMembers } from "#src/access-intent/path-surfaces";
import type { Rule, Ruleset } from "./rule";
import type { FlatPermissionConfig, PatternValue } from "./types";
import { isDenyWithReason, isPermissionState } from "./types";

/**
 * A surface's value in a flat permission config: a catch-all or a pattern map.
 * `NonNullable` because the four named directional properties are optional.
 */
type SurfaceValue = NonNullable<FlatPermissionConfig[string]>;

/** A surface's pattern → action map. */
type PatternMap = Record<string, PatternValue>;

/**
 * Rewrite one scope's flat permission object so the bare `path` and
 * `external_directory` sugar keys are replaced by their directional members
 * (ADR 0013 §4).
 *
 * After expansion **no rule lives on a bare family surface at all** — that is
 * what makes `PermissionResolver`'s family fold the read path.
 *
 * The intra-surface merge order is normative: sugar-derived entries come first
 * and explicit directional entries append after them, whatever the keys'
 * textual order in the file, so a config and its key-order-swapped twin mean
 * the same thing. A pattern the explicit entry redefines is emitted once, at
 * the explicit entry's position, so last-match-wins gives it the final say.
 *
 * Called per scope at load, before composition — so origins stay attributed to
 * the authoring scope rather than collapsing to `builtin`.
 */
export function expandDirectionalSugar(
  permission: FlatPermissionConfig,
): FlatPermissionConfig {
  const expanded: FlatPermissionConfig = {};
  for (const [surface, value] of Object.entries(permission)) {
    // A key present with an explicit `undefined` value carries no rules.
    if (value === undefined) continue;
    const members = surfaceFamilyMembers(surface);
    if (members === null) {
      // A directional key the sugar already absorbed keeps the merged value.
      if (!Object.hasOwn(expanded, surface)) expanded[surface] = value;
      continue;
    }
    for (const member of members) {
      expanded[member] = appendExplicitEntries(value, permission[member]);
    }
  }
  return expanded;
}

/** The sugar-derived entries, followed by the explicit directional entries. */
function appendExplicitEntries(
  sugar: SurfaceValue,
  explicit: SurfaceValue | undefined,
): SurfaceValue {
  if (explicit === undefined) {
    return typeof sugar === "string" ? sugar : { ...sugar };
  }
  const explicitPatterns = toPatternMap(explicit);
  const sugarPatterns = Object.fromEntries(
    Object.entries(toPatternMap(sugar)).filter(
      ([pattern]) => !Object.hasOwn(explicitPatterns, pattern),
    ),
  );
  return { ...sugarPatterns, ...explicitPatterns };
}

/** A catch-all string is shorthand for `{ "*": action }` (see `normalizeFlatConfig`). */
function toPatternMap(value: SurfaceValue): PatternMap {
  return typeof value === "string" ? { "*": value } : value;
}

/**
 * Convert a flat permission config into a Ruleset.
 *
 * Each key is a surface name. A string value is shorthand for
 * `{ "*": action }`. An object value maps patterns to actions.
 * A pattern value may be a PermissionState string or a `DenyWithReason`
 * object (`{ action: "deny", reason?: string }`).
 * Invalid action values are silently skipped.
 *
 * The universal fallback key `"*"` is included if present — callers
 * that use `"*"` only for `synthesizeDefaults()` should strip it before
 * calling this function.
 */
export function normalizeFlatConfig(permission: FlatPermissionConfig): Ruleset {
  const rules: Rule[] = [];
  for (const [surface, value] of Object.entries(permission)) {
    if (typeof value === "string") {
      if (isPermissionState(value)) {
        rules.push({ surface, pattern: "*", action: value, origin: "builtin" });
      }
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive null check; value type does not include null but runtime JSON may
    } else if (typeof value === "object" && value !== null) {
      for (const [pattern, action] of Object.entries(value)) {
        if (isDenyWithReason(action)) {
          rules.push({
            surface,
            pattern,
            action: "deny",
            reason: action.reason,
            origin: "builtin",
          });
        } else if (isPermissionState(action)) {
          rules.push({ surface, pattern, action, origin: "builtin" });
        }
      }
    }
  }
  return rules;
}
