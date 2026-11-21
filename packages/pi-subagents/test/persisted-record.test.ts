import { describe, expect, it } from "vitest";
import {
	type PersistedSubagentRecord,
	readPersistedRuns,
	readRestorableRun,
	type SessionEntryLike,
	SUBAGENT_RECORD_ENTRY,
	toPersistedRecord,
} from "#src/persisted-record";
import { createTestRun, createTestSubagent } from "#test/helpers/make-subagent";

function persistedRecord(overrides: Partial<PersistedSubagentRecord> = {}): PersistedSubagentRecord {
	return {
		id: "run-1",
		type: "Explore",
		description: "map the module",
		status: "completed",
		result: "done",
		error: undefined,
		turnBudget: undefined,
		startedAt: 1000,
		completedAt: 4000,
		stoppedWhileQueued: false,
		outputFile: "/tasks/run-1.jsonl",
		toolUses: 7,
		lifetimeUsage: { input: 100, output: 40, cacheWrite: 5 },
		compactionCount: 1,
		sessionId: "child-session-1",
		transcriptLeafId: "leaf-1",
		providerWorkspace: false,
		...overrides,
	};
}

function recordEntry(data: unknown): SessionEntryLike {
	return { type: "custom", customType: SUBAGENT_RECORD_ENTRY, data };
}

describe("toPersistedRecord", () => {
	it("copies the persisted fields off the record, and no others", () => {
		const turnBudget = { maxTurns: 5, used: 2, phase: "within" } as const;
		const record = createTestSubagent({
			id: "agent-9",
			type: "Explore",
			description: "map the module",
			status: "error",
			result: "partial",
			error: "boom",
			turnBudget,
			startedAt: 1000,
			completedAt: 2500,
			toolUses: 7,
			lifetimeUsage: { input: 120, output: 30, cacheWrite: 4 },
			compactionCount: 2,
			sessionReady: true,
			outputFile: "/tasks/a.jsonl",
		});

		expect(toPersistedRecord(record, record.latestRun)).toStrictEqual({
			id: "agent-9",
			type: "Explore",
			description: "map the module",
			status: "error",
			result: "partial",
			error: "boom",
			turnBudget,
			startedAt: 1000,
			completedAt: 2500,
			stoppedWhileQueued: false,
			outputFile: "/tasks/a.jsonl",
			toolUses: 7,
			lifetimeUsage: { input: 120, output: 30, cacheWrite: 4 },
			compactionCount: 2,
			// The stub session reports neither; a real one names its session and its last entry.
			sessionId: undefined,
			transcriptLeafId: undefined,
			providerWorkspace: false,
		});
	});

	it("takes the outcome from the run it is given and the identity from the record", () => {
		const record = createTestSubagent({
			id: "agent-9",
			type: "Explore",
			description: "map the module",
			toolUses: 7,
			sessionReady: true,
			outputFile: "/tasks/a.jsonl",
		});
		const stopped = createTestRun("initial", { status: "stopped", result: "Partial.", startedAt: 1200, completedAt: 1500 });

		expect(toPersistedRecord(record, stopped)).toStrictEqual({
			id: "agent-9",
			type: "Explore",
			description: "map the module",
			status: "stopped",
			result: "Partial.",
			error: undefined,
			turnBudget: undefined,
			startedAt: 1200,
			completedAt: 1500,
			stoppedWhileQueued: false,
			outputFile: "/tasks/a.jsonl",
			toolUses: 7,
			lifetimeUsage: record.lifetimeUsage,
			compactionCount: record.compactionCount,
			sessionId: record.sessionId,
			transcriptLeafId: record.transcriptLeafId,
			providerWorkspace: false,
		});
	});

	it("copies the usage by value, so the agent's later usage does not rewrite the entry", () => {
		const record = createTestSubagent({ lifetimeUsage: { input: 1, output: 1, cacheWrite: 0 } });
		expect(toPersistedRecord(record, record.latestRun).lifetimeUsage).not.toBe(record.lifetimeUsage);
	});

	it("copies stoppedWhileQueued off a run stopped while queued", () => {
		const record = createTestSubagent({ status: "stopped", stoppedWhileQueued: true, result: undefined });
		expect(toPersistedRecord(record, record.latestRun).stoppedWhileQueued).toBe(true);
	});
});

