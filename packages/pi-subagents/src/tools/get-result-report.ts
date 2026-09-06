/**
 * get-result-report.ts — Pure report assembly for get_subagent_result.
 *
 * All functions are stateless: they receive an AgentReport, returning
 * formatted strings. No SDK types, no timers, no side effects.
 * Consumed by GetResultTool.execute in get-result-tool.ts. Mirrors the
 * result-renderer.ts pattern used by the subagent tool's TUI renderer.
 */

import type { SubagentStatus } from "#src/lifecycle/subagent";
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
	/** Where a teardown with no result text to carry it saved the agent's work. */
	workspaceNotice?: string;
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
		`Type: ${report.displayName} | Status: ${report.status}${renderStatusNote(report.status)} | ${renderStatsParts(report).join(" | ")}\n` +
		`Description: ${report.description}\n\n`;
	output += renderReportBody(report);
	output += renderOutcomeAddenda(report);
	if (report.conversation) {
		output += `\n\n--- Agent Conversation ---\n${report.conversation}`;
	}
	if (report.transcriptPath) {
		output += `\n\nFull transcript available at: ${report.transcriptPath}`;
	}
	return output;
}
