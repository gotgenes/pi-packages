import type { ForwardedSessionApproval } from "#src/authority/permission-forwarding";
import {
  type ApprovalGrant,
  type SessionGrantWidth,
  widenGrant,
} from "./approval-grant";

/**
 * Value object for a session-scoped approval: one or more
 * {@link ApprovalGrant}s, each pairing a pattern with the surface it was
 * proven on.
 *
 * Owned by gate descriptors and passed to the session store — the runner never
 * needs to know how many grants an approval carries, and the store records
 * each on the surface the grant itself names rather than one shared by all
 * (#810).
 */
export class SessionApproval {
  private constructor(readonly grants: readonly ApprovalGrant[]) {}

  /** Create an approval for a single pattern (the common case). */
  static single(surface: string, pattern: string): SessionApproval {
    return new SessionApproval([{ surface, pattern }]);
  }

  /**
   * Create an approval from grants that may name different surfaces (e.g. a
   * bash external-directory ask whose uncovered paths proved different
   * directions). Returns a defensive copy.
   */
  static forGrants(grants: readonly ApprovalGrant[]): SessionApproval {
    return new SessionApproval([...grants]);
  }

  /** Whether this approval carries anything for the session store to record. */
  get isRecordable(): boolean {
    return this.grants.length > 0;
  }

  /**
   * This approval as recorded at `width`.
   *
   * The runner holds a width and an approval and tells the approval to produce
   * itself — it never inspects a grant's surface. Each grant is folded
   * individually, so an approval whose patterns proved different directions
   * keeps one grant per pattern (#810) at either width.
   */
  atWidth(width: SessionGrantWidth): SessionApproval {
    return width === "proven"
      ? this
      : new SessionApproval(this.grants.map(widenGrant));
  }

  /**
   * Plain data shape for relaying this approval on a forwarded request, so the
   * serving node can record the same grants as a whole-session grant.
   * Returns a defensive copy.
   */
  toForwardedData(): ForwardedSessionApproval {
    return { grants: [...this.grants] };
  }
}
