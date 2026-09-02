import type { ForwardedSessionApproval } from "#src/authority/permission-forwarding";

/**
 * Value object for a session-scoped approval: one surface, one-or-more patterns.
 *
 * Owned by gate descriptors and passed to the session store — the runner never
 * needs to know whether there is one pattern or many.
 */
export class SessionApproval {
  private constructor(
    readonly surface: string,
    readonly patterns: readonly string[],
  ) {}

  /** Create an approval for a single pattern (the common case). */
  static single(surface: string, pattern: string): SessionApproval {
    return new SessionApproval(surface, [pattern]);
  }

  /**
   * Create an approval for multiple patterns (e.g. bash external-directory
   * gates that cover several uncovered paths in one prompt).
   */
  static multiple(
    surface: string,
    patterns: readonly string[],
  ): SessionApproval {
    return new SessionApproval(surface, [...patterns]);
  }

  /** Whether this approval carries anything for the session store to record. */
  get isRecordable(): boolean {
    return this.patterns.length > 0;
  }

  /**
   * Plain data shape for relaying this approval on a forwarded request, so the
   * serving node can record the same pattern(s) as a whole-session grant.
   * Returns a defensive copy of the patterns.
   */
  toForwardedData(): ForwardedSessionApproval {
    return { surface: this.surface, patterns: [...this.patterns] };
  }
}
