import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTypeRegistry } from "#src/config/agent-types";
import type { TurnLoopResult } from "#src/lifecycle/subagent-session";
import { MAX_EXPANDED_LINES, PREVIEW_CHARS } from "#src/tools/get-result-renderer";
import {
	type GetResultParams,
	GetResultTool,
	type GetResultToolManager,
} from "#src/tools/get-result-tool";
import type { Subagent } from "#src/types";
import type { Theme } from "#src/ui/display";
import { makeModel } from "#test/helpers/make-model";
import { createTestSubagent, makeStubExecution } from "#test/helpers/make-subagent";
import { createMockSession, createSubagentSessionStub, toSubagentSession } from "#test/helpers/mock-session";
import { STUB_CTX } from "#test/helpers/stub-ctx";
import { textOf } from "#test/helpers/text-of";
import { turnLoopResult } from "#test/helpers/turn-loop-result";

const testRegistry = new AgentTypeRegistry(() => new Map());

/** A result body long enough to overflow the expanded cap, with a recognisable last line. */
function longResult(lines: number): string {
	return Array.from({ length: lines }, (_, i) => `report line ${i + 1}`).join("\n");
}

function makeManager(records: Map<string, Subagent> = new Map()): GetResultToolManager {
	return { getRecord: (id: string) => records.get(id) };
}

async function execute(
	manager: GetResultToolManager,
	params: GetResultParams,
	signal: AbortSignal = new AbortController().signal,
) {
	const tool = new GetResultTool(manager, testRegistry);
	return tool.execute("tc-1", params, signal, undefined, STUB_CTX);
}

describe("GetResultTool — carrier claim", () => {
	it("claims the outcome for the duration of a wait", async () => {
		const sessionStub = createSubagentSessionStub();
		sessionStub.runTurnLoop.mockResolvedValue(turnLoopResult({ responseText: "Done." }));
		const record = createTestSubagent({
			status: "queued",
			completedAt: undefined,
			execution: makeStubExecution({
				createSubagentSession: async () => toSubagentSession(sessionStub),
			}),
		});
		const { promise: slot, resolve: openSlot } = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
		record.scheduleVia(async (thunk) => {
			await slot;
			await thunk();
		});
		const resultPromise = execute(makeManager(new Map([["agent-1", record]])), {
			agent_id: "agent-1",
			wait: true,
		});

		// Claimed before the agent is even admitted, so the nudge cannot win the race.
		expect(record.claimed).toBe(true);

		openSlot();
		await resultPromise;
		expect(record.claimed).toBe(true);
		expect(record.consumed).toBe(true);
	});

	it("releases the claim when the parent turn is interrupted mid-wait", async () => {
		const sessionStub = createSubagentSessionStub();
		sessionStub.runTurnLoop.mockReturnValue(new Promise<never>(() => {}));
		const record = createTestSubagent({
			status: "running",
			completedAt: undefined,
			execution: makeStubExecution({
				createSubagentSession: async () => toSubagentSession(sessionStub),
			}),
		});
		record.start();
		const controller = new AbortController();

		const resultPromise = execute(
			makeManager(new Map([["agent-1", record]])),
			{ agent_id: "agent-1", wait: true },
			controller.signal,
		);
		controller.abort();
		await resultPromise;

		// The wait was abandoned, so announcing the outcome is owed again.
		expect(record.claimed).toBe(false);
		expect(record.consumed).toBe(false);
	});

	it("leaves another carrier's claim in place when the parent turn is interrupted mid-wait", async () => {
		const sessionStub = createSubagentSessionStub();
		sessionStub.runTurnLoop.mockReturnValue(new Promise<never>(() => {}));
		const record = createTestSubagent({
			status: "running",
			completedAt: undefined,
			execution: makeStubExecution({
				createSubagentSession: async () => toSubagentSession(sessionStub),
			}),
		});
		record.start();
		record.claim();
		const controller = new AbortController();

		const resultPromise = execute(
			makeManager(new Map([["agent-1", record]])),
			{ agent_id: "agent-1", wait: true },
			controller.signal,
		);
		controller.abort();
		await resultPromise;

		// Only this call's claim was abandoned; the other carrier still delivers.
		expect(record.claimed).toBe(true);
	});

	it("leaves a claimed resume's claim in place when the wait wakes after the resume started", async () => {
		const sessionStub = createSubagentSessionStub();
		sessionStub.runTurnLoop.mockResolvedValue(turnLoopResult({ responseText: "first" }));
		const resumed = Promise.withResolvers<TurnLoopResult>();
		sessionStub.resumeTurnLoop.mockReturnValue(resumed.promise);
		const record = createTestSubagent({
			status: "running",
			completedAt: undefined,
			execution: makeStubExecution({
				createSubagentSession: async () => toSubagentSession(sessionStub),
				// A consumer that resumes the moment the run settles, before the
				// waiter's continuation runs, as a subagents:completed handler can.
				observer: {
					onRunFinished: (agent) => {
						agent.claim();
						void agent.resume("continue");
					},
				},
			}),
		});
		record.start();

		await execute(makeManager(new Map([["agent-1", record]])), { agent_id: "agent-1", wait: true });

		expect(record.claimed).toBe(true);
		resumed.resolve(turnLoopResult({ responseText: "second" }));
		await record.promise;
	});

	it("leaves another carrier's claim untouched when wait is not requested", async () => {
		const record = createTestSubagent({ status: "running", completedAt: undefined });
		record.claim();

		await execute(makeManager(new Map([["agent-1", record]])), { agent_id: "agent-1" });

		expect(record.claimed).toBe(true);
	});
});

