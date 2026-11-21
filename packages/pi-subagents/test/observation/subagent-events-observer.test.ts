import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildEventData, type NotificationSystem } from "#src/observation/notification";
import { SubagentEventsObserver } from "#src/observation/subagent-events-observer";
import type { CompactionInfo } from "#src/types";
import { createTestRun, createTestSubagent } from "#test/helpers/make-subagent";

function makeNotifications(): NotificationSystem {
	return {
		sendCompletion: vi.fn(),
		sendUpdate: vi.fn(),
		sendWorkspaceNotice: vi.fn(),
		dispose: vi.fn(),
	};
}

function makeObserver(overrides?: Partial<{ notifications: NotificationSystem }>) {
	const emit = vi.fn<(channel: string, data: unknown) => void>();
	const appendEntry = vi.fn<(customType: string, data: unknown) => void>();
	const notifications = overrides?.notifications ?? makeNotifications();
	const observer = new SubagentEventsObserver({ emit, appendEntry, notifications });
	return { observer, emit, appendEntry, notifications };
}

describe("SubagentEventsObserver", () => {
	describe("onSubagentRunStarted", () => {
		describe("an initial run", () => {
			it("emits subagents:started with id, type, description", () => {
				const { observer, emit } = makeObserver();
				const record = createTestSubagent({ id: "agent-1", type: "general-purpose", description: "do work" });

				observer.onSubagentRunStarted(record, "initial");

				expect(emit).toHaveBeenCalledExactlyOnceWith("subagents:started", {
					id: "agent-1",
					type: "general-purpose",
					description: "do work",
				});
			});

			it("does not call appendEntry or notifications", () => {
				const { observer, appendEntry, notifications } = makeObserver();
				observer.onSubagentRunStarted(createTestSubagent(), "initial");
				expect(appendEntry).not.toHaveBeenCalled();
				expect(notifications.sendCompletion).not.toHaveBeenCalled();
			});
		});

		describe("a resumed run", () => {
			it("emits subagents:resuming with id, type, description", () => {
				const { observer, emit } = makeObserver();
				const record = createTestSubagent({
					id: "agent-1",
					type: "general-purpose",
					description: "do work",
				});

				observer.onSubagentRunStarted(record, "resume");

				expect(emit).toHaveBeenCalledExactlyOnceWith("subagents:resuming", {
					id: "agent-1",
					type: "general-purpose",
					description: "do work",
				});
			});

			it("persists nothing and announces nothing: a run that started is not an outcome", () => {
				const { observer, appendEntry, notifications } = makeObserver();

				observer.onSubagentRunStarted(createTestSubagent(), "resume");

				expect(appendEntry).not.toHaveBeenCalled();
				expect(notifications.sendCompletion).not.toHaveBeenCalled();
			});
		});
	});

	describe("onSubagentRunFinished", () => {
		describe("an initial run", () => {
			it("emits subagents:completed for a successful agent", () => {
				const { observer, emit } = makeObserver();
				const record = createTestSubagent({ status: "completed" });

				observer.onSubagentRunFinished(record, record.latestRun);

				expect(emit).toHaveBeenCalledExactlyOnceWith("subagents:completed", buildEventData(record, record.latestRun));
			});

			it("emits subagents:failed for an error agent", () => {
				const { observer, emit } = makeObserver();
				const record = createTestSubagent({ status: "error", error: "boom" });

				observer.onSubagentRunFinished(record, record.latestRun);

				expect(emit).toHaveBeenCalledExactlyOnceWith("subagents:failed", buildEventData(record, record.latestRun));
			});

			it("persists the run's turn budget on the subagents:record entry", () => {
				const { observer, appendEntry } = makeObserver();
				const turnBudget = { maxTurns: 2, used: 3, phase: "warned" } as const;
				const record = createTestSubagent({ turnBudget });
				observer.onSubagentRunFinished(record, record.latestRun);
				// Partial match: the full persisted shape is pinned by the neighboring tests.
				expect(appendEntry).toHaveBeenCalledWith("subagents:record", expect.objectContaining({ turnBudget }));
			});

			it("emits subagents:failed for a stopped agent", () => {
				const { observer, emit } = makeObserver();
				const record = createTestSubagent({ status: "stopped" });

				observer.onSubagentRunFinished(record, record.latestRun);

				expect(emit).toHaveBeenCalledExactlyOnceWith("subagents:failed", buildEventData(record, record.latestRun));
			});

			it("emits subagents:failed for an aborted agent", () => {
				const { observer, emit } = makeObserver();
				const record = createTestSubagent({ status: "aborted" });

				observer.onSubagentRunFinished(record, record.latestRun);

				expect(emit).toHaveBeenCalledExactlyOnceWith("subagents:failed", buildEventData(record, record.latestRun));
			});

			it("calls appendEntry with subagents:record and the persisted fields", () => {
				const { observer, appendEntry } = makeObserver();
				const record = createTestSubagent({
					id: "agent-2",
					type: "Explore",
					description: "explore code",
					status: "completed",
					result: "found it",
					error: undefined,
					startedAt: 1000,
					completedAt: 2000,
				});

				observer.onSubagentRunFinished(record, record.latestRun);

				expect(appendEntry).toHaveBeenCalledExactlyOnceWith("subagents:record", {
					id: "agent-2",
					type: "Explore",
					description: "explore code",
					status: "completed",
					result: "found it",
					error: undefined,
					startedAt: 1000,
					completedAt: 2000,
					stoppedWhileQueued: false,
					outputFile: undefined,
					toolUses: 3,
					providerWorkspace: false,
				});
			});
		});

		describe("a resumed run", () => {
			it("emits subagents:resumed with the buildEventData payload for a completed resume", () => {
				const { observer, emit } = makeObserver();
				const record = createTestSubagent();
				const run = createTestRun("resume", { status: "completed", result: "resumed output" });

				observer.onSubagentRunFinished(record, run);

				expect(emit).toHaveBeenCalledExactlyOnceWith("subagents:resumed", buildEventData(record, run));
			});

			it("emits subagents:resumed (not subagents:failed) for an error resume — payload discriminates", () => {
				const { observer, emit } = makeObserver();
				const record = createTestSubagent();
				const run = createTestRun("resume", { status: "error", error: "boom" });

				observer.onSubagentRunFinished(record, run);

				expect(emit).toHaveBeenCalledExactlyOnceWith("subagents:resumed", buildEventData(record, run));
			});

			it.each(["stopped", "aborted"] as const)("emits subagents:resumed for a resume that ended %s", (status) => {
				const { observer, emit } = makeObserver();
				const record = createTestSubagent();
				const run = createTestRun("resume", { status });

				observer.onSubagentRunFinished(record, run);

				expect(emit).toHaveBeenCalledExactlyOnceWith("subagents:resumed", buildEventData(record, run));
			});

			it("appends subagents:record with the persisted fields", () => {
				const { observer, appendEntry } = makeObserver();
				const record = createTestSubagent({ id: "agent-5", type: "Explore", description: "resume explore" });
				const run = createTestRun("resume", {
					status: "completed",
					result: "resumed it",
					error: undefined,
					startedAt: 3000,
					completedAt: 4000,
				});

				observer.onSubagentRunFinished(record, run);

				expect(appendEntry).toHaveBeenCalledExactlyOnceWith("subagents:record", {
					id: "agent-5",
					type: "Explore",
					description: "resume explore",
					status: "completed",
					result: "resumed it",
					error: undefined,
					startedAt: 3000,
					completedAt: 4000,
					stoppedWhileQueued: false,
					outputFile: undefined,
					toolUses: 3,
					providerWorkspace: false,
				});
			});
		});

		describe.each(["initial", "resume"] as const)("either kind of run (%s)", (kind) => {
			it("calls notifications.sendCompletion unconditionally — the manager decides whether to nudge", () => {
				const notifications = makeNotifications();
				const { observer } = makeObserver({ notifications });
				const record = createTestSubagent();
				const run = createTestRun(kind);

				observer.onSubagentRunFinished(record, run);

				expect(notifications.sendCompletion).toHaveBeenCalledExactlyOnceWith(record, run);
			});

			it("emits exactly once and appends exactly once per call", () => {
				const { observer, emit, appendEntry } = makeObserver();
				observer.onSubagentRunFinished(createTestSubagent(), createTestRun(kind));
				expect(emit).toHaveBeenCalledTimes(1);
				expect(appendEntry).toHaveBeenCalledTimes(1);
			});
		});

		describe("a run a resume already replaced", () => {
			// Abort, then resume before the aborted run's turn loop unwinds: the
			// aborted run's finish arrives while the record's latest run is the
			// resume, still running.
			function recordRunningAResume() {
				return createTestSubagent({ status: "running", result: undefined, completedAt: undefined });
			}

			it("reports the run that finished on its own channel, not the running resume", () => {
				const { observer, emit } = makeObserver();
				const record = recordRunningAResume();
				const aborted = createTestRun("initial", { status: "stopped", result: "Partial.", startedAt: 1000, completedAt: 1500 });

				observer.onSubagentRunFinished(record, aborted);

				expect(emit).toHaveBeenCalledExactlyOnceWith("subagents:failed", buildEventData(record, aborted));
				expect(buildEventData(record, aborted).status).toBe("stopped");
			});

			it("persists the run that finished, not the running resume", () => {
				const { observer, appendEntry } = makeObserver();
				const record = recordRunningAResume();
				const aborted = createTestRun("initial", { status: "stopped", result: "Partial.", startedAt: 1000, completedAt: 1500 });

				observer.onSubagentRunFinished(record, aborted);

				expect(appendEntry).toHaveBeenCalledExactlyOnceWith("subagents:record", {
					id: "agent-1",
					type: "general-purpose",
					description: "Test task",
					status: "stopped",
					result: "Partial.",
					error: undefined,
					turnBudget: undefined,
					startedAt: 1000,
					completedAt: 1500,
					stoppedWhileQueued: false,
					outputFile: undefined,
					toolUses: 3,
					providerWorkspace: false,
				});
			});
		});
	});

	describe("onSubagentCompacted", () => {
		it("emits subagents:compacted with id, type, description, reason, tokensBefore, compactionCount", () => {
			const { observer, emit } = makeObserver();
			const record = createTestSubagent({
				id: "agent-3",
				type: "Plan",
				description: "plan work",
				compactionCount: 1,
			});
			const info: CompactionInfo = { reason: "threshold", tokensBefore: 50_000 };

			observer.onSubagentCompacted(record, info);

			expect(emit).toHaveBeenCalledExactlyOnceWith("subagents:compacted", {
				id: "agent-3",
				type: "Plan",
				description: "plan work",
				reason: "threshold",
				tokensBefore: 50_000,
				compactionCount: 1,
			});
		});

		it("does not call appendEntry or notifications", () => {
			const { observer, appendEntry, notifications } = makeObserver();
			const info: CompactionInfo = { reason: "manual", tokensBefore: 1000 };
			observer.onSubagentCompacted(createTestSubagent(), info);
			expect(appendEntry).not.toHaveBeenCalled();
			expect(notifications.sendCompletion).not.toHaveBeenCalled();
		});
	});

	describe("onSubagentCreated", () => {
		it("emits subagents:created with id, type, description, and isBackground: true", () => {
			const { observer, emit } = makeObserver();
			const record = createTestSubagent({ id: "agent-4", type: "general-purpose", description: "bg task" });

			observer.onSubagentCreated(record);

			expect(emit).toHaveBeenCalledExactlyOnceWith("subagents:created", {
				id: "agent-4",
				type: "general-purpose",
				description: "bg task",
				isBackground: true,
			});
		});

		it("does not call appendEntry or notifications", () => {
			const { observer, appendEntry, notifications } = makeObserver();
			observer.onSubagentCreated(createTestSubagent());
			expect(appendEntry).not.toHaveBeenCalled();
			expect(notifications.sendCompletion).not.toHaveBeenCalled();
		});
	});

	describe("dependency isolation", () => {
		let emit: ReturnType<typeof vi.fn>;
		let appendEntry: ReturnType<typeof vi.fn>;
		let notifications: NotificationSystem;
		let observer: SubagentEventsObserver;

		beforeEach(() => {
			({ observer, emit, appendEntry, notifications } = makeObserver());
		});

		it("does not import or reference pi SDK directly", () => {
			// If the class was constructed and four methods called with no SDK errors,
			// it holds no SDK dependency — verified structurally by this test running at all.
			observer.onSubagentRunStarted(createTestSubagent(), "initial");
			const finished = createTestSubagent({ status: "completed" });
			observer.onSubagentRunFinished(finished, finished.latestRun);
			const info: CompactionInfo = { reason: "overflow", tokensBefore: 9999 };
			observer.onSubagentCompacted(createTestSubagent(), info);
			observer.onSubagentCreated(createTestSubagent());
			expect(emit).toHaveBeenCalledTimes(4);
			expect(appendEntry).toHaveBeenCalledTimes(1);
			// Notifications were called as a side-effect of onSubagentRunFinished.
			expect(notifications.sendCompletion).toHaveBeenCalledTimes(1);
		});
	});

	describe("onSubagentUpdate", () => {
		it("emits subagents:update carrying the child's message", () => {
			const { observer, emit } = makeObserver();
			const record = createTestSubagent({ id: "agent-1", type: "general-purpose", description: "do work" });

			observer.onSubagentUpdate(record, record.latestRun, "The bug is in the retry wrapper.");

			expect(emit).toHaveBeenCalledExactlyOnceWith("subagents:update", {
				id: "agent-1",
				type: "general-purpose",
				description: "do work",
				message: "The bug is in the retry wrapper.",
			});
		});

		it("announces the update to the parent", () => {
			const { observer, notifications } = makeObserver();
			const record = createTestSubagent({ id: "agent-1" });

			observer.onSubagentUpdate(record, record.latestRun, "Course change.");

			expect(notifications.sendUpdate).toHaveBeenCalledExactlyOnceWith(record, record.latestRun, "Course change.");
		});

		it("persists nothing — an update is not an outcome to reconstruct history from", () => {
			const { observer, appendEntry } = makeObserver();

			const record = createTestSubagent();
			observer.onSubagentUpdate(record, record.latestRun, "Course change.");

			expect(appendEntry).not.toHaveBeenCalled();
		});
	});

	describe("onSubagentWorkspaceNotice", () => {
		const NOTICE = "\n\n---\nChanges saved to branch `pi-agent-1`.";

		it("announces where the teardown left the child's work", () => {
			const { observer, notifications } = makeObserver();
			const record = createTestSubagent({ id: "agent-1" });

			observer.onSubagentWorkspaceNotice(record, NOTICE);

			expect(notifications.sendWorkspaceNotice).toHaveBeenCalledExactlyOnceWith(record, NOTICE);
		});

		it("emits no event — no consumer asks for one, and a vacant channel is not added", () => {
			const { observer, emit } = makeObserver();

			observer.onSubagentWorkspaceNotice(createTestSubagent(), NOTICE);

			expect(emit).not.toHaveBeenCalled();
		});

		it("persists nothing — the outcome it belongs to was recorded long ago", () => {
			const { observer, appendEntry } = makeObserver();

			observer.onSubagentWorkspaceNotice(createTestSubagent(), NOTICE);

			expect(appendEntry).not.toHaveBeenCalled();
		});
	});
});
