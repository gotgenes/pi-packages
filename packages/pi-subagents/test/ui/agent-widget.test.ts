import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTypeRegistry } from "#src/config/agent-types";
import type { Subagent } from "#src/lifecycle/subagent";
import type { SubagentManager } from "#src/lifecycle/subagent-manager";
import type { CompactionInfo } from "#src/types";
import { AgentWidget, assembleWidgetState, type UICtx } from "#src/ui/agent-widget";
import { createTestSubagent } from "#test/helpers/make-subagent";

// Minimal agent fixture — only the three fields AgentSummary requires.
function makeAgent(overrides: { id?: string; status?: string; completedAt?: number } = {}) {
	return {
		id: "agent-1",
		status: "completed",
		completedAt: 5000,
		...overrides,
	};
}

// shouldShowFinished stub that always returns true (default) or a fixed value.
const alwaysShow = () => true;
const neverShow = () => false;

// Build a widget over a manager stub whose listAgents() returns a fixed list,
// plus a recording UICtx. setWidgetCalls captures the `content` arg of each
// setWidget call: a function means the widget is registered/visible; undefined
// means it was cleared (the finished agent has aged out).
// Fixtures default to a background invocation so they survive the widget's
// background-only filter; per-agent `invocation` overrides the default.
function makeWidget(
	agents: Array<{ id: string; status: string; completedAt?: number; invocation?: { runInBackground: boolean } }>,
) {
	const manager = {
		listAgents: () => agents.map(a => ({ invocation: { runInBackground: true }, ...a })),
	} as unknown as SubagentManager;
	const registry = new AgentTypeRegistry(() => new Map());
	const widget = new AgentWidget(manager, registry);
	const setWidgetCalls: unknown[] = [];
	const ui: UICtx = {
		setStatus: () => {},
		setWidget: (_key, content) => {
			setWidgetCalls.push(content);
		},
	};
	widget.setUICtx(ui);
	const lastContent = () => setWidgetCalls.at(-1);
	return { widget, lastContent };
}

