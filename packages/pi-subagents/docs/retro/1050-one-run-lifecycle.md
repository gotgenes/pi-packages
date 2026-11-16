---
issue: 1050
issue_title: "pi-subagents: run initial and resumed runs through one lifecycle"
---

# Retro: #1050 — pi-subagents: run initial and resumed runs through one lifecycle

## Stage: Planning (2026-10-16T04:39:30Z)

### Session summary

Planned Phase 23's Track A step 3: one turn loop, one run body, private terminal transitions, and a kind-carrying observer pair at both observer layers, plus the roadmap's ride-alongs.
The plan is `packages/pi-subagents/docs/plans/1050-one-run-lifecycle.md`, with 14 steps: eight preparatory `test:`/`refactor:` steps, one `fix:`, four `refactor:` steps, a grid re-nest, and the doc step.
It ships independently.
The baseline suite was 2116 tests in 86 files, all green at `12e693a6`.

### Observations

- The hold rule went the opposite way from the issue's expectation.
  The issue expected both kinds to follow the initial run's rule, which disposes a wrapped-up run that has a question.
  That rule lives only in [#1021]'s plan and one test, and that plan left it as an open question.
  `docs/configuration.md`, `README.md`, and `pi-subagents-worktrees/README.md` all describe hold.
  The operator chose hold for both kinds, so the `fix:` changes the initial run, and the resume twin is a pin that passes before the fix.
- Operator decisions at the gate (all three were the recommended options):
  - Hold the workspace for both kinds.
  - Collapse `SubagentManagerObserver` to `onSubagentRunStarted`/`onSubagentRunFinished(record, kind)`, so the events observer maps channels in one place.
  - The session owns its first run, and turn limits are resolved at creation through a pure `resolveTurnLimits`.
    The rejected alternative was a kind-discriminated `runTurnLoop` options union.
- Measured baselines differ from the roadmap's:
  - `mock.calls[` lines in `subagent.test.ts` are 16 (the roadmap says 19, from before [#1049]).
  - Top-level `describe` blocks number 37 (the roadmap says 36).
  - `fallow dupes` reports no clone between `src/` files; the remaining group is `subagent-state.ts` against a test helper.
- The Tidy-First assessor found traps the design summary missed.
  Each is now a plan step or guard:
  - Tests that resume from a finish observer would recurse once finishes carry both kinds.
  - Resume-only manager observers would double-count.
  - Resume stubs set before the initial spawn would be consumed by the initial run (step 8 stages them).
  - `resumeTurnLoop` tests on a never-run session would become first-run tests (step 7 primes them).
  - `buildObserver` wraps every callback except `onStarted` in `try`.
    The plan wraps both and pins the change with a test; production cannot observe it, because the composite already isolates each delegate.
- The resume prefix must stay synchronous up to the turn loop's first await (`startResume`'s claim).
  Step 11 adds an explicit pin for it.
- Sibling issue [#1058] (third-party, withheld notifications crossing a resume) touches `notification.ts`, which this plan does not change.
  It is left to [#1051]'s territory, and no disposition was recorded here.
- No follow-up issues filed.

#### Deferred tidyings

- `packages/pi-subagents/src/settings.ts`: `DEFAULT_WRAP_UP_TURNS` duplicates the constant step 9 moves into `turn-limits.ts`.
  Deduplicating it touches a file the change does not.
- `packages/pi-subagents/test/lifecycle/subagent-run.test.ts`: a `makeRun` helper for the 13 constructor sites was rated optional and not folded in.
- `packages/pi-subagents/test/lifecycle/subagent-manager.test.ts`: a `byRunKind` observer helper ahead of step 12's rename was rated marginal and not folded in.

[#1021]: https://github.com/gotgenes/pi-packages/issues/1021

## Stage: Implementation — TDD (2026-10-16T05:22:41Z)

### Session summary

All 14 plan steps landed as 14 commits, plus one review follow-up (`test(pi-subagents): stop naming the removed terminal methods in test comments`).
The pi-subagents suite went from 2116 to 2142 tests in 86 files (the plan estimated about 2125); the run-kind grid and the new turn-limit, later-run, and observer tests account for the rest.
Pre-completion reviewer: WARN on the first round (two stale test comments, fixed), WARN on the delta (only the accepted missing `(#1050)` suffix on the `fix:` subject, whose body carries `Refs #1050`).

### Observations

- Every killing mutation killed its predicted class, with three refinements:
  - Step 8's "call `runTurnLoop` instead of `resumeTurnLoop`" killed 30 tests, not every staged one: the staged tests that assert no resume text (`returns the resumed record`, `leaves the outcome unclaimed by default`, the `onSubagentResumed` spies) stay green under it, which is correct, since they do not depend on which stub the resume reads.
  - Step 9's precedence swap killed only the first precedence case, as expected for an `??` reorder.
  - Step 2's `askParent: undefined` left the "drops a recorded question when the run fails" tests green (an unasked question is also undefined); step 1's mutation of `clearPendingQuestion` is what pins them.
- Deviation: step 9 missed two `subagent-manager.test.ts` tests that read `runTurnLoop.mock.calls[0][1]` for `defaultMaxTurns`/`wrapUpTurns`; the full-suite run caught one, and both moved to asserting the factory's `turnLimits` in the same commit.
- Deviation: step 11 kept `run()`'s call to `onSessionCreated` before the record observer attaches (it was after); the one consumer, `foreground-runner.ts`, only stores the record, and nothing awaits between them.
- Deviation: step 13 also replaced step 1's `runToTerminal` helper with `runToOutcome` (which gained an `error` option and a shared `outcomeLoop`), so the grid's run-kind drivers and the terminal tests share one arrange.
  The re-nest moved 38 top-level blocks under one root (21 record-level, 9 initial-run, 7 resume, 1 grid) with the test count unchanged at 193; it orphaned three section-header comments and the provider-failure comment, cleaned up in that commit and the review follow-up.
- Step 6's fold hit a self-inflicted `TS2456` (the scripted rename rewrote the `TestSession` alias into itself); fixed before the commit.
- The plan's step-12 rename count held: 107 references across five test files, with resume-only and resume-from-finish manager observers guarded on the kind.
- Measured at the end: run-kind row 0, payload row 1, `subagent.test.ts` `mock.calls[` 1, top-level `describe(` 1, `lifecycle/subagent.ts` 826 lines (from 850), `resetForResume` 8 (unchanged, [#1051]'s), and `fallow dupes` reports only the `subagent-state.ts`/test-helper group.
- Reviewer warnings: two stale test comments naming `completeRun`/`failRun` (fixed); the `fix:` subject without `(#1050)` (accepted).

[#1049]: https://github.com/gotgenes/pi-packages/issues/1049

## Stage: Sync (worktree) (2026-10-16T05:38:52Z)

### Session summary

`pnpm run lint` and `pnpm fallow dead-code` both pass on the branch, ahead of the rebase onto local `main`.
The plan's `**Release:**` marker is `ship independently`, and the branch carries one `fix:` commit, so `/ship` should cut a patch release for `@gotgenes/pi-subagents`; no follow-up issues were filed.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-1050--/2026-10-16T03-52-29-402Z_01a142d7-01d9-76e2-982d-f549a2c54f4e.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

- The reviewer's only open finding is the accepted missing `(#1050)` suffix on the `fix:` subject (its body carries `Refs #1050`), so nothing was left open at sync.
- Local `main` had moved by 18 commits, all in `pi-permission-system`; the rebase touches no pi-subagents path.

[#1051]: https://github.com/gotgenes/pi-packages/issues/1051
[#1058]: https://github.com/gotgenes/pi-packages/issues/1058

## Stage: Final Retrospective (2026-10-16T05:48:25Z)

### Session summary

The peer worktree planned and implemented Phase 23's Track A step 3 in one session (14 plan steps, 16 commits), and the root shipped it in the worktree lane: the branch fast-forward-merged, CI passed on `3c9c7529`, the issue closed, and `pi-subagents-v23.4.2` released.
The one behavior change is the hold rule: a wrapped-up initial run that asked a question now keeps its workspace, as a resume already did.
The phase is not finished; [#1012], [#1051], [#1013], and [#1017] remain open.

### Observations

#### What went well

- The planning gate reversed the issue's own premise on evidence.
  The issue expected both run kinds to follow the initial run's teardown rule; the session traced that rule to an open question in [#1021]'s plan and one test, set it against three user-facing docs that describe hold, and put both readings to the operator.
  The resulting `fix:` changed the side the docs did not describe, so no doc changed.
- The `tidy-first-assessor` (on `claude-sonnet-5-5`) found five traps the design summary missed: recursion from a resume inside a finish observer, double-counting resume-only observers, resume stubs consumed by the initial run, `resumeTurnLoop` tests on a never-run session, and the unwrapped `onStarted`.
  Each became a plan step or guard, and the TDD stage hit none of them as rework.
- Every step ran a killing mutation with a predicted kill class, and the three mismatches were explained rather than waved through (the TDD stage lists them).
- The worktree lane landed with no friction: `main` had moved 18 commits under the branch, the peer's sync rebase absorbed them, and the ff-merge prediction, merge, gates, CI, close, and release each passed on the first attempt.

#### What caused friction (agent side)

- `instruction-violation` (self-identified) — TDD step 2 sent a `Read` of `test/lifecycle/subagent.test.ts` in the same batch as a multi-entry `Edit` of that file, and the read saw the file mid-write (`Offset 764 is beyond end of file (1 lines total)`).
  `.pi/prompts/tdd-plan.md` forbids batching an edit with a call that reads the same file.
  The same batching broke both stage-note commits: each `Write`/`Edit` of the retro file was batched with `rumdl check`, which failed on two-sentence lines and a missing blank line that `pi-autoformat` had not yet reflowed.
  That half is not a race: `pi-autoformat` formats at `turn_end` (`packages/pi-autoformat/src/extension.ts`, and its README), after every call in the batch, so a same-batch check always sees the unformatted file.
  The `/tdd-plan` rule's stated reason (calls "run concurrently with the edit and its `pi-autoformat` pass") is right about the edit and wrong about the format pass.
  A scan of the peer transcript found 21 batches that paired an `Edit`/`Write` with a call naming the same file, out of 29 batches holding a mutation (a filename-match heuristic), so the rule is routinely broken and fails visibly only now and then.
  Recorded recurrences before this one are [#999], [#1032], and [#1035], all `cp` backups that captured a mutation.
  Impact: four extra calls across the three visible failures; no rework.
  The silent form is the larger risk: a call batched with its edit can capture the pre-edit or pre-format file, as the `cp` cases did, and nothing reports it.
- `instruction-violation` (self-identified, deny rule) — planning ran `cd packages/pi-subagents`, and TDD step 3 ran `git commit -F -` with a heredoc body.
  `pi-permission-system` denied both, and each reason named the fix.
  Impact: one call each; the deny rules worked as designed.
- `other` — step 6's scripted rename rewrote the `TestSession` alias into itself (`TS2456`).
  Impact: caught by `pnpm run check` before the commit; two calls.
- `missing-context` — step 9 missed two `subagent-manager.test.ts` tests that read the turn limits from `runTurnLoop.mock.calls`.
  Impact: the full-suite run caught one, and both moved to the factory's `turnLimits` in the same commit.
- `other` — the sync stage (on `claude-sonnet-5-5`) wrote a literal `\u2014` escape into the stage note's `Edit` body; it grepped for the escape, substituted the character with a script, and confirmed the bytes with `xxd`.
  Impact: three calls; `markdown-conventions` already covers this, and the lint gate would have caught it.
- `instruction-violation` (self-identified) — `/ship` read the `worktrees` skill through `cat … | head -80` instead of `Read`, truncating it.
  Impact: none observed, since the truncated part held only guardrails the ship did not reach.
- `other` — `/ship`'s final report said "I didn't check" whether this issue closed the phase, rather than running the two commands that answer it.
  Impact: the check moved to this retro; no wrong recommendation went out.

#### What caused friction (user side)

- The issue body stated the initial run's teardown rule as the target without naming its source.
  The planning session spent about ten calls tracing it to [#1021]'s open question.
  An issue that cites where a stated rule comes from would let a gate open on the conflict directly.
- All three gate decisions took the recommended option, and the operator's involvement was strategic throughout, with no corrections.

### Diagnostic details

- **Model-performance correlation** — planning and TDD ran on `claude-opus-5-5` (thinking `high`): design judgment and a 14-step refactor, an appropriate match.
  Sync ran on `claude-sonnet-5-5`: mechanical gates, a rebase, and a stage note, also appropriate; its one slip (the literal escape) is a known emission defect, not a reasoning gap.
  The `tidy-first-assessor` and both `pre-completion-reviewer` rounds ran on `claude-sonnet-5-5` (from their own transcripts); the assessor's findings were the session's most valuable judgment input, so a sonnet model was not a limitation here.
  Ship and this retro ran on `claude-opus-5-5`.
- **Feedback-loop gap analysis** — no gap.
  Each TDD step ran the targeted `vitest` file and `pnpm --filter … run check` before committing, and the full suite at the steps that crossed files; the one miss (step 9) was caught by that full-suite run.

### Changes made

1. `AGENTS.md` (`### Tool-injected messages`): added the batching rule with its verified mechanism; `pi-autoformat` formats at `turn_end`, after the batch, and only the edit itself runs concurrently with the batch's other calls.
2. `.pi/prompts/tdd-plan.md`: removed the batching rule, whose stated reason named the format pass as concurrent; `AGENTS.md` now carries it for every workflow.

[#999]: https://github.com/gotgenes/pi-packages/issues/999
[#1012]: https://github.com/gotgenes/pi-packages/issues/1012
[#1013]: https://github.com/gotgenes/pi-packages/issues/1013
[#1017]: https://github.com/gotgenes/pi-packages/issues/1017
[#1032]: https://github.com/gotgenes/pi-packages/issues/1032
[#1035]: https://github.com/gotgenes/pi-packages/issues/1035
