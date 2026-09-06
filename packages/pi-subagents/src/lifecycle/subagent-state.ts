/**
 * subagent-state.ts — SubagentState value object: lifecycle status, metrics, and live activity.
 *
 * Owns the passive, readable state of a subagent — status, result, error,
 * timestamps, stats (toolUses, lifetimeUsage, compactionCount), and live-activity
 * fields (turnCount, activeTools, responseText) — together with the transition
 * methods (markRunning, markCompleted, …), accumulation methods
 * (incrementToolUses, addUsage, incrementCompactions), and live-activity
 * transition methods (incrementTurnCount, addActiveTool, removeActiveTool,
 * resetResponseText, appendResponseText) that mutate them.
 *
 * State is encapsulated behind getters; external code reads through them but
 * mutates only via the transition/accumulation methods. The value object owns
 * all of its own mutations — no field is written from outside.
 *
 * Subagent holds one of these privately and delegates its getters and mutation
 * methods to it. Extracting it lets the lifecycle state machine and the
 * session-event observer be unit-tested without constructing an executor.
 */

import type { LifetimeUsage } from "#src/lifecycle/usage";
import { addUsage } from "#src/lifecycle/usage";

export type SubagentStatus =
	| "queued"
	| "running"
	| "completed"
	| "steered"
	| "aborted"
	| "stopped"
	| "error";

// ---- Status classification predicates ----
// The single decision point for the re-derived status groupings. Instance
// methods on SubagentState delegate here; DTO consumers holding a bare
// SubagentStatus (no SubagentState instance) call these directly.

/** Running or queued — the agent is still live (started or awaiting a slot). */
export function isActiveStatus(status: SubagentStatus): boolean {
	return status === "running" || status === "queued";
}

/** Terminated by error, abort, or external stop (excludes the successful `steered`). */
export function isTerminalErrorStatus(status: SubagentStatus): boolean {
	return status === "error" || status === "stopped" || status === "aborted";
}

/** Actively running (excludes queued). */
export function isRunningStatus(status: SubagentStatus): boolean {
	return status === "running";
}

export interface SubagentStateInit {
	status?: SubagentStatus;
	result?: string;
	/** The question the agent ended its turn with — an outcome fact, like result. */
	pendingQuestion?: string;
	/** What a teardown with no result text reported — an outcome fact, like result. */
	workspaceNotice?: string;
	error?: string;
	/** Whether the agent was stopped before the limiter ever admitted it. */
	stoppedWhileQueued?: boolean;
	startedAt?: number;
	completedAt?: number;
	/** Time the parent collected the outcome; undefined = obligation still open. */
	consumedAt?: number;
	// Stats — seed a populated value without replaying the accumulation methods
	toolUses?: number;
	lifetimeUsage?: LifetimeUsage;
	compactionCount?: number;
	// Live activity — activeTools is seeded by name (each entry calls addActiveTool)
	turnCount?: number;
	activeTools?: string[];
	responseText?: string;
}

export class SubagentState {
	// Transition state — encapsulated behind getters, mutated only via transition methods
	private _status: SubagentStatus;
	get status(): SubagentStatus { return this._status; }

	private _result?: string;
	get result(): string | undefined { return this._result; }

	private _error?: string;
	get error(): string | undefined { return this._error; }

	// Never-started marker — a queued agent stopped before its slot opened has no
	// result, as distinct from a started agent that produced none.
	private _stoppedWhileQueued: boolean;
	get stoppedWhileQueued(): boolean { return this._stoppedWhileQueued; }

	private _startedAt: number;
	get startedAt(): number { return this._startedAt; }

	private _completedAt?: number;
	get completedAt(): number | undefined { return this._completedAt; }

	// Result delivery — whether the parent has collected the outcome (orthogonal to status)
	private _consumedAt?: number;
	get consumedAt(): number | undefined { return this._consumedAt; }
	get consumed(): boolean { return this._consumedAt != null; }

	// Result delivery — whether a carrier has committed to delivering the outcome.
	// Distinct from consumption in two ways. It is revocable, where consumption is
	// a one-way latch that also times session retention. And it is scoped to the
	// caller rather than the run: consumedAt records a delivery that has already
	// happened, so a resume must clear it, while a claim records one that has not
	// happened yet and stays live across the reset (see resetForResume).
	// Transient runtime ownership, so deliberately not seedable via
	// SubagentStateInit — a rehydrated record must not claim a carrier that no
	// longer exists.
	private _claimed = false;
	get claimed(): boolean { return this._claimed; }

