import { describe, expect, it } from "vitest";
import { createTestRun, createTestSubagent } from "./make-subagent";

describe("createTestRun", () => {
	it("builds a run of the requested kind that defaults like the test record", () => {
		const run = createTestRun("resume");
		expect(run.kind).toBe("resume");
		expect(run.status).toBe("completed");
		expect(run.result).toBe("All done.");
		expect(run.startedAt).toBe(1000);
		expect(run.completedAt).toBe(2000);
		expect(run.inBackground).toBe(true);
	});

	it("builds an initial run when asked for one", () => {
		expect(createTestRun("initial").kind).toBe("initial");
	});

	it("seeds outcome overrides, honoring an explicit undefined", () => {
		const run = createTestRun("initial", { status: "running", result: undefined, completedAt: undefined, runUpdates: ["Progress."] });
		expect(run.status).toBe("running");
		expect(run.result).toBeUndefined();
		expect(run.completedAt).toBeUndefined();
		expect(run.runUpdates).toEqual(["Progress."]);
	});

	it("builds a foreground run when asked for one", () => {
		expect(createTestRun("initial", { isBackground: false }).inBackground).toBe(false);
	});
});

describe("createTestSubagent", () => {
	describe("live-activity shorthands", () => {
		it("has no turn budget by default", () => {
			expect(createTestSubagent().turnBudget).toBeUndefined();
		});

		it("seeds a turn budget", () => {
			const record = createTestSubagent({ turnBudget: { maxTurns: 10, used: 4, phase: "within" } });
			expect(record.turnBudget).toEqual({ maxTurns: 10, used: 4, phase: "within" });
		});

		it("defaults activeTools to an empty map", () => {
			const record = createTestSubagent();
			expect(record.activeTools.size).toBe(0);
		});

		it("seeds active tools by name", () => {
			const record = createTestSubagent({ activeTools: ["read", "grep"] });
			expect(record.activeTools.size).toBe(2);
			expect([...record.activeTools.values()]).toEqual(["read", "grep"]);
		});

		it("defaults responseText to empty string", () => {
			const record = createTestSubagent();
			expect(record.responseText).toBe("");
		});

		it("seeds responseText", () => {
			const record = createTestSubagent({ responseText: "thinking…" });
			expect(record.responseText).toBe("thinking…");
		});

	});

	describe("session readiness", () => {
		it("builds a record with no session by default", () => {
			expect(createTestSubagent().isSessionReady()).toBe(false);
		});

		it("attaches a session stub when sessionReady is requested", () => {
			expect(createTestSubagent({ sessionReady: true }).isSessionReady()).toBe(true);
		});

		it("leaves the attached session's outputFile unset by default", () => {
			expect(createTestSubagent({ sessionReady: true }).outputFile).toBeUndefined();
		});

		it("threads outputFile into the attached session stub", () => {
			const record = createTestSubagent({ sessionReady: true, outputFile: "/sessions/child.jsonl" });
			expect(record.outputFile).toBe("/sessions/child.jsonl");
		});
	});

	it("returns a completed agent with expected defaults", () => {
		const record = createTestSubagent();
		expect(record.id).toBe("agent-1");
		expect(record.type).toBe("general-purpose");
		expect(record.description).toBe("Test task");
		expect(record.status).toBe("completed");
		expect(record.result).toBe("All done.");
		expect(record.toolUses).toBe(3);
		expect(record.startedAt).toBe(1000);
		expect(record.completedAt).toBe(2000);
		expect(record.compactionCount).toBe(0);
		expect(record.lifetimeUsage).toEqual({ input: 500, output: 500, cacheWrite: 0 });
	});

	it("applies overrides to defaults", () => {
		const record = createTestSubagent({ id: "custom-id", status: "running" });
		expect(record.id).toBe("custom-id");
		expect(record.status).toBe("running");
		// Non-overridden fields retain defaults
		expect(record.description).toBe("Test task");
		expect(record.toolUses).toBe(3);
	});

	it("exposes promise via getter after start() is called", async () => {
		const record = createTestSubagent({ status: "running", completedAt: undefined });
		expect(record.promise).toBeUndefined();
		record.start();
		expect(record.promise).toBeInstanceOf(Promise);
		await record.promise;
	});

	it("allows overriding defaults to undefined", () => {
		const record = createTestSubagent({ result: undefined, completedAt: undefined });
		expect(record.result).toBeUndefined();
		expect(record.completedAt).toBeUndefined();
	});
});
