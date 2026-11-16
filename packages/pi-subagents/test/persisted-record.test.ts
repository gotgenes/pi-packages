import { describe, expect, it } from "vitest";
import {
	type PersistedSubagentRecord,
	readPersistedRuns,
	type SessionEntryLike,
	SUBAGENT_RECORD_ENTRY,
	toPersistedRecord,
} from "#src/persisted-record";
import { createTestSubagent } from "#test/helpers/make-subagent";

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

		expect(toPersistedRecord(record)).toStrictEqual({
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
		});
	});

	it("copies stoppedWhileQueued off a run stopped while queued", () => {
		const record = createTestSubagent({ status: "stopped", stoppedWhileQueued: true, result: undefined });
		expect(toPersistedRecord(record).stoppedWhileQueued).toBe(true);
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
		expect(readPersistedRuns([recordEntry(toPersistedRecord(record))])).toStrictEqual([
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
		expect(readPersistedRuns([recordEntry(toPersistedRecord(record))])).toStrictEqual([
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
