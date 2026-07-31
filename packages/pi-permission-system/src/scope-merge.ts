import { mergeFlatPermissions } from "#src/permission-merge";
import type { RuleOrigin } from "#src/rule";
import type { FlatPermissionConfig, ScopeConfig } from "#src/types";

/** Surface → (pattern → originating scope). */
type OriginMap = Map<string, Map<string, RuleOrigin>>;

/** Result of merging permission objects across scopes with provenance tracking. */
export interface MergedScopes {
  /** Fully merged flat permission config (lowest → highest precedence). */
  mergedPermission: FlatPermissionConfig;
  /** Maps each surface to a per-pattern origin (which scope contributed it). */
  origins: OriginMap;
}

/**
 * Merge permission objects across scopes (lowest → highest precedence) while
 * tracking which scope contributed each (surface, pattern) entry.
 *
 * Mirrors mergeFlatPermissions() semantics for origin attribution:
 * - Both base and incoming are objects → shallow-merge: each incoming pattern
 *   is attributed to this scope; patterns the higher scope does not redefine
 *   keep their earlier origin.
 * - Otherwise → full replacement: this scope takes over the entire surface
 *   entry, discarding all lower-scope attribution.
 */
export function mergeScopesWithOrigins(
  scopes: readonly (readonly [RuleOrigin, ScopeConfig])[],
  field: "permission" | "subagentPermission" = "permission",
): MergedScopes {
  const origins: OriginMap = new Map();
  let mergedPermission: FlatPermissionConfig = {};

  for (const [scopeName, scope] of scopes) {
    const permission = scope[field];
    if (!permission) continue;

    for (const [surface, value] of Object.entries(permission)) {
      const baseVal = mergedPermission[surface];
      /* eslint-disable @typescript-eslint/no-unnecessary-condition -- defensive null/type checks; config values may differ at runtime */
      const bothObjects =
        typeof baseVal === "object" &&
        baseVal !== null &&
        typeof value === "object" &&
        value !== null;
      /* eslint-enable @typescript-eslint/no-unnecessary-condition */

      if (bothObjects) {
        // Shallow-merge: each incoming pattern is attributed to this scope;
        // existing patterns from lower scopes keep their earlier origin.
        if (!origins.has(surface)) origins.set(surface, new Map());
        for (const pattern of Object.keys(value)) {
          origins.get(surface)?.set(pattern, scopeName);
        }
      } else {
        // Full replacement: this scope takes over the entire surface entry.
        const surfaceOrigins = new Map<string, RuleOrigin>();
        if (typeof value === "string") {
          surfaceOrigins.set("*", scopeName);
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive null check
        } else if (typeof value === "object" && value !== null) {
          for (const pattern of Object.keys(value)) {
            surfaceOrigins.set(pattern, scopeName);
          }
        }
        origins.set(surface, surfaceOrigins);
      }
    }

    mergedPermission = mergeFlatPermissions(mergedPermission, permission);
  }

  return { mergedPermission, origins };
}
