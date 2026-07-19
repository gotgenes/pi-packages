import type { AgentToolResult, ExtensionContext, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";
import { AgentTypeRegistry } from "#src/config/agent-types";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import type { AgentSpawnConfig } from "#src/lifecycle/subagent-manager";
import { spawnBackground } from "#src/tools/background-spawner";
import { runForeground } from "#src/tools/foreground-runner";
import { buildAgentGuidelines, buildDetails, buildTypeListText, textResult } from "#src/tools/helpers";
import { renderAgentResult } from "#src/tools/result-renderer";
import { type ModelInfo, resolveSpawnConfig } from "#src/tools/spawn-config";
import type { ParentSessionInfo, Subagent } from "#src/types";
import { type AgentDetails, getDisplayName, type Theme } from "#src/ui/display";

// ---- Deps interfaces ----

/** Narrow manager interface — only the methods the Agent tool calls. */
export interface AgentToolManager {
	spawn: (snapshot: ParentSnapshot, type: string, prompt: string, opts: AgentSpawnConfig) => string;
	spawnAndWait: (snapshot: ParentSnapshot, type: string, prompt: string, opts: Omit<AgentSpawnConfig, "isBackground">) => Promise<Subagent>;
	resume: (id: string, prompt: string, signal: AbortSignal) => Promise<Subagent | undefined>;
	getRecord: (id: string) => Subagent | undefined;
}

/** Narrow runtime interface — the Agent tool's slice of SubagentRuntime. */
export interface AgentToolRuntime {
	buildSnapshot(inheritContext: boolean): ParentSnapshot;
	getModelInfo(): ModelInfo;
	getSessionInfo(): { parentSessionFile: string; parentSessionId: string };
}

/** Narrow settings accessor — only the fields the Agent tool reads. */
export type AgentToolSettings = {
	readonly defaultMaxTurns: number | undefined;
	readonly maxConcurrent: number;
};

// ---- Class ----

export class AgentTool {
	private readonly typeListText: string;
	private readonly availableTypesText: string;
	private readonly agentGuidelines: string[];

	constructor(
		private readonly manager: AgentToolManager,
		private readonly runtime: AgentToolRuntime,
		private readonly settings: AgentToolSettings,
		private readonly registry: AgentTypeRegistry,
		private readonly agentDir: string,
	) {
		this.typeListText = buildTypeListText(registry, agentDir);
		this.availableTypesText = registry.getAvailableTypes().join(", ");
		this.agentGuidelines = buildAgentGuidelines(registry);
	}

	async execute(
		toolCallId: string,
		params: Record<string, unknown>,
		signal: AbortSignal | undefined,
		onUpdate: ((update: AgentToolResult<AgentDetails>) => void) | undefined,
		_ctx: ExtensionContext,
	) {
		// Reload custom agents so new .pi/agents/*.md files are picked up without restart
		this.registry.reload();

		// ---- Config resolution (pure) ----
		const config = resolveSpawnConfig(
			params,
			this.registry,
			this.runtime.getModelInfo(),
			this.settings,
		);
		if ("error" in config) return textResult(config.error);

		// ---- Boundary extraction (after config so inheritContext is resolved) ----
		const snapshot = this.runtime.buildSnapshot(config.execution.inheritContext);
		const { parentSessionFile, parentSessionId } = this.runtime.getSessionInfo();
		const parentSession: ParentSessionInfo = { parentSessionFile, parentSessionId, toolCallId };

		// ---- Resume existing agent ----
		if (params.resume) {
			const existing = this.manager.getRecord(params.resume as string);
			if (!existing) {
				return textResult(
					`Agent not found: "${params.resume as string}". It may have been cleaned up.`,
				);
			}
			if (!existing.isSessionReady()) {
				return textResult(
					`Agent "${params.resume as string}" has no active session to resume.`,
				);
			}
			const record = await this.manager.resume(
				params.resume as string,
				params.prompt as string,
				signal ?? new AbortController().signal,
			);
			if (!record) {
				return textResult(`Failed to resume agent "${params.resume as string}".`);
			}
			const presentation = record.parentResultPresentation;
			return textResult(
				presentation.result?.trim() ?? presentation.error?.trim() ?? "No output.",
				buildDetails(config.presentation.detailBase, record, { error: presentation.error }),
			);
		}

		// ---- Background execution ----
		if (config.execution.runInBackground) {
			return spawnBackground(
				this.manager,
				{ config, snapshot, parentSession, settings: this.settings },
			);
		}

		// ---- Foreground execution — stream progress via onUpdate ----
		return runForeground(
			this.manager,
			{ config, snapshot, parentSession },
			signal,
			onUpdate,
		);
	}

	toToolDefinition() {
		const typeListText = this.typeListText;
		const availableTypesText = this.availableTypesText;
		const agentDir = this.agentDir;
		const registry = this.registry;

		const guidelines = [
			"- For parallel work, use run_in_background: true on each agent. Foreground calls run sequentially — only one executes at a time.",
			...this.agentGuidelines,
			"- Provide clear, detailed prompts so the agent can work autonomously.",
			"- Subagent results are returned as text — summarize them for the user.",
			"- Use run_in_background for work you don't need immediately. You will be notified when it completes.",
			"- Use resume with an agent ID to continue a previous agent's work.",
			"- Use steer_subagent to send mid-run messages to a running background agent.",
			'- Use model to specify a different model (as "provider/modelId", or fuzzy e.g. "haiku", "sonnet").',
			"- Use thinking to control extended thinking level.",
			"- Use inherit_context if the agent needs the parent conversation history.",
		].join("\n");

		return defineTool({
			name: "subagent" as const,
			label: "Subagent",
			promptSnippet: "subagent: Launch a specialized agent for complex, multi-step tasks.",
			description: `Launch a new agent to handle complex, multi-step tasks autonomously.

The subagent tool launches specialized agents that autonomously handle complex tasks. Each agent type has specific capabilities and tools available to it.

Available agent types:
${typeListText}

Guidelines:
${guidelines}
`,
			parameters: Type.Object({
				prompt: Type.String({
					description: "The task for the agent to perform.",
				}),
				description: Type.String({
					description: "A short (3-5 word) description of the task (shown in UI).",
				}),
				subagent_type: Type.String({
					description: `The type of specialized agent to use. Available types: ${availableTypesText}. Custom agents from .pi/agents/<name>.md (project) or ${agentDir}/agents/<name>.md (global) are also available.`,
				}),
				model: Type.Optional(
					Type.String({
						description:
							'Optional model override. Accepts "provider/modelId" or fuzzy name (e.g. "haiku", "sonnet"). Omit to use the agent type\'s default.',
					}),
				),
				thinking: Type.Optional(
					Type.String({
						description:
							"Thinking level: off, minimal, low, medium, high, xhigh. Overrides agent default.",
					}),
				),
				max_turns: Type.Optional(
					Type.Number({
						description:
							"Maximum number of agentic turns before stopping. Omit for unlimited (default).",
						minimum: 1,
					}),
				),
				run_in_background: Type.Optional(
					Type.Boolean({
						description:
							"Set to true to run in background. Returns agent ID immediately. You will be notified when it completes.",
					}),
				),
				resume: Type.Optional(
					Type.String({
						description: "Optional agent ID to resume from. Continues from previous context.",
					}),
				),
				inherit_context: Type.Optional(
					Type.Boolean({
						description:
							"If true, fork parent conversation into the agent. Default: false (fresh context).",
					}),
				),
			}),

			// ---- Custom rendering: inline subagent results ----

			renderCall(args: Record<string, unknown>, theme: Theme) {
				const displayName = args.subagent_type
					? getDisplayName(args.subagent_type as string, registry)
					: "Subagent";
				const desc = (args.description as string | undefined) ?? "";
				return new Text(
					"▸ " +
						theme.fg("toolTitle", theme.bold(displayName)) +
						(desc ? "  " + theme.fg("muted", desc) : ""),
					0,
					0,
				);
			},

			renderResult(
				result: AgentToolResult<AgentDetails | undefined>,
				{ expanded, isPartial }: ToolRenderResultOptions,
				theme: Theme,
			) {
				const details = result.details;
				if (!details) {
					const text = result.content[0]?.type === "text" ? result.content[0].text : "";
					return new Text(text, 0, 0);
				}
				const resultText = result.content[0]?.type === "text" ? result.content[0].text : "";
				return new Text(
					renderAgentResult(details, resultText, expanded, isPartial, theme),
					0,
					0,
				);
			},

			execute: (
				toolCallId: string,
				params: Record<string, unknown>,
				signal: AbortSignal | undefined,
				onUpdate: ((update: AgentToolResult<AgentDetails>) => void) | undefined,
				ctx: ExtensionContext,
			) => this.execute(toolCallId, params, signal, onUpdate, ctx),
		});
	}
}
