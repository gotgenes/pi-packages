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
 *
 * The operator may lift the cap for one named link on chosen excluded families
 * (`authorizerTrust`): an explicit, per-link grant of the authority the
 * checkpoint otherwise withholds. It relaxes nothing else — `deny` rules never
 * reach the chain, other links stay capped, and an ask whose surface cannot be
 * determined is still capped.
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
 * The excluded surface families the operator trusts one link to `allow` on
 * (`authorizerTrust`), with the link's configured name for the review log.
 */
export interface DelegationTrust {
  link: string;
  families: ReadonlySet<string>;
}

/**
 * Wrap a link's `authorize` so an `allow` on an excluded surface is capped to
 * `defer`, unless `trust` names that surface's family. All other verdicts, and
 * `allow`s on non-excluded surfaces, pass through unchanged. `details`, the
 * injected `query`, and the review-log `log` are forwarded as-is.
 */
export function encloseInDelegationEnvelope(
  authorize: Authorizer["authorize"],
  trust?: DelegationTrust,
): Authorizer["authorize"] {
  return async (details, query, log) => {
    const verdict = await authorize(details, query, log);
    if (verdict.kind !== "allow") {
      return verdict;
    }
    const family = excludedFamilyOf(details);
    if (family === null) {
      return verdict;
    }
    if (family !== undefined && trust?.families.has(family) === true) {
      log.review("authorizer_trusted_allow", {
        requestId: details.requestId,
        link: trust.link,
        surfaceFamily: family,
      });
      return verdict;
    }
    return { kind: "defer" };
  };
}

/**
 * The excluded family the ask's surface belongs to: `null` when the surface is
 * not excluded, `undefined` when it cannot be determined. Reads the
 * gate-authoritative `accessIntent.surface`, falling back to the display
 * `surface`. Fail-safe: an undetermined surface is treated as excluded and no
 * trust lifts its cap (more prompting, never less — ADR 0007 invariant 2).
 */
function excludedFamilyOf(
  details: PromptPermissionDetails,
): string | null | undefined {
  const surface = details.accessIntent?.surface ?? details.surface ?? undefined;
  if (surface === undefined) {
    return undefined;
  }
  const family = surfaceFamilyOf(surface);
  return DELEGATION_EXCLUDED_SURFACES.has(family) ? family : null;
}
