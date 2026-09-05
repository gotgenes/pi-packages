import { describe, expect, it, vi } from "vitest";
import type { CreateSubagentSessionParams } from "#src/lifecycle/create-subagent-session";
import { Subagent, type SubagentExecution, type SubagentLifecycleObserver } from "#src/lifecycle/subagent";
import type { SubagentSession, TurnLoopResult } from "#src/lifecycle/subagent-session";
import { SubagentState, type SubagentStateInit } from "#src/lifecycle/subagent-state";
import type { WorkspacePrepareContext, WorkspaceProvider } from "#src/lifecycle/workspace";
import type { RunConfig } from "#src/runtime";
import type { CompactionInfo, SubagentType } from "#src/types";
import { makeStubExecution } from "#test/helpers/make-subagent";
import { makeWorkspace, makeWorkspaceProvider } from "#test/helpers/make-workspace";
import { createMockSession, createSubagentSessionStub, emitResumeUsageAndCompaction, toSubagentSession } from "#test/helpers/mock-session";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";

type SessionFactory = (params: CreateSubagentSessionParams) => Promise<SubagentSession>;

/** Build a factory plus the SubagentSession stub it resolves to. */
function createFactory(): { factory: SessionFactory; stub: ReturnType<typeof createSubagentSessionStub> } {
	const stub = createSubagentSessionStub();
	const factory = vi.fn(async (_params: CreateSubagentSessionParams) => toSubagentSession(stub));
	return { factory, stub };
}

/** A factory resolving to a default (done) SubagentSession stub. */
function defaultFactory(): SessionFactory {
	return createFactory().factory;
}

interface MakeSubagentOptions extends SubagentStateInit {
	id?: string;
	type?: SubagentType;
	description?: string;
	execution?: SubagentExecution;
	isBackground?: boolean;
	/**
	 * A caller-owned SubagentState, for tests that mutate it after construction to
	 * observe the record delegating live. Wins over the flat state overrides.
	 */
	state?: SubagentState;
}

/** Construct a Subagent with default identity and a stub execution, overridable per test. */
function makeSubagent(overrides: MakeSubagentOptions = {}): Subagent {
	const { id, type, description, isBackground, execution, state, ...stateOverrides } = overrides;
	return new Subagent({
		id: id ?? "1",
		type: type ?? "general-purpose",
		description: description ?? "test",
		isBackground: isBackground ?? true,
		execution: execution ?? makeStubExecution(),
		state: state ?? (Object.keys(stateOverrides).length > 0 ? new SubagentState(stateOverrides) : undefined),
	});
}

/** A Subagent wired to a ready session whose messages hold a single user "hi". */
function makeReadySubagent(): { agent: Subagent } {
	const agent = makeSubagent();
	const session = createMockSession();
	session.messages.push({ role: "user", content: "hi" });
	const stub = createSubagentSessionStub(session);
	agent.subagentSession = toSubagentSession(stub);
	return { agent };
}

describe("Subagent — constructor", () => {
	it("sets required fields from init", () => {
		const record = makeSubagent({ id: "abc-123", type: "Explore", description: "Find stale TODOs" });
		expect(record.id).toBe("abc-123");
		expect(record.type).toBe("Explore");
		expect(record.description).toBe("Find stale TODOs");
	});

	it("starts with a fresh abort controller and zeroed stats", () => {
		const record = makeSubagent();
		expect(record.abortController).toBeInstanceOf(AbortController);
		// Stats always start at zero — set via mutation methods after construction
		expect(record.toolUses).toBe(0);
		expect(record.compactionCount).toBe(0);
		expect(record.lifetimeUsage).toEqual({ input: 0, output: 0, cacheWrite: 0 });
	});

	it("defaults to a fresh queued state when none is supplied", () => {
		const record = makeSubagent();
		expect(record.status).toBe("queued");
		expect(record.result).toBeUndefined();
		expect(record.error).toBeUndefined();
		expect(record.completedAt).toBeUndefined();
		expect(record.promise).toBeUndefined();
		expect(record.subagentSession).toBeUndefined();
	});

	it("always creates its own AbortController", () => {
		const record = makeSubagent();
		expect(record.abortController).toBeInstanceOf(AbortController);
		expect(record.abortController.signal.aborted).toBe(false);
	});

	it("toolCallId reflects execution.parentSession.toolCallId", () => {
		const record = makeSubagent({ execution: makeStubExecution({ parentSession: { toolCallId: "tc-42" } }) });
		expect(record.toolCallId).toBe("tc-42");
	});

	it("toolCallId is undefined when parentSession.toolCallId is absent", () => {
		const record = makeSubagent({
			execution: makeStubExecution({ parentSession: { parentSessionFile: "/sessions/p.jsonl" } }),
		});
		expect(record.toolCallId).toBeUndefined();
	});

	it("toolCallId is undefined when parentSession is absent", () => {
		const record = makeSubagent();
		expect(record.toolCallId).toBeUndefined();
	});

});

describe("convenience getters", () => {
	describe("live-activity getters", () => {
		it("turnCount defaults to 1 (delegates to SubagentState)", () => {
			const record = makeSubagent();
			expect(record.turnCount).toBe(1);
		});

		it("activeTools defaults to an empty map (delegates to SubagentState)", () => {
			const record = makeSubagent();
			expect(record.activeTools.size).toBe(0);
		});

		it("responseText defaults to empty string (delegates to SubagentState)", () => {
			const record = makeSubagent();
			expect(record.responseText).toBe("");
		});

		it("maxTurns returns execution.maxTurns", () => {
			const record = makeSubagent({ execution: makeStubExecution({ maxTurns: 10 }) });
			expect(record.maxTurns).toBe(10);
		});

		it("maxTurns returns undefined when execution.maxTurns is not set", () => {
			const record = makeSubagent();
			expect(record.maxTurns).toBeUndefined();
		});

		it("turnCount reflects state mutations via incrementTurnCount", () => {
			const state = new SubagentState();
			const record = makeSubagent({ state });
			state.incrementTurnCount();
			expect(record.turnCount).toBe(2);
		});

		it("activeTools reflects state mutations via addActiveTool", () => {
			const state = new SubagentState();
			const record = makeSubagent({ state });
			state.addActiveTool("Read");
			expect(record.activeTools.size).toBe(1);
			expect([...record.activeTools.values()]).toContain("Read");
		});

		it("responseText reflects state mutations via appendResponseText", () => {
			const state = new SubagentState();
			const record = makeSubagent({ state });
			state.appendResponseText("Hello");
			expect(record.responseText).toBe("Hello");
		});
	});

	describe("consumption getters", () => {
		it("consumed defaults to false and consumedAt undefined (delegates to SubagentState)", () => {
			const record = makeSubagent();
			expect(record.consumed).toBe(false);
			expect(record.consumedAt).toBeUndefined();
		});

		it("markConsumed delegates to SubagentState", () => {
			const state = new SubagentState({ status: "completed" });
			const record = makeSubagent({ state });
			record.markConsumed(5000);
			expect(record.consumed).toBe(true);
			expect(record.consumedAt).toBe(5000);
			expect(state.consumedAt).toBe(5000);
		});
	});

	describe("outputFile", () => {
		it("returns undefined when subagentSession is not set", () => {
			const record = makeSubagent();
			expect(record.outputFile).toBeUndefined();
		});

		it("returns outputFile from subagentSession when set", () => {
			const record = makeSubagent();
			record.subagentSession = toSubagentSession(createSubagentSessionStub(createMockSession(), "/path/to/session.jsonl"));
			expect(record.outputFile).toBe("/path/to/session.jsonl");
		});

		it("returns undefined when subagentSession is set but outputFile is undefined", () => {
			const record = makeSubagent();
			record.subagentSession = toSubagentSession(createSubagentSessionStub(createMockSession()));
			expect(record.outputFile).toBeUndefined();
		});
	});
});

