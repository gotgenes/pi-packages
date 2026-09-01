import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ForegroundParams, runForeground } from "#src/tools/foreground-runner";
import { createToolDeps } from "#test/helpers/make-deps";
import { createResolvedSpawnConfig } from "#test/helpers/make-spawn-config";
import { createTestSubagent } from "#test/helpers/make-subagent";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";

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
		expect(result.content[0].text).toContain("Agent completed");
		expect(result.content[0].text).toContain("3 tool uses");
		expect(result.content[0].text).toContain("All done.");
	});

	it("surfaces a declared question as answerable, naming the resume call", async () => {
		const { manager } = createToolDeps();
		manager.spawnAndWait = vi
			.fn()
			.mockResolvedValue(
				createTestSubagent({ id: "agent-5", result: "Mapped them.", pendingQuestion: "Which config?" }),
			);

		const result = await runForeground(manager, makeParams(), undefined, undefined);

		expect(result.content[0].text).toContain("This agent is waiting on an answer:");
		expect(result.content[0].text).toContain("Which config?");
		expect(result.content[0].text).toContain('resume: "agent-5"');
	});

	it("adds no affordance when the agent asked nothing", async () => {
		const { manager } = createToolDeps();
		const result = await runForeground(manager, makeParams(), undefined, undefined);
		expect(result.content[0].text).not.toContain("waiting on an answer");
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
		expect(result.content[0].text).toContain("Agent failed");
		expect(result.content[0].text).toContain("Context window exceeded");
	});

	it("returns error text when spawnAndWait throws", async () => {
		const deps = createToolDeps({
			manager: {
				...createToolDeps().manager,
				spawnAndWait: vi.fn().mockRejectedValue(new Error("runner crashed")),
			},
		});
		const result = await runForeground(deps.manager, makeParams(), undefined, undefined);
		expect(result.content[0].text).toContain("runner crashed");
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
		expect(result.content[0].text).toContain('Unknown agent type "unknown-type"');
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
			expect(result.content[0].text).toContain("Agent ID: agent-1");
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
			expect(result.content[0].text).toContain("Agent ID: agent-1");
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
			const text = result.content[0].text;
			expect(text.startsWith('Note: Unknown agent type "unknown-type" — using general-purpose.')).toBe(true);
			expect(text.indexOf("Agent ID: agent-1")).toBeGreaterThan(0);
		});
	});
});
