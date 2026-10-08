import { describe, expect, it } from "vitest";
import { AgentTypeRegistry } from "#src/config/agent-types";
import type { Theme } from "#src/ui/display";
import type { WidgetAgent } from "#src/ui/widget-renderer";
import {
	renderFinishedLine,
	renderRunningLines,
	renderWidgetLines,
	widgetLineBudget,
} from "#src/ui/widget-renderer";

/** Minimal theme stub — wraps text with markup tags for assertion. */
function stubTheme(): Theme {
	return {
		fg: (color: string, text: string) => `[${color}:${text}]`,
		bold: (text: string) => `**${text}**`,
	};
}

const testRegistry = new AgentTypeRegistry(() => new Map());

function makeAgent(overrides: Partial<WidgetAgent> = {}): WidgetAgent {
	return {
		id: "agent-1",
		type: "general-purpose",
		status: "completed",
		description: "test task",
		toolUses: 5,
		startedAt: 1000,
		completedAt: 6000,
		compactionCount: 0,
		// Activity fields (folded from the former WidgetActivity)
		turnBudget: { maxTurns: 10, used: 3, phase: "within" },
		activeTools: new Map(),
		responseText: "",
		contextPercent: null,
		...overrides,
	};
}

type RenderWidgetLinesParams = Parameters<typeof renderWidgetLines>[0];

/**
 * Call `renderWidgetLines` with the defaults every case shares, overriding only
 * what the case is about. One place to teach a new parameter.
 */
function callRenderWidgetLines(overrides: Partial<RenderWidgetLinesParams> = {}): string[] {
	return renderWidgetLines({
		agents: [],
		registry: testRegistry,
		spinnerFrame: 0,
		terminalWidth: 200,
		terminalHeight: 40,
		theme: stubTheme(),
		shouldShowFinished: () => true,
		...overrides,
	});
}

describe("renderFinishedLine", () => {
	const theme = stubTheme();

	it("renders completed agent with success icon and stats", () => {
		const agent = makeAgent();
		const line = renderFinishedLine(agent, testRegistry, theme);

		// Success icon
		expect(line).toContain("[success:✓]");
		// Display name (general-purpose type displayName → "Agent"; tool name is now "subagent")
		expect(line).toContain("[dim:Agent]");
		// Description
		expect(line).toContain("[dim:test task]");
		// Tool uses
		expect(line).toContain("5 tool uses");
		// Duration (5000ms = 5.0s)
		expect(line).toContain("5.0s");
		// Turn count with max
		expect(line).toContain("↻3≤10");
		// No trailing status text for completed
		expect(line).not.toContain("error");
		expect(line).not.toContain("aborted");
		expect(line).not.toContain("stopped");
	});

	it("renders singular tool use", () => {
		const agent = makeAgent({ toolUses: 1 });
		const line = renderFinishedLine(agent, testRegistry, theme);

		expect(line).toContain("1 tool use");
		expect(line).not.toContain("1 tool uses");
	});

	it("omits tool uses when zero", () => {
		const agent = makeAgent({ toolUses: 0 });
		const line = renderFinishedLine(agent, testRegistry, theme);

		expect(line).not.toContain("tool use");
	});

	it("shows an unlimited run's turns without a ceiling", () => {
		const agent = makeAgent({ turnBudget: { used: 3, phase: "within" } });
		const line = renderFinishedLine(agent, testRegistry, theme);
		expect(line).toContain("↻3");
		expect(line).not.toContain("↻3≤");
	});

	it("omits turns for a run that never reported a turn budget", () => {
		const agent = makeAgent({ turnBudget: undefined, status: "stopped" });
		expect(renderFinishedLine(agent, testRegistry, theme)).not.toContain("↻");
	});

	it("uses Date.now() for duration when completedAt is undefined", () => {
		const now = Date.now();
		const agent = makeAgent({ startedAt: now - 2000, completedAt: undefined });
		const line = renderFinishedLine(agent, testRegistry, theme);

		// Should show ~2.0s (may vary slightly due to test execution time)
		expect(line).toMatch(/[12]\.\ds/);
	});

	it("renders error status with error icon and message", () => {
		const agent = makeAgent({ status: "error", error: "something broke" });
		const line = renderFinishedLine(agent, testRegistry, theme);

		expect(line).toContain("[error:✗]");
		expect(line).toContain("[error: error: something broke]");
	});

	it("renders error status without message when error is undefined", () => {
		const agent = makeAgent({ status: "error" });
		const line = renderFinishedLine(agent, testRegistry, theme);

		expect(line).toContain("[error:✗]");
		expect(line).toContain("[error: error]");
	});

	it("truncates long error messages to 60 chars", () => {
		const longError = "a".repeat(80);
		const agent = makeAgent({ status: "error", error: longError });
		const line = renderFinishedLine(agent, testRegistry, theme);

		// Error message should be sliced to 60 chars
		expect(line).toContain("a".repeat(60));
		expect(line).not.toContain("a".repeat(61));
	});

	it("renders aborted status with error icon and warning text", () => {
		const agent = makeAgent({ status: "aborted" });
		const line = renderFinishedLine(agent, testRegistry, theme);

		expect(line).toContain("[error:✗]");
		expect(line).toContain("[warning: aborted]");
	});

	it("renders a completed run the harness warned with warning icon and turn limit text", () => {
		const agent = makeAgent({ status: "completed", turnBudget: { maxTurns: 2, used: 3, phase: "warned" } });
		const line = renderFinishedLine(agent, testRegistry, theme);

		expect(line).toContain("[warning:\u2713]");
		expect(line).toContain("[warning: (budget warning)]");
	});

	it("renders stopped status with dim icon and text", () => {
		const agent = makeAgent({ status: "stopped" });
		const line = renderFinishedLine(agent, testRegistry, theme);

		expect(line).toContain("[dim:■]");
		expect(line).toContain("[dim: stopped]");
	});
});

