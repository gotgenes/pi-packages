import { describe, expect, it } from "vitest";
import {
	isActiveStatus,
	isRunningStatus,
	isTerminalErrorStatus,
	SubagentState,
	type SubagentStateInit,
	type SubagentStatus,
} from "#src/lifecycle/subagent-state";
import type { TurnBudget } from "#src/lifecycle/turn-limits";

const ALL_STATUSES: SubagentStatus[] = [
	"queued",
	"running",
	"completed",
	"aborted",
	"stopped",
	"error",
];

describe("SubagentState — constructor", () => {
	it("defaults status to 'queued'", () => {
		const state = new SubagentState();
		expect(state.status).toBe("queued");
	});

	it("defaults startedAt to Date.now() when not provided", () => {
		const before = Date.now();
		const state = new SubagentState();
		const after = Date.now();
		expect(state.startedAt).toBeGreaterThanOrEqual(before);
		expect(state.startedAt).toBeLessThanOrEqual(after);
	});

	it("defaults numeric counters to zero", () => {
		const state = new SubagentState();
		expect(state.toolUses).toBe(0);
		expect(state.compactionCount).toBe(0);
		expect(state.lifetimeUsage).toEqual({ input: 0, output: 0, cacheWrite: 0 });
	});

	it("defaults live-activity fields", () => {
		const state = new SubagentState();
		expect(state.responseText).toBe("");
		expect(state.activeTools.size).toBe(0);
	});

	it("passes through optional transition fields", () => {
		const state = new SubagentState({
			status: "completed",
			result: "done",
			error: "oops",
			startedAt: 1000,
			completedAt: 2000,
		});
		expect(state.status).toBe("completed");
		expect(state.result).toBe("done");
		expect(state.error).toBe("oops");
		expect(state.startedAt).toBe(1000);
		expect(state.completedAt).toBe(2000);
	});

	it("leaves optional fields undefined when not provided", () => {
		const state = new SubagentState();
		expect(state.result).toBeUndefined();
		expect(state.error).toBeUndefined();
		expect(state.completedAt).toBeUndefined();
	});
});

describe("SubagentState — constructor full-value seeding", () => {
	it("seeds stats fields", () => {
		const state = new SubagentState({
			toolUses: 4,
			lifetimeUsage: { input: 100, output: 200, cacheWrite: 30 },
			compactionCount: 2,
		});
		expect(state.toolUses).toBe(4);
		expect(state.lifetimeUsage).toEqual({ input: 100, output: 200, cacheWrite: 30 });
		expect(state.compactionCount).toBe(2);
	});

	it("copies lifetimeUsage so mutating the source does not change state", () => {
		const source = { input: 10, output: 20, cacheWrite: 5 };
		const state = new SubagentState({ lifetimeUsage: source });
		source.input = 999;
		expect(state.lifetimeUsage).toEqual({ input: 10, output: 20, cacheWrite: 5 });
	});

	it("seeds live-activity fields", () => {
		const state = new SubagentState({
			activeTools: ["read", "bash"],
			responseText: "partial output",
		});
		expect([...state.activeTools.values()]).toEqual(["read", "bash"]);
		expect(state.responseText).toBe("partial output");
	});

	it("seeds activeTools by name and stays removable by name", () => {
		const state = new SubagentState({ activeTools: ["read", "read"] });
		expect(state.activeTools.size).toBe(2);
		state.removeActiveTool("read");
		expect(state.activeTools.size).toBe(1);
		expect([...state.activeTools.values()]).toEqual(["read"]);
	});
});

describe("SubagentState — markRunning", () => {
	it("sets status to 'running' and updates startedAt", () => {
		const state = new SubagentState({ status: "queued", startedAt: 1000 });
		state.markRunning(2000);
		expect(state.status).toBe("running");
		expect(state.startedAt).toBe(2000);
	});
});

