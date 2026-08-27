import { describe, expect, it, vi } from "vitest";
import { SteerTool, type SteerToolEvents, type SteerToolManager } from "#src/tools/steer-tool";
import type { Subagent } from "#src/types";
import { createTestSubagent } from "#test/helpers/make-subagent";
import { createMockSession, createSubagentSessionStub, toSubagentSession } from "#test/helpers/mock-session";
import { STUB_CTX } from "#test/helpers/stub-ctx";

function makeManager(records: Map<string, Subagent> = new Map()): SteerToolManager {
	return {
		getRecord: (id: string) => records.get(id),
	};
}

function makeEvents(): SteerToolEvents {
	return { emit: vi.fn() };
}

async function execute(
	manager: SteerToolManager,
	events: SteerToolEvents,
	params: { agent_id: string; message: string },
) {
	const tool = new SteerTool(manager, events);
	return tool.execute("tc-1", params, new AbortController().signal, undefined, STUB_CTX);
}

describe("SteerTool", () => {
	it("returns tool definition with correct name", () => {
		const tool = new SteerTool(makeManager(), makeEvents());
		expect(tool.toToolDefinition().name).toBe("steer_subagent");
	});

	it("includes promptSnippet", () => {
		const tool = new SteerTool(makeManager(), makeEvents());
		expect(tool.toToolDefinition().promptSnippet).toBe(
			"Send a mid-run message to redirect a running background agent.",
		);
	});

	it("returns not-found message for unknown agent ID without claiming cleanup", async () => {
		const result = await execute(makeManager(), makeEvents(), { agent_id: "unknown", message: "hi" });
		expect(result.content[0].text).toContain("Agent not found");
		expect(result.content[0].text).not.toContain("cleaned up");
	});

	it("rejects steering a non-running agent", async () => {
		const records = new Map([["agent-1", createTestSubagent({ status: "completed" })]]);
		const result = await execute(makeManager(records), makeEvents(), { agent_id: "agent-1", message: "hi" });
		expect(result.content[0].text).toContain("not running");
		expect(result.content[0].text).toContain("completed");
	});

	it("queues steer when session is not ready", async () => {
		// No execution state set — session not yet created
		const record = createTestSubagent({ status: "running" });
		const records = new Map([["agent-1", record]]);
		const manager = makeManager(records);
		const events = makeEvents();
		const result = await execute(manager, events, { agent_id: "agent-1", message: "redirect" });
		expect(result.content[0].text).toContain("queued");
		expect(record.pendingSteerCount).toBe(1);
		expect(events.emit).toHaveBeenCalledWith("subagents:steered", {
			id: "agent-1",
			message: "redirect",
		});
	});

	it("sends steer and emits event on success", async () => {
		const record = createTestSubagent({ status: "running" });
		const mockSession = createMockSession();
		record.subagentSession = toSubagentSession(createSubagentSessionStub(mockSession));
		const records = new Map([["agent-1", record]]);
		const manager = makeManager(records);
		const events = makeEvents();
		const result = await execute(manager, events, { agent_id: "agent-1", message: "change plan" });
		expect(mockSession.steer).toHaveBeenCalledWith("change plan");
		expect(events.emit).toHaveBeenCalledWith("subagents:steered", {
			id: "agent-1",
			message: "change plan",
		});
		expect(result.content[0].text).toContain("Steering message sent");
		expect(result.content[0].text).toContain("3 tool uses");
	});

	it("returns error message when steer fails", async () => {
		const record = createTestSubagent({ status: "running" });
		const mockSession = createMockSession();
		mockSession.steer.mockRejectedValue(new Error("session closed"));
		record.subagentSession = toSubagentSession(createSubagentSessionStub(mockSession));
		const records = new Map([["agent-1", record]]);
		const result = await execute(makeManager(records), makeEvents(), { agent_id: "agent-1", message: "hi" });
		expect(result.content[0].text).toContain("Failed to steer agent");
		expect(result.content[0].text).toContain("session closed");
	});
});
