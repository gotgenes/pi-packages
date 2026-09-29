# @gotgenes/pi-github-tools

[![npm version](https://img.shields.io/npm/v/@gotgenes/pi-github-tools?style=flat&logo=npm&logoColor=white)](https://www.npmjs.com/package/@gotgenes/pi-github-tools) [![CI](https://img.shields.io/github/actions/workflow/status/gotgenes/pi-packages/ci.yml?style=flat&logo=github&label=CI)](https://github.com/gotgenes/pi-packages/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat)](https://opensource.org/licenses/MIT) [![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![pnpm](https://img.shields.io/badge/pnpm-%3E%3D11-F69220?style=flat&logo=pnpm&logoColor=white)](https://pnpm.io/) [![Pi Package](https://img.shields.io/badge/Pi-Package-6366F1?style=flat)](https://pi.mariozechner.at/)

Pi extension providing deterministic GitHub CI, release, and issue tools.

Replaces ad-hoc `gh` CLI polling with structured tools that have exponential backoff, progress streaming, and structured success/timeout returns.

## Install

```bash
pi install npm:@gotgenes/pi-github-tools
```

Alternatively, add it to your Pi settings (`~/.pi/agent/settings.json`):

```json
{
  "packages": ["npm:@gotgenes/pi-github-tools"]
}
```

## Prerequisites

- [GitHub CLI (`gh`)](https://cli.github.com/) installed and authenticated (`gh auth login`)
- [Git](https://git-scm.com/) on `PATH` for the default `issue_close` commit-SHA check (local `git rev-parse` in the inherited working directory; no fetch)
- Node.js ≥ 22

## Tools

### CI tools

#### `ci_find`

Wait for a GitHub Actions run matching a specific commit SHA to appear.
Uses exponential backoff (5 s base, 30 s cap) until the run appears or the timeout expires.

| Parameter      | Type   | Required | Description                                                     |
| -------------- | ------ | -------- | --------------------------------------------------------------- |
| `workflow`     | string | yes      | Workflow filename without extension (e.g., `"ci"` for `ci.yml`) |
| `expected_sha` | string | yes      | Full 40-char SHA of the commit                                  |
| `timeout`      | number | no       | Seconds to wait (default: 120)                                  |

Returns `run_id`, `url`, `status`, `sha`, `title`, and job list on success.
Returns a structured timeout message (not an error) if the run does not appear.

#### `ci_watch`

Poll a GitHub Actions run by run ID until it completes or times out.
Streams compact job-level progress lines (e.g., `[2/5] deploy — in_progress (120s)`).

| Parameter  | Type   | Required | Description                         |
| ---------- | ------ | -------- | ----------------------------------- |
| `workflow` | string | yes      | Workflow filename without extension |
| `run_id`   | number | yes      | Run ID from `ci_find`               |
| `timeout`  | number | no       | Seconds to wait (default: 300)      |

#### `ci_list`

List recent GitHub Actions runs for a workflow.
Useful for diagnostics without constructing `gh` invocations.

| Parameter  | Type   | Required | Description                           |
| ---------- | ------ | -------- | ------------------------------------- |
| `workflow` | string | yes      | Workflow filename without extension   |
| `limit`    | number | no       | Number of runs to return (default: 5) |

### Transient-failure retry

Every read-only `gh` call these tools make — `ci_find`, `ci_watch`, and `ci_list` — retries a transient failure up to three times, waiting 1 s, 4 s, then 9 s.
The retry count and backoff curve match [`@octokit/plugin-retry`](https://github.com/octokit/plugin-retry.js)'s defaults.

Retried: HTTP 5xx, GitHub's `no server is currently available` GraphQL error, and transport errors (connection reset, unexpected EOF, i/o timeout, TLS handshake timeout).
Not retried: any 4xx, including rate limiting — retrying those is useless or harmful.

Mutations (`gh pr merge`, `gh issue close`) are never retried automatically.
For a merge, the verification described above is what makes a retry decision safe.

In a polling tool the backoff counts against the call's `timeout`, so retries cannot silently extend the wait the caller asked for.

### Issue tools

#### `issue_close`

Close a GitHub issue with an optional comment.
Before that close, every distinct lowercase word-bounded hex token of 7 to 40 characters in the comment is resolved with `git rev-parse --verify <token>^{commit}` in the inherited working directory.
Tokens are checked once, in first-seen order.
The check is lexical: punctuation, backticks, and URL delimiters are boundaries, and a token in a code span or a URL is still a candidate.
Resolution does not fetch and does not test ancestry.
If Git cannot be started, the directory is not a checkout, or any token does not resolve to a commit, the tool refuses and does not call `gh`, so nothing is closed and no comment is posted.
A missing object in a shallow checkout is a refusal; fetching history is the caller's decision.
Correct a mistaken SHA.
Do not set `skip_sha_validation` to publish a typo.
That flag posts the original comment with no Git check, and it is only for a foreign commit or a non-commit hash you intend to leave unresolved.
A token that resolves proves the object exists locally as a commit.
It does not prove the commit is an ancestor of the default branch, or that it is the change the comment means to cite.
The close remains one `gh issue close` and is not retried.

| Parameter             | Type    | Required | Description                                 |
| --------------------- | ------- | -------- | ------------------------------------------- |
| `issue_number`        | number  | yes      | The issue number to close                   |
| `comment`             | string  | no       | Comment to add when closing                 |
| `reason`              | string  | no       | `"completed"` (default) or `"not_planned"`  |
| `skip_sha_validation` | boolean | no       | Skip local SHA resolution (default refuses) |

## Usage example

A typical CI + release flow using these tools:

```text
1. Push changes to a branch and create a PR.
2. Use ci_find with the pushed SHA to locate the CI run.
3. Use ci_watch to wait for the CI run to complete.
4. Merge the PR.
5. Dispatch the repository's release workflow for the shipped package.
6. Use ci_find and ci_watch with that workflow to follow the release run.
7. Use issue_close to close the shipped issue.
```

## Scope and non-goals

**Purpose.**
The ship workflow used to have the agent `sleep` and re-invoke `gh` in a prose loop, which burned turns and behaved differently every run.
These tools replace that loop with bounded polling, streamed progress, and structured success, timeout, and failure states.

**In scope.**
Making a tool wait where a human would otherwise wait, making a failure legible as a named `reason` a prompt can branch on, surviving transient GitHub errors on reads, and refusing to leave an outcome ambiguous.

**Non-goals.**

- _A general-purpose GitHub toolkit._
  The surface is scoped to the CI and issue-close flow an agent runs end to end.
  An operation with no polling problem — opening a PR, editing labels, dispatching a workflow — is a plain `gh` call and stays one.
- _Release-tool wrappers._
  Earlier versions shipped `release_pr_find`, `release_pr_merge`, and `release_watch`, which encoded release-please's pull-request conventions.
  A release triggered as a workflow is an ordinary Actions run, so `ci_find` and `ci_watch` already follow it and no release-specific tool is needed.
- _A GitHub API client._
  There are no runtime dependencies.
  The tools shell out to the `gh` CLI.
  `issue_close` also runs local `git rev-parse` before its single `gh issue close`, and refuses the close when a candidate does not resolve.
- _Auto-retrying mutations._
  Reads retry on transient failures; `issue_close` does not, since a retried close would post a duplicate comment.
- _Proving a cited commit is the right one._
  Resolving a SHA shows only that the local checkout has that commit object.
  Ancestry on the default branch, and whether the hash is the change the comment means, stay with the caller.

**Where adjacent requests belong.**
Whether to release now, and which packages a release bumps → the calling prompt, not the tool.

## Architecture

Portable business logic in `src/lib/` — no Pi SDK imports.
Thin Pi wrappers in `src/tools/` register each tool and map progress callbacks.

```text
src/
├── extension.ts          # Pi extension entry point
├── progress.ts           # onProgress → Pi onUpdate adapter
├── tool-result.ts        # AgentToolResult helper
├── tools/                # one file per tool (thin wrappers)
└── lib/                  # portable business logic
    ├── ci.ts             # findRun, watchRun, listRuns
    ├── ci-helpers.ts     # CIJob, findRetryDelay, formatProgress
    ├── issue.ts          # closeIssue
    ├── github.ts         # gh(), ghJson(), git(), detectRepo()
    └── process.ts        # runCommand(), sleep()
```

## License

MIT
