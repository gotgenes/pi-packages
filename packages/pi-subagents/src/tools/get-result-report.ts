/**
 * get-result-report.ts — Pure report assembly for get_subagent_result.
 *
 * All functions are stateless: they receive an AgentReport, returning
 * formatted strings. No SDK types, no timers, no side effects.
 * Consumed by GetResultTool.execute in get-result-tool.ts. Mirrors the
 * result-renderer.ts pattern used by the subagent tool's TUI renderer.
 */

import type { SubagentStatus } from "#src/lifecycle/subagent";

/** The data a get_subagent_result report renders from — only what the formatter reads. */
export interface AgentReport {
	id: string;
	displayName: string;
	status: SubagentStatus;
	toolUses: number;
	/** Pre-formatted lifetime token total; "" when zero. */
	tokens: string;
	/** Lifetime token breakdown (accumulated across compactions). */
	tokensIn?: number;
	tokensOut?: number;
	tokensCacheWrite?: number;
	/** Agentic turns so far. */
	turnCount?: number;
	maxTurns?: number;
	/** Tools currently executing (live activity). */
	activeTools?: string[];
	/** Rolling snippet of the assistant's in-flight response text. */
	responseSnippet?: string;
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

/** Select the per-status body: running note, error line, or trimmed result. */
export function renderReportBody(report: AgentReport): string {
	if (report.status === "running") {
		const lines = [
			"Agent is still actively working — not waiting for it. Collect its result after the completion notification, or pass wait: true to block explicitly.",
		];
		if (report.activeTools?.length)
			lines.push(`Current activity: running tool(s) ${report.activeTools.join(", ")}`);
		else if (report.responseSnippet)
			lines.push(`Current activity: generating response ("${report.responseSnippet}")`);
		else lines.push("Current activity: idle between turns");
		if (report.turnCount != null)
			lines.push(
				`Turns: ${report.turnCount}${report.maxTurns ? `/${report.maxTurns}` : ""} | Tool calls: ${report.toolUses}`,
			);
		if (report.tokensIn != null || report.tokensOut != null)
			lines.push(
				`Tokens so far: in ${report.tokensIn ?? 0} / out ${report.tokensOut ?? 0} / cache-write ${report.tokensCacheWrite ?? 0}`,
			);
		if (report.contextPercent !== null)
			lines.push(`Context used: ${Math.round(report.contextPercent)}%`);
		lines.push(`Elapsed: ${report.duration}`);
		return lines.join("\n");
	}
	if (report.status === "error") return `Error: ${report.error}`;
	if (report.stoppedWhileQueued)
		return "Agent was stopped while queued and never started. No work was performed.";
	return report.result?.trim() ?? "No output.";
}

/** Assemble the full get_subagent_result report text. */
export function formatAgentReport(report: AgentReport): string {
	let output =
		`Agent: ${report.id}\n` +
		`Type: ${report.displayName} | Status: ${report.status} | ${renderStatsParts(report).join(" | ")}\n` +
		`Description: ${report.description}\n\n`;
	output += renderReportBody(report);
	if (report.conversation) {
		output += `\n\n--- Agent Conversation ---\n${report.conversation}`;
	}
	if (report.transcriptPath) {
		output += `\n\nFull transcript available at: ${report.transcriptPath}`;
	}
	return output;
}
