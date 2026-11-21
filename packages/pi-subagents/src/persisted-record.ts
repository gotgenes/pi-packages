/**
 * persisted-record.ts — The `subagents:record` session-entry contract.
 *
 * Each terminal run is appended to the parent session as a custom entry, so the
 * session file outlives the in-memory `SubagentManager` (a `/reload` rebuilds
 * the extension; a `/resume` reopens the file). This module owns the entry's
 * shape on both sides: the writer (`SubagentEventsObserver`) builds it here,
 * and readers parse it here.
 */

import type { SubagentStatus } from "#src/lifecycle/subagent-state";
import type { TurnBudget } from "#src/lifecycle/turn-limits";
import type { LifetimeUsage } from "#src/lifecycle/usage";
import type { SubagentType } from "#src/types";

/** The `customType` every persisted run record is appended under. */
export const SUBAGENT_RECORD_ENTRY = "subagents:record";

/** What is appended for each terminal run. */
export interface PersistedSubagentRecord {
	readonly id: string;
	readonly type: SubagentType;
	readonly description: string;
	readonly status: SubagentStatus;
	readonly result: string | undefined;
	readonly error: string | undefined;
	readonly turnBudget: TurnBudget | undefined;
	readonly startedAt: number;
	readonly completedAt: number | undefined;
	/** Whether the run was stopped before the limiter admitted it. */
	readonly stoppedWhileQueued: boolean;
	/** The run's session JSONL, which a reader can open after the live session is gone. */
	readonly outputFile: string | undefined;
	readonly toolUses: number;
	/** Token usage across every run of the child so far, like `toolUses`. */
	readonly lifetimeUsage: Readonly<LifetimeUsage>;
	/** Compactions across every run of the child so far. */
	readonly compactionCount: number;
	/** The Pi session id of the child's transcript, which a later manager requires its header to still name. */
	readonly sessionId: string | undefined;
	/** The last entry the child's transcript held when the run ended, which a reopened transcript must still contain. */
	readonly transcriptLeafId: string | undefined;
	/** Which definition of its agent type the child ran under (`definitionOf`): a file path, or `builtin`. */
	readonly agentDefinition: string | undefined;
	/** Whether a `WorkspaceProvider` prepared the directory the child ran in, rather than the child running where its parent does. */
	readonly providerWorkspace: boolean;
}

/** The fields a reader validates and returns: what labels a past run and opens its transcript. */
export type PersistedRunSummary = Pick<
	PersistedSubagentRecord,
	"id" | "type" | "description" | "status" | "startedAt" | "completedAt" | "stoppedWhileQueued" | "toolUses" | "outputFile"
>;

/**
 * What a later manager continues a settled child from: its last recorded run,
 * the transcript that run names and the identity that proves it, the cumulative
 * metrics to carry on from, and the turn budget its runs last recorded.
 */
export interface RestorableRun {
	readonly summary: PersistedRunSummary;
	readonly outputFile: string;
	readonly sessionId: string;
	readonly transcriptLeafId: string;
	readonly agentDefinition: string;
	readonly providerWorkspace: boolean;
	readonly lifetimeUsage: LifetimeUsage;
	readonly compactionCount: number;
	/**
	 * The latest budget any of the child's runs recorded, so a later run that
	 * never reached its turn loop does not hide the ceiling an earlier one ran
	 * under; undefined when none of them reached it.
	 */
	readonly turnBudget: TurnBudget | undefined;
}

/**
 * What the parent session records about one child, for restoring it:
 * `unrecorded` when no run carries its id, `unprovable` when its last run
 * names no transcript or lacks what identifies one (an entry written before
 * that was recorded), and otherwise the run to continue.
 */
export type ChildRestoreRecord =
	| { readonly kind: "unrecorded" }
	| { readonly kind: "unprovable"; readonly outputFile: string | undefined }
	| { readonly kind: "restorable"; readonly run: RestorableRun };