describe("GetResultTool — a wait a resume superseded", () => {
	/**
	 * An agent whose first run asks a question and ends with `first result`, and
	 * a consumer that resumes it the moment that run settles, before the waiter's
	 * continuation runs, as a subagents:completed handler can.
	 */
	function supersededAgent() {
		const sessionStub = createSubagentSessionStub();
		let ask: ((question: string) => void) | undefined;
		sessionStub.runTurnLoop.mockImplementation(() => {
			ask?.("Which config?");
			return Promise.resolve(turnLoopResult({ responseText: "first result" }));
		});
		const resumed = Promise.withResolvers<TurnLoopResult>();
		sessionStub.resumeTurnLoop.mockReturnValue(resumed.promise);
		const record = createTestSubagent({
			status: "running",
			completedAt: undefined,
			execution: makeStubExecution({
				createSubagentSession: async (params) => {
					ask = params.askParent;
					return toSubagentSession(sessionStub);
				},
				observer: {
					onRunFinished: (agent) => {
						agent.claim();
						void agent.resume("The project one.");
					},
				},
			}),
		});
		record.start();
		return { record, finishResume: () => resumed.resolve(turnLoopResult({ responseText: "second result" })) };
	}

	it("reports the run it waited for, and that the agent is running again", async () => {
		const { record, finishResume } = supersededAgent();

		const result = await execute(makeManager(new Map([["agent-1", record]])), { agent_id: "agent-1", wait: true });

		const text = textOf(result);
		// Duration and the agent id vary per run, so the stable lines are checked.
		expect(text).toContain("Status: completed |");
		expect(text).toContain("\n\nfirst result\n\n");
		expect(text).toContain("This agent was resumed before this wait returned and is running again");
		finishResume();
		await record.promise;
	});

	it("drops the question the resume is already answering", async () => {
		const { record, finishResume } = supersededAgent();

		const result = await execute(makeManager(new Map([["agent-1", record]])), { agent_id: "agent-1", wait: true });

		expect(textOf(result)).not.toContain("Which config?");
		finishResume();
		await record.promise;
	});

	it("leaves the resumed run's outcome uncollected", async () => {
		const { record, finishResume } = supersededAgent();

		await execute(makeManager(new Map([["agent-1", record]])), { agent_id: "agent-1", wait: true });

		expect(record.consumed).toBe(false);
		finishResume();
		await record.promise;
	});

	it("carries no progress line for the settled run it reports", async () => {
		const { record, finishResume } = supersededAgent();

		const result = await execute(makeManager(new Map([["agent-1", record]])), { agent_id: "agent-1", wait: true });

		expect(textOf(result)).not.toContain("Progress:");
		finishResume();
		await record.promise;
	});

	it("summarises the run it waited for in the TUI details", async () => {
		const { record, finishResume } = supersededAgent();

		const result = await execute(makeManager(new Map([["agent-1", record]])), { agent_id: "agent-1", wait: true });

		expect([result.details?.status, result.details?.preview]).toEqual(["completed", "first result"]);
		finishResume();
		await record.promise;
	});
});

