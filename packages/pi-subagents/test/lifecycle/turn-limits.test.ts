/**
 * turn-limits.test.ts
 *
 * Tests for normalizeMaxTurns — the pure turn-limit helper extracted from
 * agent-runner.ts into its own focused home (issue #265).
 *
 * The setter/getter behaviour (clamping, unlimited-marker) is also exercised by:
 *   - test/runtime.test.ts — instance isolation and defaults
 *   - test/lifecycle/subagent-session.test.ts — turn-loop limit integration
 */
import { describe, expect, it } from "vitest";
import {
  normalizeMaxTurns,
  resolveTurnLimits,
  type TurnBudgetPhase,
  TurnBudgetTracker,
  wrappedUpAtTurnLimit,
} from "#src/lifecycle/turn-limits";

describe("normalizeMaxTurns", () => {
  it("treats undefined as unlimited", () => {
    expect(normalizeMaxTurns(undefined)).toBeUndefined();
  });

  it("treats 0 as unlimited", () => {
    expect(normalizeMaxTurns(0)).toBeUndefined();
  });

  it("keeps positive values", () => {
    expect(normalizeMaxTurns(7)).toBe(7);
  });

  it("raises negative values to the minimum of 2", () => {
    expect(normalizeMaxTurns(-3)).toBe(2);
  });

  it("raises 1 to the minimum of 2: one turn to work, one to answer", () => {
    expect(normalizeMaxTurns(1)).toBe(2);
  });

  it("accepts boundary value 2", () => {
    expect(normalizeMaxTurns(2)).toBe(2);
  });

  it("handles large values unchanged", () => {
    expect(normalizeMaxTurns(10_000)).toBe(10_000);
  });
});

describe("resolveTurnLimits", () => {
  describe("the ceiling", () => {
    it("takes the per-call maxTurns over the agent's and the default", () => {
      expect(resolveTurnLimits({ maxTurns: 3, defaultMaxTurns: 9 }, 7).maxTurns).toBe(3);
    });

    it("falls back to the agent's maxTurns when no per-call one is set", () => {
      expect(resolveTurnLimits({ defaultMaxTurns: 9 }, 7).maxTurns).toBe(7);
    });

    it("falls back to the default when neither the call nor the agent sets one", () => {
      expect(resolveTurnLimits({ defaultMaxTurns: 9 }, undefined).maxTurns).toBe(9);
    });

    it("is unlimited when nothing sets one", () => {
      expect(resolveTurnLimits(undefined, undefined)).toEqual({ maxTurns: undefined, wrapUpTurns: 2 });
    });

    it("raises a ceiling below the minimum to it", () => {
      expect(resolveTurnLimits({ maxTurns: 1 }, undefined).maxTurns).toBe(2);
    });
  });

  describe("the wrap-up turns", () => {
    it("takes the requested count", () => {
      expect(resolveTurnLimits({ wrapUpTurns: 3 }, undefined).wrapUpTurns).toBe(3);
    });

    it("defaults to the setting's default of 2", () => {
      expect(resolveTurnLimits({ maxTurns: 5 }, undefined).wrapUpTurns).toBe(2);
    });
  });
});

describe("wrappedUpAtTurnLimit", () => {
  const statuses = ["queued", "running", "completed", "aborted", "stopped", "error"] as const;
  const phases: TurnBudgetPhase[] = ["within", "warned", "exhausted"];

  for (const status of statuses) {
    for (const phase of phases) {
      const expected = status === "completed" && phase === "warned";
      it(`is ${expected} for ${status} with phase ${phase}`, () => {
        expect(wrappedUpAtTurnLimit({ status, turnBudget: { maxTurns: 2, used: 3, phase } })).toBe(expected);
      });
    }

    it(`is false for ${status} with no budget`, () => {
      expect(wrappedUpAtTurnLimit({ status })).toBe(false);
    });
  }
});

/** A successful turn that ran a tool, so the agent loop continues. */
const WORKING_TURN = { failed: false, ranTools: true };
/** A successful turn with no tool calls: the agent's final answer. */
const ANSWER_TURN = { failed: false, ranTools: false };
/** A turn whose response errored or was aborted. */
const FAILED_TURN = { failed: true, ranTools: false };

/** Run `n` working turns through the tracker, returning each turn's action. */
function work(tracker: TurnBudgetTracker, n: number) {
  return Array.from({ length: n }, () => tracker.onTurnEnd(WORKING_TURN));
}

