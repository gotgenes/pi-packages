import { describe, expect, it, vi } from "vitest";
import type { CreateSubagentSessionParams } from "#src/lifecycle/create-subagent-session";
import { Subagent, type SubagentExecution, type SubagentLifecycleObserver } from "#src/lifecycle/subagent";
import type { SubagentSession, TurnLoopResult } from "#src/lifecycle/subagent-session";
import { SubagentState, type SubagentStateInit } from "#src/lifecycle/subagent-state";
import type { Workspace, WorkspaceProvider } from "#src/lifecycle/workspace";
import type { AgentInvocation, CompactionInfo, SubagentType } from "#src/types";
import { makeStubExecution } from "#test/helpers/make-subagent";
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
	invocation?: AgentInvocation;
	execution?: SubagentExecution;
}

/** Construct a Subagent with default identity and a stub execution, overridable per test. */
function makeSubagent(overrides: MakeSubagentOptions = {}): Subagent {
	const { id, type, description, invocation, execution, ...stateOverrides } = overrides;
	return new Subagent({
		id: id ?? "1",
		type: type ?? "general-purpose",
		description: description ?? "test",
		invocation,
		execution: execution ?? makeStubExecution(),
		state: Object.keys(stateOverrides).length > 0 ? new SubagentState(stateOverrides) : undefined,
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

	it("passes through optional identity fields", () => {
		const record = makeSubagent({ invocation: { modelName: "haiku" } });
		expect(record.abortController).toBeInstanceOf(AbortController);
		expect(record.invocation).toEqual({ modelName: "haiku" });
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
			const record = new Subagent({ id: "1", type: "general-purpose", description: "test", execution: makeStubExecution(), state });
			state.incrementTurnCount();
			expect(record.turnCount).toBe(2);
		});

		it("activeTools reflects state mutations via addActiveTool", () => {
			const state = new SubagentState();
			const record = new Subagent({ id: "1", type: "general-purpose", description: "test", execution: makeStubExecution(), state });
			state.addActiveTool("Read");
			expect(record.activeTools.size).toBe(1);
			expect([...record.activeTools.values()]).toContain("Read");
		});

		it("responseText reflects state mutations via appendResponseText", () => {
			const state = new SubagentState();
			const record = new Subagent({ id: "1", type: "general-purpose", description: "test", execution: makeStubExecution(), state });
			state.appendResponseText("Hello");
			expect(record.responseText).toBe("Hello");
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

describe("Subagent — disposeSession", () => {
	it("disposes the wrapped SubagentSession", () => {
		const record = makeSubagent();
		const stub = createSubagentSessionStub();
		record.subagentSession = toSubagentSession(stub);
		record.disposeSession();
		expect(stub.dispose).toHaveBeenCalledOnce();
	});

	it("is a no-op when no session was created", () => {
		const record = makeSubagent();
		expect(() => record.disposeSession()).not.toThrow();
	});
});

// ── Agent.run() ──────────────────────────────────────────────────────────────

/** Create a complete Agent ready for run(). */
function createRunnableAgent(overrides?: {
	createSubagentSession?: SessionFactory;
	description?: string;
	observer?: SubagentLifecycleObserver;
	getRunConfig?: () => { defaultMaxTurns: number | undefined; graceTurns: number };
	parentSession?: { toolCallId?: string; parentSessionFile?: string; parentSessionId?: string };
	parentResultMode?: "full" | "redacted";
	signal?: AbortSignal;
	baseCwd?: string;
	workspaceProvider?: WorkspaceProvider;
}) {
	const createSubagentSession = overrides?.createSubagentSession ?? defaultFactory();
	const observer = overrides?.observer ?? {};
	const provider = overrides?.workspaceProvider;
	return new Subagent({
		id: "run-1",
		type: "general-purpose",
		description: overrides?.description ?? "run test",
		execution: {
			createSubagentSession,
			observer,
			snapshot: STUB_SNAPSHOT,
			prompt: "do something",
			getRunConfig: overrides?.getRunConfig,
			parentSession: overrides?.parentSession,
			parentResultMode: overrides?.parentResultMode,
			signal: overrides?.signal,
			baseCwd: overrides?.baseCwd ?? "/base",
			getWorkspaceProvider: provider ? () => provider : undefined,
		},
	});
}

/** Build a Workspace with a recorded dispose. */
function makeWorkspace(cwd: string, disposeResult?: { resultAddendum?: string }): Workspace {
	return { cwd, dispose: vi.fn(() => disposeResult) };
}

/** Build a WorkspaceProvider whose prepare resolves to the given workspace. */
function makeWorkspaceProvider(workspace: Workspace | undefined): WorkspaceProvider {
	return { prepare: vi.fn(async () => workspace) };
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

	it("threads redacted parent result mode to the child session factory", async () => {
		const { factory } = createFactory();
		const agent = createRunnableAgent({ createSubagentSession: factory, parentResultMode: "redacted" });

		await agent.run();

		expect((factory as ReturnType<typeof vi.fn>).mock.calls[0][0].parentResultMode).toBe("redacted");
	});

	it("calls prepare with the run-start context", async () => {
		const provider = makeWorkspaceProvider(makeWorkspace("/ws/dir"));
		const agent = createRunnableAgent({ workspaceProvider: provider, baseCwd: "/parent" });
		await agent.run();
		expect(provider.prepare).toHaveBeenCalledWith({
			agentId: "run-1",
			agentType: "general-purpose",
			baseCwd: "/parent",
			invocation: undefined,
		});
	});

	it("appends the dispose resultAddendum to the result", async () => {
		const workspace = makeWorkspace("/ws/dir", { resultAddendum: "\n\n---\nsaved to branch foo" });
		const agent = createRunnableAgent({ workspaceProvider: makeWorkspaceProvider(workspace) });
		await agent.run();
		expect(agent.result).toBe("done\n\n---\nsaved to branch foo");
		expect(workspace.dispose).toHaveBeenCalledWith({ status: "completed", description: "run test" });
	});

	it("withholds a redacted native child's description from successful workspace disposal", async () => {
		const { stub } = createFactory();
		const workspace = makeWorkspace("/ws/dir");
		const agent = createRunnableAgent({
			createSubagentSession: async () => toSubagentSession(stub),
			workspaceProvider: makeWorkspaceProvider(workspace),
			parentResultMode: "redacted",
			description: "SECRET TASK BODY",
		});

		await agent.run();

		expect(JSON.stringify(vi.mocked(workspace.dispose).mock.calls)).not.toContain("SECRET TASK BODY");
		expect(workspace.dispose).toHaveBeenCalledWith({ status: "completed", description: "Child task withheld." });
	});

	it("withholds a redacted native child's description from failed workspace disposal", async () => {
		const { stub } = createFactory();
		stub.runTurnLoop.mockRejectedValue(new Error("failed"));
		const workspace = makeWorkspace("/ws/dir");
		const agent = createRunnableAgent({
			createSubagentSession: async () => toSubagentSession(stub),
			workspaceProvider: makeWorkspaceProvider(workspace),
			parentResultMode: "redacted",
			description: "SECRET TASK BODY",
		});

		await agent.run();

		expect(JSON.stringify(vi.mocked(workspace.dispose).mock.calls)).not.toContain("SECRET TASK BODY");
		expect(workspace.dispose).toHaveBeenCalledWith({ status: "error", description: "Child task withheld." });
	});

	it("withholds a redacted native child's description from cancelled workspace disposal", async () => {
		const { stub } = createFactory();
		stub.runTurnLoop.mockResolvedValue({ responseText: "done", aborted: true, steered: false });
		const workspace = makeWorkspace("/ws/dir");
		const agent = createRunnableAgent({
			createSubagentSession: async () => toSubagentSession(stub),
			workspaceProvider: makeWorkspaceProvider(workspace),
			parentResultMode: "redacted",
			description: "SECRET TASK BODY",
		});

		await agent.run();

		expect(JSON.stringify(vi.mocked(workspace.dispose).mock.calls)).not.toContain("SECRET TASK BODY");
		expect(workspace.dispose).toHaveBeenCalledWith({ status: "aborted", description: "Child task withheld." });
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
		const workspace = makeWorkspace("/ws/dir", { resultAddendum: "\nshould be discarded" });
		const agent = createRunnableAgent({ createSubagentSession: factory, workspaceProvider: makeWorkspaceProvider(workspace) });
		await agent.run();
		expect(agent.status).toBe("error");
		expect(workspace.dispose).toHaveBeenCalledWith({ status: "error", description: "run test" });
		expect(agent.result).toBeUndefined();
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
		const agent = createRunnableAgent({ createSubagentSession: factory, getRunConfig: () => ({ defaultMaxTurns: 10, graceTurns: 3 }) });
		await agent.run();
		const turnOpts = stub.runTurnLoop.mock.calls[0][1];
		expect(turnOpts.defaultMaxTurns).toBe(10);
		expect(turnOpts.graceTurns).toBe(3);
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

// ── Agent.resume() ─────────────────────────────────────────────────────────────

/** Create an Agent with a SubagentSession already attached, ready for resume(). */
function createResumableAgent(overrides?: {
	observer?: SubagentLifecycleObserver;
	session?: ReturnType<typeof createMockSession>;
	stub?: ReturnType<typeof createSubagentSessionStub>;
}) {
	const session = overrides?.session ?? createMockSession();
	const stub = overrides?.stub ?? createSubagentSessionStub(session);
	const agent = new Subagent({
		id: "resume-1",
		type: "general-purpose",
		description: "resume test",
		execution: makeStubExecution({ observer: overrides?.observer ?? {} }),
		state: new SubagentState({ status: "completed", result: "first" }),
	});
	agent.subagentSession = toSubagentSession(stub);
	return { agent, session, stub };
}

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
