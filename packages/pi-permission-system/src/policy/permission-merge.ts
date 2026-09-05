import type { FlatPermissionConfig } from "#src/types";

/**
 * Deep-shallow merge two flat permission configs.
 * Both objects → shallow-merge the pattern maps.
 * Otherwise → override replaces base.
 */
export function mergeFlatPermissions(
  base: FlatPermissionConfig,
  override: FlatPermissionConfig,
): FlatPermissionConfig {
  const merged: FlatPermissionConfig = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const baseVal = merged[key];
    /* eslint-disable @typescript-eslint/no-unnecessary-condition -- defensive null/type checks; config values may differ at runtime */
    if (
      typeof baseVal === "object" &&
      baseVal !== null &&
      typeof value === "object" &&
      value !== null
    ) {
      /* eslint-enable @typescript-eslint/no-unnecessary-condition */
      merged[key] = {
        ...baseVal,
        ...value,
      };
    } else {
      merged[key] = value;
    }
  }
  return merged;
}
