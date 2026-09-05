/**
 * worktree.ts — Git worktree isolation for subagents.
 *
 * Creates a temporary git worktree so an agent works on an isolated copy of the repo.
 * On completion, if no changes were made, the worktree is cleaned up.
 * If changes exist, a branch is created and returned in the result.
 * A worktree is only ever removed once its outcome is certain: when cleanup
 * fails partway, it is left on disk so the agent's work stays recoverable.
 *
 * Lifted from the pi-subagents core (Phase 16 Step 3, ADR 0002): git plumbing is
 * a workspace strategy, not core behavior, and now lives behind the
 * WorkspaceProvider seam in this package.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { debugLog } from "#src/debug";

/** Name prefix shared by every worktree and branch this package creates. */
export const AGENT_WORKTREE_PREFIX = "pi-agent-";

export interface WorktreeInfo {
  /** Absolute path to the worktree directory. */
  path: string;
  /** Branch name created for this worktree (if changes exist). */
  branch: string;
}

/** How a worktree's cleanup ended. Each outcome carries only its own data. */
export type WorktreeCleanupResult =
  /** Nothing to save; the worktree was removed. */
  | { outcome: "clean" }
  /**
   * Changes were committed to `branch`; the worktree was removed.
   * `hooksBypassed` records whether the commit hooks had to be skipped.
   */
  | { outcome: "committed"; branch: string; hooksBypassed: boolean }
  /** Cleanup failed partway; the worktree was left at `path` for recovery. */
  | { outcome: "failed"; path: string; error: string };

/**
 * Create a temporary git worktree for an agent.
 * Returns the worktree path, or undefined if not in a git repo.
 */
export function createWorktree(
  cwd: string,
  agentId: string,
): WorktreeInfo | undefined {
  // Verify we're in a git repo with at least one commit (HEAD must exist)
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd,
      stdio: "pipe",
      timeout: 5000,
    });
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      stdio: "pipe",
      timeout: 5000,
    });
  } catch (err) {
    debugLog("createWorktree git rev-parse", err);
    return undefined;
  }

  const branch = `${AGENT_WORKTREE_PREFIX}${agentId}`;
  const suffix = randomUUID().slice(0, 8);
  const worktreePath = join(tmpdir(), `${branch}-${suffix}`);

  try {
    // Create detached worktree at HEAD
    execFileSync("git", ["worktree", "add", "--detach", worktreePath, "HEAD"], {
      cwd,
      stdio: "pipe",
      timeout: 30000,
    });
    return { path: worktreePath, branch };
  } catch (err) {
    debugLog("git worktree add", err);
    return undefined;
  }
}

/**
 * Clean up a worktree after agent completion.
 * - If no changes: remove the worktree entirely.
 * - If changes exist: commit them to a branch, then remove the worktree.
 *   A commit hook that rejects the commit is retried past with `--no-verify`.
 * - If any of that fails: leave the worktree in place and report the error.
 */
