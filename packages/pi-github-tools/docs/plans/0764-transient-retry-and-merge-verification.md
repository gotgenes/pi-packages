---
issue: 764
issue_title: "pi-github-tools: release_pr_merge has no transient-error retry, and reports failure without checking whether the merge landed"
---

# Transient-Error Retry and Post-Merge State Verification

## Release Recommendation

**Release:** ship independently

`pi-github-tools` has no `docs/architecture/` roadmap, so this issue belongs to no release batch.
It is a self-contained tool-behavior change plus the doc and prompt edits that consume it — nothing downstream waits on a sibling step.

## Problem Statement

During a GitHub incident, a single logical merge cost four `release_pr_merge` calls, and the failures came from two different places.

Attempts 1 and 2 failed in the **precheck**: `gh pr view --json …` (GraphQL) returned HTTP 503.
A 503 is transient by definition, and the tool already waits out an in-progress check and an undecided mergeability state — waiting out a 5xx is the same class of patience.
The tool instead surfaced the first one raw.

Attempt 3 is the dangerous one.
The precheck passed, so the failure came from the `gh pr merge` **mutation**.
That error is ambiguous: the merge may or may not have applied before the response was lost.
The tool surfaced the raw error, which invites a blind retry against a possibly-already-merged PR.
The operator had to verify by hand before it was safe to retry:

```console
$ gh api repos/gotgenes/pi-packages/pulls/763 --jq '{state:.state,merged:.merged}'
{"merged":false,"state":"open"}
```

REST answered throughout while GraphQL was returning 503s, so the verification path stays available exactly when the merge path does not.

The ambiguous merge outcome is the correctness hazard and the retry is convenience, but the retry is the enabler: verification is itself a network read, and it deserves the same patience.

## Goals

- A shared transient-error retry wraps every read-only `gh` call in the package, so `release_pr_merge`, `release_pr_find`, `ci_find`, `ci_watch`, and `ci_list` all survive a 5xx instead of surfacing the first one.
- Mutations (`gh pr merge`, `gh issue close`) are **not** auto-retried — retry is opt-in at the call site, never a property of `gh()`.
- When the merge call itself fails, `mergeReleasePR` re-reads the PR's merge state over REST before reporting, and reports three outcomes distinctly: merged, not merged, and could-not-verify.
- A verified-merged outcome completes the job — `git pull --ff-only`, then the normal success block plus a note naming the transport error and the verification.
- A verified-not-merged outcome is an error that says so explicitly, so a caller never has to guess whether a retry is safe.
  The tool does not retry the mutation itself.
- A genuine `gh` failure in `release_pr_find`, `ci_find`, `ci_watch`, or `release_watch` stops reporting itself as `aborted: cancelled by user`.
- Not breaking: no config default changes, no successful call changes outcome, and the success block's `Merged PR #N` / `head_sha:` / `short_sha:` lines stay byte-identical.

## Non-Goals

- **Retrying `gh pr merge` or `gh issue close` automatically.**
  The operator chose report-only for the verified-not-merged case.
  GitHub's REST best-practices guidance is to auto-retry idempotent operations only; a retried `gh issue close --comment` would also post a duplicate comment.
- **Retrying `git` network operations.**
  `git fetch --tags` in `watchRelease` and `git pull --ff-only` in `performMerge` can also fail transiently, but the transient classifier is written against `gh`'s stderr vocabulary.
  Those calls only stop misreporting as aborts; they gain no retry.
- **Honoring `retry-after` or handling secondary rate limits.**
  `gh` does not surface response headers through stdout/stderr, so there is nothing to read.
  Primary/secondary rate-limit errors (403/429) are deliberately **not** classified as transient — retrying them makes throttling worse.
