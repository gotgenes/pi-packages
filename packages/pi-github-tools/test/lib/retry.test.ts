import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSleep = vi.hoisted(() => vi.fn());

vi.mock("../../src/lib/process", () => ({
  sleep: mockSleep,
}));

import {
  isTransientError,
  transientRetryDelay,
  withRetry,
} from "#src/lib/retry";

beforeEach(() => {
  mockSleep.mockReset();
  mockSleep.mockResolvedValue(undefined);
});

describe("isTransientError", () => {
  it.each([
    "gh pr view 42 failed (exit 1): HTTP 500",
    "gh pr view 42 failed (exit 1): HTTP 502",
    "gh pr view 42 failed (exit 1): HTTP 503",
    "gh pr view 42 failed (exit 1): HTTP 504",
    "gh api graphql failed (exit 1): no server is currently available to service your request",
    "gh run list failed (exit 1): read tcp 1.2.3.4:443: connection reset by peer",
    "gh run list failed (exit 1): unexpected EOF",
    "gh run list failed (exit 1): dial tcp: i/o timeout",
    "gh run list failed (exit 1): net/http: TLS handshake timeout",
  ])("treats %s as transient", (message) => {
    expect(isTransientError(new Error(message))).toBe(true);
  });

  it.each([
    "gh pr view 42 failed (exit 1): HTTP 401: Bad credentials",
    "gh pr view 42 failed (exit 1): HTTP 403: Resource not accessible",
    "gh pr view 42 failed (exit 1): HTTP 404: Not Found",
    "gh pr merge 42 failed (exit 1): HTTP 422: Pull Request is not mergeable",
    "gh api failed (exit 1): HTTP 403: You have exceeded a secondary rate limit",
    "gh api failed (exit 1): HTTP 429: too many requests",
    "Unexpected token < in JSON at position 0",
    "Could not detect GitHub repository from git remote",
  ])("treats %s as permanent", (message) => {
    expect(isTransientError(new Error(message))).toBe(false);
  });

  it("treats a non-Error value as permanent", () => {
    expect(isTransientError("something went wrong")).toBe(false);
  });
});

describe("transientRetryDelay", () => {
  it("waits 1s before the first retry", () => {
    expect(transientRetryDelay(1)).toBe(1000);
  });

  it("waits 4s before the second retry", () => {
    expect(transientRetryDelay(2)).toBe(4000);
  });

  it("waits 9s before the third retry", () => {
    expect(transientRetryDelay(3)).toBe(9000);
  });
});

describe("withRetry", () => {
  const transient = new Error("gh pr view 42 failed (exit 1): HTTP 503");

  it("returns the first result without sleeping", async () => {
    const fn = vi.fn().mockResolvedValue("ok");

    await expect(withRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockSleep).not.toHaveBeenCalled();
  });

  it("retries a transient failure and returns the later result", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce("ok");

    await expect(withRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(mockSleep).toHaveBeenCalledWith(1000, undefined);
  });

  it("rethrows a permanent failure without retrying", async () => {
    const permanent = new Error("gh pr view 42 failed (exit 1): HTTP 404");
    const fn = vi.fn().mockRejectedValue(permanent);

    await expect(withRetry(fn)).rejects.toBe(permanent);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockSleep).not.toHaveBeenCalled();
  });

  it("gives up after three retries and rethrows the last error", async () => {
    const fn = vi.fn().mockRejectedValue(transient);

    await expect(withRetry(fn)).rejects.toBe(transient);
    expect(fn).toHaveBeenCalledTimes(4);
    expect(mockSleep.mock.calls.map((call) => call[0])).toEqual([
      1000, 4000, 9000,
    ]);
  });

  it("reports each retry before sleeping", async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce("ok");

    await withRetry(fn, { onRetry });

    expect(onRetry).toHaveBeenCalledWith({
      attempt: 1,
      delayMs: 1000,
      error: transient,
    });
  });

  it("wraps a non-Error rejection for onRetry", async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("HTTP 503"))
      .mockResolvedValueOnce("ok");

    await withRetry(fn, { onRetry });

    expect(onRetry).toHaveBeenCalledWith({
      attempt: 1,
      delayMs: 1000,
      error: expect.any(Error),
    });
  });

  it("forwards the signal to sleep", async () => {
    const controller = new AbortController();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce("ok");

    await withRetry(fn, { signal: controller.signal });

    expect(mockSleep).toHaveBeenCalledWith(1000, controller.signal);
  });

  it("propagates an abort during the backoff without retrying", async () => {
    const aborted = new Error("The operation was aborted.");
    mockSleep.mockRejectedValueOnce(aborted);
    const fn = vi.fn().mockRejectedValue(transient);

    await expect(withRetry(fn)).rejects.toBe(aborted);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
