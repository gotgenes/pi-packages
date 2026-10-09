/**
 * get-result-report.ts — Pure report assembly for get_subagent_result.
 *
 * All functions are stateless: they receive an AgentReport, returning
 * formatted strings. No SDK types, no timers, no side effects.
 * Consumed by GetResultTool.execute in get-result-tool.ts. Mirrors the
 * result-renderer.ts pattern used by the subagent tool's TUI renderer.
 */

import type { ResumeRefusal, SubagentStatus } from "#src/lifecycle/subagent";
import type { TurnBudget } from "#src/lifecycle/turn-limits";
import {
	renderOutcomeAddenda,
	renderOutcomeBody,
	renderStatusNote,
} from "#src/observation/outcome-delivery";

/** The data a get_subagent_result report renders from — only what the formatter reads. */
export interface AgentReport {
	id: string;
	displayName: string;
	status: SubagentStatus;
	toolUses: number;
	/** Pre-formatted lifetime token total; "" when zero. */
	tokens: string;
	contextPercent: number | null;
	compactionCount: number;
	/** Pre-formatted duration string. */
	duration: string;
	description: string;
	result: string | undefined;
	error: string | undefined;
	/** The run's turn limit and its use; absent when no limit applied. */
	turnBudget?: TurnBudget;
	/** Whether the agent was stopped before the limiter ever admitted it. */
	stoppedWhileQueued: boolean;
	/** Present only when verbose was requested and a conversation is available. */
	conversation?: string;
	/** Persisted transcript path; rendered as a pointer so the parent can read it directly. */
	transcriptPath?: string;
	/** The updates the agent sent while this call's carrier held the outcome. */
	runUpdates?: readonly string[];
	/** The question the agent ended its turn with, when it declared one. */
	pendingQuestion?: string;
	/**
	 * Why a resume would be refused; undefined when one would be accepted.
	 * Required, for the reason `OutcomeAddenda` gives.
	 */
	resumeRefusal: ResumeRefusal | undefined;
	/** Where a teardown with no result text to carry it saved the agent's work. */
	workspaceNotice?: string;
	/**
	 * The model's `provider/id`; undefined while an inherited model is still unknown.
	 * Required, so a report builder cannot leave it out by omission.
	 */
	model: string | undefined;
	/**
	 * The run this report describes was replaced by a resume before the call's
	 * wait returned, so the agent is running again.
	 */
	resumedWhileWaiting?: boolean;
	/** The bound, in seconds, of a wait that ended at it with the agent still running. */
	waitExpiredAfter?: number;
	/** What a running agent is doing and when it last moved; absent for any other status. */
	progress?: ReportProgress;
}

/** A running agent's progress facts, pre-formatted for the report. */
interface ReportProgress {
	/** What the agent is doing now, as the widget words it. */
	activity: string;
	/** Turns the run has completed; absent before its turn loop reports a budget. */
	turns: number | undefined;
	/** Pre-formatted time since the run's last session event. */
	sinceLastProgress: string;
}

/** Assemble the stats parts: Tool uses / tokens? / Context? / Compactions? / Duration. */
export function renderStatsParts(report: AgentReport): string[] {
	const parts = [`Tool uses: ${report.toolUses}`];
	if (report.tokens) parts.push(report.tokens);
	if (report.contextPercent !== null) parts.push(`Context: ${Math.round(report.contextPercent)}%`);
	if (report.compactionCount) parts.push(`Compactions: ${report.compactionCount}`);
	parts.push(`Duration: ${report.duration}`);
	return parts;
}

/**
 * Select the per-status body. `AgentReport` structurally satisfies
 * `OutcomeBody`, so this is the shared renderer under this carrier's name.
 */
export function renderReportBody(report: AgentReport): string {
	return renderOutcomeBody(report);
}

/** Assemble the full get_subagent_result report text. */
export function formatAgentReport(report: AgentReport): string {
	let output =
		`Agent: ${report.id}\n` +
		`Type: ${report.displayName} | Status: ${report.status}${renderStatusNote(report)} | ${renderStatsParts(report).join(" | ")}\n` +
		(report.model ? `Model: ${report.model}\n` : "") +
		(report.progress ? `${renderProgressLine(report.progress)}\n` : "") +
		`Description: ${report.description}\n\n`;
	output += renderReportBody(report);
	output += renderOutcomeAddenda(report);
	if (report.resumedWhileWaiting) {
		output +=
			"\n\nThis agent was resumed before this wait returned and is running again \u2014 " +
			"call get_subagent_result for that run's outcome.";
	}
	if (report.waitExpiredAfter !== undefined) {
		output += renderWaitExpired(report.waitExpiredAfter);
	}
	if (report.conversation) {
		output += `\n\n--- Agent Conversation ---\n${report.conversation}`;
	}
	if (report.transcriptPath) {
		output += `\n\nFull transcript available at: ${report.transcriptPath}`;
	}
	return output;
}

/**
 * Says the bound ended the wait, not the agent, and why waiting again on
 * unchanged progress is the wrong next move: a model that reads bash's timeout
 * as a kill would otherwise assume the agent stopped, or poll it forever.
 */
function renderWaitExpired(seconds: number): string {
	return (
		`\n\nThis wait ended after its ${seconds}s timeout. The agent was not stopped and is still running.\n` +
		"If its progress has not changed since your last check, waiting again will not unstick it: " +
		"read its transcript, steer it with steer_subagent, or tell the user it appears stuck."
	);
}

/** One line saying what a running agent is doing and how long since it last moved. */
function renderProgressLine(progress: ReportProgress): string {
	const parts = [`Progress: ${progress.activity}`];
	if (progress.turns !== undefined) parts.push(`Turns: ${progress.turns}`);
	parts.push(`Last progress: ${progress.sinceLastProgress} ago`);
	return parts.join(" | ");
}
