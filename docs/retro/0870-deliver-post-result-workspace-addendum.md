---
issue: 870
issue_title: "pi-subagents: a workspace addendum produced after the result edge is dropped"
---

# Retro: #870 — pi-subagents: a workspace addendum produced after the result edge is dropped

## Stage: Planning (2026-09-04T23:40:58Z)

### Session summary

Enumerated the five edges that drop a `resultAddendum`, gated the direction and three follow-on design forks with the operator, and committed `docs/plans/0870-deliver-post-result-workspace-addendum.md` (8 TDD steps).
The plan is cross-package: it adds source to both `pi-subagents` and `pi-subagents-worktrees`, so it lives in the repo-root `docs/plans/` rather than the package directory the sibling plan `0857` used.
Filed [#878] for a verified pre-existing defect found while reading the carriers, and recorded it as Phase 22 Step 15 by operator decision.

### Observations

The issue body's framing was one release stale: it describes the child ending its run with a `<question-for-parent>` block, but [#858] shipped between filing and planning and replaced the marker with the `ask_parent` tool.
The mechanism the issue reports is unaffected; only the vocabulary moved.

Two facts found by reading rather than by taking the issue's framing changed the plan's shape.

1. **The retention sweep is not the realistic drop edge.**
   A held workspace implies `pendingQuestion !== undefined`, and `resolveRetentionWindow` takes the short 10-minute branch only when that field is `undefined`.
   So a held workspace waits the 720-minute window, and the drop really happens at a session switch or at quit.
2. **`SessionLifecycleHandler` disposes notifications at shutdown step 3, before `manager.dispose()` at step 5.**
   That kills the roadmap's own first candidate: a completion nudge structurally cannot reach the edge that matters.
   Naming this before the gate is what turned a three-candidate menu into a coverage table, and it is why the plan has a durable half at all.

The operator also widened scope to all five edges: `failRun` has discarded the addendum since Phase 17's `WorkspaceBracket` extraction (`1e16137e`), so a worktree-backed child that errors mid-run has always committed to `pi-agent-<id>` with nobody told.
That half is the cheapest to fix — the record survives and the nudge fires after the dispose.

#### A gate I got wrong and had to re-run

The delivery-mode gate offered `deliverAs: "nextTurn", triggerTurn: false` described as "shown to the user immediately and read by the parent at its next turn".
Reading `sendCustomMessage` in the pinned `@earendil-works/pi-coding-agent@0.84.4` (`dist/core/agent-session.js:1099`) showed `nextTurn` is checked first and unconditionally, and only buffers: no `_appendCustomMessage`, so nothing is rendered, nothing is written to the session, and the buffer is discarded on quit.
The option I meant to offer — `triggerTurn: false` with **no** `deliverAs` — was not in the set at all.
I corrected the record and re-gated; the operator picked the corrected option.

The lesson is the `AGENTS.md` one, applied to a gate rather than a plan: an option's differentiator was a behavior claim, and I wrote it from the option name rather than from the compiled SDK.
The `.d.ts` carries only `deliverAs?: "steer" | "followUp" | "nextTurn"` — the semantics live in the `.js`, exactly where the rule says to look.
The re-read also removed work: the `nextTurn`/`followUp` hazard is what would have required a parent-run withhold, a third `PendingAnnouncement` variant, and the assessor's exhaustive-switch refactor.
All three dropped out.

#### The assessor caught a silent no-op in the design

`CompositeSubagentObserver` implements `SubagentManagerObserver` by explicitly enumerating every method, and `index.ts` wires it as the manager's observer.
My design added `onSubagentWorkspaceNotice` as an *optional* member, mirroring `onSubagentUpdate` — which the composite would have dropped with no compiler error, no test failure, and no runtime error.
The feature would have no-opped in production while every unit test passed.
The plan declares the member **required** on the composite so the manager-to-composite hop is compile-checked, and step 5's killing mutation is deleting that method.

This is the case for dispatching the assessor over the real files even when the design feels settled: the finding was a correction to the design, not a tidying, and it arrived while the design was still cheap to change.

#### Deferred tidyings

- `packages/pi-subagents-worktrees/src/preserved.ts` and the new `src/rescue-branches.ts` — the assessor offered extracting the shared "cap a list at N with an '…and N more' tail" helper the two notice formatters will both spell.
  Declined at two instances and roughly five lines; worth revisiting if a third notice formatter appears.
- `packages/pi-subagents/src/lifecycle/subagent-manager.ts` — a generic relay-dispatch helper for `buildObserver()`'s pass-throughs was considered and rejected by the assessor: the six cases differ in whether they wrap the call in `try`/`catch`, so a shared helper would have to parameterize exactly that difference.

#### Rejected preparatory step

The assessor's first Recommended commit — converting `NotificationManager.onParentAgentSettled()`'s binary `if/else` flush to an exhaustive switch — rests on the premise that the notice joins the withheld queue as a third `PendingAnnouncement` variant.
The corrected delivery mode means it does not, so the refactor prepares nothing this change needs.
Recorded here rather than silently dropped: if a future announcement *does* need the withhold, the gap the assessor identified is real.

#### Verification notes for the implementing session

- Baseline measured at planning time: `pi-subagents` 1514 tests / 76 files; `pi-subagents-worktrees` 62 tests / 7 files.
- `git branch --list 'pi-agent-*' --no-merged HEAD --format='%(refname:short)'` was run against this repo: exit 0, one process, empty output.
  Build the glob from the existing `AGENT_WORKTREE_PREFIX` constant, not a second literal.
- The existing test "disposes with status error when the turn loop throws" uses a `resultAddendum: "\nshould be discarded"` fixture.
  It stays green after the change — the notice lands on `workspaceNotice`, not `result` — but the fixture string becomes false, so step 2 renames it.

[#858]: https://github.com/gotgenes/pi-packages/issues/858
[#878]: https://github.com/gotgenes/pi-packages/issues/878

## Stage: Implementation — TDD (2026-09-05T03:59:13Z)

### Session summary

Executed all eight plan steps in order, each as its own commit: one `test:` preparatory step, two `refactor:`, three `fix:`, two `docs:`.
`pi-subagents` went 1514 → 1561 tests across 76 files; `pi-subagents-worktrees` went 62 → 74 across 7 → 8 files.
Pre-completion reviewer: PASS.

### Observations

#### Deviations from the plan

- **`workspaceNotice` lives on `SubagentState`, not as a private field on `Subagent`.**
  The plan's Design Overview sketched the private field; that shape is unseedable from `createTestSubagent`, and three of the five carrier test sites need a record with a notice.
  Moving it beside `pendingQuestion` — which `SubagentStateInit` already seeds and which the class documents as "an outcome fact, like result" — made the seeding fall out of the existing mechanism instead of a test-only setter.
  Landed by amending step 2 rather than as a separate commit, since it is the same logical change corrected.
  The reviewer independently judged it the better owner.
- **`foreground-runner.ts`'s error branch also carries the notice**, which the plan's "one term added to each existing concatenation" did not cover.
  That branch returns early with no outcome body, and it is the *only* carrier a failed foreground child has: `spawnAndWait` calls `record.claim()` before awaiting, which suppresses the nudge for the run's whole lifetime.
- **The git-level tests for `listUnmergedRescueBranches` live in `rescue-branches.test.ts`**, driven through `findUnmergedRescueBranches`, rather than in `worktree.test.ts`.
  The reviewer found this matches the package's own precedent: `listWorktreePaths` is likewise tested only through `findPreservedWorktrees`.
- **The Tidy-First assessment's first Recommended commit was not executed.**
  Its premise — that the notice joins the withheld queue as a third `PendingAnnouncement` variant — stopped holding once the delivery mode was corrected at planning time.
  Recorded in the plan as a rejected preparatory step and re-confirmed against the code here.

#### A vacuous test caught during Red

The ordering test in `get-result-report.test.ts` ("reports where the work went before telling the parent how to answer") **passed** during step 3's Red.
`indexOf` returns `-1` for an absent needle, and `-1` is less than any real index, so the assertion held while the feature did not exist.
Fixed before Green by asserting both substrings are present first.
This is the case the `testing` skill names — a new test that stays green during Red is either an invariant pin or a broken probe — and it was the latter.

#### Mutation findings

The plan's step-4 prediction was wrong in one direction.
It claimed that changing the send options to `{ deliverAs: "followUp", triggerTurn: true }` would redden both the options test and the parent-run delivery test; only the options test went red.
The surviving test pins "the manager does not withhold", which that mutation does not change — the plan conflated two claims into one prediction.
The reviewer re-derived the mutation and judged the survivor a legitimate pin rather than a vacuous one.

Two mutations were also run in one pass by accident: `perl -pi -e 's/^    if \(this\.disposed\) return;\n//'` matched the whole line rather than being the no-op it looked like, deleting every 4-space-indented copy of that guard.
The unexpected reds were the tell.
Subsequent mutations were applied with a Python `str.replace` guarded by an `assert count == 1`, which fails loudly when the anchor does not match.

#### The composite-observer gap, confirmed

The Tidy-First assessment's headline finding held exactly as reported.
Deleting `CompositeSubagentObserver.onSubagentWorkspaceNotice` leaves production code compiling — the interface member is optional — and the two composite fan-out tests are the only thing that fails.
`tsc` does report errors under that mutation, but only because the *test* file calls the method; without the test there is no compile-time pin at all.

#### Reviewer warnings

- `SubagentState.resetForResume` clears `_pendingQuestion` but not `_workspaceNotice`.
  The reviewer traced every path and found it unreachable today: a notice implies `workspaceDisposed`, and `AgentTool` refuses any resume in that state.
  The safety is structural but lives in a different module from the state, and nothing pins "a notice never survives into a resume" directly.
  Not filed — recorded here for whoever next touches either gate.
- `.pi/skills/package-pi-subagents/SKILL.md`'s Observation-domain row does not mention the new announcement.
  Pre-existing and deliberate: the row already omits [#858]'s mid-run updates, so it is incomplete rather than made false, and the plan recorded the no-edit decision.

## Stage: Sync (worktree) (2026-09-05T05:01:15Z)

### Session summary

Pre-push checks both passed clean on first run: `pnpm run lint` (0 findings, 1116 files) and `pnpm fallow dead-code` (0 issues, 329 entry points).
No fixes needed before rebase.
The plan's `**Release:** ship independently` marker stands — no batch to coordinate, and the dispatch at ship time should name both `pi-subagents` and `pi-subagents-worktrees` (the latter for its `fix:` and `docs:` commits: `fix(pi-subagents-worktrees): warn about unmerged rescue branches at session start` and `docs(pi-subagents-worktrees): document the unmerged-branch warning`).

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-870--/2026-09-04T19-11-10-073Z_01a06dd4-fcf8-7597-aab2-150693ad6260.jsonl` — read with `read_session_file({ path: "..." })` for message-level verification at land/retro time.

### Observations

Nothing further to hand off beyond what the TDD stage already recorded: [#878] is filed and dispositioned as Phase 22 Step 15, and no other deferred work surfaced during sync.
Both packages' commits in this range are releasable together in one dispatch.

The rebase onto `main` conflicted once, in `packages/pi-subagents/docs/architecture/architecture.md`, on the `docs(pi-subagents): disposition #878 against Phase 22` commit.
Two sibling dispositions ([#872], [#876]) landed on `main` while this branch was open.
The sweep list itself auto-merged; only the link-reference definitions collided, where both sides appended a line at the same position.
Resolved by keeping both in numeric order, and verified by diffing the rebased file against `main` — the only removed lines are the five module-tree entries and three Step 12 lines this branch rewrites on purpose, so nothing from the concurrent commits was dropped.

Every gate was re-run after the rebase rather than trusting the pre-rebase run, since `main` brought a large `pi-permission-system` directory refactor and a new `ci: flag alias imports` check: `pnpm install --frozen-lockfile`, `pnpm run lint`, `pnpm run check`, `pnpm run test`, and `pnpm fallow dead-code` all pass, with `pi-subagents` at 1561/76 and `pi-subagents-worktrees` at 74/8.

## Stage: Ship (worktree) (2026-09-05T05:20:00Z)

### Session summary

Fast-forwarded the peer branch onto `main` (13 commits, `c90228c1..61f94664`), pushed, verified CI green, closed [#870], and released both packages in one dispatch: `pi-subagents` v21.4.1 and `pi-subagents-worktrees` v0.3.3.
Worktree and branch torn down cleanly.
Every step of the ship flow ran first-try — no rejected merge, no CI retry, no release refusal.

### Observations

The ff-merge prediction (`git merge-base --is-ancestor main <branch>`) and the zero-count unpushed check both passed, so the peer's rebase target was still current at land time.
Nothing landed on `main` between the peer's `/sync-worktree` and this session.

## Stage: Final Retrospective (2026-09-05T05:24:01Z)

### Session summary

Issue [#870] ran the full four-stage worktree lifecycle — planning, TDD, sync, ship — across two sessions and shipped as Phase 22 Step 12, closing a five-edge delivery gap with three complementary channels.
The technical execution was strong: every plan step landed as its own commit, every killing mutation was applied and counted against its prediction, and the pre-completion reviewer returned PASS.
The friction that remains is concentrated in two places — a gate whose option semantics were written from a name rather than the source, and a conflict report that inferred its cause instead of reading it.

### Observations

#### What went well

- **The Tidy-First assessor earned its dispatch by contradicting the design, not by tidying.**
  It found that `CompositeSubagentObserver` enumerates every observer method explicitly, so the design's *optional* `onSubagentWorkspaceNotice` would have been dropped with no compiler error, no test failure, and no runtime error — the feature would have no-opped in production with a fully green suite.
  The TDD stage then confirmed this exactly: deleting the composite's method leaves production code compiling, with the two fan-out tests the only pin.
  This is the strongest case yet for the skill's claim that planning is the right dispatch point — the finding was a correction to the design while the design was still cheap to change.
- **A vacuous test was caught by the Red step's own evidence.**
  The ordering assertion in `get-result-report.test.ts` passed during Red because `indexOf` returns `-1` for an absent needle, and `-1` sorts below any real index.
  Fixed before Green by asserting presence first.
  The `testing` skill names this exact case, and the discipline of actually reading the Red output — rather than assuming a new test fails — is what surfaced it.
- **The ship stage refused a stale SHA it was handed.**
  The sync note named two commits by pre-rebase SHA; both are unreachable from `main`.
  Deriving the close comment from the commit range rather than from the note's text kept two dangling hashes out of a published GitHub comment.
  The `AGENTS.md` rule (Refs #814) worked as written.

#### What caused friction (agent side)

- `missing-context` — **the delivery-mode gate described `deliverAs: "nextTurn"` from the option name rather than from the SDK.**
  The option was offered as "shown to the user immediately and read by the parent at its next turn"; reading `sendCustomMessage` in the pinned `@earendil-works/pi-coding-agent@0.84.4` showed `nextTurn` is checked first and unconditionally and only buffers — nothing rendered, nothing written to the session, discarded on quit.
  The option actually intended (`triggerTurn: false` with no `deliverAs`) was not in the set at all.
  Self-identified, before the plan was written.
  Impact: one `ask_user` gate re-run and a corrected record; the operator answered the same decision twice.
  Notably the correction also *removed* work — the parent-run withhold, a third `PendingAnnouncement` variant, and the assessor's exhaustive-switch refactor all dropped out — so the cost of the error was bounded and the cost of not catching it would have been three unnecessary steps.
- `instruction-violation` (self-identified) — **a scripted mutation matched more sites than intended.**
  `perl -pi -e 's/^    if \(this\.disposed\) return;\n//'` deleted *every* 4-space-indented copy of that guard, not the one under test, so two mutations ran in one pass.
  The unexpected reds were the tell.
  `/tdd-plan` already says to apply mutations with `Edit`; the existing warning covers a substitution that matches *nothing*, not one that matches too much.
  Recovered by switching to a Python `str.replace` guarded by `assert count == 1`, which fails loudly on a bad anchor.
  Impact: one wasted mutation cycle, no rework — the guard pattern was then used for every subsequent mutation in the session.
- `missing-context` — **the rebase-conflict report inferred its cause instead of reading it.**
  The peer aborted correctly per the prompt, but reported a speculative cause ("a concurrent sweep-disposition entry **or** another Phase 22 step landing on `main` would collide there") without running `git log HEAD..main`.
  The real conflict, found in two commands after the operator said to proceed, was far narrower: the disposition list body auto-merged and only the trailing `[#N]:` link-reference definitions collided.
  Impact: the operator was handed a report describing a bigger conflict than existed, and a round-trip was spent before the actual scope was known.
  `/ship-worktree` already carries the sibling rule for its own failed ff-merge ("report those commits, not a cause inferred…", Refs #815); `/sync-worktree`'s conflict branch has no equivalent.
- `instruction-violation` (agent-caught at ship time) — **the sync note cited branch SHAs the rebase then orphaned.**
  `/sync-worktree` step 3 says explicitly: "Do not cite a branch commit SHA in this note — step 4's rebase rewrites every one, leaving a dangling citation on `main`.
  Name the commit by its subject instead (Refs #814)."
  The note named the two `pi-subagents-worktrees` commits by their pre-rebase SHAs; both still resolve locally and neither is reachable from `main`.
  Corrected to commit subjects in this retro's changes below.
  The instruction was in the prompt body being executed, and the note was written in step 3 — one step before the rebase the rule warns about.
  Impact: two dead references now on `main`; no rework, because the ship stage re-derived from the range.

#### What caused friction (user side)

Nothing blocking.
The operator's one intervention — "Go ahead and resolve the conflict" — was the right call and correctly gated by the prompt's own constraint.
One opportunity: the peer's abort report invited a decision without having established the conflict's real scope, so the operator authorized a resolution sight-unseen.
A report that had run `git log HEAD..main` first would have let that authorization be specific ("keep both link definitions in numeric order") rather than general.

### Diagnostic details

- **Model-performance correlation** — planning and TDD ran on `anthropic/claude-opus-5`; a model change to `anthropic/claude-sonnet-5` landed immediately before `/sync-worktree`, and the session switched back to opus-5 when the operator answered the conflict prompt.
  The one stage that ran on sonnet-5 is the stage that produced the speculative conflict report and the dangling-SHA violation; opus-5 then diagnosed the same conflict precisely in two commands.
  Both defects are prompt-adherence failures on an explicitly-worded instruction rather than reasoning failures, which is the expected shape of a weaker model on a checklist-heavy stage.
  The remedy is prompt salience, not a model floor — `/sync-worktree` is mechanical enough that a cheaper model is the right default.
- **Escalation-delay tracking** — no `rabbit-hole` friction points.
  The longest same-error sequence was the double-mutation recovery: two tool calls to detect and one to switch approach.
  Nothing approached the five-call threshold.
- **Unused-tool detection** — the planning stage's SDK read was the correct inline choice (a targeted read of a known file, per `AGENTS.md`), and no subagent was warranted.
  For the `missing-context` conflict-report finding, no subagent was needed either: the gap was one `git log HEAD..main` invocation, not a hunt.
- **Feedback-loop gap analysis** — verification was incremental and well-placed.
  `pnpm run check` ran inside steps 2, 3, 4, and 5 rather than only at the end, `pnpm fallow dead-code` ran mid-cycle at steps 4 and 6, and the full suite ran after every step.
  The post-rebase re-run of all five gates — rather than trusting the pre-rebase green — was the correct call given that `main` had brought a `pi-permission-system` refactor and a new CI check.

### Changes made

1. `.pi/prompts/sync-worktree.md` — the conflict branch of step 4 now requires naming what actually collided (`git log --oneline HEAD..main` plus the conflicting hunks) rather than a cause inferred from the file's recent history, mirroring the rule `/ship-worktree` already carries for a failed ff-merge.
2. `.pi/prompts/tdd-plan.md` — the mutation-verification clause now names the over-matching failure alongside the existing under-matching one: a substitution that hits every sibling site reddens tests the mutation was never meant to touch.
3. `AGENTS.md` § Clarification gates — added: an option whose differentiator is a dependency's behavior is a claim about that dependency, so read its compiled source before writing the option, never its type declaration or its name.
4. `docs/retro/0870-deliver-post-result-workspace-addendum.md` — replaced the two pre-rebase SHAs in the Sync stage note with the commit subjects `/sync-worktree` prescribes; the rebase had orphaned both, leaving dead references on `main`.
