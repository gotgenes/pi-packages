import type { AgentToolResult, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { AgentConfigLookup } from "#src/config/agent-types";
import type { SettledOutcome } from "#src/lifecycle/subagent-state";
import {
	type GetResultDetails,
	PREVIEW_CHARS,
	renderGetResultLines,
} from "#src/tools/get-result-renderer";
import { type AgentReport, formatAgentReport } from "#src/tools/get-result-report";
import { formatLifetimeTokens, textResult } from "#src/tools/helpers";
import type { Subagent } from "#src/types";
import { BoundedLines } from "#src/ui/bounded-lines";
import {
	describeActivity,
	formatDuration,
	formatMs,
	getDisplayName,
	modelLabel,
	type Theme,
} from "#src/ui/display";
import { GLYPHS } from "#src/ui/glyphs";

// ---- Deps interfaces ----

export interface GetResultToolManager {
	getRecord(id: string): Subagent | undefined;
}

/** The arguments a get_subagent_result call carries. */
export interface GetResultParams {
	agent_id: string;
	wait?: boolean;
	verbose?: boolean;
	/** Seconds; bounds only a `wait: true` call. Absent = wait until the agent settles. */
	timeout?: number;
}

/** What collecting the outcome learned beyond the live record. */
interface CollectedOutcome {
	/** The outcome of a run a resume replaced while this call waited on it. */
	superseded?: SettledOutcome;
	/** The bound, in seconds, of a wait that ended at it with the agent still running. */
	waitExpiredAfter?: number;
}

/** setTimeout's ceiling, the same one Pi's bash tool enforces. */
const MAX_TIMEOUT_SECONDS = 2_147_483_647 / 1000;

// ---- Class ----

export class GetResultTool {
	constructor(
		private readonly manager: GetResultToolManager,
		private readonly registry: AgentConfigLookup,
	) {}

	async execute(
		_toolCallId: string,
		params: GetResultParams,
		signal: AbortSignal,
		_onUpdate: unknown,
		_ctx: unknown,
	) {
		validateTimeout(params.timeout);
		const record = this.manager.getRecord(params.agent_id);
		if (!record) {
			return textResult<GetResultDetails>(`Agent not found: "${params.agent_id}". Records are cleared at session start/switch, so it may be from a previous session.`);
		}

		const collected = await this.collectOutcome(record, params, signal);

		const verbose = params.verbose === true;
		const { superseded } = collected;
		const outcome = superseded ? withoutQuestion(superseded) : liveOutcome(record);
		return textResult<GetResultDetails>(
			formatAgentReport(this.buildReport(record, outcome, verbose, collected)),
			this.buildGetResultDetails(record, outcome, verbose),
		);
	}

	/**
	 * Settle this call's delivery obligation: wait when asked, then mark the
	 * outcome collected or release the claim. Reports the outcome of a run a
	 * resume replaced while this call waited on it, and whether the wait ended
	 * at its bound.
	 *
	 * A bound only swaps the signal the wait ends on, so a wait that reaches it
	 * takes the same path as an interrupted one: the claim is released and the
	 * agent keeps running.
	 */
	private async collectOutcome(
		record: Subagent,
		params: GetResultParams,
		signal: AbortSignal,
	): Promise<CollectedOutcome> {
		// Wait for completion if requested. The record owns the decision of whether
		// it is still awaitable — a queued agent counts, because scheduleVia()
		// captures its limiter promise at spawn. A parent interrupt ends the wait
		// without cancelling the agent, leaving the outcome uncollected below.
		//
		// Pull-delivery edge: the parent is collecting the settled outcome here, so
		// mark it consumed. A wait whose run has not settled was abandoned, so it
		// releases the claim it made and lets the nudge announce. The handle drops
		// only this call's claim, so a concurrent carrier's (such as a resume that
		// started as the run settled) is never cleared by this call.
		//
		// A resume that replaced the waited run after it settled leaves this call
		// the only carrier of what that run ended with: its nudge was suppressed by
		// this call's claim. So the report carries that outcome, not the live run's.
		// Consumption is record-wide and now belongs to the resumed run, so it is
		// not marked here; doing so would silence a background resume's nudge.
		if (params.wait === true) {
			// Waiting commits this call to delivering the outcome, so claim it before
			// the agent can settle and be announced by the nudge instead.
			const claim = record.claim();
			const bound = params.timeout === undefined ? undefined : new WaitBound(signal, params.timeout);
			try {
				const wait = await record.waitUntilSettled(bound?.signal ?? signal);
				if (wait.kind === "settled") record.markConsumed();
				else claim.release();
				if (wait.kind === "superseded") return { superseded: wait.outcome };
				if (wait.kind === "unsettled" && bound?.expired) return { waitExpiredAfter: params.timeout };
			} finally {
				bound?.dispose();
			}
		} else if (!record.isActive()) {
			record.markConsumed();
		}
		return {};
	}

	/** The report: outcome fields from `outcome`, everything else from the live record. */
	private buildReport(
		record: Subagent,
		outcome: SettledOutcome,
		verbose: boolean,
		collected: CollectedOutcome,
	): AgentReport {
		return {
			id: record.id,
			displayName: getDisplayName(record.type, this.registry),
			status: outcome.status,
			toolUses: record.toolUses,
			tokens: formatLifetimeTokens(record),
			contextPercent: record.getContextPercent(),
			compactionCount: record.compactionCount,
			duration: formatDuration(outcome.startedAt, outcome.completedAt),
			description: record.description,
			result: outcome.result,
			error: outcome.error,
			turnBudget: outcome.turnBudget,
			stoppedWhileQueued: record.stoppedWhileQueued,
			conversation: verbose ? record.getConversation() : undefined,
			// Transcript pointer: lets the parent read the full session from disk,
			// and covers verbose after the live session was released (no conversation).
			transcriptPath: record.outputFile,
			runUpdates: outcome.runUpdates,
			pendingQuestion: outcome.pendingQuestion,
			resumeRefusal: record.resumeRefusal,
			workspaceNotice: outcome.workspaceNotice,
			model: modelLabel(record.model),
			resumedWhileWaiting: collected.superseded !== undefined,
			waitExpiredAfter: collected.waitExpiredAfter,
			progress: outcome.status === "running" ? progressOf(record) : undefined,
		};
	}

	/**
	 * The compact metadata the TUI renders from.
	 *
	 * Named in full because `helpers.ts` exports a module-level `buildDetails`
	 * producing the structurally different `AgentDetails`.
	 */
	private buildGetResultDetails(record: Subagent, outcome: SettledOutcome, verbose: boolean): GetResultDetails {
		return {
			agentId: record.id,
			displayName: getDisplayName(record.type, this.registry),
			status: outcome.status,
			description: record.description,
			toolUses: record.toolUses,
			tokens: formatLifetimeTokens(record),
			contextPercent: record.getContextPercent(),
			compactionCount: record.compactionCount,
			duration: formatDuration(outcome.startedAt, outcome.completedAt),
			preview: buildPreview(outcome.result),
			error: outcome.error,
			turnBudget: outcome.turnBudget,
			verbose,
			transcriptPath: record.outputFile,
			modelName: modelLabel(record.model),
		};
	}

	toToolDefinition() {
		return defineTool({
			name: "get_subagent_result" as const,
			label: "Get Agent Result",
			promptSnippet:
				"Check status and retrieve results from a background agent.",
			description:
				"Check status and retrieve results from a background agent. Use the agent ID returned by Agent with run_in_background. " +
				"With wait: true and a timeout, the wait ends at the timeout and returns the agent's current progress; " +
				"this does not stop or abort the agent, unlike bash's timeout.",
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
				timeout: Type.Optional(
					Type.Number({
						description:
							"Seconds to wait when wait is true (optional, no default: wait until the agent finishes). " +
							"An expired wait does not stop the agent; if its progress is unchanged since your last check, do not simply wait again.",
					}),
				),
			}),
			// ---- Custom rendering: a bounded, Ctrl+O-expandable retrieval row ----

			renderCall(args: GetResultParams, theme: Theme) {
				const notes = [waitNote(args), args.verbose === true ? "verbose" : ""]
					.filter(Boolean)
					.join(", ");
				return new Text(
					`${GLYPHS.toolCall} ` +
						theme.fg("toolTitle", theme.bold("Get Agent Result")) +
						"  " +
						theme.fg("muted", args.agent_id) +
						(notes ? " " + theme.fg("muted", `(${notes})`) : ""),
					0,
					0,
				);
			},

			renderResult(
				result: AgentToolResult<GetResultDetails | undefined>,
				{ expanded }: ToolRenderResultOptions,
				theme: Theme,
			) {
				const reportText = result.content[0]?.type === "text" ? result.content[0].text : "";
				const details = result.details;
				if (!details) return new Text(reportText, 0, 0);
				return new BoundedLines(renderGetResultLines(details, reportText, expanded, theme));
			},

			execute: (
				toolCallId: string,
				params: GetResultParams,
				signal: AbortSignal,
				onUpdate: unknown,
				ctx: unknown,
			) => this.execute(toolCallId, params, signal, onUpdate, ctx),
		});
	}
}