export function cleanupWorktree(
  cwd: string,
  worktree: WorktreeInfo,
  agentDescription: string,
): WorktreeCleanupResult {
  if (!existsSync(worktree.path)) {
    return { outcome: "clean" };
  }

  try {
    if (!statusPorcelain(worktree.path)) {
      // No changes — remove worktree
      removeWorktree(cwd, worktree.path);
      return { outcome: "clean" };
    }

    // Changes exist — stage, commit, and create a branch
    stageAll(worktree.path);
    // Truncate description for commit message (no shell sanitization needed — execFileSync uses argv)
    const safeDesc = agentDescription.slice(0, 200);
    const hooksBypassed = commitStaged(worktree.path, `pi-agent: ${safeDesc}`);
    const branch = createBranch(worktree.path, worktree.branch);

    // Remove the worktree (branch persists in main repo)
    removeWorktree(cwd, worktree.path);

    return { outcome: "committed", branch, hooksBypassed };
  } catch (err) {
    // Never remove a worktree whose fate is uncertain: it can hold work that
    // was never written to the object database, which no `git fsck` recovers.
    // Leave it on disk and report where, so the caller can surface it.
    debugLog("cleanupWorktree", err);
    return {
      outcome: "failed",
      path: worktree.path,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Names of this package's branches whose work is not yet on `HEAD`.
 *
 * The glob is built from the shared prefix, so it also covers the
 * `<branch>-<timestamp>` fallback `createBranch` falls back to on a collision.
 * `--no-merged` is what keeps the answer self-validating: a branch drops out
 * the moment its work is merged, with nothing to clear.
 */
export function listUnmergedRescueBranches(cwd: string): string[] {
  return runGit(cwd, [
    "branch",
    "--list",
    `${AGENT_WORKTREE_PREFIX}*`,
    "--no-merged",
    "HEAD",
    "--format=%(refname:short)",
  ])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Paths of every worktree registered with the repository, as git resolves them. */
export function listWorktreePaths(cwd: string): string[] {
  return runGit(cwd, ["worktree", "list", "--porcelain"])
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim());
}

/** Porcelain status of a worktree, trimmed. An empty string means a clean tree. */
function statusPorcelain(worktreePath: string): string {
  return runGit(worktreePath, ["status", "--porcelain"]).trim();
}

/** Stage every change in the worktree, including untracked files. */
function stageAll(worktreePath: string): void {
  runGit(worktreePath, ["add", "-A"]);
}

/**
 * Commit the staged snapshot, returning whether hooks had to be bypassed.
 *
 * This commit exists solely to rescue an agent's work, so a hook that rejects
 * it costs the user that work. Retry once past the hooks rather than lose it.
 */
function commitStaged(worktreePath: string, message: string): boolean {
  try {
    runGit(worktreePath, ["commit", "-m", message]);
    return false;
  } catch (err) {
    debugLog("git commit rejected — retrying with --no-verify", err);
    // A hook may have rewritten files (prettier --write, rumdl fmt) before
    // failing; re-stage so those rewrites ride along instead of being lost.
    stageAll(worktreePath);
    runGit(worktreePath, ["commit", "--no-verify", "-m", message]);
    return true;
  }
}

/**
 * Create a branch at the worktree's HEAD, returning the name actually used.
 * If the preferred name is taken, a timestamp suffix avoids overwriting previous work.
 */
function createBranch(worktreePath: string, preferred: string): string {
  try {
    runGit(worktreePath, ["branch", preferred], 5000);
    return preferred;
  } catch (err) {
    debugLog("git branch", err);
    const fallback = `${preferred}-${Date.now()}`;
    runGit(worktreePath, ["branch", fallback], 5000);
    return fallback;
  }
}

/** Run a git command, returning its captured stdout. */
function runGit(cwd: string, args: string[], timeout = 10000): string {
  return execFileSync("git", args, { cwd, stdio: "pipe", timeout }).toString();
}

/**
 * Force-remove a worktree, discarding anything uncommitted in it.
 *
 * Throws when git refuses, so a caller acting on a user's instruction can say
 * why — unlike the internal best-effort removal below.
 */
export function discardWorktree(cwd: string, worktreePath: string): void {
  runGit(cwd, ["worktree", "remove", "--force", worktreePath]);
}

/**
 * Force-remove a worktree as part of cleanup, where failure is not actionable.
 */
function removeWorktree(cwd: string, worktreePath: string): void {
  try {
    discardWorktree(cwd, worktreePath);
  } catch (err) {
    debugLog("git worktree remove", err);
    try {
      execFileSync("git", ["worktree", "prune"], {
        cwd,
        stdio: "pipe",
        timeout: 5000,
      });
    } catch (pruneErr) {
      debugLog("git worktree prune", pruneErr);
    }
  }
}

/**
 * Prune any orphaned worktrees (crash recovery).
 */
export function pruneWorktrees(cwd: string): void {
  try {
    execFileSync("git", ["worktree", "prune"], {
      cwd,
      stdio: "pipe",
      timeout: 5000,
    });
  } catch (err) {
    debugLog("pruneWorktrees", err);
  }
}
