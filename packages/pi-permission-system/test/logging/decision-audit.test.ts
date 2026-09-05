import { describe, expect, it, vi } from "vitest";

import { DecisionAudit } from "#src/logging/decision-audit";

function makeAuditLogger() {
  return {
    debug: vi.fn<(event: string, details?: Record<string, unknown>) => void>(),
    warn: vi.fn<(message: string) => void>(),
  };
}

describe("DecisionAudit", () => {
  it("counts allowed, blocked, and error decisions in the summary", () => {
    const audit = new DecisionAudit();
    audit.recordDecision("allow");
    audit.recordDecision("allow");
    audit.recordDecision("block");
    audit.recordError();

    const logger = makeAuditLogger();
    audit.writeSummary(logger);

    expect(logger.debug).toHaveBeenCalledWith("permission.session_summary", {
      toolCalls: 4,
      allowed: 2,
      blocked: 1,
      errors: 1,
    });
  });

  it("emits a zeroed summary when no calls were recorded", () => {
    const audit = new DecisionAudit();
    const logger = makeAuditLogger();

    audit.writeSummary(logger);

    expect(logger.debug).toHaveBeenCalledWith("permission.session_summary", {
      toolCalls: 0,
      allowed: 0,
      blocked: 0,
      errors: 0,
    });
  });

  it("does not warn when the counts are consistent", () => {
    const audit = new DecisionAudit();
    audit.recordDecision("allow");
    audit.recordError();

    const logger = makeAuditLogger();
    audit.writeSummary(logger);

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("warns when the per-call invariant is violated", () => {
    const audit = new DecisionAudit();
    audit.recordDecision("allow");
    // Force a re-opened silent path: bump the private total without a matching
    // sub-total, simulating a future regression that resolves a call without
    // recording its terminal decision.
    (audit as unknown as { toolCalls: number }).toolCalls++;

    const logger = makeAuditLogger();
    audit.writeSummary(logger);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("invariant violated"),
    );
  });
});
