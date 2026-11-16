import { describe, expect, it, vi } from "vitest";
import { SubagentRun } from "#src/lifecycle/subagent-run";
import type { SubagentStatus } from "#src/lifecycle/subagent-state";
import type { TurnBudget } from "#src/lifecycle/turn-limits";

const ALL_STATUSES: SubagentStatus[] = ["queued", "running", "completed", "aborted", "stopped", "error"];

/** A run seeded in the given status. */
function runIn(status: SubagentStatus, completedAt?: number): SubagentRun {
	return new SubagentRun("initial", true, { status, completedAt });
}

/** A run started with the given caller signal (none by default). */
function startedRun(callerSignal?: AbortSignal, onCallerAbort: () => void = vi.fn()): SubagentRun {
	const run = new SubagentRun("initial", false);
	run.start(1000, callerSignal, onCallerAbort);
	return run;
}

describe("SubagentRun", () => {
	it("carries the kind it was born with", () => {
		expect(new SubagentRun("initial", false).kind).toBe("initial");
		expect(new SubagentRun("resume", false).kind).toBe("resume");
	});

	it("carries the mode it was born with", () => {
		expect(new SubagentRun("resume", true).inBackground).toBe(true);
		expect(new SubagentRun("resume", false).inBackground).toBe(false);
	});

	describe("its own lever", () => {
		it("starts unaborted", () => {
			const run = startedRun();
			expect(run.aborted).toBe(false);
			expect(run.signal.aborted).toBe(false);
		});

		it("abort() fires the signal handed to the turn loop", () => {
			const run = startedRun();
			run.abort();
			expect(run.aborted).toBe(true);
			expect(run.signal.aborted).toBe(true);
		});

		it("gives each run a lever of its own", () => {
			const first = startedRun();
			first.abort();
			const second = startedRun();
			expect(second.signal).not.toBe(first.signal);
			expect(second.aborted).toBe(false);
		});

		it("exists before the run starts", () => {
			const run = new SubagentRun("initial", true);
			expect(run.aborted).toBe(false);
			expect(run.signal.aborted).toBe(false);
		});
	});

	describe("the caller's signal", () => {
		it("calls onCallerAbort when the signal fires", () => {
			const controller = new AbortController();
			const onCallerAbort = vi.fn();
			startedRun(controller.signal, onCallerAbort);
			controller.abort();
			expect(onCallerAbort).toHaveBeenCalledOnce();
		});

		it("is born aborted when the signal has already fired", () => {
			const run = startedRun(AbortSignal.abort());
			expect(run.aborted).toBe(true);
			expect(run.signal.aborted).toBe(true);
		});

		it("does not call onCallerAbort for a signal that had already fired", () => {
			const onCallerAbort = vi.fn();
			const run = startedRun(AbortSignal.abort(), onCallerAbort);
			run.release();
			expect(onCallerAbort).not.toHaveBeenCalled();
		});

		it("accepts no signal", () => {
			expect(() => startedRun()).not.toThrow();
		});

		it("is wired only once the run starts", () => {
			const controller = new AbortController();
			const onCallerAbort = vi.fn();
			const run = new SubagentRun("initial", true);
			// The signal fires while the run is still queued: nothing is listening yet.
			controller.abort();
			expect(onCallerAbort).not.toHaveBeenCalled();
			expect(run.aborted).toBe(false);

			run.start(1000, controller.signal, onCallerAbort);

			expect(run.aborted).toBe(true);
			expect(onCallerAbort).not.toHaveBeenCalled();
		});

		it("release() detaches the signal so onCallerAbort is not called after release", () => {
			const controller = new AbortController();
			const onCallerAbort = vi.fn();
			const run = startedRun(controller.signal, onCallerAbort);
			run.release();
			controller.abort();
			expect(onCallerAbort).not.toHaveBeenCalled();
		});
	});

	describe("the observer subscription", () => {
		it("calls the unsubscribe on release", () => {
			const run = startedRun();
			const unsubscribe = vi.fn();
			run.attachObserver(unsubscribe);
			run.release();
			expect(unsubscribe).toHaveBeenCalledOnce();
		});

		it("clears the handle so a second release does not double-call", () => {
			const run = startedRun();
			const unsubscribe = vi.fn();
			run.attachObserver(unsubscribe);
			run.release();
			run.release();
			expect(unsubscribe).toHaveBeenCalledOnce();
		});

		it("release is idempotent with no handles attached", () => {
			const run = startedRun();
			expect(() => {
				run.release();
				run.release();
			}).not.toThrow();
		});
	});

	describe("birth", () => {
		it("is queued, with no result, error, or completion", () => {
			const run = new SubagentRun("initial", true);
			expect([run.status, run.result, run.error, run.completedAt, run.stoppedWhileQueued])
				.toEqual(["queued", undefined, undefined, undefined, false]);
		});

		it("defaults startedAt to Date.now()", () => {
			const before = Date.now();
			const run = new SubagentRun("initial", true);
			const after = Date.now();
			expect(run.startedAt).toBeGreaterThanOrEqual(before);
			expect(run.startedAt).toBeLessThanOrEqual(after);
		});

		it("seeds the outcome fields from init", () => {
			const run = new SubagentRun("initial", true, {
				status: "completed",
				result: "done",
				error: "oops",
				stoppedWhileQueued: true,
				startedAt: 1000,
				completedAt: 2000,
			});
			expect([run.status, run.result, run.error, run.stoppedWhileQueued, run.startedAt, run.completedAt])
				.toEqual(["completed", "done", "oops", true, 1000, 2000]);
		});

		it("start() transitions to running at the given time", () => {
			const run = new SubagentRun("initial", true, { startedAt: 1000 });
			run.start(2000, undefined, vi.fn());
			expect([run.status, run.startedAt]).toEqual(["running", 2000]);
		});
	});

	describe("markCompleted", () => {
		it("sets status, result, and completedAt", () => {
			const run = runIn("running");
			run.markCompleted("all done", 5000);
			expect([run.status, run.result, run.completedAt]).toEqual(["completed", "all done", 5000]);
		});

		it("defaults completedAt to Date.now() when not provided", () => {
			const run = runIn("running");
			const before = Date.now();
			run.markCompleted("done");
			const after = Date.now();
			expect(run.completedAt).toBeGreaterThanOrEqual(before);
			expect(run.completedAt).toBeLessThanOrEqual(after);
		});

		it("preserves existing completedAt (??= semantics)", () => {
			const run = runIn("running", 1000);
			run.markCompleted("done", 9999);
			expect(run.completedAt).toBe(1000);
		});

		it("preserves status when already stopped, but still sets result", () => {
			const run = runIn("stopped", 1000);
			run.markCompleted("late result", 2000);
			expect([run.status, run.result, run.completedAt]).toEqual(["stopped", "late result", 1000]);
		});
	});

	describe("markAborted", () => {
		it("sets status to 'aborted' with result and completedAt", () => {
			const run = runIn("running");
			run.markAborted("partial result", 3000);
			expect([run.status, run.result, run.completedAt]).toEqual(["aborted", "partial result", 3000]);
		});

		it("preserves status when already stopped, but still sets result", () => {
			const run = runIn("stopped", 500);
			run.markAborted("partial", 2000);
			expect([run.status, run.result, run.completedAt]).toEqual(["stopped", "partial", 500]);
		});
	});

	describe("markError", () => {
		it("sets status to 'error' and formats Error objects to .message", () => {
			const run = runIn("running");
			run.markError(new Error("something broke"), 6000);
			expect([run.status, run.error, run.completedAt]).toEqual(["error", "something broke", 6000]);
		});

		it("formats non-Error values with String()", () => {
			const run = runIn("running");
			run.markError(42, 6000);
			expect(run.error).toBe("42");
		});

		it("preserves status when already stopped, but still sets error", () => {
			const run = runIn("stopped", 1000);
			run.markError(new Error("late error"), 2000);
			expect([run.status, run.error, run.completedAt]).toEqual(["stopped", "late error", 1000]);
		});

		it("preserves existing completedAt (??= semantics)", () => {
			const run = runIn("running", 1000);
			run.markError(new Error("err"), 9999);
			expect(run.completedAt).toBe(1000);
		});
	});

	describe("markStopped", () => {
		it("sets status to 'stopped' and completedAt", () => {
			const run = runIn("running");
			run.markStopped(7000);
			expect([run.status, run.completedAt]).toEqual(["stopped", 7000]);
		});

		it("defaults completedAt to Date.now() when not provided", () => {
			const run = runIn("running");
			const before = Date.now();
			run.markStopped();
			const after = Date.now();
			expect(run.completedAt).toBeGreaterThanOrEqual(before);
			expect(run.completedAt).toBeLessThanOrEqual(after);
		});

		it("overwrites any previous status: no guard", () => {
			const run = runIn("completed");
			run.markStopped(8000);
			expect(run.status).toBe("stopped");
		});

		it("leaves stoppedWhileQueued false: the run had started", () => {
			const run = runIn("running");
			run.markStopped(8000);
			expect(run.stoppedWhileQueued).toBe(false);
		});
	});

	describe("stopQueued", () => {
		it("stops a queued run and records that it never started", () => {
			const run = runIn("queued");
			run.stopQueued(7000);
			expect([run.status, run.completedAt, run.stoppedWhileQueued]).toEqual(["stopped", 7000, true]);
		});

		it("defaults completedAt to Date.now() when not provided", () => {
			const run = runIn("queued");
			const before = Date.now();
			run.stopQueued();
			const after = Date.now();
			expect(run.completedAt).toBeGreaterThanOrEqual(before);
			expect(run.completedAt).toBeLessThanOrEqual(after);
		});

		it("stops an already-running run without claiming it never started", () => {
			const run = runIn("running");
			run.stopQueued(7000);
			expect([run.status, run.stoppedWhileQueued]).toEqual(["stopped", false]);
		});
	});

	describe("turn budget", () => {
		const WITHIN: TurnBudget = { maxTurns: 5, used: 1, phase: "within" };
		const WARNED: TurnBudget = { maxTurns: 5, used: 3, phase: "warned" };
		const EXHAUSTED: TurnBudget = { maxTurns: 5, used: 5, phase: "exhausted" };

		it("has no budget until the run's turn loop reports one", () => {
			expect(new SubagentRun("initial", true).turnBudget).toBeUndefined();
		});

		it("seeds the budget from init", () => {
			expect(new SubagentRun("initial", true, { turnBudget: WARNED }).turnBudget).toEqual(WARNED);
		});

		it("records each budget the running turn loop reports", () => {
			const run = runIn("running");
			run.setTurnBudget(WITHIN);
			expect(run.turnBudget).toEqual(WITHIN);
			run.setTurnBudget(WARNED);
			expect(run.turnBudget).toEqual(WARNED);
		});

		it("keeps the live budget through a terminal transition", () => {
			const run = runIn("running");
			run.setTurnBudget(EXHAUSTED);
			run.markAborted("partial", 5000);
			expect(run.turnBudget).toEqual(EXHAUSTED);
		});

		it("a stop during the warned phase keeps stopped and the budget the loop reached", () => {
			const run = runIn("running");
			run.setTurnBudget(WARNED);
			run.markStopped(500);
			run.markCompleted("late", 2000);
			expect([run.status, run.turnBudget]).toEqual(["stopped", WARNED]);
		});

		it("is the run's own: another run starts with none", () => {
			const first = runIn("running");
			first.setTurnBudget(WARNED);
			expect(new SubagentRun("resume", true).turnBudget).toBeUndefined();
		});
	});

	describe("run updates", () => {
		it("starts with none", () => {
			expect(new SubagentRun("initial", true).runUpdates).toEqual([]);
		});

		it("keeps the order the child sent them in", () => {
			const run = runIn("running");

			run.recordUpdate("The bug is in the retry wrapper.");
			run.recordUpdate("The fixture is stale too.");

			expect(run.runUpdates).toEqual(["The bug is in the retry wrapper.", "The fixture is stale too."]);
		});

		it("seeds owed updates from init, in order", () => {
			const run = new SubagentRun("initial", true, { runUpdates: ["First.", "Second."] });
			expect(run.runUpdates).toEqual(["First.", "Second."]);
		});

		it("is the run's own: another run starts with none owed", () => {
			const first = runIn("running");
			first.recordUpdate("From the first run.");
			expect(new SubagentRun("resume", true).runUpdates).toEqual([]);
		});

		describe("the announcement latch", () => {
			it("omits a message the announcement channel delivered", () => {
				const run = runIn("running");
				run.recordUpdate("Announced already.");
				run.recordUpdate("Still owed to a carrier.");

				run.markUpdateAnnounced("Announced already.");

				expect(run.runUpdates).toEqual(["Still owed to a carrier."]);
			});

			it("marks the first unannounced copy, leaving a later duplicate owed", () => {
				const run = runIn("running");
				run.recordUpdate("Same finding twice.");
				run.recordUpdate("Same finding twice.");

				run.markUpdateAnnounced("Same finding twice.");

				expect(run.runUpdates).toEqual(["Same finding twice."]);
			});

			it("ignores a message this run never produced", () => {
				const run = runIn("running");
				run.recordUpdate("From this run.");

				run.markUpdateAnnounced("From another run.");

				expect(run.runUpdates).toEqual(["From this run."]);
			});
		});
	});

	describe("question and workspace notice", () => {
		it("start with none, or what init seeds", () => {
			expect([new SubagentRun("initial", true).pendingQuestion, new SubagentRun("initial", true).workspaceNotice])
				.toEqual([undefined, undefined]);
			const seeded = new SubagentRun("initial", true, { pendingQuestion: "Which one?", workspaceNotice: "Saved." });
			expect([seeded.pendingQuestion, seeded.workspaceNotice]).toEqual(["Which one?", "Saved."]);
		});

		it("records the question, and drops it on undefined", () => {
			const run = runIn("running");
			run.setPendingQuestion("Which one?");
			expect(run.pendingQuestion).toBe("Which one?");
			run.setPendingQuestion(undefined);
			expect(run.pendingQuestion).toBeUndefined();
		});

		it("a replaced run reports no open question: the resume that replaced it is the answer", () => {
			const run = runIn("completed");
			run.setPendingQuestion("Which one?");

			run.markReplaced();

			expect([run.replaced, run.pendingQuestion]).toEqual([true, undefined]);
		});

		it("is not replaced until a resume replaces it", () => {
			const run = new SubagentRun("initial", true, { pendingQuestion: "Which one?" });
			expect([run.replaced, run.pendingQuestion]).toEqual([false, "Which one?"]);
		});

		it("records the workspace notice", () => {
			const run = runIn("error");
			run.setWorkspaceNotice("Saved to branch x.");
			expect(run.workspaceNotice).toBe("Saved to branch x.");
		});
	});

	describe("classification predicates delegate to the status-level functions", () => {
		const active = new Set<SubagentStatus>(["running", "queued"]);
		const terminalError = new Set<SubagentStatus>(["error", "stopped", "aborted"]);
		const running = new Set<SubagentStatus>(["running"]);

		for (const status of ALL_STATUSES) {
			it(`"${status}": isActive=${active.has(status)}, isTerminalError=${terminalError.has(status)}, isRunning=${running.has(status)}, canBeSteered=${running.has(status)}`, () => {
				const run = runIn(status);
				expect([run.isActive(), run.isTerminalError(), run.isRunning(), run.canBeSteered()])
					.toEqual([active.has(status), terminalError.has(status), running.has(status), running.has(status)]);
			});
		}
	});

	describe("consumption", () => {
		it("defaults to not consumed", () => {
			const run = new SubagentRun("initial", true);
			expect(run.consumed).toBe(false);
			expect(run.consumedAt).toBeUndefined();
		});

		it("markConsumed sets consumedAt and flips consumed true", () => {
			const run = new SubagentRun("initial", true);
			run.markConsumed(5000);
			expect(run.consumed).toBe(true);
			expect(run.consumedAt).toBe(5000);
		});

		it("markConsumed defaults consumedAt to Date.now() when not provided", () => {
			const run = new SubagentRun("initial", true);
			const before = Date.now();
			run.markConsumed();
			const after = Date.now();
			expect(run.consumedAt).toBeGreaterThanOrEqual(before);
			expect(run.consumedAt).toBeLessThanOrEqual(after);
		});

		it("markConsumed keeps the first collection time (idempotent ??=)", () => {
			const run = new SubagentRun("initial", true);
			run.markConsumed(5000);
			run.markConsumed(9999);
			expect(run.consumedAt).toBe(5000);
		});

		it("seeds consumedAt from the constructor", () => {
			const run = new SubagentRun("initial", true, { consumedAt: 4200 });
			expect(run.consumed).toBe(true);
			expect(run.consumedAt).toBe(4200);
		});

		it("is the run's own: another run starts unconsumed", () => {
			const first = new SubagentRun("initial", true);
			first.markConsumed(5000);
			expect(new SubagentRun("resume", true).consumed).toBe(false);
		});
	});

	describe("carrier claims", () => {
		it("defaults to unclaimed", () => {
			expect(new SubagentRun("initial", true).claimed).toBe(false);
		});

		it("claim marks the outcome as owned by a carrier", () => {
			const run = new SubagentRun("initial", true);
			run.claim();
			expect(run.claimed).toBe(true);
		});

		it("is independent of consumption", () => {
			const run = new SubagentRun("initial", true);
			const claim = run.claim();
			expect(run.consumed).toBe(false);
			run.markConsumed(5000);
			claim.release();
			expect(run.claimed).toBe(false);
			expect(run.consumedAt).toBe(5000);
		});

		it("keeps the outcome claimed while another holder remains", () => {
			const run = new SubagentRun("initial", true);
			const first = run.claim();
			run.claim();

			first.release();

			expect(run.claimed).toBe(true);
		});

		it("hands responsibility back once every holder released", () => {
			const run = new SubagentRun("initial", true);
			const first = run.claim();
			const second = run.claim();

			second.release();
			first.release();

			expect(run.claimed).toBe(false);
		});

		it("releasing one handle twice drops only its own claim", () => {
			const run = new SubagentRun("initial", true);
			const first = run.claim();
			run.claim();

			first.release();
			first.release();

			expect(run.claimed).toBe(true);
		});

		it("is the run's own: another run starts unclaimed", () => {
			const first = new SubagentRun("initial", true);
			first.claim();
			expect(new SubagentRun("resume", true).claimed).toBe(false);
		});
	});

	describe("release", () => {
		it("clears both the signal listener and the observer unsubscribe", () => {
			const controller = new AbortController();
			const onCallerAbort = vi.fn();
			const unsubscribe = vi.fn();
			const run = startedRun(controller.signal, onCallerAbort);
			run.attachObserver(unsubscribe);
			run.release();
			controller.abort();
			expect(onCallerAbort).not.toHaveBeenCalled();
			expect(unsubscribe).toHaveBeenCalledOnce();
		});
	});
});
