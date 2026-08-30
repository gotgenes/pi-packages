/**
 * workspace.ts — The single generative extension seam (ADR 0002, Phase 16 Step 2).
 *
 * "Where does a child run, and what brackets the run?" is a strategy (git
 * worktree, container, tmpdir, remote sandbox), not core behavior. The core
 * needs only a working directory plus a disposal hook; the default — the
 * parent's cwd, with no setup/teardown — is always correct.
 *
 * Unlike the observational lifecycle events in child-lifecycle.ts, this is a
 * *generative* seam: a registered provider returns a value the core consumes
 * synchronously at run-start. The core has no knowledge of git or worktrees.
 */

import type { SubagentStatus } from "#src/lifecycle/subagent";
import type { SubagentType } from "#src/types";

/** Context the core hands a provider when a child run starts. */
export interface WorkspacePrepareContext {
  agentId: string;
  agentType: SubagentType;
  baseCwd: string;
}

/** Outcome the core reports to a workspace when the run ends. */
export interface WorkspaceDisposeOutcome {
  status: SubagentStatus;
  description: string;
}

/** What dispose may hand back for the core to fold into the child result. */
export interface WorkspaceDisposeResult {
  /** Appended verbatim to the child's result text — the provider owns the wording. */
  resultAddendum?: string;
}

/** A prepared working directory plus its bracketed teardown. Born complete. */
export interface Workspace {
  /** The working directory — already exists when the workspace is handed back. */
  readonly cwd: string;
  dispose(outcome: WorkspaceDisposeOutcome): WorkspaceDisposeResult | undefined;
}

/** The single generative seam: supplies a child's workspace. */
export interface WorkspaceProvider {
  prepare(ctx: WorkspacePrepareContext): Promise<Workspace | undefined>;
}
