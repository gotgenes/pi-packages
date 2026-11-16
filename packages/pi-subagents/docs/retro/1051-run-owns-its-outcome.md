---
issue: 1051
issue_title: "pi-subagents: let each run own its outcome, so a waiter holds the run it waited on"
---

# Retro: #1051 — pi-subagents: let each run own its outcome, so a waiter holds the run it waited on

## Stage: Planning (2026-10-17T04:18:54Z)

### Session summary

Planned moving one run's outcome (status, result, timestamps, question, notice, turn budget, update ledger, consumption, claims) from `SubagentState` onto `SubagentRun`, with `waitUntilSettled` returning the run it waited on.
The plan is eleven steps: a sweep ride-along, four Tidy-First preparations (initial run from construction, no production status seed, explicit fixture seeds, a temporary superseded-slot scaffold on `Subagent`), five field-move slices, and a docs step.
Operator gate: #1058 stays separate, a replaced run tracks its own fate (`markReplaced`), and the sweep tests use fake timers on the real interval.

### Observations

- `SubagentState` does not dissolve: `test/service/service-adapter.test.ts` passes `new SubagentState({ lifetimeUsage })`, and the issue requires the service tests to pass unedited, so it keeps the cross-run metrics, activity, and `lastProgressAt`.
- The design forced a split of `SubagentRun`'s birth from its start: a queued background agent can be claimed by a `wait: true` before its slot opens, so the initial run must exist from `Subagent` construction.
  This is also what [#1013]'s queued resume needs.
- The waiter now marks the waited run consumed even when a resume replaced it (today it releases and marks nothing); argued unobservable because every reader reads the current run.
- `workspaceNotice` and `stoppedWhileQueued` were never cleared by `resetForResume`; per-run they start empty, argued unobservable because a record holding either refuses every resume.
- The Tidy-First assessor found that transitions must target the run they receive: an aborted run whose turn loop is still unwinding when a resume starts would otherwise write its late completion onto the resume.
  Reachability through a front door was not verified; step 7 says to retype it `fix:` if the implementing session finds it reachable.
- The assessor also caught that both test fixtures forward seeds through a rest spread, so a key leaving `SubagentStateInit` would drop silently at runtime; step 4 partitions them first.
- Spike (deleted): fake `setInterval` plus the existing `Date.now` spy drove the real sweep, and a `process.getActiveResourcesInfo()` timer count replaced `hasRef()`; deleting `unref()` turned it red.
  Changing the interval to 120 s did not kill the sweep test (two 60 s advances reach it), so the plan's sweep mutation empties the callback instead.
- Foreground carriers (`foreground-runner.ts`, the foreground resume) still mark `record.markConsumed()` after awaiting; same trigger class as [#1015], unreachable in-repo, recorded as a Non-Goal with no issue filed.
- Measured baselines: `_superseded` 3, `resetForResume` 8, `as any` in `subagent-manager.test.ts` 8, `lifecycle/subagent.ts` 846 lines, `fallow dupes` one 21-line group (`subagent-state.ts` with `make-subagent.ts`), dead code 0.

#### Deferred tidyings

- `packages/pi-subagents/test/lifecycle/subagent.test.ts`: migrating `makeSubagent` (70 sites) onto `createTestSubagent` declined; the defaults differ (queued versus completed).
- `packages/pi-subagents/src/lifecycle/subagent.ts`: the ~15 one-line read-through getters stay; a generic delegating proxy was judged a wrong-abstraction risk.

## Stage: Implementation — TDD (2026-10-17T09:00:21Z)

### Session summary

All eleven plan steps landed as eleven commits: the sweep ride-along, four preparatory steps (initial run from construction, no production status seed, explicit fixture seeds, the replaced-run scaffold), five field-move slices, and the docs.
Two commits followed: a dead-code cleanup, and a docs fix after the reviewer's WARN.
The `pi-subagents` suite went from 2163 to 2155 tests (state-test blocks deleted with their mechanism, run and `Subagent` tests added); every metric row reads its target (`_superseded` 0, `resetForResume` 0, `as any` 0, `lifecycle/subagent.ts` 827 lines, no clone group in the workspace, health 88 A).

### Observations

- Deviation: step 7 is typed `fix:`, as plan step 7 allowed, so this issue now cuts a `pi-subagents` patch release.
  It is not `refactor:` only, as the plan's Release Recommendation rationale says.
  The reviewer showed the late-completion window is reachable: `abort()` marks the run `stopped` synchronously while the turn loop unwinds, and `resumeRefusal` accepts a stopped record, so `SubagentsService.abort` then `resume` hit it.
  The commit was reworded with a scripted rebase, and the tree diff against a backup tag was empty.
- Deviation: an extra commit ("drop the Subagent `markAborted` and `markError` passthroughs") cleared a `fallow dead-code` finding that step 7 created, once `complete()`/`fail()` began transitioning their own run.
- Deviation: `ResumeCallOptions` became a type alias of `ResumeRunOptions` (which gained `claimOutcome`) rather than an empty extending interface.
- Deviation: `SubagentState.resetForResume` lost its `startedAt` parameter in step 7 (progress moved to `startRun`) before step 9 deleted it.
- Mutation finding (step 6): the plan predicted the [#987] announcement tests would kill "seed the resume run with the previous `consumedAt`"; they never mark consumption, so only the new `Subagent`-level "starts unconsumed after the parent collected the run before it" test pins it.
  The "claim the new run whenever the previous run is claimed" mutation killed the [#987] tests instead of the predicted "leaves the outcome unclaimed by default".
- Mutation finding (step 1): an interval changed to 120 s survives the sweep tests (two 60 s advances reach it), as the planning spike found; the empty-callback mutation killed exactly the three predicted tests.
- The old "keeps only the most recently superseded run" behavior became "reports the waited run's outcome even when two resumes replaced it" in step 10: the issue's one-slot limit is gone, which the step 10 commit body records.
- The record-observer test that the observer leaves the turn budget alone was deleted in step 8: the observer holds only `SubagentState`, so the type now pins it.
- Seeds partitioned by owner (step 4) paid off as planned: each later slice's moved key surfaced as a `tsc` excess-property error in the fixtures.
- Pre-completion reviewer: round 1 WARN (the `refactor:` typing of a reachable fix; an unscoped "no clone group" claim), both resolved; round 2 PASS.
  Round 2's full `pnpm run test` saw 10 `pi-permission-system` timeouts under load that passed when re-run alone.

[#987]: https://github.com/gotgenes/pi-packages/issues/987
[#1013]: https://github.com/gotgenes/pi-packages/issues/1013
[#1015]: https://github.com/gotgenes/pi-packages/issues/1015

## Stage: Sync (worktree) (2026-10-17T15:54:06Z)

### Session summary

`pnpm run lint` and `pnpm fallow dead-code` both passed on the branch before the rebase, and the TDD stage's reviewer verdict (round 2 PASS) has no open WARN.
The plan's `**Release:**` marker reads `ship independently` and its rationale calls the issue refactor-only, but the step 7 commit ("keep a stopped run's late result off the resume that replaced it") landed as `fix:`, so `/ship` should expect a `pi-subagents` patch release rather than none.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-1051--/2026-10-17T03-33-11-157Z_01a147eb-b174-745e-9146-a63537fd3197.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

- Follow-up for the root: [#1058] (withheld notifications crossing a resume) is untouched by this change and still reproduces; it is the natural next `fix:` on top of the per-run object.
- No deferred work beyond the two deferred tidyings in the Planning stage note.

[#1058]: https://github.com/gotgenes/pi-packages/issues/1058

## Stage: Final Retrospective (2026-10-17T16:09:51Z)

### Session summary

The worktree lane landed all 17 branch commits by fast-forward, CI passed on `d26b7117`, and `pi-subagents` released as 24.0.1 (a patch, carried by the step 7 `fix:`).
The issue closed with a comment anchored on the waiter commit; no co-shipped issue or third-party PR was in range, and the worktree was torn down.
Across the four stages the plan executed as written, except for one condition the plan left open and the reviewer discharged.

### Observations

#### What went well

- The Tidy-First assessor's fixture-seed partition (step 4) turned every later field move into a `tsc` excess-property error in the fixtures, so no seed was dropped silently by the rest spread it replaced.
  This is the first time a preparatory step in this package paid off as a type-level tripwire across five slices.
- Each test-adding step named the mutation that must kill it, and the TDD stage recorded the two predictions that missed (the [#987] tests on consumption) instead of quietly accepting a different kill.
- The Sync stage caught that the plan's `**Release:**` rationale ("refactor-only") no longer held and told `/ship` to expect a patch; `/ship` then confirmed it with `next-version.sh` rather than with the plan's prose.

#### What caused friction (agent side)

- `missing-context` — Planning surfaced a latent defect (the assessor's "an aborted run's late completion lands on the resume") and wrote step 7 as conditional: "retype it `fix:` if the implementing session finds it reachable".
  Neither the planner nor the implementer traced the trigger; the step 7 commit body said reachability "was not verified".
  The pre-completion reviewer traced it in a few reads (`abort()` marks `stopped` synchronously, `resumeRefusal` admits a stopped record, so `SubagentsService.abort` then `resume` hits it).
  Impact: one WARN round, a scripted-rebase reword behind a backup tag, a docs fix commit (`docs(pi-subagents): name the fallow scope and the fix in #1051's landed note`), and a second reviewer round.
- `instruction-violation` (self-identified, in this retro) — `/ship`'s close comment cited five SHAs, but the ancestor check ran on four of them, and ran before drafting rather than on the draft.
  The prompt names exactly this failure ("Verify the draft, not your intent to cite").
  Impact: none; the missed SHA (`fed1e02d`) was pasted from command output and resolves on `main`, and `issue_close` validated resolution.

#### What caused friction (user side)

- The planning gate offered three decisions, all answered with the recommended option; the step 7 reachability was presented as a plan-time unknown rather than a fourth decision.
  An operator question there ("is it reachable now?") would have moved the trace to planning, where it cost the least.

### Diagnostic details

- **Model-performance correlation** — Planning and TDD ran on `claude-opus-5-5` (high thinking); the mechanical Sync stage switched to `claude-sonnet-5-5`, an appropriate downshift.
  All three subagents (`tidy-first-assessor`, two `pre-completion-reviewer` rounds) ran on `claude-sonnet-5-5`, read from their transcripts; the reviewer found the reachable defect the Opus stages left open, so no mismatch.
- **Feedback-loop gap analysis** — no gap: TDD ran `check` and the package suite after every step and a targeted mutation before each commit.
  The reviewer's first `pnpm run lint` timed out at 900 s and passed on re-run, alongside 10 load-induced `pi-permission-system` timeouts in the full suite; both point at a loaded machine, not this change.

### Changes made

1. `.pi/skills/tidy-first/SKILL.md` (Step 3, "Triage into the plan"): a finding that the change alters observable behavior is a latent defect; trace its trigger before writing the plan and type the step on the result, never leaving the commit type conditional on the implementing session.
