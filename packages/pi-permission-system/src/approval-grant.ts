/**
 * One session-approval grant: a wildcard pattern approved on one surface.
 *
 * A gate proves a direction per accessed path (ADR 0013 §7), so an ask whose
 * paths disagree records a surface per pattern rather than one for all of them
 * (#810). This lives in its own module because both the {@link SessionApproval}
 * value object and the forwarded wire type name it, and those two already
 * import in one direction.
 */
import {
  type CapabilityDirection,
  capabilityDirectionOf,
  surfaceFamilyOf,
} from "#src/access-intent/path-surfaces";

export interface ApprovalGrant {
  readonly surface: string;
  readonly pattern: string;
}

/**
 * How wide a session grant is recorded, relative to what the gate proved.
 *
 * `"proven"` records each grant on the surface the gate named — the
 * least-privilege default, and the only width anything produces today.
 * `"family"` folds a directional surface to its bare family, which
 * `SessionRules.approve` sugar-expands onto both members (ADR 0013 §4).
 */
export type SessionGrantWidth = "proven" | "family";

/**
 * The same grant on its bare family surface, or the grant itself when it
 * already names one (or names no directional family at all).
 *
 * Widening is a change of surface and never of pattern: the user is saying
 * "the other direction too", not "more paths".
 */
export function widenGrant(grant: ApprovalGrant): ApprovalGrant {
  const family = surfaceFamilyOf(grant.surface);
  return family === grant.surface
    ? grant
    : { surface: family, pattern: grant.pattern };
}

/**
 * The one direction every grant proves, or `null` when they disagree, any of
 * them proves none, or there are no grants.
 *
 * This is the precise reading of "the gate proved a single direction": a
 * widened grant is offered only when one direction phrase describes the whole
 * approval, so the prompt can name what it is widening from.
 */
export function provenDirectionOf(
  grants: readonly ApprovalGrant[],
): CapabilityDirection | null {
  if (grants.length === 0) return null;
  const direction = capabilityDirectionOf(grants[0].surface);
  if (direction === null) return null;
  return grants.every(
    (grant) => capabilityDirectionOf(grant.surface) === direction,
  )
    ? direction
    : null;
}
