/**
 * Records the per-call terminal decision so an evaluated-and-allowed call is
 * distinguishable from a never-evaluated one. The fail-closed boundary owns the
 * recorder and calls exactly one of `recordDecision` / `recordError` per call.
 */
export interface DecisionRecorder {
  /** Record a terminal allow/block decision (also bumps the tool-call count). */
  recordDecision(action: "allow" | "block"): void;
  /** Record a gate error that blocked fail-closed (also bumps the count). */
  recordError(): void;
}

/** Narrow logging surface the summary needs: a debug line and a warning. */
export interface AuditLogger {
  debug(event: string, details?: Record<string, unknown>): void;
  warn(message: string): void;
}

/** Narrow surface the session-shutdown handler depends on. */
export interface DecisionSummaryWriter {
  writeSummary(logger: AuditLogger): void;
}

/**
 * In-process, per-session decision counters.
 *
 * The boundary produces exactly one terminal decision per tool call, so
 * `toolCalls` must always equal `allowed + blocked + errors`. `writeSummary`
 * emits the counters on `session_shutdown` and flags any mismatch as a cheap
 * structural self-check — a mismatch means a code path re-opened a silent
 * (never-recorded) exit.
 */
export class DecisionAudit implements DecisionRecorder {
  private toolCalls = 0;
  private allowed = 0;
  private blocked = 0;
  private errors = 0;

  recordDecision(action: "allow" | "block"): void {
    this.toolCalls++;
    if (action === "allow") {
      this.allowed++;
    } else {
      this.blocked++;
    }
  }

  recordError(): void {
    this.toolCalls++;
    this.errors++;
  }

  /**
   * Emit one `permission.session_summary` debug line with the counters. When
   * `toolCalls !== allowed + blocked + errors`, also emit a warning — the
   * invariant violation means a tool call resolved without a recorded terminal
   * decision (a re-opened silent path).
   */
  writeSummary(logger: AuditLogger): void {
    const counts = {
      toolCalls: this.toolCalls,
      allowed: this.allowed,
      blocked: this.blocked,
      errors: this.errors,
    };
    logger.debug("permission.session_summary", counts);
    if (this.toolCalls !== this.allowed + this.blocked + this.errors) {
      logger.warn(
        `[pi-permission-system] decision audit invariant violated: ${this.toolCalls} tool calls != ` +
          `${this.allowed} allowed + ${this.blocked} blocked + ${this.errors} errors. ` +
          "A tool call resolved without a recorded terminal decision.",
      );
    }
  }
}
