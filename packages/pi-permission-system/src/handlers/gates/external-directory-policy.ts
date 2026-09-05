import type { AccessPath } from "#src/access-intent/access-path";
import type { BashExternalPath } from "#src/access-intent/bash/bash-path-resolver";
import type { TokenEffect } from "#src/access-intent/effect";
import { capabilitySurfaceForEffect } from "#src/access-intent/path-surfaces";
import type { ScopedPermissionResolver } from "#src/policy/permission-resolver";
import { pickMostRestrictive } from "#src/policy/restrictiveness";
import type { PermissionCheckResult } from "#src/types";

/** An external path whose resolved `external_directory` state is not "allow". */
export interface UncoveredExternalPath {
  path: AccessPath;
  /** The family member the path's own effect named, and the check answered. */
  surface: string;
  /** What the effect was, and what established it — the review log's blame. */
  effect: TokenEffect;
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
 * Resolve a set of external accesses and select those not already allowed.
 *
 * Each access is resolved via {@link resolveExternalDirectoryPolicy} on the
 * narrowest family member its own effect names — a proven read on
 * `external_directory_read`, an unproven one on the bare family, which the
 * resolver folds over both directions (ADR 0013 §10). Entries whose state is
 * not "allow" are collected (filtering on state, not source, so config-level
 * allow rules suppress the prompt just as session-level allow rules do), and
 * the most restrictive uncovered check is returned so a config "deny" is not
 * downgraded to the catch-all "ask".
 */
export function selectUncoveredExternalPaths(
  accesses: readonly BashExternalPath[],
  resolver: ScopedPermissionResolver,
  agentName: string | undefined,
): UncoveredExternalPaths {
  const uncovered: UncoveredExternalPath[] = [];
  for (const { path, effect } of accesses) {
    const surface = capabilitySurfaceForEffect(
      "external_directory",
      effect.effect,
    );
    const check = resolveExternalDirectoryPolicy(
      path,
      resolver,
      surface,
      agentName,
    );
    if (check.state !== "allow") {
      uncovered.push({ path, surface, effect, check });
    }
  }
  return {
    uncovered,
    worstCheck: pickMostRestrictive(uncovered.map(({ check }) => check)),
  };
}