describe("SubagentState — markCompleted", () => {
	it("sets status, result, and completedAt", () => {
		const state = new SubagentState({ status: "running" });
		state.markCompleted("all done", 5000);
		expect(state.status).toBe("completed");
		expect(state.result).toBe("all done");
		expect(state.completedAt).toBe(5000);
	});

	it("defaults completedAt to Date.now() when not provided", () => {
		const state = new SubagentState({ status: "running" });
		const before = Date.now();
		state.markCompleted("done");
		const after = Date.now();
		expect(state.completedAt).toBeGreaterThanOrEqual(before);
		expect(state.completedAt).toBeLessThanOrEqual(after);
	});

	it("preserves existing completedAt (??= semantics)", () => {
		const state = new SubagentState({ status: "running", completedAt: 1000 });
		state.markCompleted("done", 9999);
		expect(state.completedAt).toBe(1000);
	});

	it("preserves status when already stopped, but still sets result and completedAt", () => {
		const state = new SubagentState({ status: "stopped", completedAt: 1000 });
		state.markCompleted("late result", 2000);
		expect(state.status).toBe("stopped");
		expect(state.result).toBe("late result");
		expect(state.completedAt).toBe(1000);
	});
});

describe("SubagentState — markAborted", () => {
	it("sets status to 'aborted' with result and completedAt", () => {
		const state = new SubagentState({ status: "running" });
		state.markAborted("partial result", 3000);
		expect(state.status).toBe("aborted");
		expect(state.result).toBe("partial result");
		expect(state.completedAt).toBe(3000);
	});

	it("preserves status when already stopped, but still sets result", () => {
		const state = new SubagentState({ status: "stopped", completedAt: 500 });
		state.markAborted("partial", 2000);
		expect(state.status).toBe("stopped");
		expect(state.result).toBe("partial");
		expect(state.completedAt).toBe(500);
	});
});

describe("SubagentState — markError", () => {
	it("sets status to 'error' and formats Error objects to .message", () => {
		const state = new SubagentState({ status: "running" });
		state.markError(new Error("something broke"), 6000);
		expect(state.status).toBe("error");
		expect(state.error).toBe("something broke");
		expect(state.completedAt).toBe(6000);
	});

	it("formats non-Error values with String()", () => {
		const state = new SubagentState({ status: "running" });
		state.markError(42, 6000);
		expect(state.error).toBe("42");
	});

	it("preserves status when already stopped, but still sets error and completedAt", () => {
		const state = new SubagentState({ status: "stopped", completedAt: 1000 });
		state.markError(new Error("late error"), 2000);
		expect(state.status).toBe("stopped");
		expect(state.error).toBe("late error");
		expect(state.completedAt).toBe(1000);
	});

	it("preserves existing completedAt (??= semantics)", () => {
		const state = new SubagentState({ status: "running", completedAt: 1000 });
		state.markError(new Error("err"), 9999);
		expect(state.completedAt).toBe(1000);
	});
});

describe("SubagentState — markStopped", () => {
	it("sets status to 'stopped' and completedAt", () => {
		const state = new SubagentState({ status: "running" });
		state.markStopped(7000);
		expect(state.status).toBe("stopped");
		expect(state.completedAt).toBe(7000);
	});

	it("defaults completedAt to Date.now() when not provided", () => {
		const state = new SubagentState({ status: "running" });
		const before = Date.now();
		state.markStopped();
		const after = Date.now();
		expect(state.completedAt).toBeGreaterThanOrEqual(before);
		expect(state.completedAt).toBeLessThanOrEqual(after);
	});

	it("overwrites any previous status — no guard", () => {
		const state = new SubagentState({ status: "completed" });
		state.markStopped(8000);
		expect(state.status).toBe("stopped");
	});

	it("leaves stoppedWhileQueued false — the agent had started", () => {
		const state = new SubagentState({ status: "running" });
		state.markStopped(8000);
		expect(state.stoppedWhileQueued).toBe(false);
	});
});

