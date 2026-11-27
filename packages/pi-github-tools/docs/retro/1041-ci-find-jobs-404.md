---
issue: 1041
issue_title: "fix(pi-github-tools): ci_find fails when a just-listed run's jobs fetch returns 404"
---

# Retro: #1041 — fix(pi-github-tools): ci_find fails when a just-listed run's jobs fetch returns 404

## Stage: Planning (2026-11-27T17:37:45Z)

### Session summary

Planned a fix that lets `findRun` treat a 404 from a just-listed run's jobs fetch as "not ready" and keep polling within `timeout`, rethrowing the last 404 if the budget runs out.
A spike showed the inline fix fails the pre-commit `fallow audit --staged` gate, so the plan leads with fixture, characterization, and outer-abort-catch refactor steps before the `fix:` commit.

### Observations

- Operator chose "rethrow the last 404" at timeout over a structured timeout naming the run or a success output without jobs: no new output shape, and the existing timeout text (`no run found … matching SHA`) would have sent `/ship` to re-check its SHA.
- Measured: inlining the branch took `findRun` from 21/37 (cyclomatic/cognitive) to 25/43 and the audit failed as "introduced: a higher tier".
  The Tidy-First assessor located the tier boundary between cognitive 24 (warn) and 25 (fail) and measured the planned sequence at 12/16 before the fix and 15/22 after.
- The outer abort catch alone was not enough (fix on that base measured 16/25, failing); extracting `formatFindTimeout` supplies the margin.
- `fetchRunJobs` returns the 404 as an `Error` value (`CIJob[] | Error`); a discriminated union has the same complexity cost if a reviewer prefers it.
- `ci_watch` reads the same jobs endpoint but stays out of scope: its `run_id` is caller-supplied, and no `ci_watch` 404 has been observed.
- The ship of this issue runs the pre-merge `ci_find`; restart Pi before relying on the new behavior.

#### Deferred tidyings

- `packages/pi-github-tools/src/lib/ci.ts` `findRun`: still over the cognitive limit (15/22) after this plan; moving `attempt`/`elapsed`/`lastSeenRun`/`retryOptions` onto a small poll-state class would bring it under.
- `packages/pi-github-tools/src/lib/ci.ts` `watchRun`: the same three inline abort catches (14/20, inherited) could collapse into one outer catch like `findRun`'s.

## Stage: Implementation — TDD (2026-11-27T17:50:41Z)

### Session summary

Completed all five TDD steps and added one rename commit after review: fixture hoist, abort/jobs-failure characterization, outer-abort-catch refactor with `formatFindTimeout`/`fetchRunJobs` extracted, the jobs-404 fix, and the README/skill docs.
`ci.test.ts` went from 18 to 25 tests (one weak sleep-abort test replaced by four exact-match abort pins, plus one 403 pin and three jobs-404 tests).

### Observations

- The complexity predictions held exactly: `findRun` measured 12/16 after the refactor and 15/22 after the fix, and the pre-commit `fallow audit --staged` passed both commits.
- Every planned killing mutation went red; a few killed one extra test each (making `isNotFoundError` return `false` also failed the outlasts-timeout test on its sleep count, and making it accept any `Error` also failed the jobs-abort test).
- The permission policy denies `git commit -F -` with a heredoc; write the message with `Write` and pass `-F <file>`.
- Pre-completion reviewer: WARN, then PASS on the delta.
  The `formatFindTimeout` parameter, named `timeout` and clashing with the numeric budget, was renamed to `search` in a follow-up `refactor:` commit.
- Reviewer warnings accepted as non-blocking:
  - `isNotFoundError` matches any `HTTP 404` in the message: a 404 on the run endpoint during the same `gh run view` also matches (still a just-listed run), as would a theoretical `JSON.parse` error quoting "HTTP 404" from stdout.
    It was not narrowed, because tying it to `gh()`'s stderr layout could miss a real 404.
  - In an abort that races a jobs 404, `retries` reports one higher than before the refactor; the abort header is unchanged.

## Stage: Sync (worktree) (2026-11-27T18:18:44Z)

### Session summary

Root `pnpm run lint` and `pnpm fallow dead-code` pass before the rebase onto local `main`.
The plan's marker is `**Release:** ship independently`; `pi-github-tools` gets a patch release from the `fix:` commit.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-1041--/2026-11-27T17-23-47-221Z_01a21e08-dd94-725d-a8c6-b2c8b9fc4266.jsonl`; read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

- Operator settled both remaining reviewer warnings at sync: keep the broad `HTTP 404` match in `isNotFoundError`, and accept the off-by-one `retries` count when an abort races a jobs 404.
- Restart Pi at the root before `/ship` if its `ci_find` should exercise the fix; this ship itself runs the pre-merge tool.
- No follow-up issues were filed; the two deferred tidyings in the Planning stage are the only carried work.
