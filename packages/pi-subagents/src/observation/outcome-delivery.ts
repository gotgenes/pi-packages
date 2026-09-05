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
 * A workspace notice rides the same four carriers without being part of the
 * outcome: it reports where a teardown put the child's work, which the parent
 * needs whether the run succeeded or failed. A notice produced after the
 * result was already delivered reaches none of them and is announced on its
 * own instead.
 *
 * Pure functions only: no SDK types, no record types, no side effects.
 */

import type { SubagentStatus } from "#src/lifecycle/subagent-state";

/**
 * What a terminal status means, independent of how a carrier renders it.
 *
 * One source of truth for the facts, because the carriers disagreed on them:
 * the nudge reported an abort as "max turns exceeded" while the foreground
 * result added "output may be incomplete", and the pull and resume carriers
 * reported nothing at all. Presentation still differs — see the two renderers
 * below — because a standalone label and a mid-sentence parenthetical are
 * different grammar, not different facts.
 */
interface StatusMeaning {
	/** Sentence-initial label, e.g. "Wrapped up". */
	label: string;
	/** Why, without terminal punctuation, e.g. "reached turn limit". */
	detail: string;
}

const STATUS_MEANINGS: Partial<Record<SubagentStatus, StatusMeaning>> = {
	aborted: { label: "Aborted", detail: "max turns exceeded, output may be incomplete" },
	steered: { label: "Wrapped up", detail: "reached turn limit" },
	// "user request" rather than "stopped by user": the detail must stand on its
	// own after the label, which both presentations already supply.
	stopped: { label: "Stopped", detail: "user request" },
};

/**
 * Standalone label form, e.g. "Wrapped up (reached turn limit)".
 *
 * An error reports its message instead: the status alone does not say what
 * went wrong.
 */
export function renderStatusLabel(status: SubagentStatus, error?: string): string {
	if (status === "error") return `Error: ${error ?? "unknown"}`;
	const meaning = STATUS_MEANINGS[status];
	return meaning ? `${meaning.label} (${meaning.detail})` : "Done";
}

/**
 * Parenthetical suffix form, e.g. " (wrapped up — reached turn limit)", for a
 * carrier appending to its own sentence. Empty when the status is unremarkable
 * or when the body already carries the explanation, as an error's does.
 */
export function renderStatusNote(status: SubagentStatus): string {
	const meaning = STATUS_MEANINGS[status];
	if (!meaning) return "";
	return ` (${meaning.label.toLowerCase()} \u2014 ${meaning.detail})`;
}

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
 * The trailing affordance for a child that ended its turn with a question,
 * naming the exact call that answers it. Empty when the child asked nothing.
 *
 * Takes the id and question rather than a record: the two facts it needs, so a
 * carrier holding any shape can call it.
 */
export function renderQuestionAffordance(agentId: string, question: string | undefined): string {
	if (!question) return "";
	const quoted = question
		.split("\n")
		.map((line) => `  ${line}`)
		.join("\n");
	return (
		`\n\nThis agent is waiting on an answer:\n\n${quoted}\n\n` +
		`Answer by calling subagent with resume: "${agentId}" and your answer as the prompt.`
	);
}

/**
 * The provider's own wording for where a teardown left the child's work, for a
 * carrier appending it after the outcome body. Empty when no teardown reported
 * anything — including every run whose addendum rode the result text instead.
 *
 * Takes the notice rather than a record, so a carrier holding any shape can
 * call it, and so the framing has one home if a carrier ever needs its own.
 */
export function renderWorkspaceNotice(notice: string | undefined): string {
	return notice ?? "";
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