describe("SubagentState — stopQueued", () => {
	it("sets status to 'stopped' and completedAt", () => {
		const state = new SubagentState({ status: "queued" });
		state.stopQueued(7000);
		expect(state.status).toBe("stopped");
		expect(state.completedAt).toBe(7000);
	});

	it("records that the agent never started", () => {
		const state = new SubagentState({ status: "queued" });
		expect(state.stoppedWhileQueued).toBe(false);
		state.stopQueued(7000);
		expect(state.stoppedWhileQueued).toBe(true);
	});

	it("defaults completedAt to Date.now() when not provided", () => {
		const state = new SubagentState({ status: "queued" });
		const before = Date.now();
		state.stopQueued();
		const after = Date.now();
		expect(state.completedAt).toBeGreaterThanOrEqual(before);
		expect(state.completedAt).toBeLessThanOrEqual(after);
	});

	it("stops an already-running agent without claiming it never started", () => {
		const state = new SubagentState({ status: "running" });
		state.stopQueued(7000);
		expect(state.status).toBe("stopped");
		expect(state.stoppedWhileQueued).toBe(false);
	});

	it("seeds stoppedWhileQueued from init", () => {
		const state = new SubagentState({ status: "stopped", stoppedWhileQueued: true });
		expect(state.stoppedWhileQueued).toBe(true);
	});
});

describe("SubagentState — incrementToolUses", () => {
	it("starts at 0 and increments by 1 each call", () => {
		const state = new SubagentState();
		expect(state.toolUses).toBe(0);
		state.incrementToolUses();
		expect(state.toolUses).toBe(1);
		state.incrementToolUses();
		expect(state.toolUses).toBe(2);
	});
});

describe("SubagentState — addUsage", () => {
	it("accumulates usage deltas into lifetimeUsage", () => {
		const state = new SubagentState();
		expect(state.lifetimeUsage).toEqual({ input: 0, output: 0, cacheWrite: 0 });
		state.addUsage({ input: 100, output: 50, cacheWrite: 10 });
		expect(state.lifetimeUsage).toEqual({ input: 100, output: 50, cacheWrite: 10 });
		state.addUsage({ input: 200, output: 80, cacheWrite: 20 });
		expect(state.lifetimeUsage).toEqual({ input: 300, output: 130, cacheWrite: 30 });
	});
});

describe("SubagentState — incrementCompactions", () => {
	it("starts at 0 and increments by 1 each call", () => {
		const state = new SubagentState();
		expect(state.compactionCount).toBe(0);
		state.incrementCompactions();
		expect(state.compactionCount).toBe(1);
		state.incrementCompactions();
		expect(state.compactionCount).toBe(2);
	});
});