describe("renderRunningLines", () => {
	const theme = stubTheme();

	it("shows a warned run's turns in the warning color", () => {
		const agent = makeAgent({
			status: "running",
			completedAt: undefined,
			turnBudget: { maxTurns: 10, used: 8, phase: "warned" },
		});
		const [header] = renderRunningLines(agent, testRegistry, 0, theme);
		expect(header).toContain("[warning:↻8≤10]");
	});

	it("shows turns within budget without the warning color", () => {
		const agent = makeAgent({ status: "running", completedAt: undefined });
		const [header] = renderRunningLines(agent, testRegistry, 0, theme);
		expect(header).toContain("↻3≤10");
		expect(header).not.toContain("[warning:↻");
	});

	it("returns header and activity lines", () => {
		const agent = makeAgent({
			status: "running",
			completedAt: undefined,
			activeTools: new Map([["read_1", "read"]]),
			turnBudget: { maxTurns: 10, used: 2, phase: "within" },
		});
		const [header, activityLine] = renderRunningLines(agent, testRegistry, 0, theme);

		// Header contains spinner frame, bold name, description
		expect(header).toContain("[accent:⠋]");
		expect(header).toContain("**Agent**");
		expect(header).toContain("[muted:test task]");
		// Stats: turn count
		expect(header).toContain("↻2≤10");
		// Tool uses
		expect(header).toContain("5 tool uses");

		// Activity line shows what the agent is doing
		expect(activityLine).toContain("reading");
	});

	it("shows thinking when activeTools is empty and responseText is blank", () => {
		// Default makeAgent has activeTools: new Map() and responseText: ""
		const agent = makeAgent({ status: "running", completedAt: undefined });
		const [, activityLine] = renderRunningLines(agent, testRegistry, 0, theme);

		expect(activityLine).toContain("thinking…");
	});

	it("advances spinner frame", () => {
		const agent = makeAgent({ status: "running", completedAt: undefined });
		const [header0] = renderRunningLines(agent, testRegistry, 0, theme);
		const [header1] = renderRunningLines(agent, testRegistry, 1, theme);

		expect(header0).toContain("[accent:⠋]");
		expect(header1).toContain("[accent:⠙]");
	});

	it("includes token display when lifetimeUsage has tokens", () => {
		const agent = makeAgent({
			status: "running",
			completedAt: undefined,
			lifetimeUsage: { input: 5000, output: 2000, cacheWrite: 1000 },
			compactionCount: 1,
			contextPercent: 45,
		});
		const [header] = renderRunningLines(agent, testRegistry, 0, theme);

		// 5000 + 2000 + 1000 = 8000 → "8.0k token"
		expect(header).toContain("8.0k token");
		// Context percent
		expect(header).toContain("45%");
		// Compaction count
		expect(header).toContain("⇊1");
	});

	it("omits token display when lifetimeUsage totals zero", () => {
		const agent = makeAgent({
			status: "running",
			completedAt: undefined,
			lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
		});
		const [header] = renderRunningLines(agent, testRegistry, 0, theme);

		expect(header).not.toContain("token");
	});
});

