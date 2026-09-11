import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { AgentTool } from "#src/tools/agent-tool";
import {
	createToolDeps,
	createToolDepsWithDisabledBuiltInAgents,
	mockResumeRecord,
	mockResumeRefusal,
} from "#test/helpers/make-deps";
import { createTestSubagent } from "#test/helpers/make-subagent";

function makeCtx(overrides: Record<string, unknown> = {}) {
	return {
		ui: { fake: true },
		...overrides,
	} as unknown as ExtensionContext;
}

function makeTool(deps: ReturnType<typeof createToolDeps>) {
	return new AgentTool(deps.manager, deps.runtime, deps.settings, deps.registry, deps.agentDir);
}

async function execute(
	deps: ReturnType<typeof createToolDeps>,
	params: Record<string, unknown>,
	ctx?: ReturnType<typeof makeCtx>,
) {
	return makeTool(deps).execute(
		"tc-1",
		params,
		new AbortController().signal,
		vi.fn(),
		ctx ?? makeCtx(),
	);
}

describe("AgentTool", () => {
	it("returns tool definition with correct name and label", () => {
		const def = makeTool(createToolDeps()).toToolDefinition();
		expect(def.name).toBe("subagent");
		expect(def.label).toBe("Subagent");
	});

	it("includes promptSnippet", () => {
		const def = makeTool(createToolDeps()).toToolDefinition();
		expect(def.promptSnippet).toBe(
			"Launch a specialized agent for complex, multi-step tasks.",
		);
	});

	it("derives type list from registry — includes default agents in description", () => {
		const def = makeTool(createToolDeps()).toToolDefinition();
		// testRegistry loads default agents: general-purpose, Explore, Plan
		expect(def.description).toContain("- general-purpose: General-purpose agent");
		expect(def.description).toContain("- Explore: Fast codebase exploration agent");
	});

	it("lists the built-in agent guidelines in registry order", () => {
		const def = makeTool(createToolDeps()).toToolDefinition();
		const guidelines = [
			"- Use general-purpose for complex tasks that need file editing.",
			"- Use Explore for codebase searches and code understanding.",
			"- Use Plan for architecture and implementation planning.",
		];
		for (const line of guidelines) expect(def.description).toContain(line);
		const positions = guidelines.map((line) => def.description.indexOf(line));
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
	});

	it.for(["Explore", "Plan", "general-purpose"])(
		"omits the type-list entry and guideline for a disabled built-in %s",
		(name) => {
			const def = makeTool(createToolDepsWithDisabledBuiltInAgents(name)).toToolDefinition();
			expect(def.description).not.toContain(`- ${name}:`);
			expect(def.description).not.toContain(`- Use ${name} for `);
		},
	);

	it("calls registry.reload() on each execute", async () => {
		const deps = createToolDeps();
		const reloadSpy = vi.spyOn(deps.registry, "reload");
		await execute(deps, {
			prompt: "test",
			description: "test",
			subagent_type: "general-purpose",
		});
		expect(reloadSpy).toHaveBeenCalledOnce();
		reloadSpy.mockRestore();
	});

});