describe("SubagentState — resetForResume", () => {
	it("sets status to 'running' and new startedAt", () => {
		const state = new SubagentState({ status: "completed", startedAt: 1000 });
		state.resetForResume(9000);
		expect(state.status).toBe("running");
		expect(state.startedAt).toBe(9000);
	});

	it("clears completedAt, result, and error", () => {
		const state = new SubagentState({
			status: "error",
			result: "old result",
			error: "old error",
			completedAt: 5000,
		});
		state.resetForResume(9000);
		expect(state.completedAt).toBeUndefined();
		expect(state.result).toBeUndefined();
		expect(state.error).toBeUndefined();
	});

	it("clears consumedAt so a resumed run creates a new pending outcome", () => {
		const state = new SubagentState({ status: "completed", consumedAt: 5000 });
		state.resetForResume(9000);
		expect(state.consumedAt).toBeUndefined();
		expect(state.consumed).toBe(false);
	});

	describe("run ordinal", () => {
		it("numbers the first run 1", () => {
			const state = new SubagentState({ status: "queued" });
			expect(state.run).toBe(1);
		});

		it("does not count the first run's start as a new run", () => {
			const state = new SubagentState({ status: "queued" });
			state.markRunning(1000);
			expect(state.run).toBe(1);
		});

		it("counts each resume as a new run", () => {
			const state = new SubagentState({ status: "completed" });
			state.resetForResume(9000);
			state.markCompleted("second", 9500);
			state.resetForResume(9900);
			expect(state.run).toBe(3);
		});
	});

	describe("superseded outcome", () => {
		it("retains what the reset run ended with", () => {
			const state = new SubagentState({
				status: "completed",
				result: "first result",
				startedAt: 1000,
				completedAt: 5000,
				pendingQuestion: "Which one?",
				workspaceNotice: "Saved to branch x.",
			});
			state.recordUpdate("owed");
			state.recordUpdate("announced");
			state.markUpdateAnnounced("announced");

			state.resetForResume(9000);

			expect(state.supersededOutcome(1)).toEqual({
				status: "completed",
				result: "first result",
				error: undefined,
				startedAt: 1000,
				completedAt: 5000,
				pendingQuestion: "Which one?",
				workspaceNotice: "Saved to branch x.",
				runUpdates: ["owed"],
			});
		});

		it("answers nothing for the run still current", () => {
			const state = new SubagentState({ status: "completed", result: "first result" });
			state.resetForResume(9000);
			expect(state.supersededOutcome(2)).toBeUndefined();
		});

		it("answers nothing before any resume", () => {
			const state = new SubagentState({ status: "completed", result: "first result" });
			expect(state.supersededOutcome(1)).toBeUndefined();
		});

		it("keeps only the most recently superseded run", () => {
			const state = new SubagentState({ status: "completed", result: "first result" });
			state.resetForResume(9000);
			state.markCompleted("second result", 9500);
			state.resetForResume(9900);

			expect(state.supersededOutcome(1)).toBeUndefined();
			expect(state.supersededOutcome(2)?.result).toBe("second result");
		});
	});
});

describe("SubagentState — turn budget", () => {
	const WITHIN: TurnBudget = { maxTurns: 5, used: 1, phase: "within" };
	const WARNED: TurnBudget = { maxTurns: 5, used: 3, phase: "warned" };
	const EXHAUSTED: TurnBudget = { maxTurns: 5, used: 5, phase: "exhausted" };

	it("has no budget until a run's turn loop reports one", () => {
		expect(new SubagentState().turnBudget).toBeUndefined();
	});

	it("seeds the budget from init", () => {
		expect(new SubagentState({ turnBudget: WARNED }).turnBudget).toEqual(WARNED);
	});

	it("records each budget the running turn loop reports", () => {
		const state = new SubagentState({ status: "running" });
		state.setTurnBudget(WITHIN);
		expect(state.turnBudget).toEqual(WITHIN);
		state.setTurnBudget(WARNED);
		expect(state.turnBudget).toEqual(WARNED);
	});

	it("keeps the live budget through a terminal transition", () => {
		const state = new SubagentState({ status: "running" });
		state.setTurnBudget(EXHAUSTED);
		state.markAborted("partial", 5000);
		expect(state.turnBudget).toEqual(EXHAUSTED);
	});

	it("a stop during the warned phase keeps stopped and the budget the loop reached", () => {
		const state = new SubagentState({ status: "running" });
		state.setTurnBudget(WARNED);
		state.markStopped(500);
		state.markCompleted("late", 2000);
		expect(state.status).toBe("stopped");
		expect(state.turnBudget).toEqual(WARNED);
	});

	it("resetForResume clears the budget, which belongs to the run that produced it", () => {
		const state = new SubagentState({ status: "completed", turnBudget: WARNED });
		state.resetForResume(9000);
		expect(state.turnBudget).toBeUndefined();
	});

	it("a superseded outcome keeps the budget the reset run ended with", () => {
		const state = new SubagentState({ status: "running", result: "first" });
		state.setTurnBudget(WARNED);
		state.markCompleted("first", 5000);
		state.resetForResume(9000);
		expect(state.supersededOutcome(1)?.turnBudget).toEqual(WARNED);
	});
});

