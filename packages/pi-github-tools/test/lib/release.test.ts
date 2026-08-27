import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRunCommand = vi.hoisted(() => vi.fn());
const mockSleep = vi.hoisted(() => vi.fn());

vi.mock("../../src/lib/process", () => ({
  runCommand: mockRunCommand,
  sleep: mockSleep,
}));

import { findReleasePR, mergeReleasePR, watchRelease } from "#src/lib/release";

beforeEach(() => {
  mockRunCommand.mockReset();
  mockSleep.mockReset();
  mockSleep.mockResolvedValue(undefined);
});

function mockGhJson(value: unknown) {
  mockRunCommand.mockResolvedValueOnce({
    stdout: JSON.stringify(value),
    stderr: "",
    exitCode: 0,
  });
}

function mockCmd(stdout: string) {
  mockRunCommand.mockResolvedValueOnce({
    stdout,
    stderr: "",
    exitCode: 0,
  });
}

function mockCmdFail(stderr: string) {
  mockRunCommand.mockResolvedValueOnce({
    stdout: "",
    stderr,
    exitCode: 1,
  });
}

/** Make the next sleep abort the controller, as a real abort would. */
function mockSleepAborts(controller: AbortController) {
  mockSleep.mockImplementationOnce(() => {
    controller.abort();
    return Promise.reject(new Error("The operation was aborted."));
  });
}

describe("findReleasePR", () => {
  it("finds a release-please PR on first poll", async () => {
    mockGhJson([
      {
        number: 42,
        title: "chore(main): release 1.2.0",
        headRefName: "release-please--branches--main",
        url: "https://github.com/o/r/pull/42",
        mergeable: "MERGEABLE",
        mergeStateStatus: "CLEAN",
      },
    ]);

    const result = await findReleasePR({ timeout: 120 });
    expect(result).toContain("pr_number: 42");
    expect(result).toContain("release 1.2.0");
  });

  it("returns timeout when no PR appears", async () => {
    // Empty list on every poll
    mockGhJson([]);

    const result = await findReleasePR({ timeout: 0 });
    expect(result).toContain("timeout:");
  });

  it("invokes onProgress on retries", async () => {
    const onProgress = vi.fn();
    mockGhJson([]);
    mockGhJson([]);

    await findReleasePR({ timeout: 5, onProgress });
    expect(onProgress).toHaveBeenCalled();
  });

  it("returns abort message when signal fires during sleep", async () => {
    const controller = new AbortController();
    mockGhJson([]);
    mockSleepAborts(controller);

    const result = await findReleasePR({
      timeout: 120,
      signal: controller.signal,
    });
    expect(result).toContain("aborted:");
    expect(result).toContain("cancelled by user");
  });

  it("surfaces a gh failure instead of blaming the user", async () => {
    mockCmdFail("HTTP 404: Not Found");

    await expect(findReleasePR({ timeout: 120 })).rejects.toThrow(
      /HTTP 404: Not Found/,
    );
  });

  it("retries a transient failure and reports the wait", async () => {
    mockCmdFail("HTTP 503");
    mockGhJson([
      {
        number: 42,
        title: "chore(main): release 1.2.0",
        headRefName: "release-please--branches--main",
        url: "https://github.com/o/r/pull/42",
        mergeable: "MERGEABLE",
        mergeStateStatus: "CLEAN",
      },
    ]);

    const onProgress = vi.fn();
    const result = await findReleasePR({ timeout: 120, onProgress });

    expect(result).toContain("pr_number: 42");
    expect(mockSleep).toHaveBeenCalledWith(1000, undefined);
    expect(onProgress).toHaveBeenCalledWith(
      expect.stringContaining("transient gh failure, retry 1/3 in 1s"),
    );
  });

  it("charges the retry backoff against the timeout", async () => {
    mockCmdFail("HTTP 503");
    mockGhJson([]);

    const result = await findReleasePR({ timeout: 0 });

    expect(result).toContain("timeout: no release-please PR found");
    expect(result).toContain("elapsed: 1s");
  });
});