describe("GetResultTool", () => {
	it("returns tool definition with correct name", () => {
		const tool = new GetResultTool(makeManager(), testRegistry);
		expect(tool.toToolDefinition().name).toBe("get_subagent_result");
	});

	it("includes promptSnippet", () => {
		const tool = new GetResultTool(makeManager(), testRegistry);
		expect(tool.toToolDefinition().promptSnippet).toBe(
			"Check status and retrieve results from a background agent.",
		);
	});

	it("returns not-found message for unknown agent ID", async () => {
		const result = await execute(makeManager(), { agent_id: "unknown" });
		expect(textOf(result)).toContain("Agent not found");
	});

	it("returns status and result for completed agent", async () => {
		const records = new Map([["agent-1", createTestSubagent()]]);
		const result = await execute(makeManager(records), { agent_id: "agent-1" });
		const text = textOf(result);
		expect(text).toContain("Agent: agent-1");
		expect(text).toContain("completed");
		expect(text).toContain("All done.");
	});

	describe("model", () => {
		it("names the model the agent ran in the report and the TUI details", async () => {
			const record = createTestSubagent({
				execution: makeStubExecution({ model: makeModel({ provider: "openai", id: "gpt-5" }) }),
			});
			const result = await execute(makeManager(new Map([["agent-1", record]])), { agent_id: "agent-1" });
			expect(textOf(result)).toContain("\nModel: openai/gpt-5\n");
			expect(result.details?.modelName).toBe("openai/gpt-5");
		});

		it("names no model while the agent's model is unknown", async () => {
			const result = await execute(makeManager(new Map([["agent-1", createTestSubagent()]])), { agent_id: "agent-1" });
			expect(textOf(result)).not.toContain("Model:");
			expect(result.details?.modelName).toBeUndefined();
		});
	});

	it("reports the updates the agent sent during the run", async () => {
		const records = new Map([
			["agent-1", createTestSubagent({ runUpdates: ["The bug is in the retry wrapper."] })],
		]);

		const result = await execute(makeManager(records), { agent_id: "agent-1" });

		expect(textOf(result)).toContain("The bug is in the retry wrapper.");
	});

	describe("resume affordance", () => {
		it("names the resume call while the agent is still resumable", async () => {
			const records = new Map([
				["agent-1", createTestSubagent({ pendingQuestion: "Which config?", sessionReady: true })],
			]);

			const result = await execute(makeManager(records), { agent_id: "agent-1" });

			expect(textOf(result)).toContain('resume: "agent-1"');
		});

		it("names no resume for a child that asked before its turn ended", async () => {
			// The reported path: ask_parent records the question during the run, and a
			// pull in the window before the turn ends used to name the resume call
			// that would have started a second turn loop on the same session.
			const records = new Map([
				[
					"agent-1",
					createTestSubagent({
						status: "running",
						completedAt: undefined,
						pendingQuestion: "Which config?",
						sessionReady: true,
					}),
				],
			]);

			const result = await execute(makeManager(records), { agent_id: "agent-1" });

			expect(textOf(result)).toContain("Which config?");
			expect(textOf(result)).toContain("cannot be resumed yet");
			expect(textOf(result)).not.toContain("resume:");
		});

		it("forwards the record's refusal, so a swept record names no resume", async () => {
			const released = createTestSubagent({
				pendingQuestion: "Which config?",
				sessionReady: true,
			});
			await released.releaseSession();
			const records = new Map([["agent-1", released]]);

			const result = await execute(makeManager(records), { agent_id: "agent-1" });

			expect(textOf(result)).toContain("Which config?");
			expect(textOf(result)).toContain(
				"its session was released after its retention window",
			);
			expect(textOf(result)).not.toContain("resume:");
		});
	});

	it("shows running message for in-progress agent", async () => {
		const records = new Map([["agent-1", createTestSubagent({ status: "running", completedAt: undefined })]]);
		const result = await execute(makeManager(records), { agent_id: "agent-1" });
		expect(textOf(result)).toContain("still running");
	});

	it("shows error for failed agent", async () => {
		const records = new Map([["agent-1", createTestSubagent({ status: "error", error: "timeout" })]]);
		const result = await execute(makeManager(records), { agent_id: "agent-1" });
		expect(textOf(result)).toContain("Error: timeout");
	});

	it("marks the record consumed for a completed agent (pull-delivery edge)", async () => {
		const record = createTestSubagent({ toolCallId: "tc-1" });
		const records = new Map([["agent-1", record]]);
		await execute(makeManager(records), { agent_id: "agent-1" });
		expect(record.consumed).toBe(true);
	});

	it("marks consumed even for a completed agent without a toolCallId", async () => {
		const record = createTestSubagent();
		const records = new Map([["agent-1", record]]);
		await execute(makeManager(records), { agent_id: "agent-1" });
		expect(record.consumed).toBe(true);
	});

	it("does not mark a running agent consumed", async () => {
		const record = createTestSubagent({ status: "running", completedAt: undefined });
		const records = new Map([["agent-1", record]]);
		await execute(makeManager(records), { agent_id: "agent-1" });
		expect(record.consumed).toBe(false);
	});

	it("waits for promise when wait=true and agent is running", async () => {
		const sessionStub = createSubagentSessionStub();
		sessionStub.runTurnLoop.mockResolvedValue(turnLoopResult({ responseText: "Finished after wait." }));
		const record = createTestSubagent({
			status: "running",
			completedAt: undefined,
			execution: makeStubExecution({
				createSubagentSession: async () => toSubagentSession(sessionStub),
			}),
		});
		record.start();
		const records = new Map([["agent-1", record]]);
		const result = await execute(makeManager(records), { agent_id: "agent-1", wait: true });
		// After waiting, the record is completed and result is shown
		expect(textOf(result)).toContain("Finished after wait.");
		expect(record.consumed).toBe(true);
	});

	it("waits for a queued agent when wait=true", async () => {
		const sessionStub = createSubagentSessionStub();
		sessionStub.runTurnLoop.mockResolvedValue(turnLoopResult({ responseText: "Finished after the queue." }));
		const record = createTestSubagent({
			status: "queued",
			completedAt: undefined,
			execution: makeStubExecution({
				createSubagentSession: async () => toSubagentSession(sessionStub),
			}),
		});
		// The limiter admits the agent only after the parent has begun waiting.
		const { promise: slot, resolve: openSlot } = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
		record.scheduleVia(async (thunk) => {
			await slot;
			await thunk();
		});
		const records = new Map([["agent-1", record]]);

		const resultPromise = execute(makeManager(records), { agent_id: "agent-1", wait: true });
		openSlot();

		const result = await resultPromise;
		expect(textOf(result)).toContain("Finished after the queue.");
		expect(record.consumed).toBe(true);
	});

	it("reports the current state when the parent turn is interrupted mid-wait", async () => {
		const sessionStub = createSubagentSessionStub();
		// A run that never settles — only the interrupt can end this wait.
		sessionStub.runTurnLoop.mockReturnValue(new Promise<never>(() => {}));
		const record = createTestSubagent({
			status: "running",
			completedAt: undefined,
			execution: makeStubExecution({
				createSubagentSession: async () => toSubagentSession(sessionStub),
			}),
		});
		record.start();
		const controller = new AbortController();
		const records = new Map([["agent-1", record]]);

		const resultPromise = execute(makeManager(records), { agent_id: "agent-1", wait: true }, controller.signal);
		controller.abort();

		const result = await resultPromise;
		expect(textOf(result)).toContain("Status: running");
		// The parent never collected an outcome, so the completion nudge still owes it one.
		expect(record.consumed).toBe(false);
	});

	it("includes conversation when verbose=true", async () => {
		const record = createTestSubagent();
		const stub = createSubagentSessionStub();
		stub.getConversation.mockReturnValue("[User]: hello");
		record.subagentSession = toSubagentSession(stub);
		const records = new Map([["agent-1", record]]);
		const result = await execute(makeManager(records), { agent_id: "agent-1", verbose: true });
		expect(textOf(result)).toContain("--- Agent Conversation ---");
		expect(textOf(result)).toContain("[User]: hello");
	});

	it("points to the transcript when verbose is requested but the session was released", async () => {
		const record = createTestSubagent();
		record.subagentSession = toSubagentSession(createSubagentSessionStub(createMockSession(), "/tasks/agent.jsonl"));
		await record.releaseSession();
		const records = new Map([["agent-1", record]]);
		const result = await execute(makeManager(records), { agent_id: "agent-1", verbose: true });
		expect(textOf(result)).toContain("Full transcript available at: /tasks/agent.jsonl");
		expect(textOf(result)).not.toContain("--- Agent Conversation ---");
	});
});