describe("AgentTool — resume path", () => {
	describe("refused", () => {
		it("names an id no record answers to", async () => {
			const deps = createToolDeps();
			mockResumeRefusal(deps, "unknown-agent");
			const result = await execute(deps, {
				prompt: "continue",
				description: "resume",
				subagent_type: "general-purpose",
				resume: "nonexistent",
			});
			expect(result.content[0].text).toBe(
				'Agent not found: "nonexistent". Records are cleared at session start/switch, so it ' +
					"may be from a previous session.",
			);
		});

		it("names a missing session without offering a cleanup story it cannot tell", async () => {
			const deps = createToolDeps();
			mockResumeRefusal(deps, "no-session");
			const result = await execute(deps, {
				prompt: "continue",
				description: "resume",
				subagent_type: "general-purpose",
				resume: "agent-1",
			});
			expect(result.content[0].text).toBe('Agent "agent-1" has no active session to resume.');
		});

		it("points a released-agent resume at get_subagent_result instead of resuming", async () => {
			const deps = createToolDeps();
			mockResumeRefusal(deps, "session-released");
			const result = await execute(deps, {
				prompt: "continue",
				description: "resume",
				subagent_type: "general-purpose",
				resume: "agent-1",
			});
			expect(result.content[0].text).toBe(
				'Agent "agent-1" had its session released after its retention window; resume is ' +
					"unavailable, but its result is still retrievable via get_subagent_result.",
			);
		});

		it("tells the parent to wait out a run that has not finished", async () => {
			const deps = createToolDeps();
			mockResumeRefusal(deps, "still-running");

			const result = await execute(deps, {
				prompt: "continue",
				description: "resume",
				subagent_type: "general-purpose",
				resume: "agent-1",
			});

			expect(result.content[0].text).toBe(
				'Agent "agent-1" is still running; wait for it to finish before resuming. ' +
					"Use steer_subagent to send it a message while it runs.",
			);
		});

		it("names a torn-down workspace as the reason a resume cannot re-enter it", async () => {
			const deps = createToolDeps();
			mockResumeRefusal(deps, "workspace-disposed");

			const result = await execute(deps, {
				prompt: "continue",
				description: "resume",
				subagent_type: "general-purpose",
				resume: "agent-1",
			});

			expect(result.content[0].text).toBe(
				'Agent "agent-1" ran in an isolated workspace that no longer exists; resume is ' +
					"unavailable because the agent would re-enter a directory that has been removed. " +
					"Spawn a new agent instead — the agent's result records where any work was saved.",
			);
		});
	});

	describe("accepted", () => {
		it("resumes an agent whose run never had a workspace", async () => {
			const deps = createToolDeps();
			const noWorkspace = createTestSubagent();
			await noWorkspace.run();
			deps.manager.getRecord = vi.fn().mockReturnValue(noWorkspace);
			mockResumeRecord(deps, { result: "Resumed output." });

			const result = await execute(deps, {
				prompt: "continue",
				description: "resume",
				subagent_type: "general-purpose",
				resume: "agent-1",
			});

			expect(deps.manager.resume).toHaveBeenCalledOnce();
			expect(result.content[0].text).toContain("Resumed output.");
		});

		it("returns result text on successful resume", async () => {
			const deps = createToolDeps();
			mockResumeRecord(deps, { result: "Resumed output." });
			const result = await execute(deps, {
				prompt: "continue",
				description: "resume",
				subagent_type: "general-purpose",
				resume: "agent-1",
			});
			expect(result.content[0].text).toContain("Resumed output.");
		});

		it("surfaces a follow-up question from a resumed child as answerable", async () => {
			const deps = createToolDeps();
			mockResumeRecord(deps, {
				id: "agent-9",
				result: "Thanks.",
				pendingQuestion: "And the fallback?",
				sessionReady: true,
			});

			const result = await execute(deps, {
				prompt: "continue",
				description: "resume",
				subagent_type: "general-purpose",
				resume: "agent-1",
			});

			expect(result.content[0].text).toContain("This agent is waiting on an answer:");
			expect(result.content[0].text).toContain("And the fallback?");
			expect(result.content[0].text).toContain('resume: "agent-9"');
		});

		it("reports a resumed child's question without a resume call once its session is gone", async () => {
			const deps = createToolDeps();
			const answered = mockResumeRecord(deps, {
				id: "agent-9",
				result: "Thanks.",
				pendingQuestion: "And the fallback?",
				sessionReady: true,
			});
			await answered.releaseSession();

			const result = await execute(deps, {
				prompt: "continue",
				description: "resume",
				subagent_type: "general-purpose",
				resume: "agent-1",
			});

			expect(result.content[0].text).toContain("And the fallback?");
			expect(result.content[0].text).toContain(
				"its session was released after its retention window",
			);
			expect(result.content[0].text).not.toContain("resume:");
		});

		it("reports the updates a resumed child sent while the parent was blocked", async () => {
			const deps = createToolDeps();
			mockResumeRecord(deps, { id: "agent-9", runUpdates: ["The bug is in the retry wrapper."] });

			const result = await execute(deps, {
				prompt: "continue",
				description: "resume",
				subagent_type: "general-purpose",
				resume: "agent-1",
			});

			expect(result.content[0].text).toContain("Updates this agent sent while it worked:");
			expect(result.content[0].text).toContain("The bug is in the retry wrapper.");
		});

		it("names where a teardown saved the work of a resumed child", async () => {
			const deps = createToolDeps();
			mockResumeRecord(deps, {
				id: "agent-9",
				status: "error",
				error: "resume exploded",
				workspaceNotice: "\n\n---\nChanges saved to branch `pi-agent-9`.",
			});

			const result = await execute(deps, {
				prompt: "continue",
				description: "resume",
				subagent_type: "general-purpose",
				resume: "agent-1",
			});

			expect(result.content[0].text).toContain("Changes saved to branch `pi-agent-9`.");
		});

		it("names an abort on the resume return, which previously reported nothing", async () => {
			const deps = createToolDeps();
			mockResumeRecord(deps, { status: "aborted", result: "Half of it" });

			const result = await execute(deps, {
				prompt: "continue",
				description: "resume",
				subagent_type: "general-purpose",
				resume: "agent-1",
			});

			expect(result.content[0].text).toContain("aborted \u2014 max turns exceeded, output may be incomplete");
			expect(result.content[0].text).toContain("Half of it");
		});

		it("claims the outcome as it resumes, so the resume is never announced", async () => {
			const deps = createToolDeps();
			mockResumeRecord(deps, { result: "Resumed output." });

			await execute(deps, {
				prompt: "continue",
				description: "resume",
				subagent_type: "general-purpose",
				resume: "agent-1",
			});

			// The claim is the manager's to take, at the one edge it can be taken:
			// resetForResume runs synchronously inside Subagent.resume().
			expect(deps.manager.resume).toHaveBeenCalledWith(
				"agent-1",
				"continue",
				expect.objectContaining({ claimOutcome: true }),
			);
		});

		it("reports a resumed run that failed as the error it carries", async () => {
			const deps = createToolDeps();
			mockResumeRecord(deps, { status: "error", error: "resume exploded" });

			const result = await execute(deps, {
				prompt: "continue",
				description: "resume",
				subagent_type: "general-purpose",
				resume: "agent-1",
			});

			expect(result.content[0].text).toContain("resume exploded");
		});

		it("marks the resumed record consumed (resume-return delivery edge)", async () => {
			const deps = createToolDeps();
			const resumed = mockResumeRecord(deps, { result: "Resumed output." });
			await execute(deps, {
				prompt: "continue",
				description: "resume",
				subagent_type: "general-purpose",
				resume: "agent-1",
			});
			expect(resumed.consumed).toBe(true);
		});

		it("names the agent ID in the resumed result text", async () => {
			const deps = createToolDeps();
			mockResumeRecord(deps, { result: "Resumed output." });
			const result = await execute(deps, {
				prompt: "continue",
				description: "resume",
				subagent_type: "general-purpose",
				resume: "agent-1",
			});
			expect(result.content[0].text).toContain("Agent ID: agent-1");
		});
	});
});

