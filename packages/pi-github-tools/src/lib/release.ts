/**
 * Platform-independent business logic for release tools.
 *
 * Each function mirrors a single tool entry point:
 *   - findReleasePR   → release_pr_find
 *   - mergeReleasePR  → release_pr_merge
 *   - watchRelease    → release_watch
 */

import { findRetryDelay, formatAborted, formatProgress } from "./ci-helpers";
import type { MergeMethod } from "./config";
import { gh, ghJsonRetrying, git } from "./github";
import { classifyMergeState, type MergeReadiness } from "./merge-state";
import { sleep } from "./process";
import { formatRetryNotice, type RetryOptions } from "./retry";

export type { MergeMethod };

interface ReleasePR {
  number: number;
  title: string;
  headRefName: string;
  url: string;
  mergeable: string;
  mergeStateStatus: string;
}

interface PRState extends MergeReadiness {
  number: number;
  title: string;
}

/** The PR fields the REST verification reads after a failed merge call. */
interface MergeVerification {
  merged: boolean;
  state: string;
  merge_commit_sha: string | null;
}

export interface ToolResult {
  content: string;
  isError: boolean;
}

// ---------- findReleasePR ----------

export interface FindReleasePRArgs {
  timeout?: number;
  onProgress?: (line: string) => void;
  signal?: AbortSignal;
}

