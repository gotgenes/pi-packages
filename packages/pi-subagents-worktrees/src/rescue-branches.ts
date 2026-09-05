/**
 * rescue-branches.ts — find the branches a successful cleanup left unmerged.
 *
 * `cleanupWorktree` commits a dirty worktree to `pi-agent-<id>` and reports the
 * branch in the child's result addendum. That addendum has a reader only while
 * a result is still being assembled, so a workspace torn down after the child's
 * result was delivered — or during shutdown, where the subagents core has no
 * channel at all — names its branch to nobody.
 *
 * This module is how a later session finds those branches again. It is a scan
 * of durable state rather than a record of what was dropped, so it also covers
 * a crash, where no cleanup ran to record anything.
 *
 * The sibling of `preserved.ts`: that one answers "what is still on disk?",
 * this one "what is committed but unmerged?" — different artifacts with
 * different remedies, so each reports itself.
 */

import { debugLog } from "#src/debug";
import { listUnmergedRescueBranches } from "#src/worktree";

/** How many branches the notice spells out before summarizing the rest. */
const NOTICE_BRANCH_LIMIT = 5;

/**
 * Rescue branches whose work is not on `HEAD`, in git's listing order.
 *
 * Returns nothing when git cannot answer — outside a repository, or before the
 * first commit.
 */
export function findUnmergedRescueBranches(repoCwd: string): string[] {
  try {
    return listUnmergedRescueBranches(repoCwd);
  } catch (err) {
    debugLog("git branch --list", err);
    return [];
  }
}

/** The startup warning naming unmerged rescue branches and what to do about them. */
export function formatRescueBranchNotice(branches: readonly string[]): string {
  const subject =
    branches.length === 1
      ? "1 subagent rescue branch holds work that was never merged"
      : `${branches.length} subagent rescue branches hold work that was never merged`;
  const listed = branches
    .slice(0, NOTICE_BRANCH_LIMIT)
    .map((branch) => `  ${branch}`)
    .join("\n");
  const hidden = branches.length - NOTICE_BRANCH_LIMIT;
  const tail = hidden > 0 ? `\n  …and ${hidden} more` : "";
  return (
    `${subject}:\n${listed}${tail}\n` +
    "A subagent saved its changes there and nothing reported it.\n" +
    "Merge one with `git merge <branch>`, or delete it once you are sure you do not want it."
  );
}