describe("model tag", () => {
	const theme = stubTheme();
	const model = { provider: "anthropic", id: "claude-sonnet-5" };

	it("follows the running agent's name and mode", () => {
		const agent = makeAgent({ status: "running", completedAt: undefined, model });
		const [header] = renderRunningLines(agent, testRegistry, 0, theme);
		expect(header).toContain("**Agent** [dim:(twin)] [dim:[anthropic/claude-sonnet-5]]  [muted:test task]");
	});

	it("follows the finished agent's name and mode", () => {
		const line = renderFinishedLine(makeAgent({ model }), testRegistry, theme);
		expect(line).toContain("[dim:Agent] [dim:(twin)] [dim:[anthropic/claude-sonnet-5]]  [dim:test task]");
	});

	it("is absent while the model is unknown", () => {
		const [header] = renderRunningLines(makeAgent({ status: "running", completedAt: undefined }), testRegistry, 0, theme);
		const line = renderFinishedLine(makeAgent(), testRegistry, theme);
		expect(header).toContain("**Agent** [dim:(twin)]  [muted:test task]");
		expect(line).toContain("[dim:Agent] [dim:(twin)]  [dim:test task]");
	});
});

describe("widgetLineBudget", () => {
	// Pi's differential renderer full-clears the screen when the first changed
	// line sits above the viewport, so the widget's own height has to leave the
	// dock below it room inside the terminal (#864).
	it.each([
		{ rows: 6, budget: 3 },
		{ rows: 7, budget: 3 },
		{ rows: 9, budget: 3 },
		{ rows: 10, budget: 4 },
		{ rows: 12, budget: 6 },
		{ rows: 14, budget: 8 },
		{ rows: 16, budget: 10 },
		{ rows: 18, budget: 12 },
		{ rows: 24, budget: 12 },
		{ rows: 60, budget: 12 },
	])("allows $budget lines in a $rows-row terminal", ({ rows, budget }) => {
		expect(widgetLineBudget(rows)).toBe(budget);
	});
});

