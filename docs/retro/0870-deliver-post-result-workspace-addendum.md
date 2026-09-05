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
The plan's `**Release:** ship independently` marker stands — no batch to coordinate, and the dispatch at ship time should name both `pi-subagents` and `pi-subagents-worktrees` (the latter for its `fix:` and `docs:` commits: `86fcaa6f fix(pi-subagents-worktrees): warn about unmerged rescue branches at session start` and `086bbd0b docs(pi-subagents-worktrees): document the unmerged-branch warning`).

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-870--/2026-09-04T19-11-10-073Z_01a06dd4-fcf8-7597-aab2-150693ad6260.jsonl` — read with `read_session_file({ path: "..." })` for message-level verification at land/retro time.

### Observations

Nothing further to hand off beyond what the TDD stage already recorded: [#878] is filed and dispositioned as Phase 22 Step 15, and no other deferred work surfaced during sync.
Both packages' commits in this range are releasable together in one dispatch.

The rebase onto `main` conflicted once, in `packages/pi-subagents/docs/architecture/architecture.md`, on the `docs(pi-subagents): disposition #878 against Phase 22` commit.
Two sibling dispositions ([#872], [#876]) landed on `main` while this branch was open.
The sweep list itself auto-merged; only the link-reference definitions collided, where both sides appended a line at the same position.
Resolved by keeping both in numeric order, and verified by diffing the rebased file against `main` — the only removed lines are the five module-tree entries and three Step 12 lines this branch rewrites on purpose, so nothing from the concurrent commits was dropped.

Every gate was re-run after the rebase rather than trusting the pre-rebase run, since `main` brought a large `pi-permission-system` directory refactor and a new `ci: flag alias imports` check: `pnpm install --frozen-lockfile`, `pnpm run lint`, `pnpm run check`, `pnpm run test`, and `pnpm fallow dead-code` all pass, with `pi-subagents` at 1561/76 and `pi-subagents-worktrees` at 74/8.
