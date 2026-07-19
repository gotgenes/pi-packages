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
			description: record.parentResultPresentation.description,
		});
	}

	onSubagentCompleted(record: Subagent): void {
		// Emit lifecycle event based on terminal status.
		const isError = record.status === "error" || record.status === "stopped" || record.status === "aborted";
		const eventData = buildEventData(record);
		if (isError) {
			this.emit("subagents:failed", eventData);
		} else {
			this.emit("subagents:completed", eventData);
		}

		// Persist final record for cross-extension history reconstruction.
		const presentation = record.parentResultPresentation;
		this.appendEntry("subagents:record", {
			id: record.id,
			type: record.type,
			description: presentation.description,
			status: record.status,
			result: presentation.result,
			error: presentation.error,
			startedAt: record.startedAt,
			completedAt: record.completedAt,
		});

		// The manager decides whether to nudge (it owns the consumed-result state).
		this.notifications.sendCompletion(record);
	}

	onSubagentCompacted(record: Subagent, info: CompactionInfo): void {
		// Emit compacted event when agent's session compacts (preserves count on record).
		this.emit("subagents:compacted", {
			id: record.id,
			type: record.type,
			description: record.parentResultPresentation.description,
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
			description: record.parentResultPresentation.description,
			isBackground: true,
		});
	}
}
