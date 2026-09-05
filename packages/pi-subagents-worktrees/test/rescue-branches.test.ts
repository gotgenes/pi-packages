import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findUnmergedRescueBranches,
  formatRescueBranchNotice,
} from "#src/rescue-branches";
import { initGitRepo } from "#test/support/git-fixture";

const repos: string[] = [];

afterEach(() => {
  for (const dir of repos.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function makeRepo(): string {
  const dir = initGitRepo("rescue-branches-");
  repos.push(dir);
  return dir;
}

/** Commit a file on `branch`, branched from HEAD, leaving HEAD where it was. */
function commitOnBranch(repo: string, branch: string): void {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  git("checkout", "-b", branch);
  writeFileSync(join(repo, `${branch}.txt`), "work");
  git("add", "-A");
  git("commit", "-m", `work on ${branch}`);
  git("checkout", "-");
}

describe("findUnmergedRescueBranches", () => {
  it("names a rescue branch holding work that is not on HEAD", () => {
    const repo = makeRepo();
    commitOnBranch(repo, "pi-agent-abc123");

    expect(findUnmergedRescueBranches(repo)).toEqual(["pi-agent-abc123"]);
  });

  it("drops a rescue branch once its work has been merged", () => {
    const repo = makeRepo();
    commitOnBranch(repo, "pi-agent-abc123");
    execFileSync("git", ["merge", "pi-agent-abc123"], {
      cwd: repo,
      stdio: "pipe",
    });

    expect(findUnmergedRescueBranches(repo)).toEqual([]);
  });

  it("ignores a branch this package did not create", () => {
    const repo = makeRepo();
    commitOnBranch(repo, "feature-work");

    expect(findUnmergedRescueBranches(repo)).toEqual([]);
  });

  it("returns nothing for a repository with no rescue branches", () => {
    expect(findUnmergedRescueBranches(makeRepo())).toEqual([]);
  });

  it("returns nothing, rather than throwing, outside a git repository", () => {
    const dir = mkdtempSync(join(tmpdir(), "rescue-branches-nogit-"));
    repos.push(dir);

    expect(findUnmergedRescueBranches(dir)).toEqual([]);
  });
});

describe("formatRescueBranchNotice", () => {
  it("names the single branch and how to recover it", () => {
    const notice = formatRescueBranchNotice(["pi-agent-abc123"]);

    expect(notice).toContain("1 subagent rescue branch");
    expect(notice).toContain("pi-agent-abc123");
    expect(notice).toContain("git merge");
  });

  it("counts several branches in the plural", () => {
    const notice = formatRescueBranchNotice(["pi-agent-a", "pi-agent-b"]);

    expect(notice).toContain("2 subagent rescue branches");
    expect(notice).toContain("pi-agent-a");
    expect(notice).toContain("pi-agent-b");
  });

  it("summarizes the tail beyond the fifth branch", () => {
    const notice = formatRescueBranchNotice([
      "pi-agent-1",
      "pi-agent-2",
      "pi-agent-3",
      "pi-agent-4",
      "pi-agent-5",
      "pi-agent-6",
      "pi-agent-7",
    ]);

    expect(notice).toContain("pi-agent-5");
    expect(notice).not.toContain("pi-agent-6");
    expect(notice).toContain("…and 2 more");
  });
});
