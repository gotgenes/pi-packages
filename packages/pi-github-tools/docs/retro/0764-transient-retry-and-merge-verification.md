---
issue: 764
issue_title: "pi-github-tools: release_pr_merge has no transient-error retry, and reports failure without checking whether the merge landed"
---

# Retro: #764 — Transient-error retry and merge-state verification

## Stage: Planning (2026-08-17T20:37:30Z)

### Session summary

Read the issue (filed by the operator out of the #732 ship incident), the `pi-github-tools` source, the #673 plan, and the #732 retro, then put three direction questions to the operator.
The answers set the scope: a shared retry helper across all read-only `gh` calls plus the `aborted: cancelled by user` misreport fix; a verified-merged outcome that completes the job; and report-only (no auto-retry) when verification says the PR did not merge.
Wrote `packages/pi-github-tools/docs/plans/0764-transient-retry-and-merge-verification.md` — five TDD steps, with the merge-state verification landing as early as its dependency on the retry helper allows.

### Observations

- Two facts were measured at planning time rather than inferred.
  `gh api 'repos/{owner}/{repo}/pulls/763'` expands the `{owner}`/`{repo}` placeholders from the local repo, so verification needs no `detectRepo()` call and no new tool argument, and it returns `merge_commit_sha` — so a verified-merged outcome reports a real SHA.
- The backoff curve is taken from `@octokit/plugin-retry` (3 retries, polynomial 1 s base → 1 s, 4 s, 9 s) rather than invented, and GitHub's "auto-retry idempotent operations only" guidance is the stated reason mutations stay opt-out.
  The package's existing `findRetryDelay` was deliberately **not** reused: it is a polling curve (5 s base, 30 s cap, unbounded attempts), which is the wrong shape for a bounded transient retry.
- Retry is composed as a separately named `ghJsonRetrying` rather than folded into `ghJson`, so the two mutation call sites (`gh pr merge`, `gh issue close`) cannot acquire retry by accident and the opt-in is greppable.
- Timeout accounting is a real hazard the design had to answer: retry backoff happens outside each loop's own `sleep`, so without folding `delayMs` into `elapsed` via `onRetry`, a sustained incident could add roughly seven unaccounted minutes at the 300 s default.
- Four existing abort tests pass only because of the bug being fixed — they never abort their controller and rely on the blanket `catch {}`.
  The plan spells out the rewrite (abort from inside the mocked `sleep` rejection), since aborting before the call would exercise the loop's top-of-cycle check instead.
- Verification runs on **any** merge-call failure, not just a transient-looking one: classification is a heuristic, the REST read is ground truth, and one path is simpler than two.
- Found while grepping doc touch points: `.pi/skills/package-pi-github-tools/SKILL.md`'s module tree never gained `merge-state.ts` from #673.
  Folded that correction into this plan's doc step.
- No follow-up issues filed.
  Git-side retry and a configurable pattern list are named in Open Questions as deliberately deferred, not as work to track.

## Stage: Implementation — TDD (2026-08-17T20:59:00Z)

### Session summary

Landed all five planned TDD steps plus one tidy-first preparatory commit, in six commits.
The package suite went from 112 to 162 tests; all four gates (`check`, root `lint`, `test`, `fallow dead-code`) were green at baseline and remain green.
`release_pr_merge` now retries transient reads, verifies over REST whether a failed merge call landed, and the four polling loops stop reporting a `gh` failure as a user cancellation.

### Observations

- The `tidy-first-assessor` earned its keep: it counted 15 verbatim `"aborted: cancelled by user"` blocks across `release.ts` and `ci.ts` and recommended extracting `formatAborted` first.
  That turned step 4's guard into a one-line-per-site diff instead of a 15-site multi-line rewrite.
  It also correctly *declined* to pre-extract the `if (signal?.aborted) … throw` guard itself, on the grounds that the guard is the behavior change, not preparation for it.
- Two shared helpers appeared that the plan's API sketch did not name: `formatAborted` (from the tidy) and `formatRetryNotice` (in `retry.ts`, so the retry progress line has one home across three loops).
  The private merge-failure helpers also came out with shorter names than the plan sketched (`mergedResult`, `mergeFailureResult`, `unverifiedMergeFailureResult` rather than `verifyMergeState`/`mergedAfterFailureResult`).
- The timeout-accounting test needed care to be non-vacuous.
  A scenario where the retry backoff and the poll interval both push `elapsed` past the bound proves nothing, so the test uses `timeout: 3` with two retries (1 s + 4 s) and asserts the poll sleep of `10000` was never called — which fails if the backoff is not folded into `elapsed`.
- The four pre-existing abort tests passed only because of the bug being fixed: they never aborted their controller and relied on the blanket `catch {}`.
  They were rewritten to abort from inside the mocked `sleep` rejection (via a shared `mockSleepAborts` helper), and each gained a sibling test asserting a real failure now throws.
- `withRetry` is written as a bounded loop of three retries followed by a final unguarded attempt, so the last error propagates unwrapped and there is no unreachable-return branch to satisfy the type checker.
- Scope was trimmed once during implementation: a `promptGuidelines` block was added to the `release_pr_merge` registration and then removed — it was not in the plan, and it would spend system-prompt budget in every session of every consumer for guidance the ship prompts already carry.
- A stray `}` in an `Edit` replacement broke `release-pr-merge.ts`'s parse; `pi-autoformat` reported it immediately with the exact parse error, and the fix was one edit.
- Pre-completion reviewer: PASS, no warnings.
  It independently confirmed the four gates, the doc touch points, the abort-test rewrite pattern, and judged both named deviations improvements over the plan's sketch.

## Stage: Final Retrospective (2026-08-17T23:57:47Z)

### Session summary

All three stages — planning, TDD, and ship — ran in a single session, releasing `@gotgenes/pi-github-tools` v4.3.0 with transient-error retry across every read-only `gh` call and REST verification of a failed merge call.
Six implementation commits (one tidy-first `refactor:`, three `feat:`, one `fix:`, one `docs:`) took the package suite from 112 to 162 tests with no rework and no failed gate.
The ship stage ran on a cheaper model than planning and implementation, and the whole flow — push, CI, close, release-please merge, release-triggered CI — completed without a single retry.

### Observations

#### What went well

- The issue this session fixed was itself filed by the previous session's retro (#732 → #764), and the fix landed against the exact failure mode that retro recorded.
  The loop closed inside two sessions: a live incident produced a diagnosis, the diagnosis produced an issue with a reproduction command, and the issue produced a tool that now performs that command itself.
- Two design inputs were **measured** at planning time rather than reasoned about.
  `gh api 'repos/{owner}/{repo}/pulls/763'` was run to confirm the `{owner}`/`{repo}` placeholders expand locally (removing a `detectRepo()` dependency from the design) and that the payload carries `merge_commit_sha`.
  The backoff curve came from `@octokit/plugin-retry`'s published defaults via `web_search`, not from first principles — the `/plan-issue` ecosystem-check rule (Refs #647) doing exactly what it exists for.
- The `tidy-first-assessor` produced its best result yet.
  It grep-verified a count the dispatch prompt had estimated (15 `"aborted: cancelled by user"` blocks, not the ~13 implied), recommended one extraction, and *declined* a second on the grounds that the abort guard **is** the behavior change rather than preparation for it.
  The rejection was the more valuable half.
- Deliberately **not** reusing the package's existing `findRetryDelay` was the right call and worth recording as a pattern: two functions can both be "backoff" and still have opposite shapes — a polling curve (unbounded attempts, 30 s cap) versus a transient-error curve (3 attempts, fast first retry).
  Collapsing them would have produced the wrong behavior for both.
- The warning-count lint practice (Refs #694) earned its keep.
  After step 3 swapped `ghJson` call sites to `ghJsonRetrying`, the now-unused import was a **warning-level** `noUnusedImports` finding — `lint=0`, so an exit-code check alone would have let it land.
  `grep -c 'lint/'` returned 1 and caught it before the commit.

#### What caused friction (agent side)

- `scope-drift` (self-identified) — a `promptGuidelines` block was added to the `release_pr_merge` registration mid-step-5, then removed on reflection: the plan did not call for it, and it would spend system-prompt budget in every session of every consumer for guidance that is only actionable *after* reading a tool result (which the ship prompts already carry).
  Impact: two extra `Edit` calls, no commit contamination and no rework — caught before the `docs:` commit.
- `other` — the removal edit left a stray `}` in `release-pr-merge.ts`, breaking the file's parse.
  Impact: one extra edit, no rework; `pi-autoformat` reported the exact parse error on the same tool call, so the failure surfaced immediately rather than at the next gate.
- `other` — the plan's `Module-Level Changes` did not anticipate the two shared helpers that the implementation produced (`formatAborted` from the tidy, `formatRetryNotice` for the retry progress line), nor the shorter names the private merge-failure helpers took.
  Impact: none material — the pre-completion reviewer judged both deviations improvements — but it is a reminder that a plan's helper-name sketch is a sketch, and the retro is where the divergence gets recorded rather than argued.

#### What caused friction (user side)

- Nothing to report.
  The operator's three planning answers (retry scope, verified-merged outcome, verified-not-merged outcome) arrived as a single `ask_user` round and were never revisited — every subsequent decision in the session derived from them without a further clarification round.
  The mid-session model switch to a cheaper model for the ship stage was well-placed: the ship stage is deterministic procedure, and it ran 23 tool calls with no errors and no judgment calls beyond reading a release PR body.

### Diagnostic details

- **Model-performance correlation** — planning and TDD ran on `anthropic/claude-opus-5`; the operator switched to `anthropic/claude-sonnet-5` for the ship stage, and back to opus for this retro.
  Both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) ran on `anthropic/claude-sonnet-5` per their frontmatter.
  No mismatch in either direction: sonnet handled the judgment-bearing tidy assessment well (it verified a count by grep and reasoned its way to a rejection), and the deterministic ship stage did not need opus.
- **Escalation-delay tracking** — no `rabbit-hole` friction points.
  The longest same-target sequence was three consecutive `Edit` calls on `release-pr-merge.ts` (add `promptGuidelines` → remove → repair the stray brace), each resolving a different problem.
  Nothing approached the five-call escalation bar.
- **Unused-tool detection** — `colgrep` went unused, correctly: every search in this issue was exact matching on a symbol or a literal string (`ghJson`, `aborted: cancelled by user`, `formatAborted`), which is grep's case per the `colgrep` skill's decision table.
  `web_search` was used where the rule prescribes it — grounding a retry curve in the established library rather than inventing one.
- **Feedback-loop gap analysis** — no gap.
  All four gates ran green at baseline before the first edit; the package suite ran after every Red and every Green; `pnpm run check` ran immediately after each step that touched a shared signature or import; root `pnpm run lint` with the warning count ran before each commit; and the full four-gate sweep plus `pnpm fallow dead-code` ran again before the pre-completion dispatch and before the push.

### Changes made

1. `.pi/skills/code-design/SKILL.md` — extended the `promptGuidelines` paragraph in § Pi SDK boundaries: reserve the block for guidance an agent needs *before* choosing the tool, since it sits in every session's system prompt; post-result guidance belongs in the tool's `description` or result text.
2. `.pi/skills/testing/SKILL.md` — added a bullet to § TDD planning rules → Step sequencing and breakage: when a fix changes how a failure is *classified*, existing tests asserting the old classification can pass only because of the bug, so rewrite each and add a sibling test for the newly distinguished case.

Considered and deliberately not changed: an `AGENTS.md` § Edit tool batches note for the stray-brace typo (already the longest section, and `pi-autoformat` surfaced the parse error on the same tool call), a general polling-vs-transient backoff rule (package-specific; it lives in `.pi/skills/package-pi-github-tools/SKILL.md`), the `/plan-issue` measure-at-planning-time guidance (already prescribed, and it worked as written), and anything about the mid-session model switch (operator practice, not a rule).