export async function findReleasePR(args: FindReleasePRArgs): Promise<string> {
  const timeout = args.timeout ?? 120;
  const onProgress = args.onProgress;
  const signal = args.signal;

  let elapsed = 0;
  let attempt = 0;

  const retryOptions: RetryOptions = {
    signal,
    onRetry: (info) => {
      // The backoff is wall clock the caller asked us to bound, so it counts
      // against `timeout` just like a poll interval does.
      elapsed += Math.round(info.delayMs / 1000);
      onProgress?.(formatRetryNotice(info));
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- intentional infinite loop with explicit return/break
  while (true) {
    attempt++;

    if (signal?.aborted) {
      return formatAborted(`  retries: ${attempt}`, `  elapsed: ${elapsed}s`);
    }

    const delay = findRetryDelay(attempt);
    if (delay > 0) {
      try {
        await sleep(delay * 1000, signal);
      } catch (error) {
        if (!signal?.aborted) throw error;
        return formatAborted(`  retries: ${attempt}`, `  elapsed: ${elapsed}s`);
      }
      elapsed += delay;
    }

    if (attempt > 1 && onProgress) {
      onProgress(
        `awaiting release-please PR... (attempt ${attempt}, ${elapsed}s elapsed)`,
      );
    }

    let prs: ReleasePR[];
    try {
      prs = await ghJsonRetrying<ReleasePR[]>(
        [
          "pr",
          "list",
          "--label",
          "autorelease: pending",
          "--json",
          "number,title,headRefName,url,mergeable,mergeStateStatus",
          "--limit",
          "5",
        ],
        retryOptions,
      );
    } catch (error) {
      if (!signal?.aborted) throw error;
      return formatAborted(`  retries: ${attempt}`, `  elapsed: ${elapsed}s`);
    }

    if (prs.length > 0) {
      const pr = prs[0];
      return [
        `pr_number: ${pr.number}`,
        `title: ${pr.title}`,
        `head_branch: ${pr.headRefName}`,
        `url: ${pr.url}`,
        `mergeable: ${pr.mergeable}`,
        `merge_state: ${pr.mergeStateStatus}`,
      ].join("\n");
    }

    if (elapsed >= timeout) {
      return [
        `timeout: no release-please PR found`,
        `  retries: ${attempt}`,
        `  elapsed: ${elapsed}s`,
      ].join("\n");
    }
  }
}

// ---------- mergeReleasePR ----------

export interface MergeReleasePRArgs {
  prNumber: number;
  method?: MergeMethod;
  timeout?: number;
  onProgress?: (line: string) => void;
  signal?: AbortSignal;
}

export async function mergeReleasePR(
  args: MergeReleasePRArgs,
): Promise<ToolResult> {
  const prNumber = args.prNumber;
  const signal = args.signal;
  const onProgress = args.onProgress;
  const timeout = args.timeout ?? 300;
  const method = args.method ?? "merge";
  const pollInterval = 10;
  let elapsed = 0;

  const retryOptions: RetryOptions = {
    signal,
    onRetry: (info) => {
      // The backoff is wall clock the caller asked us to bound, so it counts
      // against `timeout` just like a poll interval does.
      elapsed += Math.round(info.delayMs / 1000);
      onProgress?.(formatRetryNotice(info));
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- intentional infinite loop with explicit return/break
  while (true) {
    if (signal?.aborted) {
      return abortedMergeResult(elapsed);
    }

    const pr = await ghJsonRetrying<PRState>(
      [
        "pr",
        "view",
        String(prNumber),
        "--json",
        "number,title,mergeable,mergeStateStatus,statusCheckRollup",
      ],
      retryOptions,
    );

    const decision = classifyMergeState(pr);
    let progressLine: string | undefined;
    switch (decision.kind) {
      case "ready":
        return performMerge(prNumber, method, pr.title, signal);
      case "blocked":
        return blockedResult(pr, decision.reason);
      case "waiting-checks":
        progressLine = formatProgress(decision.checks, elapsed, "checks: ");
        break;
      case "waiting-mergeability":
        progressLine = `waiting for GitHub to compute mergeability... (${elapsed}s)`;
        break;
    }
    onProgress?.(progressLine);

    if (elapsed >= timeout) {
      return timeoutMergeResult(pr, timeout, progressLine);
    }

    try {
      await sleep(pollInterval * 1000, signal);
    } catch (error) {
      if (!signal?.aborted) throw error;
      return abortedMergeResult(elapsed);
    }
    elapsed += pollInterval;
  }
}

/**
 * Format the "not mergeable" error result for a blocked PR.
 * An optional `reason` appends a machine-greppable `reason:` line.
 */
function blockedResult(pr: PRState, reason?: string): ToolResult {
  const lines = [
    `PR #${pr.number} is not mergeable`,
    `  mergeable: ${pr.mergeable}`,
    `  merge_state: ${pr.mergeStateStatus}`,
    `  title: ${pr.title}`,
  ];
  if (reason) {
    lines.push(`  reason: ${reason}`);
  }
  return { content: lines.join("\n"), isError: true };
}

/** Format the timeout result when the PR never became mergeable within the bound. */
function timeoutMergeResult(
  pr: PRState,
  timeout: number,
  lastProgressLine: string | undefined,
): ToolResult {
  const lines = [
    `timeout: PR #${pr.number} did not become mergeable within ${timeout}s`,
    `  mergeable: ${pr.mergeable}`,
    `  merge_state: ${pr.mergeStateStatus}`,
    `  title: ${pr.title}`,
  ];
  if (lastProgressLine) {
    lines.push(`  ${lastProgressLine}`);
  }
  return { content: lines.join("\n"), isError: true };
}

/** Format the abort result when the signal fires while waiting for the PR to become mergeable. */
function abortedMergeResult(elapsed: number): ToolResult {
  return {
    content: formatAborted(`  elapsed: ${elapsed}s`),
    isError: true,
  };
}

/** Merge the PR, pull the result, and report the new HEAD SHA. */
async function performMerge(
  prNumber: number,
  method: MergeMethod,
  title: string,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  try {
    await gh(["pr", "merge", String(prNumber), `--${method}`], signal);
  } catch (error) {
    return resolveMergeFailure(prNumber, title, messageOf(error), signal);
  }

  return mergedResult(prNumber, title, [], signal);
}

/**
 * A failed merge call is ambiguous — the merge may have applied before the
 * response was lost.
 * Re-read the PR over REST, which stays available when the GraphQL endpoint
 * behind `gh pr merge` is degraded, rather than leaving the caller to guess
 * whether a retry is safe.
 */
async function resolveMergeFailure(
  prNumber: number,
  title: string,
  mergeError: string,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  let verification: MergeVerification;
  try {
    verification = await ghJsonRetrying<MergeVerification>(
      mergeVerificationArgs(prNumber),
      { signal },
    );
  } catch (error) {
    return unverifiedMergeFailureResult(prNumber, mergeError, messageOf(error));
  }

  if (verification.merged) {
    return mergedResult(
      prNumber,
      title,
      [
        `note: the merge call failed (${mergeError}) but the merge landed`,
        `verified: merged via REST (merge_commit_sha: ${verification.merge_commit_sha})`,
      ],
      signal,
    );
  }

  return mergeFailureResult(prNumber, mergeError, verification.state);
}

/** Pull the merged result and report the new HEAD SHA, plus any extra lines. */
async function mergedResult(
  prNumber: number,
  title: string,
  extraLines: string[],
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  await git(["pull", "--ff-only"], signal);

  const headSha = await git(["rev-parse", "HEAD"], signal);

  return {
    content: [
      `Merged PR #${prNumber}: ${title}`,
      `head_sha: ${headSha}`,
      `short_sha: ${headSha.substring(0, 7)}`,
      ...extraLines,
    ].join("\n"),
    isError: false,
  };
}

/** Format the failure result for a merge call that verifiably did not apply. */
function mergeFailureResult(
  prNumber: number,
  mergeError: string,
  state: string,
): ToolResult {
  return {
    content: [
      `failed to merge PR #${prNumber}`,
      "  merged: false",
      `  state: ${state}`,
      `  error: ${mergeError}`,
      "  verified: not merged via REST",
      "  safe to retry: yes",
    ].join("\n"),
    isError: true,
  };
}

/** Format the failure result when the verification read failed too. */
function unverifiedMergeFailureResult(
  prNumber: number,
  mergeError: string,
  verificationError: string,
): ToolResult {
  return {
    content: [
      `failed to merge PR #${prNumber}`,
      "  merged: unknown",
      `  error: ${mergeError}`,
      `  verification_error: ${verificationError}`,
      `  safe to retry: no — verify by hand with: gh api 'repos/{owner}/{repo}/pulls/${prNumber}' --jq '{state:.state,merged:.merged}'`,
    ].join("\n"),
    isError: true,
  };
}

function mergeVerificationArgs(prNumber: number): string[] {
  return [
    "api",
    `repos/{owner}/{repo}/pulls/${prNumber}`,
    "--jq",
    "{state:.state,merged:.merged,merge_commit_sha:.merge_commit_sha}",
  ];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------- watchRelease ----------

export interface WatchReleaseArgs {
  timeout?: number;
  onProgress?: (line: string) => void;
  signal?: AbortSignal;
}

export async function watchRelease(args: WatchReleaseArgs): Promise<string> {
  const timeout = args.timeout ?? 180;
  const onProgress = args.onProgress;
  const signal = args.signal;

  const pollInterval = 10;
  let elapsed = 0;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- intentional infinite loop with explicit return/break
  while (true) {
    if (signal?.aborted) {
      return formatAborted(`  elapsed: ${elapsed}s`);
    }

    let tagOutput: string;
    try {
      await git(["fetch", "--tags"], signal);
      tagOutput = await git(["tag", "--points-at", "HEAD"], signal);
    } catch (error) {
      if (!signal?.aborted) throw error;
      return formatAborted(`  elapsed: ${elapsed}s`);
    }
    const tags = tagOutput
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean);

    if (tags.length > 0) {
      const tag = tags[tags.length - 1]; // most recent tag
      let headSha: string;
      try {
        headSha = await git(["rev-parse", "HEAD"], signal);
      } catch (error) {
        if (!signal?.aborted) throw error;
        return formatAborted(`  elapsed: ${elapsed}s`);
      }
      return [
        `tag: ${tag}`,
        `version: ${tag.replace(/^v/, "")}`,
        `sha: ${headSha}`,
        `short_sha: ${headSha.substring(0, 7)}`,
      ].join("\n");
    }

    if (elapsed >= timeout) {
      return [
        `timeout: no release tag found on HEAD`,
        `  elapsed: ${elapsed}s`,
      ].join("\n");
    }

    if (onProgress) {
      onProgress(`waiting for release tag... (${elapsed}s elapsed)`);
    }

    try {
      await sleep(pollInterval * 1000, signal);
    } catch (error) {
      if (!signal?.aborted) throw error;
      return formatAborted(`  elapsed: ${elapsed}s`);
    }
    elapsed += pollInterval;
  }
}
