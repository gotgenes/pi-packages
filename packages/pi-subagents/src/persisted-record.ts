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
	/** Whether a `WorkspaceProvider` prepared the directory the child ran in, rather than the child running where its parent does. */
	readonly providerWorkspace: boolean;
}

/**
 * The fields a reader validates and returns: what labels a past run, opens its
 * transcript, and decides whether a later manager may continue it.
 *
 * `turnBudget` and `providerWorkspace` read `undefined` when the entry does not
 * say: `turnBudget` is absent for a run that never reached its turn loop, and
 * `providerWorkspace` for an entry written before it was recorded.
 */
export type PersistedRunSummary = Pick<
	PersistedSubagentRecord,
	"id" | "type" | "description" | "status" | "startedAt" | "completedAt" | "stoppedWhileQueued" | "toolUses" | "outputFile" | "turnBudget"
> & { readonly providerWorkspace: boolean | undefined };

/** The session-entry fields the reader inspects; Pi's `SessionEntry` satisfies it. */
export interface SessionEntryLike {
	readonly type: string;
	readonly customType?: string;
	readonly data?: unknown;
}

/**
 * What the entry takes from the agent: who it is, where its transcript is, its
 * cross-run tool count, and whether a provider prepared the directory all its
 * runs share.
 */
type PersistedIdentity = Pick<
	PersistedSubagentRecord,
	"id" | "type" | "description" | "outputFile" | "toolUses" | "providerWorkspace"
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
		providerWorkspace: identity.providerWorkspace,
	};
}

/**
 * Read every persisted run out of a session's entries, newest first.
 *
 * A resumed run appends a second entry under the same id, so the last one wins.
 * Entries that do not validate are skipped, including those written before the
 * entry recorded `toolUses`. One written before the entry recorded
 * `stoppedWhileQueued` reads as not stopped while queued. A turn budget or
 * workspace provenance that does not validate reads as unknown rather than
 * hiding the run.
 */
export function readPersistedRuns(entries: readonly SessionEntryLike[]): PersistedRunSummary[] {
	const runs = new Map<string, PersistedRunSummary>();
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== SUBAGENT_RECORD_ENTRY) continue;
		const run = asRunSummary(entry.data);
		if (run) runs.set(run.id, run);
	}
	return [...runs.values()].sort((a, b) => b.startedAt - a.startedAt);
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
	const {
		id,
		type,
		description,
		status,
		startedAt,
		completedAt,
		stoppedWhileQueued,
		toolUses,
		outputFile,
		turnBudget,
		providerWorkspace,
	} = data as Record<string, unknown>;
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
		turnBudget: asTurnBudget(turnBudget),
		providerWorkspace: typeof providerWorkspace === "boolean" ? providerWorkspace : undefined,
	};
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