describe("GetResultTool — progress", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(80_000);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("reports a running agent's activity, turns used, and time since its last progress", async () => {
		const record = createTestSubagent({
			status: "running",
			completedAt: undefined,
			startedAt: 1000,
			lastProgressAt: 8000,
			activeTools: ["bash"],
			turnBudget: { used: 7, phase: "within" },
		});

		const result = await execute(makeManager(new Map([["agent-1", record]])), { agent_id: "agent-1" });

		expect(textOf(result)).toContain("\nProgress: running command\u2026 | Turns: 7 | Last progress: 72.0s ago\n");
	});

	it("reports no progress for an agent that has finished", async () => {
		const record = createTestSubagent({ activeTools: ["bash"], lastProgressAt: 8000 });

		const result = await execute(makeManager(new Map([["agent-1", record]])), { agent_id: "agent-1" });

		expect(textOf(result)).not.toContain("Progress:");
	});
});

describe("GetResultTool — bounded wait", () => {
	const EXPIRY_NOTE = "This wait ended after its 120s timeout. The agent was not stopped and is still running.";

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	/** A started agent whose run settles only when the test finishes it. */
	async function stalledAgent() {
		const sessionStub = createSubagentSessionStub();
		const run = Promise.withResolvers<TurnLoopResult>();
		sessionStub.runTurnLoop.mockReturnValue(run.promise);
		const record = createTestSubagent({
			status: "running",
			completedAt: undefined,
			execution: makeStubExecution({
				createSubagentSession: async () => toSubagentSession(sessionStub),
			}),
		});
		record.start();
		await vi.advanceTimersByTimeAsync(0);
		const opts = sessionStub.runTurnLoop.mock.lastCall?.[1] as { signal: AbortSignal } | undefined;
		if (!opts) throw new Error("the run never reached its turn loop");
		return {
			record,
			turnLoopSignal: opts.signal,
			finish: () => { run.resolve(turnLoopResult({ responseText: "Finished." })); },
			manager: makeManager(new Map([["agent-1", record]])),
		};
	}

	it("returns at the bound with the agent still running and its outcome uncollected", async () => {
		const { record, turnLoopSignal, finish, manager } = await stalledAgent();

		const resultPromise = execute(manager, { agent_id: "agent-1", wait: true, timeout: 120 });
		await vi.advanceTimersByTimeAsync(120_000);
		const text = textOf(await resultPromise);

		expect(text).toContain(EXPIRY_NOTE);
		expect(text).toContain("\nProgress: ");
		expect(record.status).toBe("running");
		expect(turnLoopSignal.aborted).toBe(false);
		expect(record.claimed).toBe(false);
		expect(record.consumed).toBe(false);
		finish();
		await record.promise;
	});

	it("keeps waiting until the bound", async () => {
		const { record, finish, manager } = await stalledAgent();
		let returned = false;

		const resultPromise = execute(manager, { agent_id: "agent-1", wait: true, timeout: 120 }).then((result) => {
			returned = true;
			return result;
		});
		await vi.advanceTimersByTimeAsync(119_999);

		expect(returned).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		await resultPromise;
		finish();
		await record.promise;
	});

	it("collects the outcome of a run that settles first, leaving no timer behind", async () => {
		const { record, finish, manager } = await stalledAgent();

		const resultPromise = execute(manager, { agent_id: "agent-1", wait: true, timeout: 120 });
		await vi.advanceTimersByTimeAsync(10_000);
		finish();
		const text = textOf(await resultPromise);

		expect(text).toContain("Finished.");
		expect(text).not.toContain("This wait ended");
		expect(record.consumed).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("adds no expiry note when the parent turn is interrupted", async () => {
		const { record, finish, manager } = await stalledAgent();
		const controller = new AbortController();

		const resultPromise = execute(manager, { agent_id: "agent-1", wait: true, timeout: 120 }, controller.signal);
		controller.abort();
		const text = textOf(await resultPromise);

		expect(text).toContain("Status: running");
		expect(text).not.toContain("This wait ended");
		finish();
		await record.promise;
	});

	it("ignores the bound when the call does not wait", async () => {
		const { record, finish, manager } = await stalledAgent();

		const text = textOf(await execute(manager, { agent_id: "agent-1", timeout: 120 }));

		expect(text).toContain("Status: running");
		expect(text).not.toContain("This wait ended");
		finish();
		await record.promise;
	});

	it.each([0, -1, Number.NaN, 2_147_484])("rejects a timeout of %s", async (timeout) => {
		const manager = makeManager(new Map([["agent-1", createTestSubagent()]]));

		await expect(execute(manager, { agent_id: "agent-1", wait: true, timeout })).rejects.toThrow("Invalid timeout");
	});

	it("tells the model that an expired wait does not stop the agent", () => {
		const definition = new GetResultTool(makeManager(), testRegistry).toToolDefinition();

		expect(definition.description).toContain("this does not stop or abort the agent");
		expect(definition.parameters.properties.timeout.description).toContain("An expired wait does not stop the agent");
	});
});

describe("GetResultTool — TUI rendering", () => {
	const theme: Theme = {
		fg: (color: string, text: string) => `[${color}:${text}]`,
		bold: (text: string) => `**${text}**`,
	};

	// The registered hooks take Pi's full Theme; `display.ts` narrows it to the two
	// methods the renderers call, so a double is structurally short of the SDK type.
	const asSdkTheme = theme as never;

	function renderRows(
		result: Awaited<ReturnType<GetResultTool["execute"]>>,
		expanded: boolean,
		width = 100,
	): string[] {
		const { renderResult } = new GetResultTool(makeManager(), testRegistry).toToolDefinition();
		if (!renderResult) throw new Error("get_subagent_result registers no renderResult");
		const component = renderResult(
			result,
			{ expanded, isPartial: false },
			asSdkTheme,
			undefined as never,
		);
		return component.render(width);
	}

	describe("result rendering", () => {
		it("spends three rows on a collapsed result, however long the report", async () => {
			const records = new Map([
				["agent-1", createTestSubagent({ result: longResult(200) })],
			]);

			const result = await execute(makeManager(records), { agent_id: "agent-1" });

			expect(renderRows(result, false)).toHaveLength(3);
		});

		it("bounds an expanded result at the cap plus its indicator row", async () => {
			const records = new Map([
				["agent-1", createTestSubagent({ result: longResult(200) })],
			]);

			const result = await execute(makeManager(records), { agent_id: "agent-1" });

			expect(renderRows(result, true)).toHaveLength(MAX_EXPANDED_LINES + 1);
		});

		it("spends one row per line whatever the terminal width", async () => {
			const records = new Map([
				["agent-1", createTestSubagent({ result: "x".repeat(526) })],
			]);

			const result = await execute(makeManager(records), { agent_id: "agent-1" });

			for (const width of [40, 80, 120]) {
				expect(renderRows(result, false, width)).toHaveLength(3);
			}
		});

		it("falls back to the plain message when there is no record to summarise", async () => {
			const result = await execute(makeManager(), { agent_id: "ghost" });

			expect(renderRows(result, false).join("\n")).toContain("Agent not found");
		});
	});

	describe("call rendering", () => {
		it("names the agent being retrieved", () => {
			const { renderCall } = new GetResultTool(makeManager(), testRegistry).toToolDefinition();
			if (!renderCall) throw new Error("get_subagent_result registers no renderCall");

			const rows = renderCall({ agent_id: "agent-42" }, asSdkTheme, undefined as never).render(100);

			expect(rows.join("\n")).toContain("agent-42");
		});

		it("names the bound of a bounded wait", () => {
			const { renderCall } = new GetResultTool(makeManager(), testRegistry).toToolDefinition();
			if (!renderCall) throw new Error("get_subagent_result registers no renderCall");

			const rows = renderCall({ agent_id: "agent-42", wait: true, timeout: 120 }, asSdkTheme, undefined as never).render(100);

			expect(rows.join("\n")).toContain("[muted:(waiting \u2264120s)]");
		});
	});

	describe("details payload", () => {
		it("carries the run's turn budget and names its wrap-up in the report", async () => {
			const turnBudget = { maxTurns: 2, used: 3, phase: "warned" } as const;
			const records = new Map([["agent-1", createTestSubagent({ turnBudget })]]);

			const result = await execute(makeManager(records), { agent_id: "agent-1" });

			expect(result.details?.turnBudget).toEqual(turnBudget);
			expect(textOf(result)).toContain("Status: completed (wrapped up \u2014 after turn-budget warning) |");
		});

		it("carries a preview bounded well below the result it summarises", async () => {
			const records = new Map([
				["agent-1", createTestSubagent({ result: longResult(200) })],
			]);

			const result = await execute(makeManager(records), { agent_id: "agent-1" });

			expect(result.details?.preview?.length).toBeLessThanOrEqual(PREVIEW_CHARS);
		});

		it("never duplicates the result body into the session entry", async () => {
			const records = new Map([
				["agent-1", createTestSubagent({ result: longResult(200) })],
			]);

			const result = await execute(makeManager(records), { agent_id: "agent-1" });

			expect(JSON.stringify(result.details)).not.toContain("report line 200");
		});

		it("never carries the conversation, even when verbose was requested", async () => {
			const record = createTestSubagent();
			const stub = createSubagentSessionStub();
			stub.getConversation.mockReturnValue("[User]: hello");
			record.subagentSession = toSubagentSession(stub);

			const result = await execute(makeManager(new Map([["agent-1", record]])), {
				agent_id: "agent-1",
				verbose: true,
			});

			expect(result.details?.verbose).toBe(true);
			expect(JSON.stringify(result.details)).not.toContain("[User]: hello");
		});

		it("omits details entirely when there is no record", async () => {
			const result = await execute(makeManager(), { agent_id: "ghost" });

			expect(result.details).toBeUndefined();
		});
	});
});