	// The question this agent ended its turn with, if it declared one. Part of the
	// outcome like _result, and set alongside it at the terminal transition.
	private _pendingQuestion?: string;
	get pendingQuestion(): string | undefined { return this._pendingQuestion; }

	// What the workspace reported at a teardown with no result text to fold it
	// into. Part of the outcome like _result, and set at the disposal that
	// produced it. Undefined for a run whose addendum rode the result instead.
	private _workspaceNotice?: string;
	get workspaceNotice(): string | undefined { return this._workspaceNotice; }

	// The updates the child sent while a carrier held this run's outcome, for
	// that carrier to render alongside the result rather than announce after it.
	// Scoped to the run, so it clears wherever a run begins.
	// Transient runtime state, so deliberately not seedable via SubagentStateInit
	// — a rehydrated record has no run to have produced these.
	private _runUpdates: string[] = [];
	get runUpdates(): readonly string[] { return this._runUpdates; }

	// Stats — accumulated via mutation methods, readable via getters
	private _toolUses: number;
	get toolUses(): number { return this._toolUses; }

	private _lifetimeUsage: LifetimeUsage;
	get lifetimeUsage(): Readonly<LifetimeUsage> { return this._lifetimeUsage; }

	private _compactionCount: number;
	get compactionCount(): number { return this._compactionCount; }

	// Live activity — accumulated via transition methods, readable via getters
	private _turnCount: number;
	get turnCount(): number { return this._turnCount; }

	private _activeTools = new Map<string, string>();
	get activeTools(): ReadonlyMap<string, string> { return this._activeTools; }

	private _toolKeySeq = 0;

	private _responseText: string;
	get responseText(): string { return this._responseText; }

	constructor(init: SubagentStateInit = {}) {
		this._status = init.status ?? "queued";
		this._result = init.result;
		this._pendingQuestion = init.pendingQuestion;
		this._workspaceNotice = init.workspaceNotice;
		this._error = init.error;
		this._stoppedWhileQueued = init.stoppedWhileQueued ?? false;
		this._startedAt = init.startedAt ?? Date.now();
		this._completedAt = init.completedAt;
		this._consumedAt = init.consumedAt;
		this._toolUses = init.toolUses ?? 0;
		// Copy so a later addUsage() cannot mutate the caller's object.
		this._lifetimeUsage = init.lifetimeUsage
			? { ...init.lifetimeUsage }
			: { input: 0, output: 0, cacheWrite: 0 };
		this._compactionCount = init.compactionCount ?? 0;
		this._turnCount = init.turnCount ?? 1;
		this._responseText = init.responseText ?? "";
		for (const name of init.activeTools ?? []) {
			this.addActiveTool(name);
		}
	}

	/** Running or queued — still live. */
	isActive(): boolean {
		return isActiveStatus(this._status);
	}

	/** Terminated by error, abort, or external stop (excludes `steered`). */
	isTerminalError(): boolean {
		return isTerminalErrorStatus(this._status);
	}

	/** Actively running (excludes queued). */
	isRunning(): boolean {
		return isRunningStatus(this._status);
	}

	/** Whether a steer message can be delivered — the agent must be running. */
	canBeSteered(): boolean {
		return isRunningStatus(this._status);
	}

	/** Increment tool use count. Called by record-observer on tool_execution_end. */
	incrementToolUses(): void {
		this._toolUses++;
	}

	/** Accumulate a usage delta into lifetimeUsage. Called by record-observer on message_end. */
	addUsage(delta: { input: number; output: number; cacheWrite: number }): void {
		addUsage(this._lifetimeUsage, delta);
	}

	/** Increment compaction count. Called by record-observer on compaction_end. */
	incrementCompactions(): void {
		this._compactionCount++;
	}

	/** Record a turn boundary. Called by record-observer on turn_end. */
	incrementTurnCount(): void {
		this._turnCount++;
	}

	/** Record a tool starting. Called by record-observer on tool_execution_start. */
	addActiveTool(toolName: string): void {
		this._activeTools.set(toolName + "_" + (++this._toolKeySeq), toolName);
	}