describe("TurnBudgetTracker", () => {
  describe("counting", () => {
    it("starts with no turns used", () => {
      expect(new TurnBudgetTracker({ maxTurns: 5, wrapUpTurns: 2 }).budget).toEqual({
        used: 0,
        maxTurns: 5,
        phase: "within",
      });
    });

    it("counts successful turns, with or without tool calls", () => {
      const tracker = new TurnBudgetTracker({ maxTurns: 10, wrapUpTurns: 2 });
      tracker.onTurnEnd(WORKING_TURN);
      tracker.onTurnEnd(ANSWER_TURN);
      expect(tracker.budget.used).toBe(2);
    });

    it("does not count a turn whose response failed", () => {
      const tracker = new TurnBudgetTracker({ maxTurns: 10, wrapUpTurns: 2 });
      tracker.onTurnEnd(WORKING_TURN);
      expect(tracker.onTurnEnd(FAILED_TURN)).toBeUndefined();
      expect(tracker.budget.used).toBe(1);
    });

    it("reports the turns left before the ceiling", () => {
      const tracker = new TurnBudgetTracker({ maxTurns: 5, wrapUpTurns: 2 });
      work(tracker, 2);
      expect(tracker.remaining).toBe(3);
    });
  });

  describe("warning", () => {
    it("warns once, after the turn that leaves wrapUpTurns turns", () => {
      const tracker = new TurnBudgetTracker({ maxTurns: 5, wrapUpTurns: 2 });
      expect(work(tracker, 4)).toEqual([undefined, undefined, "warn", undefined]);
      expect(tracker.budget).toEqual({ used: 4, maxTurns: 5, phase: "warned" });
    });

    it("defers the warning past a turn that ran no tools", () => {
      const tracker = new TurnBudgetTracker({ maxTurns: 6, wrapUpTurns: 3 });
      work(tracker, 2);
      expect(tracker.onTurnEnd(ANSWER_TURN)).toBeUndefined();
      expect(tracker.budget.phase).toBe("within");
      expect(tracker.onTurnEnd(WORKING_TURN)).toBe("warn");
    });

    it("does not warn before the first turn when turns remain beyond the reserve", () => {
      const tracker = new TurnBudgetTracker({ maxTurns: 5, wrapUpTurns: 2 });
      expect(tracker.warnBeforeFirstTurn()).toBe(false);
      expect(tracker.budget.phase).toBe("within");
    });

    it("warns before the first turn when the reserve covers the whole budget", () => {
      const tracker = new TurnBudgetTracker({ maxTurns: 2, wrapUpTurns: 2 });
      expect(tracker.warnBeforeFirstTurn()).toBe(true);
      expect(tracker.budget.phase).toBe("warned");
      expect(tracker.onTurnEnd(ANSWER_TURN)).toBeUndefined();
    });

    it("warns before the first turn when the reserve exceeds the budget", () => {
      const tracker = new TurnBudgetTracker({ maxTurns: 2, wrapUpTurns: 3 });
      expect(tracker.warnBeforeFirstTurn()).toBe(true);
    });
  });

  describe("ceiling", () => {
    it("stops after the ceiling turn when that turn ran tools", () => {
      const tracker = new TurnBudgetTracker({ maxTurns: 3, wrapUpTurns: 1 });
      expect(work(tracker, 3)).toEqual([undefined, "warn", "stop"]);
      expect(tracker.budget).toEqual({ used: 3, maxTurns: 3, phase: "exhausted" });
    });

    it("lets a ceiling turn with no tool calls end the run on its own", () => {
      const tracker = new TurnBudgetTracker({ maxTurns: 3, wrapUpTurns: 1 });
      work(tracker, 2);
      expect(tracker.onTurnEnd(ANSWER_TURN)).toBeUndefined();
      expect(tracker.budget).toEqual({ used: 3, maxTurns: 3, phase: "warned" });
    });
  });

  describe("turn start", () => {
    it("lets a turn start within the budget", () => {
      const tracker = new TurnBudgetTracker({ maxTurns: 3, wrapUpTurns: 1 });
      work(tracker, 2);
      expect(tracker.onTurnStart()).toBeUndefined();
    });

    it("stops a turn starting past the ceiling", () => {
      const tracker = new TurnBudgetTracker({ maxTurns: 3, wrapUpTurns: 1 });
      work(tracker, 2);
      tracker.onTurnEnd(ANSWER_TURN);
      expect(tracker.onTurnStart()).toBe("stop");
      expect(tracker.budget.phase).toBe("exhausted");
    });

    it("does not stop twice once the ceiling turn already stopped the run", () => {
      const tracker = new TurnBudgetTracker({ maxTurns: 3, wrapUpTurns: 1 });
      work(tracker, 3);
      expect(tracker.onTurnStart()).toBeUndefined();
    });
  });

  describe("unlimited", () => {
    it("counts turns but never warns or stops", () => {
      const tracker = new TurnBudgetTracker({ wrapUpTurns: 2 });
      expect(tracker.warnBeforeFirstTurn()).toBe(false);
      expect(work(tracker, 50).every((action) => action === undefined)).toBe(true);
      expect(tracker.onTurnStart()).toBeUndefined();
      expect(tracker.budget).toEqual({ used: 50, phase: "within" });
      expect(tracker.remaining).toBeUndefined();
    });
  });

  it("hands out a copy of its budget", () => {
    const tracker = new TurnBudgetTracker({ maxTurns: 5, wrapUpTurns: 2 });
    const snapshot = tracker.budget;
    tracker.onTurnEnd(WORKING_TURN);
    expect(snapshot.used).toBe(0);
  });
});
