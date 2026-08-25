import type { AccessPath } from "#src/access-intent/access-path";
import type { ScopedPermissionResolver } from "#src/permission-resolver";
import { pickMostRestrictive } from "#src/restrictiveness";
import type { PermissionCheckResult } from "#src/types";

/** An external path whose resolved `external_directory` state is not "allow". */
export interface UncoveredExternalPath {
  path: AccessPath;
  check: PermissionCheckResult;
}

/** The uncovered external paths plus the most restrictive check among them. */
export interface UncoveredExternalPaths {
  uncovered: UncoveredExternalPath[];
  /** Worst check among uncovered paths; `undefined` only when none are uncovered. */
  worstCheck: PermissionCheckResult | undefined;
}

/**
 * Resolve one external path's policy on an `external_directory`-family surface.
 *
 * `surface` is the narrowest family member the caller can prove — the bare
 * family name when it can prove nothing narrower, which the resolver folds
 * over both directions (ADR 0013 §10).
 *
 * Emits an `access-path` {@link AccessIntent}; the resolver unwraps it via
 * {@link AccessPath.matchValues} so a config pattern on either the typed or
 * symlink-resolved alias applies (#418). This is the single source for the
 * external-directory resolve that the two external-directory gates previously
 * duplicated.
 */
export function resolveExternalDirectoryPolicy(
  path: AccessPath,
  resolver: ScopedPermissionResolver,
  surface: string,
  agentName: string | undefined,
): PermissionCheckResult {
  return resolver.resolve({
    kind: "access-path",
    surface,
    path,
    agentName,
  });
}

/**
 * Resolve a set of external paths and select those not already allowed.
 *
 * Each path is resolved via {@link resolveExternalDirectoryPolicy}; entries
 * whose state is not "allow" are collected (filtering on state, not source, so
 * config-level allow rules suppress the prompt just as session-level allow
 * rules do), and the most restrictive uncovered check is returned so a config
 * "deny" is not downgraded to the catch-all "ask".
 *
 * A bash token's direction is not provable yet (#807), so these resolve on the
 * bare family surface and consult both directions, most-restrictive.
 */
export function selectUncoveredExternalPaths(
  paths: readonly AccessPath[],
  resolver: ScopedPermissionResolver,
  agentName: string | undefined,
): UncoveredExternalPaths {
  const uncovered: UncoveredExternalPath[] = [];
  for (const path of paths) {
    const check = resolveExternalDirectoryPolicy(
      path,
      resolver,
      "external_directory",
      agentName,
    );
    if (check.state !== "allow") {
      uncovered.push({ path, check });
    }
  }
  return {
    uncovered,
    worstCheck: pickMostRestrictive(uncovered.map(({ check }) => check)),
  };
}
