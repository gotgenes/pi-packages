import { describe, expect, it } from "vitest";
import {
	renderAgentResult,
	renderBackground,
	renderCompleted,
	renderFailed,
	renderRunning,
	renderStats,
	renderStopped,
} from "#src/tools/result-renderer";
import type { AgentDetails, Theme } from "#src/ui/display";

function makeTheme(): Theme {
	return {
		fg: (color: string, text: string) => `[${color}:${text}]`,
		bold: (text: string) => `**${text}**`,
	};
}

function makeDetails(overrides: Partial<AgentDetails> = {}): AgentDetails {
	return {
		displayName: "TestAgent",
		description: "test task",
		subagentType: "general-purpose",
		toolUses: 0,
		tokens: "",
		durationMs: 2000,
		status: "completed",
		...overrides,
	};
}

describe("renderStats", () => {
	const theme = makeTheme();

	it("returns empty string when all fields are absent or zero", () => {
		const details = makeDetails({ toolUses: 0, tokens: "" });
		expect(renderStats(details, theme)).toBe("");
	});

	it("includes model name", () => {
		const details = makeDetails({ modelName: "haiku" });
		expect(renderStats(details, theme)).toContain("[dim:haiku]");
	});

	it("includes tags", () => {
		const details = makeDetails({ tags: ["thinking: high", "inherit context"] });
		const result = renderStats(details, theme);
		expect(result).toContain("[dim:thinking: high]");
		expect(result).toContain("[dim:inherit context]");
	});

	it("includes turn count with max turns", () => {
		const details = makeDetails({ turnCount: 5, maxTurns: 30 });
		expect(renderStats(details, theme)).toContain("[dim:↻5≤30]");
	});

	it("includes turn count without max turns", () => {
		const details = makeDetails({ turnCount: 5 });
		expect(renderStats(details, theme)).toContain("[dim:↻5]");
	});

	it("excludes turn count when turnCount is 0", () => {
		const details = makeDetails({ turnCount: 0 });
		expect(renderStats(details, theme)).not.toContain("↻");
	});

	it("excludes turn count when turnCount is undefined", () => {
		const details = makeDetails({ turnCount: undefined });
		expect(renderStats(details, theme)).not.toContain("↻");
	});

	it("includes singular tool use", () => {
		const details = makeDetails({ toolUses: 1 });
		expect(renderStats(details, theme)).toContain("[dim:1 tool use]");
	});

	it("includes plural tool uses", () => {
		const details = makeDetails({ toolUses: 3 });
		expect(renderStats(details, theme)).toContain("[dim:3 tool uses]");
	});

	it("excludes tool uses when count is zero", () => {
		const details = makeDetails({ toolUses: 0 });
		expect(renderStats(details, theme)).not.toContain("tool use");
	});

	it("includes tokens", () => {
		const details = makeDetails({ tokens: "33.8k token" });
		expect(renderStats(details, theme)).toContain("[dim:33.8k token]");
	});

	it("joins multiple parts with dim separator", () => {
		const details = makeDetails({ modelName: "haiku", toolUses: 2 });
		expect(renderStats(details, theme)).toBe("[dim:haiku] [dim:·] [dim:2 tool uses]");
	});
});

describe("renderRunning", () => {
	const theme = makeTheme();

	it("uses spinner frame from details.spinnerFrame", () => {
		const details = makeDetails({ status: "running", spinnerFrame: 1 });
		expect(renderRunning(details, theme)).toContain("[accent:\u2819]");
	});

	it("defaults spinner frame to index 0 when undefined", () => {
		const details = makeDetails({ status: "running", spinnerFrame: undefined });
		expect(renderRunning(details, theme)).toContain("[accent:\u280B]");
	});

	it("includes stats in output", () => {
		const details = makeDetails({ status: "running", modelName: "haiku" });
		expect(renderRunning(details, theme)).toContain("[dim:haiku]");
	});

	it("uses activity text when provided", () => {
		const details = makeDetails({ status: "running", activity: "reading files" });
		expect(renderRunning(details, theme)).toContain("reading files");
	});

	it("falls back to 'thinking\u2026' when activity is absent", () => {
		const details = makeDetails({ status: "running", activity: undefined });
		expect(renderRunning(details, theme)).toContain("thinking\u2026");
	});

	it("renders activity on second line with dim styling", () => {
		const details = makeDetails({ status: "running", activity: "searching" });
		const result = renderRunning(details, theme);
		expect(result).toContain("\n[dim:  \u23BF  searching]");
	});
});

describe("renderBackground", () => {
	const theme = makeTheme();

	it("includes agent ID in output", () => {
		const details = makeDetails({ status: "background", agentId: "agent-42" });
		expect(renderBackground(details, theme)).toContain("agent-42");
	});

	it("wraps entire message in dim styling with agent ID", () => {
		const details = makeDetails({ status: "background", agentId: "agent-42" });
		expect(renderBackground(details, theme)).toBe(
			"[dim:  \u23BF  Running in background (ID: agent-42)]",
		);
	});
});

