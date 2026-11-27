---
issue: 1041
issue_title: "fix(pi-github-tools): ci_find fails when a just-listed run's jobs fetch returns 404"
---

# `ci_find` polls through a just-listed run's jobs 404

## Release Recommendation

**Release:** ship independently

`pi-github-tools` has no architecture roadmap, so this fix belongs to no release batch.

## Problem Statement

`ci_find` lists recent runs for a workflow, matches one on `headSha`, and then fetches that run's jobs with `gh run view <id> --json jobs`.
Twice during `/ship` (for #1040 and #1058) the match succeeded and the jobs fetch failed with `HTTP 404: Not Found` against `/actions/runs/<id>/jobs`.
`ci_find` threw, and the parent agent had to fall back to `ci_list` and `ci_watch` by hand, which `/ship` documents only for a timeout.
Both times an immediate retry succeeded, so a freshly created run's jobs endpoint can briefly 404.

The 404 escapes because the jobs fetch goes through `ghJsonRetrying`, and `isTransientError` (`src/lib/retry.ts`) deliberately excludes every 4xx.

## Goals

- In `findRun`, a 404 from the jobs fetch of a run the same poll just listed means "not ready yet": report it through `onProgress` and keep polling within the existing `timeout`.
- When `timeout` runs out while the jobs fetch still 404s, rethrow that last 404 (operator decision at the planning gate): the error is the one `ci_find` raises today, only later, and its text names the run id.
- Keep every other failure path unchanged: a 404 from the run list throws, any other jobs failure throws, and an abort returns `aborted: cancelled by user`.
- Land the preparatory refactor that lets the fix pass the pre-commit `fallow audit --staged` gate.
- Not breaking: no default, output shape, or contract changes; a call that threw now succeeds or throws the same error later.

## Non-Goals

- Adding 4xx to `TRANSIENT_PATTERNS`: the global "never retry a 4xx" rule stays intact.
- 404 tolerance in `ci_watch`.
  `watchRun` reads the same jobs endpoint, but its `run_id` comes from the caller and a 404 there may be a wrong id; in the `/ship` flow `ci_find` now absorbs the window before `ci_watch` starts.
  No `ci_watch` 404 has been observed.
- Collapsing `watchRun`'s abort catches the same way as `findRun`'s; it has the same three abort exits but this change does not touch it.
- Getting `findRun` under the cognitive threshold: after this plan it lands at a measured 15 cyclomatic / 22 cognitive, still over the limit but out of the HIGH tier.
  Moving its poll state onto a class is a restructure, recorded as a deferred tidying in the retro.
- [#1026] (`ci_watch` progress says `queued` after jobs complete) touches `formatProgress`, not `findRun`.
- `/ship` prose: its `ci_find` fallback covers a timeout only, and this change removes the case that needed another fallback.

## Background

- `src/lib/ci.ts` `findRun` is a `while (true)` poll: abort check, `findRetryDelay(attempt)` sleep (0, 5, 10, 20, 30, 30 … s), progress line, `gh run list --limit 5`, match on `headSha`, jobs fetch, timeout check.
  The timeout check runs only when no run matched.
- Three `try`/`catch` blocks (sleep, run list, jobs fetch) each do `if (!signal?.aborted) throw error; return formatAborted(retries, elapsed)`, and a fourth abort exit is the top-of-loop `if (signal?.aborted)` check.
- `retryOptions.onRetry` adds the transient-retry backoff to `elapsed`, so a retry counts against `timeout`.
- `gh()` (`src/lib/github.ts`) throws `gh <args> failed (exit N): <stderr>`; the observed stderr is `HTTP 404: Not Found (https://api.github.com/repos/…/actions/runs/<id>/jobs?per_page=100)`.
- `src/tools/ci-find.ts` turns a thrown error into an `err()` result, so a rethrown 404 reaches the agent as a tool error, as it does today.
- `fallow health` measures `findRun` at 21 cyclomatic / 37 cognitive / 101 lines (HIGH, inherited).
  A spike that put the 404 branch inline in the jobs `catch` measured 25 / 43, and `pnpm --silent fallow audit --staged` failed: "findRun cyclomatic 21 -> 25, cognitive 37 -> 43 (introduced: a new limit or a higher tier)".
- AGENTS.md: a change to `ci_find` needs a Pi restart before `/ship` exercises it; the running session keeps the pre-merge tool.

## Design Overview

### Preparatory refactor

The Tidy-First assessor measured each step on a scratch copy against the real audit gate (`FALLOW_AUDIT_BASE=HEAD fallow audit --staged`).
The tier boundary sits between cognitive 24 (passes, "worsened: warn only") and 25 (fails).

1. Collapse the abort exits: wrap the loop in one outer `try`/`catch` that returns `formatAborted` when `signal.aborted` and rethrows otherwise; delete the three inner catches; replace the top-of-loop check with `signal?.throwIfAborted()`.
   `attempt` and `elapsed` stay function-scope `let`s, so the outer catch reads the values current at the throw, and `elapsed += delay` still runs only after a sleep that resolved.
   Measured with step 3 below: 13 / 19; the fix on that base alone measured 16 / 25 and still failed.
2. Extract `formatFindTimeout` (the `lastSeenInfo` ternary and the timeout lines) into a pure function below `findRun`, beside `formatFind`.
   It removes about 3 cognitive points from nesting depth 3.
3. Extract `fetchRunJobs(runId, retryOptions): Promise<CIJob[]>` below `findRun`, a pure move of the jobs `ghJsonRetrying` call.
   Measured after steps 1–3: 12 / 16; the fix on that base measured 15 / 22 and passed.

### The fix

`fetchRunJobs` owns the 404 classification and returns the 404 as a value; every other failure still throws:

```typescript
/** The run's jobs, or the 404 its jobs endpoint returns while the run is new. */
async function fetchRunJobs(
  runId: number,
  retryOptions: RetryOptions,
): Promise<CIJob[] | Error> {
  try {
    const { jobs } = await ghJsonRetrying<RunJobs>(
      ["run", "view", String(runId), "--json", "jobs"],
      retryOptions,
    );
    return jobs;
  } catch (error) {
    if (isNotFoundError(error)) return error;
    throw error;
  }
}

function isNotFoundError(error: unknown): error is Error {
  return error instanceof Error && /HTTP 404\b/.test(error.message);
}
```

`findRun`'s call site, inside the outer `try`:

```typescript
if (matchingRun) {
  const jobs = await fetchRunJobs(matchingRun.databaseId, retryOptions);
  if (!(jobs instanceof Error)) return formatFind(matchingRun, jobs);
  if (elapsed >= timeout) throw jobs;
  onProgress?.(
    `jobs for run ${matchingRun.databaseId} not available yet (HTTP 404), polling again`,
  );
  continue;
}
```

`continue` re-enters the loop, which sleeps `findRetryDelay(attempt)`, re-lists, re-matches, and re-fetches.
A rethrown 404 is not an abort, so the outer catch rethrows it unchanged.
`isNotFoundError` stays private in `ci.ts`: it has one consumer, and `isTransientError` keeps its 4xx exclusion.

### Edge cases (each tested)

| Case                                                                 | Behavior                                                              | Test step |
| -------------------------------------------------------------------- | --------------------------------------------------------------------- | --------- |
| Jobs 404 on the first poll, jobs succeed on the next                 | Progress notice, 5 s poll sleep, success output for the run           | 4         |
| Jobs 404 still at `elapsed >= timeout`                               | Rethrow the 404                                                       | 4         |
| `timeout: 0` and a jobs 404                                          | Rethrow on the first poll, as today                                   | 4         |
| Run-list 404                                                         | Throws (existing `surfaces a gh failure instead of blaming the user`) | unchanged |
| Jobs 403                                                             | Throws                                                                | 2         |
| Abort before, during sleep, during run-list retry, during jobs retry | `formatAborted` with the same `retries`/`elapsed` lines as today      | 2         |

## Module-Level Changes

- `packages/pi-github-tools/src/lib/ci.ts`: outer abort catch in `findRun`; new private `formatFindTimeout`, `fetchRunJobs`, `isNotFoundError`; `findRun` polls through a jobs 404.
- `packages/pi-github-tools/test/lib/ci.test.ts`: shared `sha` and matching-run fixture at module scope; abort and jobs-failure characterization tests; jobs-404 tests.
- `packages/pi-github-tools/README.md`: the `ci_find` section gains a sentence on the jobs-404 wait and the rethrow at timeout.
- `.pi/skills/package-pi-github-tools/SKILL.md`: an Implementation Priorities bullet records that `ci_find` treats a jobs 404 on a just-listed run as not ready, the one 4xx the package waits out.

Predicted unchanged:

- `src/lib/retry.ts`: `TRANSIENT_PATTERNS` and `isTransientError` keep excluding every 4xx (Goals).
- `src/lib/github.ts`: the error message format `isNotFoundError` reads is already `gh()`'s.
- `src/tools/ci-find.ts`: it already maps a thrown error to `err()`, and the success and timeout output shapes do not change.
- `test/lib/retry.test.ts`: its 404-is-not-transient case stays true.
- `.pi/prompts/ship.md`: see Non-Goals.

## Test Impact Analysis

1. New tests: the abort-exit characterizations pin output the outer-catch refactor must reproduce exactly, which today only the poll-sleep abort covers, weakly (`toContain`).
2. Redundant tests: the existing `returns abort message when signal fires during sleep` becomes a subset of the step 2 exact-match test; replace it there rather than keep both.
3. Stays as-is: `surfaces a gh failure instead of blaming the user` (run-list 404), the `transient failures` block (retry backoff charged to `elapsed`), and the success and timeout tests.

## Invariants at risk

| Invariant                                                           | Constituency                              | Pinned by                                                                                               |
| ------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| A run-list 404 surfaces as an error, not a timeout                  | an agent passing a wrong workflow name    | `findRun > surfaces a gh failure instead of blaming the user` (opened: mocks only `runCommand`/`sleep`) |
| Transient-retry backoff counts against `timeout`                    | `/ship`'s bounded wait                    | `transient failures > findRun charges the retry backoff against the timeout`                            |
| Abort returns `aborted: cancelled by user` with `retries`/`elapsed` | an operator cancelling a tool call        | step 2 exact-match tests                                                                                |
| Every 4xx other than this jobs 404 surfaces                         | callers that need a real permission error | step 2 jobs-403 test                                                                                    |

## TDD Order

1. `test(pi-github-tools): share the matching-run fixture across ci tests`.
   Hoist `sha` and `mockMatchingRun()` from `describe("transient failures")` to module scope in `test/lib/ci.test.ts`, and use the helper in the `findRun` tests that write the same run literal inline.
   Pure test refactor; the suite stays green with no assertion changed.

2. `test(pi-github-tools): pin findRun's abort exits and jobs failures`.
   Add exact-match (`toBe`) tests under `describe("findRun")`, in a nested `describe("abort")` and `describe("jobs fetch")`:
   - sleep abort → `"aborted: cancelled by user\n  retries: 2\n  elapsed: 0s"` (replaces the weak existing test);
   - signal aborted before the call → `retries: 1`, `elapsed: 0s`, and `mockRunCommand` not called;
   - run list `HTTP 503`, then the retry sleep aborts → `retries: 1`, `elapsed: 1s`;
   - matching run, jobs `HTTP 503`, then the retry sleep aborts → `retries: 1`, `elapsed: 1s`;
   - matching run, jobs `HTTP 403: Forbidden` → rejects with `/HTTP 403/`.

   These pass against today's code; each is a characterization pin, so mutate before committing.
   Killing mutations: change the sleep catch's `formatAborted` to omit the `retries` line (kills the sleep-abort test); delete the run-list catch's abort return so it rethrows (kills the run-list abort test); delete the jobs catch's abort return (kills the jobs abort test); delete the top-of-loop abort check (kills the pre-aborted test, which then calls `runCommand`).

3. `refactor(pi-github-tools): collapse findRun's abort exits into one catch`.
   Wrap the loop in the outer catch, delete the three inner catches, use `signal?.throwIfAborted()`, extract `formatFindTimeout` and `fetchRunJobs` (pure moves, placed below `findRun`).
   Step 2's tests stay green.
   Run `pnpm --silent fallow health --workspace @gotgenes/pi-github-tools` and expect `findRun` at 12 / 16 (measured by the assessor on a scratch copy).
   The audit warns `added-suppression` for the re-indented `eslint-disable-next-line`; that is a warning, not a failure.
   Re-read the moved code against the `code-design` skill before committing.

4. `fix(pi-github-tools): ci_find waits out a new run's jobs 404 instead of failing`.
   Tests under `describe("findRun") > describe("jobs fetch")`:
   - matching run, jobs `HTTP 404: Not Found`, matching run, jobs succeed → `toBe` the full success output; `onProgress` called with `"jobs for run 100 not available yet (HTTP 404), polling again"`; `mockSleep` called with `5000`;
   - `timeout: 5`, jobs 404 on both polls → rejects with `/HTTP 404/` after one `5000` sleep;
   - `timeout: 0`, jobs 404 → rejects with `/HTTP 404/` and `mockSleep` not called.

   Implement `fetchRunJobs`'s 404 return, `isNotFoundError`, and the call-site branch.
   Killing mutations: make `isNotFoundError` return `false` (kills the success-after-404 test); delete `if (elapsed >= timeout) throw jobs;` (kills both exhaustion tests, which then loop past their mocks and reject with a `TypeError`); make `isNotFoundError` return `true` for any `Error` (kills step 2's jobs-403 test); delete the `onProgress` call (kills the notice assertion).
   Confirm `pnpm --silent fallow audit --staged` passes (predicted 15 / 22, "worsened: warn only").

5. `docs(pi-github-tools): document ci_find's wait on a new run's jobs 404`.
   README `ci_find` section and the package skill bullet (Module-Level Changes).

## Risks and Mitigations

- The outer catch changes which exits run, not their output: step 2 pins every abort exit's exact text before step 3 moves them.
- A non-abort error thrown while the signal happens to be aborted returns `formatAborted`, as each inner catch does today.
- The fix lands near the audit tier boundary (measured 22 against a failing 25): step 4's verify runs the gate before committing, and any further growth in `findRun` belongs in `fetchRunJobs` or `formatFindTimeout`.
- A persistent jobs 404 now costs the whole `timeout` (120 s by default) before the error surfaces.
  That case is not observed, and the rethrown error is the same one the caller sees today.
- `/ship` runs the pre-merge `ci_find` until Pi restarts (AGENTS.md); the ship of this issue itself exercises the old code.

## Open Questions

- How long the jobs-404 window lasts is unmeasured; both observations recovered on an immediate retry, well inside the 5 s first poll sleep.

[#1026]: https://github.com/gotgenes/pi-packages/issues/1026
