import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ForegroundParams, runForeground } from "#src/tools/foreground-runner";
import type { Subagent } from "#src/types";
import { createToolDeps } from "#test/helpers/make-deps";
import { makeModel } from "#test/helpers/make-model";
import { createResolvedSpawnConfig } from "#test/helpers/make-spawn-config";
import { createTestSubagent, makeStubExecution } from "#test/helpers/make-subagent";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";
import { textOf } from "#test/helpers/text-of";

function makeParams(overrides: Partial<ForegroundParams> = {}): ForegroundParams {
	return {
		config: createResolvedSpawnConfig({ description: "fg task" }),
		snapshot: STUB_SNAPSHOT,
		parentSession: { parentSessionFile: "/sessions/parent.jsonl", parentSessionId: "session-1" },
		...overrides,
	};
}

describe("runForeground", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns completion message with tool use count on success", async () => {
		const { manager } = createToolDeps();
		const result = await runForeground(manager, makeParams(), undefined, undefined);
		expect(textOf(result)).toContain("Agent completed");
		expect(textOf(result)).toContain("3 tool uses");
		expect(textOf(result)).toContain("All done.");
	});

	it("surfaces a declared question as answerable, naming the resume call", async () => {
		const { manager } = createToolDeps();
		manager.spawnAndWait = vi
			.fn()
			.mockResolvedValue(
				createTestSubagent({
					id: "agent-5",
					result: "Mapped them.",
					pendingQuestion: "Which config?",
					sessionReady: true,
				}),
			);

		const result = await runForeground(manager, makeParams(), undefined, undefined);

		expect(textOf(result)).toContain("This agent is waiting on an answer:");
		expect(textOf(result)).toContain("Which config?");
		expect(textOf(result)).toContain('resume: "agent-5"');
	});

	it("reports a question a released session cannot answer, without naming a resume", async () => {
		const { manager } = createToolDeps();
		const released = createTestSubagent({
			id: "agent-5",
			result: "Mapped them.",
			pendingQuestion: "Which config?",
			sessionReady: true,
		});
		await released.releaseSession();
		manager.spawnAndWait = vi.fn().mockResolvedValue(released);

		const result = await runForeground(manager, makeParams(), undefined, undefined);

		expect(textOf(result)).toContain("Which config?");
		expect(textOf(result)).toContain(
			"its session was released after its retention window",
		);
		expect(textOf(result)).not.toContain("resume:");
	});

	it("adds no affordance when the agent asked nothing", async () => {
		const { manager } = createToolDeps();
		const result = await runForeground(manager, makeParams(), undefined, undefined);
		expect(textOf(result)).not.toContain("waiting on an answer");
	});

	it("names where a teardown saved the work of an agent that completed", async () => {
		const { manager } = createToolDeps();
		manager.spawnAndWait = vi.fn().mockResolvedValue(
			createTestSubagent({ workspaceNotice: "\n\n---\nChanges saved to branch `pi-agent-5`." }),
		);

		const result = await runForeground(manager, makeParams(), undefined, undefined);

		expect(textOf(result)).toContain("Changes saved to branch `pi-agent-5`.");
	});

	it("reports the updates the agent sent while the parent was blocked", async () => {
		const { manager } = createToolDeps();
		manager.spawnAndWait = vi.fn().mockResolvedValue(
			createTestSubagent({ runUpdates: ["The bug is in the retry wrapper."] }),
		);

		const result = await runForeground(manager, makeParams(), undefined, undefined);

		expect(textOf(result)).toContain("Updates this agent sent while it worked:");
		expect(textOf(result)).toContain("The bug is in the retry wrapper.");
	});

	it("reports the updates of an agent whose run then failed", async () => {
		const { manager } = createToolDeps();
		manager.spawnAndWait = vi.fn().mockResolvedValue(
			createTestSubagent({
				status: "error",
				error: "turn loop exploded",
				runUpdates: ["The premise is wrong."],
			}),
		);

		const result = await runForeground(manager, makeParams(), undefined, undefined);

		expect(textOf(result)).toContain("The premise is wrong.");
	});

	it("names where a teardown saved the work of an agent that failed", async () => {
		const { manager } = createToolDeps();
		manager.spawnAndWait = vi.fn().mockResolvedValue(
			createTestSubagent({
				status: "error",
				error: "turn loop exploded",
				workspaceNotice: "\n\n---\nChanges saved to branch `pi-agent-5`.",
			}),
		);

		const result = await runForeground(manager, makeParams(), undefined, undefined);

		expect(textOf(result)).toContain("Agent failed: turn loop exploded");
		expect(textOf(result)).toContain("Changes saved to branch `pi-agent-5`.");
	});

	// A failed run's body carries no result, so the transcript is the only route
	// to what the child did before it died. The nudge and get_subagent_result
	// both name it; this carrier did not (#889).
	it("names the transcript of an agent that failed", async () => {
		const { manager } = createToolDeps();
		manager.spawnAndWait = vi.fn().mockResolvedValue(
			createTestSubagent({
				status: "error",
				error: "429 rate limit exceeded",
				sessionReady: true,
				outputFile: "/sessions/child.jsonl",
			}),
		);

		const result = await runForeground(manager, makeParams(), undefined, undefined);

		expect(textOf(result)).toContain("Agent failed: 429 rate limit exceeded");
		expect(textOf(result)).toContain(
			"Full transcript available at: /sessions/child.jsonl",
		);
	});

	it("omits the transcript line for a failed agent that persisted none", async () => {
		const { manager } = createToolDeps();
		manager.spawnAndWait = vi.fn().mockResolvedValue(
			createTestSubagent({ status: "error", error: "429 rate limit exceeded" }),
		);

		const result = await runForeground(manager, makeParams(), undefined, undefined);

		expect(textOf(result)).not.toContain("Full transcript available at:");
	});

	it("marks the returned record consumed (foreground-return delivery edge)", async () => {
		const record = createTestSubagent();
		const deps = createToolDeps({
			manager: { ...createToolDeps().manager, spawnAndWait: vi.fn().mockResolvedValue(record) },
		});
		await runForeground(deps.manager, makeParams(), undefined, undefined);
		expect(record.consumed).toBe(true);
	});

	it("marks consumed even when the agent errored (result delivered in the tool result)", async () => {
		const record = createTestSubagent({ status: "error", error: "boom" });
		const deps = createToolDeps({
			manager: { ...createToolDeps().manager, spawnAndWait: vi.fn().mockResolvedValue(record) },
		});
		await runForeground(deps.manager, makeParams(), undefined, undefined);
		expect(record.consumed).toBe(true);
	});

	it("returns error message when agent record status is error", async () => {
		const deps = createToolDeps({
			manager: {
				...createToolDeps().manager,
				spawnAndWait: vi.fn().mockResolvedValue(
					createTestSubagent({ status: "error", error: "Context window exceeded" }),
				),
			},
		});
		const result = await runForeground(deps.manager, makeParams(), undefined, undefined);
		expect(textOf(result)).toContain("Agent failed");
		expect(textOf(result)).toContain("Context window exceeded");
	});

	it("returns error text when spawnAndWait throws", async () => {
		const deps = createToolDeps({
			manager: {
				...createToolDeps().manager,
				spawnAndWait: vi.fn().mockRejectedValue(new Error("runner crashed")),
			},
		});
		const result = await runForeground(deps.manager, makeParams(), undefined, undefined);
		expect(textOf(result)).toContain("runner crashed");
	});

	it("includes fallback note when fellBack is true", async () => {
		const { manager } = createToolDeps();
		const result = await runForeground(
			manager,
			makeParams({
				config: createResolvedSpawnConfig({ rawType: "unknown-type", fellBack: true, description: "fg task" }),
			}),
			undefined,
			undefined,
		);
		expect(textOf(result)).toContain('Unknown agent type "unknown-type"');
	});

	it("calls onUpdate with streaming details while running", async () => {
		let resolve!: (r: any) => void;
		const promise = new Promise<any>((res) => { resolve = res; });
		const deps = createToolDeps({
			manager: {
				...createToolDeps().manager,
				spawnAndWait: vi.fn().mockReturnValue(promise),
			},
		});
		const onUpdate = vi.fn();
		const runPromise = runForeground(deps.manager, makeParams(), undefined, onUpdate);

		// Advance timer to trigger a spinner tick
		await vi.advanceTimersByTimeAsync(100);
		expect(onUpdate).toHaveBeenCalled();

		resolve(createTestSubagent({ result: "done" }));
		await runPromise;
	});

	describe("model label", () => {
		const running = createTestSubagent({
			status: "running",
			completedAt: undefined,
			execution: makeStubExecution({ model: makeModel({ provider: "openai", id: "gpt-5" }) }),
		});
		const params = () => makeParams({ config: createResolvedSpawnConfig({ model: "anthropic/claude-sonnet-5-5" }) });

		it("streams the model the record runs once its session exists", async () => {
			const { promise, resolve } = Promise.withResolvers<Subagent>();
			const spawnAndWait = vi.fn(
				(_snapshot: unknown, _type: unknown, _prompt: unknown, options: { observer?: { onSessionCreated?: (agent: Subagent) => void } }) => {
					options.observer?.onSessionCreated?.(running);
					return promise;
				},
			);
			const deps = createToolDeps({ manager: { ...createToolDeps().manager, spawnAndWait } });
			const onUpdate = vi.fn();
			const runPromise = runForeground(deps.manager, params(), undefined, onUpdate);

			await vi.advanceTimersByTimeAsync(100);
			// Partial match: the streamed details also carry a spinner frame and a wall-clock duration.
			expect(onUpdate).toHaveBeenLastCalledWith(
				expect.objectContaining({ details: expect.objectContaining({ modelName: "openai/gpt-5" }) }),
			);

			resolve(createTestSubagent({ result: "done" }));
			await runPromise;
		});

		it("labels the completed result with the model the record ran", async () => {
			const deps = createToolDeps({
				manager: { ...createToolDeps().manager, spawnAndWait: vi.fn().mockResolvedValue(running) },
			});
			const result = await runForeground(deps.manager, params(), undefined, undefined);
			expect(result.details?.modelName).toBe("openai/gpt-5");
		});
	});

	it("streams the live turn budget of the record once its session exists", async () => {
		const running = createTestSubagent({
			status: "running",
			completedAt: undefined,
			turnBudget: { maxTurns: 10, used: 8, phase: "warned" },
		});
		const { promise, resolve } = Promise.withResolvers<Subagent>();
		const spawnAndWait = vi.fn(
			(_snapshot: unknown, _type: unknown, _prompt: unknown, options: { observer?: { onSessionCreated?: (agent: Subagent) => void } }) => {
				options.observer?.onSessionCreated?.(running);
				return promise;
			},
		);
		const deps = createToolDeps({ manager: { ...createToolDeps().manager, spawnAndWait } });
		const onUpdate = vi.fn();
		const runPromise = runForeground(deps.manager, makeParams(), undefined, onUpdate);

		await vi.advanceTimersByTimeAsync(100);
		// Partial match: the streamed details also carry a spinner frame and a wall-clock duration.
		expect(onUpdate).toHaveBeenLastCalledWith(
			expect.objectContaining({
				details: expect.objectContaining({ turnBudget: { maxTurns: 10, used: 8, phase: "warned" } }),
			}),
		);

		resolve(createTestSubagent({ result: "done" }));
		await runPromise;
	});

	it("clears spinner interval on error and does not leave it running", async () => {
		const deps = createToolDeps({
			manager: {
				...createToolDeps().manager,
				spawnAndWait: vi.fn().mockRejectedValue(new Error("fail")),
			},
		});
		const onUpdate = vi.fn();
		await runForeground(deps.manager, makeParams(), undefined, onUpdate);

		onUpdate.mockClear();
		await vi.advanceTimersByTimeAsync(200);
		// Interval must have been cleared — no further onUpdate calls
		expect(onUpdate).not.toHaveBeenCalled();
	});

	describe("agent ID in the result text", () => {
		it("names the agent ID under the completion header", async () => {
			const { manager } = createToolDeps();
			const result = await runForeground(manager, makeParams(), undefined, undefined);
			expect(textOf(result)).toContain("Agent ID: agent-1");
		});

		it("names the agent ID when the agent failed", async () => {
			const deps = createToolDeps({
				manager: {
					...createToolDeps().manager,
					spawnAndWait: vi.fn().mockResolvedValue(
						createTestSubagent({ status: "error", error: "Context window exceeded" }),
					),
				},
			});
			const result = await runForeground(deps.manager, makeParams(), undefined, undefined);
			expect(textOf(result)).toContain("Agent ID: agent-1");
		});

		it("keeps the spawn notes ahead of the agent ID line", async () => {
			const { manager } = createToolDeps();
			const result = await runForeground(
				manager,
				makeParams({
					config: createResolvedSpawnConfig({ rawType: "unknown-type", fellBack: true, description: "fg task" }),
				}),
				undefined,
				undefined,
			);
			const text = textOf(result);
			expect(text.startsWith('Note: Unknown agent type "unknown-type" — using general-purpose.')).toBe(true);
			expect(text.indexOf("Agent ID: agent-1")).toBeGreaterThan(0);
		});
	});
});
