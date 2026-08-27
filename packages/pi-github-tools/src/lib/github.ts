/**
 * GitHub CLI helpers and repository auto-detection.
 * Platform-independent — no Pi SDK imports.
 */
import { runCommand } from "./process";
import { type RetryOptions, withRetry } from "./retry";

export interface RepoInfo {
  owner: string;
  repo: string;
}

let cachedRepo: RepoInfo | undefined;

/**
 * Reset the cached repo detection result.
 * Exposed for tests — not needed at runtime.
 */
export function resetRepoCache(): void {
  cachedRepo = undefined;
}

/**
 * Run a `gh` CLI command and return stdout as a trimmed string.
 * Throws on non-zero exit.
 */
export async function gh(
  args: string[],
  signal?: AbortSignal,
): Promise<string> {
  const { stdout, stderr, exitCode } = await runCommand({
    cmd: "gh",
    args,
    signal,
  });
  if (exitCode !== 0) {
    throw new Error(
      `gh ${args.join(" ")} failed (exit ${exitCode}): ${stderr.trim()}`,
    );
  }
  return stdout.trim();
}

/**
 * Run a `git` command and return stdout as a trimmed string.
 * Throws on non-zero exit.
 */
export async function git(
  args: string[],
  signal?: AbortSignal,
): Promise<string> {
  const { stdout, stderr, exitCode } = await runCommand({
    cmd: "git",
    args,
    signal,
  });
  if (exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (exit ${exitCode}): ${stderr.trim()}`,
    );
  }
  return stdout.trim();
}

/**
 * Run a `gh` CLI command and parse stdout as JSON.
 * Throws on non-zero exit or invalid JSON.
 */
export async function ghJson<T>(
  args: string[],
  signal?: AbortSignal,
): Promise<T> {
  const text = await gh(args, signal);
  return JSON.parse(text) as T;
}

/**
 * Run a read-only `gh` command, retrying transient failures, and parse stdout
 * as JSON.
 *
 * Retry is opt-in at the call site rather than a property of `gh()`, so a
 * mutation (`gh pr merge`, `gh issue close`) cannot acquire it by accident.
 */
export function ghJsonRetrying<T>(
  args: string[],
  options: RetryOptions = {},
): Promise<T> {
  return withRetry(() => ghJson<T>(args, options.signal), options);
}

/**
 * Detect the current GitHub repository.
 *
 * Strategy:
 * 1. Try `gh repo view --json owner,name` (authoritative, requires gh auth).
 * 2. Fallback: parse `git remote get-url origin` (SSH and HTTPS formats).
 *
 * Result is cached for the extension lifetime.
 */
export async function detectRepo(): Promise<RepoInfo> {
  if (cachedRepo) return cachedRepo;

  // Try gh first
  try {
    const result = await ghJson<{ owner: { login: string }; name: string }>([
      "repo",
      "view",
      "--json",
      "owner,name",
    ]);
    cachedRepo = { owner: result.owner.login, repo: result.name };
    return cachedRepo;
  } catch {
    // Fall back to git remote
  }

  const remoteUrl = await git(["remote", "get-url", "origin"]);
  const match = /github\.com[:/]([^/]+)\/([^/.]+)/.exec(remoteUrl);
  if (!match) {
    throw new Error("Could not detect GitHub repository from git remote");
  }
  cachedRepo = { owner: match[1], repo: match[2] };
  return cachedRepo;
}
