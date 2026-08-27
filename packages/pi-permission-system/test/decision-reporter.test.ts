import { describe, expect, it, vi } from "vitest";

import {
  type DecisionReporter,
  GateDecisionReporter,
} from "#src/decision-reporter";
import {
  PERMISSIONS_DECISION_CHANNEL,
  type PermissionDecisionEvent,
} from "#src/permission-events";
import type { SessionLogger } from "#src/session-logger";

// ── fixtures ───────────────────────────────────────────────────────────────

function makeLogger(): SessionLogger {
  return {
    debug: vi.fn(),
    review: vi.fn(),
    warn: vi.fn(),
  };
}

function makeEvents() {
  return {
    emit: vi.fn(),
    on: vi.fn().mockReturnValue(() => undefined),
  };
}

function makeDecisionEvent(
  overrides: Partial<PermissionDecisionEvent> = {},
): PermissionDecisionEvent {
  return {
    requestId: "perm-00000000-0000-4000-8000-000000000000",
    surface: "read",
    value: "read",
    result: "allow",
    resolution: "policy_allow",
    origin: "global",
    agentName: null,
    matchedPattern: null,
    ...overrides,
  };
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("GateDecisionReporter", () => {
  it("satisfies the DecisionReporter interface", () => {
    const reporter: DecisionReporter = new GateDecisionReporter(
      makeLogger(),
      makeEvents(),
    );
    expect(reporter).toBeDefined();
  });

  describe("writeReviewLog", () => {
    it("delegates to logger.review with event and details", () => {
      const logger = makeLogger();
      const reporter = new GateDecisionReporter(logger, makeEvents());
      reporter.writeReviewLog("permission_request.blocked", { tool: "bash" });
      expect(logger.review).toHaveBeenCalledWith("permission_request.blocked", {
        tool: "bash",
      });
    });

    it("delegates with an empty details object", () => {
      const logger = makeLogger();
      const reporter = new GateDecisionReporter(logger, makeEvents());
      reporter.writeReviewLog("permission_request.session_approved", {});
      expect(logger.review).toHaveBeenCalledWith(
        "permission_request.session_approved",
        {},
      );
    });

    it("does not call emitDecision", () => {
      const events = makeEvents();
      const reporter = new GateDecisionReporter(makeLogger(), events);
      reporter.writeReviewLog("some.event", { key: "val" });
      expect(events.emit).not.toHaveBeenCalled();
    });
  });

  describe("emitDecision", () => {
    it("emits on the PERMISSIONS_DECISION_CHANNEL with the event", () => {
      const events = makeEvents();
      const reporter = new GateDecisionReporter(makeLogger(), events);
      const event = makeDecisionEvent();
      reporter.emitDecision(event);
      expect(events.emit).toHaveBeenCalledWith(
        PERMISSIONS_DECISION_CHANNEL,
        event,
      );
    });

    it("does not call writeReviewLog", () => {
      const logger = makeLogger();
      const reporter = new GateDecisionReporter(logger, makeEvents());
      reporter.emitDecision(makeDecisionEvent());
      expect(logger.review).not.toHaveBeenCalled();
    });

    it("does not propagate a throwing listener", () => {
      const events = makeEvents();
      events.emit.mockImplementation(() => {
        throw new Error("listener boom");
      });
      const reporter = new GateDecisionReporter(makeLogger(), events);
      expect(() => reporter.emitDecision(makeDecisionEvent())).not.toThrow();
    });
  });
});
