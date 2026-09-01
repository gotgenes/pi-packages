/**
 * subagent.ts — Subagent class: identity, lifecycle status, and per-subagent behavior.
 *
 * Status/stats are delegated to the SubagentState value object; listener
 * lifecycle to RunListeners; workspace prepare/dispose to WorkspaceBracket.
 * Behavior (abort, steer buffering) lives here rather than on SubagentManager.
 */

import type { Model } from "@earendil-works/pi-ai";
import type { AgentSessionEvent, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { debugLog } from "#src/debug";
import type { CreateSubagentSessionParams } from "#src/lifecycle/create-subagent-session";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import { RunListeners } from "#src/lifecycle/run-listeners";
import type { SubagentSession, TurnLoopResult } from "#src/lifecycle/subagent-session";
import { SubagentState, type SubagentStatus } from "#src/lifecycle/subagent-state";
import type { LifetimeUsage } from "#src/lifecycle/usage";
import type { WorkspaceProvider } from "#src/lifecycle/workspace";
import { WorkspaceBracket } from "#src/lifecycle/workspace-bracket";
import { subscribeSubagentObserver } from "#src/observation/record-observer";
import type { RunConfig } from "#src/runtime";
import { parseQuestionForParent } from "#src/session/ask-back";
import type { CompactionInfo, ParentSessionInfo, SessionMessage, SubagentType, ThinkingLevel } from "#src/types";

/** Per-subagent lifecycle observer — created by SubagentManager for each spawn. */
export interface SubagentLifecycleObserver {
	/** Fires when the subagent transitions to running (inside run(), after markRunning). */
	onStarted?(agent: Subagent): void;
	/** Fires once the session is created — the subagent's subagentSession is now available. */
	onSessionCreated?(agent: Subagent): void;
	/** Fires once when the run completes or fails (for concurrency drain). */
	onRunFinished?(agent: Subagent): void;
	/** Fires once when a resumed run reaches a terminal state. */
	onResumeFinished?(agent: Subagent): void;
	/** Fires on compaction events during the run. */
	onCompacted?(agent: Subagent, info: CompactionInfo): void;
}

export type { SubagentStatus } from "#src/lifecycle/subagent-state";

/**
 * The result of a steer attempt. `Subagent.steer` owns the non-running
 * rejection rule and reports it here, so coordinators switch on the outcome
 * instead of pre-checking status (tell by id, with outcomes).
 */
export type SteerOutcome =
	| { kind: "delivered" }
	| { kind: "buffered" }
	| { kind: "rejected"; status: SubagentStatus };

/**
 * The execution machinery a Subagent needs to run. A single mandatory
 * collaborator: production (SubagentManager.spawn) always supplies it, so run()
 * needs no "not configured" guards. The genuinely-optional behavior knobs stay
 * optional; the four inputs run() cannot proceed without are required.
 */
export interface SubagentExecution {
	/** Assembly factory that produces a born-complete SubagentSession. */
	createSubagentSession: (params: CreateSubagentSessionParams) => Promise<SubagentSession>;
	/** Immutable spawn-time parent snapshot handed to the session factory. */
	snapshot: ParentSnapshot;
	/** Initial prompt for the turn loop. */
	prompt: string;
	/** Parent working directory handed to a workspace provider's prepare(). */
	baseCwd: string;
	observer?: SubagentLifecycleObserver;
	getRunConfig?: () => RunConfig;
	/** Resolves the registered workspace provider (if any) at run-start. */
	getWorkspaceProvider?: () => WorkspaceProvider | undefined;
	model?: Model<any>;
	maxTurns?: number;
	thinkingLevel?: ThinkingLevel;
	parentSession?: ParentSessionInfo;
	signal?: AbortSignal;
}

export interface SubagentInit {
	// Identity
	id: string;
	type: SubagentType;
	description: string;
	/** The mode SubagentManager resolved for this spawn; drives scheduling and announcement. */
	isBackground: boolean;

	/** Execution machinery — always supplied; construct-complete, no test fallbacks. */
	execution: SubagentExecution;

	/** Lifecycle status and metrics. Defaults to a fresh queued state. */
	state?: SubagentState;
}

export class Subagent {
	// Identity — set once at construction
	readonly id: string;
	readonly type: SubagentType;
	readonly description: string;
	/**
	 * Whether this agent runs in the background. Resolved once at the manager
	 * choke point, so a consumer asks the record rather than re-deriving it from
	 * a per-call display snapshot only the tool door ever built (#724).
	 */
	readonly isBackground: boolean;

	// Lifecycle status and metrics — owned by a private value object; getters and
	// mutation methods below delegate to it one line.
	private readonly state: SubagentState;
	get status(): SubagentStatus { return this.state.status; }
	get result(): string | undefined { return this.state.result; }
	get error(): string | undefined { return this.state.error; }
	get stoppedWhileQueued(): boolean { return this.state.stoppedWhileQueued; }
	get startedAt(): number { return this.state.startedAt; }
	get completedAt(): number | undefined { return this.state.completedAt; }
	get consumedAt(): number | undefined { return this.state.consumedAt; }
	get consumed(): boolean { return this.state.consumed; }
	get claimed(): boolean { return this.state.claimed; }
	get pendingQuestion(): string | undefined { return this.state.pendingQuestion; }
	get toolUses(): number { return this.state.toolUses; }
	get lifetimeUsage(): Readonly<LifetimeUsage> { return this.state.lifetimeUsage; }
	get compactionCount(): number { return this.state.compactionCount; }
	get turnCount(): number { return this.state.turnCount; }
	get activeTools(): ReadonlyMap<string, string> { return this.state.activeTools; }
	get responseText(): string { return this.state.responseText; }
	isActive(): boolean { return this.state.isActive(); }
	isTerminalError(): boolean { return this.state.isTerminalError(); }
	isRunning(): boolean { return this.state.isRunning(); }
	canBeSteered(): boolean { return this.state.canBeSteered(); }
	get maxTurns(): number | undefined { return this.execution.maxTurns; }

	readonly abortController: AbortController;
	private _promise?: Promise<void>;
	/** Handle on the agent's current run — the initial run, or the live resume that replaced it. */
	get promise(): Promise<void> | undefined { return this._promise; }

	private readonly execution: SubagentExecution;
	private readonly listeners = new RunListeners();
	private readonly workspaceBracket: WorkspaceBracket;

	subagentSession?: SubagentSession;

	// Retained after releaseSession() disposes the heavy session, so outputFile
	// (transcript pointer) survives and the resume path can tell "released" from
	// "never had a session."
	private _releasedOutputFile?: string;
	private _sessionReleased = false;
	/** True once releaseSession() has freed a live session (distinct from never having had one). */
	get sessionReleased(): boolean { return this._sessionReleased; }

	// Steer buffer — messages queued before the session is ready
	private _pendingSteers: string[] = [];
	/** Number of steer messages waiting to be delivered. */
	get pendingSteerCount(): number { return this._pendingSteers.length; }

	/**
	 * Path to the agent's session JSONL file, or undefined if not yet available.
	 * Falls back to the path captured at releaseSession() once the live session is gone.
	 */
	get outputFile(): string | undefined {
		return this.subagentSession?.outputFile ?? this._releasedOutputFile;
	}

	/** The tool call ID that spawned this background agent, if any. */
	get toolCallId(): string | undefined {
		return this.execution.parentSession?.toolCallId;
	}

	/** Returns true when a SubagentSession is available (session is ready). */
	isSessionReady(): boolean {
		return this.subagentSession != null;
	}

	/**
	 * Steer a running agent, owning the non-running rejection rule.
	 * Returns a `rejected` outcome (with the observed status) when the agent is
	 * not running, a `buffered` outcome when the session is not yet ready, or a
	 * `delivered` outcome once the message reaches the session.
	 */
	async steer(message: string): Promise<SteerOutcome> {
		if (!this.canBeSteered()) {
			return { kind: "rejected", status: this.status };
		}
		if (!this.subagentSession) {
			this.queueSteer(message);
			return { kind: "buffered" };
		}
		await this.subagentSession.steer(message);
		return { kind: "delivered" };
	}

	/** Return the session conversation as formatted text, or undefined if no session. */
	getConversation(): string | undefined {
		return this.subagentSession?.getConversation();
	}

	/** Return the session context window utilization (0-100), or null if unavailable. */
	getContextPercent(): number | null {
		return this.subagentSession?.getContextPercent() ?? null;
	}

	/**
	 * Subscribe to session events for live updates (e.g., conversation viewer).
	 * Returns an unsubscribe function, or undefined if no session is available.
	 */
	subscribeToUpdates(fn: (event: AgentSessionEvent) => void): (() => void) | undefined {
		return this.subagentSession?.subscribe(fn);
	}

	/** The session's message history, or an empty array if no session. */
	get messages(): readonly unknown[] {
		return this.subagentSession?.messages ?? [];
	}

	/** The session's message history typed for Pi's session-rendering machinery, or empty if no session. */
	get agentMessages(): readonly SessionMessage[] {
		return this.subagentSession?.agentMessages ?? [];
	}

	/** Resolve a registered tool definition by name, or undefined if no session. */
	getToolDefinition(name: string): ToolDefinition | undefined {
		return this.subagentSession?.getToolDefinition(name);
	}

	constructor(init: SubagentInit) {
		// Identity
		this.id = init.id;
		this.type = init.type;
		this.description = init.description;
		this.isBackground = init.isBackground;

		// Lifecycle status and metrics — fresh queued state unless one is supplied
		this.state = init.state ?? new SubagentState();

		// Abort controller — always created, never injected
		this.abortController = new AbortController();

		// Execution machinery — a single mandatory collaborator
		this.execution = init.execution;

		// Per-run lifecycle collaborators
		this.workspaceBracket = new WorkspaceBracket(
			this.execution.getWorkspaceProvider ?? (() => undefined),
		);
	}

	/**
	 * Execute the full agent lifecycle: workspace preparation, session creation
	 * via the factory, observer wiring, the turn loop, workspace disposal, and
	 * status transitions.
	 *
	 * Execution is supplied at construction (mandatory), so run() needs no
	 * "not configured" guards. The returned promise always resolves (errors are
	 * captured internally).
	 */
	async run(): Promise<void> {
		this.markRunning(Date.now());
		this.execution.observer?.onStarted?.(this);
		this.listeners.wireSignal(this.execution.signal, () => this.abort());

		// Guard the await so the no-provider path stays synchronous, preserving
		// the original run() timing: the factory is called in the same turn as
		// spawn() when no workspace provider is registered.
		let cwd: string | undefined;
		if (this.workspaceBracket.hasProvider()) {
			try {
				cwd = await this.workspaceBracket.prepare({
					agentId: this.id,
					agentType: this.type,
					baseCwd: this.execution.baseCwd,
				});
			} catch (err) {
				this.markError(err);
				this.listeners.release();
				this.execution.observer?.onRunFinished?.(this);
				return;
			}
		}

		try {
			this.subagentSession = await this.execution.createSubagentSession({
				snapshot: this.execution.snapshot,
				type: this.type,
				cwd,
				parentSession: this.execution.parentSession,
				model: this.execution.model,
				thinkingLevel: this.execution.thinkingLevel,
			});
		} catch (err) {
			// The factory disposed its own session on a post-creation failure.
			this.failRun(err);
			return;
		}

		this.flushPendingSteers();
		this.listeners.attachObserver(subscribeSubagentObserver(this.subagentSession, this.state, {
			onCompact: (info) => this.execution.observer?.onCompacted?.(this, info),
		}));
		this.execution.observer?.onSessionCreated?.(this);

		const runConfig = this.execution.getRunConfig?.();
		try {
			const result = await this.subagentSession.runTurnLoop(this.execution.prompt, {
				maxTurns: this.execution.maxTurns,
				defaultMaxTurns: runConfig?.defaultMaxTurns,
				graceTurns: runConfig?.graceTurns,
				signal: this.abortController.signal,
			});
			this.completeRun(result);
		} catch (err) {
			this.failRun(err);
		}
	}

	/**
	 * Start execution immediately (foreground / bypassQueue paths).
	 * Stores the run promise so it is awaitable via the `promise` getter.
	 */
	start(): void {
		this._promise = this.guardedRun();
	}

	/**
	 * Schedule execution through an external concurrency scheduler (the limiter).
	 * Captures the scheduler's promise eagerly, so a still-queued agent is
	 * awaitable via the `promise` getter from spawn — not only once its slot opens.
	 * The guard in guardedRun() makes an abort-while-queued run a no-op when the
	 * slot finally frees.
	 */
	scheduleVia(schedule: (thunk: () => Promise<void>) => Promise<void>): void {
		this._promise = schedule(() => this.guardedRun());
	}

	/**
	 * Run unless the agent left the active set before its slot opened
	 * (e.g. abort-while-queued): a non-queued, non-running status resolves
	 * immediately without running.
	 */
	private guardedRun(): Promise<void> {
		if (!this.isActive()) return Promise.resolve();
		return this.run();
	}

	/**
	 * Wait until this agent's current run settles.
	 * Resolves immediately when the agent is no longer active or has no run
	 * handle. A queued agent is awaitable because scheduleVia() captures the
	 * limiter promise at spawn, so the wait spans both the queue slot and the
	 * run that follows it.
	 *
	 * When `signal` fires the wait ends early and the agent keeps running: this
	 * is a query, so interrupting it must not cancel the work. Cancelling the
	 * work on a parent interrupt is InterruptHandler's separate decision.
	 */
	async waitUntilSettled(signal: AbortSignal): Promise<void> {
		const run = this._promise;
		if (!run || !this.isActive()) return;
		await settleOrAbort(run, signal);
	}

	/**
	 * Resume an existing session with a new prompt, managing the observer
	 * subscription lifecycle internally (same wiring as run()).
	 *
	 * Requires an existing SubagentSession (set when the original run created it).
	 * The returned promise always resolves (errors are captured internally) and is
	 * published as the `promise` getter, so waiters track the resume rather than
	 * the settled handle of the original run.
	 * The parent signal flows straight through to resumeTurnLoop — resume does not
	 * route through this.abortController.
	 */
	resume(prompt: string, signal?: AbortSignal): Promise<void> {
		const subagentSession = this.subagentSession;
		if (!subagentSession) {
			// Rejection, not a throw: this method is not async, and a synchronous
			// throw would escape a caller's `.rejects` assertion.
			return Promise.reject(new Error("Subagent not configured for resume — missing session"));
		}

		this._promise = this.runResume(subagentSession, prompt, signal);
		return this._promise;
	}

	/** The resume body. Always resolves — errors terminate through failResume(). */
	private async runResume(subagentSession: SubagentSession, prompt: string, signal?: AbortSignal): Promise<void> {
		this.resetForResume(Date.now());
		this.listeners.attachObserver(subscribeSubagentObserver(subagentSession, this.state, {
			onCompact: (info) => this.execution.observer?.onCompacted?.(this, info),
		}));

		try {
			this.completeResume(await subagentSession.resumeTurnLoop(prompt, signal));
		} catch (err) {
			this.failResume(err);
		}
	}

	/** Terminate a resume as completed: mark, release listeners, notify observer. */
	completeResume(result: string): void {
		// A child answering one question may need to ask another.
		const { question, body } = parseQuestionForParent(result);
		this.state.setPendingQuestion(question);
		this.markCompleted(body);
		this.listeners.release();
		this.execution.observer?.onResumeFinished?.(this);
	}

	/** Terminate a resume as errored: mark, release listeners, notify observer. */
	failResume(err: unknown): void {
		this.markError(err);
		this.listeners.release();
		this.execution.observer?.onResumeFinished?.(this);
	}

	/** Transition to running state. Sets status and startedAt. */
	markRunning(startedAt: number): void {
		this.state.markRunning(startedAt);
	}

	/**
	 * Transition to completed state.
	 * Always sets result and completedAt (??=). Only changes status if not stopped.
	 */
	markCompleted(result: string, completedAt?: number): void {
		this.state.markCompleted(result, completedAt);
	}

	/**
	 * Transition to aborted state.
	 * Always sets result and completedAt (??=). Only changes status if not stopped.
	 */
	markAborted(result: string, completedAt?: number): void {
		this.state.markAborted(result, completedAt);
	}

	/**
	 * Transition to steered state.
	 * Always sets result and completedAt (??=). Only changes status if not stopped.
	 */
	markSteered(result: string, completedAt?: number): void {
		this.state.markSteered(result, completedAt);
	}

	/**
	 * Transition to error state.
	 * Always sets error (formatted) and completedAt (??=). Only changes status if not stopped.
	 */
	markError(error: unknown, completedAt?: number): void {
		this.state.markError(error, completedAt);
	}

	/** Transition to stopped state. Always valid — no guard. */
	markStopped(completedAt?: number): void {
		this.state.markStopped(completedAt);
	}

	/** Record the parent collected this agent's outcome. Idempotent. */
	markConsumed(at?: number): void {
		this.state.markConsumed(at);
	}

	/** A carrier has committed to delivering this outcome; nothing else announces it. */
	claim(): void {
		this.state.claim();
	}

	/** The carrier abandoned its commitment; announcing is owed again. */
	// Called on the `Subagent` returned by `getRecord()` from get-result-tool.ts
	// and agent-tool.ts, both of which declare it through their own structural
	// interface — fallow cannot trace through interfaces.
	// fallow-ignore-next-line unused-class-member
	release(): void {
		this.state.release();
	}

	/**
	 * Stop an agent that never started, then notify like every other terminal
	 * transition. No listener release: nothing is wired before run().
	 * The record leaves the active set here, so the thunk the limiter runs when
	 * the slot finally frees no-ops on guardedRun()'s guard — one notification.
	 */
	stopQueued(): void {
		this.state.stopQueued();
		this.execution.observer?.onRunFinished?.(this);
	}

	/**
	 * Abort a running agent: fire AbortController and transition to stopped.
	 * Returns false if the agent is not running.
	 * A still-queued agent is stopped via stopQueued(); its scheduled thunk
	 * then no-ops on the queued-status guard.
	 */
	abort(): boolean {
		if (!this.isRunning()) return false;
		this.abortController.abort();
		this.markStopped();
		return true;
	}

	/**
	 * Buffer a steer message for delivery once the session is ready.
	 * Called internally from steer() before the session is ready.
	 */
	private queueSteer(message: string): void {
		this._pendingSteers.push(message);
	}

	/**
	 * Flush all buffered steer messages to the session and clear the buffer.
	 * Called once the session is available (inside run()).
	 */
	private flushPendingSteers(): void {
		for (const msg of this._pendingSteers) {
			this.subagentSession?.steer(msg).catch(() => {});
		}
		this._pendingSteers = [];
	}

	/** Reset for resume: running status, new startedAt, clear completedAt/result/error/consumedAt/listeners. */
	resetForResume(startedAt: number): void {
		this.state.resetForResume(startedAt);
		this.listeners.release();
	}

	/** Complete a run: release listeners, dispose the workspace, status transition, notify observer. */
	completeRun(result: TurnLoopResult): void {
		this.listeners.release();

		const finalStatus: SubagentStatus = result.aborted
			? "aborted"
			: result.steered
				? "steered"
				: "completed";
		const finalResult =
			result.responseText +
			this.workspaceBracket.dispose({ status: finalStatus, description: this.description });

		// Split the declared question out before the result is stored, so the
		// question renders once as an affordance rather than twice.
		const { question, body } = parseQuestionForParent(finalResult);
		this.state.setPendingQuestion(question);

		if (result.aborted) this.markAborted(body);
		else if (result.steered) this.markSteered(body);
		else this.markCompleted(body);

		this.execution.observer?.onRunFinished?.(this);
	}

	/**
	 * Dispose the wrapped session, firing the `disposed` lifecycle event.
	 * Resolves once the child's extensions have shut down; a failing teardown is
	 * swallowed so the caller's remaining cleanup still runs.
	 */
	async disposeSession(): Promise<void> {
		await disposeQuietly(this.subagentSession, "child session dispose");
	}

	/**
	 * Release the heavy session while keeping the record: capture the transcript
	 * pointer, dispose the session (firing `disposed`), clear it, and mark released.
	 * A no-op once the session is gone — the retention sweep may call it repeatedly.
	 *
	 * The record's own state is updated before the teardown is awaited, so a sweep
	 * tick arriving mid-teardown sees a released record rather than starting a
	 * second one.
	 */
	async releaseSession(): Promise<void> {
		const session = this.subagentSession;
		if (!session) return;
		this._releasedOutputFile = session.outputFile;
		this.subagentSession = undefined;
		this._sessionReleased = true;
		await disposeQuietly(session, "child session release");
	}

	/** Fail a run: mark error, release listeners, best-effort workspace dispose, notify observer. */
	failRun(err: unknown): void {
		this.markError(err);
		this.listeners.release();

		try {
			this.workspaceBracket.dispose({ status: "error", description: this.description });
		} catch (cleanupErr) { debugLog("workspace dispose on agent error", cleanupErr); }

		this.execution.observer?.onRunFinished?.(this);
	}
}

/**
 * Tear a child session down without letting its failure escape.
 * Both teardown paths are cleanup: a child that will not shut down cleanly must
 * not stop the caller from finishing the rest of its own cleanup.
 */
async function disposeQuietly(
	session: SubagentSession | undefined,
	context: string,
): Promise<void> {
	try {
		await session?.dispose();
	} catch (err) {
		debugLog(context, err);
	}
}

/**
 * Settle with `run`, or early when `signal` fires — whichever comes first.
 * The inner controller is the listener-cleanup channel: it detaches the abort
 * listener whichever branch wins, so repeated waits within one parent turn do
 * not accumulate listeners on that turn's signal.
 */
function settleOrAbort(run: Promise<void>, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.resolve();
	const detach = new AbortController();
	const interrupted = new Promise<void>((resolve) => {
		signal.addEventListener("abort", () => { resolve(); }, { once: true, signal: detach.signal });
	});
	return Promise.race([run, interrupted]).finally(() => { detach.abort(); });
}
