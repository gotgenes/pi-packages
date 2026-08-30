import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActiveWorktrees } from "#src/active-worktrees";
import { WorktreeWorkspaceProvider } from "#src/workspace-provider";
import {
  initGitRepo,
  installPreCommitHook,
  lockGitIndex,
} from "#test/support/git-fixture";

/** Build a prepare context with sensible defaults. */
function ctx(overrides: {
  agentType: string;
  baseCwd: string;
  agentId?: string;
}) {
  return { agentId: "agent-1", ...overrides };
}

/** Build a provider that isolates the given agent types. */
function makeProvider(
  live: ActiveWorktrees = new ActiveWorktrees(),
  worktreeAgents = ["Explore"],
) {
  return new WorktreeWorkspaceProvider({ worktreeAgents }, live);
}

describe("WorktreeWorkspaceProvider", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = initGitRepo("pi-wt-prov-");
  });

  afterEach(() => {
    try {
      execFileSync("git", ["worktree", "prune"], {
        cwd: repoDir,
        stdio: "pipe",
      });
    } catch {
      /* ignore */
    }
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("returns undefined for an agent type not in worktreeAgents (no opt-in)", async () => {
    const provider = makeProvider();
    const workspace = await provider.prepare(
      ctx({ agentType: "general-purpose", baseCwd: repoDir }),
    );
    expect(workspace).toBeUndefined();
  });

  it("prepares a born-complete worktree for an opted-in agent type", async () => {
    const provider = makeProvider();
    const workspace = await provider.prepare(
      ctx({ agentType: "Explore", baseCwd: repoDir }),
    );
    expect(workspace).toBeDefined();
    expect(workspace?.cwd).toBeDefined();
    expect(workspace?.cwd).not.toBe(repoDir);
    expect(existsSync(workspace!.cwd)).toBe(true);
    // Clean up the worktree created by this test.
    workspace?.dispose({ status: "completed", description: "test" });
  });

  it("throws for an opted-in agent when the base dir is not a git repo", async () => {
    const nonRepo = mkdtempSync(join(tmpdir(), "pi-wt-nonrepo-"));
    const provider = makeProvider();
    await expect(
      provider.prepare(ctx({ agentType: "Explore", baseCwd: nonRepo })),
    ).rejects.toThrow(/worktree isolation/);
    rmSync(nonRepo, { recursive: true, force: true });
  });

  it("dispose returns undefined and removes the worktree when there are no changes", async () => {
    const provider = makeProvider();
    const workspace = await provider.prepare(
      ctx({ agentType: "Explore", baseCwd: repoDir }),
    );
    const wtPath = workspace!.cwd;
    const result = workspace!.dispose({
      status: "completed",
      description: "no-op run",
    });
    expect(result).toBeUndefined();
    expect(existsSync(wtPath)).toBe(false);
  });

  it("dispose returns a branch addendum and removes the worktree when changes exist", async () => {
    const provider = makeProvider();
    const workspace = await provider.prepare(
      ctx({ agentType: "Explore", baseCwd: repoDir, agentId: "abc123" }),
    );
    const wtPath = workspace!.cwd;
    writeFileSync(join(wtPath, "new-file.txt"), "agent output");

    const result = workspace!.dispose({
      status: "completed",
      description: "did work",
    });
    expect(result?.resultAddendum).toContain("Changes saved to branch");
    expect(result?.resultAddendum).toContain("pi-agent-abc123");
    expect(result?.resultAddendum).toContain("git merge");
    expect(existsSync(wtPath)).toBe(false);

    // The branch persists in the base repo.
    const branches = execFileSync("git", ["branch", "--list"], {
      cwd: repoDir,
    }).toString();
    expect(branches).toContain("pi-agent-abc123");
  });

  it("dispose notes when hooks were bypassed to save the work", async () => {
    const provider = makeProvider();
    const workspace = await provider.prepare(
      ctx({ agentType: "Explore", baseCwd: repoDir, agentId: "bypass-1" }),
    );
    writeFileSync(join(workspace!.cwd, "agent-output.txt"), "agent output");
    installPreCommitHook(repoDir, "exit 1");

    const result = workspace!.dispose({
      status: "completed",
      description: "did work",
    });

    expect(result?.resultAddendum).toContain("Changes saved to branch");
    expect(result?.resultAddendum).toContain("hooks were bypassed");
  });

  it("dispose reports the preserved worktree when cleanup fails", async () => {
    const provider = makeProvider();
    const workspace = await provider.prepare(
      ctx({ agentType: "Explore", baseCwd: repoDir, agentId: "fail-1" }),
    );
    const wtPath = workspace!.cwd;
    writeFileSync(join(wtPath, "agent-output.txt"), "agent output");
    lockGitIndex(wtPath);

    const result = workspace!.dispose({
      status: "completed",
      description: "did work",
    });

    expect(result?.resultAddendum).toContain("left in place");
    expect(result?.resultAddendum).toContain(wtPath);
    expect(existsSync(wtPath)).toBe(true);

    // This test deliberately leaves a worktree behind; remove it here since
    // the shared afterEach only prunes administrative entries.
    execFileSync("git", ["worktree", "remove", "--force", wtPath], {
      cwd: repoDir,
      stdio: "pipe",
    });
  });

  describe("live worktree registration", () => {
    it("records the worktree while the child runs and forgets it on dispose", async () => {
      const live = new ActiveWorktrees();
      const provider = makeProvider(live);
      const workspace = await provider.prepare(
        ctx({ agentType: "Explore", baseCwd: repoDir }),
      );
      const resolved = realpathSync(workspace!.cwd);

      expect(live.contains(resolved)).toBe(true);

      workspace!.dispose({ status: "completed", description: "no-op run" });

      expect(live.contains(resolved)).toBe(false);
    });

    it("forgets the worktree once its changes are committed", async () => {
      const live = new ActiveWorktrees();
      const provider = makeProvider(live);
      const workspace = await provider.prepare(
        ctx({ agentType: "Explore", baseCwd: repoDir, agentId: "live-1" }),
      );
      const resolved = realpathSync(workspace!.cwd);
      writeFileSync(join(workspace!.cwd, "new-file.txt"), "agent output");

      workspace!.dispose({ status: "completed", description: "did work" });

      expect(live.contains(resolved)).toBe(false);
    });

    it("forgets a preserved worktree, so the scan can report it", async () => {
      const live = new ActiveWorktrees();
      const provider = makeProvider(live);
      const workspace = await provider.prepare(
        ctx({ agentType: "Explore", baseCwd: repoDir, agentId: "live-2" }),
      );
      const wtPath = workspace!.cwd;
      const resolved = realpathSync(wtPath);
      writeFileSync(join(wtPath, "agent-output.txt"), "agent output");
      lockGitIndex(wtPath);

      workspace!.dispose({ status: "completed", description: "did work" });

      expect(live.contains(resolved)).toBe(false);
      expect(existsSync(wtPath)).toBe(true);

      execFileSync("git", ["worktree", "remove", "--force", wtPath], {
        cwd: repoDir,
        stdio: "pipe",
      });
    });
  });
});
