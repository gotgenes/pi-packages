import type { SubagentManagerObserver } from "#src/lifecycle/subagent-manager";
import { buildEventData, type NotificationSystem } from "#src/observation/notification";
import type { CompactionInfo, Subagent } from "#src/types";

/** Emit callback — a subset of `pi.events.emit`. */
export type EventEmit = (channel: string, data: unknown) => void;

/** Append callback — a subset of `pi.appendEntry`. */
export type AppendEntry = (customType: string, data: unknown) => void;

export interface SubagentEventsObserverDeps {
	emit: EventEmit;
	appendEntry: AppendEntry;
	notifications: NotificationSystem;
}

/**
 * Receives agent lifecycle notifications from SubagentManager and dispatches
 * them to three concerns: pi.events lifecycle events, session-entry persistence,
 * and completion notifications.
 *
 * Constructed with narrow deps (emit, appendEntry, NotificationSystem) so all
 * three concerns are unit-testable without booting the extension.
 */
export class SubagentEventsObserver implements SubagentManagerObserver {
	private readonly emit: EventEmit;
	private readonly appendEntry: AppendEntry;
	private readonly notifications: NotificationSystem;

	constructor(deps: SubagentEventsObserverDeps) {
		this.emit = deps.emit;
		this.appendEntry = deps.appendEntry;
		this.notifications = deps.notifications;
	}

	onSubagentStarted(record: Subagent): void {
		// Emit started event when agent transitions to running (including from queue).
		this.emit("subagents:started", {
			id: record.id,
			type: record.type,
			description: record.description,
		});
	}

	onSubagentCompleted(record: Subagent): void {
		// Emit lifecycle event based on terminal status.
		const isError = record.isTerminalError();
		const eventData = buildEventData(record);
		if (isError) {
			this.emit("subagents:failed", eventData);
		} else {
			this.emit("subagents:completed", eventData);
		}

		this.persistAndNotify(record);
	}

	onSubagentResumed(record: Subagent): void {
		// A resumed run terminates only as completed or error; a single distinct
		// channel carries both — the payload's status/error discriminate. Existing
		// subagents:completed/failed subscribers keep their once-per-run semantics.
		this.emit("subagents:resumed", buildEventData(record));
		this.persistAndNotify(record);
	}

	/**
	 * Persist the terminal record for cross-extension history reconstruction and
	 * announce completion. Shared by every terminal-state handler (fresh and
	 * resumed). The nudge suppresses itself if the record is already consumed —
	 * consumption is domain state on the record, not owned here.
	 */
	private persistAndNotify(record: Subagent): void {
		this.appendEntry("subagents:record", {
			id: record.id,
			type: record.type,
			description: record.description,
			status: record.status,
			result: record.result,
			error: record.error,
			startedAt: record.startedAt,
			completedAt: record.completedAt,
		});
		this.notifications.sendCompletion(record);
	}

	onSubagentCompacted(record: Subagent, info: CompactionInfo): void {
		// Emit compacted event when agent's session compacts (preserves count on record).
		this.emit("subagents:compacted", {
			id: record.id,
			type: record.type,
			description: record.description,
			reason: info.reason,
			tokensBefore: info.tokensBefore,
			compactionCount: record.compactionCount,
		});
	}

	onSubagentCreated(record: Subagent): void {
		// Emit created event for background agents (before limiter admission).
		this.emit("subagents:created", {
			id: record.id,
			type: record.type,
			description: record.description,
			isBackground: record.isBackground,
		});
	}
}