describe("mergeReleasePR", () => {
  function setupMergeMocks() {
    // gh pr view (check state)
    mockGhJson({
      number: 42,
      title: "chore(main): release 1.2.0",
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      statusCheckRollup: [],
    });
    // gh pr merge
    mockCmd("merged");
    // git pull --ff-only
    mockRunCommand.mockResolvedValueOnce({
      stdout: "Already up to date.\n",
      stderr: "",
      exitCode: 0,
    });
    // git rev-parse HEAD
    mockRunCommand.mockResolvedValueOnce({
      stdout: "abc1234567890\n",
      stderr: "",
      exitCode: 0,
    });
  }

  it("defaults to --merge when no method is specified", async () => {
    setupMergeMocks();

    const result = await mergeReleasePR({ prNumber: 42 });
    expect(result.isError).toBe(false);
    expect(result.content).toContain("Merged PR #42");
    expect(result.content).toContain("abc1234");

    expect(mockRunCommand).toHaveBeenNthCalledWith(2, {
      cmd: "gh",
      args: ["pr", "merge", "42", "--merge"],
      signal: undefined,
    });
    expect(mockRunCommand).toHaveBeenNthCalledWith(3, {
      cmd: "git",
      args: ["pull", "--ff-only"],
      signal: undefined,
    });
    expect(mockRunCommand).toHaveBeenNthCalledWith(4, {
      cmd: "git",
      args: ["rev-parse", "HEAD"],
      signal: undefined,
    });
  });

  it("uses --squash when method is squash", async () => {
    setupMergeMocks();
    await mergeReleasePR({ prNumber: 42, method: "squash" });
    expect(mockRunCommand).toHaveBeenNthCalledWith(2, {
      cmd: "gh",
      args: ["pr", "merge", "42", "--squash"],
      signal: undefined,
    });
  });

  it("uses --merge when method is merge", async () => {
    setupMergeMocks();
    await mergeReleasePR({ prNumber: 42, method: "merge" });
    expect(mockRunCommand).toHaveBeenNthCalledWith(2, {
      cmd: "gh",
      args: ["pr", "merge", "42", "--merge"],
      signal: undefined,
    });
  });

  it("returns error when PR is not mergeable", async () => {
    mockGhJson({
      number: 42,
      title: "chore(main): release 1.2.0",
      mergeable: "CONFLICTING",
      mergeStateStatus: "BLOCKED",
    });

    const result = await mergeReleasePR({ prNumber: 42 });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("not mergeable");
  });

  it("threads signal to gh and git calls", async () => {
    setupMergeMocks();
    const controller = new AbortController();
    await mergeReleasePR({ prNumber: 42, signal: controller.signal });
    expect(mockRunCommand).toHaveBeenNthCalledWith(1, {
      cmd: "gh",
      args: [
        "pr",
        "view",
        "42",
        "--json",
        "number,title,mergeable,mergeStateStatus,statusCheckRollup",
      ],
      signal: controller.signal,
    });
    expect(mockRunCommand).toHaveBeenNthCalledWith(2, {
      cmd: "gh",
      args: ["pr", "merge", "42", "--merge"],
      signal: controller.signal,
    });
    expect(mockRunCommand).toHaveBeenNthCalledWith(3, {
      cmd: "git",
      args: ["pull", "--ff-only"],
      signal: controller.signal,
    });
  });

  it("waits for an in-progress check then merges once CLEAN", async () => {
    // first poll: UNSTABLE with an IN_PROGRESS check
    mockGhJson({
      number: 42,
      title: "chore(main): release 1.2.0",
      mergeable: "MERGEABLE",
      mergeStateStatus: "UNSTABLE",
      statusCheckRollup: [
        {
          __typename: "CheckRun",
          name: "check",
          status: "IN_PROGRESS",
          conclusion: null,
        },
      ],
    });
    // second poll: CLEAN
    mockGhJson({
      number: 42,
      title: "chore(main): release 1.2.0",
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      statusCheckRollup: [],
    });
    mockCmd("merged");
    mockRunCommand.mockResolvedValueOnce({
      stdout: "Already up to date.\n",
      stderr: "",
      exitCode: 0,
    });
    mockRunCommand.mockResolvedValueOnce({
      stdout: "abc1234567890\n",
      stderr: "",
      exitCode: 0,
    });

    const onProgress = vi.fn();
    const result = await mergeReleasePR({ prNumber: 42, onProgress });

    expect(result.isError).toBe(false);
    expect(result.content).toContain("Merged PR #42");
    expect(onProgress).toHaveBeenCalledWith(
      "checks: [0/1] check — in_progress (0s)",
    );
    expect(mockSleep).toHaveBeenCalledTimes(1);
    expect(mockSleep).toHaveBeenCalledWith(10000, undefined);
  });

  it("polls while mergeability is UNKNOWN then merges once resolved", async () => {
    mockGhJson({
      number: 42,
      title: "chore(main): release 1.2.0",
      mergeable: "UNKNOWN",
      mergeStateStatus: "UNKNOWN",
      statusCheckRollup: [],
    });
    mockGhJson({
      number: 42,
      title: "chore(main): release 1.2.0",
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      statusCheckRollup: [],
    });
    mockCmd("merged");
    mockRunCommand.mockResolvedValueOnce({
      stdout: "Already up to date.\n",
      stderr: "",
      exitCode: 0,
    });
    mockRunCommand.mockResolvedValueOnce({
      stdout: "abc1234567890\n",
      stderr: "",
      exitCode: 0,
    });

    const onProgress = vi.fn();
    const result = await mergeReleasePR({ prNumber: 42, onProgress });

    expect(result.isError).toBe(false);
    expect(onProgress).toHaveBeenCalledWith(
      "waiting for GitHub to compute mergeability... (0s)",
    );
  });

  it("blocks with a reason when the rollup is empty", async () => {
    mockGhJson({
      number: 42,
      title: "chore(main): release 1.2.0",
      mergeable: "MERGEABLE",
      mergeStateStatus: "UNSTABLE",
      statusCheckRollup: [],
    });

    const result = await mergeReleasePR({ prNumber: 42 });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("PR #42 is not mergeable");
    expect(result.content).toContain(
      "reason: no checks reported (statusCheckRollup is empty)",
    );
  });

  it("blocks with a reason naming a failing check", async () => {
    mockGhJson({
      number: 42,
      title: "chore(main): release 1.2.0",
      mergeable: "MERGEABLE",
      mergeStateStatus: "UNSTABLE",
      statusCheckRollup: [
        {
          __typename: "CheckRun",
          name: "check",
          status: "COMPLETED",
          conclusion: "FAILURE",
        },
      ],
    });

    const result = await mergeReleasePR({ prNumber: 42 });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("reason: check failed: check");
  });

  it("returns a timeout result when checks never settle", async () => {
    mockGhJson({
      number: 42,
      title: "chore(main): release 1.2.0",
      mergeable: "MERGEABLE",
      mergeStateStatus: "UNSTABLE",
      statusCheckRollup: [
        {
          __typename: "CheckRun",
          name: "check",
          status: "IN_PROGRESS",
          conclusion: null,
        },
      ],
    });

    const result = await mergeReleasePR({ prNumber: 42, timeout: 0 });
    expect(result.isError).toBe(true);
    expect(result.content).toBe(
      [
        "timeout: PR #42 did not become mergeable within 0s",
        "  mergeable: MERGEABLE",
        "  merge_state: UNSTABLE",
        "  title: chore(main): release 1.2.0",
        "  checks: [0/1] check — in_progress (0s)",
      ].join("\n"),
    );
    expect(mockSleep).not.toHaveBeenCalled();
  });

  it("returns abort message when signal fires during the wait", async () => {
    const controller = new AbortController();
    mockGhJson({
      number: 42,
      title: "chore(main): release 1.2.0",
      mergeable: "MERGEABLE",
      mergeStateStatus: "UNSTABLE",
      statusCheckRollup: [
        {
          __typename: "CheckRun",
          name: "check",
          status: "IN_PROGRESS",
          conclusion: null,
        },
      ],
    });
    mockSleepAborts(controller);

    const result = await mergeReleasePR({
      prNumber: 42,
      signal: controller.signal,
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("aborted:");
    expect(result.content).toContain("cancelled by user");
    expect(mockSleep).toHaveBeenCalledWith(10000, controller.signal);
  });

  describe("when a read fails transiently", () => {
    function mockCleanPR() {
      mockGhJson({
        number: 42,
        title: "chore(main): release 1.2.0",
        mergeable: "MERGEABLE",
        mergeStateStatus: "CLEAN",
        statusCheckRollup: [],
      });
    }

    it("retries the precheck and merges once it succeeds", async () => {
      mockCmdFail("HTTP 503");
      mockCleanPR();
      mockCmd("merged");
      mockCmd("Already up to date.\n");
      mockCmd("abc1234567890\n");

      const onProgress = vi.fn();
      const result = await mergeReleasePR({ prNumber: 42, onProgress });

      expect(result.isError).toBe(false);
      expect(result.content).toContain("Merged PR #42");
      expect(mockSleep).toHaveBeenCalledWith(1000, undefined);
      expect(onProgress).toHaveBeenCalledWith(
        "transient gh failure, retry 1/3 in 1s: gh pr view 42 --json number,title,mergeable,mergeStateStatus,statusCheckRollup failed (exit 1): HTTP 503",
      );
    });

    it("charges the retry backoff against the timeout", async () => {
      mockCmdFail("HTTP 503");
      mockCmdFail("HTTP 503");
      mockGhJson({
        number: 42,
        title: "chore(main): release 1.2.0",
        mergeable: "UNKNOWN",
        mergeStateStatus: "UNKNOWN",
        statusCheckRollup: [],
      });

      const result = await mergeReleasePR({ prNumber: 42, timeout: 3 });

      expect(result.content).toContain(
        "timeout: PR #42 did not become mergeable within 3s",
      );
      expect(result.content).toContain(
        "waiting for GitHub to compute mergeability... (5s)",
      );
      expect(mockSleep.mock.calls.map((call) => call[0])).toEqual([1000, 4000]);
    });
  });

  describe("when the merge call itself fails", () => {
    const mergeError =
      "gh pr merge 42 --merge failed (exit 1): HTTP 503" as const;

    function mockReadyThenFailedMerge() {
      mockGhJson({
        number: 42,
        title: "chore(main): release 1.2.0",
        mergeable: "MERGEABLE",
        mergeStateStatus: "CLEAN",
        statusCheckRollup: [],
      });
      mockCmdFail("HTTP 503");
    }

    it("reports success when the merge landed anyway", async () => {
      mockReadyThenFailedMerge();
      mockGhJson({
        merged: true,
        state: "closed",
        merge_commit_sha: "e1292fd5d598b79c94a23968b42b86ad5ba9647f",
      });
      mockCmd("Already up to date.\n");
      mockCmd("abc1234567890\n");

      const result = await mergeReleasePR({ prNumber: 42 });

      expect(result.isError).toBe(false);
      expect(result.content).toBe(
        [
          "Merged PR #42: chore(main): release 1.2.0",
          "head_sha: abc1234567890",
          "short_sha: abc1234",
          `note: the merge call failed (${mergeError}) but the merge landed`,
          "verified: merged via REST (merge_commit_sha: e1292fd5d598b79c94a23968b42b86ad5ba9647f)",
        ].join("\n"),
      );
      expect(mockRunCommand).toHaveBeenNthCalledWith(3, {
        cmd: "gh",
        args: [
          "api",
          "repos/{owner}/{repo}/pulls/42",
          "--jq",
          "{state:.state,merged:.merged,merge_commit_sha:.merge_commit_sha}",
        ],
        signal: undefined,
      });
      expect(mockRunCommand).toHaveBeenNthCalledWith(4, {
        cmd: "git",
        args: ["pull", "--ff-only"],
        signal: undefined,
      });
    });

    it("reports a retryable failure when the merge did not land", async () => {
      mockReadyThenFailedMerge();
      mockGhJson({ merged: false, state: "open", merge_commit_sha: null });

      const result = await mergeReleasePR({ prNumber: 42 });

      expect(result.isError).toBe(true);
      expect(result.content).toBe(
        [
          "failed to merge PR #42",
          "  merged: false",
          "  state: open",
          `  error: ${mergeError}`,
          "  verified: not merged via REST",
          "  safe to retry: yes",
        ].join("\n"),
      );
      expect(mockRunCommand).toHaveBeenCalledTimes(3);
    });

    it("refuses to guess when the verification also fails", async () => {
      mockReadyThenFailedMerge();
      mockCmdFail("HTTP 404: Not Found");

      const result = await mergeReleasePR({ prNumber: 42 });

      expect(result.isError).toBe(true);
      expect(result.content).toBe(
        [
          "failed to merge PR #42",
          "  merged: unknown",
          `  error: ${mergeError}`,
          "  verification_error: gh api repos/{owner}/{repo}/pulls/42 --jq {state:.state,merged:.merged,merge_commit_sha:.merge_commit_sha} failed (exit 1): HTTP 404: Not Found",
          "  safe to retry: no — verify by hand with: gh api 'repos/{owner}/{repo}/pulls/42' --jq '{state:.state,merged:.merged}'",
        ].join("\n"),
      );
    });

    it("threads the signal through the verification", async () => {
      const controller = new AbortController();
      mockReadyThenFailedMerge();
      mockGhJson({ merged: false, state: "open", merge_commit_sha: null });

      await mergeReleasePR({ prNumber: 42, signal: controller.signal });

      expect(mockRunCommand).toHaveBeenNthCalledWith(3, {
        cmd: "gh",
        args: [
          "api",
          "repos/{owner}/{repo}/pulls/42",
          "--jq",
          "{state:.state,merged:.merged,merge_commit_sha:.merge_commit_sha}",
        ],
        signal: controller.signal,
      });
    });
  });
});

describe("watchRelease", () => {
  it("returns when a tag is found on HEAD", async () => {
    // git fetch --tags
    mockRunCommand.mockResolvedValueOnce({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    // git tag --points-at HEAD
    mockRunCommand.mockResolvedValueOnce({
      stdout: "v1.2.0\n",
      stderr: "",
      exitCode: 0,
    });
    // git rev-parse HEAD
    mockRunCommand.mockResolvedValueOnce({
      stdout: "abc1234567890\n",
      stderr: "",
      exitCode: 0,
    });

    const result = await watchRelease({ timeout: 120 });
    expect(result).toContain("v1.2.0");

    expect(mockRunCommand).toHaveBeenNthCalledWith(1, {
      cmd: "git",
      args: ["fetch", "--tags"],
      signal: undefined,
    });
    expect(mockRunCommand).toHaveBeenNthCalledWith(2, {
      cmd: "git",
      args: ["tag", "--points-at", "HEAD"],
      signal: undefined,
    });
    expect(mockRunCommand).toHaveBeenNthCalledWith(3, {
      cmd: "git",
      args: ["rev-parse", "HEAD"],
      signal: undefined,
    });
  });

  it("returns timeout when no tag appears", async () => {
    // git fetch --tags
    mockCmd("");
    // No tags on first poll
    mockCmd("\n");

    const result = await watchRelease({ timeout: 0 });
    expect(result).toContain("timeout:");
  });

  it("returns abort message when signal fires during sleep", async () => {
    const controller = new AbortController();
    // git fetch --tags
    mockCmd("");
    // No tags
    mockCmd("\n");
    mockSleepAborts(controller);

    const result = await watchRelease({
      timeout: 180,
      signal: controller.signal,
    });
    expect(result).toContain("aborted:");
    expect(result).toContain("cancelled by user");
  });

  it("surfaces a git failure instead of blaming the user", async () => {
    mockCmdFail("fatal: unable to access remote");

    await expect(watchRelease({ timeout: 180 })).rejects.toThrow(
      /git fetch --tags failed/,
    );
  });
});
