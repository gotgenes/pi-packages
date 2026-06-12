import { isPermissionState } from "./common";
import type { Rule, Ruleset } from "./rule";
import type { DenyWithReason, FlatPermissionConfig } from "./types";

/**
 * Narrow type guard: a raw JSON value that represents a DenyWithReason.
 * Accepts both `{ action: "deny" }` and `{ action: "deny", reason: "..." }`.
 * Rejects non-string `reason` values to prevent type pollution from malformed config.
 */
function isDenyWithReason(value: unknown): value is DenyWithReason {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.action === "deny" &&
    (record.reason === undefined || typeof record.reason === "string")
  );
}

/**
 * Convert a flat permission config into a Ruleset.
 *
 * Each key is a surface name. A string value is shorthand for
 * `{ "*": action }`. An object value maps patterns to actions.
 * Pattern values can be a plain PermissionState string or a
 * `DenyWithReason` object (`{ action: "deny", reason?: string }`).
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
      for (const [pattern, rawAction] of Object.entries(value)) {
        if (isDenyWithReason(rawAction)) {
          rules.push({
            surface,
            pattern,
            action: "deny",
            reason: rawAction.reason,
            origin: "builtin",
          });
        } else if (isPermissionState(rawAction)) {
          rules.push({
            surface,
            pattern,
            action: rawAction,
            origin: "builtin",
          });
        }
      }
    }
  }
  return rules;
}
