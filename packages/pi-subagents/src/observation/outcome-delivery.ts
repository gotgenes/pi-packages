/**
 * outcome-delivery.ts — Shared rendering for a subagent outcome.
 *
 * A terminated child's outcome reaches the parent model through exactly one
 * carrier: the foreground tool return, the resume tool return, the
 * `get_subagent_result` report, or the completion nudge. Each carrier owns its
 * own framing (spawn notes, XML envelope, report header) and its own
 * truncation — a nudge is a preview, a pull is the full text — but the body
 * they wrap is the same fact, so it is rendered here rather than four times.
 *
 * Pure functions only: no SDK types, no record types, no side effects.
 */

import type { SubagentStatus } from "#src/lifecycle/subagent-state";

/**
 * Only what the body formatter reads. Narrower than any record type so a
 * caller cannot come to depend on fields this module does not use.
 */
export interface OutcomeBody {
	status: SubagentStatus;
	result: string | undefined;
	error: string | undefined;
	/** Whether the agent was stopped before the limiter ever admitted it. */
	stoppedWhileQueued: boolean;
}

/**
 * The outcome body every carrier reports: a running note, an error line, a
 * never-started note, or the trimmed result.
 */
export function renderOutcomeBody(outcome: OutcomeBody): string {
	if (outcome.status === "running")
		return "Agent is still running. Use wait: true or check back later.";
	if (outcome.status === "error") return `Error: ${outcome.error}`;
	if (outcome.stoppedWhileQueued)
		return "Agent was stopped while queued and never started. No work was performed.";
	return outcome.result?.trim() ?? "No output.";
}
