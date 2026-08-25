import { surfaceFamilyMembers } from "#src/access-intent/path-surfaces";
import type { Ruleset } from "./rule";
import type { SessionApproval } from "./session-approval";
import type { SessionApprovalRecorder } from "./session-approval-recorder";

/**
 * Ephemeral in-memory store of session-scoped permission approvals.
 *
 * Each approval is stored as a `Rule` with `action: "allow"`, making the
 * ruleset directly usable with `evaluate()` — no custom matching engine needed.
 *
 * Cleared on session_shutdown — never persisted to disk.
 */
export class SessionRules implements SessionApprovalRecorder {
  private rules: Ruleset = [];

  /**
   * Record a wildcard pattern as approved for the given surface.
   *
   * A session approval is a policy source under ADR 0013 §9, so it expands the
   * same way a config key does: an approval on a bare family surface becomes
   * one rule per directional member, and one on a directional surface stays a
   * single rule. Without the expansion an approval would sit on a surface no
   * query names, and the next ask for the same path would prompt again.
   */
  approve(surface: string, pattern: string): void {
    for (const target of surfaceFamilyMembers(surface) ?? [surface]) {
      this.rules.push({
        surface: target,
        pattern,
        action: "allow",
        layer: "session",
        origin: "session",
      });
    }
  }

  /** Return a defensive copy of the current session ruleset. */
  getRuleset(): Ruleset {
    return [...this.rules];
  }

  /**
   * Record all patterns from a `SessionApproval` value object.
   *
   * The loop lives here so callers never need to know whether an approval
   * carries one pattern or many — they just tell the store to record it.
   */
  recordSessionApproval(approval: SessionApproval): void {
    for (const pattern of approval.patterns) {
      this.approve(approval.surface, pattern);
    }
  }

  /** Remove all session approvals. */
  clear(): void {
    this.rules = [];
  }
}