describe("renderWidgetLines", () => {

	it("renders a single running agent with heading and tree connectors", () => {
		const agent = makeAgent({ status: "running", completedAt: undefined, turnBudget: { used: 1, phase: "within" } });

		const lines = callRenderWidgetLines({ agents: [agent] });

		// Heading with active indicator
		expect(lines[0]).toContain("●");
		expect(lines[0]).toContain("Agents");
		// Header line with └─ (last item uses └─ not ├─)
		expect(lines[1]).toContain("└─");
		expect(lines[1]).toContain("**Agent**");
		// Activity line — uses space indent (not │) since it's the last agent
		expect(lines[2]).not.toContain("│");
		expect(lines[2]).toContain("⎿");
		// Total: 3 lines (heading + header + activity)
		expect(lines).toHaveLength(3);
	});

	it("renders mixed running + finished + queued agents", () => {
		const running = makeAgent({ id: "r1", status: "running", completedAt: undefined });
		const finished = makeAgent({ id: "f1", status: "completed", completedAt: 6000, turnBudget: { used: 5, phase: "within" } });
		const queued = makeAgent({ id: "q1", status: "queued", completedAt: undefined });

		const lines = callRenderWidgetLines({ agents: [running, finished, queued] });

		// Heading (active because running+queued exist)
		expect(lines[0]).toContain("[accent:\u25cf]");
		// Finished first, then running, then queued
		// finished line (1 line)
		expect(lines[1]).toContain("[success:\u2713]");
		// running header (1 line) + activity (1 line)
		expect(lines[2]).toContain("**Agent**");
		expect(lines[3]).toContain("\u23bf");
		// queued line (last item, uses └─)
		expect(lines[4]).toContain("\u2514\u2500");
		expect(lines[4]).toContain("1 queued");
		// Total: 5 lines
		expect(lines).toHaveLength(5);
	});

	it("filters finished agents via shouldShowFinished", () => {
		const finished1 = makeAgent({ id: "f1", status: "completed", completedAt: 6000 });
		const finished2 = makeAgent({ id: "f2", status: "error", completedAt: 6000 });

		const lines = callRenderWidgetLines({
			agents: [finished1, finished2],
			// Only show f1, filter out f2
			shouldShowFinished: (id) => id === "f1",
		});

		// Heading + 1 finished line
		expect(lines).toHaveLength(2);
		expect(lines[1]).toContain("[success:\u2713]");
		expect(lines[1]).not.toContain("error");
	});

	it("overflows when too many agents, prioritizing running > queued > finished", () => {
		// MAX_WIDGET_LINES = 12: heading takes 1, max body = 11.
		// 6 running agents = 12 body lines, which exceeds maxBody (11).
		// With 1 line reserved for overflow indicator, budget = 10.
		// 5 running agents fit (10 lines), 1 hidden.
		const agents: WidgetAgent[] = [];
		for (let i = 0; i < 6; i++) {
			agents.push(makeAgent({ id: `r${i}`, status: "running", completedAt: undefined }));
		}
		// Add a finished agent — should be hidden since running takes priority
		agents.push(makeAgent({ id: "f1", status: "completed", completedAt: 6000 }));

		const lines = callRenderWidgetLines({ agents });

		// heading(1) + 5 running*2(10) + overflow(1) = 12
		expect(lines).toHaveLength(12);
		// Last line is overflow indicator
		const lastLine = lines[lines.length - 1];
		expect(lastLine).toContain("+2 more");
		expect(lastLine).toContain("1 running");
		expect(lastLine).toContain("1 finished");
	});

	it("collapses to the overflow summary when the terminal is too short", () => {
		// 6 running agents = 12 body lines. A 14-row terminal budgets 8 lines,
		// so maxBody is 7 and the overflow summary takes one of them: 3 pairs fit.
		const agents: WidgetAgent[] = [];
		for (let i = 0; i < 6; i++) {
			agents.push(makeAgent({ id: `r${i}`, status: "running", completedAt: undefined }));
		}

		const lines = callRenderWidgetLines({ agents, terminalHeight: 14 });

		// heading(1) + 3 running*2(6) + overflow(1) = 8
		expect(lines).toHaveLength(8);
		expect(lines[lines.length - 1]).toContain("+3 more");
		expect(lines[lines.length - 1]).toContain("3 running");
	});

	it("counts a dropped queued line in the overflow summary", () => {
		// A 10-row terminal budgets 4 lines, so maxBody is 3 and the running pair
		// plus the summary consume all of it: the queued line does not fit.
		const lines = callRenderWidgetLines({
			agents: [
				makeAgent({ id: "r1", status: "running", completedAt: undefined }),
				makeAgent({ id: "q1", status: "queued", completedAt: undefined }),
				makeAgent({ id: "f1", status: "completed", completedAt: 6000 }),
			],
			terminalHeight: 10,
		});

		expect(lines).toHaveLength(4);
		const summary = lines[lines.length - 1];
		expect(summary).toContain("+2 more");
		expect(summary).toContain("1 queued");
		expect(summary).toContain("1 finished");
	});

	it("counts every agent behind a dropped queued line, not the line", () => {
		const agents: WidgetAgent[] = [makeAgent({ id: "r1", status: "running", completedAt: undefined })];
		for (let i = 0; i < 3; i++) {
			agents.push(makeAgent({ id: `q${i}`, status: "queued", completedAt: undefined }));
		}
		agents.push(makeAgent({ id: "f1", status: "completed", completedAt: 6000 }));

		const lines = callRenderWidgetLines({ agents, terminalHeight: 10 });

		// The collapsed queued line stands for three agents, so hiding it hides three.
		const summary = lines[lines.length - 1];
		expect(summary).toContain("+4 more");
		expect(summary).toContain("3 queued");
		expect(summary).toContain("1 finished");
	});

	it("returns empty array when no agents to show", () => {
		const lines = callRenderWidgetLines();

		expect(lines).toEqual([]);
	});

	it("returns empty when all finished agents are filtered out", () => {
		const agent = makeAgent({ status: "completed", completedAt: 6000 });

		const lines = callRenderWidgetLines({ agents: [agent], shouldShowFinished: () => false });

		expect(lines).toEqual([]);
	});

	it("uses dim heading when only finished agents are visible", () => {
		const agent = makeAgent({ status: "completed", completedAt: 6000 });

		const lines = callRenderWidgetLines({ agents: [agent] });

		// Dim heading with open circle
		expect(lines[0]).toContain("[dim:\u25cb]");
		expect(lines[0]).toContain("[dim:Agents]");
	});
});
