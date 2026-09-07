import { describe, expect, it } from "vitest";
import {
	type AgentReport,
	formatAgentReport,
	renderReportBody,
	renderStatsParts,
} from "#src/tools/get-result-report";

function makeReport(overrides: Partial<AgentReport> = {}): AgentReport {
	return {
		id: "agent-1",
		displayName: "General",
		status: "completed",
		toolUses: 3,
		tokens: "",
		contextPercent: null,
		compactionCount: 0,
		duration: "12.3s",
		description: "Investigate the bug",
		result: "All done.",
		error: undefined,
		stoppedWhileQueued: false,
		conversation: undefined,
		transcriptPath: undefined,
		resumeRefusal: undefined,
		...overrides,
	};
}

describe("renderStatsParts", () => {
	it("always includes tool uses and duration", () => {
		const parts = renderStatsParts(makeReport());
		expect(parts).toEqual(["Tool uses: 3", "Duration: 12.3s"]);
	});

	it("includes tokens when present", () => {
		const parts = renderStatsParts(makeReport({ tokens: "33.8k token" }));
		expect(parts).toEqual(["Tool uses: 3", "33.8k token", "Duration: 12.3s"]);
	});

	it("omits tokens when empty string", () => {
		const parts = renderStatsParts(makeReport({ tokens: "" }));
		expect(parts).not.toContain("");
	});

	it("includes rounded context percent when present", () => {
		const parts = renderStatsParts(makeReport({ contextPercent: 42.6 }));
		expect(parts).toContain("Context: 43%");
	});

	it("omits context when null", () => {
		const parts = renderStatsParts(makeReport({ contextPercent: null }));
		expect(parts.some((p) => p.startsWith("Context:"))).toBe(false);
	});

	it("includes compactions when non-zero", () => {
		const parts = renderStatsParts(makeReport({ compactionCount: 2 }));
		expect(parts).toContain("Compactions: 2");
	});

	it("omits compactions when zero", () => {
		const parts = renderStatsParts(makeReport({ compactionCount: 0 }));
		expect(parts.some((p) => p.startsWith("Compactions:"))).toBe(false);
	});
});

describe("renderReportBody", () => {
	it("shows a still-running note for running status", () => {
		const body = renderReportBody(makeReport({ status: "running", result: undefined }));
		expect(body).toBe("Agent is still running. Use wait: true or check back later.");
	});

	it("shows the error message for error status", () => {
		const body = renderReportBody(makeReport({ status: "error", error: "timeout" }));
		expect(body).toBe("Error: timeout");
	});

	it("shows the trimmed result for completed status", () => {
		const body = renderReportBody(makeReport({ status: "completed", result: "  All done.  " }));
		expect(body).toBe("All done.");
	});

	it("shows a no-output fallback when result is undefined", () => {
		const body = renderReportBody(makeReport({ status: "completed", result: undefined }));
		expect(body).toBe("No output.");
	});

	it("says an agent stopped while queued never started, rather than showing no output", () => {
		const body = renderReportBody(
			makeReport({ status: "stopped", stoppedWhileQueued: true, result: undefined }),
		);
		expect(body).toBe(
			"Agent was stopped while queued and never started. No work was performed.",
		);
	});
});

