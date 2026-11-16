/**
 * subagent-state.ts — SubagentState value object: metrics and live activity, and the status vocabulary.
 *
 * Owns the passive, readable state of a subagent that spans its runs — stats
 * (toolUses, lifetimeUsage, compactionCount), live-activity fields
 * (activeTools, responseText, lastProgressAt) — together with the accumulation
 * methods (incrementToolUses, addUsage, incrementCompactions) and live-activity
 * transition methods (addActiveTool, removeActiveTool, resetResponseText,
 * appendResponseText, markProgress) that mutate them. A run's outcome lives on
 * its SubagentRun.
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
	| "aborted"
	| "stopped"
	| "error";

// ---- Status classification predicates ----
// The single decision point for the re-derived status groupings. Instance
// methods on SubagentRun delegate here; DTO consumers holding a bare
// SubagentStatus (no SubagentState instance) call these directly.

/** Running or queued — the agent is still live (started or awaiting a slot). */
export function isActiveStatus(status: SubagentStatus): boolean {
	return status === "running" || status === "queued";
}

/** Terminated by error, harness turn-limit abort, or external stop. */
export function isTerminalErrorStatus(status: SubagentStatus): boolean {
	return status === "error" || status === "stopped" || status === "aborted";
}

/** Actively running (excludes queued). */
export function isRunningStatus(status: SubagentStatus): boolean {
	return status === "running";
}

export interface SubagentStateInit {
	/** When the run last made progress; defaults to when the state was created. */
	lastProgressAt?: number;
	// Stats — seed a populated value without replaying the accumulation methods
	toolUses?: number;
	lifetimeUsage?: LifetimeUsage;
	compactionCount?: number;
	// Live activity — activeTools is seeded by name (each entry calls addActiveTool)
	activeTools?: string[];
	responseText?: string;
}

export class SubagentState {
	// Stats — accumulated via mutation methods, readable via getters
	private _toolUses: number;
	get toolUses(): number { return this._toolUses; }

	private _lifetimeUsage: LifetimeUsage;
	get lifetimeUsage(): Readonly<LifetimeUsage> { return this._lifetimeUsage; }

	private _compactionCount: number;
	get compactionCount(): number { return this._compactionCount; }

	// Live activity — accumulated via transition methods, readable via getters
	private _activeTools = new Map<string, string>();
	get activeTools(): ReadonlyMap<string, string> { return this._activeTools; }

	private _toolKeySeq = 0;

	private _responseText: string;
	get responseText(): string { return this._responseText; }

	/** When the current run last emitted a session event; its start until it emits one. */
	private _lastProgressAt: number;
	get lastProgressAt(): number { return this._lastProgressAt; }

	constructor(init: SubagentStateInit = {}) {
		this._lastProgressAt = init.lastProgressAt ?? Date.now();
		this._toolUses = init.toolUses ?? 0;
		// Copy so a later addUsage() cannot mutate the caller's object.
		this._lifetimeUsage = init.lifetimeUsage
			? { ...init.lifetimeUsage }
			: { input: 0, output: 0, cacheWrite: 0 };
		this._compactionCount = init.compactionCount ?? 0;
		this._responseText = init.responseText ?? "";
		for (const name of init.activeTools ?? []) {
			this.addActiveTool(name);
		}
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

	/** Record that the run made progress. Called by record-observer on every session event. */
	markProgress(at: number = Date.now()): void {
		this._lastProgressAt = at;
	}
}