/** The session-entry fields the reader inspects; Pi's `SessionEntry` satisfies it. */
export interface SessionEntryLike {
	readonly type: string;
	readonly customType?: string;
	readonly data?: unknown;
}

/**
 * What the entry takes from the agent: who it is, the transcript all its runs
 * share and what identifies it, the definition its session was assembled
 * under, its cross-run metrics, and whether a provider prepared its directory.
 * Read when the entry is written, so the latest entry under an id carries the
 * agent's latest.
 */
type PersistedIdentity = Pick<
	PersistedSubagentRecord,
	| "id"
	| "type"
	| "description"
	| "outputFile"
	| "toolUses"
	| "lifetimeUsage"
	| "compactionCount"
	| "sessionId"
	| "transcriptLeafId"
	| "agentDefinition"
	| "providerWorkspace"
>;

/** What the entry takes from the run that ended. */
type PersistedOutcome = Pick<
	PersistedSubagentRecord,
	"status" | "result" | "error" | "turnBudget" | "startedAt" | "completedAt" | "stoppedWhileQueued"
>;

/**
 * Build the entry for one terminal run: the outcome from that run, the rest
 * from its agent. A `Subagent` satisfies the identity and a `RunOutcome` the
 * outcome structurally; copying field by field keeps everything else off the
 * entry.
 */
export function toPersistedRecord(identity: PersistedIdentity, outcome: PersistedOutcome): PersistedSubagentRecord {
	return {
		id: identity.id,
		type: identity.type,
		description: identity.description,
		status: outcome.status,
		result: outcome.result,
		error: outcome.error,
		turnBudget: outcome.turnBudget,
		startedAt: outcome.startedAt,
		completedAt: outcome.completedAt,
		stoppedWhileQueued: outcome.stoppedWhileQueued,
		outputFile: identity.outputFile,
		toolUses: identity.toolUses,
		// Copy: the agent keeps accumulating into its own object.
		lifetimeUsage: { ...identity.lifetimeUsage },
		compactionCount: identity.compactionCount,
		sessionId: identity.sessionId,
		transcriptLeafId: identity.transcriptLeafId,
		agentDefinition: identity.agentDefinition,
		providerWorkspace: identity.providerWorkspace,
	};
}

/**
 * Read every persisted run out of a session's entries, newest first.
 *
 * A resumed run appends a second entry under the same id, so the last one wins.
 * Entries that do not validate are skipped, including those written before the
 * entry recorded `toolUses`. One written before the entry recorded
 * `stoppedWhileQueued` reads as not stopped while queued.
 */
