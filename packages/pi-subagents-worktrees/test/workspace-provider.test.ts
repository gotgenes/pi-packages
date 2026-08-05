import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorktreeWorkspaceProvider } from "#src/workspace-provider";

/** Create a temporary git repo with an initial commit. */
function initGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-wt-prov-"));
  execFileSync("git", ["init"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@test.com"], {
    cwd: dir,
    stdio: "pipe",
  });
  execFileSync("git", ["config", "user.name", "Test"], {
    cwd: dir,
    stdio: "pipe",
  });
  writeFileSync(join(dir, "README.md"), "# Test repo");
  execFileSync("git", ["add", "README.md"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: dir, stdio: "pipe" });
  return dir;
}

/** Build a prepare context with sensible defaults. */
function ctx(overrides: {
  agentType: string;
  baseCwd: string;
  agentId?: string;
}) {
  return { agentId: "agent-1", invocation: undefined, ...overrides };
}

describe("WorktreeWorkspaceProvider", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = initGitRepo();
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
    const provider = new WorktreeWorkspaceProvider({
      worktreeAgents: ["Explore"],
    });
    const workspace = await provider.prepare(
      ctx({ agentType: "general-purpose", baseCwd: repoDir }),
    );
    expect(workspace).toBeUndefined();
  });

  it("prepares a born-complete worktree for an opted-in agent type", async () => {
    const provider = new WorktreeWorkspaceProvider({
      worktreeAgents: ["Explore"],
    });
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
    const provider = new WorktreeWorkspaceProvider({
      worktreeAgents: ["Explore"],
    });
    await expect(
      provider.prepare(ctx({ agentType: "Explore", baseCwd: nonRepo })),
    ).rejects.toThrow(/worktree isolation/);
    rmSync(nonRepo, { recursive: true, force: true });
  });

  it("dispose returns undefined and removes the worktree when there are no changes", async () => {
    const provider = new WorktreeWorkspaceProvider({
      worktreeAgents: ["Explore"],
    });
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
    const provider = new WorktreeWorkspaceProvider({
      worktreeAgents: ["Explore"],
    });
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

  it("dispose surfaces a cleanup failure instead of silently reporting no changes", async () => {
    const provider = new WorktreeWorkspaceProvider({
      worktreeAgents: ["Explore"],
    });
    const workspace = await provider.prepare(
      ctx({ agentType: "Explore", baseCwd: repoDir, agentId: "fail-1" }),
    );
    const wtPath = workspace!.cwd;
    writeFileSync(join(wtPath, "new-file.txt"), "agent output");

    // Install a pre-commit hook that always fails, forcing the underlying
    // `cleanupWorktree` commit to throw partway through the changes-exist
    // path. Worktrees share the main repo's hooks directory.
    const hookPath = join(repoDir, ".git", "hooks", "pre-commit");
    writeFileSync(hookPath, "#!/bin/sh\nexit 1\n");
    chmodSync(hookPath, 0o755);

    const result = workspace!.dispose({
      status: "completed",
      description: "did work",
    });

    expect(result?.resultAddendum).toContain("cleanup failed");
    expect(result?.resultAddendum).toContain(wtPath);
    expect(existsSync(wtPath)).toBe(true);

    // Cleanup this test's own preserved worktree.
    try {
      execFileSync("git", ["worktree", "remove", "--force", wtPath], {
        cwd: repoDir,
        stdio: "pipe",
      });
    } catch {
      /* ignore */
    }
  });
});