- **Unifying status derivation across `ci.ts`, `ci-helpers.ts`, and `merge-state.ts`.**
  Still tracked by [#564]; this change adds no new status vocabulary.
- **Reworking the `release_pr_merge` poll loop or the merge-readiness classification from [#673].**
  `classifyMergeState` and the wait-for-checks behavior are untouched.

## Background

### Current shape

`gh()` in `src/lib/github.ts` throws `gh <args> failed (exit N): <stderr>` on a non-zero exit, with no retry.
`ghJson()` composes `gh()` plus `JSON.parse`.
Every read in the package goes through `ghJson`; the only two mutations, `gh pr merge` and `gh issue close`, go through `gh()` directly.

`mergeReleasePR` (`src/lib/release.ts`) polls `ghJson(["pr","view",…])` at the top of each cycle, dispatches on `classifyMergeState`, and on `ready` calls the private `performMerge`, which runs `gh pr merge --<method>` → `git pull --ff-only` → `git rev-parse HEAD`.
Nothing catches a throw from either the precheck or the mutation; both propagate to the tool wrapper's `catch`, which returns `err(e.message)`.
Every tool wrapper in `src/tools/` has that same `catch (e) { return err(...) }`, so a thrown error already surfaces as a structured tool error.

Three sibling loops — `findReleasePR`, `findRun`, `watchRun` — and `watchRelease` wrap their `gh`/`git` calls in a blanket `catch {}` that returns `aborted: cancelled by user`.
During the incident those tools would have blamed the user for a GitHub 503.
The [#673] plan named this wart and deliberately left it alone; this issue's scope answer brings it in.

### Verification path (measured)

```console
$ gh api 'repos/{owner}/{repo}/pulls/763' --jq '{state:.state,merged:.merged,merge_commit_sha:.merge_commit_sha}'
{"merge_commit_sha":"e1292fd5d598b79c94a23968b42b86ad5ba9647f","merged":true,"state":"closed"}
```

Run against this repo with `gh` 2.97.0.
Two properties matter.
`gh api` expands the `{owner}` and `{repo}` placeholders from the local repo, so verification needs no `detectRepo()` call and adds no argument to the tool.
And the payload carries `merge_commit_sha`, so a verified-merged outcome can report a real SHA rather than an assertion.

### Ecosystem grounding

`@octokit/plugin-retry` — the reference implementation for this exact problem against this exact API — retries server 5xx (and 4xx outside an explicit `doNotRetry` list) **3 times**, with polynomial backoff on a 1 s base: `base * (n + 1)^2` → 1 s, 4 s, 9 s.
GitHub's REST best-practices documentation adds that automatic retries belong to idempotent operations.
This plan adopts octokit's retry count and curve rather than inventing one, and adopts the idempotency rule as the reason mutations stay opt-out.

The package's existing `findRetryDelay` (5 s base, doubling, 30 s cap, unbounded attempts) is a **polling** curve for "the resource does not exist yet".
It is the wrong shape here — a transient-error retry must be bounded in attempts, and its first retry should be fast.
The two curves stay separate.

### Constraints from `AGENTS.md`

- `src/lib/` must not import from `@earendil-works/pi-coding-agent`.
  The new module is pure plus a `sleep` call, so this holds.
- The `gh` CLI is the sole external binary dependency; verification uses `gh api`, adding no dependency.
- `AGENTS.md` § Workflow currently carries the manual verify-before-retry runbook this change automates for `release_pr_merge`; the rule must survive for hand-run `gh pr merge` (the empty-rollup fallback path) while noting the tool now owns it.
- The package ships a `files` allowlist with no `docs` entry, so `docs/plans/` is not published — no allowlist edit.

## Design Overview

### New module: `src/lib/retry.ts`

Classification and the backoff schedule are pure and have enough case-space to deserve their own tests, matching the `ci-helpers.ts` / `merge-state.ts` precedent of a pure sibling module with a dedicated test file.

```typescript
/** Context handed to `onRetry` before each backoff sleep. */
export interface RetryAttempt {
  attempt: number; // 1-indexed; the attempt that just failed
  delayMs: number; // how long the caller is about to wait
  error: Error;
}

export interface RetryOptions {
  onRetry?: (info: RetryAttempt) => void;
  signal?: AbortSignal;
}

/** True when a `gh` failure is worth retrying (server-side or network, never a 4xx). */
export function isTransientError(error: unknown): boolean;

/** Backoff before retry `n` (1-indexed), in ms: 1000, 4000, 9000. */
export function transientRetryDelay(attempt: number): number;

/** Run `fn`, retrying transient failures up to 3 times with the schedule above. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T>;
```

`isTransientError` matches on the error message, since that is all `gh` gives us — `gh()` embeds the child's stderr verbatim.

| Retried | Pattern                                                                       | Source                                              |
| ------- | ----------------------------------------------------------------------------- | --------------------------------------------------- |
| yes     | `HTTP 5xx` (500, 502, 503, 504)                                               | measured in [#732] as the literal stderr `HTTP 503` |
| yes     | `no server is currently available`                                            | GraphQL error text named in the issue               |
| yes     | `connection reset`, `EOF`, `i/o timeout`, `TLS handshake timeout`, `dial tcp` | Go HTTP client transport errors `gh` passes through |
| no      | anything else, including 401/403/404/422 and rate-limit text                  | non-transient; retrying is wrong or harmful         |

`withRetry` sleeps via `sleep(ms, signal)` from `process.ts`, so an abort during backoff rejects and propagates rather than being retried, and tests can mock the sleep.
A non-transient error is rethrown on the first attempt with no delay.
After the third retry fails, the last error is rethrown unchanged — the caller sees the real `gh` message, not a wrapper.

### Composition point: `ghJsonRetrying` in `github.ts`

```typescript
export async function ghJsonRetrying<T>(
  args: string[],
  options: RetryOptions = {},
): Promise<T> {
  return withRetry(() => ghJson<T>(args, options.signal), options);
}
```

Retry is a call-site decision, not a property of `gh()`.
`gh()` and `ghJson()` keep their single-shot semantics, so the two mutation call sites cannot acquire retry by accident, and read call sites opt in by naming a different function — greppable in review.

Consumer sketch, from `mergeReleasePR`:

```typescript
const pr = await ghJsonRetrying<PRState>(["pr", "view", String(prNumber), "--json", FIELDS], {
  signal,
  onRetry: ({ attempt, delayMs, error }) => {
    elapsed += Math.round(delayMs / 1000);
    onProgress?.(`transient gh failure (${error.message}); retry ${attempt}/3 in ${delayMs / 1000}s`);
  },
});
```

The `onRetry` hook does double duty deliberately.
It is the only place the loop learns that wall-clock time passed outside its own `sleep`, so folding `delayMs` into `elapsed` there keeps the `timeout` bound honest.
Without it, a sustained incident could add up to 14 s per poll cycle — 30 cycles at the 300 s default, so roughly 7 extra minutes of unaccounted wall clock.

### Merge-failure verification

`performMerge` gains one failure branch.
Verification runs on **any** merge-call failure, not only a transient-looking one: classification is a heuristic, the REST read is ground truth, and the whole point of the issue is that the caller should never guess.

```typescript
try {
  await gh(["pr", "merge", String(prNumber), `--${method}`], signal);
} catch (error) {
  if (signal?.aborted) return abortedMergeResult(elapsed);
  return resolveMergeFailure(prNumber, title, error, signal);
}
```

`resolveMergeFailure` reads the PR over REST through `ghJsonRetrying` (so the verification itself survives a flaky moment) and returns one of three shapes.

```typescript
interface MergeVerification {
  merged: boolean;
  state: string; // "open" | "closed"
  merge_commit_sha: string | null;
}
```

Verified merged — `isError: false`, first three lines byte-identical to today's success block:

```text
Merged PR #42: chore(main): release 1.2.0
head_sha: e1292fd5d598b79c94a23968b42b86ad5ba9647f
short_sha: e1292fd
note: the merge call failed (gh pr merge 42 --rebase failed (exit 1): HTTP 503) but the merge landed
verified: merged via REST (merge_commit_sha: e1292fd5d598b79c94a23968b42b86ad5ba9647f)
```

`git pull --ff-only` and `git rev-parse HEAD` run first, exactly as on the clean path, so `head_sha` means the same thing in both.

Verified not merged — `isError: true`:

```text
failed to merge PR #42
  merged: false
  state: open
  error: gh pr merge 42 --rebase failed (exit 1): HTTP 503
  verified: not merged via REST
  safe to retry: yes
```

Verification failed — `isError: true`, and it must not claim either outcome:

```text
failed to merge PR #42
  merged: unknown
  error: gh pr merge 42 --rebase failed (exit 1): HTTP 503
  verification_error: gh api repos/{owner}/{repo}/pulls/42 failed (exit 1): HTTP 503
  safe to retry: no — verify by hand with: gh api repos/{owner}/{repo}/pulls/42 --jq '{state:.state,merged:.merged}'
```

The first line is `failed to merge PR #N`, deliberately distinct from the pre-merge refusal's `PR #N is not mergeable`.
The two mean different things — one is "I did not try", the other is "I tried and the outcome is this" — and the prompts key on the `reason:` line that only the first carries.

### Abort versus failure in the sibling loops

Each blanket `catch {}` becomes:

```typescript
} catch (error) {
  if (signal?.aborted) return abortedResult(...);
  throw error;
}
```

The guard tests the signal rather than the error's shape.
`sleep` rejects with `signal.reason`, which is caller-supplied and not guaranteed to be an `AbortError`, so shape-matching would be unreliable; the signal is authoritative.
A rethrown error lands in the tool wrapper's existing `catch` and surfaces as `err(<real gh message>)`, which is the whole point.

Applies to `findReleasePR` (2 sites), `findRun` (3 sites), `watchRun` (2 sites), and `watchRelease` (4 sites).
`mergeReleasePR`'s existing `sleep`-only catches get the same guard for consistency, though only abort can reach them today.

## Module-Level Changes

Greps run to build this list: `ghJson`, `gh(\[`, `cancelled by user`, `release_pr_merge`, `is not mergeable`, `performMerge`, and `findRetryDelay` across `packages/pi-github-tools/{src,test,docs}`, `.pi/prompts/`, `.pi/skills/`, `README.md`, and `AGENTS.md`.
This package has no `docs/architecture/` tree, so there is no module-layout listing, complexity table, or health-metrics row to update — but `.pi/skills/package-pi-github-tools/SKILL.md` carries a `src/lib/` module tree that plays that role.

### Added

- `packages/pi-github-tools/src/lib/retry.ts` — `RetryAttempt`, `RetryOptions`, `isTransientError`, `transientRetryDelay`, `withRetry`.
- `packages/pi-github-tools/test/lib/retry.test.ts` — classification matrix, backoff schedule, exhaustion, abort during backoff.

### Changed

- `packages/pi-github-tools/src/lib/github.ts` — adds `ghJsonRetrying`.
  `gh`, `ghJson`, `git`, and `detectRepo` are unchanged; `detectRepo` keeps plain `ghJson`, since its failure mode is "not authenticated" (non-transient) and it already falls back to the git remote.
- `packages/pi-github-tools/src/lib/release.ts`
  - `findReleasePR` — `gh pr list` via `ghJsonRetrying`; abort/failure guard replaces the blanket catches.
  - `mergeReleasePR` — precheck via `ghJsonRetrying` with the `elapsed`-folding `onRetry`; sleep catches gain the signal guard.
  - `performMerge` — wraps the mutation, delegates to a new private `resolveMergeFailure`.
  - New private helpers `resolveMergeFailure`, `verifyMergeState`, `mergedAfterFailureResult`, `mergeFailureResult`, plus the `MergeVerification` interface, all below `mergeReleasePR` per the stepdown rule.
  - `watchRelease` — abort/failure guard on its four `git` catches (no retry).
- `packages/pi-github-tools/src/lib/ci.ts` — `findRun`, `watchRun`, and `listRuns` read via `ghJsonRetrying`; `findRun` and `watchRun` fold retry delay into `elapsed` and emit a retry progress line; abort/failure guards replace the blanket catches.
- `packages/pi-github-tools/src/tools/release-pr-merge.ts` — `description` and `promptSnippet` gain the retry and verification behavior.
- `packages/pi-github-tools/test/lib/release.test.ts` — the four abort tests must abort the controller *inside* the mocked `sleep` rejection (see Test Impact Analysis); new tests for precheck retry, the three merge-failure outcomes, and timeout accounting.
- `packages/pi-github-tools/test/lib/ci.test.ts` — same abort-test rewrite for `findRun` and `watchRun`; new retry tests.
- `packages/pi-github-tools/test/lib/github.test.ts` — new `ghJsonRetrying` describe block.
- `packages/pi-github-tools/README.md` — the `release_pr_merge` section gains the `failed to merge` outcomes; a new short subsection documents the shared transient retry (which tools, which errors, the 1/4/9 s schedule, and that mutations are excluded).
- `.pi/skills/package-pi-github-tools/SKILL.md` — the `src/lib/` module tree adds `retry.ts`, and also `merge-state.ts`, which [#673] added without updating the tree.
  The Testing section gains a line that transient-retry tests mock `sleep`.
- `AGENTS.md` — the § Workflow verify-before-retry bullet keeps the manual rule for hand-run `gh pr merge` and notes `release_pr_merge` now verifies on its own; the § Multi-session release paragraph's "Prefer `release_pr_merge`" sentence adds transient retry and the `merged:` outcome line.
- `.pi/prompts/ship-issue.md` — step 6.4 and the matching Constraints bullet (line ~154).
- `.pi/prompts/land-worktree.md` — step 2's bullet list and the matching Constraints bullet (line ~97).
- `.pi/prompts/ship-no-issue.md` — step 5.3 and the matching Constraints bullet (line ~61).

Each prompt states its `release_pr_merge` handling twice — once in the numbered step, once in a Constraints bullet — so both passages change together in each file.
The surviving `gh pr merge <N> --rebase` fallback for the empty-rollup case stays `--rebase` in all three.

### Not changed

`src/lib/merge-state.ts`, `src/lib/ci-helpers.ts`, `src/lib/config.ts`, `src/lib/process.ts`, and `src/lib/issue.ts` are untouched.
`findRetryDelay` keeps its polling role and its existing callers.
No tool's TypeBox parameter schema changes, so no tool gains or loses an argument.

## Test Impact Analysis

1. **New tests the split enables.**
   `isTransientError` and `transientRetryDelay` are pure, so the full pattern matrix — each 5xx, the GraphQL text, each transport string, and the negative cases (401/403/404/422, rate-limit text, a JSON parse error) — is covered with no subprocess mock at all.
   Expressed through `mergeReleasePR` instead, each case would cost a multi-call `runCommand` sequence.
   `withRetry` gets direct tests for the retry count, the exact sleep arguments (1000, 4000, 9000), first-attempt success with zero sleeps, rethrow-on-non-transient with zero sleeps, and abort during backoff.
2. **Tests that become redundant.**
   None are removed.
   The loop-level tests still earn their place as wiring checks — that `ghJsonRetrying` is actually the function the loop calls, and that `onRetry` folds into `elapsed`.
3. **Tests that must stay as-is in substance.**
   The three merge-method tests, the signal-threading test from [#5], and the [#673] check-wait/blocked/timeout tests all pin behavior this change must not disturb.
   They need no mechanical edit: `ghJsonRetrying` issues the identical `runCommand` call on a first-attempt success, so call ordinals and asserted argument arrays are unchanged.
4. **The abort tests change meaning and must be rewritten deliberately.**
   Four tests (`findReleasePR`, `findRun`, `watchRun`, `watchRelease`) today create an `AbortController`, never abort it, and make `sleep` reject — asserting the loop reports `aborted:`.
   That assertion only passes because of the bug being fixed.
   Aborting the controller *before* the call would not exercise the same path either, since the loop's top-of-cycle check returns first.
   Each must reject from inside a `mockImplementationOnce` that aborts the controller, so the guard sees a genuinely aborted signal:

   ```typescript
   mockSleep.mockImplementationOnce(() => {
     controller.abort();
     return Promise.reject(new Error("The operation was aborted."));
   });
   ```

   Each gains a sibling test asserting that a non-abort `gh` failure now **throws** with the real message instead of returning `aborted:`.

## Invariants at Risk

| Invariant                                                                                                | From   | Pinned by                                | Risk here                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `signal` reaches every `gh`/`git` call in `mergeReleasePR`                                               | [#5]   | `threads signal to gh and git calls`     | `ghJsonRetrying` must forward `options.signal` into `ghJson`, and `withRetry` into `sleep` — a dropped relay makes the tool uncancellable during backoff         |
| Success block is `Merged PR #N: <title>` / `head_sha:` / `short_sha:`, consumed by `/ship-issue` step 6b | [#673] | `defaults to --merge`                    | The verified-merged path emits the same three lines and appends only `note:`/`verified:` after them                                                              |
| Blocked failure's first line is `PR #N is not mergeable` with a `reason:` line the prompts key on        | [#673] | `returns error when PR is not mergeable` | The new failure shape uses a different first line (`failed to merge PR #N`) and carries no `reason:` line, so prompt matching is unaffected                      |
| The check-wait loop merges once checks settle and fails fast on a real block                             | [#673] | the `UNSTABLE`/`UNKNOWN`/timeout tests   | Retry must not swallow a non-transient `gh pr view` failure into a silent extra poll                                                                             |
| `timeout` bounds the tool's wall clock                                                                   | [#673] | the timeout test                         | Retry backoff happens outside the loop's own `sleep`; the `onRetry` hook folds it into `elapsed`, and a test asserts the timeout accounting includes retry delay |

Quantitatively: a first-attempt success adds zero delay and zero extra subprocess calls, so the clean path is unchanged by construction.
A transient failure adds at most 1 + 4 + 9 = 14 s per read call before the error surfaces.
A failed merge call adds exactly one `gh api` subprocess call.

## TDD Order

Each step lands red and green in one commit, matching `docs/plans/0005-abort-signal-threading.md` — no red-only commit reaches `main`.

1. **Transient classification, backoff, and the retrying read.**
   Test surface: new `test/lib/retry.test.ts` plus a `ghJsonRetrying` block in `test/lib/github.test.ts`.
   Covers the classification matrix, the 1/4/9 s schedule, exhaustion, non-transient rethrow, abort during backoff, and signal forwarding.
   Creates `src/lib/retry.ts` and `ghJsonRetrying`; the first production consumer lands in step 2, so do not split further or `pnpm fallow dead-code` sees a test-only export.
   Commit: `feat(pi-github-tools): retry transient gh failures on read-only calls (#764)`
2. **Verify merge state after a failed merge call.**
   Test surface: `test/lib/release.test.ts`.
   Adopts `ghJsonRetrying` for the `mergeReleasePR` precheck (with the `elapsed`-folding `onRetry`), then adds the failure branch: precheck 503 retried then merges; merge call fails and REST says merged → success block with `note:`/`verified:` and a completed `git pull`; merge call fails and REST says not merged → `failed to merge` with `merged: false` and `safe to retry: yes`; merge call fails and verification also fails → `merged: unknown`; timeout accounting includes retry backoff.
   This is the issue's priority outcome and lands as early as its dependency on step 1 allows.
   Commit: `feat(pi-github-tools): verify merge state before reporting a merge failure (#764)`
3. **Retry the CI and release-find reads.**
   Test surface: `test/lib/ci.test.ts`, `test/lib/release.test.ts`.
   `findRun`, `watchRun`, `listRuns`, and `findReleasePR` read through `ghJsonRetrying`; the polling loops emit a retry progress line and fold the delay into `elapsed`.
   Commit: `feat(pi-github-tools): retry transient gh failures in the CI and release-find tools (#764)`
4. **Stop reporting `gh` failures as user cancellation.**
   Test surface: `test/lib/ci.test.ts`, `test/lib/release.test.ts`.
   Replaces the blanket catches in `findReleasePR`, `findRun`, `watchRun`, and `watchRelease` with the signal guard.
   Rewrites the four abort tests to abort from inside the mocked `sleep` rejection, and adds a sibling test per loop asserting a real failure now throws with the `gh` message.
   Commit: `fix(pi-github-tools): report gh failures as errors instead of user cancellation (#764)`
5. **Documentation, skill, and workflow prompts.**
   Updates `packages/pi-github-tools/README.md`, `.pi/skills/package-pi-github-tools/SKILL.md` (module tree gains `retry.ts` and the missing `merge-state.ts`), `AGENTS.md`, and the three ship/land prompts — numbered step and Constraints bullet together in each.
   Commit: `docs: document transient retry and merge-state verification (#764)`

## Risks and Mitigations

| Risk                                                                                                          | Mitigation                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| An over-broad transient pattern retries a real failure, hiding it for 14 s and costing three wasted calls     | Explicit allowlist of patterns, with negative tests for 401/403/404/422, rate-limit text, and JSON parse errors; the default is not-transient                                        |
| Retrying a rate-limit error would deepen throttling                                                           | 403/429 are classified non-transient by design, matching GitHub's guidance; a negative test pins it                                                                                  |
| Retry acquired accidentally by a mutation, re-firing `gh pr merge` or double-posting an `issue_close` comment | Retry is opt-in through a differently named function; `gh()` keeps single-shot semantics, and no mutation call site changes                                                          |
| Retry backoff escaping the `timeout` bound, so the tool hangs longer than the caller asked                    | `onRetry` folds `delayMs` into `elapsed` at each polling call site, with a test asserting the accounting                                                                             |
| The verified-merged path reporting a `head_sha` that predates the merge                                       | `git pull --ff-only` runs before `git rev-parse HEAD` on that path, identical to the clean path; a test asserts the call order                                                       |
| Verification failing too, and the tool guessing                                                               | A distinct `merged: unknown` outcome that refuses to guess and prints the exact manual probe                                                                                         |
| The abort-test rewrite quietly weakening abort coverage                                                       | Each rewritten test aborts the controller inside the mocked rejection, so the guard sees a genuinely aborted signal; each gains a sibling failure test, so both branches stay pinned |
| Prompt and `AGENTS.md` edits drifting from tool behavior                                                      | The doc step lands last, after behavior is final; both passages per prompt are listed in Module-Level Changes                                                                        |

## Open Questions

- Whether `git` network operations (`git fetch --tags`, `git pull --ff-only`) deserve the same retry.
  Deferred, not filed: the classifier is written against `gh` stderr, and no observed failure has come from the git side.
  Revisit if one does.
- Whether the transient pattern list should live in configuration.
  Not now — a user-tunable regex list invites exactly the over-broad matching the first risk row guards against.
- No follow-up issues are filed by this plan.
  The one adjacent piece of work, unifying status derivation across the CI and merge-state modules, is already tracked by [#564].

[#5]: https://github.com/gotgenes/pi-packages/issues/5
[#564]: https://github.com/gotgenes/pi-packages/issues/564
[#673]: https://github.com/gotgenes/pi-packages/issues/673
[#732]: https://github.com/gotgenes/pi-packages/issues/732
