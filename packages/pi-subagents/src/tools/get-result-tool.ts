import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { AgentConfigLookup } from "#src/config/agent-types";
import { type AgentReport, formatAgentReport } from "#src/tools/get-result-report";
import { formatLifetimeTokens, textResult } from "#src/tools/helpers";
import type { Subagent } from "#src/types";
import { formatDuration, getDisplayName } from "#src/ui/display";

// ---- Deps interfaces ----

export interface GetResultToolManager {
	getRecord(id: string): Subagent | undefined;
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
			return textResult(`Agent not found: "${params.agent_id}". Records are cleared at session start/switch, so it may be from a previous session.`);
		}

		// Wait for completion if requested. The record owns the decision of whether
		// it is still awaitable — a queued agent counts, because scheduleVia()
		// captures its limiter promise at spawn. A parent interrupt ends the wait
		// without cancelling the agent, leaving the outcome uncollected below.
		if (params.wait) {
			await record.waitUntilSettled(signal);
		}

		// Pull-delivery edge: the parent is collecting the settled outcome here, so
		// mark it consumed. The completion nudge scheduled by onSubagentCompleted
		// re-reads record.consumed at fire time and suppresses itself.
		if (!record.isActive()) {
			record.markConsumed();
		}

		return textResult(formatAgentReport(this.buildReport(record, params.verbose)));
	}

	private buildReport(record: Subagent, verbose?: boolean): AgentReport {
		const u = record.lifetimeUsage;
		return {
			id: record.id,
			displayName: getDisplayName(record.type, this.registry),
			status: record.status,
			toolUses: record.toolUses,
			tokens: formatLifetimeTokens(record),
			tokensIn: u.input,
			tokensOut: u.output,
			tokensCacheWrite: u.cacheWrite,
			turnCount: record.turnCount,
			maxTurns: record.maxTurns,
			activeTools: [...record.activeTools.values()],
			responseSnippet: record.responseText?.slice(-200) || undefined,
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
		};
	}

	toToolDefinition() {
		return defineTool({
			name: "get_subagent_result" as const,
			label: "Get Agent Result",
			promptSnippet:
				"get_subagent_result: Check status and retrieve results from a background agent.",
			description:
				"Check status and retrieve results from a background agent. Non-blocking by default: if the agent is still running you get a kick-back summary (current activity, elapsed runtime, tokens in/out so far, turns and tool calls so far, context used) instead of waiting. Pass wait: true to block explicitly.",
			parameters: Type.Object({
				agent_id: Type.String({
					description: "The agent ID to check.",
				}),
				wait: Type.Optional(
					Type.Boolean({
						description:
							"Explicit opt-in to block until the agent completes. Default: false — when the agent is still running, the call returns immediately with live status (activity, elapsed time, tokens in/out, turns, tool calls, context used).",
					}),
				),
				verbose: Type.Optional(
					Type.Boolean({
						description:
							"If true, include the agent's full conversation (messages + tool calls). Default: false.",
					}),
				),
			}),
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
