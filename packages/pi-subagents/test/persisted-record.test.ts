import { describe, expect, it } from "vitest";
import {
	type PersistedSubagentRecord,
	readPersistedRuns,
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
			providerWorkspace: false,
		});
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
		turnBudget: undefined,
		providerWorkspace: false,
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

		it("reads the turn budget a run recorded", () => {
			const turnBudget = { maxTurns: 3, used: 3, phase: "exhausted" } as const;
			expect(readPersistedRuns([recordEntry(persistedRecord({ turnBudget }))])).toStrictEqual([{ ...summary, turnBudget }]);
		});

		it("reads an unlimited run's budget, which names no ceiling", () => {
			const turnBudget = { used: 9, phase: "within" } as const;
			expect(readPersistedRuns([recordEntry(persistedRecord({ turnBudget }))])).toStrictEqual([{ ...summary, turnBudget }]);
		});

		it.each([
			["a ceiling that is not a number", { maxTurns: "3", used: 1, phase: "within" }],
			["no use count", { maxTurns: 3, phase: "within" }],
			["an unknown phase", { maxTurns: 3, used: 1, phase: "bogus" }],
			["not an object", 3],
		])("reads a turn budget with %s as unknown, keeping the run", (_label, turnBudget) => {
			expect(readPersistedRuns([recordEntry({ ...persistedRecord(), turnBudget })])).toStrictEqual([summary]);
		});

		it("reads that a provider prepared the run's workspace", () => {
			expect(readPersistedRuns([recordEntry(persistedRecord({ providerWorkspace: true }))])).toStrictEqual([
				{ ...summary, providerWorkspace: true },
			]);
		});

		it("reads an entry written before the entry recorded providerWorkspace as not saying", () => {
			const { providerWorkspace: _providerWorkspace, ...preUpgrade } = persistedRecord();
			expect(readPersistedRuns([recordEntry(preUpgrade)])).toStrictEqual([{ ...summary, providerWorkspace: undefined }]);
		});

		it("reads a providerWorkspace that is not a boolean as not saying, keeping the run", () => {
			expect(readPersistedRuns([recordEntry({ ...persistedRecord(), providerWorkspace: "yes" })])).toStrictEqual([
				{ ...summary, providerWorkspace: undefined },
			]);
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