describe("AgentTool — model resolution error", () => {
	it("returns error when model resolution fails", async () => {
		const deps = createToolDeps();
		const result = await execute(
			deps,
			{
				prompt: "test",
				description: "test",
				subagent_type: "general-purpose",
				model: "nonexistent-model-xyz",
			},
		);
		// User-specified model that doesn't resolve → error message
		expect(result.content[0].text).toContain("nonexistent-model-xyz");
	});
});

describe("AgentTool — background execution", () => {
	it("returns background launch message with agent ID", async () => {
		const deps = createToolDeps();
		const record = createTestSubagent({ status: "running" });
		deps.manager.getRecord = vi.fn().mockReturnValue(record);
		const result = await execute(deps, {
			prompt: "do something",
			description: "bg task",
			subagent_type: "general-purpose",
			run_in_background: true,
		});
		const text = result.content[0].text;
		expect(text).toContain("background");
		expect(text).toContain("agent-1");
		expect(text).toContain("bg task");
	});

	it("does not emit subagents:created directly — delegated to observer.onSubagentCreated", async () => {
		// The subagents:created event is now emitted by SubagentManagerObserver.onSubagentCreated,
		// called from SubagentManager.spawn(). Tested in subagent-manager.test.ts.
		// This test ensures the tool no longer holds an emitEvent dep for this purpose.
		const deps = createToolDeps();
		deps.manager.getRecord = vi.fn().mockReturnValue(createTestSubagent({ status: "running" }));
		const result = await execute(deps, {
			prompt: "do something",
			description: "bg task",
			subagent_type: "general-purpose",
			run_in_background: true,
		});
		// Background spawn succeeds — no emitEvent dep required
		expect(result.content[0].text).toContain("background");
	});

	it("passes parentSession.toolCallId to manager.spawn", async () => {
		const deps = createToolDeps();
		deps.manager.getRecord = vi.fn().mockReturnValue(createTestSubagent({ status: "running" }));
		await execute(deps, {
			prompt: "do something",
			description: "bg task",
			subagent_type: "general-purpose",
			run_in_background: true,
		});
		const spawnOpts = (deps.manager.spawn as ReturnType<typeof vi.fn>).mock.calls[0][3];
		expect(spawnOpts.parentSession?.toolCallId).toBe("tc-1");
	});
});

describe("AgentTool — foreground execution", () => {
	it("returns completion message with stats", async () => {
		const deps = createToolDeps();
		deps.manager.spawnAndWait = vi.fn().mockResolvedValue(
			createTestSubagent({ result: "Task complete.", toolUses: 5 }),
		);
		const result = await execute(deps, {
			prompt: "do task",
			description: "fg task",
			subagent_type: "general-purpose",
		});
		const text = result.content[0].text;
		expect(text).toContain("Agent completed");
		expect(text).toContain("Task complete.");
	});

	it("returns error message when agent fails", async () => {
		const deps = createToolDeps();
		deps.manager.spawnAndWait = vi.fn().mockResolvedValue(
			createTestSubagent({ status: "error", error: "Out of context" }),
		);
		const result = await execute(deps, {
			prompt: "do task",
			description: "fg task",
			subagent_type: "general-purpose",
		});
		expect(result.content[0].text).toContain("Agent failed");
		expect(result.content[0].text).toContain("Out of context");
	});

	it("returns error when spawnAndWait throws", async () => {
		const deps = createToolDeps();
		deps.manager.spawnAndWait = vi.fn().mockRejectedValue(new Error("spawn failure"));
		const result = await execute(deps, {
			prompt: "do task",
			description: "fg task",
			subagent_type: "general-purpose",
		});
		expect(result.content[0].text).toContain("spawn failure");
	});

	it("names the agent ID in the foreground result text", async () => {
		const deps = createToolDeps();
		deps.manager.spawnAndWait = vi.fn().mockResolvedValue(
			createTestSubagent({ result: "Task complete." }),
		);
		const result = await execute(deps, {
			prompt: "do task",
			description: "fg task",
			subagent_type: "general-purpose",
		});
		expect(result.content[0].text).toContain("Agent ID: agent-1");
	});
});
