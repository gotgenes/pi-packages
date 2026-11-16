/**
 * The widget's height against Pi's real regular-mode renderer.
 *
 * `TuiMainScreen.doRender()` full-clears the screen and the scrollback whenever
 * the first changed line sits above the previous viewport top. The widget's
 * spinner is that first changed line on every animation tick, so a widget
 * taller than the terminal can absorb turns every tick into a destructive
 * repaint (#864). This suite mounts the real widget under the real renderer and
 * asserts the renderer's own full-redraw counter never moves.
 */

import { type Terminal, TuiAltScreen, TuiMainScreen } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTypeRegistry } from "#src/config/agent-types";
import type { SubagentManager } from "#src/lifecycle/subagent-manager";
import { AgentWidget, type UICtx } from "#src/ui/agent-widget";
import { createTestSubagent } from "#test/helpers/make-subagent";

/** A `Terminal` that reports fixed dimensions and discards every write. */
function fakeTerminal(columns: number, rows: number): Terminal {
	return {
		start: () => {},
		stop: () => {},
		drainInput: () => Promise.resolve(),
		write: () => {},
		get columns() {
			return columns;
		},
		get rows() {
			return rows;
		},
		get kittyProtocolActive() {
			return false;
		},
		moveBy: () => {},
		hideCursor: () => {},
		showCursor: () => {},
		clearLine: () => {},
		clearFromCursor: () => {},
		clearScreen: () => {},
		setTitle: () => {},
		setProgress: () => {},
	};
}

/** A component rendering a fixed number of distinct, unchanging lines. */
function staticBlock(lines: number, label: string) {
	return {
		render: (_width: number) => Array.from({ length: lines }, (_, i) => `${label}-${i}`),
		invalidate: () => {},
	};
}

/**
 * Mount the real `AgentWidget` in Pi's regular-mode line order — transcript,
 * status, the widget's own container, editor, footer — then animate it.
 *
 * Returns the widget's rendered height and how many full redraws the renderer
 * performed after the initial paint.
 */
function animateUnderRealRenderer(opts: { rows: number; transcriptLines: number; agents: number; ticks: number }) {
	const records = Array.from({ length: opts.agents }, (_, i) =>
		createTestSubagent({
			id: `a${i}`,
			status: "running",
			completedAt: undefined,
			isBackground: true,
			description: `task ${i}`,
		}));
	const manager = { listAgents: () => records } as unknown as SubagentManager;
	const widget = new AgentWidget(manager, new AgentTypeRegistry(() => new Map()));

	const tui = new TuiMainScreen(fakeTerminal(100, opts.rows), false, "/tmp/pi-subagents-widget-viewport-test");
	const theme = { fg: (_: string, text: string) => text, bold: (text: string) => text };
	let widgetComponent: { render(): string[]; invalidate(): void } | undefined;
	const ui: UICtx = {
		setStatus: () => {},
		setWidget: (_key, content) => {
			widgetComponent = content?.(tui, theme);
		},
	};

	tui.addChild(staticBlock(opts.transcriptLines, "transcript"));
	// Pi's IdleStatus renders two blank lines while the parent is idle.
	tui.addChild(staticBlock(2, "idle-status"));
	widget.setUICtx(ui);
	widget.update();
	// widgetContainerAbove leads with a Spacer(1) before each extension widget.
	tui.addChild({
		render: (_width: number) => ["", ...(widgetComponent?.render() ?? [])],
		invalidate: () => {},
	});
	tui.addChild(staticBlock(3, "editor"));
	tui.addChild(staticBlock(2, "footer"));

	tui.renderNow();
	const widgetLines = widgetComponent?.render().length ?? 0;
	const redrawsBefore = tui.fullRedraws;
	for (let i = 0; i < opts.ticks; i++) {
		widget.update();
		tui.renderNow();
	}
	widget.dispose();

	return { widgetLines, fullRedraws: tui.fullRedraws - redrawsBefore };
}

describe("AgentWidget under Pi's regular-mode renderer", () => {
	// 10 rows with 4 agents and 14 rows with 6 agents both full-cleared on every
	// tick before the widget was bounded to the viewport.
	it.each([
		{ rows: 7, agents: 1 },
		{ rows: 10, agents: 4 },
		{ rows: 12, agents: 4 },
		{ rows: 14, agents: 6 },
		{ rows: 16, agents: 6 },
		{ rows: 18, agents: 6 },
		{ rows: 24, agents: 6 },
		{ rows: 40, agents: 1 },
	])("never forces a full redraw at $rows rows with $agents agents", ({ rows, agents }) => {
		const { fullRedraws } = animateUnderRealRenderer({
			rows,
			transcriptLines: 400,
			agents,
			ticks: 20,
		});

		expect(fullRedraws).toBe(0);
	});

	it("renders its full height when the terminal has room", () => {
		const { widgetLines } = animateUnderRealRenderer({
			rows: 40,
			transcriptLines: 400,
			agents: 6,
			ticks: 1,
		});

		expect(widgetLines).toBe(12);
	});

	it("renders fewer lines in a short terminal than a tall one for the same agents", () => {
		const short = animateUnderRealRenderer({ rows: 12, transcriptLines: 400, agents: 6, ticks: 1 });
		const tall = animateUnderRealRenderer({ rows: 40, transcriptLines: 400, agents: 6, ticks: 1 });

		expect(short.widgetLines).toBe(6);
		expect(tall.widgetLines).toBe(12);
	});
});

describe("AgentWidget cadence under Pi's real renderers", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	/** Milliseconds until the widget first asks this renderer for a frame. */
	function firstTickAfter(tui: TuiAltScreen | TuiMainScreen): number {
		const record = createTestSubagent({
			id: "a1",
			status: "running",
			completedAt: undefined,
			isBackground: true,
		});
		const manager = { listAgents: () => [record] } as unknown as SubagentManager;
		const widget = new AgentWidget(manager, new AgentTypeRegistry(() => new Map()));
		const theme = { fg: (_: string, text: string) => text, bold: (text: string) => text };
		const requestRender = vi.spyOn(tui, "requestRender").mockImplementation(() => {});
		widget.setUICtx({
			setStatus: () => {},
			setWidget: (_key, content) => {
				content?.(tui, theme);
			},
		});

		widget.onSubagentRunStarted(record, "initial");
		let elapsed = 0;
		while (requestRender.mock.calls.length === 0 && elapsed < 1000) {
			vi.advanceTimersByTime(1);
			elapsed++;
		}
		widget.dispose();
		return elapsed;
	}

	it("ticks every 80 ms under the fullscreen renderer", () => {
		const tui = new TuiAltScreen(fakeTerminal(100, 40), false, "/tmp/pi-subagents-widget-viewport-test");

		expect(firstTickAfter(tui)).toBe(80);
	});

	it("ticks every 250 ms under the regular renderer", () => {
		const tui = new TuiMainScreen(fakeTerminal(100, 40), false, "/tmp/pi-subagents-widget-viewport-test");

		expect(firstTickAfter(tui)).toBe(250);
	});
});
