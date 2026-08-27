import { describe, expect, it } from "vitest";
import { AgentTypeRegistry } from "#src/config/agent-types";
import {
	GetResultTool,
	type GetResultToolManager,
} from "#src/tools/get-result-tool";
import type { Subagent } from "#src/types";
import { createTestSubagent, makeStubExecution } from "#test/helpers/make-subagent";
import { createMockSession, createSubagentSessionStub, toSubagentSession } from "#test/helpers/mock-session";
import { STUB_CTX } from "#test/helpers/stub-ctx";

const testRegistry = new AgentTypeRegistry(() => new Map());

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
