/**
 * Bounded retry for transient GitHub failures.
 *
 * The retry count and backoff curve follow `@octokit/plugin-retry`'s defaults —
 * three retries at 1 s, 4 s, and 9 s — so this package behaves like the
 * reference client for the same API.
 * Platform-independent — no Pi SDK imports.
 */
import { sleep } from "./process";

/** Context handed to `onRetry` before each backoff sleep. */
export interface RetryAttempt {
  /** 1-indexed number of the attempt that just failed. */
  attempt: number;
  /** How long the caller is about to wait before the next attempt. */
  delayMs: number;
  error: Error;
}

export interface RetryOptions {
  onRetry?: (info: RetryAttempt) => void;
  signal?: AbortSignal;
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/**
 * Failures worth retrying: a server-side 5xx, GitHub's GraphQL unavailability
 * message, and the transport errors the `gh` binary passes through from Go's
 * HTTP client.
 * A 4xx (including rate limiting) is deliberately absent — retrying it is
 * either useless or harmful.
 */
const TRANSIENT_PATTERNS = [
  /HTTP 5\d\d/,
  /no server is currently available/i,
  /connection reset/i,
  /\bEOF\b/,
  /i\/o timeout/i,
  /TLS handshake timeout/i,
  /dial tcp/i,
];

/** True when a `gh` failure is worth retrying. */
export function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(error.message));
}

/** Backoff before retry `attempt` (1-indexed), in milliseconds. */
export function transientRetryDelay(attempt: number): number {
  return BASE_DELAY_MS * attempt ** 2;
}

/**
 * Run `fn`, retrying transient failures up to three times.
 * A permanent failure, an abort during the backoff, and the final attempt's
 * error all propagate unchanged.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isTransientError(error)) throw error;
      const delayMs = transientRetryDelay(attempt);
      options.onRetry?.({ attempt, delayMs, error: asError(error) });
      await sleep(delayMs, options.signal);
    }
  }
  return fn();
}

/** One-line progress notice a polling loop can stream while it backs off. */
export function formatRetryNotice(info: RetryAttempt): string {
  return `transient gh failure, retry ${info.attempt}/${MAX_RETRIES} in ${info.delayMs / 1000}s: ${info.error.message}`;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