describe("readPersistedRuns", () => {
	const summary = {
		id: "run-1",
		type: "Explore",
		description: "map the module",
		status: "completed",
		startedAt: 1000,
		completedAt: 4000,
		stoppedWhileQueued: false,
		outputFile: "/tasks/run-1.jsonl",
		toolUses: 7,
	};

	it("returns nothing for no entries", () => {
		expect(readPersistedRuns([])).toEqual([]);
	});

	describe("filtering", () => {
		it("reads only subagents:record custom entries", () => {
			const entries: SessionEntryLike[] = [
				// A valid record shape under another customType must not be read as a run.
				{ type: "custom", customType: "other", data: persistedRecord({ id: "foreign" }) },
				{ type: "message", data: persistedRecord({ id: "message" }) },
				recordEntry(persistedRecord()),
			];
			expect(readPersistedRuns(entries)).toStrictEqual([summary]);
		});
	});

	describe("repeated ids", () => {
		it("keeps the last entry for an id, so a resumed run reports its latest outcome", () => {
			const entries = [
				recordEntry(persistedRecord({ status: "completed" })),
				recordEntry(persistedRecord({ status: "error", error: "boom" })),
			];
			expect(readPersistedRuns(entries)).toStrictEqual([{ ...summary, status: "error" }]);
		});
	});

	describe("validation", () => {
		it("skips an entry written before the entry recorded toolUses", () => {
			const { toolUses: _toolUses, outputFile: _outputFile, ...preUpgrade } = persistedRecord();
			expect(readPersistedRuns([recordEntry(preUpgrade)])).toEqual([]);
		});

		it("reads an entry written before the entry recorded stoppedWhileQueued as not stopped while queued", () => {
			const { stoppedWhileQueued: _stoppedWhileQueued, ...preUpgrade } = persistedRecord();
			expect(readPersistedRuns([recordEntry(preUpgrade)])).toStrictEqual([summary]);
		});

		it.each(["yes", null, 0])("skips an entry whose stoppedWhileQueued is not a boolean (%j)", (stoppedWhileQueued) => {
			expect(readPersistedRuns([recordEntry({ ...persistedRecord(), stoppedWhileQueued })])).toEqual([]);
		});

		it("skips an entry whose status is not a subagent status", () => {
			expect(readPersistedRuns([recordEntry({ ...persistedRecord(), status: "bogus" })])).toEqual([]);
		});

		it("skips an entry with no data", () => {
			expect(readPersistedRuns([recordEntry(undefined)])).toEqual([]);
		});

		it("keeps a run that recorded no transcript", () => {
			const runs = readPersistedRuns([recordEntry(persistedRecord({ outputFile: undefined, completedAt: undefined }))]);
			expect(runs).toStrictEqual([{ ...summary, outputFile: undefined, completedAt: undefined }]);
		});
	});

	describe("order", () => {
		it("returns runs newest first", () => {
			const entries = [
				recordEntry(persistedRecord({ id: "older", startedAt: 1000 })),
				recordEntry(persistedRecord({ id: "newer", startedAt: 2000 })),
			];
			expect(readPersistedRuns(entries).map((run) => run.id)).toEqual(["newer", "older"]);
		});
	});

	it("reads back what toPersistedRecord wrote", () => {
		const record = createTestSubagent({
			id: "round-trip",
			type: "Explore",
			description: "map the module",
			status: "completed",
			startedAt: 1000,
			completedAt: 4000,
			toolUses: 7,
			sessionReady: true,
			outputFile: "/tasks/round-trip.jsonl",
		});
		expect(readPersistedRuns([recordEntry(toPersistedRecord(record, record.latestRun))])).toStrictEqual([
			{ ...summary, id: "round-trip", outputFile: "/tasks/round-trip.jsonl" },
		]);
	});

	it("reads back a run stopped while queued", () => {
		const record = createTestSubagent({
			id: "queued-resume",
			type: "Explore",
			description: "map the module",
			status: "stopped",
			stoppedWhileQueued: true,
			result: undefined,
			startedAt: 1000,
			completedAt: 4000,
			toolUses: 7,
			sessionReady: true,
			outputFile: "/tasks/queued-resume.jsonl",
		});
		expect(readPersistedRuns([recordEntry(toPersistedRecord(record, record.latestRun))])).toStrictEqual([
			{
				...summary,
				id: "queued-resume",
				status: "stopped",
				stoppedWhileQueued: true,
				outputFile: "/tasks/queued-resume.jsonl",
			},
		]);
	});
});

