/**
 * Shared polling types and utilities used by the CI and release tool modules.
 * Platform-independent — no Pi SDK imports.
 */

/** CI job shape returned by `gh run view --json jobs`. */
export interface CIJob {
  name: string;
  status: string;
  conclusion: string | null;
}

/**
 * Format the result a polling loop returns when its abort signal fires.
 * Each extra line is appended verbatim, already indented by the caller.
 */
export function formatAborted(...extraLines: string[]): string {
  return ["aborted: cancelled by user", ...extraLines].join("\n");
}

/**
 * Exponential backoff for finding a CI run: 5 s base, 30 s cap.
 * Attempt is 1-indexed (attempt 1 = no wait before first check).
 */
export function findRetryDelay(attempt: number): number {
  if (attempt <= 1) return 0;
  return Math.min(5 * 2 ** (attempt - 2), 30);
}

/**
 * Produces a compact one-line progress summary for a watch poll cycle.
 *
 * Format examples:
 *
 * - `waiting for jobs... (15s)`
 * - `[0/5] queued (30s)`
 * - `[2/5] deploy — in_progress (120s)`
 * - `[2/5] docker, deploy — in_progress (120s)`
 */
export function formatProgress(
  jobs: CIJob[],
  elapsed: number,
  prefix = "",
): string {
  if (jobs.length === 0) {
    return `${prefix}waiting for jobs... (${elapsed}s)`;
  }

  const completedCount = jobs.filter((j) => j.status === "completed").length;
  const total = jobs.length;
  const activeJobs = jobs.filter((j) => j.status === "in_progress");

  if (activeJobs.length === 0) {
    return `${prefix}[${completedCount}/${total}] queued (${elapsed}s)`;
  }

  const activeNames = activeJobs.map((j) => j.name).join(", ");
  return `${prefix}[${completedCount}/${total}] ${activeNames} — in_progress (${elapsed}s)`;
}