describe("assembleWidgetState", () => {
	describe("empty list", () => {
		it("returns all-zero/false state for an empty agent list", () => {
			expect(assembleWidgetState([], alwaysShow)).toEqual({
				runningCount: 0,
				queuedCount: 0,
				hasFinished: false,
				hasActive: false,
			});
		});
	});

	describe("running agents", () => {
		it("counts a single running agent", () => {
			const state = assembleWidgetState(
				[makeAgent({ status: "running", completedAt: undefined })],
				alwaysShow,
			);
			expect(state.runningCount).toBe(1);
			expect(state.queuedCount).toBe(0);
			expect(state.hasFinished).toBe(false);
			expect(state.hasActive).toBe(true);
		});

		it("counts multiple running agents", () => {
			const agents = [
				makeAgent({ id: "a1", status: "running", completedAt: undefined }),
				makeAgent({ id: "a2", status: "running", completedAt: undefined }),
				makeAgent({ id: "a3", status: "running", completedAt: undefined }),
			];
			expect(assembleWidgetState(agents, alwaysShow).runningCount).toBe(3);
		});
	});

	describe("queued agents", () => {
		it("counts a single queued agent", () => {
			const state = assembleWidgetState(
				[makeAgent({ status: "queued", completedAt: undefined })],
				alwaysShow,
			);
			expect(state.runningCount).toBe(0);
			expect(state.queuedCount).toBe(1);
			expect(state.hasFinished).toBe(false);
			expect(state.hasActive).toBe(true);
		});

		it("counts multiple queued agents", () => {
			const agents = [
				makeAgent({ id: "a1", status: "queued", completedAt: undefined }),
				makeAgent({ id: "a2", status: "queued", completedAt: undefined }),
			];
			expect(assembleWidgetState(agents, alwaysShow).queuedCount).toBe(2);
		});
	});

	describe("finished agents", () => {
		it("sets hasFinished when a completed agent has completedAt and shouldShowFinished returns true", () => {
			const state = assembleWidgetState(
				[makeAgent({ status: "completed", completedAt: 5000 })],
				alwaysShow,
			);
			expect(state.hasFinished).toBe(true);
			expect(state.hasActive).toBe(false);
		});

		it("does not set hasFinished when shouldShowFinished returns false", () => {
			const state = assembleWidgetState(
				[makeAgent({ status: "completed", completedAt: 5000 })],
				neverShow,
			);
			expect(state.hasFinished).toBe(false);
		});

		it("does not set hasFinished when completedAt is absent", () => {
			const state = assembleWidgetState(
				[makeAgent({ status: "error", completedAt: undefined })],
				alwaysShow,
			);
			expect(state.hasFinished).toBe(false);
		});

		it("passes agentId and status to shouldShowFinished", () => {
			const calls: Array<{ id: string; status: string }> = [];
			assembleWidgetState(
				[makeAgent({ id: "agent-42", status: "error", completedAt: 9000 })],
				(id, status) => { calls.push({ id, status }); return true; },
			);
			expect(calls).toEqual([{ id: "agent-42", status: "error" }]);
		});

		it("sets hasFinished for error status agents when shouldShowFinished returns true", () => {
			const state = assembleWidgetState(
				[makeAgent({ status: "error", completedAt: 5000 })],
				alwaysShow,
			);
			expect(state.hasFinished).toBe(true);
		});
	});

	describe("mixed states", () => {
		it("counts running and queued independently", () => {
			const agents = [
				makeAgent({ id: "a1", status: "running", completedAt: undefined }),
				makeAgent({ id: "a2", status: "running", completedAt: undefined }),
				makeAgent({ id: "a3", status: "queued", completedAt: undefined }),
			];
			const state = assembleWidgetState(agents, alwaysShow);
			expect(state.runningCount).toBe(2);
			expect(state.queuedCount).toBe(1);
			expect(state.hasActive).toBe(true);
			expect(state.hasFinished).toBe(false);
		});

		it("reports both hasActive and hasFinished when present", () => {
			const agents = [
				makeAgent({ id: "a1", status: "running", completedAt: undefined }),
				makeAgent({ id: "a2", status: "completed", completedAt: 5000 }),
			];
			const state = assembleWidgetState(agents, alwaysShow);
			expect(state.hasActive).toBe(true);
			expect(state.hasFinished).toBe(true);
			expect(state.runningCount).toBe(1);
		});

		it("running agents are not counted as finished even if completedAt is set", () => {
			// Unusual but defensive: a running agent with a completedAt should
			// be counted as running, not finished.
			const state = assembleWidgetState(
				[makeAgent({ status: "running", completedAt: 5000 })],
				alwaysShow,
			);
			expect(state.runningCount).toBe(1);
			expect(state.hasFinished).toBe(false);
		});
	});

	describe("hasActive derivation", () => {
		it("is false when only finished agents exist", () => {
			const state = assembleWidgetState(
				[makeAgent({ status: "completed", completedAt: 5000 })],
				alwaysShow,
			);
			expect(state.hasActive).toBe(false);
		});

		it("is true with any running agent", () => {
			const state = assembleWidgetState(
				[makeAgent({ status: "running", completedAt: undefined })],
				neverShow,
			);
			expect(state.hasActive).toBe(true);
		});

		it("is true with any queued agent", () => {
			const state = assembleWidgetState(
				[makeAgent({ status: "queued", completedAt: undefined })],
				neverShow,
			);
			expect(state.hasActive).toBe(true);
		});
	});
});

describe("AgentWidget — projection reads activity off Subagent records", () => {
	it("surfaces turnCount, activeTools, and responseText from the record via renderWidget", () => {
		const record = createTestSubagent({
			status: "running",
			completedAt: undefined,
			startedAt: Date.now() - 100,
			turnCount: 3,
			activeTools: ["read"],
			invocation: { runInBackground: true },
		});
		const manager = { listAgents: () => [record] } as unknown as SubagentManager;
		const registry = new AgentTypeRegistry(() => new Map());
		const widget = new AgentWidget(manager, registry);

		let renderFn: ((tui: unknown, theme: unknown) => { render(): string[] }) | undefined;
		const ui: UICtx = {
			setStatus: () => {},
			setWidget: (_key, content) => {
				if (typeof content === "function") renderFn = content as typeof renderFn;
			},
		};
		widget.setUICtx(ui);
		widget.update();

		expect(renderFn).toBeDefined();
		const stubTui = { terminal: { columns: 200 }, requestRender: () => {} };
		const stubTheme = { fg: (_: string, t: string) => t, bold: (t: string) => t };
		const lines = renderFn!(stubTui, stubTheme).render();
		const allText = lines.join("\n");
		// Turn 3 from the record should appear
		expect(allText).toContain("↻3");
		// Active tool "read" → "reading…"
		expect(allText).toContain("reading");
	});
});

