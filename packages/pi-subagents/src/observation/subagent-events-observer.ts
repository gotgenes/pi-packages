import type { SubagentManagerObserver } from "#src/lifecycle/subagent-manager";
import type { RunKind } from "#src/lifecycle/subagent-run";
import { buildEventData, type NotificationSystem } from "#src/observation/notification";
import { SUBAGENT_RECORD_ENTRY, toPersistedRecord } from "#src/persisted-record";
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

	/**
	 * A run started. The initial run announces on `subagents:started`; a settled
	 * agent going back to running announces on its own channel, because a
	 * consumer counting `started` once per agent must not see it twice. Nothing
	 * is persisted: the session entry records outcomes, and a run that has just
	 * begun is not one.
	 */
	onSubagentRunStarted(record: Subagent, kind: RunKind): void {
		this.emit(kind === "initial" ? "subagents:started" : "subagents:resuming", identityOf(record));
	}

	/**
	 * A run reached a terminal state. The initial run's channel says whether it
	 * succeeded; a resumed run terminates in any terminal status on one distinct
	 * channel, the payload's status/error discriminating, so subagents:completed
	 * and subagents:failed subscribers keep their once-per-agent semantics.
	 */
	onSubagentRunFinished(record: Subagent, kind: RunKind): void {
		this.emit(finishedChannel(record, kind), buildEventData(record));
		this.persistAndNotify(record);
	}

	/**
	 * Persist the terminal record for cross-extension history reconstruction and
	 * announce completion, for every finished run, initial or resumed. Whether a
	 * nudge is actually owed is the notification manager's decision — it suppresses itself when a carrier has claimed the outcome or
	 * the parent has already consumed it. Both are domain state on the record,
	 * not owned here.
	 */
	private persistAndNotify(record: Subagent): void {
		this.appendEntry(SUBAGENT_RECORD_ENTRY, toPersistedRecord(record));
		this.notifications.sendCompletion(record);
	}

	/**
	 * A still-running child sent its parent a message. Announced, never
	 * persisted: the session entry reconstructs terminal outcomes, and this is
	 * not one.
	 */
	onSubagentUpdate(record: Subagent, message: string): void {
		this.emit("subagents:update", {
			...identityOf(record),
			message,
		});
		this.notifications.sendUpdate(record, message);
	}

	/**
	 * A teardown after the child's result was delivered reported where its work
	 * went. Announced only: no event channel, because no consumer asks for one,
	 * and nothing is persisted — the outcome this belongs to was recorded when
	 * the run ended.
	 */
	onSubagentWorkspaceNotice(record: Subagent, notice: string): void {
		this.notifications.sendWorkspaceNotice(record, notice);
	}

	onSubagentCompacted(record: Subagent, info: CompactionInfo): void {
		// Emit compacted event when agent's session compacts (preserves count on record).
		this.emit("subagents:compacted", {
			...identityOf(record),
			reason: info.reason,
			tokensBefore: info.tokensBefore,
			compactionCount: record.compactionCount,
		});
	}

	onSubagentCreated(record: Subagent): void {
		// Emit created event for background agents (before limiter admission).
		this.emit("subagents:created", {
			...identityOf(record),
			isBackground: record.isBackground,
		});
	}
}

/** The `{ id, type, description }` every lifecycle payload leads with. */
function identityOf(record: Subagent): Pick<Subagent, "id" | "type" | "description"> {
	return { id: record.id, type: record.type, description: record.description };
}

/** The channel a finished run is announced on. */
function finishedChannel(record: Subagent, kind: RunKind): string {
	if (kind === "resume") return "subagents:resumed";
	return record.isTerminalError() ? "subagents:failed" : "subagents:completed";
}
