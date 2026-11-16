import { describe, expect, it, vi } from "vitest";
import type { CreateSubagentSessionParams } from "#src/lifecycle/create-subagent-session";
import { Subagent, type SubagentExecution, type SubagentLifecycleObserver } from "#src/lifecycle/subagent";
import type { RunKind } from "#src/lifecycle/subagent-run";
import { SubagentSession, type TurnLoopOptions, type TurnLoopResult } from "#src/lifecycle/subagent-session";
import { SubagentState, type SubagentStatus } from "#src/lifecycle/subagent-state";
import type { TurnBudget } from "#src/lifecycle/turn-limits";
import type { WorkspacePrepareContext, WorkspaceProvider } from "#src/lifecycle/workspace";
import type { RunConfig } from "#src/runtime";
import type { CompactionInfo, SubagentType } from "#src/types";
import { gatedScheduler } from "#test/helpers/gated-scheduler";
import { makeModel } from "#test/helpers/make-model";
import { createTestSubagent, makeStubExecution } from "#test/helpers/make-subagent";
import { makeWorkspace, makeWorkspaceProvider } from "#test/helpers/make-workspace";
import { createMockSession, createSubagentSessionStub, emitResumeUsageAndCompaction, toAgentSession, toSubagentSession } from "#test/helpers/mock-session";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";
import { createChildLifecycleMock } from "#test/helpers/subagent-session-io";
import { turnLoopResult } from "#test/helpers/turn-loop-result";

const WARNED: TurnBudget = { maxTurns: 5, used: 3, phase: "warned" };
const EXHAUSTED: TurnBudget = { maxTurns: 5, used: 5, phase: "exhausted" };

type SessionFactory = (params: CreateSubagentSessionParams) => Promise<SubagentSession>;

/**
 * Build a factory plus the SubagentSession stub it resolves to.
 *
 * The factory records the params the latest session was created with, so a
 * test reads what run() handed it through `params()`, and calls the channels it
 * installed through `ask`/`notify`, the way a real child does: from inside its
 * turn loop.
 */
function createFactory() {
	const stub = createSubagentSessionStub();
	let created: CreateSubagentSessionParams | undefined;
	const factory = vi.fn(async (params: CreateSubagentSessionParams) => {
		created = params;
		return toSubagentSession(stub);
	});
	const params = (): CreateSubagentSessionParams => {
		if (!created) throw new Error("no session was created");
		return created;
	};
	return {
		factory,
		stub,
		params,
		ask: (question: string) => { params().askParent?.(question); },
		notify: (message: string) => { params().notifyParent?.(message); },
	};
}

/** A factory resolving to a default (done) SubagentSession stub. */
function defaultFactory(): SessionFactory {
	return createFactory().factory;
}

/**
 * Park a stub's turn loop until its signal
 * fires, recording what it was handed and whether that signal was already spent
 * on arrival. The loop's signal is the run's lever as the session sees it.
 */
function parkLoopUntilSignalled(turnLoop: ReturnType<typeof createSubagentSessionStub>["runTurnLoop"]) {
	const gate = Promise.withResolvers<TurnLoopResult>();
	const loop: { signal?: AbortSignal; abortedAtEntry?: boolean; signalled: boolean } = { signalled: false };
	turnLoop.mockImplementation((_prompt: string, { signal }: { signal?: AbortSignal }) => {
		loop.signal = signal;
		loop.abortedAtEntry = signal?.aborted;
		signal?.addEventListener("abort", () => {
			loop.signalled = true;
			gate.resolve(turnLoopResult({ responseText: "partial answer" }));
		});
		return gate.promise;
	});
	return loop;
}

