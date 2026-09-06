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

		return textResult(formatAgentReport(this.buildReport(record, params.verbose)));
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
			runUpdates: record.runUpdates,
			pendingQuestion: record.pendingQuestion,
			workspaceNotice: record.workspaceNotice,
		};
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