describe("formatAgentReport", () => {
	it("surfaces a declared question as answerable, naming the resume call", () => {
		const text = formatAgentReport(
			makeReport({ id: "agent-7", pendingQuestion: "Which config?" }),
		);

		expect(text).toContain("This agent is waiting on an answer:");
		expect(text).toContain("Which config?");
		expect(text).toContain('resume: "agent-7"');
	});

	it("adds no affordance when the agent asked nothing", () => {
		expect(formatAgentReport(makeReport())).not.toContain("waiting on an answer");
	});

	it("reports a question the released session can no longer answer, without a resume call", () => {
		const text = formatAgentReport(
			makeReport({
				id: "agent-7",
				pendingQuestion: "Which config?",
				resumeRefusal: "session-released",
			}),
		);

		expect(text).toContain("can no longer be answered");
		expect(text).toContain("its session was released after its retention window");
		expect(text).toContain("Which config?");
		expect(text).not.toContain("resume:");
	});

	it("reports the updates the agent sent while the parent waited", () => {
		const text = formatAgentReport(makeReport({ runUpdates: ["The bug is in the retry wrapper."] }));

		expect(text).toContain("Updates this agent sent while it worked:");
		expect(text).toContain("The bug is in the retry wrapper.");
	});

	it("adds nothing when the agent sent no updates", () => {
		expect(formatAgentReport(makeReport())).not.toContain("Updates this agent sent");
	});

	it("names where a teardown saved the agent's work", () => {
		const text = formatAgentReport(
			makeReport({ workspaceNotice: "\n\n---\nChanges saved to branch `pi-agent-7`." }),
		);

		expect(text).toContain("Changes saved to branch `pi-agent-7`.");
	});

	it("adds nothing when no teardown reported anything", () => {
		expect(formatAgentReport(makeReport())).not.toContain("saved to branch");
	});

	it("reports where the work went before telling the parent how to answer", () => {
		const text = formatAgentReport(
			makeReport({
				pendingQuestion: "Which config?",
				workspaceNotice: "\n\n---\nChanges saved to branch `pi-agent-7`.",
			}),
		);

		// Both must be present, or the index comparison passes on a -1 that means
		// "absent" rather than "earlier".
		expect(text).toContain("saved to branch");
		expect(text).toContain("waiting on an answer");
		expect(text.indexOf("saved to branch")).toBeLessThan(text.indexOf("waiting on an answer"));
	});

	it("names the abort, so truncated output is not read as a finished answer", () => {
		const text = formatAgentReport(
			makeReport({ status: "aborted", result: "Half of the inv" }),
		);

		expect(text).toContain("aborted \u2014 max turns exceeded, output may be incomplete");
		expect(text).toContain("Half of the inv");
	});

	it("names a turn-limit wrap-up", () => {
		expect(formatAgentReport(makeReport({ status: "steered" }))).toContain(
			"wrapped up \u2014 reached turn limit",
		);
	});

	it("adds no status note for a plain completion", () => {
		expect(formatAgentReport(makeReport({ status: "completed" }))).toContain("Status: completed |");
	});

	it("assembles the full header, stats line, description, and body", () => {
		const text = formatAgentReport(
			makeReport({
				id: "agent-1",
				displayName: "General",
				status: "completed",
				toolUses: 3,
				tokens: "33.8k token",
				contextPercent: 42.6,
				compactionCount: 1,
				duration: "12.3s",
				description: "Investigate the bug",
				result: "All done.",
			}),
		);
		expect(text).toBe(
			"Agent: agent-1\n" +
				"Type: General | Status: completed | Tool uses: 3 | 33.8k token | Context: 43% | Compactions: 1 | Duration: 12.3s\n" +
				"Description: Investigate the bug\n\n" +
				"All done.",
		);
	});

	it("appends the conversation block when present", () => {
		const text = formatAgentReport(
			makeReport({ conversation: "[User]: hello" }),
		);
		expect(text).toContain("\n\n--- Agent Conversation ---\n[User]: hello");
	});

	it("omits the conversation block when absent", () => {
		const text = formatAgentReport(makeReport({ conversation: undefined }));
		expect(text).not.toContain("--- Agent Conversation ---");
	});

	it("renders a transcript pointer line when transcriptPath is present", () => {
		const text = formatAgentReport(makeReport({ transcriptPath: "/tasks/agent.jsonl" }));
		expect(text).toContain("Full transcript available at: /tasks/agent.jsonl");
	});

	it("omits the transcript line when transcriptPath is absent", () => {
		const text = formatAgentReport(makeReport({ transcriptPath: undefined }));
		expect(text).not.toContain("Full transcript available at:");
	});
});