describe("readRestorableRun", () => {
	const summary = readPersistedRuns([recordEntry(persistedRecord())])[0];

	it("reports a child no run recorded as unrecorded", () => {
		const entries = [recordEntry(persistedRecord({ id: "someone-else" }))];
		expect(readRestorableRun(entries, "run-1")).toStrictEqual({ kind: "unrecorded" });
	});

	it("returns the last run, the transcript it names, what identifies it, and the metrics to carry on from", () => {
		expect(readRestorableRun([recordEntry(persistedRecord())], "run-1")).toStrictEqual({
			kind: "restorable",
			run: {
				summary,
				outputFile: "/tasks/run-1.jsonl",
				sessionId: "child-session-1",
				transcriptLeafId: "leaf-1",
				providerWorkspace: false,
				lifetimeUsage: { input: 100, output: 40, cacheWrite: 5 },
				compactionCount: 1,
				turnBudget: undefined,
			},
		});
	});

	it("takes the last run's leaf and cumulative metrics, which carry the earlier runs'", () => {
		const entries = [
			recordEntry(persistedRecord()),
			recordEntry(persistedRecord({
				transcriptLeafId: "leaf-2",
				toolUses: 9,
				lifetimeUsage: { input: 200, output: 80, cacheWrite: 10 },
				compactionCount: 2,
			})),
		];
		const restore = readRestorableRun(entries, "run-1");
		if (restore.kind !== "restorable") throw new Error(`not restorable: ${restore.kind}`);
		expect(restore.run).toMatchObject({
			summary: { toolUses: 9 },
			transcriptLeafId: "leaf-2",
			lifetimeUsage: { input: 200, output: 80, cacheWrite: 10 },
			compactionCount: 2,
		});
	});

	describe("the turn budget", () => {
		/** The budget a restore reads from these runs of run-1, in order. */
		function restoredBudget(...budgets: unknown[]) {
			const entries = budgets.map((turnBudget) => recordEntry({ ...persistedRecord(), turnBudget }));
			const restore = readRestorableRun(entries, "run-1");
			if (restore.kind !== "restorable") throw new Error(`not restorable: ${restore.kind}`);
			return restore.run.turnBudget;
		}

		it("reads the ceiling a run recorded", () => {
			expect(restoredBudget({ maxTurns: 3, used: 3, phase: "exhausted" })).toStrictEqual({ maxTurns: 3, used: 3, phase: "exhausted" });
		});

		it("reads an unlimited run's budget, which names no ceiling", () => {
			expect(restoredBudget({ used: 9, phase: "within" })).toStrictEqual({ used: 9, phase: "within" });
		});

		it("reads none when no run reached its turn loop", () => {
			expect(restoredBudget(undefined, undefined)).toBeUndefined();
		});

		it("keeps an earlier run's ceiling past a later run that never reached its turn loop", () => {
			expect(restoredBudget({ maxTurns: 3, used: 1, phase: "within" }, undefined)).toStrictEqual({
				maxTurns: 3,
				used: 1,
				phase: "within",
			});
		});

		it("keeps an earlier unlimited budget past a later run that never reached its turn loop", () => {
			expect(restoredBudget({ used: 2, phase: "within" }, undefined)).toStrictEqual({ used: 2, phase: "within" });
		});

		it("takes the latest budget a run recorded", () => {
			expect(restoredBudget({ maxTurns: 3, used: 1, phase: "within" }, { used: 4, phase: "within" })).toStrictEqual({
				used: 4,
				phase: "within",
			});
		});

		it.each([
			["a ceiling that is not a number", { maxTurns: "3", used: 1, phase: "within" }],
			["no use count", { maxTurns: 3, phase: "within" }],
			["an unknown phase", { maxTurns: 3, used: 1, phase: "bogus" }],
			["not an object", 3],
		])("reads a budget with %s as none recorded", (_label, turnBudget) => {
			expect(restoredBudget({ maxTurns: 5, used: 1, phase: "within" }, turnBudget)).toStrictEqual({
				maxTurns: 5,
				used: 1,
				phase: "within",
			});
		});
	});

	it("reads that a provider prepared the run's workspace", () => {
		const restore = readRestorableRun([recordEntry(persistedRecord({ providerWorkspace: true }))], "run-1");
		expect(restore.kind === "restorable" && restore.run.providerWorkspace).toBe(true);
	});

	describe("a run whose transcript nothing identifies", () => {
		it.each([
			["the session id", "sessionId"],
			["the last transcript entry", "transcriptLeafId"],
			["the workspace provenance", "providerWorkspace"],
			["the lifetime usage", "lifetimeUsage"],
			["the compaction count", "compactionCount"],
		] as const)("is unprovable when the entry predates recording %s", (_label, field) => {
			const { [field]: _omitted, ...preUpgrade } = persistedRecord();
			expect(readRestorableRun([recordEntry(preUpgrade)], "run-1")).toStrictEqual({
				kind: "unprovable",
				outputFile: "/tasks/run-1.jsonl",
			});
		});

		it.each([
			["an empty session id", { sessionId: "" }],
			["a leaf that is not a string", { transcriptLeafId: 7 }],
			["a providerWorkspace that is not a boolean", { providerWorkspace: "yes" }],
			["usage missing a count", { lifetimeUsage: { input: 1, output: 1 } }],
			["a compaction count that is not a number", { compactionCount: "1" }],
		])("is unprovable with %s", (_label, override) => {
			expect(readRestorableRun([recordEntry({ ...persistedRecord(), ...override })], "run-1").kind).toBe("unprovable");
		});

		it("is unprovable when the last run names no transcript", () => {
			const entries = [recordEntry(persistedRecord({ outputFile: undefined }))];
			expect(readRestorableRun(entries, "run-1")).toStrictEqual({ kind: "unprovable", outputFile: undefined });
		});

		it("is judged by the last run, not an earlier one that was identified", () => {
			const { sessionId: _sessionId, ...preUpgrade } = persistedRecord();
			const entries = [recordEntry(persistedRecord()), recordEntry(preUpgrade)];
			expect(readRestorableRun(entries, "run-1").kind).toBe("unprovable");
		});
	});
});