describe("SubagentState — consumption", () => {
	it("defaults to not consumed", () => {
		const state = new SubagentState();
		expect(state.consumed).toBe(false);
		expect(state.consumedAt).toBeUndefined();
	});

	it("markConsumed sets consumedAt and flips consumed true", () => {
		const state = new SubagentState({ status: "completed" });
		state.markConsumed(5000);
		expect(state.consumed).toBe(true);
		expect(state.consumedAt).toBe(5000);
	});

	it("markConsumed defaults consumedAt to Date.now() when not provided", () => {
		const state = new SubagentState({ status: "completed" });
		const before = Date.now();
		state.markConsumed();
		const after = Date.now();
		expect(state.consumedAt).toBeGreaterThanOrEqual(before);
		expect(state.consumedAt).toBeLessThanOrEqual(after);
	});

	it("markConsumed keeps the first collection time (idempotent ??=)", () => {
		const state = new SubagentState({ status: "completed" });
		state.markConsumed(5000);
		state.markConsumed(9999);
		expect(state.consumedAt).toBe(5000);
	});

	it("seeds consumedAt from the constructor", () => {
		const state = new SubagentState({ status: "completed", consumedAt: 4200 });
		expect(state.consumed).toBe(true);
		expect(state.consumedAt).toBe(4200);
	});
});

describe("SubagentState — carrier claim", () => {
	it("defaults to unclaimed", () => {
		const state = new SubagentState();
		expect(state.claimed).toBe(false);
	});

	it("claim marks the outcome as owned by a carrier", () => {
		const state = new SubagentState({ status: "running" });
		state.claim();
		expect(state.claimed).toBe(true);
	});

	it("releaseClaims hands responsibility back", () => {
		const state = new SubagentState({ status: "running" });
		state.claim();
		state.releaseClaims();
		expect(state.claimed).toBe(false);
	});

	it("releaseClaims without a prior claim is a no-op", () => {
		const state = new SubagentState({ status: "running" });
		state.releaseClaims();
		expect(state.claimed).toBe(false);
	});

	it("claim is idempotent", () => {
		const state = new SubagentState({ status: "running" });
		state.claim();
		state.claim();
		expect(state.claimed).toBe(true);
	});

	it("is independent of consumption", () => {
		const state = new SubagentState({ status: "completed" });
		state.claim();
		expect(state.consumed).toBe(false);
		state.markConsumed(5000);
		state.releaseClaims();
		expect(state.claimed).toBe(false);
		expect(state.consumedAt).toBe(5000);
	});

	describe("claim handles", () => {
		it("keeps the outcome claimed while another holder remains", () => {
			const state = new SubagentState({ status: "running" });
			const first = state.claim();
			state.claim();

			first.release();

			expect(state.claimed).toBe(true);
		});

		it("hands responsibility back once every holder released", () => {
			const state = new SubagentState({ status: "running" });
			const first = state.claim();
			const second = state.claim();

			second.release();
			first.release();

			expect(state.claimed).toBe(false);
		});

		it("releasing one handle twice drops only its own claim", () => {
			const state = new SubagentState({ status: "running" });
			const first = state.claim();
			state.claim();

			first.release();
			first.release();

			expect(state.claimed).toBe(true);
		});

		it("releaseClaims clears every holder", () => {
			const state = new SubagentState({ status: "running" });
			state.claim();
			state.claim();

			state.releaseClaims();

			expect(state.claimed).toBe(false);
		});

		it("a handle released after releaseClaims leaves a later claim in place", () => {
			const state = new SubagentState({ status: "running" });
			const stale = state.claim();
			state.releaseClaims();
			state.claim();

			stale.release();

			expect(state.claimed).toBe(true);
		});
	});

	it("survives resetForResume, which clears consumption but not the claim", () => {
		const state = new SubagentState({ status: "completed" });
		state.claim();
		state.markConsumed(5000);
		state.resetForResume(7000);
		expect(state.claimed).toBe(true);
		expect(state.consumedAt).toBeUndefined();
	});
});

