/**
 * subagent-run.ts — One run of a subagent: its outcome, and the handles it holds until it ends.
 *
 * A subagent is a sequence of runs: the initial run, then one per resume. Each
 * run is born with its own abort lever, wires the caller's signal when it
 * starts, and keeps the record observer's unsubscribe until it ends, so nothing
 * a run wires outlives it on the per-agent record.
 *
 * A run exists before it starts: the initial run is born with its agent, and
 * waits in the queue for a concurrency slot as that agent's run.
 *
 * Each run's outcome is its own, so a resume starts a new run rather than
 * resetting the last one, and a carrier holding a run reads what that run
 * ended with whatever ran after it.
 */

import {
	isActiveStatus,
	isRunningStatus,
	isTerminalErrorStatus,
	type SubagentStatus,
} from "#src/lifecycle/subagent-state";
import type { TurnBudget } from "#src/lifecycle/turn-limits";

/** Which run of a subagent this is: the one that created its session, or a resume of it. */
export type RunKind = "initial" | "resume";

/**
 * One carrier's commitment to deliver an outcome. Releasing it drops only this
 * commitment, so the outcome stays claimed while any other carrier holds one.
 */
export interface CarrierClaim {
	release(): void;
}

/**
 * What one run ended with, or has so far, as a carrier that holds the run reads
 * and records it.
 */
export interface RunOutcome {
	readonly status: SubagentStatus;
	readonly result: string | undefined;
	readonly error: string | undefined;
	readonly startedAt: number;
	readonly completedAt: number | undefined;
	readonly stoppedWhileQueued: boolean;
	/** Undefined once a later run replaced this one: the resume that started it is the answer. */
	readonly pendingQuestion: string | undefined;
	readonly workspaceNotice: string | undefined;
	/** The updates no announcement delivered; what the carrier still owes. */
	readonly runUpdates: readonly string[];
	/** The run's turn limit and its use; absent when no limit applied. */
	readonly turnBudget: TurnBudget | undefined;
	/** A resume replaced this run after it settled. */
	readonly replaced: boolean;
	isActive(): boolean;
	markConsumed(at?: number): void;
}

/** One update a child sent during a run, and whether an announcement delivered it. */
interface RunUpdate {
	message: string;
	announced: boolean;
}

/** Seeds for a run's outcome, for a record built in a known state (test fixtures). */
export interface RunOutcomeInit {
	status?: SubagentStatus;
	result?: string;
	error?: string;
	/** Whether the run was stopped before the limiter ever admitted it. */
	stoppedWhileQueued?: boolean;
	startedAt?: number;
	completedAt?: number;
	/** The question the run ended its turn with. */
	pendingQuestion?: string;
	/** What a teardown with no result text reported. */
	workspaceNotice?: string;
	/** The run's turn limit and its use. */
	turnBudget?: TurnBudget;
	/** Updates the child sent, in order, each still owed to a carrier. */
	runUpdates?: readonly string[];
	/** Time the parent collected the outcome; undefined = obligation still open. */
	consumedAt?: number;
}

/** One run of a subagent (the initial run or a resume): its outcome, and the handles it holds until it ends. */
export class SubagentRun implements RunOutcome {
	private readonly controller = new AbortController();
	private detachCallerSignal?: () => void;
	private unsubscribeObserver?: () => void;

	// The run's transition state, mutated only through the transitions below.
	private _status: SubagentStatus;
	get status(): SubagentStatus { return this._status; }

	private _result?: string;
	get result(): string | undefined { return this._result; }

	private _error?: string;
	get error(): string | undefined { return this._error; }

	// Never-started marker: a queued run stopped before its slot opened has no
	// result, as distinct from a started run that produced none.
	private _stoppedWhileQueued: boolean;
	get stoppedWhileQueued(): boolean { return this._stoppedWhileQueued; }

	private _startedAt: number;
	get startedAt(): number { return this._startedAt; }

	private _completedAt?: number;
	get completedAt(): number | undefined { return this._completedAt; }

	// The question this run ended its turn with, if it declared one. Part of the
	// outcome like _result, and set while the run is under way by ask_parent.
	// Pending until a resume answers it: the run that resume starts replaces this one.
	private _pendingQuestion?: string;
	get pendingQuestion(): string | undefined { return this._replaced ? undefined : this._pendingQuestion; }

	// Whether a resume has replaced this run. Set once the run has settled and a
	// resume starts the next one, so a carrier still holding this run can tell.
	private _replaced = false;
	get replaced(): boolean { return this._replaced; }

	// What the workspace reported at a teardown with no result text to fold it
	// into. Part of the outcome like _result, and set at the disposal that
	// produced it. Undefined for a run whose addendum rode the result instead.
	private _workspaceNotice?: string;
	get workspaceNotice(): string | undefined { return this._workspaceNotice; }

	// The run's turn budget, live: the turn loop reports it before the first turn
	// and after each boundary, so the last report is already the outcome's.
	private _turnBudget?: TurnBudget;
	get turnBudget(): TurnBudget | undefined { return this._turnBudget; }

	// The updates the child sent during this run, each remembering whether the
	// announcement channel delivered it, so a message reaches the parent once,
	// through whichever channel could reach it, and no carrier repeats it.
	private readonly updates: RunUpdate[] = [];
	/** The updates no announcement delivered: what an outcome carrier must render. */
	get runUpdates(): readonly string[] {
		return this.updates.filter((update) => !update.announced).map((update) => update.message);
	}

	// Result delivery — whether the parent has collected this run's outcome.
	private _consumedAt?: number;
	get consumedAt(): number | undefined { return this._consumedAt; }
	get consumed(): boolean { return this._consumedAt != null; }

