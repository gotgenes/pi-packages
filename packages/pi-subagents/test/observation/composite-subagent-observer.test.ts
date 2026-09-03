import { describe, expect, it, vi } from "vitest";
import type { SubagentManagerObserver } from "#src/lifecycle/subagent-manager";
import { CompositeSubagentObserver } from "#src/observation/composite-subagent-observer";
import type { CompactionInfo } from "#src/types";
import { createTestSubagent } from "#test/helpers/make-subagent";

function makeDelegate(): SubagentManagerObserver {
	return {
		onSubagentStarted: vi.fn(),
		onSubagentCreated: vi.fn(),
		onSubagentCompleted: vi.fn(),
		onSubagentResumed: vi.fn(),
		onSubagentCompacted: vi.fn(),
	};
}

const COMPACTION: CompactionInfo = { reason: "threshold", tokensBefore: 1000 };

describe("CompositeSubagentObserver", () => {
	describe("fan-out", () => {
		it("forwards onSubagentStarted to every delegate with the record", () => {
			const a = makeDelegate();
			const b = makeDelegate();
			const composite = new CompositeSubagentObserver([a, b]);
			const record = createTestSubagent({ id: "agent-1" });

			composite.onSubagentStarted(record);

			expect(a.onSubagentStarted).toHaveBeenCalledExactlyOnceWith(record);
			expect(b.onSubagentStarted).toHaveBeenCalledExactlyOnceWith(record);
		});

		it("forwards onSubagentCreated to every delegate with the record", () => {
			const a = makeDelegate();
			const b = makeDelegate();
			const composite = new CompositeSubagentObserver([a, b]);
			const record = createTestSubagent({ id: "agent-2" });

			composite.onSubagentCreated(record);

			expect(a.onSubagentCreated).toHaveBeenCalledExactlyOnceWith(record);
			expect(b.onSubagentCreated).toHaveBeenCalledExactlyOnceWith(record);
		});

		it("forwards onSubagentCompleted to every delegate with the record", () => {
			const a = makeDelegate();
			const b = makeDelegate();
			const composite = new CompositeSubagentObserver([a, b]);
			const record = createTestSubagent({ id: "agent-3" });

			composite.onSubagentCompleted(record);

			expect(a.onSubagentCompleted).toHaveBeenCalledExactlyOnceWith(record);
			expect(b.onSubagentCompleted).toHaveBeenCalledExactlyOnceWith(record);
		});

		it("forwards onSubagentResumed to every delegate with the record", () => {
			const a = makeDelegate();
			const b = makeDelegate();
			const composite = new CompositeSubagentObserver([a, b]);
			const record = createTestSubagent({ id: "agent-3b" });

			composite.onSubagentResumed(record);

			expect(a.onSubagentResumed).toHaveBeenCalledExactlyOnceWith(record);
			expect(b.onSubagentResumed).toHaveBeenCalledExactlyOnceWith(record);
		});

		it("forwards onSubagentCompacted to every delegate with record and info", () => {
			const a = makeDelegate();
			const b = makeDelegate();
			const composite = new CompositeSubagentObserver([a, b]);
			const record = createTestSubagent({ id: "agent-4" });

			composite.onSubagentCompacted(record, COMPACTION);

			expect(a.onSubagentCompacted).toHaveBeenCalledExactlyOnceWith(record, COMPACTION);
			expect(b.onSubagentCompacted).toHaveBeenCalledExactlyOnceWith(record, COMPACTION);
		});

		it("invokes delegates in registration order", () => {
			const calls: string[] = [];
			const a: SubagentManagerObserver = {
				...makeDelegate(),
				onSubagentStarted: () => { calls.push("a"); },
			};
			const b: SubagentManagerObserver = {
				...makeDelegate(),
				onSubagentStarted: () => { calls.push("b"); },
			};
			const composite = new CompositeSubagentObserver([a, b]);

			composite.onSubagentStarted(createTestSubagent());

			expect(calls).toEqual(["a", "b"]);
		});
	});

	describe("add", () => {
		it("forwards to a delegate registered after construction", () => {
			const a = makeDelegate();
			const late = makeDelegate();
			const composite = new CompositeSubagentObserver([a]);

			composite.add(late);
			const record = createTestSubagent();
			composite.onSubagentStarted(record);

			expect(late.onSubagentStarted).toHaveBeenCalledExactlyOnceWith(record);
		});
	});

	describe("fault isolation", () => {
		it("continues to later delegates when an earlier one throws", () => {
			const throwing: SubagentManagerObserver = {
				...makeDelegate(),
				onSubagentStarted: vi.fn(() => { throw new Error("boom"); }),
			};
			const after = makeDelegate();
			const composite = new CompositeSubagentObserver([throwing, after]);
			const record = createTestSubagent();

			expect(() => composite.onSubagentStarted(record)).not.toThrow();
			expect(after.onSubagentStarted).toHaveBeenCalledExactlyOnceWith(record);
		});
	});

	describe("an optional hook only some delegates implement", () => {
		it("forwards onSubagentUpdate to the delegates that implement it", () => {
			const a = { ...makeDelegate(), onSubagentUpdate: vi.fn() };
			const b = { ...makeDelegate(), onSubagentUpdate: vi.fn() };
			const composite = new CompositeSubagentObserver([a, b]);
			const record = createTestSubagent({ id: "agent-9" });

			composite.onSubagentUpdate(record, "Course change.");

			expect(a.onSubagentUpdate).toHaveBeenCalledExactlyOnceWith(record, "Course change.");
			expect(b.onSubagentUpdate).toHaveBeenCalledExactlyOnceWith(record, "Course change.");
		});

		it("skips a delegate that does not implement it, and still reaches the rest", () => {
			const widgetLike = makeDelegate(); // no onSubagentUpdate, like AgentWidget
			const listening = { ...makeDelegate(), onSubagentUpdate: vi.fn() };
			const composite = new CompositeSubagentObserver([widgetLike, listening]);
			const record = createTestSubagent({ id: "agent-9" });

			expect(() => composite.onSubagentUpdate(record, "Course change.")).not.toThrow();
			expect(listening.onSubagentUpdate).toHaveBeenCalledExactlyOnceWith(record, "Course change.");
		});
	});
});