describe("SubagentState — activeTools", () => {
	it("defaults to an empty map", () => {
		const state = new SubagentState();
		expect(state.activeTools.size).toBe(0);
	});

	it("addActiveTool adds a tool by name", () => {
		const state = new SubagentState();
		state.addActiveTool("Read");
		expect(state.activeTools.size).toBe(1);
		expect([...state.activeTools.values()]).toContain("Read");
	});

	it("addActiveTool assigns unique keys for concurrent same-name tools", () => {
		const state = new SubagentState();
		state.addActiveTool("Read");
		state.addActiveTool("Read");
		expect(state.activeTools.size).toBe(2);
		expect([...state.activeTools.values()]).toEqual(["Read", "Read"]);
		const keys = [...state.activeTools.keys()];
		expect(keys[0]).not.toBe(keys[1]);
	});

	it("removeActiveTool removes the first matching tool by name", () => {
		const state = new SubagentState();
		state.addActiveTool("Read");
		state.addActiveTool("Write");
		state.removeActiveTool("Read");
		expect(state.activeTools.size).toBe(1);
		expect([...state.activeTools.values()]).toContain("Write");
		expect([...state.activeTools.values()]).not.toContain("Read");
	});

	it("removeActiveTool removes only one entry when two same-name tools are active", () => {
		const state = new SubagentState();
		state.addActiveTool("Read");
		state.addActiveTool("Read");
		state.removeActiveTool("Read");
		expect(state.activeTools.size).toBe(1);
		expect([...state.activeTools.values()]).toEqual(["Read"]);
	});

	it("removeActiveTool is a no-op when the tool is not active", () => {
		const state = new SubagentState();
		state.addActiveTool("Read");
		state.removeActiveTool("Write"); // not present
		expect(state.activeTools.size).toBe(1);
	});

	it("activeTools getter returns a ReadonlyMap", () => {
		const state = new SubagentState();
		state.addActiveTool("Read");
		const tools = state.activeTools;
		// Verify it's a Map (ReadonlyMap is Map at runtime)
		expect(tools).toBeInstanceOf(Map);
		expect(tools.size).toBe(1);
	});
});

describe("SubagentState — responseText", () => {
	it("defaults to an empty string", () => {
		const state = new SubagentState();
		expect(state.responseText).toBe("");
	});

	it("appendResponseText concatenates text deltas", () => {
		const state = new SubagentState();
		state.appendResponseText("Hello ");
		state.appendResponseText("world");
		expect(state.responseText).toBe("Hello world");
	});

	it("resetResponseText clears accumulated text", () => {
		const state = new SubagentState();
		state.appendResponseText("previous text");
		state.resetResponseText();
		expect(state.responseText).toBe("");
	});

	it("appendResponseText works after a reset", () => {
		const state = new SubagentState();
		state.appendResponseText("first message");
		state.resetResponseText();
		state.appendResponseText("second message");
		expect(state.responseText).toBe("second message");
	});
});

describe("SubagentState — classification predicates", () => {
	const active = new Set<SubagentStatus>(["running", "queued"]);
	const terminalError = new Set<SubagentStatus>(["error", "stopped", "aborted"]);
	const running = new Set<SubagentStatus>(["running"]);

	describe("exported status-level functions", () => {
		for (const status of ALL_STATUSES) {
			it(`isActiveStatus("${status}") is ${active.has(status)}`, () => {
				expect(isActiveStatus(status)).toBe(active.has(status));
			});
			it(`isTerminalErrorStatus("${status}") is ${terminalError.has(status)}`, () => {
				expect(isTerminalErrorStatus(status)).toBe(terminalError.has(status));
			});
			it(`isRunningStatus("${status}") is ${running.has(status)}`, () => {
				expect(isRunningStatus(status)).toBe(running.has(status));
			});
		}
	});

	describe("instance predicates delegate to the status-level functions", () => {
		for (const status of ALL_STATUSES) {
			it(`"${status}": isActive=${active.has(status)}, isTerminalError=${terminalError.has(status)}, isRunning=${running.has(status)}, canBeSteered=${running.has(status)}`, () => {
				const state = new SubagentState({ status });
				expect(state.isActive()).toBe(active.has(status));
				expect(state.isTerminalError()).toBe(terminalError.has(status));
				expect(state.isRunning()).toBe(running.has(status));
				expect(state.canBeSteered()).toBe(running.has(status));
			});
		}
	});
});

