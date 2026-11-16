/**
 * The bounded-delegation enforcement checkpoint (ADR 0007, decision 5).
 *
 * The chain owner caps every registered link's verdict so a buggy or over-eager
 * external judge can never exceed the operator's policy: a link's `allow` on an
 * excluded surface is downgraded to `defer`, letting the `ask` fall through to
 * the terminal (a prompt) instead. The checkpoint never turns a `defer`/`deny`
 * into an `allow`.
 *
 * The excluded set is the whole `path` surface **family** plus the
 * `external_directory` family. Membership is tested on the family a surface
 * belongs to, so a directional member (`path_write`) is excluded by
 * construction and a later capability suffix joins its family for free (ADR
 * 0013, decision 4). That is a name-resolution rule, not a scope freeze: it
 * says how a family name resolves to members, and leaves *which* families are
 * excluded independently relaxable (#620).
 *
 * One exception is granted per ask, never per family: a link's `allow` on an
 * `external_directory`-family ask passes when the ask carries the
 * nothing-on-disk license its gate computed (ADR 0007, amendment 8). The
 * `path` family takes no license. Each allow honored this way writes an
 * `authorizer_allow_licensed` review record naming the link and the license,
 * so the fact that licensed it is auditable where the decision was taken.
 *
 * A finer secret-shaped-`path` exclusion (letting a link allow a non-secret
 * path) is deferred to the allow-capable slice that needs it (#620).
 */

import { surfaceFamilyOf } from "#src/access-intent/path-surfaces";
import type { Authorizer } from "./authorizer";
import type { PromptPermissionDetails } from "./permission-prompter";

/** Surface families on which a link may never grant an `allow` unlicensed. */
export const DELEGATION_EXCLUDED_SURFACES: ReadonlySet<string> = new Set([
  "external_directory",
  "path",
]);

/** The license that lets an `external_directory`-family allow through. */
type DelegationLicense = "nothing-on-disk";

/**
 * Wrap the link registered as `name` so an `allow` on an excluded surface is
 * capped to `defer` unless the ask carries a license that covers it. All other
 * verdicts, and `allow`s on non-excluded surfaces, pass through unchanged.
 * `details`, the injected `query`, and the review-log `log` are forwarded
 * as-is.
 */
export function encloseInDelegationEnvelope(
  name: string,
  authorize: Authorizer["authorize"],
): Authorizer["authorize"] {
  return async (details, query, log) => {
    const verdict = await authorize(details, query, log);
    if (verdict.kind !== "allow" || !isExcludedSurface(details)) {
      return verdict;
    }
    const license = licenseFor(details);
    if (license === null) return { kind: "defer" };
    log.review("authorizer_allow_licensed", {
      requestId: details.requestId,
      link: name,
      license,
    });
    return verdict;
  };
}

/**
 * Whether the ask's surface is excluded from link grants. Reads the
 * gate-authoritative `accessIntent.surface`, falling back to the display
 * `surface`. Fail-safe: an ask whose surface cannot be determined is treated as
 * excluded (more prompting, never less: ADR 0007 invariant 2).
 */
function isExcludedSurface(details: PromptPermissionDetails): boolean {
  const surface = details.accessIntent?.surface ?? details.surface ?? undefined;
  return (
    surface === undefined ||
    DELEGATION_EXCLUDED_SURFACES.has(surfaceFamilyOf(surface))
  );
}

/**
 * The license covering an excluded-surface allow, or `null`. Only an
 * `external_directory`-family ask whose gate-computed access facts carry the
 * nothing-on-disk license qualifies; the display surface never licenses
 * anything, since the license and the surface it covers must come from the
 * same gate.
 */
function licenseFor(
  details: PromptPermissionDetails,
): DelegationLicense | null {
  const facts = details.accessIntent;
  if (facts === undefined) return null;
  if (surfaceFamilyOf(facts.surface) !== "external_directory") return null;
  return facts.delegationLicense ?? null;
}
