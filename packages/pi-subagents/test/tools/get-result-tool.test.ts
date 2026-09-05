import { describe, expect, it } from "vitest";
import { AgentTypeRegistry } from "#src/config/agent-types";
import {
	type GetResultDetails,
	GetResultTool,
	type GetResultToolManager,
	renderGetResult,
} from "#src/tools/get-result-tool";
import type { Subagent } from "#src/types";
import type { Theme } from "#src/ui/display";
import { createTestSubagent, makeStubExecution } from "#test/helpers/make-subagent";
import { createMockSession, createSubagentSessionStub, toSubagentSession } from "#test/helpers/mock-session";
import { STUB_CTX } from "#test/helpers/stub-ctx";

// Mock theme for testing render output
function makeMockTheme() {
	const outputs: Map<string, string[]> = new Map();
	const mockTheme: Theme = {
		fg: (color: string, text: string) => {
			const key = `fg:${color}`;
			if (!outputs.has(key)) outputs.set(key, []);
			outputs.get(key)!.push(text);
			return `${color}:${text}`;
		},
		bold: (text: string) => `bold:${text}`,
	};
	return { theme: mockTheme, outputs };
}

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

describe("GetResultTool rendering", () => {
	function makeDetails(overrides: Partial<GetResultDetails> = {}): GetResultDetails {
		return {
			id: "test-agent",
			displayName: "Test Agent",
			status: "completed" as const,
			description: "Test description",
			toolUses: 5,
			tokens: "1.2K",
			duration: "10s",
			contextPercent: 50,
			compactionCount: 0,
			result: "Test result",
			error: undefined,
			verbose: false,
			transcriptPath: undefined,
			stoppedWhileQueued: false,
			...overrides,
		};
	}

	function renderResult(details: GetResultDetails, expanded: boolean) {
		const { theme, outputs } = makeMockTheme();
		const text = renderGetResult(details, expanded, theme);
		return { text, outputs };
	}

	it("renders collapsed state without result text", () => {
		const details = makeDetails({ result: "This should not appear in collapsed" });
		const { text } = renderResult(details, false);
		expect(text).not.toContain("This should not appear in collapsed");
		expect(text).toContain("test-agent");
		expect(text).toContain("completed");
	});

	it("renders expanded state with result text", () => {
		const details = makeDetails({ result: "Expanded result text" });
		const { text } = renderResult(details, true);
		expect(text).toContain("Expanded result text");
	});

	it("truncates description to 80 characters", () => {
		const longDesc = "a".repeat(100);
		const details = makeDetails({ description: longDesc });
		const { text } = renderResult(details, false);
		// Description should be truncated to 80 chars with ellipsis
		expect(text).toContain("aaaaaaaaaaaaaaa"); // Start of truncated description
		// The text should contain ellipsis (the … character)
		expect(text).toContain("…");
	});

	it("truncates result lines to 200 characters each", () => {
		const longLine = "x".repeat(250);
		const details = makeDetails({ result: longLine });
		const { text } = renderResult(details, true);
		// Should contain truncated line (200 + ellipsis)
		expect(text).toContain("xxxxxxxxxxxxxxxxx"); // Start of truncated line
		// The text should contain ellipsis (the … character)
		expect(text).toContain("…");
	});

	it("limits result to 30 lines", () => {
		const manyLines = Array.from({ length: 40 }, (_, i) => `line${i}`).join("\n");
		const details = makeDetails({ result: manyLines });
		const { text } = renderResult(details, true);
		expect(text).toContain("line0");
		expect(text).toContain("line29");
		expect(text).not.toContain("line30");
		expect(text).toContain("(truncated)");
	});

	it("shows stopped-while-queued message", () => {
		const details = makeDetails({ status: "running", stoppedWhileQueued: true });
		const { text } = renderResult(details, true);
		expect(text).toContain("stopped while queued");
	});

	it("shows running message for running status", () => {
		const details = makeDetails({ status: "running", stoppedWhileQueued: false });
		const { text } = renderResult(details, true);
		expect(text).toContain("still running");
	});

	it("shows verbose note when verbose=true", () => {
		const details = makeDetails({ verbose: true });
		const { text } = renderResult(details, true);
		expect(text).toContain("verbose conversation in result for model");
	});

	it("shows transcript note when transcriptPath is set", () => {
		const details = makeDetails({ verbose: false, transcriptPath: "/path/to/transcript.jsonl" });
		const { text } = renderResult(details, true);
		expect(text).toContain("full transcript available");
	});

	it("uses correct icon/style for aborted status (error style)", () => {
		const details = makeDetails({ status: "aborted" });
		const { outputs } = renderResult(details, false);
		// aborted should use error style (matching result-renderer.ts)
		const errorOutputs = outputs.get("fg:error") ?? [];
		expect(errorOutputs.some((s) => s.includes("✗"))).toBe(true);
	});

	it("uses compaction glyph when compactionCount > 0", () => {
		const details = makeDetails({ compactionCount: 3 });
		const { text } = renderResult(details, false);
		expect(text).toContain("⇊3");
	});
});