describe("SubagentState — run updates", () => {
	it("starts with none", () => {
		expect(new SubagentState().runUpdates).toEqual([]);
	});

	it("keeps the order the child sent them in", () => {
		const state = new SubagentState();

		state.recordUpdate("The bug is in the retry wrapper.");
		state.recordUpdate("The fixture is stale too.");

		expect(state.runUpdates).toEqual([
			"The bug is in the retry wrapper.",
			"The fixture is stale too.",
		]);
	});

	it("drops the previous run's updates when a fresh run starts", () => {
		const state = new SubagentState();
		state.recordUpdate("From the first run.");

		state.markRunning(1000);

		expect(state.runUpdates).toEqual([]);
	});

	it("drops the previous run's updates when a resume starts", () => {
		const state = new SubagentState();
		state.recordUpdate("From the run being resumed.");

		state.resetForResume(2000);

		expect(state.runUpdates).toEqual([]);
	});

	it("cannot be seeded from a rehydrated record", () => {
		// Transient runtime state, like the carrier claim: a rehydrated record has
		// no run to have produced it.
		const state = new SubagentState({ runUpdates: ["seeded"] } as unknown as SubagentStateInit);

		expect(state.runUpdates).toEqual([]);
	});

	describe("the announcement latch", () => {
		it("omits a message the announcement channel delivered", () => {
			const state = new SubagentState();
			state.recordUpdate("Announced already.");
			state.recordUpdate("Still owed to a carrier.");

			state.markUpdateAnnounced("Announced already.");

			expect(state.runUpdates).toEqual(["Still owed to a carrier."]);
		});

		it("marks the first unannounced copy, leaving a later duplicate owed", () => {
			const state = new SubagentState();
			state.recordUpdate("Same finding twice.");
			state.recordUpdate("Same finding twice.");

			state.markUpdateAnnounced("Same finding twice.");

			expect(state.runUpdates).toEqual(["Same finding twice."]);
		});

		it("ignores a message this run never produced", () => {
			const state = new SubagentState();
			state.recordUpdate("From this run.");

			state.markUpdateAnnounced("From a run that was reset.");

			expect(state.runUpdates).toEqual(["From this run."]);
		});
	});
});

describe("SubagentState — lastProgressAt", () => {
	it("is seeded from startedAt", () => {
		const state = new SubagentState({ startedAt: 1000 });

		expect(state.lastProgressAt).toBe(1000);
	});

	it("is seeded from an explicit value", () => {
		const state = new SubagentState({ startedAt: 1000, lastProgressAt: 4000 });

		expect(state.lastProgressAt).toBe(4000);
	});

	it("is stamped by markProgress", () => {
		const state = new SubagentState({ startedAt: 1000 });

		state.markProgress(2500);

		expect(state.lastProgressAt).toBe(2500);
	});

	it("restarts at the run's start when the run begins", () => {
		const state = new SubagentState({ status: "queued", startedAt: 1000 });
		state.markProgress(9000);

		state.markRunning(5000);

		expect(state.lastProgressAt).toBe(5000);
	});

	it("restarts at the resumed run's start on resume", () => {
		const state = new SubagentState({ status: "completed", startedAt: 1000, completedAt: 2000 });
		state.markProgress(9000);

		state.resetForResume(5000);

		expect(state.lastProgressAt).toBe(5000);
	});
});
