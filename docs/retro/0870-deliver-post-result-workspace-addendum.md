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
