import type { FlatPermissionConfig } from "#src/types";

/**
 * Merge two flat permission configs into the runtime-config view, whose one
 * reader asks which surfaces carry a catch-all (`detectPermissiveBashFallback`).
 *
 * Agrees with the composed policy on that question: a pattern-map override
 * keeps a string base as its `"*"` entry unless it sets its own, because the
 * earlier scope's catch-all still applies under the later scope's patterns.
 * Two maps shallow-merge; a string override replaces the base.
 */
export function mergeFlatPermissions(
  base: FlatPermissionConfig,
  override: FlatPermissionConfig,
): FlatPermissionConfig {
  const merged: FlatPermissionConfig = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const baseVal = merged[key];
    /* eslint-disable @typescript-eslint/no-unnecessary-condition -- defensive null/type checks; config values may differ at runtime */
    const overrideIsMap = typeof value === "object" && value !== null;
    const baseIsMap = typeof baseVal === "object" && baseVal !== null;
    /* eslint-enable @typescript-eslint/no-unnecessary-condition */
    if (overrideIsMap && typeof baseVal === "string") {
      merged[key] = { "*": baseVal, ...value };
    } else if (overrideIsMap && baseIsMap) {
      merged[key] = { ...baseVal, ...value };
    } else {
      merged[key] = value;
    }
  }
  return merged;
}