describe("AgentWidget.update self-seeds finished agents", () => {
	it("seeds a completed agent so it ages out after one turn", () => {
		const { widget, lastContent } = makeWidget([{ id: "a1", status: "completed", completedAt: 5000 }]);
		widget.update();
		// Registered/visible: the last setWidget content is a render callback.
		expect(typeof lastContent()).toBe("function");
		// One turn ages the seeded entry to 1; completed agents linger only 1 turn.
		widget.onTurnStart();
		expect(lastContent()).toBeUndefined();
	});

	it("lingers an error agent for two turns before aging out", () => {
		const { widget, lastContent } = makeWidget([{ id: "a1", status: "error", completedAt: 5000 }]);
		widget.update();
		expect(typeof lastContent()).toBe("function");
		// Error agents linger 2 turns: still visible after the first.
		widget.onTurnStart();
		expect(typeof lastContent()).toBe("function");
		// Cleared after the second.
		widget.onTurnStart();
		expect(lastContent()).toBeUndefined();
	});

	it("does not advance the linger age on repeated update() without a turn", () => {
		const { widget, lastContent } = makeWidget([{ id: "a1", status: "completed", completedAt: 5000 }]);
		widget.update();
		widget.update();
		widget.update();
		// update() seeds at most once and never ages — the agent is still visible.
		expect(typeof lastContent()).toBe("function");
		widget.onTurnStart();
		expect(lastContent()).toBeUndefined();
	});
});

describe("AgentWidget — self-drives from lifecycle notifications", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const COMPACTION: CompactionInfo = { reason: "threshold", tokensBefore: 1000 };

	it("starts the update timer and renders on onSubagentStarted", () => {
		const { widget, lastContent } = makeWidget([{ id: "a1", status: "running" }]);
		expect(vi.getTimerCount()).toBe(0);

		widget.onSubagentStarted(createTestSubagent({ id: "a1", status: "running" }));

		expect(vi.getTimerCount()).toBe(1);
		expect(typeof lastContent()).toBe("function");
	});

	it("starts the update timer and renders on onSubagentCreated", () => {
		const { widget, lastContent } = makeWidget([{ id: "a1", status: "queued" }]);
		expect(vi.getTimerCount()).toBe(0);

		widget.onSubagentCreated(createTestSubagent({ id: "a1", status: "queued" }));

		expect(vi.getTimerCount()).toBe(1);
		expect(typeof lastContent()).toBe("function");
	});

	it("renders the finished agent on onSubagentCompleted", () => {
		const { widget, lastContent } = makeWidget([{ id: "a1", status: "completed", completedAt: 5000 }]);

		widget.onSubagentCompleted(createTestSubagent({ id: "a1", status: "completed" }));

		expect(typeof lastContent()).toBe("function");
	});

	it("renders on onSubagentCompacted", () => {
		const { widget, lastContent } = makeWidget([{ id: "a1", status: "running" }]);

		widget.onSubagentCompacted(createTestSubagent({ id: "a1", status: "running" }), COMPACTION);

		expect(typeof lastContent()).toBe("function");
	});
});

describe("AgentWidget — background-only filtering", () => {
	function setup(records: Subagent[]) {
		const manager = { listAgents: () => records } as unknown as SubagentManager;
		const registry = new AgentTypeRegistry(() => new Map());
		const widget = new AgentWidget(manager, registry);
		const setWidgetCalls: unknown[] = [];
		let renderFn: ((tui: unknown, theme: unknown) => { render(): string[] }) | undefined;
		const ui: UICtx = {
			setStatus: () => {},
			setWidget: (_key, content) => {
				setWidgetCalls.push(content);
				if (typeof content === "function") renderFn = content as typeof renderFn;
			},
		};
		widget.setUICtx(ui);
		const lastContent = () => setWidgetCalls.at(-1);
		const renderLines = () => {
			const stubTui = { terminal: { columns: 200 }, requestRender: () => {} };
			const stubTheme = { fg: (_: string, t: string) => t, bold: (t: string) => t };
			return renderFn!(stubTui, stubTheme).render();
		};
		return { widget, lastContent, renderLines };
	}

	it("does not register the widget when only foreground agents exist", () => {
		const { widget, lastContent } = setup([
			createTestSubagent({
				id: "fg1",
				status: "running",
				completedAt: undefined,
				invocation: { runInBackground: false },
			}),
		]);
		widget.update();
		expect(lastContent()).toBeUndefined();
	});

	it("renders only background agents when foreground and background agents are mixed", () => {
		const { widget, renderLines } = setup([
			createTestSubagent({
				id: "bg1",
				status: "running",
				completedAt: undefined,
				description: "background task",
				invocation: { runInBackground: true },
			}),
			createTestSubagent({
				id: "fg1",
				status: "running",
				completedAt: undefined,
				description: "foreground task",
				invocation: { runInBackground: false },
			}),
		]);
		widget.update();
		const text = renderLines().join("\n");
		expect(text).toContain("background task");
		expect(text).not.toContain("foreground task");
	});
});
