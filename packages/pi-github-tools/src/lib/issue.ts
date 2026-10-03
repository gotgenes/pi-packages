/**
 * Platform-independent business logic for issue tools.
 *
 * Simplified from `@repone/agent-tools` — no board integration.
 * `closeIssue` refuses a comment whose commit SHAs do not resolve locally.
 */
import { gh, git } from "./github";

export interface CloseIssueArgs {
  issueNumber: number;
  reason?: string;
  comment?: string;
  /** When true, publish `comment` without resolving commit SHAs. */
  skipShaValidation?: boolean;
  signal?: AbortSignal;
}

interface UnresolvedCommitSha {
  token: string;
  detail: string;
}

/**
 * Lowercase word-bounded hex of 7-40 characters, in first-seen order.
 * Uppercase, SHA-256, and tokens glued to other word characters are not candidates.
 */
function distinctCommitShas(comment: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const match of comment.matchAll(/\b[0-9a-f]{7,40}\b/g)) {
    const token = match[0];
    if (seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

/** Cancellation is not a failed SHA and must not fall through to `gh`. */
function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw (
    signal.reason ??
    new DOMException("The operation was aborted.", "AbortError")
  );
}

function unresolvedCommitShaMessage(
  failures: readonly UnresolvedCommitSha[],
): string {
  const names = failures.map((failure) => failure.token).join(", ");
  const details = failures
    .map((failure) => `${failure.token}: ${failure.detail}`)
    .join(" ");
  return (
    `Unresolved commit SHA(s) in the close comment: ${names}. ${details} ` +
    "Correct each token so `git rev-parse --verify <token>^{commit}` succeeds in this checkout. " +
    "Do not set skip_sha_validation to publish a typo; that option is only for a foreign commit or a non-commit hash you intend to leave unresolved."
  );
}

async function rejectUnresolvedCommitShas(
  comment: string,
  signal?: AbortSignal,
): Promise<void> {
  const failures: UnresolvedCommitSha[] = [];
  for (const token of distinctCommitShas(comment)) {
    throwIfAborted(signal);
    try {
      await git(["rev-parse", "--verify", `${token}^{commit}`], signal);
    } catch (error: unknown) {
      if (signal?.aborted) {
        throw signal.reason ?? error;
      }
      failures.push({
        token,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    throwIfAborted(signal);
  }
  if (failures.length > 0) {
    throw new Error(unresolvedCommitShaMessage(failures));
  }
}

export async function closeIssue(args: CloseIssueArgs): Promise<string> {
  const reason = args.reason ?? "completed";

  if (reason === "not planned") {
    throw new Error(
      "Invalid reason 'not planned'. Use 'not_planned' (with underscore). Valid: completed, not_planned",
    );
  }
  if (reason !== "completed" && reason !== "not_planned") {
    throw new Error(
      `Invalid reason '${reason}'. Valid: completed, not_planned`,
    );
  }

  // Omitted and false both validate. Only an explicit true skips.
  if (args.comment && !args.skipShaValidation) {
    await rejectUnresolvedCommitShas(args.comment, args.signal);
  }

  // Normalize to the value the gh CLI expects
  const ghReason = reason === "not_planned" ? "not planned" : reason;

  const closeArgs = [
    "issue",
    "close",
    String(args.issueNumber),
    "--reason",
    ghReason,
  ];
  if (args.comment) {
    closeArgs.push("--comment", args.comment);
  }

  await gh(closeArgs, args.signal);

  return `Closed issue #${args.issueNumber} (reason: ${reason})`;
}