describe("Subagent — session-encapsulation methods", () => {
	describe("isSessionReady", () => {
		it("returns false when no subagentSession", () => {
			const agent = makeSubagent();
			expect(agent.isSessionReady()).toBe(false);
		});

		it("returns true when subagentSession is set", () => {
			const agent = makeSubagent();
			agent.subagentSession = toSubagentSession(createSubagentSessionStub());
			expect(agent.isSessionReady()).toBe(true);
		});
	});

	describe("steer", () => {
		it("rejects with the observed status when the agent is not running", async () => {
			const agent = makeSubagent();
			agent.markCompleted("done");
			const stub = createSubagentSessionStub();
			agent.subagentSession = toSubagentSession(stub);
			const outcome = await agent.steer("hello");
			expect(outcome).toEqual({ kind: "rejected", status: "completed" });
			expect(stub.steer).not.toHaveBeenCalled();
			expect(agent.pendingSteerCount).toBe(0);
		});

		it("buffers the message and returns a buffered outcome when the session is not ready", async () => {
			const agent = makeSubagent();
			agent.markRunning(Date.now());
			const outcome = await agent.steer("hello");
			expect(outcome).toEqual({ kind: "buffered" });
			expect(agent.pendingSteerCount).toBe(1);
		});

		it("delivers to the session and returns a delivered outcome when the session is ready", async () => {
			const agent = makeSubagent();
			agent.markRunning(Date.now());
			const stub = createSubagentSessionStub();
			agent.subagentSession = toSubagentSession(stub);
			const outcome = await agent.steer("go faster");
			expect(outcome).toEqual({ kind: "delivered" });
			expect(stub.steer).toHaveBeenCalledWith("go faster");
			expect(agent.pendingSteerCount).toBe(0);
		});
	});

	describe("getConversation", () => {
		it("returns undefined when no session", () => {
			const agent = makeSubagent();
			expect(agent.getConversation()).toBeUndefined();
		});

		it("delegates to SubagentSession.getConversation when session is ready", () => {
			const agent = makeSubagent();
			const stub = createSubagentSessionStub();
			stub.getConversation.mockReturnValue("[User]: hi");
			agent.subagentSession = toSubagentSession(stub);
			expect(agent.getConversation()).toBe("[User]: hi");
		});
	});

	describe("getContextPercent", () => {
		it("returns null when no session", () => {
			const agent = makeSubagent();
			expect(agent.getContextPercent()).toBeNull();
		});

		it("delegates to SubagentSession.getContextPercent when session is ready", () => {
			const agent = makeSubagent();
			const stub = createSubagentSessionStub();
			stub.getContextPercent.mockReturnValue(55);
			agent.subagentSession = toSubagentSession(stub);
			expect(agent.getContextPercent()).toBe(55);
		});
	});

	describe("subscribeToUpdates", () => {
		it("returns undefined when no session", () => {
			const agent = makeSubagent();
			expect(agent.subscribeToUpdates(vi.fn())).toBeUndefined();
		});

		it("delegates to SubagentSession.subscribe when session is ready", () => {
			const agent = makeSubagent();
			const stub = createSubagentSessionStub();
			agent.subagentSession = toSubagentSession(stub);
			const fn = vi.fn();
			const unsub = agent.subscribeToUpdates(fn);
			expect(stub.subscribe).toHaveBeenCalledWith(fn);
			expect(typeof unsub).toBe("function");
		});
	});

	describe("messages", () => {
		it("returns empty array when no session", () => {
			const agent = makeSubagent();
			expect(agent.messages).toEqual([]);
		});

		it("delegates to SubagentSession.messages when session is ready", () => {
			const { agent } = makeReadySubagent();
			expect(agent.messages).toEqual([{ role: "user", content: "hi" }]);
		});
	});

	describe("agentMessages", () => {
		it("returns empty array when no session", () => {
			const agent = makeSubagent();
			expect(agent.agentMessages).toEqual([]);
		});

		it("delegates to SubagentSession.agentMessages when session is ready", () => {
			const { agent } = makeReadySubagent();
			expect(agent.agentMessages).toEqual([{ role: "user", content: "hi" }]);
		});
	});

	describe("getToolDefinition", () => {
		it("returns undefined when no session", () => {
			const agent = makeSubagent();
			expect(agent.getToolDefinition("read")).toBeUndefined();
		});

		it("delegates to SubagentSession.getToolDefinition when session is ready", () => {
			const agent = makeSubagent();
			const def = { name: "read" };
			const session = createMockSession({ getToolDefinition: vi.fn(() => def) });
			const stub = createSubagentSessionStub(session);
			agent.subagentSession = toSubagentSession(stub);
			expect(agent.getToolDefinition("read")).toBe(def);
		});
	});
});

describe("Subagent — steer buffer", () => {
	it("starts with an empty steer buffer", () => {
		const record = makeSubagent();
		expect(record.pendingSteerCount).toBe(0);
	});
});

describe("Subagent — abort", () => {
	it("returns false and does nothing when not running", () => {
		const record = makeSubagent({ status: "queued" });
		expect(record.abort()).toBe(false);
		expect(record.status).toBe("queued");
	});

	it("fires the AbortController, marks stopped, and returns true when running", () => {
		const record = makeSubagent({ status: "running" });
		expect(record.abort()).toBe(true);
		expect(record.abortController.signal.aborted).toBe(true);
		expect(record.status).toBe("stopped");
	});

	it("marks stopped and returns true even without an AbortController", () => {
		const record = makeSubagent({ status: "running" });
		expect(record.abort()).toBe(true);
		expect(record.status).toBe("stopped");
	});

	it("returns false when already stopped", () => {
		const record = makeSubagent({ status: "stopped" });
		expect(record.abort()).toBe(false);
	});

	it("returns false when completed", () => {
		const record = makeSubagent({ status: "completed" });
		expect(record.abort()).toBe(false);
	});
});



/** Create a Subagent for completeRun / failRun tests. */
function createCompletionAgent(overrides?: { observer?: SubagentLifecycleObserver }) {
	return {
		record: makeSubagent({
			status: "running",
			execution: makeStubExecution({ observer: overrides?.observer }),
		}),
	};
}

function createTurnLoopResult(overrides?: Partial<TurnLoopResult>): TurnLoopResult {
	return {
		responseText: "done",
		aborted: false,
		steered: false,
		...overrides,
	};
}

describe("Subagent — completeRun", () => {
	it("transitions to completed for a normal result", () => {
		const { record } = createCompletionAgent();
		record.completeRun(createTurnLoopResult());
		expect(record.status).toBe("completed");
		expect(record.result).toBe("done");
	});

	it("transitions to aborted when result.aborted is true", () => {
		const { record } = createCompletionAgent();
		record.completeRun(createTurnLoopResult({ aborted: true }));
		expect(record.status).toBe("aborted");
	});

	it("transitions to steered when result.steered is true", () => {
		const { record } = createCompletionAgent();
		record.completeRun(createTurnLoopResult({ steered: true }));
		expect(record.status).toBe("steered");
	});

	it("fires observer.onRunFinished on completion", () => {
		const onRunFinished = vi.fn();
		const { record } = createCompletionAgent({ observer: { onRunFinished } });
		record.completeRun(createTurnLoopResult());
		expect(onRunFinished).toHaveBeenCalledOnce();
		expect(onRunFinished).toHaveBeenCalledWith(record);
	});

});

