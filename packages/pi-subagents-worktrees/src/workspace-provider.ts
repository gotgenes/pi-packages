/**
 * workspace-provider.ts — git worktree implementation of the pi-subagents
 * WorkspaceProvider seam (ADR 0002, Phase 16 Step 3).
 *
 * The core consults a registered provider for every child run. This provider
 * isolates a child in a git worktree only when its agent type is opted in via
 * `worktreeAgents`; for any other agent it returns `undefined`, leaving the
 * child to run in the parent cwd. On worktree-creation failure for an opted-in
 * agent it throws, failing the run loudly rather than silently running
 * unisolated (preserving the core's former strict behavior).
 */

import type {
  Workspace,
  WorkspaceDisposeOutcome,
  WorkspacePrepareContext,
  WorkspaceProvider,
} from "@gotgenes/pi-subagents";
import type { WorktreesConfig } from "#src/config";
import {
  cleanupWorktree,
  createWorktree,
  type WorktreeInfo,
} from "#src/worktree";

/** A prepared git worktree plus its bracketed teardown. Born complete. */
class WorktreeWorkspace implements Workspace {
  constructor(
    private readonly repoCwd: string,
    private readonly info: WorktreeInfo,
  ) {}

  /** The worktree directory — already exists when this workspace is handed back. */
  get cwd(): string {
    return this.info.path;
  }

  dispose(
    outcome: WorkspaceDisposeOutcome,
  ): { resultAddendum?: string } | undefined {
    const result = cleanupWorktree(
      this.repoCwd,
      this.info,
      outcome.description,
    );
    if (result.error) {
      return {
        resultAddendum: `\n\n---\nWorktree cleanup failed and was left in place for manual recovery at \`${result.path}\`: ${result.error}`,
      };
    }
    if (result.hasChanges && result.branch) {
      return {
        resultAddendum: `\n\n---\nChanges saved to branch \`${result.branch}\`. Merge with: \`git merge ${result.branch}\``,
      };
    }
    return undefined;
  }
}

/** Registers a git worktree per opted-in agent type; runs others in the parent cwd. */
export class WorktreeWorkspaceProvider implements WorkspaceProvider {
  constructor(private readonly config: WorktreesConfig) {}

  // eslint-disable-next-line @typescript-eslint/require-await -- the seam contract is async; worktree creation is synchronous, but staying async ensures failures reject the returned promise rather than throwing synchronously at the call site
  async prepare(ctx: WorkspacePrepareContext): Promise<Workspace | undefined> {
    if (!this.config.worktreeAgents.includes(ctx.agentType)) return undefined;

    const info = createWorktree(ctx.baseCwd, ctx.agentId);
    if (!info) {
      throw new Error(
        `Cannot run agent "${ctx.agentType}" with worktree isolation — ` +
          "not a git repo, no commits yet, or `git worktree add` failed. " +
          "Initialize git and commit at least once, or remove the agent from worktreeAgents.",
      );
    }
    return new WorktreeWorkspace(ctx.baseCwd, info);
  }
}