export function readPersistedRuns(entries: readonly SessionEntryLike[]): PersistedRunSummary[] {
	const runs = new Map<string, PersistedRunSummary>();
	for (const data of recordData(entries)) {
		const run = asRunSummary(data);
		if (run) runs.set(run.id, run);
	}
	return [...runs.values()].sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * What the parent session records about the child `id`, for a later manager to
 * continue it. The last valid entry under the id is its run, as for
 * `readPersistedRuns`, and carries the transcript identity and cumulative
 * metrics the agent had when it was written; its turn budget is the latest any
 * of its entries recorded.
 */
export function readRestorableRun(entries: readonly SessionEntryLike[], id: string): ChildRestoreRecord {
	let last: { summary: PersistedRunSummary; data: Record<string, unknown> } | undefined;
	let turnBudget: TurnBudget | undefined;
	for (const data of recordData(entries)) {
		const summary = asRunSummary(data);
		if (summary?.id !== id) continue;
		last = { summary, data: data as Record<string, unknown> };
		turnBudget = asTurnBudget(last.data.turnBudget) ?? turnBudget;
	}
	if (!last) return { kind: "unrecorded" };
	const provenance = asProvenance(last.data);
	const { outputFile } = last.summary;
	if (!provenance || outputFile === undefined) return { kind: "unprovable", outputFile };
	return { kind: "restorable", run: { summary: last.summary, outputFile, ...provenance, turnBudget } };
}

/** The `data` of every `subagents:record` entry, in session order. */
function* recordData(entries: readonly SessionEntryLike[]): Generator {
	for (const entry of entries) {
		if (entry.type === "custom" && entry.customType === SUBAGENT_RECORD_ENTRY) yield entry.data;
	}
}

const SUBAGENT_STATUSES: ReadonlySet<string> = new Set<SubagentStatus>([
	"queued",
	"running",
	"completed",
	"aborted",
	"stopped",
	"error",
]);

function asRunSummary(data: unknown): PersistedRunSummary | undefined {
	if (typeof data !== "object" || data === null) return undefined;
	const { id, type, description, status, startedAt, completedAt, stoppedWhileQueued, toolUses, outputFile } =
		data as Record<string, unknown>;
	if (typeof id !== "string" || typeof type !== "string" || typeof description !== "string") return undefined;
	if (typeof status !== "string" || !SUBAGENT_STATUSES.has(status)) return undefined;
	if (typeof startedAt !== "number" || typeof toolUses !== "number") return undefined;
	if (completedAt !== undefined && typeof completedAt !== "number") return undefined;
	if (outputFile !== undefined && typeof outputFile !== "string") return undefined;
	if (stoppedWhileQueued !== undefined && typeof stoppedWhileQueued !== "boolean") return undefined;
	return {
		id,
		type,
		description,
		status: status as SubagentStatus,
		startedAt,
		completedAt,
		stoppedWhileQueued: stoppedWhileQueued ?? false,
		toolUses,
		outputFile,
	};
}

type Provenance = Pick<
	RestorableRun,
	"sessionId" | "transcriptLeafId" | "agentDefinition" | "providerWorkspace" | "lifetimeUsage" | "compactionCount"
>;

/** What an entry records to identify and continue its transcript, or undefined when any of it is missing. */
function asProvenance(data: Record<string, unknown>): Provenance | undefined {
	const { sessionId, transcriptLeafId, agentDefinition, providerWorkspace, lifetimeUsage, compactionCount } = data;
	const usage = asLifetimeUsage(lifetimeUsage);
	if (!isNonEmpty(sessionId) || !isNonEmpty(transcriptLeafId) || !isNonEmpty(agentDefinition)) return undefined;
	if (typeof providerWorkspace !== "boolean" || typeof compactionCount !== "number" || !usage) return undefined;
	return { sessionId, transcriptLeafId, agentDefinition, providerWorkspace, lifetimeUsage: usage, compactionCount };
}

function asLifetimeUsage(data: unknown): LifetimeUsage | undefined {
	if (typeof data !== "object" || data === null) return undefined;
	const { input, output, cacheWrite } = data as Record<string, unknown>;
	const counts = [input, output, cacheWrite];
	if (!counts.every((count) => typeof count === "number")) return undefined;
	return { input: input as number, output: output as number, cacheWrite: cacheWrite as number };
}

function isNonEmpty(value: unknown): value is string {
	return typeof value === "string" && value !== "";
}

const TURN_BUDGET_PHASES: ReadonlySet<string> = new Set<TurnBudget["phase"]>(["within", "warned", "exhausted"]);

/** A recorded turn budget, or undefined when there is none or it does not validate. */
function asTurnBudget(data: unknown): TurnBudget | undefined {
	if (typeof data !== "object" || data === null) return undefined;
	const { maxTurns, used, phase } = data as Record<string, unknown>;
	if (typeof used !== "number" || typeof phase !== "string" || !TURN_BUDGET_PHASES.has(phase)) return undefined;
	if (maxTurns === undefined) return { used, phase: phase as TurnBudget["phase"] };
	if (typeof maxTurns !== "number") return undefined;
	return { maxTurns, used, phase: phase as TurnBudget["phase"] };
}
