/**
 * pi-subagents-worktrees — git worktree isolation for @gotgenes/pi-subagents.
 *
 * Registers a WorkspaceProvider (ADR 0002, Phase 16 Step 3) that runs opted-in
 * subagents in a temporary git worktree. The core consults the provider for
 * every child run; this package decides which agents get a worktree (via the
 * worktreeAgents config) and brackets the run with git plumbing.
 *
 * The provider is registered once at extension init via the published
 * SubagentsService, which requires @gotgenes/pi-subagents to have initialized
 * first — list this package after it in settings.json (Pi loads in order). If
 * the service is absent (not installed, or mis-ordered), the extension no-ops.
 */

import {
  type ExtensionAPI,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { getSubagentsService } from "@gotgenes/pi-subagents";
import { ActiveWorktrees } from "#src/active-worktrees";
import { loadWorktreesConfig } from "#src/config";
import { debugLog } from "#src/debug";
import { findPreservedWorktrees, formatPreservedNotice } from "#src/preserved";
import { registerPreservedWorktreesCommand } from "#src/preserved-command";
import {
  findUnmergedRescueBranches,
  formatRescueBranchNotice,
} from "#src/rescue-branches";
import { WorktreeWorkspaceProvider } from "#src/workspace-provider";
import { discardWorktree, pruneWorktrees } from "#src/worktree";

export default function piSubagentsWorktrees(pi: ExtensionAPI): void {
  const config = loadWorktreesConfig(getAgentDir(), process.cwd());

  // Best-effort crash recovery: clear worktrees orphaned by a prior crash.
  pruneWorktrees(process.cwd());

  const service = getSubagentsService();
  if (!service) {
    debugLog(
      "subagents service unavailable — worktree provider not registered",
      undefined,
    );
    return;
  }

  const live = new ActiveWorktrees();
  const unregister = service.registerWorkspaceProvider(
    new WorktreeWorkspaceProvider(config, live),
  );
  const repoCwd = process.cwd();
  const findPreserved = () => findPreservedWorktrees(repoCwd, live);

  // The rescue artifacts a session start reports: worktrees a failed cleanup
  // left on disk, and branches a successful one committed to that nobody
  // merged. Two notices rather than one, because they are different artifacts
  // with different remedies. A session with no UI (every subagent child) has
  // nowhere to show either, so it does not even look.
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    const preserved = findPreserved();
    if (preserved.length > 0) {
      ctx.ui.notify(formatPreservedNotice(preserved), "warning");
    }
    const unmerged = findUnmergedRescueBranches(repoCwd);
    if (unmerged.length > 0) {
      ctx.ui.notify(formatRescueBranchNotice(unmerged), "warning");
    }
  });

  registerPreservedWorktreesCommand(pi, {
    findPreserved,
    discard: (path) => discardWorktree(repoCwd, path),
  });

  pi.on("session_shutdown", () => unregister());
}
