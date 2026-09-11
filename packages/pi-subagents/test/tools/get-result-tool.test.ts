import { describe, expect, it } from "vitest";
import { AgentTypeRegistry } from "#src/config/agent-types";
import { MAX_EXPANDED_LINES, PREVIEW_CHARS } from "#src/tools/get-result-renderer";
import {
	GetResultTool,
	type GetResultToolManager,
} from "#src/tools/get-result-tool";
import type { Subagent } from "#src/types";
import type { Theme } from "#src/ui/display";
import { createTestSubagent, makeStubExecution } from "#test/helpers/make-subagent";
import { createMockSession, createSubagentSessionStub, toSubagentSession } from "#test/helpers/mock-session";
import { STUB_CTX } from "#test/helpers/stub-ctx";

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
	params: { agent_id: string; wait?: boolean; verbose?: boolean },
	signal: AbortSignal = new AbortController().signal,
) {
	const tool = new GetResultTool(manager, testRegistry);
	return tool.execute("tc-1", params, signal, undefined, STUB_CTX);
}

describe("GetResultTool — carrier claim", () => {
	it("claims the outcome for the duration of a wait", async () => {
		const sessionStub = createSubagentSessionStub();
		sessionStub.runTurnLoop.mockResolvedValue({ responseText: "Done.", aborted: false, steered: false });
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

	it("leaves another carrier's claim untouched when wait is not requested", async () => {
		const record = createTestSubagent({ status: "running", completedAt: undefined });
		record.claim();

		await execute(makeManager(new Map([["agent-1", record]])), { agent_id: "agent-1" });

		expect(record.claimed).toBe(true);
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
		expect(result.content[0].text).toContain("Agent not found");
	});

	it("returns status and result for completed agent", async () => {
		const records = new Map([["agent-1", createTestSubagent()]]);
		const result = await execute(makeManager(records), { agent_id: "agent-1" });
		const text = result.content[0].text;
		expect(text).toContain("Agent: agent-1");
		expect(text).toContain("completed");
		expect(text).toContain("All done.");
	});

	it("reports the updates the agent sent during the run", async () => {
		const records = new Map([
			["agent-1", createTestSubagent({ runUpdates: ["The bug is in the retry wrapper."] })],
		]);

		const result = await execute(makeManager(records), { agent_id: "agent-1" });

		expect(result.content[0].text).toContain("The bug is in the retry wrapper.");
	});

	describe("resume affordance", () => {
		it("names the resume call while the agent is still resumable", async () => {
			const records = new Map([
				["agent-1", createTestSubagent({ pendingQuestion: "Which config?", sessionReady: true })],
			]);

			const result = await execute(makeManager(records), { agent_id: "agent-1" });

			expect(result.content[0].text).toContain('resume: "agent-1"');
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

			expect(result.content[0].text).toContain("Which config?");
			expect(result.content[0].text).toContain("cannot be resumed yet");
			expect(result.content[0].text).not.toContain("resume:");
		});

		it("forwards the record's refusal, so a swept record names no resume", async () => {
			const released = createTestSubagent({
				pendingQuestion: "Which config?",
				sessionReady: true,
			});
			await released.releaseSession();
			const records = new Map([["agent-1", released]]);

			const result = await execute(makeManager(records), { agent_id: "agent-1" });

			expect(result.content[0].text).toContain("Which config?");
			expect(result.content[0].text).toContain(
				"its session was released after its retention window",
			);
			expect(result.content[0].text).not.toContain("resume:");
		});
	});

	it("shows running message for in-progress agent", async () => {
		const records = new Map([["agent-1", createTestSubagent({ status: "running", completedAt: undefined })]]);
		const result = await execute(makeManager(records), { agent_id: "agent-1" });
		expect(result.content[0].text).toContain("still running");
	});

	it("shows error for failed agent", async () => {
		const records = new Map([["agent-1", createTestSubagent({ status: "error", error: "timeout" })]]);
		const result = await execute(makeManager(records), { agent_id: "agent-1" });
		expect(result.content[0].text).toContain("Error: timeout");
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
		sessionStub.runTurnLoop.mockResolvedValue({ responseText: "Finished after wait.", aborted: false, steered: false });
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
		expect(result.content[0].text).toContain("Finished after wait.");
		expect(record.consumed).toBe(true);
	});

	it("waits for a queued agent when wait=true", async () => {
		const sessionStub = createSubagentSessionStub();
		sessionStub.runTurnLoop.mockResolvedValue({ responseText: "Finished after the queue.", aborted: false, steered: false });
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
		expect(result.content[0].text).toContain("Finished after the queue.");
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
		expect(result.content[0].text).toContain("Status: running");
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
		expect(result.content[0].text).toContain("--- Agent Conversation ---");
		expect(result.content[0].text).toContain("[User]: hello");
	});

	it("points to the transcript when verbose is requested but the session was released", async () => {
		const record = createTestSubagent();
		record.subagentSession = toSubagentSession(createSubagentSessionStub(createMockSession(), "/tasks/agent.jsonl"));
		await record.releaseSession();
		const records = new Map([["agent-1", record]]);
		const result = await execute(makeManager(records), { agent_id: "agent-1", verbose: true });
		expect(result.content[0].text).toContain("Full transcript available at: /tasks/agent.jsonl");
		expect(result.content[0].text).not.toContain("--- Agent Conversation ---");
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
	});

	describe("details payload", () => {
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
