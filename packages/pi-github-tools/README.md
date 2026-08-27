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

### Release tools

#### `release_pr_find`

Find the release-please PR after a push to `main`.
Polls until an open release-please PR appears or the timeout expires.

| Parameter | Type   | Required | Description                    |
| --------- | ------ | -------- | ------------------------------ |
| `timeout` | number | no       | Seconds to wait (default: 120) |

Returns PR number, title, head branch, mergeable status, and URL.

#### `release_pr_merge`

Merge a release-please PR after confirming it is clean.
Checks `MERGEABLE` + `CLEAN` status, merges, and runs `git pull --ff-only`.
Waits out an in-progress check or an undecided (`UNKNOWN`) mergeability state, polling every 10 s up to `timeout`, and streams a progress line per poll.

| Parameter   | Type   | Required | Description                                                       |
| ----------- | ------ | -------- | ----------------------------------------------------------------- |
| `pr_number` | number | yes      | The PR number to merge                                            |
| `method`    | string | no       | Merge strategy: `"rebase"`, `"squash"`, or `"merge"`              |
| `timeout`   | number | no       | Seconds to wait for checks/mergeability to resolve (default: 300) |

Merge method precedence (highest to lowest):

1. Explicit `method` parameter
2. `defaultMergeMethod` from [configuration](#configuration)
3. `"merge"` (hardcoded fallback)

Returns merge confirmation with new HEAD SHA on success.

When the merge call itself fails (a transport error, not a refusal), the tool re-reads the PR over REST before reporting, so a caller never has to guess whether a retry is safe:

- Merged anyway — the pull completes and the normal success block is returned, followed by a `note:` naming the transport error and a `verified: merged via REST` line.
- Not merged — an error headed `failed to merge PR #N` with `merged: false` and `safe to retry: yes`.
- Verification also failed — the same header with `merged: unknown`, a `verification_error:` line, and the manual probe to run.

When the PR is refused _before_ any merge is attempted, the error is headed `PR #N is not mergeable` and carries a `reason:` line naming the specific cause:

- `no checks reported (statusCheckRollup is empty)` — the PR has no CI runs at all (the legacy `GITHUB_TOKEN`-does-not-trigger-workflows case); merge manually if appropriate.
- `check failed: <names>` — one or more checks concluded with a failure.
- `mergeable is <value>` / `merge state is <value>` — the PR is genuinely blocked (conflicting, dirty, behind, etc.).

A `timeout:` result (also an error) means checks or mergeability did not resolve within `timeout`; retry or investigate.

### Transient-failure retry

Every read-only `gh` call these tools make — `ci_find`, `ci_watch`, `ci_list`, `release_pr_find`, and `release_pr_merge`'s precheck and verification — retries a transient failure up to three times, waiting 1 s, 4 s, then 9 s.
The retry count and backoff curve match [`@octokit/plugin-retry`](https://github.com/octokit/plugin-retry.js)'s defaults.

Retried: HTTP 5xx, GitHub's `no server is currently available` GraphQL error, and transport errors (connection reset, unexpected EOF, i/o timeout, TLS handshake timeout).
Not retried: any 4xx, including rate limiting — retrying those is useless or harmful.

Mutations (`gh pr merge`, `gh issue close`) are never retried automatically.
For a merge, the verification described above is what makes a retry decision safe.

In a polling tool the backoff counts against the call's `timeout`, so retries cannot silently extend the wait the caller asked for.

#### `release_watch`

Wait for a release tag to appear on HEAD after merging a release-please PR.
Polls every 10 s until a tag appears or the timeout expires.

| Parameter | Type   | Required | Description                    |
| --------- | ------ | -------- | ------------------------------ |
| `timeout` | number | no       | Seconds to wait (default: 180) |

Returns the tag name, version, and SHA.

### Issue tools

#### `issue_close`

Close a GitHub issue with an optional comment.

| Parameter      | Type   | Required | Description                                |
| -------------- | ------ | -------- | ------------------------------------------ |
| `issue_number` | number | yes      | The issue number to close                  |
| `comment`      | string | no       | Comment to add when closing                |
| `reason`       | string | no       | `"completed"` (default) or `"not_planned"` |

## Usage example

A typical CI + release flow using these tools:

```text
1. Push changes to a branch and create a PR.
2. Use ci_find with the pushed SHA to locate the CI run.
3. Use ci_watch to wait for the CI run to complete.
4. Merge the PR.
5. Use release_pr_find to locate the release-please PR.
6. Use release_pr_merge to merge it.
7. Use release_watch to wait for the release tag to land.
8. Use issue_close to close the shipped issue.
```

## Configuration

Optional JSON config files control default behavior.
Two locations are supported — project config takes precedence over global:

| Scope   | Path                                                 |
| ------- | ---------------------------------------------------- |
| Global  | `~/.pi/agent/extensions/pi-github-tools/config.json` |
| Project | `.pi/extensions/pi-github-tools/config.json`         |

### Options

| Key                  | Type                                  | Default   | Description                                   |
| -------------------- | ------------------------------------- | --------- | --------------------------------------------- |
| `defaultMergeMethod` | `"rebase"` \| `"squash"` \| `"merge"` | `"merge"` | Default merge strategy for `release_pr_merge` |

### Example

```json
{
  "defaultMergeMethod": "squash"
}
```

## Scope and non-goals

**Purpose.**
The ship workflow used to have the agent `sleep` and re-invoke `gh` in a prose loop, which burned turns and behaved differently every run.
These tools replace that loop with bounded polling, streamed progress, and structured success, timeout, and failure states.

**In scope.**
Making a tool wait where a human would otherwise wait, making a failure legible as a named `reason` a prompt can branch on, surviving transient GitHub errors on reads, and refusing to leave an outcome ambiguous.

**Non-goals.**

- _A general-purpose GitHub toolkit._
  The surface is scoped to the CI, release, and issue-close flow an agent runs end to end.
  An operation with no polling problem — opening a PR, editing labels, dispatching a workflow — is a plain `gh` call and stays one.
- _Release automations other than release-please._
  The three release tools encode its conventions; the CI tools stay generic to any GitHub Actions repository.
- _A GitHub API client._
  The `gh` CLI is the sole external binary dependency, and there are no runtime dependencies at all.
- _Auto-retrying mutations._
  Reads retry on transient failures; `release_pr_merge` and `issue_close` do not, since a retried close would post a duplicate comment.
- _Merging a PR the tool refuses today._
  When a release PR reports no checks at all, `release_pr_merge` refuses with a named reason rather than merging through.

**Where adjacent requests belong.**
Whether to release now, and which packages a release PR bumps → the calling prompt, not the tool.

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
    ├── config.ts         # config loading and normalization
    ├── release.ts        # findReleasePR, mergeReleasePR, watchRelease
    ├── issue.ts          # closeIssue
    ├── github.ts         # gh(), ghJson(), git(), detectRepo()
    └── process.ts        # runCommand(), sleep()
```

## License

MIT
