/**
 * One session-approval grant: a wildcard pattern approved on one surface.
 *
 * A gate proves a direction per accessed path (ADR 0013 §7), so an ask whose
 * paths disagree records a surface per pattern rather than one for all of them
 * (#810). This lives in its own module because both the {@link SessionApproval}
 * value object and the forwarded wire type name it, and those two already
 * import in one direction.
 */
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