describe("Subagent — failRun", () => {
	it("transitions to error state", () => {
		const { record } = createCompletionAgent();
		record.failRun(new Error("boom"));
		expect(record.status).toBe("error");
		expect(record.error).toBe("boom");
	});

	it("fires observer.onRunFinished on failure", () => {
		const onRunFinished = vi.fn();
		const { record } = createCompletionAgent({ observer: { onRunFinished } });
		record.failRun(new Error("boom"));
		expect(onRunFinished).toHaveBeenCalledOnce();
		expect(onRunFinished).toHaveBeenCalledWith(record);
	});

});

describe("Subagent — stopQueued", () => {
	function createQueuedAgent(observer?: SubagentLifecycleObserver) {
		return makeSubagent({
			status: "queued",
			execution: makeStubExecution({ observer }),
		});
	}

	it("transitions to stopped and records that the agent never started", () => {
		const record = createQueuedAgent();
		record.stopQueued();
		expect(record.status).toBe("stopped");
		expect(record.stoppedWhileQueued).toBe(true);
	});

	it("fires observer.onRunFinished once, like every other terminal transition", () => {
		const onRunFinished = vi.fn();
		const record = createQueuedAgent({ onRunFinished });
		record.stopQueued();
		expect(onRunFinished).toHaveBeenCalledOnce();
		expect(onRunFinished).toHaveBeenCalledWith(record);
	});

	it("leaves stoppedWhileQueued false for a running agent aborted mid-run", () => {
		const record = makeSubagent({ status: "running" });
		expect(record.abort()).toBe(true);
		expect(record.status).toBe("stopped");
		expect(record.stoppedWhileQueued).toBe(false);
	});
});

describe("Subagent — disposeSession", () => {
	it("disposes the wrapped SubagentSession", async () => {
		const record = makeSubagent();
		const stub = createSubagentSessionStub();
		record.subagentSession = toSubagentSession(stub);
		await record.disposeSession();
		expect(stub.dispose).toHaveBeenCalledOnce();
	});

	it("resolves only after the child's teardown settles", async () => {
		const record = makeSubagent();
		const stub = createSubagentSessionStub();
		const teardown = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
		stub.dispose = vi.fn((): Promise<void> => teardown.promise);
		record.subagentSession = toSubagentSession(stub);

		let settled = false;
		const pending = record.disposeSession().then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);

		teardown.resolve();
		await pending;
		expect(settled).toBe(true);
	});

	it("swallows a failing teardown so the caller's cleanup continues", async () => {
		const record = makeSubagent();
		const stub = createSubagentSessionStub();
		stub.dispose = vi.fn((): Promise<void> => Promise.reject(new Error("teardown failed")));
		record.subagentSession = toSubagentSession(stub);
		await expect(record.disposeSession()).resolves.toBeUndefined();
	});

	it("is a no-op when no session was created", async () => {
		const record = makeSubagent();
		await expect(record.disposeSession()).resolves.toBeUndefined();
	});
});

describe("Subagent — releaseSession", () => {
	it("disposes the wrapped session and clears it (isSessionReady false)", async () => {
		const record = makeSubagent();
		const stub = createSubagentSessionStub(createMockSession(), "/path/to/session.jsonl");
		record.subagentSession = toSubagentSession(stub);
		await record.releaseSession();
		expect(stub.dispose).toHaveBeenCalledOnce();
		expect(record.isSessionReady()).toBe(false);
	});

	it("captures outputFile so the getter still resolves it after release", async () => {
		const record = makeSubagent();
		record.subagentSession = toSubagentSession(createSubagentSessionStub(createMockSession(), "/path/to/session.jsonl"));
		await record.releaseSession();
		expect(record.outputFile).toBe("/path/to/session.jsonl");
	});

	it("sets sessionReleased (default false)", async () => {
		const record = makeSubagent();
		expect(record.sessionReleased).toBe(false);
		record.subagentSession = toSubagentSession(createSubagentSessionStub(createMockSession(), "/path/to/session.jsonl"));
		await record.releaseSession();
		expect(record.sessionReleased).toBe(true);
	});

	it("clears the session before awaiting teardown, so a racing sweep releases once", async () => {
		const record = makeSubagent();
		const stub = createSubagentSessionStub(createMockSession(), "/path/to/session.jsonl");
		const teardown = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
		stub.dispose = vi.fn((): Promise<void> => teardown.promise);
		record.subagentSession = toSubagentSession(stub);

		const first = record.releaseSession();
		expect(record.isSessionReady()).toBe(false);
		const second = record.releaseSession();

		teardown.resolve();
		await Promise.all([first, second]);
		expect(stub.dispose).toHaveBeenCalledOnce();
	});

	it("is a no-op on a second release — does not re-dispose, keeps the captured outputFile", async () => {
		const record = makeSubagent();
		const stub = createSubagentSessionStub(createMockSession(), "/path/to/session.jsonl");
		record.subagentSession = toSubagentSession(stub);
		await record.releaseSession();
		await record.releaseSession();
		expect(stub.dispose).toHaveBeenCalledOnce();
		expect(record.outputFile).toBe("/path/to/session.jsonl");
	});

	it("disposeSession after release is a no-op (session already cleared)", async () => {
		const record = makeSubagent();
		const stub = createSubagentSessionStub(createMockSession(), "/path/to/session.jsonl");
		record.subagentSession = toSubagentSession(stub);
		await record.releaseSession();
		await record.disposeSession();
		expect(stub.dispose).toHaveBeenCalledOnce();
	});

	it("swallows a failing teardown but still marks the session released", async () => {
		const record = makeSubagent();
		const stub = createSubagentSessionStub(createMockSession(), "/path/to/session.jsonl");
		stub.dispose = vi.fn((): Promise<void> => Promise.reject(new Error("teardown failed")));
		record.subagentSession = toSubagentSession(stub);
		await expect(record.releaseSession()).resolves.toBeUndefined();
		expect(record.sessionReleased).toBe(true);
	});

	it("is a no-op when no session was created (sessionReleased stays false)", async () => {
		const record = makeSubagent();
		await expect(record.releaseSession()).resolves.toBeUndefined();
		expect(record.sessionReleased).toBe(false);
	});
});

// ── Agent.run() ──────────────────────────────────────────────────────────────

/** Create a complete Agent ready for run(). */
function createRunnableAgent(overrides?: {
	createSubagentSession?: SessionFactory;
	observer?: SubagentLifecycleObserver;
	getRunConfig?: () => RunConfig;
	parentSession?: { toolCallId?: string; parentSessionFile?: string; parentSessionId?: string };
	signal?: AbortSignal;
	baseCwd?: string;
	workspaceProvider?: WorkspaceProvider;
	isBackground?: boolean;
}) {
	const createSubagentSession = overrides?.createSubagentSession ?? defaultFactory();
	const observer = overrides?.observer ?? {};
	const provider = overrides?.workspaceProvider;
	return makeSubagent({
		id: "run-1",
		description: "run test",
		isBackground: overrides?.isBackground,
		execution: {
			createSubagentSession,
			observer,
			snapshot: STUB_SNAPSHOT,
			prompt: "do something",
			getRunConfig: overrides?.getRunConfig,
			parentSession: overrides?.parentSession,
			signal: overrides?.signal,
			baseCwd: overrides?.baseCwd ?? "/base",
			getWorkspaceProvider: provider ? () => provider : undefined,
		},
	});
}