	// Result delivery — whether a carrier has committed to delivering this run's
	// outcome. Distinct from consumption: it is revocable, where consumption is a
	// one-way latch that also times session retention. One entry per carrier, so
	// a carrier that abandons its commitment drops only its own: another carrier
	// holding the same outcome still delivers it.
	// Transient runtime ownership, so deliberately not seedable via RunOutcomeInit.
	private readonly claims = new Set<CarrierClaim>();
	get claimed(): boolean { return this.claims.size > 0; }

	constructor(
		readonly kind: RunKind,
		/** Whether this run is in the background: nothing in the parent's turn waits on it. */
		readonly inBackground: boolean,
		init: RunOutcomeInit = {},
	) {
		this._status = init.status ?? "queued";
		this._result = init.result;
		this._error = init.error;
		this._stoppedWhileQueued = init.stoppedWhileQueued ?? false;
		this._startedAt = init.startedAt ?? Date.now();
		this._completedAt = init.completedAt;
		this._pendingQuestion = init.pendingQuestion;
		this._workspaceNotice = init.workspaceNotice;
		this._turnBudget = init.turnBudget;
		for (const message of init.runUpdates ?? []) this.recordUpdate(message);
		this._consumedAt = init.consumedAt;
	}

	/**
	 * Start the run: transition to running, and wire the caller's signal, when
	 * there is one, so firing it calls onCallerAbort.
	 *
	 * A signal that has already fired never fires again, so a listener on it would
	 * be dead on arrival: the run is aborted at its start instead. onCallerAbort is
	 * not called for it — the owner reads `aborted` once the run has started.
	 */
	start(startedAt: number, callerSignal: AbortSignal | undefined, onCallerAbort: () => void): void {
		this._status = "running";
		this._startedAt = startedAt;
		if (!callerSignal) return;
		if (callerSignal.aborted) {
			this.controller.abort();
			return;
		}
		const listener = () => onCallerAbort();
		callerSignal.addEventListener("abort", listener, { once: true });
		this.detachCallerSignal = () => callerSignal.removeEventListener("abort", listener);
	}

	/** The run's own lever, handed to the turn loop. */
	get signal(): AbortSignal {
		return this.controller.signal;
	}

	get aborted(): boolean {
		return this.controller.signal.aborted;
	}

	abort(): void {
		this.controller.abort();
	}

	/** Running or queued: still live. */
	isActive(): boolean {
		return isActiveStatus(this._status);
	}

	/** Terminated by error, harness turn-limit abort, or external stop. */
	isTerminalError(): boolean {
		return isTerminalErrorStatus(this._status);
	}

	/** Actively running (excludes queued). */
	isRunning(): boolean {
		return isRunningStatus(this._status);
	}

	/** Whether a steer message can be delivered: the run must be running. */
	canBeSteered(): boolean {
		return isRunningStatus(this._status);
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

	/** Transition to stopped state. Always valid: no guard. */
	markStopped(completedAt?: number): void {
		this._status = "stopped";
		this._completedAt = completedAt ?? Date.now();
	}

	/**
	 * Stop a run that is still awaiting a concurrency slot. Records the
	 * never-started fact only when the run is genuinely still queued, so a
	 * mis-targeted call cannot claim it.
	 */
	stopQueued(completedAt?: number): void {
		if (this._status === "queued") this._stoppedWhileQueued = true;
		this.markStopped(completedAt);
	}

	/** Record the question the run ended its turn with; undefined drops it. */
	setPendingQuestion(question: string | undefined): void {
		this._pendingQuestion = question;
	}

	/** Record what a teardown reported when no result text could carry it. */
	setWorkspaceNotice(notice: string): void {
		this._workspaceNotice = notice;
	}

	/** A resume replaced this run; its prompt is the answer to the question this run ended with. */
	markReplaced(): void {
		this._replaced = true;
	}

	/** Record an update the child sent during this run, owed to a carrier until delivered. */
	recordUpdate(message: string): void {
		this.updates.push({ message, announced: false });
	}

	/**
	 * The announcement channel delivered this message, so no outcome carrier may
	 * repeat it. Marks the first copy still owed: two identical messages are two
	 * facts the child sent twice, and one announcement delivered one of them.
	 */
	markUpdateAnnounced(message: string): void {
		const owed = this.updates.find((update) => !update.announced && update.message === message);
		if (owed) owed.announced = true;
	}

	/** Record the budget the running turn loop reports. */
	setTurnBudget(budget: TurnBudget): void {
		this._turnBudget = budget;
	}

	/**
	 * Record the parent collected this run's outcome. Idempotent — keeps the first
	 * collection time (??=), so a re-read does not advance the retention clock.
	 */
	markConsumed(at?: number): void {
		this._consumedAt ??= at ?? Date.now();
	}

	/**
	 * A carrier has committed to delivering this run's outcome, so nothing else
	 * should announce it. Unlike every other transition here, this one is
	 * revocable.
	 */
	claim(): CarrierClaim {
		const claim: CarrierClaim = { release: () => { this.claims.delete(claim); } };
		this.claims.add(claim);
		return claim;
	}

	/** Keep the record-observer unsubscribe until the run ends. */
	attachObserver(unsubscribe: () => void): void {
		this.unsubscribeObserver = unsubscribe;
	}

	/** Detach the caller signal and unsubscribe the observer. Idempotent. */
	release(): void {
		this.unsubscribeObserver?.();
		this.unsubscribeObserver = undefined;
		this.detachCallerSignal?.();
		this.detachCallerSignal = undefined;
	}
}