/** Throws on a timeout setTimeout cannot honor, worded as Pi's bash tool words it. */
function validateTimeout(timeout: number | undefined): void {
	if (timeout === undefined) return;
	if (!Number.isFinite(timeout) || timeout <= 0) {
		throw new Error("Invalid timeout: must be a finite number of seconds greater than 0");
	}
	if (timeout > MAX_TIMEOUT_SECONDS) {
		throw new Error(`Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`);
	}
}

/**
 * Ends a wait at the parent's interrupt or at a deadline, whichever comes first,
 * and remembers whether the deadline was the one that fired.
 */
class WaitBound {
	private readonly controller = new AbortController();
	private readonly detach = new AbortController();
	private readonly timer: ReturnType<typeof setTimeout>;
	private _expired = false;

	constructor(parent: AbortSignal, seconds: number) {
		this.timer = setTimeout(() => {
			this._expired = true;
			this.controller.abort();
		}, seconds * 1000);
		if (parent.aborted) this.controller.abort();
		else parent.addEventListener("abort", () => { this.controller.abort(); }, { once: true, signal: this.detach.signal });
	}

	get signal(): AbortSignal { return this.controller.signal; }

	/** Whether the deadline, rather than the parent, ended the wait. */
	get expired(): boolean { return this._expired; }

