/**
 * The bounded-delegation enforcement checkpoint (ADR 0007 §5).
 *
 * The chain owner caps every registered link's verdict so a buggy or over-eager
 * external judge can never exceed the operator's policy: a link's `allow` on an
 * excluded surface is downgraded to `defer`, letting the `ask` fall through to
 * the terminal (a prompt) instead. The checkpoint only ever *tightens* a
 * verdict — it never turns a `defer`/`deny` into an `allow`.
 *
 * The excluded set is the whole `path` surface **family** plus the
 * `external_directory` family — membership is tested on the family a surface
 * belongs to, so a directional member (`path_write`) is excluded by
 * construction and a later capability suffix joins its family for free (ADR
 * 0013 §4). That is a name-resolution rule, not a scope freeze: it says how a
 * family name resolves to members, and leaves *which* families are excluded
 * independently relaxable (#620).
 *
 * A finer secret-shaped-`path` exclusion (letting a link allow a non-secret
 * path) is deferred to the allow-capable slice that needs it (#620); until then
 * the conservative whole-family exclusion ships. The checkpoint is dormant
 * while the only registered links are deny-first (they never `allow`).
 */

import { surfaceFamilyOf } from "#src/access-intent/path-surfaces";
import type { Authorizer } from "./authorizer";
import type { PromptPermissionDetails } from "./permission-prompter";

/** Surface families on which a link may never grant an `allow` (ADR 0007 §5). */
export const DELEGATION_EXCLUDED_SURFACES: ReadonlySet<string> = new Set([
  "external_directory",
  "path",
]);

/**
 * Wrap a link's `authorize` so an `allow` on an excluded surface is capped to
 * `defer`. All other verdicts, and `allow`s on non-excluded surfaces, pass
 * through unchanged. `details`, the injected `query`, and the review-log `log`
 * are forwarded as-is.
 */
export function encloseInDelegationEnvelope(
  authorize: Authorizer["authorize"],
): Authorizer["authorize"] {
  return async (details, query, log) => {
    const verdict = await authorize(details, query, log);
    if (verdict.kind === "allow" && isExcludedSurface(details)) {
      return { kind: "defer" };
    }
    return verdict;
  };
}

/**
 * Whether the ask's surface is excluded from link grants. Reads the
 * gate-authoritative `accessIntent.surface`, falling back to the display
 * `surface`. Fail-safe: an ask whose surface cannot be determined is treated as
 * excluded (more prompting, never less — ADR 0007 invariant 2).
 */
function isExcludedSurface(details: PromptPermissionDetails): boolean {
  const surface = details.accessIntent?.surface ?? details.surface ?? undefined;
  return (
    surface === undefined ||
    DELEGATION_EXCLUDED_SURFACES.has(surfaceFamilyOf(surface))
  );
}
