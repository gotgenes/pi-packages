import { describe, expect, it, vi } from "vitest";
import type { Workspace, WorkspaceDisposeResult } from "#src/lifecycle/workspace";
import { WorkspaceBracket } from "#src/lifecycle/workspace-bracket";
import { makeWorkspace, makeWorkspaceProvider } from "#test/helpers/make-workspace";

const ctx = {
	agentId: "agent-1",
	agentType: "general-purpose" as const,
	baseCwd: "/parent",
};

/** Construct a bracket over a prepared "/ws/dir" workspace; the act (dispose) stays in each test. */
async function preparedBracket(disposeResult?: WorkspaceDisposeResult) {
	const workspace = makeWorkspace("/ws/dir", disposeResult);
	const bracket = new WorkspaceBracket(() => makeWorkspaceProvider(workspace));
	await bracket.prepare(ctx);
	return { bracket, workspace };
}

describe("WorkspaceBracket — hasProvider", () => {
	it("returns false when no provider is registered", () => {
		const bracket = new WorkspaceBracket(() => undefined);
		expect(bracket.hasProvider()).toBe(false);
	});

	it("returns true when a provider is registered", () => {
		const workspace = makeWorkspace("/ws/dir");
		const bracket = new WorkspaceBracket(() => makeWorkspaceProvider(workspace));
		expect(bracket.hasProvider()).toBe(true);
	});
});

describe("WorkspaceBracket — prepare", () => {
	it("returns undefined when there is no provider", async () => {
		const bracket = new WorkspaceBracket(() => undefined);
		const cwd = await bracket.prepare(ctx);
		expect(cwd).toBeUndefined();
	});

	it("returns the workspace cwd when the provider prepares one", async () => {
		const workspace = makeWorkspace("/ws/dir");
		const bracket = new WorkspaceBracket(() => makeWorkspaceProvider(workspace));
		const cwd = await bracket.prepare(ctx);
		expect(cwd).toBe("/ws/dir");
	});

	it("returns undefined when the provider resolves to undefined", async () => {
		const bracket = new WorkspaceBracket(() => makeWorkspaceProvider(undefined));
		const cwd = await bracket.prepare(ctx);
		expect(cwd).toBeUndefined();
	});

	it("passes the full context to provider.prepare", async () => {
		const workspace = makeWorkspace("/ws/dir");
		const provider = makeWorkspaceProvider(workspace);
		const bracket = new WorkspaceBracket(() => provider);
		await bracket.prepare(ctx);
		expect(provider.prepare).toHaveBeenCalledWith(ctx);
	});
});

describe("WorkspaceBracket — dispose", () => {
	const outcome = { status: "completed" as const, description: "test agent" };

	it("returns empty string when prepare was not called (no workspace)", () => {
		const bracket = new WorkspaceBracket(() => undefined);
		expect(bracket.dispose(outcome)).toBe("");
	});

	it("returns empty string when the provider resolved to undefined", async () => {
		const bracket = new WorkspaceBracket(() => makeWorkspaceProvider(undefined));
		await bracket.prepare(ctx);
		expect(bracket.dispose(outcome)).toBe("");
	});

	it("returns the resultAddendum from the workspace", async () => {
		const { bracket } = await preparedBracket({ resultAddendum: "\n\n---\nsaved to branch foo" });
		const addendum = bracket.dispose(outcome);
		expect(addendum).toBe("\n\n---\nsaved to branch foo");
	});

	it("returns empty string when workspace.dispose returns no addendum", async () => {
		const { bracket } = await preparedBracket();
		expect(bracket.dispose(outcome)).toBe("");
	});

	it("returns empty string when workspace.dispose returns an empty resultAddendum", async () => {
		const { bracket } = await preparedBracket({ resultAddendum: "" });
		expect(bracket.dispose(outcome)).toBe("");
	});

	it("passes the outcome to workspace.dispose", async () => {
		const { bracket, workspace } = await preparedBracket();
		bracket.dispose(outcome);
		expect(workspace.dispose).toHaveBeenCalledWith(outcome);
	});

	it("propagates a throwing dispose (does not swallow)", async () => {
		const workspace: Workspace = {
			cwd: "/ws/dir",
			dispose: vi.fn(() => { throw new Error("dispose failed"); }),
		};
		const bracket = new WorkspaceBracket(() => makeWorkspaceProvider(workspace));
		await bracket.prepare(ctx);
		expect(() => bracket.dispose(outcome)).toThrow("dispose failed");
	});
});