describe("Subagent.run() — happy path", () => {
	it("transitions through running → completed", async () => {
		const agent = createRunnableAgent();
		await agent.run();
		expect(agent.status).toBe("completed");
		expect(agent.result).toBe("done");
	});

	it("fires observer callbacks in order: onStarted → onSessionCreated → onRunFinished", async () => {
		const callOrder: string[] = [];
		const observer: SubagentLifecycleObserver = {
			onStarted: () => callOrder.push("started"),
			onSessionCreated: () => callOrder.push("sessionCreated"),
			onRunFinished: () => callOrder.push("runFinished"),
		};
		const agent = createRunnableAgent({ observer });
		await agent.run();
		expect(callOrder).toEqual(["started", "sessionCreated", "runFinished"]);
	});

	it("sets the subagentSession with a session", async () => {
		const agent = createRunnableAgent();
		await agent.run();
		expect(agent.subagentSession).toBeDefined();
		expect(agent.subagentSession!.session).toBeDefined();
	});

	it("flushes pending steers when session is created", async () => {
		const agent = createRunnableAgent();
		// A steer arriving while the agent is running but the session is not yet
		// ready buffers; run() flushes it once the session is created.
		agent.markRunning(Date.now());
		void agent.steer("hurry up");
		expect(agent.pendingSteerCount).toBe(1);
		await agent.run();
		expect(agent.pendingSteerCount).toBe(0);
	});
});