describe("renderCompleted", () => {
	const theme = makeTheme();

	it("uses success icon for completed status", () => {
		const details = makeDetails({ status: "completed", durationMs: 2000 });
		expect(renderCompleted(details, "", false, theme)).toContain("[success:\u2713]");
	});

	it("uses warning icon for steered status", () => {
		const details = makeDetails({ status: "steered", durationMs: 2000 });
		expect(renderCompleted(details, "", false, theme)).toContain("[warning:\u2713]");
	});

	it("includes formatted duration", () => {
		const details = makeDetails({ status: "completed", durationMs: 3500 });
		expect(renderCompleted(details, "", false, theme)).toContain("[dim:3.5s]");
	});

	it("collapsed view shows 'Done' for completed", () => {
		const details = makeDetails({ status: "completed", durationMs: 2000 });
		expect(renderCompleted(details, "", false, theme)).toContain("[dim:  \u23BF  Done]");
	});

	it("collapsed view shows 'Wrapped up (turn limit)' for steered", () => {
		const details = makeDetails({ status: "steered", durationMs: 2000 });
		expect(renderCompleted(details, "", false, theme)).toContain(
			"[dim:  \u23BF  Wrapped up (turn limit)]",
		);
	});

	it("expanded view shows result text lines with dim styling", () => {
		const details = makeDetails({ status: "completed", durationMs: 2000 });
		const result = renderCompleted(details, "line one\nline two", true, theme);
		expect(result).toContain("\n[dim:  line one]");
		expect(result).toContain("\n[dim:  line two]");
	});

	it("expanded view truncates to 50 lines and adds overflow message", () => {
		const details = makeDetails({ status: "completed", durationMs: 2000 });
		const manyLines = Array.from({ length: 55 }, (_, i) => `line ${i + 1}`).join("\n");
		const result = renderCompleted(details, manyLines, true, theme);
		expect(result).toContain("[dim:  line 50]");
		expect(result).not.toContain("[dim:  line 51]");
		expect(result).toContain(
			"[muted:  ... (use get_subagent_result with verbose for full output)]",
		);
	});

	it("expanded view with empty result text shows no content lines", () => {
		const details = makeDetails({ status: "completed", durationMs: 2000 });
		const result = renderCompleted(details, "", true, theme);
		expect(result).not.toContain("\u23BF");
	});
});

describe("renderStopped", () => {
	const theme = makeTheme();

	it("uses dim stop icon", () => {
		const details = makeDetails({ status: "stopped" });
		expect(renderStopped(details, theme)).toContain("[dim:\u25A0]");
	});

	it("includes stats in output", () => {
		const details = makeDetails({ status: "stopped", modelName: "haiku" });
		expect(renderStopped(details, theme)).toContain("[dim:haiku]");
	});

	it("shows Stopped message on second line", () => {
		const details = makeDetails({ status: "stopped" });
		expect(renderStopped(details, theme)).toContain("\n[dim:  \u23BF  Stopped]");
	});
});

describe("renderFailed", () => {
	const theme = makeTheme();

	it("uses error icon", () => {
		const details = makeDetails({ status: "error", error: "boom" });
		expect(renderFailed(details, theme)).toContain("[error:\u2717]");
	});

	it("shows error message for error status", () => {
		const details = makeDetails({ status: "error", error: "Out of context" });
		expect(renderFailed(details, theme)).toContain("[error:  \u23BF  Error: Out of context]");
	});

	it("defaults error message to 'unknown' when error is absent", () => {
		const details = makeDetails({ status: "error", error: undefined });
		expect(renderFailed(details, theme)).toContain("[error:  \u23BF  Error: unknown]");
	});

	it("shows aborted message with warning color for aborted status", () => {
		const details = makeDetails({ status: "aborted" });
		expect(renderFailed(details, theme)).toContain(
			"[warning:  \u23BF  Aborted (max turns exceeded)]",
		);
	});
});

describe("renderAgentResult", () => {
	const theme = makeTheme();

	it("dispatches to renderRunning when status is 'running'", () => {
		const details = makeDetails({ status: "running", spinnerFrame: 0 });
		expect(renderAgentResult(details, "", false, false, theme)).toContain("[accent:\u280B]");
	});

	it("dispatches to renderRunning when isPartial is true regardless of status", () => {
		const details = makeDetails({ status: "completed", spinnerFrame: 0 });
		expect(renderAgentResult(details, "", false, true, theme)).toContain("[accent:\u280B]");
	});

	it("dispatches to renderBackground for background status", () => {
		const details = makeDetails({ status: "background", agentId: "agent-99" });
		const result = renderAgentResult(details, "", false, false, theme);
		expect(result).toContain("Running in background");
		expect(result).toContain("agent-99");
	});

	it("dispatches to renderCompleted for completed status", () => {
		const details = makeDetails({ status: "completed", durationMs: 1000 });
		expect(renderAgentResult(details, "", false, false, theme)).toContain("[success:\u2713]");
	});

	it("dispatches to renderCompleted for steered status", () => {
		const details = makeDetails({ status: "steered", durationMs: 1000 });
		expect(renderAgentResult(details, "", false, false, theme)).toContain("[warning:\u2713]");
	});

	it("dispatches to renderStopped for stopped status", () => {
		const details = makeDetails({ status: "stopped" });
		expect(renderAgentResult(details, "", false, false, theme)).toContain("[dim:\u25A0]");
	});

	it("dispatches to renderFailed for error status", () => {
		const details = makeDetails({ status: "error", error: "boom" });
		expect(renderAgentResult(details, "", false, false, theme)).toContain("[error:\u2717]");
	});

	it("dispatches to renderFailed for aborted status", () => {
		const details = makeDetails({ status: "aborted" });
		expect(renderAgentResult(details, "", false, false, theme)).toContain(
			"[warning:  \u23BF  Aborted (max turns exceeded)]",
		);
	});
});
