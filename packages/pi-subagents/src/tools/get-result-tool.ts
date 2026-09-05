import type { AgentToolResult, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";
import type { AgentConfigLookup } from "#src/config/agent-types";
import type { SubagentStatus } from "#src/lifecycle/subagent";
import { type AgentReport, formatAgentReport } from "#src/tools/get-result-report";
import { formatLifetimeTokens, textResultWithDetails } from "#src/tools/helpers";
import type { Subagent } from "#src/types";
import { formatDuration, getDisplayName, type Theme } from "#src/ui/display";
import { GLYPHS } from "#src/ui/glyphs";

// ---- Local helpers ----

// ---- Deps interfaces ----

export interface GetResultToolManager {
	getRecord(id: string): Subagent | undefined;
}

/**
 * Metadata attached to get_subagent_result tool results for custom rendering.
 * Mirrors AgentDetails in agent-tool.ts but scoped to get_subagent_result.
 */
export interface GetResultDetails {
	id: string;
	displayName: string;
	status: SubagentStatus;
	description: string;
	toolUses: number;
	tokens: string;
	duration: string;
	contextPercent: number | null;
	compactionCount: number;
	/** Result text, present only for completed/steered/stopped statuses. */
	result?: string;
	/** Error message, present only for error status. */
	error?: string;
	/** Whether verbose conversation was requested and is included. */
	verbose: boolean;
	/** Path to the persisted transcript file. */
	transcriptPath?: string;
	/** Whether the agent was stopped before being admitted. */
	stoppedWhileQueued: boolean;
}

// ---- Renderer ----

/**
 * Render get_subagent_result output for collapsed/expanded TUI display.
 * Mirrors the pattern in result-renderer.ts but scoped to GetResultDetails.
 * Exported for testing.
 */
export function renderGetResult(details: GetResultDetails, expanded: boolean, theme: Theme): string {
	const { id, displayName, status, description, toolUses, tokens, duration, contextPercent, compactionCount, result, error, verbose, transcriptPath, stoppedWhileQueued } = details;

	// Build the status icon and label
	let icon: string;
	let statusLabel: string;
	let iconStyle: "success" | "error" | "warning" | "dim";

	switch (status) {
		case "completed":
			icon = GLYPHS.success;
			iconStyle = "success";
			statusLabel = "completed";
			break;
		case "steered":
			icon = GLYPHS.success;
			iconStyle = "warning";
			statusLabel = "wrapped up";
			break;
		case "running":
			icon = "";
			iconStyle = "dim";
			statusLabel = "running";
			break;
		case "queued":
			icon = "";
			iconStyle = "dim";
			statusLabel = "queued";
			break;
		case "stopped":
			icon = GLYPHS.stopped;
			iconStyle = "dim";
			statusLabel = "stopped";
			break;
		case "aborted":
			icon = GLYPHS.failure;
			iconStyle = "error";
			statusLabel = "aborted";
			break;
		case "error":
			icon = GLYPHS.failure;
			iconStyle = "error";
			statusLabel = "error";
			break;
		default:
			icon = "";
			iconStyle = "dim";
			statusLabel = status;
	}

	// Build stats string
	const statsParts: string[] = [];
	if (displayName) statsParts.push(displayName);
	if (toolUses > 0) statsParts.push(`${toolUses} tool use${toolUses === 1 ? "" : "s"}`);
	if (tokens) statsParts.push(tokens);
	if (contextPercent !== null) statsParts.push(`${Math.round(contextPercent)}%`);
	if (compactionCount > 0) statsParts.push(`${GLYPHS.compactions}${compactionCount}`);
	statsParts.push(duration);

	const stats = statsParts.map(p => theme.fg("dim", p)).join(" " + theme.fg("dim", "·") + " ");

	// Build the main line
	let line = "";
	if (icon) {
		line += theme.fg(iconStyle, icon) + " ";
	}
	line += theme.fg("toolTitle", theme.bold(id));
	line += " " + theme.fg("dim", statusLabel);
	if (stats) {
		line += " " + theme.fg("dim", "·") + " " + stats;
	}

	// Add description on next line
	if (description) {
		// Truncate description to avoid extremely long lines
		const maxDescLen = 80;
		const truncatedDesc = description.length > maxDescLen
			? description.slice(0, maxDescLen) + "…"
			: description;
		line += "\n" + theme.fg("dim", `  ${GLYPHS.subLine}  ${truncatedDesc}`);
	}

	// Expanded: show result preview or error
	if (expanded) {
		if (status === "error" && error) {
			line += "\n" + theme.fg("error", `  ${GLYPHS.subLine}  Error: ${error}`);
		} else if (stoppedWhileQueued) {
			line += "\n" + theme.fg("dim", `  ${GLYPHS.subLine}  Agent was stopped while queued and never started.`);
		} else if (status === "running") {
			line += "\n" + theme.fg("dim", `  ${GLYPHS.subLine}  Agent is still running.`);
		} else if (result) {
			// Show truncated result preview
			const maxResultLines = 30;
			const allLines = result.split("\n");
			const lines = allLines.slice(0, maxResultLines);
			for (const l of lines) {
				// Truncate each line to avoid extremely long terminal rows
				const maxLineLen = 200;
				const truncatedLine = l.length > maxLineLen ? l.slice(0, maxLineLen) + "…" : l;
				line += "\n" + theme.fg("dim", `  ${truncatedLine}`);
			}
			if (allLines.length > maxResultLines) {
				line += "\n" + theme.fg("muted", "  ... (truncated)");
			}
		}

		// Add note about verbose/transcript availability
		if (verbose) {
			line += "\n" + theme.fg("muted", `  ${GLYPHS.subLine}  (verbose conversation in result for model)`);
		} else if (transcriptPath) {
			line += "\n" + theme.fg("muted", `  ${GLYPHS.subLine}  (full transcript available)`);
		}
	}

	return line;
}

// ---- Class ----

export class GetResultTool {
	constructor(
		private readonly manager: GetResultToolManager,
		private readonly registry: AgentConfigLookup,
	) {}

	async execute(
		_toolCallId: string,
		params: { agent_id: string; wait?: boolean; verbose?: boolean },
		signal: AbortSignal,
		_onUpdate: unknown,
		_ctx: unknown,
	) {
		const record = this.manager.getRecord(params.agent_id);
		if (!record) {
			return textResultWithDetails<GetResultDetails>(`Agent not found: "${params.agent_id}". Records are cleared at session start/switch, so it may be from a previous session.`);
		}

		// Wait for completion if requested. The record owns the decision of whether
		// it is still awaitable — a queued agent counts, because scheduleVia()
		// captures its limiter promise at spawn. A parent interrupt ends the wait
		// without cancelling the agent, leaving the outcome uncollected below.
		const waited = params.wait === true;
		if (waited) {
			// Waiting commits this call to delivering the outcome, so claim it before
			// the agent can settle and be announced by the nudge instead.
			record.claim();
			await record.waitUntilSettled(signal);
		}

		// Pull-delivery edge: the parent is collecting the settled outcome here, so
		// mark it consumed. An agent still active after a wait means the wait was
		// abandoned, so release the claim this call made and let the nudge announce.
		// Only a wait that claimed may release, so a concurrent carrier's claim is
		// never cleared by this call.
		if (!record.isActive()) {
			record.markConsumed();
		} else if (waited) {
			record.release();
		}

		const verbose = params.verbose ?? false;
		return textResultWithDetails<GetResultDetails>(
			formatAgentReport(this.buildReport(record, verbose)),
			this.buildDetails(record, verbose),
		);
	}

	private buildReport(record: Subagent, verbose?: boolean): AgentReport {
		return {
			id: record.id,
			displayName: getDisplayName(record.type, this.registry),
			status: record.status,
			toolUses: record.toolUses,
			tokens: formatLifetimeTokens(record),
			contextPercent: record.getContextPercent(),
			compactionCount: record.compactionCount,
			duration: formatDuration(record.startedAt, record.completedAt),
			description: record.description,
			result: record.result,
			error: record.error,
			stoppedWhileQueued: record.stoppedWhileQueued,
			conversation: verbose ? record.getConversation() : undefined,
			// Transcript pointer: lets the parent read the full session from disk,
			// and covers verbose after the live session was released (no conversation).
			transcriptPath: record.outputFile,
			pendingQuestion: record.pendingQuestion,
			workspaceNotice: record.workspaceNotice,
		};
	}

	/** Build GetResultDetails from a Subagent record and verbose flag. */
	private buildDetails(record: Subagent, verbose: boolean): GetResultDetails {
		return {
			id: record.id,
			displayName: getDisplayName(record.type, this.registry),
			status: record.status,
			description: record.description,
			toolUses: record.toolUses,
			tokens: formatLifetimeTokens(record),
			duration: formatDuration(record.startedAt, record.completedAt),
			contextPercent: record.getContextPercent(),
			compactionCount: record.compactionCount,
			result: record.result,
			error: record.error,
			verbose,
			transcriptPath: record.outputFile,
			stoppedWhileQueued: record.stoppedWhileQueued,
		};
	}

	/**
	 * Render the tool call header for get_subagent_result.
	 * Shows the agent ID and operation type.
	 */
	private renderCall(args: Record<string, unknown>, theme: Theme): Text {
		const agentId = args.agent_id as string;
		const wait = args.wait as boolean | undefined;
		const verbose = args.verbose as boolean | undefined;
		const parts = [theme.fg("toolTitle", theme.bold("Get Agent Result"))];
		parts.push(theme.fg("muted", ` ${agentId}`));
		if (wait) parts.push(theme.fg("muted", " (waiting)"));
		if (verbose) parts.push(theme.fg("muted", " (verbose)"));
		return new Text(GLYPHS.toolCall + " " + parts.join(""), 0, 0);
	}

	/**
	 * Render the tool result with collapsed/expanded states.
	 * Collapsed: show agent identity, status, stats, description (no result text).
	 * Expanded: show truncated result preview + mention of verbose/transcript.
	 */
	private renderResult(
		result: AgentToolResult<GetResultDetails | undefined>,
		{ expanded }: ToolRenderResultOptions,
		theme: Theme,
	): Text {
		const details = result.details;
		if (!details) {
			// No details means no record found - just show plain text
			const text = result.content[0]?.type === "text" ? result.content[0].text : "";
			return new Text(text, 0, 0);
		}

		const rendered = renderGetResult(details, expanded, theme);
		return new Text(rendered, 0, 0);
	}

	toToolDefinition() {
		return defineTool({
			name: "get_subagent_result" as const,
			label: "Get Agent Result",
			promptSnippet:
				"Check status and retrieve results from a background agent.",
			description:
				"Check status and retrieve results from a background agent. Use the agent ID returned by Agent with run_in_background.",
			parameters: Type.Object({
				agent_id: Type.String({
					description: "The agent ID to check.",
				}),
				wait: Type.Optional(
					Type.Boolean({
						description:
							"If true, wait for the agent to complete before returning. Default: false.",
					}),
				),
				verbose: Type.Optional(
					Type.Boolean({
						description:
							"If true, include the agent's full conversation (messages + tool calls). Default: false.",
					}),
				),
			}),

			// Custom rendering: collapsed/expanded result display
			renderCall: (args: Record<string, unknown>, theme: Theme) =>
				this.renderCall(args, theme),
			renderResult: (
				result: AgentToolResult<GetResultDetails | undefined>,
				options: ToolRenderResultOptions,
				theme: Theme,
			) => this.renderResult(result, options, theme),

			execute: (
				toolCallId: string,
				params: { agent_id: string; wait?: boolean; verbose?: boolean },
				signal: AbortSignal,
				onUpdate: unknown,
				ctx: unknown,
			) => this.execute(toolCallId, params, signal, onUpdate, ctx),
		});
	}
}
