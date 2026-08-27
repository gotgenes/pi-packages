/**
 * Platform-independent business logic for the GitHub Actions CI tools.
 *
 * Each function mirrors a single tool entry point:
 *   - findRun  → ci_find
 *   - watchRun → ci_watch
 *   - listRuns → ci_list
 */
import {
  type CIJob,
  findRetryDelay,
  formatAborted,
  formatProgress,
} from "./ci-helpers";
import { ghJsonRetrying } from "./github";
import { sleep } from "./process";
import { formatRetryNotice, type RetryOptions } from "./retry";

interface RunSummary {
  status: string;
  conclusion: string | null;
  headSha: string;
  name: string;
  databaseId: number;
  url: string;
  displayTitle: string;
}

interface RunDetail {
  status: string;
  conclusion: string | null;
  headSha: string;
  name: string;
}

interface RunJobs {
  jobs: CIJob[];
}

interface WatchPoll extends RunDetail {
  jobs: CIJob[];
}

function jobStatus(job: CIJob): string {
  if (job.status === "completed") return job.conclusion ?? "unknown";
  return job.status;
}

function formatWatch(run: RunDetail, runId: number): string {
  const shortSha = run.headSha.substring(0, 7);
  const conclusion = run.conclusion ?? "unknown";
  const status = run.status === "completed" ? conclusion : run.status;
  return `${status}  ${run.name} (${shortSha}) — run ${runId}`;
}

function formatFind(run: RunSummary, jobs: CIJob[]): string {
  const shortSha = run.headSha.substring(0, 7);
  const runStatus =
    run.status === "completed" ? (run.conclusion ?? "unknown") : run.status;

  const jobLines = jobs.map((j) => `  ${j.name} — ${jobStatus(j)}`).join("\n");

  const findLines = [
    `run_id: ${run.databaseId}`,
    `url: ${run.url}`,
    `status: ${runStatus}`,
    `sha: ${run.headSha}`,
    `short_sha: ${shortSha}`,
    `title: ${run.displayTitle}`,
    `jobs:`,
    jobLines,
  ];
  return findLines.join("\n");
}

export interface FindRunArgs {
  workflow: string;
  expectedSha: string;
  timeout?: number;
  onProgress?: (line: string) => void;
  signal?: AbortSignal;
}

export async function findRun(args: FindRunArgs): Promise<string> {
  const workflowFile = `${args.workflow}.yml`;
  const expectedSha = args.expectedSha;
  const timeout = args.timeout ?? 120;
  const onProgress = args.onProgress;
  const signal = args.signal;

  const shortExpected = expectedSha.substring(0, 7);
  let elapsed = 0;
  let attempt = 0;
  let lastSeenRun: RunSummary | null = null;

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
        `awaiting ${workflowFile} run for ${shortExpected}... (attempt ${attempt}, ${elapsed}s elapsed)`,
      );
    }

    let runs: RunSummary[];
    try {
      runs = await ghJsonRetrying<RunSummary[]>(
        [
          "run",
          "list",
          "--limit",
          "5",
          "--workflow",
          workflowFile,
          "--json",
          "databaseId,url,status,conclusion,headSha,displayTitle,name",
        ],
        retryOptions,
      );
    } catch (error) {
      if (!signal?.aborted) throw error;
      return formatAborted(`  retries: ${attempt}`, `  elapsed: ${elapsed}s`);
    }

    if (runs.length > 0) {
      lastSeenRun = runs[0];
    }

    const matchingRun = runs.find((r) => r.headSha === expectedSha);
    if (matchingRun) {
      let jobs: CIJob[];
      try {
        ({ jobs } = await ghJsonRetrying<RunJobs>(
          ["run", "view", String(matchingRun.databaseId), "--json", "jobs"],
          retryOptions,
        ));
      } catch (error) {
        if (!signal?.aborted) throw error;
        return formatAborted(`  retries: ${attempt}`, `  elapsed: ${elapsed}s`);
      }
      return formatFind(matchingRun, jobs);
    }

    if (elapsed >= timeout) {
      const lastSeenInfo = lastSeenRun
        ? `last_seen_sha: ${lastSeenRun.headSha.substring(0, 7)} (run ${lastSeenRun.databaseId})`
        : "last_seen_sha: none (no runs found for this workflow)";

      return [
        `timeout: no run found for workflow ${workflowFile} matching SHA ${expectedSha}`,
        `  retries: ${attempt}`,
        `  elapsed: ${elapsed}s`,
        `  ${lastSeenInfo}`,
        `  suggestion: check https://www.githubstatus.com for GitHub Actions status`,
      ].join("\n");
    }
  }
}

export interface WatchRunArgs {
  workflow: string;
  runId: number;
  timeout?: number;
  onProgress?: (line: string) => void;
  signal?: AbortSignal;
}

export async function watchRun(args: WatchRunArgs): Promise<string> {
  const runId = args.runId;
  const timeout = args.timeout ?? 300;
  const onProgress = args.onProgress;
  const signal = args.signal;

  const pollInterval = 15;
  let elapsed = 0;
  const progressLog: string[] = [];

  const retryOptions: RetryOptions = {
    signal,
    onRetry: (info) => {
      elapsed += Math.round(info.delayMs / 1000);
      onProgress?.(formatRetryNotice(info));
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- intentional infinite loop with explicit return/break
  while (true) {
    if (signal?.aborted) {
      return formatAborted(`  elapsed: ${elapsed}s`, `  run_id: ${runId}`);
    }

    let run: WatchPoll;
    try {
      run = await ghJsonRetrying<WatchPoll>(
        [
          "run",
          "view",
          String(runId),
          "--json",
          "status,conclusion,name,headSha,jobs",
        ],
        retryOptions,
      );
    } catch (error) {
      if (!signal?.aborted) throw error;
      return formatAborted(`  elapsed: ${elapsed}s`, `  run_id: ${runId}`);
    }

    const progressLine = formatProgress(run.jobs, elapsed);
    progressLog.push(progressLine);
    if (onProgress) {
      onProgress(progressLine);
    }

    if (run.status === "completed") {
      const summary = formatWatch(run, runId);
      return [...progressLog, summary].join("\n");
    }

    if (elapsed >= timeout) {
      const shortSha = run.headSha.substring(0, 7);
      const timeoutLine = `timeout  ${run.name} (${shortSha}) still ${run.status} after ${timeout}s — run ${runId}`;
      return [...progressLog, timeoutLine].join("\n");
    }

    try {
      await sleep(pollInterval * 1000, signal);
    } catch (error) {
      if (!signal?.aborted) throw error;
      return formatAborted(`  elapsed: ${elapsed}s`, `  run_id: ${runId}`);
    }
    elapsed += pollInterval;
  }
}

export interface ListRunsArgs {
  workflow: string;
  limit?: number;
}

export async function listRuns(args: ListRunsArgs): Promise<string> {
  const workflowFile = `${args.workflow}.yml`;
  const limit = args.limit ?? 5;

  const runs = await ghJsonRetrying<RunSummary[]>([
    "run",
    "list",
    "--limit",
    String(limit),
    "--workflow",
    workflowFile,
    "--json",
    "databaseId,url,status,conclusion,headSha,name,displayTitle",
  ]);

  if (runs.length === 0) {
    return `No runs found for ${workflowFile}`;
  }

  const result = runs.map((run) => ({
    status:
      run.status === "completed" ? (run.conclusion ?? "unknown") : run.status,
    name: run.name,
    sha: run.headSha,
    short_sha: run.headSha.substring(0, 7),
    runId: run.databaseId,
    url: run.url,
  }));
  return JSON.stringify(result);
}
