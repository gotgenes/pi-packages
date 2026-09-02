import { describe, expect, it } from "vitest";
import { makeWorkspace, makeWorkspaceProvider } from "#test/helpers/make-workspace";

const outcome = { status: "completed" as const, description: "test agent" };

describe("makeWorkspace", () => {
	it("exposes the cwd it was built with", () => {
		expect(makeWorkspace("/ws/dir").cwd).toBe("/ws/dir");
	});

	it("disposes to undefined when no dispose result was supplied", () => {
		expect(makeWorkspace("/ws/dir").dispose(outcome)).toBeUndefined();
	});

	it("disposes to the supplied result", () => {
		const workspace = makeWorkspace("/ws/dir", { resultAddendum: "\n\n---\nsaved" });
		expect(workspace.dispose(outcome)).toEqual({ resultAddendum: "\n\n---\nsaved" });
	});

	it("records the outcome it was disposed with", () => {
		const workspace = makeWorkspace("/ws/dir");
		workspace.dispose(outcome);
		expect(workspace.dispose).toHaveBeenCalledWith(outcome);
	});
});

describe("makeWorkspaceProvider", () => {
	it("prepares the workspace it was built with", async () => {
		const workspace = makeWorkspace("/ws/dir");
		const provider = makeWorkspaceProvider(workspace);
		await expect(provider.prepare({ agentId: "a", agentType: "general-purpose", baseCwd: "/p" }))
			.resolves.toBe(workspace);
	});

	it("prepares to undefined for a provider that declines the agent type", async () => {
		const provider = makeWorkspaceProvider(undefined);
		await expect(provider.prepare({ agentId: "a", agentType: "general-purpose", baseCwd: "/p" }))
			.resolves.toBeUndefined();
	});

	it("records the prepare context", async () => {
		const provider = makeWorkspaceProvider(makeWorkspace("/ws/dir"));
		const ctx = { agentId: "a", agentType: "general-purpose" as const, baseCwd: "/p" };
		await provider.prepare(ctx);
		expect(provider.prepare).toHaveBeenCalledWith(ctx);
	});
});