	/** Remove one active tool by name (first match). Called by record-observer on tool_execution_end. */
	removeActiveTool(toolName: string): void {
		for (const [key, name] of this._activeTools) {
			if (name === toolName) {
				this._activeTools.delete(key);
				break;
			}
		}
	}

	/** Reset the current response text. Called by record-observer on message_start. */
	resetResponseText(): void {
		this._responseText = "";
	}

	/** Append a text delta to the current response text. Called by record-observer on message_update. */
	appendResponseText(delta: string): void {
		this._responseText += delta;
	}

	/** Transition to running state. Sets status and startedAt. */
	markRunning(startedAt: number): void {
		this._status = "running";
		this._startedAt = startedAt;
		this._runUpdates.length = 0;
	}

	/** Record an update the child sent during this run. */
	recordUpdate(message: string): void {
		this._runUpdates.push(message);
	}

	/**
	 * Transition to completed state.
	 * Always sets result and completedAt (??=). Only changes status if not stopped.
	 */
	markCompleted(result: string, completedAt?: number): void {
		this._result = result;
		this._completedAt ??= completedAt ?? Date.now();
		if (this._status !== "stopped") {
			this._status = "completed";
		}
	}

	/**
	 * Transition to aborted state.
	 * Always sets result and completedAt (??=). Only changes status if not stopped.
	 */
	markAborted(result: string, completedAt?: number): void {
		this._result = result;
		this._completedAt ??= completedAt ?? Date.now();
		if (this._status !== "stopped") {
			this._status = "aborted";
		}
	}

	/**
	 * Transition to steered state.
	 * Always sets result and completedAt (??=). Only changes status if not stopped.
	 */
	markSteered(result: string, completedAt?: number): void {
		this._result = result;
		this._completedAt ??= completedAt ?? Date.now();
		if (this._status !== "stopped") {
			this._status = "steered";
		}
	}

	/**
	 * Transition to error state.
	 * Always sets error (formatted) and completedAt (??=). Only changes status if not stopped.
	 */
	markError(error: unknown, completedAt?: number): void {
		this._error = error instanceof Error ? error.message : String(error);
		this._completedAt ??= completedAt ?? Date.now();
		if (this._status !== "stopped") {
			this._status = "error";
		}
	}

	/**
	 * Record the parent collected the outcome. Idempotent — keeps the first
	 * collection time (??=), so a re-read does not advance the retention clock.
	 */
	markConsumed(at?: number): void {
		this._consumedAt ??= at ?? Date.now();
	}

	/** Record the question the agent ended its turn with. */
	setPendingQuestion(question: string | undefined): void {
		this._pendingQuestion = question;
	}

	/** Record what a teardown reported when no result text could carry it. */
	setWorkspaceNotice(notice: string): void {
		this._workspaceNotice = notice;
	}

	/**
	 * A carrier has committed to delivering this outcome, so nothing else should
	 * announce it. Unlike every other transition here, this one is revocable.
	 */
	claim(): void {
		this._claimed = true;
	}

	/** The carrier abandoned its commitment; announcing is owed again. */
	release(): void {
		this._claimed = false;
	}

	/** Transition to stopped state. Always valid — no guard. */
	markStopped(completedAt?: number): void {
		this._status = "stopped";
		this._completedAt = completedAt ?? Date.now();
	}

	/**
	 * Stop an agent that is still awaiting a concurrency slot. Records the
	 * never-started fact only when the agent is genuinely still queued, so a
	 * mis-targeted call cannot claim it.
	 */
	stopQueued(completedAt?: number): void {
		if (this._status === "queued") this._stoppedWhileQueued = true;
		this.markStopped(completedAt);
	}

	/**
	 * Reset for resume: running status, new startedAt, clear
	 * completedAt/result/error/consumedAt.
	 *
	 * The carrier claim deliberately survives: it belongs to the caller that asked
	 * for the resume and will deliver its outcome, not to the run being reset.
	 * Clearing it here would drop the claim before the caller could observe it,
	 * since this runs synchronously before resume() returns.
	 */
	resetForResume(startedAt: number): void {
		this._status = "running";
		this._startedAt = startedAt;
		this._completedAt = undefined;
		this._result = undefined;
		this._error = undefined;
		this._consumedAt = undefined;
		// A resumed run answers the old question; whether it asks a new one is
		// decided when it terminates.
		this._pendingQuestion = undefined;
		// The updates belong to the run that produced them, and this starts another.
		this._runUpdates.length = 0;
	}
}
