import { vi } from "vitest";
import type {
	Workspace,
	WorkspaceDisposeOutcome,
	WorkspaceDisposeResult,
	WorkspacePrepareContext,
} from "#src/lifecycle/workspace";

/**
 * A Workspace stub whose dispose is recorded and returns `disposeResult`.
 *
 * The return type is left unannotated on purpose: annotating it `Workspace`
 * erases the `Mock` methods callers assert on (`toHaveBeenCalledWith`, call
 * counts), which is the whole reason the stub exists.
 */
export function makeWorkspace(cwd: string, disposeResult?: WorkspaceDisposeResult) {
	return {
		cwd,
		dispose: vi.fn(
			(_outcome: WorkspaceDisposeOutcome): WorkspaceDisposeResult | undefined => disposeResult,
		),
	};
}

/**
 * A WorkspaceProvider whose recorded prepare resolves to `workspace`.
 *
 * Pass `undefined` for the provider that declines an agent type — the shape a
 * real provider takes when the agent is not opted into isolation.
 */
export function makeWorkspaceProvider(workspace: Workspace | undefined) {
	return {
		prepare: vi.fn(
			(_ctx: WorkspacePrepareContext): Promise<Workspace | undefined> =>
				Promise.resolve(workspace),
		),
	};
}