	/** Clears the deadline and the parent listener, so neither outlives the call. */
	dispose(): void {
		clearTimeout(this.timer);
		this.detach.abort();
	}
}

/** The call row's wait note: the bound when the wait has one. */
function waitNote(args: GetResultParams): string {
	if (args.wait !== true) return "";
	return args.timeout === undefined ? "waiting" : `waiting \u2264${args.timeout}s`;
}

/**
 * What a running agent is doing and how long since its last session event: the
 * facts the widget shows the human, so the parent can tell a stalled run from a
 * long one.
 */
function progressOf(record: Subagent): AgentReport["progress"] {
	return {
		activity: describeActivity(record.activeTools, record.responseText),
		turns: record.turnBudget?.used,
		sinceLastProgress: formatMs(Date.now() - record.lastProgressAt),
	};
}

/** The live record's current outcome fields. */
function liveOutcome(record: Subagent): SettledOutcome {
	return {
		status: record.status,
		result: record.result,
		error: record.error,
		startedAt: record.startedAt,
		completedAt: record.completedAt,
		pendingQuestion: record.pendingQuestion,
		workspaceNotice: record.workspaceNotice,
		runUpdates: record.runUpdates,
		turnBudget: record.turnBudget,
	};
}

/**
 * A superseded run's outcome without its question: the resume that replaced it
 * is that question's answer, and the live record's refusal (still running)
 * would tell the parent to wait and answer it again.
 */
function withoutQuestion(outcome: SettledOutcome): SettledOutcome {
	return { ...outcome, pendingQuestion: undefined };
}

/** The first non-empty line of a result body, clipped to the preview budget. */
function buildPreview(result: string | undefined): string | undefined {
	const line = result?.split("\n").find((candidate) => candidate.trim())?.trim();
	if (!line) return undefined;
	return line.length > PREVIEW_CHARS ? line.slice(0, PREVIEW_CHARS - 1) + "\u2026" : line;
}
