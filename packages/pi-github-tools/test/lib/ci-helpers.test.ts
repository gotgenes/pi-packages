import { describe, expect, it } from "vitest";
import {
  type CIJob,
  findRetryDelay,
  formatAborted,
  formatProgress,
} from "#src/lib/ci-helpers";

describe("formatAborted", () => {
  it("returns the bare cancellation line with no extra lines", () => {
    expect(formatAborted()).toBe("aborted: cancelled by user");
  });

  it("appends each extra line verbatim", () => {
    expect(formatAborted("  retries: 3", "  elapsed: 20s")).toBe(
      "aborted: cancelled by user\n  retries: 3\n  elapsed: 20s",
    );
  });
});

describe("findRetryDelay", () => {
  it("returns 0 for the first attempt", () => {
    expect(findRetryDelay(1)).toBe(0);
  });

  it("returns 5 for the second attempt", () => {
    expect(findRetryDelay(2)).toBe(5);
  });

  it("returns 10 for the third attempt", () => {
    expect(findRetryDelay(3)).toBe(10);
  });

  it("returns 20 for the fourth attempt", () => {
    expect(findRetryDelay(4)).toBe(20);
  });

  it("caps at 30 for the fifth attempt", () => {
    expect(findRetryDelay(5)).toBe(30);
  });

  it("stays capped at 30 for subsequent attempts", () => {
    expect(findRetryDelay(6)).toBe(30);
    expect(findRetryDelay(10)).toBe(30);
  });
});

describe("formatProgress", () => {
  it("shows waiting message when no jobs exist", () => {
    expect(formatProgress([], 15)).toBe("waiting for jobs... (15s)");
  });

  it("shows queued when all jobs are queued", () => {
    const jobs: CIJob[] = [
      { name: "build", status: "queued", conclusion: null },
      { name: "test", status: "queued", conclusion: null },
    ];
    expect(formatProgress(jobs, 30)).toBe("[0/2] queued (30s)");
  });

  it("shows active job names when in progress", () => {
    const jobs: CIJob[] = [
      { name: "build", status: "completed", conclusion: "success" },
      { name: "test", status: "in_progress", conclusion: null },
      { name: "deploy", status: "queued", conclusion: null },
    ];
    expect(formatProgress(jobs, 120)).toBe("[1/3] test — in_progress (120s)");
  });

  it("shows multiple active job names", () => {
    const jobs: CIJob[] = [
      { name: "build", status: "completed", conclusion: "success" },
      { name: "test", status: "in_progress", conclusion: null },
      { name: "deploy", status: "in_progress", conclusion: null },
    ];
    expect(formatProgress(jobs, 60)).toBe(
      "[1/3] test, deploy — in_progress (60s)",
    );
  });

  it("applies an optional prefix", () => {
    expect(formatProgress([], 5, "CI: ")).toBe("CI: waiting for jobs... (5s)");
  });
});
