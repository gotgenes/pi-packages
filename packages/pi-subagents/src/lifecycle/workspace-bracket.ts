/**
 * workspace-bracket.ts — Owned prepare/dispose lifecycle for a child workspace.
 *
 * Captures the provider resolver (not the provider itself) so provider
 * resolution stays lazy at run-start. The prepared Workspace is held
 * privately; dispose() centralises the guard and addendum-unwrap so callers
 * never reach through to workspace.dispose().resultAddendum directly.
 *
 * dispose() is idempotent — a workspace can outlive the run that prepared it
 * (a child holding it for a resume), so more than one lifecycle edge may reach
 * for it — and it deliberately does NOT catch errors: the best-effort
 * try/catch belongs at the call site, preserving the per-caller semantics.
 */

import type {
	Workspace,
	WorkspaceDisposeOutcome,
	WorkspacePrepareContext,
	WorkspaceProvider,
} from "#src/lifecycle/workspace";

/** Owns the child workspace lifecycle: prepare at run-start, dispose at run-end. */
export class WorkspaceBracket {
	private prepared?: Workspace;
	private disposedWorkspace = false;

	constructor(private readonly resolveProvider: () => WorkspaceProvider | undefined) {}

	/**
	 * True once a prepared workspace has been torn down — the directory the run
	 * used is gone. False for a bracket that never held one, and false while one
	 * is still held, so it distinguishes "no workspace" from "workspace removed".
	 */
	wasDisposed(): boolean {
		return this.disposedWorkspace;
	}

	/**
	 * Returns true when a workspace provider is currently registered.
	 * Use to guard the `await prepare(...)` call and avoid an unnecessary
	 * microtask boundary in the no-provider path.
	 */
	hasProvider(): boolean {
		return this.resolveProvider() !== undefined;
	}

	/**
	 * Resolve the registered provider and prepare the child workspace.
	 * Returns the workspace's cwd, or undefined when no provider is registered
	 * or the provider resolves to undefined.
	 */
	async prepare(ctx: WorkspacePrepareContext): Promise<string | undefined> {
		const provider = this.resolveProvider();
		if (!provider) return undefined;
		this.prepared = await provider.prepare(ctx);
		return this.prepared?.cwd;
	}

	/**
	 * Dispose the prepared workspace (if any) and return the result addendum
	 * verbatim. Returns an empty string when no workspace was prepared, when one
	 * was already disposed, or when the workspace returns no addendum.
	 *
	 * The workspace is released and recorded as disposed before it is torn down,
	 * so a provider whose dispose() throws still leaves the bracket reporting a
	 * gone workspace — a failed teardown makes reuse no safer than a clean one.
	 * The throw itself still propagates.
	 */
	dispose(outcome: WorkspaceDisposeOutcome): string {
		const workspace = this.prepared;
		if (!workspace) return "";
		this.prepared = undefined;
		this.disposedWorkspace = true;
		return workspace.dispose(outcome)?.resultAddendum ?? "";
	}
}
