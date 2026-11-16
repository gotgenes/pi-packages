import { describe, expect, it, vi } from "vitest";
import type { SubagentManagerObserver } from "#src/lifecycle/subagent-manager";
import { CompositeSubagentObserver } from "#src/observation/composite-subagent-observer";
import type { CompactionInfo } from "#src/types";
import { createTestSubagent } from "#test/helpers/make-subagent";

function makeDelegate(): SubagentManagerObserver {
	return {
		onSubagentRunStarted: vi.fn(),
		onSubagentCreated: vi.fn(),
		onSubagentRunFinished: vi.fn(),
		onSubagentCompacted: vi.fn(),
	};
}

const COMPACTION: CompactionInfo = { reason: "threshold", tokensBefore: 1000 };
const NOTICE = "\n\n---\nChanges saved to branch `pi-agent-10`.";

describe("CompositeSubagentObserver", () => {
	describe("fan-out", () => {
		it.each(["initial", "resume"] as const)("forwards onSubagentRunStarted for the %s run to every delegate", (kind) => {
			const a = makeDelegate();
			const b = makeDelegate();
			const composite = new CompositeSubagentObserver([a, b]);
			const record = createTestSubagent({ id: "agent-1" });

			composite.onSubagentRunStarted(record, kind);

			expect(a.onSubagentRunStarted).toHaveBeenCalledExactlyOnceWith(record, kind);
			expect(b.onSubagentRunStarted).toHaveBeenCalledExactlyOnceWith(record, kind);
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

		it.each(["initial", "resume"] as const)("forwards onSubagentRunFinished for the %s run to every delegate", (kind) => {
			const a = makeDelegate();
			const b = makeDelegate();
			const composite = new CompositeSubagentObserver([a, b]);
			const record = createTestSubagent({ id: "agent-3" });

			composite.onSubagentRunFinished(record, kind);

			expect(a.onSubagentRunFinished).toHaveBeenCalledExactlyOnceWith(record, kind);
			expect(b.onSubagentRunFinished).toHaveBeenCalledExactlyOnceWith(record, kind);
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
				onSubagentRunStarted: () => { calls.push("a"); },
			};
			const b: SubagentManagerObserver = {
				...makeDelegate(),
				onSubagentRunStarted: () => { calls.push("b"); },
			};
			const composite = new CompositeSubagentObserver([a, b]);

			composite.onSubagentRunStarted(createTestSubagent(), "initial");

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
			composite.onSubagentRunStarted(record, "initial");

			expect(late.onSubagentRunStarted).toHaveBeenCalledExactlyOnceWith(record, "initial");
		});
	});

	describe("fault isolation", () => {
		it("continues to later delegates when an earlier one throws", () => {
			const throwing: SubagentManagerObserver = {
				...makeDelegate(),
				onSubagentRunStarted: vi.fn(() => { throw new Error("boom"); }),
			};
			const after = makeDelegate();
			const composite = new CompositeSubagentObserver([throwing, after]);
			const record = createTestSubagent();

			expect(() => composite.onSubagentRunStarted(record, "initial")).not.toThrow();
			expect(after.onSubagentRunStarted).toHaveBeenCalledExactlyOnceWith(record, "initial");
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

		it("forwards onSubagentWorkspaceNotice to the delegates that implement it", () => {
			const a = { ...makeDelegate(), onSubagentWorkspaceNotice: vi.fn() };
			const b = { ...makeDelegate(), onSubagentWorkspaceNotice: vi.fn() };
			const composite = new CompositeSubagentObserver([a, b]);
			const record = createTestSubagent({ id: "agent-10" });

			composite.onSubagentWorkspaceNotice(record, NOTICE);

			expect(a.onSubagentWorkspaceNotice).toHaveBeenCalledExactlyOnceWith(record, NOTICE);
			expect(b.onSubagentWorkspaceNotice).toHaveBeenCalledExactlyOnceWith(record, NOTICE);
		});

		it("skips a workspace-notice delegate that does not implement it", () => {
			const widgetLike = makeDelegate(); // no onSubagentWorkspaceNotice, like AgentWidget
			const listening = { ...makeDelegate(), onSubagentWorkspaceNotice: vi.fn() };
			const composite = new CompositeSubagentObserver([widgetLike, listening]);
			const record = createTestSubagent({ id: "agent-10" });

			expect(() => composite.onSubagentWorkspaceNotice(record, NOTICE)).not.toThrow();
			expect(listening.onSubagentWorkspaceNotice).toHaveBeenCalledExactlyOnceWith(record, NOTICE);
		});
	});
});
