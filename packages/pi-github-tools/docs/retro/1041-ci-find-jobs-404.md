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