interface MakeSubagentOptions {
	// The initial run's outcome seeds, named one by one so each lands in a literal
	// the type checker reads.
	status?: SubagentStatus;
	result?: string;
	startedAt?: number;
	completedAt?: number;
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
	const { id, type, description, isBackground, execution, state, status, result, startedAt, completedAt } = overrides;
	return new Subagent({
		id: id ?? "1",
		type: type ?? "general-purpose",
		description: description ?? "test",
		isBackground: isBackground ?? true,
		execution: execution ?? makeStubExecution(),
		state,
		outcome: { status, result, startedAt, completedAt },
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
	maxTurns?: number;
	status?: SubagentStatus;
}) {
	const createSubagentSession = overrides?.createSubagentSession ?? defaultFactory();
	const observer = overrides?.observer ?? {};
	const provider = overrides?.workspaceProvider;
	return makeSubagent({
		id: "run-1",
		description: "run test",
		isBackground: overrides?.isBackground,
		status: overrides?.status,
		execution: {
			createSubagentSession,
			observer,
			snapshot: STUB_SNAPSHOT,
			prompt: "do something",
			getRunConfig: overrides?.getRunConfig,
			maxTurns: overrides?.maxTurns,
			parentSession: overrides?.parentSession,
			signal: overrides?.signal,
			baseCwd: overrides?.baseCwd ?? "/base",
			getWorkspaceProvider: provider ? () => provider : undefined,
		},
	});
}

const ADDENDUM = "\n\n---\nsaved to branch foo";

/** What a run-to-outcome arrange asks for: the turn loop's result, plus how the child behaves. */
interface RunOutcomeOptions extends Partial<TurnLoopResult> {
	/** Asked through `ask_parent` from inside the turn loop, the way a real child asks one. */
	question?: string;
	/** The turn loop rejects with this instead of settling. */
	error?: Error;
	/** Runs the agent under a provider that prepares this workspace. */
	workspace?: ReturnType<typeof makeWorkspace>;
	observer?: SubagentLifecycleObserver;
}

/** A turn loop that behaves as `opts` says, asking its question through `ask`. */
function outcomeLoop(opts: Omit<RunOutcomeOptions, "workspace" | "observer">, ask: (question: string) => void) {
	const { question, error, ...result } = opts;
	return () => {
		if (question !== undefined) ask(question);
		return error ? Promise.reject(error) : Promise.resolve(turnLoopResult(result));
	};
}

/**
 * Run an agent to a terminal turn-loop result.
 *
 * Returns the session stub and the `ask` recorder too, so a resumed run can
 * ask again on the same session.
 */
async function runToOutcome(opts: RunOutcomeOptions) {
	const { workspace, observer, ...loop } = opts;
	const { factory, stub, ask } = createFactory();
	stub.runTurnLoop.mockImplementation(outcomeLoop(loop, ask));
	const agent = createRunnableAgent({
		createSubagentSession: factory,
		workspaceProvider: workspace ? makeWorkspaceProvider(workspace) : undefined,
		observer,
	});
	await agent.run();
	return { agent, stub, ask };
}

/** Run an agent to a terminal turn-loop result under a workspace that reports {@link ADDENDUM}. */
async function runWithWorkspace(opts: Omit<RunOutcomeOptions, "workspace">) {
	const workspace = makeWorkspace("/ws/dir", { resultAddendum: ADDENDUM });
	return { ...(await runToOutcome({ ...opts, workspace })), workspace };
}

/** Run an agent to a question-ending completion, so its workspace is still held. */
function heldWorkspaceAgent(observer?: SubagentLifecycleObserver) {
	return runWithWorkspace({ responseText: "Mapped the configs.", question: "Which one?", observer });
}

/**
 * Drives one kind of run to an outcome under a workspace that reports
 * {@link ADDENDUM}: the initial run itself, or a resume of an agent whose
 * initial run asked a question and so still holds its workspace.
 */
interface RunKindDriver {
	kind: RunKind;
	runToOutcome(opts: Omit<RunOutcomeOptions, "workspace">): ReturnType<typeof runWithWorkspace>;
}

const RUN_KIND_DRIVERS: readonly RunKindDriver[] = [
	{ kind: "initial", runToOutcome: (opts) => runWithWorkspace(opts) },
	{
		kind: "resume",
		runToOutcome: async ({ observer, ...loop }) => {
			const held = await heldWorkspaceAgent(observer);
			held.stub.runTurnLoop.mockImplementation(outcomeLoop(loop, held.ask));
			await held.agent.resume("continue", { background: true });
			return held;
		},
	},
];

/** Create an Agent with a SubagentSession already attached, ready for resume(). */
function createResumableAgent(overrides?: {
	observer?: SubagentLifecycleObserver;
	session?: ReturnType<typeof createMockSession>;
	stub?: ReturnType<typeof createSubagentSessionStub>;
	isBackground?: boolean;
}) {
	const session = overrides?.session ?? createMockSession();
	const stub = overrides?.stub ?? createSubagentSessionStub(session);
	const agent = makeSubagent({
		id: "resume-1",
		description: "resume test",
		isBackground: overrides?.isBackground,
		execution: makeStubExecution({ observer: overrides?.observer ?? {} }),
		status: "completed",
		result: "first",
	});
	agent.subagentSession = toSubagentSession(stub);
	return { agent, session, stub };
}

describe("Subagent", () => {
	describe("construction", () => {
		it("sets required fields from init", () => {
			const record = makeSubagent({ id: "abc-123", type: "Explore", description: "Find stale TODOs" });
			expect(record.id).toBe("abc-123");
			expect(record.type).toBe("Explore");
			expect(record.description).toBe("Find stale TODOs");
		});

		it("starts with zeroed stats", () => {
			const record = makeSubagent();
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
			it("activeTools defaults to an empty map (delegates to SubagentState)", () => {
				const record = makeSubagent();
				expect(record.activeTools.size).toBe(0);
			});

			it("responseText defaults to empty string (delegates to SubagentState)", () => {
				const record = makeSubagent();
				expect(record.responseText).toBe("");
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
			it("consumed defaults to false and consumedAt undefined", () => {
				const record = makeSubagent();
				expect(record.consumed).toBe(false);
				expect(record.consumedAt).toBeUndefined();
			});

			it("markConsumed records the current run's collection", () => {
				const record = makeSubagent({ status: "completed" });
				record.markConsumed(5000);
				expect(record.consumed).toBe(true);
				expect(record.consumedAt).toBe(5000);
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

	describe("session-encapsulation methods", () => {
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
				const agent = makeSubagent({ status: "running" });
				const outcome = await agent.steer("hello");
				expect(outcome).toEqual({ kind: "buffered" });
				expect(agent.pendingSteerCount).toBe(1);
			});

			it("delivers to the session and returns a delivered outcome when the session is ready", async () => {
				const agent = makeSubagent({ status: "running" });
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

	describe("steer buffer", () => {
		it("starts with an empty steer buffer", () => {
			const record = makeSubagent();
			expect(record.pendingSteerCount).toBe(0);
		});
	});

	describe("abort", () => {
		it("returns false and does nothing when not running", () => {
			const record = makeSubagent({ status: "queued" });
			expect(record.abort()).toBe(false);
			expect(record.status).toBe("queued");
		});

		it("signals the running turn loop, marks stopped, and returns true when running", async () => {
			const { factory, stub } = createFactory();
			const loop = parkLoopUntilSignalled(stub.runTurnLoop);
			const record = createRunnableAgent({ createSubagentSession: factory });
			const run = record.run();
			await vi.waitFor(() => expect(stub.runTurnLoop).toHaveBeenCalled());

			expect(record.abort()).toBe(true);
			await run;

			expect(loop.signalled).toBe(true);
			expect(record.status).toBe("stopped");
		});

		it("marks stopped and returns true for a running record with no run to signal", () => {
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

	describe("stopQueued", () => {
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
			expect(onRunFinished).toHaveBeenCalledExactlyOnceWith(record, "initial");
		});

		it("ends a resume stopped before its slot opened as a resume", () => {
			const onRunFinished = vi.fn();
			const { agent } = createResumableAgent({ observer: { onRunFinished } });
			void agent.resume("continue", { background: true }, gatedScheduler().schedule);

			agent.stopQueued();

			expect(onRunFinished).toHaveBeenCalledExactlyOnceWith(agent, "resume");
			expect([agent.status, agent.stoppedWhileQueued]).toEqual(["stopped", true]);
		});

		it("leaves stoppedWhileQueued false for a running agent aborted mid-run", () => {
			const record = makeSubagent({ status: "running" });
			expect(record.abort()).toBe(true);
			expect(record.status).toBe("stopped");
			expect(record.stoppedWhileQueued).toBe(false);
		});
	});

	describe("disposeSession", () => {
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

	describe("releaseSession", () => {
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

	describe("model and thinking level", () => {
		const sonnet = { provider: "anthropic", id: "claude-sonnet-5" };

		function withLiveSession(execution?: SubagentExecution) {
			const record = makeSubagent({ execution });
			const session = createMockSession();
			session.model = sonnet;
			session.thinkingLevel = "high";
			record.subagentSession = toSubagentSession(createSubagentSessionStub(session, "/path/to/session.jsonl"));
			return { record, session };
		}

		describe("from the live session", () => {
			it("reports the model the child is running, over the spawn override", () => {
				const { record } = withLiveSession(makeStubExecution({ model: makeModel({ provider: "openai", id: "gpt-6" }) }));
				expect(record.model).toBe(sonnet);
			});

			it("follows a model the child switches to mid-run", () => {
				const { record, session } = withLiveSession();
				const fallback = { provider: "openai", id: "gpt-6" };
				session.model = fallback;
				expect(record.model).toBe(fallback);
			});

			it("reports the child's thinking level, over the spawn override", () => {
				const { record } = withLiveSession(makeStubExecution({ thinkingLevel: "low" }));
				expect(record.thinkingLevel).toBe("high");
			});
		});

		describe("after the session is released", () => {
			it("retains the model the child last ran", async () => {
				const { record } = withLiveSession();
				await record.releaseSession();
				expect(record.model).toBe(sonnet);
			});

			it("retains the child's last thinking level", async () => {
				const { record } = withLiveSession();
				await record.releaseSession();
				expect(record.thinkingLevel).toBe("high");
			});
		});

		describe("before a session exists", () => {
			it("reports the spawn override", () => {
				const opus = makeModel({ provider: "anthropic", id: "claude-opus-5" });
				const record = makeSubagent({ execution: makeStubExecution({ model: opus, thinkingLevel: "medium" }) });
				expect(record.model).toBe(opus);
				expect(record.thinkingLevel).toBe("medium");
			});

			it("reports nothing for an inherited model and level", () => {
				const record = makeSubagent();
				expect(record.model).toBeUndefined();
				expect(record.thinkingLevel).toBeUndefined();
			});
		});
	});

	describe("workspaceDisposed", () => {
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

	describe("resumeRefusal", () => {
		it("refuses nothing for an agent whose session is live and workspace intact", async () => {
			const agent = createRunnableAgent();
			await agent.run();
			expect(agent.resumeRefusal).toBeUndefined();
		});

		it("reports no-session for an agent that never got one", () => {
			expect(makeSubagent().resumeRefusal).toBe("no-session");
		});

		it("reports still-running for a live run whose session is ready", () => {
			expect(
				createTestSubagent({ status: "running", sessionReady: true }).resumeRefusal,
			).toBe("still-running");
		});

		it("prefers the live run over the missing session it has not created yet", () => {
			expect(createTestSubagent({ status: "running" }).resumeRefusal).toBe("still-running");
		});

		it("leaves a queued agent reporting no-session, which is what it has", () => {
			expect(createTestSubagent({ status: "queued" }).resumeRefusal).toBe("no-session");
		});

		it("refuses a second resume while one waits for a slot, until that run settles", async () => {
			const { agent } = createResumableAgent();
			const { schedule, openSlot } = gatedScheduler();
			void agent.resume("continue", { background: true }, schedule);

			expect(agent.resumeRefusal).toBe("resume-queued");

			openSlot();
			await agent.promise;
			expect(agent.resumeRefusal).toBeUndefined();
		});

		it("reports session-released once the retention sweep has freed the session", async () => {
			const agent = createRunnableAgent();
			await agent.run();
			await agent.releaseSession();
			expect(agent.resumeRefusal).toBe("session-released");
		});

		it("reports workspace-disposed while the session is still live", async () => {
			const agent = createRunnableAgent({ workspaceProvider: makeWorkspaceProvider(makeWorkspace("/ws/dir")) });
			await agent.run();
			expect(agent.isSessionReady()).toBe(true);
			expect(agent.resumeRefusal).toBe("workspace-disposed");
		});

		it("prefers the released session over the workspace when both are gone", async () => {
			const agent = createRunnableAgent({ workspaceProvider: makeWorkspaceProvider(makeWorkspace("/ws/dir")) });
			await agent.run();
			await agent.releaseSession();
			expect(agent.workspaceDisposed).toBe(true);
			expect(agent.resumeRefusal).toBe("session-released");
		});

		it("leaves a session-ready test fixture resumable", () => {
			expect(createTestSubagent({ sessionReady: true }).resumeRefusal).toBeUndefined();
		});
	});

	describe("workspaceNotice", () => {
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
			stub.runTurnLoop.mockRejectedValue(new Error("resume exploded"));
			await agent.resume("the answer", { background: true });
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

	describe("announcing a notice produced after the result was delivered", () => {
		/** A held-workspace agent whose observer records every workspace notice. */
		async function heldAgentWithObserver() {
			const onWorkspaceNotice = vi.fn<(agent: Subagent, notice: string) => void>();
			return { ...(await heldWorkspaceAgent({ onWorkspaceNotice })), onWorkspaceNotice };
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

			turnLoop.resolve(turnLoopResult({ responseText: "done" }));
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
			stub.runTurnLoop.mockRejectedValue(new Error("resume exploded"));
			await agent.resume("the answer", { background: true });
			expect(agent.workspaceNotice).toBe(ADDENDUM);
			expect(onWorkspaceNotice).not.toHaveBeenCalled();
		});
	});

	describe("the ask-back recorder", () => {
		it("hands the session factory a recorder for the child's question", async () => {
			const { factory, params } = createFactory();
			const agent = createRunnableAgent({ createSubagentSession: factory });

			await agent.run();

			expect(params().askParent).toBeTypeOf("function");
		});

		it("records a question the child declares mid-run", async () => {
			const { factory, ask } = createFactory();
			const agent = createRunnableAgent({ createSubagentSession: factory });
			await agent.run();

			ask("Which config wins?");

			expect(agent.pendingQuestion).toBe("Which config wins?");
		});

		it("keeps only the last question when the child asks twice", async () => {
			const { factory, ask } = createFactory();
			const agent = createRunnableAgent({ createSubagentSession: factory });
			await agent.run();

			ask("first");
			ask("second");

			expect(agent.pendingQuestion).toBe("second");
		});

		it("drops a recorded question when the run fails, so no carrier invites a resume", async () => {
			const { factory, stub, ask } = createFactory();
			stub.runTurnLoop.mockImplementation(() => {
				ask("Which config wins?");
				return Promise.reject(new Error("boom"));
			});
			const agent = createRunnableAgent({ createSubagentSession: factory });

			await agent.run();

			expect(agent.status).toBe("error");
			expect(agent.pendingQuestion).toBeUndefined();
		});

		// The question is asked from inside the resumed loop: a resume rewinds the
		// record and clears any question seeded before it, so a seeded one would pass
		// without the failure path dropping anything.
		it("drops a recorded question when a resumed run fails", async () => {
			const { factory, stub, ask } = createFactory();
			const agent = createRunnableAgent({ createSubagentSession: factory });
			await agent.run();
			stub.runTurnLoop.mockImplementation(() => {
				ask("Which config wins?");
				return Promise.reject(new Error("boom"));
			});

			await agent.resume("continue", { background: true });

			expect(agent.status).toBe("error");
			expect(agent.pendingQuestion).toBeUndefined();
		});
	});

	describe("the mid-run update channel", () => {
		const updatesOn = { defaultMaxTurns: undefined, wrapUpTurns: 5, midRunUpdates: true };

		it("gives a background child a way to send its parent an update", async () => {
			const { factory, params } = createFactory();
			const agent = createRunnableAgent({
				createSubagentSession: factory,
				isBackground: true,
				getRunConfig: () => updatesOn,
			});

			await agent.run();

			expect(params().notifyParent).toBeTypeOf("function");
		});

		it("reports a background child's update to the lifecycle observer", async () => {
			const { factory, notify } = createFactory();
			const onUpdateSent = vi.fn<(agent: Subagent, message: string) => void>();
			const agent = createRunnableAgent({
				createSubagentSession: factory,
				isBackground: true,
				observer: { onUpdateSent },
				getRunConfig: () => updatesOn,
			});
			await agent.run();

			notify("The bug is in the retry wrapper.");

			expect(onUpdateSent).toHaveBeenCalledWith(agent, "The bug is in the retry wrapper.");
		});

		it("gives a foreground child the same channel, since where its update lands is not its concern", async () => {
			const { factory, params } = createFactory();
			const agent = createRunnableAgent({
				createSubagentSession: factory,
				isBackground: false,
				getRunConfig: () => updatesOn,
			});

			await agent.run();

			expect(params().notifyParent).toBeTypeOf("function");
		});

		describe("routing by who holds the outcome", () => {
			it("holds an update for the carrier that claimed the run's outcome", async () => {
				const { factory, notify } = createFactory();
				const agent = createRunnableAgent({
					createSubagentSession: factory,
					getRunConfig: () => updatesOn,
				});
				await agent.run();
				agent.claim();

				notify("The bug is in the retry wrapper.");

				expect(agent.runUpdates).toEqual(["The bug is in the retry wrapper."]);
			});

			it("records the update for a carrier even when none has claimed the outcome", async () => {
				const { factory, notify } = createFactory();
				const agent = createRunnableAgent({
					createSubagentSession: factory,
					getRunConfig: () => updatesOn,
				});
				await agent.run();

				notify("The bug is in the retry wrapper.");

				// The announcement channel is what decides to announce, and it marks what
				// it delivers. Until then the run owes the message to a carrier.
				expect(agent.runUpdates).toEqual(["The bug is in the retry wrapper."]);
			});

			it("tells the observer either way, because the update is a fact about the run", async () => {
				const { factory, notify } = createFactory();
				const onUpdateSent = vi.fn<(agent: Subagent, message: string) => void>();
				const agent = createRunnableAgent({
					createSubagentSession: factory,
					observer: { onUpdateSent },
					getRunConfig: () => updatesOn,
				});
				await agent.run();
				agent.claim();

				notify("The bug is in the retry wrapper.");

				expect(onUpdateSent).toHaveBeenCalledWith(agent, "The bug is in the retry wrapper.");
			});

			it("keeps the channel live across a resume, whose parent is blocked awaiting it", async () => {
				const { factory, notify } = createFactory();
				const agent = createRunnableAgent({
					createSubagentSession: factory,
					getRunConfig: () => updatesOn,
				});
				await agent.run();
				await agent.resume("keep going", { background: false, claimOutcome: true });

				notify("The premise is wrong.");

				expect(agent.runUpdates).toEqual(["The premise is wrong."]);
			});
		});

		it("withholds the channel when the operator turned mid-run updates off", async () => {
			const { factory, params } = createFactory();
			const agent = createRunnableAgent({
				createSubagentSession: factory,
				isBackground: true,
				getRunConfig: () => ({ ...updatesOn, midRunUpdates: false }),
			});

			await agent.run();

			expect(params().notifyParent).toBeUndefined();
		});

		it("still gives a foreground child the ask-back recorder", async () => {
			const { factory, params } = createFactory();
			const agent = createRunnableAgent({ createSubagentSession: factory, isBackground: false });

			await agent.run();

			expect(params().askParent).toBeTypeOf("function");
		});
	});

	describe("start(): promise encapsulation", () => {
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

	describe("scheduleVia(): eager promise capture", () => {
		it("exposes the scheduler promise before the run starts (queued-awaitable)", async () => {
			const agent = makeSubagent({ status: "queued" });
			const { schedule, openSlot } = gatedScheduler();
			agent.scheduleVia(schedule);
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

	describe("waitUntilSettled()", () => {
		it("resolves immediately, unsettled, for an agent that has no run handle", async () => {
			const agent = makeSubagent({ status: "queued" });
			const run = await agent.waitUntilSettled(new AbortController().signal);
			expect([run.status, run.isActive()]).toEqual(["queued", true]);
		});

		it("resolves immediately for an agent that already left the active set", async () => {
			const agent = makeSubagent({ status: "completed", result: "done", startedAt: 1, completedAt: 2 });
			agent.start();
			await agent.promise;
			const run = await agent.waitUntilSettled(new AbortController().signal);
			expect([run.status, run.isActive()]).toEqual(["completed", false]);
		});

		it("spans the queue slot and the run that follows it", async () => {
			const agent = makeSubagent({ status: "queued" });
			const { schedule, openSlot } = gatedScheduler();
			agent.scheduleVia(schedule);

			const wait = agent.waitUntilSettled(new AbortController().signal);
			openSlot();

			const run = await wait;
			expect([run.status, run.isActive(), run.replaced]).toEqual(["completed", false, false]);
			expect(agent.status).toBe("completed");
		});

		it("ends the wait on interrupt without cancelling the agent", async () => {
			const agent = makeSubagent({ status: "queued" });
			const { schedule, openSlot } = gatedScheduler();
			agent.scheduleVia(schedule);
			const controller = new AbortController();

			const wait = agent.waitUntilSettled(controller.signal);
			controller.abort();
			expect((await wait).isActive()).toBe(true);

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

			expect((await agent.waitUntilSettled(AbortSignal.abort())).isActive()).toBe(true);

			expect(agent.status).toBe("queued");
		});

		it("reports the waited run's outcome when a resume replaced it before the wait returned", async () => {
			const stub = createSubagentSessionStub();
			const resumed = Promise.withResolvers<TurnLoopResult>();
			stub.runTurnLoop
				.mockResolvedValueOnce(turnLoopResult({ responseText: "first result" }))
				.mockReturnValueOnce(resumed.promise);
			const agent = makeSubagent({
				status: "running",
				execution: makeStubExecution({
					createSubagentSession: async () => toSubagentSession(stub),
					// Resumes the moment the run settles, before the waiter continues.
					observer: { onRunFinished: (a, kind) => { if (kind === "initial") void a.resume("continue", { background: true }); } },
				}),
			});
			agent.start();

			const run = await agent.waitUntilSettled(new AbortController().signal);

			expect([run.status, run.result, run.replaced]).toEqual(["completed", "first result", true]);
			expect(agent.status).toBe("running");
			resumed.resolve(turnLoopResult({ responseText: "second" }));
			await agent.promise;
		});

		it("reports the waited run's outcome even when two resumes replaced it", async () => {
			const stub = createSubagentSessionStub();
			const third = Promise.withResolvers<TurnLoopResult>();
			stub.runTurnLoop
				.mockResolvedValueOnce(turnLoopResult({ responseText: "first result" }))
				.mockResolvedValueOnce(turnLoopResult({ responseText: "second result" }))
				.mockReturnValueOnce(third.promise);
			const agent = makeSubagent({
				status: "running",
				execution: makeStubExecution({
					createSubagentSession: async () => toSubagentSession(stub),
					// Two resumes, each the moment the run before it settles.
					observer: { onRunFinished: (a) => { if (stub.runTurnLoop.mock.calls.length < 3) void a.resume("continue", { background: true }); } },
				}),
			});
			agent.start();

			const run = await agent.waitUntilSettled(new AbortController().signal);

			// The waiter holds the first run, whatever ran after it.
			expect(stub.runTurnLoop).toHaveBeenCalledTimes(3);
			expect([run.status, run.result, run.replaced, agent.status])
				.toEqual(["completed", "first result", true, "running"]);
			third.resolve(turnLoopResult({ responseText: "third" }));
			await agent.promise;
		});
	});

	describe("ask-back", () => {
		it("records a declared question and leaves the result body untouched", async () => {
			const { agent } = await runToOutcome({
				responseText: "I mapped the configs.",
				question: "Which one is authoritative?",
			});

			expect(agent.pendingQuestion).toBe("Which one is authoritative?");
			// The question never entered the body, so every carrier renders it once,
			// as the affordance.
			expect(agent.result).toBe("I mapped the configs.");
		});

		it("leaves pendingQuestion undefined when the child asked nothing", async () => {
			const { agent } = await runToOutcome({ responseText: "All done." });

			expect(agent.pendingQuestion).toBeUndefined();
			expect(agent.result).toBe("All done.");
		});

		it("records a question an aborted run declared before it ran out of turns", async () => {
			const { agent } = await runToOutcome({
				responseText: "",
				question: "Still stuck on which?",
				turnBudget: EXHAUSTED,
			});

			expect(agent.status).toBe("aborted");
			expect(agent.pendingQuestion).toBe("Still stuck on which?");
		});

		it("completes the round trip: ask, answer by resuming, continue", async () => {
			const { agent, stub } = await runToOutcome({ responseText: "", question: "Which config?" });
			stub.runTurnLoop.mockResolvedValue(turnLoopResult({ responseText: "Used the project config. Done." }));
			expect(agent.pendingQuestion).toBe("Which config?");

			await agent.resume("The project one.", { background: true });

			expect(stub.runTurnLoop).toHaveBeenLastCalledWith("The project one.", expect.objectContaining({ signal: expect.any(AbortSignal) }));
			expect(agent.status).toBe("completed");
			expect(agent.result).toBe("Used the project config. Done.");
			// The question was answered, so it no longer stands.
			expect(agent.pendingQuestion).toBeUndefined();
		});

		it("records a follow-up question a resumed run declares", async () => {
			const { agent, stub, ask } = await runToOutcome({ responseText: "", question: "Which config?" });
			stub.runTurnLoop.mockImplementation(() => {
				ask("And the fallback?");
				return Promise.resolve(turnLoopResult({ responseText: "Thanks." }));
			});

			await agent.resume("The project one.", { background: true });

			expect(agent.pendingQuestion).toBe("And the fallback?");
			expect(agent.result).toBe("Thanks.");
		});
	});

	describe("a signal that already fired", () => {
		function firedSignal(): AbortSignal {
			const controller = new AbortController();
			controller.abort();
			return controller.signal;
		}

		describe("run()", () => {
			it("stops before creating a session, reading stopped", async () => {
				const { factory, stub } = createFactory();
				const onRunStarted = vi.fn();
				const onRunFinished = vi.fn();
				const agent = createRunnableAgent({
					createSubagentSession: factory,
					signal: firedSignal(),
					observer: { onRunStarted, onRunFinished },
				});

				await agent.run();

				expect(factory).not.toHaveBeenCalled();
				expect(stub.runTurnLoop).not.toHaveBeenCalled();
				expect(agent.status).toBe("stopped");
				expect(agent.result).toBeUndefined();
				expect(agent.resumeRefusal).toBe("no-session");
				expect(onRunStarted).toHaveBeenCalledExactlyOnceWith(agent, "initial");
				expect(onRunFinished).toHaveBeenCalledExactlyOnceWith(agent, "initial");
			});

			it("stops before creating a session when the signal fires as the run starts", async () => {
				const { factory } = createFactory();
				const controller = new AbortController();
				const agent = createRunnableAgent({
					createSubagentSession: factory,
					signal: controller.signal,
					observer: { onRunStarted: () => { controller.abort(); } },
				});

				await agent.run();

				expect(factory).not.toHaveBeenCalled();
				expect(agent.status).toBe("stopped");
			});

			it("stops before preparing a workspace", async () => {
				const provider = makeWorkspaceProvider(makeWorkspace("/ws/dir"));
				const agent = createRunnableAgent({ signal: firedSignal(), workspaceProvider: provider });

				await agent.run();

				expect(provider.prepare).not.toHaveBeenCalled();
				expect(agent.status).toBe("stopped");
			});
		});

		describe("resume()", () => {
			it("hands the turn loop a fired lever and reads stopped", async () => {
				const onRunFinished = vi.fn();
				const { agent, stub } = createResumableAgent({ observer: { onRunFinished } });
				// A real loop handed a fired signal returns at once without a turn.
				let abortedAtEntry: boolean | undefined;
				stub.runTurnLoop.mockImplementation((_prompt: string, { signal }: { signal?: AbortSignal }) => {
					abortedAtEntry = signal?.aborted;
					return Promise.resolve(turnLoopResult({ responseText: "" }));
				});

				await agent.resume("continue", { background: true, signal: firedSignal() });

				expect(abortedAtEntry).toBe(true);
				expect(agent.status).toBe("stopped");
				expect(onRunFinished).toHaveBeenCalledExactlyOnceWith(agent, "resume");
			});
		});
	});

	// Every other rejection test here stubs runTurnLoop with a vi.fn, so it pins
	// how a throw is routed but nothing about what produces one. These wire a real
	// SubagentSession over a mock AgentSession so the provider-error read and the
	// failure routing are exercised as one path (#889).
	describe("provider failures reach the record", () => {
		/**
		 * Settle a turn the way the SDK does: append the assistant message to agent
		 * state and emit the `message_end` the session's listeners see.
		 *
		 * `usage` is mandatory rather than decorative — `subscribeSubagentObserver`,
		 * which a real Subagent wires over this session, reads `message.usage.input`
		 * unguarded. `Agent.handleRunFailure` gives its synthetic failure message
		 * `EMPTY_USAGE`, which is what these zeros model.
		 */
		function settleWith(session: ReturnType<typeof createMockSession>, message: Record<string, unknown>): void {
			session.messages.push(message);
			session.emit({
				type: "message_end",
				message: { usage: { input: 0, output: 0, cacheWrite: 0 }, ...message },
			});
		}

		/** A factory resolving to a real SubagentSession over the given mock session. */
		function realSessionFactory(session: ReturnType<typeof createMockSession>): SessionFactory {
			return vi.fn(async (_params: CreateSubagentSessionParams) =>
				new SubagentSession(toAgentSession(session), {
					outputFile: "/sessions/child.jsonl",
					sessionId: "child-1",
					sessionDir: "/sessions",
					agentName: "Explore",
					turnLimits: { wrapUpTurns: 2 },
					parentContext: undefined,
					lifecycle: createChildLifecycleMock(),
				}),
			);
		}

		it("lands the provider's error on the record instead of a successful empty result", async () => {
			const session = createMockSession();
			session.prompt = vi.fn(async () => {
				settleWith(session, {
					role: "assistant",
					content: [{ type: "text", text: "" }],
					stopReason: "error",
					errorMessage: "429 rate limit exceeded",
				});
			});
			const agent = createRunnableAgent({ createSubagentSession: realSessionFactory(session) });

			await agent.run();

			expect(agent.status).toBe("error");
			expect(agent.error).toBe("429 rate limit exceeded");
			expect(agent.result).toBeUndefined();
		});

		it("completes normally when the provider did not error", async () => {
			const session = createMockSession();
			session.prompt = vi.fn(async () => {
				settleWith(session, {
					role: "assistant",
					content: [{ type: "text", text: "the answer" }],
					stopReason: "stop",
				});
			});
			const agent = createRunnableAgent({ createSubagentSession: realSessionFactory(session) });

			await agent.run();

			expect(agent.status).toBe("completed");
			expect(agent.result).toBe("the answer");
			expect(agent.error).toBeUndefined();
		});

		// Pi's overflow recovery removes the failed assistant message from agent state
		// before attempting compaction and restores nothing when that attempt fails, so
		// the record must be driven by what the session emitted, not by what survived
		// in its history (#898).
		it("lands the provider's error even when overflow recovery stripped the errored turn", async () => {
			const session = createMockSession();
			session.messages.push({
				role: "assistant",
				content: [{ type: "text", text: "work from an earlier turn" }],
				stopReason: "stop",
			});
			session.prompt = vi.fn(async () => {
				session.emit({
					type: "message_end",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "" }],
						stopReason: "error",
						errorMessage: "prompt is too long: 210000 tokens > 200000 maximum",
						usage: { input: 0, output: 0, cacheWrite: 0 },
					},
				});
			});
			const agent = createRunnableAgent({ createSubagentSession: realSessionFactory(session) });

			await agent.run();

			expect(agent.status).toBe("error");
			expect(agent.error).toBe("prompt is too long: 210000 tokens > 200000 maximum");
			expect(agent.result).toBeUndefined();
		});

		// The resume half of the same path: a run that succeeded, then a resume whose
		// provider errored. Without the resumed loop's read the record would be marked
		// completed carrying "the first answer" — the previous turn's work, presented
		// as the answer to the resume prompt.
		it("lands a resume's provider error on the record instead of the prior answer", async () => {
			const session = createMockSession();
			session.prompt = vi
				.fn(async () => {
					settleWith(session, {
						role: "assistant",
						content: [{ type: "text", text: "the first answer" }],
						stopReason: "stop",
					});
				})
				.mockImplementationOnce(async () => {
					settleWith(session, {
						role: "assistant",
						content: [{ type: "text", text: "the first answer" }],
						stopReason: "stop",
					});
				})
				.mockImplementationOnce(async () => {
					settleWith(session, {
						role: "assistant",
						content: [{ type: "text", text: "" }],
						stopReason: "error",
						errorMessage: "503 upstream unavailable",
					});
				});
			const agent = createRunnableAgent({ createSubagentSession: realSessionFactory(session) });

			await agent.run();
			expect(agent.status).toBe("completed");

			await agent.resume("and now the other half", { background: true });

			expect(agent.status).toBe("error");
			expect(agent.error).toBe("503 upstream unavailable");
			expect(agent.result).toBeUndefined();
		});
	});

	describe("the initial run", () => {
		describe("settling", () => {
			it("transitions to completed for a normal result", async () => {
				const { agent: record } = await runToOutcome({});
				expect(record.status).toBe("completed");
				expect(record.result).toBe("done");
			});

			it("transitions to aborted, a terminal error, when the harness exhausted the turn budget", async () => {
				const { agent: record } = await runToOutcome({ turnBudget: EXHAUSTED });
				expect(record.status).toBe("aborted");
				expect(record.isTerminalError()).toBe(true);
			});

			it("transitions to completed, not a terminal error, when the run wrapped up at its turn limit", async () => {
				const { agent: record } = await runToOutcome({ turnBudget: WARNED });
				expect(record.status).toBe("completed");
				expect(record.isTerminalError()).toBe(false);
			});

			it("fires observer.onRunFinished on completion", async () => {
				const onRunFinished = vi.fn();
				const { agent: record } = await runToOutcome({ observer: { onRunFinished } });
				expect(onRunFinished).toHaveBeenCalledExactlyOnceWith(record, "initial");
			});
		});

		describe("failing", () => {
			it("transitions to error state", async () => {
				const { agent: record } = await runToOutcome({ error: new Error("boom") });
				expect(record.status).toBe("error");
				expect(record.error).toBe("boom");
			});

			it("fires observer.onRunFinished on failure", async () => {
				const onRunFinished = vi.fn();
				const { agent: record } = await runToOutcome({ error: new Error("boom"), observer: { onRunFinished } });
				expect(onRunFinished).toHaveBeenCalledExactlyOnceWith(record, "initial");
			});
		});

		describe("happy path", () => {
			it("transitions through running → completed", async () => {
				const agent = createRunnableAgent();
				await agent.run();
				expect(agent.status).toBe("completed");
				expect(agent.result).toBe("done");
			});

			it("fires observer callbacks in order: onRunStarted → onSessionCreated → onRunFinished", async () => {
				const callOrder: string[] = [];
				const observer: SubagentLifecycleObserver = {
					onRunStarted: () => callOrder.push("started"),
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

			it("releases the observer subscription after the run completes", async () => {
				const session = createMockSession();
				const stub = createSubagentSessionStub(session);
				stub.runTurnLoop.mockImplementation(async () => {
					session.emit({ type: "tool_execution_end" });
					return turnLoopResult({ responseText: "done" });
				});
				const agent = createRunnableAgent({ createSubagentSession: async () => toSubagentSession(stub) });
				await agent.run();
				expect(agent.toolUses).toBe(1);

				// Events emitted after the run must not accumulate: the subscription is released.
				session.emit({ type: "tool_execution_end" });
				expect(agent.toolUses).toBe(1);
			});

			it("flushes pending steers when session is created", async () => {
				// A steer arriving while the agent is running but the session is not yet
				// ready buffers; run() flushes it once the session is created.
				const agent = createRunnableAgent({ status: "running" });
				void agent.steer("hurry up");
				expect(agent.pendingSteerCount).toBe(1);
				await agent.run();
				expect(agent.pendingSteerCount).toBe(0);
			});
		});

		describe("workspace provider", () => {
			it("prepares the workspace and threads its cwd into the factory params", async () => {
				const { factory, params } = createFactory();
				const provider = makeWorkspaceProvider(makeWorkspace("/ws/dir"));
				const agent = createRunnableAgent({ createSubagentSession: factory, workspaceProvider: provider });
				await agent.run();
				expect(params().cwd).toBe("/ws/dir");
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
				const { factory, params } = createFactory();
				const provider = makeWorkspaceProvider(undefined);
				const agent = createRunnableAgent({ createSubagentSession: factory, workspaceProvider: provider });
				await agent.run();
				expect(params().cwd).toBeUndefined();
				expect(agent.status).toBe("completed");
			});

			it("marks error and fires onRunFinished when prepare rejects", async () => {
				const onRunFinished = vi.fn();
				const provider: WorkspaceProvider = { prepare: vi.fn(() => Promise.reject(new Error("prepare failed"))) };
				const agent = createRunnableAgent({ workspaceProvider: provider, observer: { onRunFinished } });
				await agent.run();
				expect(agent.status).toBe("error");
				expect(agent.error).toBe("prepare failed");
				expect(onRunFinished).toHaveBeenCalledExactlyOnceWith(agent, "initial");
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

		describe("workspace hold for a declared question", () => {
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
					turnBudget: EXHAUSTED,
				});
				expect(workspace.dispose).toHaveBeenCalledWith({ status: "aborted", description: "run test" });
				expect(agent.pendingQuestion).toBe("Still stuck?");
				expect(agent.result).toBe(ADDENDUM);
			});

			// A child warned it is running out of turns can still finish with a question,
			// and a resume gets a fresh budget to act on the answer.
			it("holds the workspace when a run wrapped up at its turn limit and declared a question", async () => {
				const { agent, workspace } = await runWithWorkspace({
					responseText: "Partway.",
					question: "Which one?",
					turnBudget: WARNED,
				});
				expect(agent.status).toBe("completed");
				expect(workspace.dispose).not.toHaveBeenCalled();
				expect(agent.workspaceDisposed).toBe(false);
				expect(agent.resumeRefusal).toBeUndefined();
				expect(agent.result).toBe("Partway.");
			});

			it("holds the workspace when a resumed run wrapped up at its turn limit and declared another question", async () => {
				const { agent, workspace, stub, ask } = await heldWorkspaceAgent();
				stub.runTurnLoop.mockImplementation(() => {
					ask("And the fallback?");
					return Promise.resolve(turnLoopResult({ responseText: "Partway.", turnBudget: WARNED }));
				});

				await agent.resume("The project one.", { background: true });

				expect(agent.status).toBe("completed");
				expect(workspace.dispose).not.toHaveBeenCalled();
				expect(agent.resumeRefusal).toBeUndefined();
				expect(agent.result).toBe("Partway.");
			});
		});

		describe("error handling", () => {
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

		describe("abort signal forwarding", () => {
			it("wires parent signal so aborting it stops the agent", async () => {
				const parentController = new AbortController();
				const { factory, stub } = createFactory();
				let loopSignal: AbortSignal | undefined;
				stub.runTurnLoop.mockImplementation((_prompt: string, opts: TurnLoopOptions) => {
					loopSignal = opts.signal;
					parentController.abort();
					return Promise.reject(new Error("aborted"));
				});
				const agent = createRunnableAgent({ createSubagentSession: factory, signal: parentController.signal });
				await agent.run();
				expect(loopSignal?.aborted).toBe(true);
				expect(agent.status).toBe("stopped");
			});
		});

		describe("live turn budget", () => {
			it("shows the budget the turn loop reports while the run is still going", async () => {
				const { factory, stub } = createFactory();
				const gate = Promise.withResolvers<TurnLoopResult>();
				stub.runTurnLoop.mockImplementation((_prompt: string, opts: TurnLoopOptions) => {
					opts.onTurnBudget?.(WARNED);
					return gate.promise;
				});
				const agent = createRunnableAgent({ createSubagentSession: factory });
				const run = agent.run();
				await vi.waitFor(() => expect(stub.runTurnLoop).toHaveBeenCalled());
				expect(agent.status).toBe("running");
				expect(agent.turnBudget).toEqual(WARNED);
				gate.resolve(turnLoopResult({ turnBudget: WARNED }));
				await run;
				expect(agent.turnBudget).toEqual(WARNED);
			});
		});

		describe("RunConfig threading", () => {
			it("hands the session factory the spawn's maxTurns with the run config's defaultMaxTurns and wrapUpTurns", async () => {
				const { factory, params } = createFactory();
				const agent = createRunnableAgent({
					createSubagentSession: factory,
					maxTurns: 6,
					getRunConfig: () => ({ defaultMaxTurns: 10, wrapUpTurns: 3, midRunUpdates: true }),
				});
				await agent.run();
				expect(params().turnLimits).toStrictEqual({ maxTurns: 6, defaultMaxTurns: 10, wrapUpTurns: 3 });
			});
		});
	});

	describe("a run's mode", () => {
		it.for([true, false])("a record with no run yet reads the spawn's mode (background: %s)", (isBackground) => {
			expect(makeSubagent({ isBackground }).isBackground).toBe(isBackground);
		});

		it.for([true, false])("the initial run takes the spawn's mode (background: %s)", async (isBackground) => {
			const agent = createRunnableAgent({ isBackground });
			await agent.run();
			expect(agent.isBackground).toBe(isBackground);
		});

		it.for([
			{ spawned: "foreground", background: true },
			{ spawned: "background", background: false },
		])(
			"a resume of an agent spawned in the $spawned takes the mode it starts with (background: $background)",
			async ({ background }) => {
				const { agent, stub } = createResumableAgent({ isBackground: !background });
				const turnLoop = Promise.withResolvers<TurnLoopResult>();
				stub.runTurnLoop.mockReturnValue(turnLoop.promise);

				const resumed = agent.resume("continue", { background });
				expect(agent.isBackground).toBe(background);

				turnLoop.resolve(turnLoopResult({ responseText: "done" }));
				await resumed;
				expect(agent.status).toBe("completed");
				expect(agent.isBackground).toBe(background);
			},
		);
	});

	describe("a run's start", () => {
		it("counts as progress for the initial run", () => {
			const agent = createRunnableAgent({ createSubagentSession: () => new Promise<never>(() => {}) });
			const now = vi.spyOn(Date, "now").mockReturnValue(5000);

			void agent.run();

			now.mockRestore();
			expect([agent.status, agent.startedAt, agent.lastProgressAt]).toEqual(["running", 5000, 5000]);
		});

		it("counts as progress for a resume", () => {
			const { agent, stub } = createResumableAgent();
			const loop = Promise.withResolvers<TurnLoopResult>();
			stub.runTurnLoop.mockReturnValue(loop.promise);
			const now = vi.spyOn(Date, "now").mockReturnValue(5000);

			void agent.resume("continue", { background: true });

			now.mockRestore();
			expect([agent.status, agent.startedAt, agent.lastProgressAt]).toEqual(["running", 5000, 5000]);
			loop.resolve(turnLoopResult({ responseText: "second" }));
		});

		it("leaves a late completion of an aborted run on that run, not on the resume that replaced it", async () => {
			const { factory, stub } = createFactory();
			// The first loop ignores its lever and returns only once released, after the
			// resume has started; the resume's loop stays in flight.
			const first = Promise.withResolvers<TurnLoopResult>();
			const second = Promise.withResolvers<TurnLoopResult>();
			stub.runTurnLoop.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
			const agent = createRunnableAgent({ createSubagentSession: factory });
			const initial = agent.run();
			await vi.waitFor(() => expect(stub.runTurnLoop).toHaveBeenCalledOnce());
			agent.abort();
			void agent.resume("continue", { background: true });

			first.resolve(turnLoopResult({ responseText: "late answer" }));
			await initial;

			expect([agent.status, agent.result]).toEqual(["running", undefined]);
			second.resolve(turnLoopResult({ responseText: "resumed answer" }));
			await agent.promise;
		});
	});

	describe("a resume", () => {
		describe("delivery", () => {
			it("starts unconsumed after the parent collected the run before it", async () => {
				const { agent } = createResumableAgent();
				agent.markConsumed(5000);

				await agent.resume("continue", { background: true });

				expect([agent.consumed, agent.consumedAt]).toEqual([false, undefined]);
			});

			it("starts with no updates owed, whatever the run before it still owed", async () => {
				const { factory, notify } = createFactory();
				// No run config: the update channel defaults to on.
				const agent = createRunnableAgent({ createSubagentSession: factory });
				await agent.run();
				notify("From the first run.");
				expect(agent.runUpdates).toEqual(["From the first run."]);

				await agent.resume("continue", { background: true });

				expect(agent.runUpdates).toEqual([]);
			});

			it("a claim on a settled run does not claim the resume that follows it", async () => {
				const { agent } = createResumableAgent();
				agent.claim();

				await agent.resume("continue", { background: true });

				expect(agent.claimed).toBe(false);
			});

			it("is born claimed when its caller carries the outcome", () => {
				const { agent, stub } = createResumableAgent();
				const loop = Promise.withResolvers<TurnLoopResult>();
				stub.runTurnLoop.mockReturnValue(loop.promise);

				void agent.resume("continue", { background: false, claimOutcome: true });

				expect(agent.claimed).toBe(true);
				loop.resolve(turnLoopResult({ responseText: "second" }));
			});
		});

		describe("admission", () => {
			it("waits as the resume's own queued run until admitted", async () => {
				const started: RunKind[] = [];
				const { agent, stub } = createResumableAgent({
					isBackground: false,
					observer: { onRunStarted: (_agent, kind) => { started.push(kind); } },
				});
				stub.runTurnLoop.mockResolvedValue(turnLoopResult({ responseText: "second" }));
				const { schedule, openSlot } = gatedScheduler();

				void agent.resume("continue", { background: true }, schedule);

				expect([agent.status, agent.isBackground]).toEqual(["queued", true]);
				expect(agent.promise).toBeInstanceOf(Promise);
				expect(stub.runTurnLoop).not.toHaveBeenCalled();
				expect(started).toEqual([]);

				openSlot();
				await agent.promise;

				expect([agent.status, agent.result]).toEqual(["completed", "second"]);
				expect(stub.runTurnLoop).toHaveBeenCalledExactlyOnceWith("continue", expect.anything());
				expect(started).toEqual(["resume"]);
			});

			it("is born claimed while it waits, when the caller claims it", async () => {
				const { agent } = createResumableAgent();
				const { schedule, openSlot } = gatedScheduler();

				void agent.resume("continue", { background: true, claimOutcome: true }, schedule);

				expect([agent.status, agent.claimed]).toEqual(["queued", true]);
				openSlot();
				await agent.promise;
			});

			it("never runs a resume stopped before its slot opened", async () => {
				const { agent, stub } = createResumableAgent();
				const { schedule, openSlot } = gatedScheduler();
				void agent.resume("continue", { background: true }, schedule);

				agent.stopQueued();
				openSlot();
				await agent.promise;

				expect(stub.runTurnLoop).not.toHaveBeenCalled();
				expect(agent.status).toBe("stopped");
			});

			it("runs only the resume that replaced a stopped one", async () => {
				const { agent, stub } = createResumableAgent();
				const secondLoop = Promise.withResolvers<TurnLoopResult>();
				stub.runTurnLoop.mockReturnValue(secondLoop.promise);
				const first = gatedScheduler();
				const firstQueued = agent.resume("first answer", { background: true }, first.schedule);
				agent.stopQueued();

				// The first resume's slot opens while the second is still running, so the
				// record is active again when the stale thunk is admitted.
				const second = agent.resume("second answer", { background: true });
				first.openSlot();
				secondLoop.resolve(turnLoopResult({ responseText: "second answer done" }));
				await Promise.all([firstQueued, second]);

				expect(stub.runTurnLoop).toHaveBeenCalledExactlyOnceWith("second answer", expect.anything());
				expect([agent.status, agent.result]).toEqual(["completed", "second answer done"]);
			});
		});

		describe("disposing a held workspace", () => {
			it("disposes when the resumed child answers without asking again", async () => {
				const { agent, workspace, stub } = await heldWorkspaceAgent();
				stub.runTurnLoop.mockResolvedValue(turnLoopResult({ responseText: "Used the project config. Done." }));

				await agent.resume("The project one.", { background: true });

				expect(workspace.dispose).toHaveBeenCalledWith({ status: "completed", description: "run test" });
				expect(agent.result).toBe(`Used the project config. Done.${ADDENDUM}`);
			});

			it("keeps holding when the resumed child declares another question", async () => {
				const { agent, workspace, stub, ask } = await heldWorkspaceAgent();
				stub.runTurnLoop.mockImplementation(() => {
					ask("And the fallback?");
					return Promise.resolve(turnLoopResult({ responseText: "Thanks." }));
				});

				await agent.resume("The project one.", { background: true });

				expect(workspace.dispose).not.toHaveBeenCalled();
				expect(agent.pendingQuestion).toBe("And the fallback?");
			});

			it("disposes as aborted when the resumed child asks again but exhausts its budget", async () => {
				const { agent, workspace, stub, ask } = await heldWorkspaceAgent();
				stub.runTurnLoop.mockImplementation(() => {
					ask("And the fallback?");
					return Promise.resolve(turnLoopResult({ responseText: "Partway.", turnBudget: EXHAUSTED }));
				});

				await agent.resume("The project one.", { background: true });

				expect(agent.status).toBe("aborted");
				expect(workspace.dispose).toHaveBeenCalledWith({ status: "aborted", description: "run test" });
				expect(agent.result).toBe(`Partway.${ADDENDUM}`);
			});

			it("disposes best-effort when the resume throws", async () => {
				const { agent, workspace, stub } = await heldWorkspaceAgent();
				stub.runTurnLoop.mockRejectedValue(new Error("resume exploded"));

				await expect(agent.resume("The project one.", { background: true })).resolves.toBeUndefined();

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

				turnLoop.resolve(turnLoopResult({ responseText: "done" }));
				await agent.promise;
			});

			it("disposes a held workspace only once across release and teardown", async () => {
				const { agent, workspace } = await heldWorkspaceAgent();
				await agent.releaseSession();
				await agent.disposeSession();
				expect(workspace.dispose).toHaveBeenCalledOnce();
			});
		});

		describe("happy path", () => {
			it("transitions to completed and sets result from the resume response", async () => {
				const { agent, stub } = createResumableAgent();
				stub.runTurnLoop.mockResolvedValue(turnLoopResult({ responseText: "resumed" }));
				await agent.resume("continue", { background: true });
				expect(agent.status).toBe("completed");
				expect(agent.result).toBe("resumed");
			});

			it("hands the resumed turn loop the record's own signal, not the caller's", async () => {
				const { agent, stub } = createResumableAgent();
				const callerSignal = new AbortController().signal;
				let loopSignal: AbortSignal | undefined;
				stub.runTurnLoop.mockImplementation((_prompt: string, { signal }: { signal?: AbortSignal }) => {
					loopSignal = signal;
					return Promise.resolve(turnLoopResult({ responseText: "resumed" }));
				});
				await agent.resume("continue", { background: true, signal: callerSignal });
				expect(stub.runTurnLoop).toHaveBeenCalledExactlyOnceWith("continue", expect.objectContaining({ signal: expect.any(AbortSignal) }));
				// The caller's signal is wired through abort(); the loop runs under the
				// record's own lever, so abort(id) reaches it too.
				expect(loopSignal).not.toBe(callerSignal);
			});

			it("resets transition state before resuming", async () => {
				const { agent } = createResumableAgent();
				await agent.resume("continue", { background: true });
				expect(agent.error).toBeUndefined();
			});
		});

		describe("turn budget", () => {
			it("shows the budget the resumed turn loop reports while the resume is going", async () => {
				const { agent, stub } = createResumableAgent();
				const fresh: TurnBudget = { maxTurns: 5, used: 0, phase: "within" };
				const gate = Promise.withResolvers<TurnLoopResult>();
				stub.runTurnLoop.mockImplementation((_prompt: string, { onTurnBudget }: { onTurnBudget?: (budget: TurnBudget) => void }) => {
					onTurnBudget?.(fresh);
					return gate.promise;
				});
				const resumed = agent.resume("continue", { background: true });
				await vi.waitFor(() => expect(stub.runTurnLoop).toHaveBeenCalled());
				expect(agent.turnBudget).toEqual(fresh);
				gate.resolve(turnLoopResult({ turnBudget: fresh }));
				await resumed;
			});

			it("ends aborted, and notifies the observer, when the resume exhausts its budget", async () => {
				const onRunFinished = vi.fn();
				const { agent, stub } = createResumableAgent({ observer: { onRunFinished } });
				stub.runTurnLoop.mockResolvedValue(turnLoopResult({ responseText: "partial", turnBudget: EXHAUSTED }));
				await agent.resume("continue", { background: true });
				expect(agent.status).toBe("aborted");
				expect(agent.result).toBe("partial");
				expect(onRunFinished).toHaveBeenCalledExactlyOnceWith(agent, "resume");
			});
		});

		describe("cancellation", () => {
			it("aborting the record signals the resumed turn loop", async () => {
				const { agent, stub } = createResumableAgent();
				const loop = parkLoopUntilSignalled(stub.runTurnLoop);

				const resumed = agent.resume("continue", { background: true });
				expect(agent.abort()).toBe(true);
				await resumed;

				expect(loop.abortedAtEntry).toBe(false);
				expect(loop.signalled).toBe(true);
				expect(agent.status).toBe("stopped");
			});

			it("a caller signal cancels through the record, which reads stopped", async () => {
				const { agent, stub } = createResumableAgent();
				const loop = parkLoopUntilSignalled(stub.runTurnLoop);
				const caller = new AbortController();

				const resumed = agent.resume("continue", { background: true, signal: caller.signal });
				caller.abort();
				await resumed;

				expect(loop.signalled).toBe(true);
				expect(agent.status).toBe("stopped");
			});

			it("gives a resume that follows an aborted run a lever that is not already spent", async () => {
				const { factory, stub } = createFactory();
				const first = parkLoopUntilSignalled(stub.runTurnLoop);
				const agent = createRunnableAgent({ createSubagentSession: factory });
				const run = agent.run();
				await vi.waitFor(() => expect(stub.runTurnLoop).toHaveBeenCalled());
				agent.abort();
				await run;
				expect(first.signal?.aborted).toBe(true);
				const loop = parkLoopUntilSignalled(stub.runTurnLoop);

				const resumed = agent.resume("continue", { background: true });
				expect(agent.abort()).toBe(true);
				await resumed;

				expect(loop.signal).not.toBe(first.signal);
				expect(loop.abortedAtEntry).toBe(false);
				expect(loop.signalled).toBe(true);
			});
		});

		describe("observer lifecycle", () => {
			it("accumulates usage and compactions from session events during resume", async () => {
				const session = createMockSession();
				const stub = createSubagentSessionStub(session);
				stub.runTurnLoop.mockImplementation(async () => {
					emitResumeUsageAndCompaction(session);
					return turnLoopResult({ responseText: "second" });
				});
				const { agent } = createResumableAgent({ session, stub });
				await agent.resume("more", { background: true });
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
				stub.runTurnLoop.mockImplementation(async () => {
					session.emit({ type: "compaction_end", aborted: false, result: { tokensBefore: 123 }, reason: "threshold" });
					return turnLoopResult({ responseText: "second" });
				});
				const { agent } = createResumableAgent({ observer, session, stub });
				await agent.resume("more", { background: true });
				expect(seen).toEqual([{ reason: "threshold", tokensBefore: 123 }]);
			});

			it("releases the observer subscription after resume completes", async () => {
				const session = createMockSession();
				const { agent } = createResumableAgent({ session });
				await agent.resume("more", { background: true });
				// Events emitted after resume must not accumulate — subscription released.
				session.emit({ type: "tool_execution_end" });
				expect(agent.toolUses).toBe(0);
			});

			it("fires observer.onRunStarted once the resumed run is under way", async () => {
				const seen: Array<{ status: string; completedAt: number | undefined }> = [];
				const onRunStarted = (agent: Subagent) =>
					seen.push({ status: agent.status, completedAt: agent.completedAt });
				const { agent } = createResumableAgent({ observer: { onRunStarted } });

				await agent.resume("continue", { background: true });

				// After the rewind, not before it: a subscriber reading the record must see
				// the run that just started, not the outcome of the one it replaced.
				expect(seen).toEqual([{ status: "running", completedAt: undefined }]);
				expect(agent.status).toBe("completed");
			});

			// The resume door claims the outcome before calling resume(), and a waiter
			// reads the record the moment it returns: both rely on the resume being
			// under way by then, not on a later turn.
			it("is under way by the time resume() returns", async () => {
				const onRunStarted = vi.fn();
				const { agent, stub } = createResumableAgent({ observer: { onRunStarted } });
				const gate = Promise.withResolvers<TurnLoopResult>();
				stub.runTurnLoop.mockReturnValue(gate.promise);

				const resumed = agent.resume("continue", { background: true });

				expect(agent.status).toBe("running");
				expect(onRunStarted).toHaveBeenCalledExactlyOnceWith(agent, "resume");
				expect(stub.runTurnLoop).toHaveBeenCalledOnce();
				gate.resolve(turnLoopResult({ responseText: "resumed" }));
				await resumed;
			});

			it("fires observer.onRunStarted even when the resumed run fails", async () => {
				const onRunStarted = vi.fn();
				const stub = createSubagentSessionStub();
				stub.runTurnLoop.mockRejectedValue(new Error("resume exploded"));
				const { agent } = createResumableAgent({ observer: { onRunStarted }, stub });

				await agent.resume("continue", { background: true });

				expect(onRunStarted).toHaveBeenCalledExactlyOnceWith(agent, "resume");
			});

			it("fires observer.onRunFinished once the resume completes", async () => {
				const onRunFinished = vi.fn();
				const { agent } = createResumableAgent({ observer: { onRunFinished } });
				await agent.resume("continue", { background: true });
				expect(onRunFinished).toHaveBeenCalledExactlyOnceWith(agent, "resume");
				expect(agent.status).toBe("completed");
			});

			it("fires observer.onRunFinished when the resume errors", async () => {
				const onRunFinished = vi.fn();
				const stub = createSubagentSessionStub();
				stub.runTurnLoop.mockRejectedValue(new Error("resume exploded"));
				const { agent } = createResumableAgent({ observer: { onRunFinished }, stub });
				await agent.resume("continue", { background: true });
				expect(onRunFinished).toHaveBeenCalledExactlyOnceWith(agent, "resume");
				expect(agent.status).toBe("error");
			});
		});

		describe("error handling", () => {
			it("transitions to error without throwing when the resumed turn loop rejects", async () => {
				const stub = createSubagentSessionStub();
				stub.runTurnLoop.mockRejectedValue(new Error("resume exploded"));
				const { agent } = createResumableAgent({ stub });
				await agent.resume("more", { background: true });
				expect(agent.status).toBe("error");
				expect(agent.error).toBe("resume exploded");
			});

			it("releases the observer subscription after resume errors", async () => {
				const session = createMockSession();
				const stub = createSubagentSessionStub(session);
				stub.runTurnLoop.mockRejectedValue(new Error("boom"));
				const { agent } = createResumableAgent({ session, stub });
				await agent.resume("more", { background: true });
				session.emit({ type: "tool_execution_end" });
				expect(agent.toolUses).toBe(0);
			});

			it("throws when no session exists", async () => {
				const agent = makeSubagent();
				await expect(agent.resume("more", { background: true })).rejects.toThrow(/missing session/);
			});
		});

		describe("awaitable handle", () => {
			it("republishes the promise getter for the in-flight resume", async () => {
				const { agent, stub } = createResumableAgent();
				agent.start();
				const firstRun = agent.promise;
				await firstRun;
				const { promise: resuming, resolve: finishResume } = Promise.withResolvers<TurnLoopResult>();
				stub.runTurnLoop.mockReturnValue(resuming);

				const returned = agent.resume("continue", { background: true });

				// The getter must track the live resume, not the settled first-run handle.
				expect(agent.promise).not.toBe(firstRun);
				expect(agent.promise).toBe(returned);

				finishResume(turnLoopResult({ responseText: "resumed late" }));
				await returned;
				expect(agent.status).toBe("completed");
				expect(agent.result).toBe("resumed late");
			});
		});
	});

	describe.each(RUN_KIND_DRIVERS)("the $kind run's terminal rules", ({ kind, runToOutcome: run }) => {
		it("disposes the workspace of a completed run that asked nothing, folding in the addendum", async () => {
			const { agent, workspace } = await run({ responseText: "Done." });
			expect(agent.status).toBe("completed");
			expect(workspace.dispose).toHaveBeenCalledExactlyOnceWith({ status: "completed", description: "run test" });
			expect(agent.result).toBe(`Done.${ADDENDUM}`);
		});

		it("holds the workspace of a completed run that declared a question", async () => {
			const { agent, workspace } = await run({ responseText: "Partway.", question: "And the fallback?" });
			expect(agent.status).toBe("completed");
			expect(workspace.dispose).not.toHaveBeenCalled();
			expect(agent.pendingQuestion).toBe("And the fallback?");
			expect(agent.resumeRefusal).toBeUndefined();
			expect(agent.result).toBe("Partway.");
		});

		it("holds the workspace of a run that wrapped up at its turn limit and declared a question", async () => {
			const { agent, workspace } = await run({ responseText: "Partway.", question: "And the fallback?", turnBudget: WARNED });
			expect(agent.status).toBe("completed");
			expect(workspace.dispose).not.toHaveBeenCalled();
			expect(agent.resumeRefusal).toBeUndefined();
			expect(agent.result).toBe("Partway.");
		});

		it("disposes as aborted when the run exhausted its budget, keeping the question", async () => {
			const { agent, workspace } = await run({ responseText: "Partway.", question: "And the fallback?", turnBudget: EXHAUSTED });
			expect(agent.status).toBe("aborted");
			expect(workspace.dispose).toHaveBeenCalledExactlyOnceWith({ status: "aborted", description: "run test" });
			expect(agent.pendingQuestion).toBe("And the fallback?");
			expect(agent.result).toBe(`Partway.${ADDENDUM}`);
		});

		it("disposes as error when the run failed, dropping the question", async () => {
			const { agent, workspace } = await run({ question: "And the fallback?", error: new Error("boom") });
			expect(agent.status).toBe("error");
			expect(workspace.dispose).toHaveBeenCalledExactlyOnceWith({ status: "error", description: "run test" });
			expect(agent.pendingQuestion).toBeUndefined();
			expect(agent.workspaceNotice).toBe(ADDENDUM);
		});

		it("tells the observer the run finished, with its kind", async () => {
			const onRunFinished = vi.fn();
			const { agent } = await run({ responseText: "Done.", observer: { onRunFinished } });
			expect(onRunFinished).toHaveBeenLastCalledWith(agent, kind);
		});
	});
});
