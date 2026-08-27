import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRunCommand = vi.hoisted(() => vi.fn());
const mockSleep = vi.hoisted(() => vi.fn());

vi.mock("../../src/lib/process", () => ({
  runCommand: mockRunCommand,
  sleep: mockSleep,
}));

import { findRun, listRuns, watchRun } from "#src/lib/ci";

beforeEach(() => {
  mockRunCommand.mockReset();
  mockSleep.mockReset();
  mockSleep.mockResolvedValue(undefined);
});

/** Helper to make gh return JSON for a given call. */
function mockGhJson(value: unknown) {
  mockRunCommand.mockResolvedValueOnce({
    stdout: JSON.stringify(value),
    stderr: "",
    exitCode: 0,
  });
}

/** Helper to make gh fail for a given call. */
function mockGhFail(stderr: string) {
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

describe("transient failures", () => {
  const sha = "abc1234567890abcdef1234567890abcdef123456";

  function mockMatchingRun() {
    mockGhJson([
      {
        databaseId: 100,
        url: "https://github.com/o/r/actions/runs/100",
        status: "in_progress",
        conclusion: null,
        headSha: sha,
        displayTitle: "CI",
        name: "CI",
      },
    ]);
  }

  it("findRun retries the run list and reports the wait", async () => {
    mockGhFail("HTTP 503");
    mockMatchingRun();
    mockGhJson({
      jobs: [{ name: "build", status: "in_progress", conclusion: null }],
    });

    const onProgress = vi.fn();
    const result = await findRun({
      workflow: "ci",
      expectedSha: sha,
      timeout: 120,
      onProgress,
    });

    expect(result).toContain("run_id: 100");
    expect(mockSleep).toHaveBeenCalledWith(1000, undefined);
    expect(onProgress).toHaveBeenCalledWith(
      expect.stringContaining("transient gh failure, retry 1/3 in 1s"),
    );
  });

  it("findRun charges the retry backoff against the timeout", async () => {
    mockGhFail("HTTP 503");
    mockGhJson([]);

    const result = await findRun({
      workflow: "ci",
      expectedSha: sha,
      timeout: 0,
    });

    expect(result).toContain("timeout: no run found");
    expect(result).toContain("elapsed: 1s");
  });

  it("watchRun retries the run view", async () => {
    mockGhFail("HTTP 503");
    mockGhJson({
      status: "completed",
      conclusion: "success",
      name: "CI",
      headSha: sha,
      jobs: [{ name: "build", status: "completed", conclusion: "success" }],
    });

    const result = await watchRun({ workflow: "ci", runId: 100 });

    expect(result).toContain("success");
    expect(mockSleep).toHaveBeenCalledWith(1000, undefined);
  });

  it("listRuns retries the run list", async () => {
    mockGhFail("HTTP 503");
    mockGhJson([]);

    const result = await listRuns({ workflow: "ci" });

    expect(result).toContain("No runs found");
    expect(mockSleep).toHaveBeenCalledWith(1000, undefined);
  });
});

describe("findRun", () => {
  const sha = "abc1234567890abcdef1234567890abcdef123456";

  it("returns structured output on first-poll match", async () => {
    // gh run list
    mockGhJson([
      {
        databaseId: 100,
        url: "https://github.com/o/r/actions/runs/100",
        status: "in_progress",
        conclusion: null,
        headSha: sha,
        displayTitle: "CI",
        name: "CI",
      },
    ]);
    // gh run view (jobs)
    mockGhJson({
      jobs: [{ name: "build", status: "in_progress", conclusion: null }],
    });

    const result = await findRun({
      workflow: "ci",
      expectedSha: sha,
      timeout: 120,
    });
    expect(result).toContain("run_id: 100");
    expect(result).toContain(`sha: ${sha}`);
    expect(result).toContain("build");
  });

  it("retries with backoff and finds the run on a later poll", async () => {
    // First poll: no match
    mockGhJson([
      {
        databaseId: 50,
        url: "https://github.com/o/r/actions/runs/50",
        status: "completed",
        conclusion: "success",
        headSha: "aaaa",
        displayTitle: "Old",
        name: "CI",
      },
    ]);
    // Second poll: match
    mockGhJson([
      {
        databaseId: 101,
        url: "https://github.com/o/r/actions/runs/101",
        status: "queued",
        conclusion: null,
        headSha: sha,
        displayTitle: "CI",
        name: "CI",
      },
    ]);
    // gh run view (jobs)
    mockGhJson({ jobs: [] });

    const result = await findRun({
      workflow: "ci",
      expectedSha: sha,
      timeout: 120,
    });
    expect(result).toContain("run_id: 101");
    expect(mockSleep).toHaveBeenCalled();
  });

  it("returns timeout message when run never appears", async () => {
    // Return non-matching run on every poll
    const nonMatching = [
      {
        databaseId: 50,
        url: "https://github.com/o/r/actions/runs/50",
        status: "completed",
        conclusion: "success",
        headSha: "aaaa",
        displayTitle: "Old",
        name: "CI",
      },
    ];
    // With timeout=0, the first poll should immediately timeout
    mockGhJson(nonMatching);

    const result = await findRun({
      workflow: "ci",
      expectedSha: sha,
      timeout: 0,
    });
    expect(result).toContain("timeout:");
    expect(result).toContain("last_seen_sha:");
  });

  it("invokes onProgress callback", async () => {
    const onProgress = vi.fn();
    // First poll: no match
    mockGhJson([]);
    // Second poll: timeout triggers
    mockGhJson([]);

    await findRun({
      workflow: "ci",
      expectedSha: sha,
      timeout: 5,
      onProgress,
    });
    expect(onProgress).toHaveBeenCalled();
  });

  it("returns abort message when signal fires during sleep", async () => {
    const controller = new AbortController();
    // First poll: no match
    mockGhJson([]);
    mockSleepAborts(controller);

    const result = await findRun({
      workflow: "ci",
      expectedSha: sha,
      timeout: 120,
      signal: controller.signal,
    });
    expect(result).toContain("aborted:");
    expect(result).toContain("cancelled by user");
  });

  it("surfaces a gh failure instead of blaming the user", async () => {
    mockGhFail("HTTP 404: Not Found");

    await expect(
      findRun({ workflow: "ci", expectedSha: sha, timeout: 120 }),
    ).rejects.toThrow(/HTTP 404: Not Found/);
  });
});

describe("watchRun", () => {
  it("returns immediately when run is already completed", async () => {
    mockGhJson({
      status: "completed",
      conclusion: "success",
      name: "CI",
      headSha: "abc1234",
      jobs: [{ name: "build", status: "completed", conclusion: "success" }],
    });

    const result = await watchRun({
      workflow: "ci",
      runId: 100,
      timeout: 300,
    });
    expect(result).toContain("success");
    expect(mockSleep).not.toHaveBeenCalled();
  });

  it("polls until the run completes", async () => {
    // First poll: in progress
    mockGhJson({
      status: "in_progress",
      conclusion: null,
      name: "CI",
      headSha: "abc1234",
      jobs: [{ name: "build", status: "in_progress", conclusion: null }],
    });
    // Second poll: completed
    mockGhJson({
      status: "completed",
      conclusion: "success",
      name: "CI",
      headSha: "abc1234",
      jobs: [{ name: "build", status: "completed", conclusion: "success" }],
    });

    const result = await watchRun({
      workflow: "ci",
      runId: 100,
      timeout: 300,
    });
    expect(result).toContain("success");
    expect(mockSleep).toHaveBeenCalledTimes(1);
  });

  it("returns timeout message when run does not complete in time", async () => {
    // Always in progress
    mockGhJson({
      status: "in_progress",
      conclusion: null,
      name: "CI",
      headSha: "abc1234",
      jobs: [{ name: "build", status: "in_progress", conclusion: null }],
    });

    const result = await watchRun({
      workflow: "ci",
      runId: 100,
      timeout: 0,
    });
    expect(result).toContain("timeout");
  });

  it("emits progress lines via onProgress", async () => {
    const onProgress = vi.fn();
    mockGhJson({
      status: "completed",
      conclusion: "success",
      name: "CI",
      headSha: "abc1234",
      jobs: [{ name: "build", status: "completed", conclusion: "success" }],
    });

    await watchRun({
      workflow: "ci",
      runId: 100,
      timeout: 300,
      onProgress,
    });
    expect(onProgress).toHaveBeenCalled();
  });

  it("returns abort message when signal fires during sleep", async () => {
    const controller = new AbortController();
    // First poll: in progress
    mockGhJson({
      status: "in_progress",
      conclusion: null,
      name: "CI",
      headSha: "abc1234",
      jobs: [{ name: "build", status: "in_progress", conclusion: null }],
    });
    mockSleepAborts(controller);

    const result = await watchRun({
      workflow: "ci",
      runId: 100,
      timeout: 300,
      signal: controller.signal,
    });
    expect(result).toContain("aborted:");
    expect(result).toContain("cancelled by user");
  });

  it("surfaces a gh failure instead of blaming the user", async () => {
    mockGhFail("HTTP 404: Not Found");

    await expect(watchRun({ workflow: "ci", runId: 100 })).rejects.toThrow(
      /HTTP 404: Not Found/,
    );
  });
});

describe("listRuns", () => {
  it("returns formatted run list", async () => {
    mockGhJson([
      {
        databaseId: 100,
        url: "https://github.com/o/r/actions/runs/100",
        status: "completed",
        conclusion: "success",
        headSha: "abc1234567890",
        name: "CI",
        displayTitle: "CI",
      },
    ]);

    const result = await listRuns({ workflow: "ci" });
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].status).toBe("success");
    expect(parsed[0].runId).toBe(100);
  });

  it("returns message when no runs found", async () => {
    mockGhJson([]);
    const result = await listRuns({ workflow: "ci" });
    expect(result).toContain("No runs found");
  });
});
