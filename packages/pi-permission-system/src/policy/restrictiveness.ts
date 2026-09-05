import type { PermissionCheckResult, PermissionState } from "#src/types";

/**
 * Select the most restrictive permission result from a possibly-empty list
 * (deny > ask > allow).
 *
 * The first occurrence wins on ties, so a caller passing results in candidate
 * order receives the earliest worst case. Returns `undefined` for an empty list.
 *
 * Shared by the bash gates (path, external-directory) to combine the per-candidate
 * `checkPermission` results their tree-sitter token extraction produces.
 */
export function pickMostRestrictive(
  results: readonly PermissionCheckResult[],
): PermissionCheckResult | undefined {
  const first = results.at(0);
  return first === undefined
    ? undefined
    : mostRestrictiveOf([first, ...results.slice(1)]);
}

/**
 * Select the most restrictive of a statically non-empty list of results
 * (deny > ask > allow), first-wins on ties.
 *
 * Total by construction: the non-empty tuple parameter means the caller never
 * handles an `undefined` branch. The winner is the losing member's **own**
 * result, so `toolName`, `matchedPattern`, `origin`, and `source` all name the
 * input that forced the verdict rather than a synthesized composite.
 */
export function mostRestrictiveOf(
  results: readonly [PermissionCheckResult, ...PermissionCheckResult[]],
): PermissionCheckResult {
  let worst = results[0];
  for (const result of results) {
    if (RESTRICTIVENESS[result.state] > RESTRICTIVENESS[worst.state]) {
      worst = result;
    }
  }
  return worst;
}

/** Restrictiveness ordering: deny is the most restrictive, allow the least. */
const RESTRICTIVENESS: Record<PermissionState, number> = {
  allow: 0,
  ask: 1,
  deny: 2,
};