describe("Subagent.run() — workspace provider", () => {
	it("prepares the workspace and threads its cwd into the factory params", async () => {
		const { factory } = createFactory();
		const provider = makeWorkspaceProvider(makeWorkspace("/ws/dir"));
		const agent = createRunnableAgent({ createSubagentSession: factory, workspaceProvider: provider });
		await agent.run();
		const params = (factory as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(params.cwd).toBe("/ws/dir");
	});

	it("calls prepare with exactly the run-start context", async () => {
		const prepare = vi.fn((_ctx: WorkspacePrepareContext) => Promise.resolve(makeWorkspace("/ws/dir")));
		const agent = createRunnableAgent({ workspaceProvider: { prepare }, baseCwd: "/parent" });
		await agent.run();
		// toStrictEqual, not toHaveBeenCalledWith: the latter compares with toEqual
		// semantics, which ignore an explicitly-undefined key — so it cannot see a
		// vacant field reappearing on the seam context.
		expect(prepare.mock.calls[0][0]).toStrictEqual({
			agentId: "run-1",
			agentType: "general-purpose",
			baseCwd: "/parent",
		});
	});

	it("appends the dispose resultAddendum to the result", async () => {
		const workspace = makeWorkspace("/ws/dir", { resultAddendum: "\n\n---\nsaved to branch foo" });
		const agent = createRunnableAgent({ workspaceProvider: makeWorkspaceProvider(workspace) });
		await agent.run();
		expect(agent.result).toBe("done\n\n---\nsaved to branch foo");
		expect(workspace.dispose).toHaveBeenCalledWith({ status: "completed", description: "run test" });
	});

	it("falls back to baseCwd (cwd undefined) when prepare returns undefined", async () => {
		const { factory } = createFactory();
		const provider = makeWorkspaceProvider(undefined);
		const agent = createRunnableAgent({ createSubagentSession: factory, workspaceProvider: provider });
		await agent.run();
		const params = (factory as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(params.cwd).toBeUndefined();
		expect(agent.status).toBe("completed");
	});

	it("marks error and fires onRunFinished when prepare rejects", async () => {
		const onRunFinished = vi.fn();
		const provider: WorkspaceProvider = { prepare: vi.fn(() => Promise.reject(new Error("prepare failed"))) };
		const agent = createRunnableAgent({ workspaceProvider: provider, observer: { onRunFinished } });
		await agent.run();
		expect(agent.status).toBe("error");
		expect(agent.error).toBe("prepare failed");
		expect(onRunFinished).toHaveBeenCalledOnce();
	});

	it("disposes with status error when the turn loop throws", async () => {
		const { factory, stub } = createFactory();
		stub.runTurnLoop.mockRejectedValue(new Error("turn loop exploded"));
		const workspace = makeWorkspace("/ws/dir", { resultAddendum: ADDENDUM });
		const agent = createRunnableAgent({ createSubagentSession: factory, workspaceProvider: makeWorkspaceProvider(workspace) });
		await agent.run();
		expect(agent.status).toBe("error");
		expect(workspace.dispose).toHaveBeenCalledWith({ status: "error", description: "run test" });
		// A failed run has no result text; the addendum is kept as a notice instead.
		expect(agent.result).toBeUndefined();
		expect(agent.workspaceNotice).toBe(ADDENDUM);
	});
});

describe("Subagent — workspaceDisposed", () => {
	it("is false before the agent has run", () => {
		expect(createRunnableAgent({ workspaceProvider: makeWorkspaceProvider(makeWorkspace("/ws/dir")) }).workspaceDisposed).toBe(false);
	});

	it("is true after a run that disposed a prepared workspace", async () => {
		const agent = createRunnableAgent({ workspaceProvider: makeWorkspaceProvider(makeWorkspace("/ws/dir")) });
		await agent.run();
		expect(agent.workspaceDisposed).toBe(true);
	});

	it("stays false for an agent that never had a workspace", async () => {
		const agent = createRunnableAgent();
		await agent.run();
		expect(agent.workspaceDisposed).toBe(false);
	});

	it("stays false when the provider declined to supply a workspace", async () => {
		const agent = createRunnableAgent({ workspaceProvider: makeWorkspaceProvider(undefined) });
		await agent.run();
		expect(agent.workspaceDisposed).toBe(false);
	});
});

const ADDENDUM = "\n\n---\nsaved to branch foo";

/**
 * Run an agent under a workspace provider to a terminal turn-loop result.
 *
 * A `question` is asked the way a real child asks one: by calling the recorder
 * the assembly factory installed as `ask_parent`, from inside the turn loop.
 */
async function runWithWorkspace(
	result: Partial<TurnLoopResult> & { responseText: string; question?: string },
) {
	const stub = createSubagentSessionStub();
	let askParent: ((question: string) => void) | undefined;
	const factory = async (params: CreateSubagentSessionParams) => {
		askParent = params.askParent;
		return toSubagentSession(stub);
	};
	stub.runTurnLoop.mockImplementation(() => {
		if (result.question !== undefined) askParent?.(result.question);
		return Promise.resolve({ aborted: false, steered: false, ...result });
	});
	const workspace = makeWorkspace("/ws/dir", { resultAddendum: ADDENDUM });
	const agent = createRunnableAgent({
		createSubagentSession: factory,
		workspaceProvider: makeWorkspaceProvider(workspace),
	});
	await agent.run();
	return { agent, workspace, stub, ask: (question: string) => askParent?.(question) };
}

/** Run an agent to a question-ending completion, so its workspace is still held. */
function heldWorkspaceAgent() {
	return runWithWorkspace({ responseText: "Mapped the configs.", question: "Which one?" });
}

describe("Subagent — workspace hold for a declared question", () => {
	it("holds the workspace when a completed child declared a question", async () => {
		const { agent, workspace } = await heldWorkspaceAgent();
		expect(workspace.dispose).not.toHaveBeenCalled();
		expect(agent.workspaceDisposed).toBe(false);
		expect(agent.pendingQuestion).toBe("Which one?");
		// Nothing was disposed, so there is no addendum to fold in yet.
		expect(agent.result).toBe("Mapped the configs.");
	});

	it("disposes an aborted run that declared a question", async () => {
		const { agent, workspace } = await runWithWorkspace({
			responseText: "",
			question: "Still stuck?",
			aborted: true,
		});
		expect(workspace.dispose).toHaveBeenCalledWith({ status: "aborted", description: "run test" });
		expect(agent.pendingQuestion).toBe("Still stuck?");
		expect(agent.result).toBe(ADDENDUM);
	});

	it("disposes a steered run that declared a question", async () => {
		const { agent, workspace } = await runWithWorkspace({
			responseText: "Partway.",
			question: "Which one?",
			steered: true,
		});
		expect(workspace.dispose).toHaveBeenCalledWith({ status: "steered", description: "run test" });
		expect(agent.result).toBe(`Partway.${ADDENDUM}`);
	});
});

describe("Subagent — disposing a held workspace", () => {
	it("disposes when the resumed child answers without asking again", async () => {
		const { agent, workspace, stub } = await heldWorkspaceAgent();
		stub.resumeTurnLoop.mockResolvedValue("Used the project config. Done.");

		await agent.resume("The project one.");

		expect(workspace.dispose).toHaveBeenCalledWith({ status: "completed", description: "run test" });
		expect(agent.result).toBe(`Used the project config. Done.${ADDENDUM}`);
	});

	it("keeps holding when the resumed child declares another question", async () => {
		const { agent, workspace, stub, ask } = await heldWorkspaceAgent();
		stub.resumeTurnLoop.mockImplementation(() => {
			ask("And the fallback?");
			return Promise.resolve("Thanks.");
		});

		await agent.resume("The project one.");

		expect(workspace.dispose).not.toHaveBeenCalled();
		expect(agent.pendingQuestion).toBe("And the fallback?");
	});

	it("disposes best-effort when the resume throws", async () => {
		const { agent, workspace, stub } = await heldWorkspaceAgent();
		stub.resumeTurnLoop.mockRejectedValue(new Error("resume exploded"));

		await expect(agent.resume("The project one.")).resolves.toBeUndefined();

		expect(agent.status).toBe("error");
		expect(workspace.dispose).toHaveBeenCalledWith({ status: "error", description: "run test" });
	});

	it("disposes when the retention sweep releases the session", async () => {
		const { agent, workspace } = await heldWorkspaceAgent();
		await agent.releaseSession();
		expect(workspace.dispose).toHaveBeenCalledWith({ status: "completed", description: "run test" });
	});

	it("disposes when the record's session is torn down", async () => {
		const { agent, workspace } = await heldWorkspaceAgent();
		await agent.disposeSession();
		expect(workspace.dispose).toHaveBeenCalledWith({ status: "completed", description: "run test" });
	});

	it("leaves a running agent's workspace alone when its session is torn down", async () => {
		const { factory, stub } = createFactory();
		const turnLoop = Promise.withResolvers<TurnLoopResult>();
		stub.runTurnLoop.mockReturnValue(turnLoop.promise);
		const workspace = makeWorkspace("/ws/dir", { resultAddendum: ADDENDUM });
		const agent = createRunnableAgent({
			createSubagentSession: factory,
			workspaceProvider: makeWorkspaceProvider(workspace),
		});
		agent.start();
		await vi.waitFor(() => { expect(agent.isSessionReady()).toBe(true); });

		await agent.disposeSession();
		expect(workspace.dispose).not.toHaveBeenCalled();

		turnLoop.resolve({ responseText: "done", aborted: false, steered: false });
		await agent.promise;
	});

	it("disposes a held workspace only once across release and teardown", async () => {
		const { agent, workspace } = await heldWorkspaceAgent();
		await agent.releaseSession();
		await agent.disposeSession();
		expect(workspace.dispose).toHaveBeenCalledOnce();
	});
});

describe("Subagent — workspaceNotice", () => {
	/** A run whose turn loop rejects, under a workspace that reports an addendum. */
	async function runFailingWithWorkspace(disposeResult?: { resultAddendum: string }) {
		const { factory, stub } = createFactory();
		stub.runTurnLoop.mockRejectedValue(new Error("turn loop exploded"));
		const workspace = makeWorkspace("/ws/dir", disposeResult);
		const agent = createRunnableAgent({
			createSubagentSession: factory,
			workspaceProvider: makeWorkspaceProvider(workspace),
		});
		await agent.run();
		return { agent, workspace };
	}

	it("is undefined before the agent has run", () => {
		const agent = createRunnableAgent({ workspaceProvider: makeWorkspaceProvider(makeWorkspace("/ws/dir")) });
		expect(agent.workspaceNotice).toBeUndefined();
	});

	it("stays undefined after a run that folded its addendum into the result", async () => {
		const { agent } = await runWithWorkspace({ responseText: "done" });
		expect(agent.result).toBe(`done${ADDENDUM}`);
		expect(agent.workspaceNotice).toBeUndefined();
	});

	it("holds the addendum a failed run's disposal reported", async () => {
		const { agent } = await runFailingWithWorkspace({ resultAddendum: ADDENDUM });
		expect(agent.workspaceNotice).toBe(ADDENDUM);
	});

	it("holds the addendum a failed resume's disposal reported", async () => {
		const { agent, stub } = await heldWorkspaceAgent();
		stub.resumeTurnLoop.mockRejectedValue(new Error("resume exploded"));
		await agent.resume("the answer");
		expect(agent.status).toBe("error");
		expect(agent.workspaceNotice).toBe(ADDENDUM);
	});

	it("holds the addendum the retention sweep's release reported", async () => {
		const { agent } = await heldWorkspaceAgent();
		await agent.releaseSession();
		expect(agent.workspaceNotice).toBe(ADDENDUM);
	});

	it("holds the addendum a session teardown reported", async () => {
		const { agent } = await heldWorkspaceAgent();
		await agent.disposeSession();
		expect(agent.workspaceNotice).toBe(ADDENDUM);
	});

	it("stays undefined when the quiet disposal reported nothing", async () => {
		const { agent } = await runFailingWithWorkspace();
		expect(agent.workspaceDisposed).toBe(true);
		expect(agent.workspaceNotice).toBeUndefined();
	});
});

describe("Subagent — announcing a notice produced after the result was delivered", () => {
	/** A held-workspace agent whose observer records every workspace notice. */
	async function heldAgentWithObserver() {
		const onWorkspaceNotice = vi.fn<(agent: Subagent, notice: string) => void>();
		const stub = createSubagentSessionStub();
		let askParent: ((question: string) => void) | undefined;
		const factory = async (params: CreateSubagentSessionParams) => {
			askParent = params.askParent;
			return toSubagentSession(stub);
		};
		stub.runTurnLoop.mockImplementation(() => {
			askParent?.("Which one?");
			return Promise.resolve({ responseText: "Mapped the configs.", aborted: false, steered: false });
		});
		const workspace = makeWorkspace("/ws/dir", { resultAddendum: ADDENDUM });
		const agent = createRunnableAgent({
			createSubagentSession: factory,
			workspaceProvider: makeWorkspaceProvider(workspace),
			observer: { onWorkspaceNotice },
		});
		await agent.run();
		return { agent, workspace, stub, onWorkspaceNotice };
	}

	it("announces when the retention sweep releases the session", async () => {
		const { agent, onWorkspaceNotice } = await heldAgentWithObserver();
		await agent.releaseSession();
		expect(onWorkspaceNotice).toHaveBeenCalledExactlyOnceWith(agent, ADDENDUM);
	});

	it("announces when the record's session is torn down", async () => {
		const { agent, onWorkspaceNotice } = await heldAgentWithObserver();
		await agent.disposeSession();
		expect(onWorkspaceNotice).toHaveBeenCalledExactlyOnceWith(agent, ADDENDUM);
	});

	it("announces once across a release and the teardown that follows it", async () => {
		const { agent, onWorkspaceNotice } = await heldAgentWithObserver();
		await agent.releaseSession();
		await agent.disposeSession();
		expect(onWorkspaceNotice).toHaveBeenCalledOnce();
	});

	it("announces nothing when the teardown reported nothing", async () => {
		const onWorkspaceNotice = vi.fn<(agent: Subagent, notice: string) => void>();
		const { factory, stub } = createFactory();
		stub.runTurnLoop.mockRejectedValue(new Error("turn loop exploded"));
		const agent = createRunnableAgent({
			createSubagentSession: factory,
			workspaceProvider: makeWorkspaceProvider(makeWorkspace("/ws/dir")),
			observer: { onWorkspaceNotice },
		});
		await agent.run();
		await agent.disposeSession();
		expect(onWorkspaceNotice).not.toHaveBeenCalled();
	});

	it("leaves a running agent's workspace — and its notice — alone", async () => {
		const onWorkspaceNotice = vi.fn<(agent: Subagent, notice: string) => void>();
		const { factory, stub } = createFactory();
		const turnLoop = Promise.withResolvers<TurnLoopResult>();
		stub.runTurnLoop.mockReturnValue(turnLoop.promise);
		const agent = createRunnableAgent({
			createSubagentSession: factory,
			workspaceProvider: makeWorkspaceProvider(makeWorkspace("/ws/dir", { resultAddendum: ADDENDUM })),
			observer: { onWorkspaceNotice },
		});
		agent.start();
		await vi.waitFor(() => { expect(agent.isSessionReady()).toBe(true); });

		await agent.disposeSession();
		expect(onWorkspaceNotice).not.toHaveBeenCalled();

		turnLoop.resolve({ responseText: "done", aborted: false, steered: false });
		await agent.promise;
	});

	it("does not announce for a failed run, whose own notification carries it", async () => {
		const onWorkspaceNotice = vi.fn<(agent: Subagent, notice: string) => void>();
		const { factory, stub } = createFactory();
		stub.runTurnLoop.mockRejectedValue(new Error("turn loop exploded"));
		const agent = createRunnableAgent({
			createSubagentSession: factory,
			workspaceProvider: makeWorkspaceProvider(makeWorkspace("/ws/dir", { resultAddendum: ADDENDUM })),
			observer: { onWorkspaceNotice },
		});
		await agent.run();
		expect(agent.workspaceNotice).toBe(ADDENDUM);
		expect(onWorkspaceNotice).not.toHaveBeenCalled();
	});

	it("does not announce for a failed resume, whose own notification carries it", async () => {
		const { agent, stub, onWorkspaceNotice } = await heldAgentWithObserver();
		stub.resumeTurnLoop.mockRejectedValue(new Error("resume exploded"));
		await agent.resume("the answer");
		expect(agent.workspaceNotice).toBe(ADDENDUM);
		expect(onWorkspaceNotice).not.toHaveBeenCalled();
	});
});

describe("Subagent.run() — error handling", () => {
	it("transitions to error when the turn loop throws", async () => {
		const { factory, stub } = createFactory();
		stub.runTurnLoop.mockRejectedValue(new Error("turn loop exploded"));
		const agent = createRunnableAgent({ createSubagentSession: factory });
		await agent.run();
		expect(agent.status).toBe("error");
		expect(agent.error).toBe("turn loop exploded");
	});

	it("transitions to error when the factory throws", async () => {
		const factory: SessionFactory = vi.fn().mockRejectedValue(new Error("creation failed"));
		const agent = createRunnableAgent({ createSubagentSession: factory });
		await agent.run();
		expect(agent.status).toBe("error");
		expect(agent.error).toBe("creation failed");
	});
});

describe("Subagent.run() — abort signal forwarding", () => {
	it("wires parent signal so aborting it stops the agent", async () => {
		const parentController = new AbortController();
		const { factory, stub } = createFactory();
		stub.runTurnLoop.mockImplementation(() => {
			parentController.abort();
			return Promise.reject(new Error("aborted"));
		});
		const agent = createRunnableAgent({ createSubagentSession: factory, signal: parentController.signal });
		await agent.run();
		expect(agent.abortController.signal.aborted).toBe(true);
	});
});

describe("Subagent.run() — RunConfig threading", () => {
	it("passes defaultMaxTurns and graceTurns to runTurnLoop", async () => {
		const { factory, stub } = createFactory();
		const agent = createRunnableAgent({ createSubagentSession: factory, getRunConfig: () => ({ defaultMaxTurns: 10, graceTurns: 3, midRunUpdates: true }) });
		await agent.run();
		const turnOpts = stub.runTurnLoop.mock.calls[0][1];
		expect(turnOpts.defaultMaxTurns).toBe(10);
		expect(turnOpts.graceTurns).toBe(3);
	});
});

// ── The child-to-parent channel ────────────────────────────────────────────────

/** A session factory that keeps its Mock type, so tests can read the params it received. */
function createSpyFactory() {
	const stub = createSubagentSessionStub();
	const factory = vi.fn(async (_params: CreateSubagentSessionParams) => toSubagentSession(stub));
	return { factory, stub };
}

describe("Subagent — the ask-back recorder", () => {
	it("hands the session factory a recorder for the child's question", async () => {
		const { factory } = createSpyFactory();
		const agent = createRunnableAgent({ createSubagentSession: factory });

		await agent.run();

		expect(factory.mock.calls[0][0].askParent).toBeTypeOf("function");
	});

	it("records a question the child declares mid-run", async () => {
		const { factory } = createSpyFactory();
		const agent = createRunnableAgent({ createSubagentSession: factory });
		await agent.run();

		factory.mock.calls[0][0].askParent?.("Which config wins?");

		expect(agent.pendingQuestion).toBe("Which config wins?");
	});

	it("keeps only the last question when the child asks twice", async () => {
		const { factory } = createSpyFactory();
		const agent = createRunnableAgent({ createSubagentSession: factory });
		await agent.run();
		const ask = factory.mock.calls[0][0].askParent;

		ask?.("first");
		ask?.("second");

		expect(agent.pendingQuestion).toBe("second");
	});

	it("drops a recorded question when the run fails, so no carrier invites a resume", () => {
		const agent = makeSubagent({ pendingQuestion: "Which config wins?" });

		agent.failRun(new Error("boom"));

		expect(agent.pendingQuestion).toBeUndefined();
	});

	it("drops a recorded question when a resumed run fails", () => {
		const agent = makeSubagent({ pendingQuestion: "Which config wins?" });

		agent.failResume(new Error("boom"));

		expect(agent.pendingQuestion).toBeUndefined();
	});
});

describe("Subagent — the mid-run update channel", () => {
	const updatesOn = { defaultMaxTurns: undefined, graceTurns: 5, midRunUpdates: true };

	it("gives a background child a way to send its parent an update", async () => {
		const { factory } = createSpyFactory();
		const agent = createRunnableAgent({
			createSubagentSession: factory,
			isBackground: true,
			getRunConfig: () => updatesOn,
		});

		await agent.run();

		expect(factory.mock.calls[0][0].notifyParent).toBeTypeOf("function");
	});

	it("reports a background child's update to the lifecycle observer", async () => {
		const { factory } = createSpyFactory();
		const onUpdateSent = vi.fn<(agent: Subagent, message: string) => void>();
		const agent = createRunnableAgent({
			createSubagentSession: factory,
			isBackground: true,
			observer: { onUpdateSent },
			getRunConfig: () => updatesOn,
		});
		await agent.run();

		factory.mock.calls[0][0].notifyParent?.("The bug is in the retry wrapper.");

		expect(onUpdateSent).toHaveBeenCalledWith(agent, "The bug is in the retry wrapper.");
	});

	it("withholds the channel from a foreground child, whose update could not arrive in time", async () => {
		const { factory } = createSpyFactory();
		const agent = createRunnableAgent({
			createSubagentSession: factory,
			isBackground: false,
			getRunConfig: () => updatesOn,
		});

		await agent.run();

		expect(factory.mock.calls[0][0].notifyParent).toBeUndefined();
	});

	it("withholds the channel when the operator turned mid-run updates off", async () => {
		const { factory } = createSpyFactory();
		const agent = createRunnableAgent({
			createSubagentSession: factory,
			isBackground: true,
			getRunConfig: () => ({ ...updatesOn, midRunUpdates: false }),
		});

		await agent.run();

		expect(factory.mock.calls[0][0].notifyParent).toBeUndefined();
	});

	it("still gives a foreground child the ask-back recorder", async () => {
		const { factory } = createSpyFactory();
		const agent = createRunnableAgent({ createSubagentSession: factory, isBackground: false });

		await agent.run();

		expect(factory.mock.calls[0][0].askParent).toBeTypeOf("function");
	});
});

// ── Subagent.start() ───────────────────────────────────────────────────────────

describe("Subagent.start() — promise encapsulation", () => {
	it("stores a run promise that resolves on completion", async () => {
		const agent = createRunnableAgent();
		agent.start();
		expect(agent.promise).toBeInstanceOf(Promise);
		await agent.promise;
		expect(agent.status).toBe("completed");
	});

	it("promise is undefined before start() is called", () => {
		const agent = createRunnableAgent();
		expect(agent.promise).toBeUndefined();
	});

	it("is a no-op when status is stopped (abort-while-queued guard)", async () => {
		const agent = makeSubagent({ status: "stopped", startedAt: 1, completedAt: 1 });
		agent.start();
		await expect(agent.promise).resolves.toBeUndefined();
		expect(agent.status).toBe("stopped");
	});

	it("is a no-op when status is completed", async () => {
		const agent = makeSubagent({ status: "completed", result: "done", startedAt: 1, completedAt: 2 });
		agent.start();
		await expect(agent.promise).resolves.toBeUndefined();
		expect(agent.status).toBe("completed");
	});
});

describe("Subagent.scheduleVia() — eager promise capture", () => {
	it("exposes the scheduler promise before the run starts (queued-awaitable)", async () => {
		const agent = makeSubagent({ status: "queued" });
		const { promise: gate, resolve: openSlot } = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
		agent.scheduleVia(async (thunk) => {
			await gate;
			await thunk();
		});
		// Promise is captured at schedule time — before the slot opens.
		expect(agent.promise).toBeInstanceOf(Promise);
		expect(agent.status).toBe("queued");
		openSlot();
		await agent.promise;
		expect(agent.status).toBe("completed");
	});

	it("runs guardedRun as the thunk — abort-while-queued is a no-op", async () => {
		const agent = makeSubagent({ status: "queued" });
		let thunkRan = false;
		// Abort before the slot opens, then fire the thunk.
		agent.markStopped();
		agent.scheduleVia(async (thunk) => {
			thunkRan = true;
			await thunk();
		});
		await agent.promise;
		expect(thunkRan).toBe(true);
		expect(agent.status).toBe("stopped");
	});
});

describe("Subagent.waitUntilSettled()", () => {
	it("resolves immediately for an agent that has no run handle", async () => {
		const agent = makeSubagent({ status: "queued" });
		await expect(agent.waitUntilSettled(new AbortController().signal)).resolves.toBeUndefined();
	});

	it("resolves immediately for an agent that already left the active set", async () => {
		const agent = makeSubagent({ status: "completed", result: "done", startedAt: 1, completedAt: 2 });
		agent.start();
		await agent.promise;
		await expect(agent.waitUntilSettled(new AbortController().signal)).resolves.toBeUndefined();
	});

	it("spans the queue slot and the run that follows it", async () => {
		const agent = makeSubagent({ status: "queued" });
		const { promise: gate, resolve: openSlot } = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
		agent.scheduleVia(async (thunk) => {
			await gate;
			await thunk();
		});

		const wait = agent.waitUntilSettled(new AbortController().signal);
		openSlot();
		await wait;

		expect(agent.status).toBe("completed");
	});

	it("ends the wait on interrupt without cancelling the agent", async () => {
		const agent = makeSubagent({ status: "queued" });
		const { promise: gate, resolve: openSlot } = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
		agent.scheduleVia(async (thunk) => {
			await gate;
			await thunk();
		});
		const controller = new AbortController();

		const wait = agent.waitUntilSettled(controller.signal);
		controller.abort();
		await wait;

		// Interrupting the query must not cancel the work: the agent is still
		// queued and still runs once its slot opens.
		expect(agent.status).toBe("queued");
		openSlot();
		await agent.promise;
		expect(agent.status).toBe("completed");
	});

	it("returns immediately when the signal is already aborted", async () => {
		const agent = makeSubagent({ status: "queued" });
		agent.scheduleVia(() => new Promise<never>(() => {}));

		await agent.waitUntilSettled(AbortSignal.abort());

		expect(agent.status).toBe("queued");
	});
});

// ── Agent.resume() ─────────────────────────────────────────────────────────────

/** Create an Agent with a SubagentSession already attached, ready for resume(). */
function createResumableAgent(overrides?: {
	observer?: SubagentLifecycleObserver;
	session?: ReturnType<typeof createMockSession>;
	stub?: ReturnType<typeof createSubagentSessionStub>;
}) {
	const session = overrides?.session ?? createMockSession();
	const stub = overrides?.stub ?? createSubagentSessionStub(session);
	const agent = makeSubagent({
		id: "resume-1",
		description: "resume test",
		execution: makeStubExecution({ observer: overrides?.observer ?? {} }),
		status: "completed",
		result: "first",
	});
	agent.subagentSession = toSubagentSession(stub);
	return { agent, session, stub };
}

/**
 * Run an agent whose turn loop calls `ask_parent`, the way a real child does:
 * through the recorder the assembly factory installed on its session.
 *
 * Returns the recorder too, so a resumed run can ask again on the same session.
 */
async function runAsking(opts: {
	responseText: string;
	question?: string;
	aborted?: boolean;
	steered?: boolean;
}) {
	const stub = createSubagentSessionStub();
	let askParent: ((question: string) => void) | undefined;
	const agent = makeSubagent({
		execution: makeStubExecution({
			createSubagentSession: async (params: CreateSubagentSessionParams) => {
				askParent = params.askParent;
				return toSubagentSession(stub);
			},
		}),
	});
	stub.runTurnLoop.mockImplementation(() => {
		if (opts.question !== undefined) askParent?.(opts.question);
		return Promise.resolve({
			responseText: opts.responseText,
			aborted: opts.aborted ?? false,
			steered: opts.steered ?? false,
		});
	});
	await agent.run();
	return { agent, stub, ask: (question: string) => askParent?.(question) };
}

describe("Subagent — ask-back", () => {
	it("records a declared question and leaves the result body untouched", async () => {
		const { agent } = await runAsking({
			responseText: "I mapped the configs.",
			question: "Which one is authoritative?",
		});

		expect(agent.pendingQuestion).toBe("Which one is authoritative?");
		// The question never entered the body, so every carrier renders it once,
		// as the affordance.
		expect(agent.result).toBe("I mapped the configs.");
	});

	it("leaves pendingQuestion undefined when the child asked nothing", async () => {
		const { agent } = await runAsking({ responseText: "All done." });

		expect(agent.pendingQuestion).toBeUndefined();
		expect(agent.result).toBe("All done.");
	});

	it("records a question an aborted run declared before it ran out of turns", async () => {
		const { agent } = await runAsking({
			responseText: "",
			question: "Still stuck on which?",
			aborted: true,
		});

		expect(agent.status).toBe("aborted");
		expect(agent.pendingQuestion).toBe("Still stuck on which?");
	});

	it("completes the round trip: ask, answer by resuming, continue", async () => {
		const { agent, stub } = await runAsking({ responseText: "", question: "Which config?" });
		stub.resumeTurnLoop.mockResolvedValue("Used the project config. Done.");
		expect(agent.pendingQuestion).toBe("Which config?");

		await agent.resume("The project one.");

		expect(stub.resumeTurnLoop).toHaveBeenCalledWith("The project one.", undefined);
		expect(agent.status).toBe("completed");
		expect(agent.result).toBe("Used the project config. Done.");
		// The question was answered, so it no longer stands.
		expect(agent.pendingQuestion).toBeUndefined();
	});

	it("records a follow-up question a resumed run declares", async () => {
		const { agent, stub, ask } = await runAsking({ responseText: "", question: "Which config?" });
		stub.resumeTurnLoop.mockImplementation(() => {
			ask("And the fallback?");
			return Promise.resolve("Thanks.");
		});

		await agent.resume("The project one.");

		expect(agent.pendingQuestion).toBe("And the fallback?");
		expect(agent.result).toBe("Thanks.");
	});
});

describe("Subagent.resume() — happy path", () => {
	it("transitions to completed and sets result from the resume response", async () => {
		const { agent } = createResumableAgent();
		await agent.resume("continue");
		expect(agent.status).toBe("completed");
		expect(agent.result).toBe("resumed");
	});

	it("passes the prompt and signal straight through to resumeTurnLoop", async () => {
		const { agent, stub } = createResumableAgent();
		const signal = new AbortController().signal;
		await agent.resume("continue", signal);
		expect(stub.resumeTurnLoop).toHaveBeenCalledOnce();
		expect(stub.resumeTurnLoop.mock.calls[0][0]).toBe("continue");
		expect(stub.resumeTurnLoop.mock.calls[0][1]).toBe(signal);
	});

	it("resets transition state before resuming", async () => {
		const { agent } = createResumableAgent();
		await agent.resume("continue");
		expect(agent.error).toBeUndefined();
	});
});

describe("Subagent.resume() — observer lifecycle", () => {
	it("accumulates usage and compactions from session events during resume", async () => {
		const session = createMockSession();
		const stub = createSubagentSessionStub(session);
		stub.resumeTurnLoop.mockImplementation(async () => {
			emitResumeUsageAndCompaction(session);
			return "second";
		});
		const { agent } = createResumableAgent({ session, stub });
		await agent.resume("more");
		expect(agent.lifetimeUsage).toEqual({ input: 70, output: 30, cacheWrite: 5 });
		expect(agent.compactionCount).toBe(1);
	});

	it("forwards compaction events through observer.onCompacted", async () => {
		const session = createMockSession();
		const seen: Array<{ reason: string; tokensBefore: number }> = [];
		const observer: SubagentLifecycleObserver = {
			onCompacted: (_agent: Subagent, info: CompactionInfo) => seen.push({ reason: info.reason, tokensBefore: info.tokensBefore }),
		};
		const stub = createSubagentSessionStub(session);
		stub.resumeTurnLoop.mockImplementation(async () => {
			session.emit({ type: "compaction_end", aborted: false, result: { tokensBefore: 123 }, reason: "threshold" });
			return "second";
		});
		const { agent } = createResumableAgent({ observer, session, stub });
		await agent.resume("more");
		expect(seen).toEqual([{ reason: "threshold", tokensBefore: 123 }]);
	});

	it("releases the observer subscription after resume completes", async () => {
		const session = createMockSession();
		const { agent } = createResumableAgent({ session });
		await agent.resume("more");
		// Events emitted after resume must not accumulate — subscription released.
		session.emit({ type: "tool_execution_end" });
		expect(agent.toolUses).toBe(0);
	});

	it("fires observer.onResumeFinished once the resume completes", async () => {
		const onResumeFinished = vi.fn();
		const { agent } = createResumableAgent({ observer: { onResumeFinished } });
		await agent.resume("continue");
		expect(onResumeFinished).toHaveBeenCalledExactlyOnceWith(agent);
		expect(agent.status).toBe("completed");
	});

	it("fires observer.onResumeFinished when the resume errors", async () => {
		const onResumeFinished = vi.fn();
		const stub = createSubagentSessionStub();
		stub.resumeTurnLoop.mockRejectedValue(new Error("resume exploded"));
		const { agent } = createResumableAgent({ observer: { onResumeFinished }, stub });
		await agent.resume("continue");
		expect(onResumeFinished).toHaveBeenCalledExactlyOnceWith(agent);
		expect(agent.status).toBe("error");
	});
});

describe("Subagent.resume() — error handling", () => {
	it("transitions to error without throwing when resumeTurnLoop rejects", async () => {
		const stub = createSubagentSessionStub();
		stub.resumeTurnLoop.mockRejectedValue(new Error("resume exploded"));
		const { agent } = createResumableAgent({ stub });
		await agent.resume("more");
		expect(agent.status).toBe("error");
		expect(agent.error).toBe("resume exploded");
	});

	it("releases the observer subscription after resume errors", async () => {
		const session = createMockSession();
		const stub = createSubagentSessionStub(session);
		stub.resumeTurnLoop.mockRejectedValue(new Error("boom"));
		const { agent } = createResumableAgent({ session, stub });
		await agent.resume("more");
		session.emit({ type: "tool_execution_end" });
		expect(agent.toolUses).toBe(0);
	});

	it("throws when no session exists", async () => {
		const agent = makeSubagent();
		await expect(agent.resume("more")).rejects.toThrow(/missing session/);
	});
});

describe("Subagent.resume() — awaitable handle", () => {
	it("republishes the promise getter for the in-flight resume", async () => {
		const { agent, stub } = createResumableAgent();
		agent.start();
		const firstRun = agent.promise;
		await firstRun;
		const { promise: resuming, resolve: finishResume } = Promise.withResolvers<string>();
		stub.resumeTurnLoop.mockReturnValue(resuming);

		const returned = agent.resume("continue");

		// The getter must track the live resume, not the settled first-run handle.
		expect(agent.promise).not.toBe(firstRun);
		expect(agent.promise).toBe(returned);

		finishResume("resumed late");
		await returned;
		expect(agent.status).toBe("completed");
		expect(agent.result).toBe("resumed late");
	});
});
