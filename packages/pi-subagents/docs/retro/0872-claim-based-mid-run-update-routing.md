---
issue: 872
issue_title: "pi-subagents: notify_parent's background-only gate does not hold for a resumed run"
---

# Retro: #872 — pi-subagents: notify_parent's background-only gate does not hold for a resumed run

## Stage: Planning (2026-09-06T04:01:35Z)

### Session summary

Planned Phase 22 Step 14 as `packages/pi-subagents/docs/plans/0872-claim-based-mid-run-update-routing.md`.
The issue offered three options; investigation found the framing itself was too narrow, and the adopted direction (option D) routes a mid-run update by `record.claimed` rather than by spawn mode, buffering an update sent while a blocking carrier holds the outcome so it rides that carrier's own return.
Filed [#885] (expose `resume` on `SubagentsService`) and recorded it as Phase 22 Step 16 by operator decision.

### Observations

- **A third instance of the defect the issue does not name.**
  `GetResultTool` with `wait: true` calls `record.claim()` and blocks the parent on a *background* child's initial run, with no resume involved — the same window the gate refuses for a foreground child.
  Finding it is what refuted the "recompute at the resume edge" framing: spawn mode and "is this a resume" both under-describe the condition.
- **The predicate already existed.**
  `record.claimed` is set at all three blocking front doors and is already consulted by `NotificationManager.sendCompletion`; `sendUpdate` deliberately skips it.
  Substituting it *subsumes* the old gate rather than replacing it — a foreground initial run is claimed for its whole duration, so `isBackground` falls out as a consequence.
- **The shared-premise check paid off.**
  All three of the issue's options assumed the nudge is an update's only carrier.
  Naming that premise in the gate's substance message produced the fourth option, which the operator chose.
- **Non-drain over drain.**
  The buffer is cleared at run start, never drained by a carrier, matching `pendingQuestion` / `workspaceNotice`.
  This keeps a second `get_subagent_result` idempotent — it re-renders the result, so it must re-render the updates.
- **Sequencing gate.**
  The operator surfaced an unrecorded intent to expose `resume` on `SubagentsService` mid-gate.
  That would falsify "a resume implies a blocked parent", which options A/B/C rested on and the claim predicate does not — so the direction choice and the sequencing choice were coupled, and both were put in one follow-up gate.
- **Tidy-First.**
  One Recommended preparatory refactor accepted as TDD step 1: three carriers repeat `renderWorkspaceNotice + renderQuestionAffordance` verbatim, and the change inserts a third element into that tail at each.
  Consolidating first turns three order-sensitive edits into one function body — and because `Subagent` and `AgentReport` both satisfy the extracted structural type, the feature step edits no call site at all.
  The assessor verified every file/line citation in the design summary; no contradictions.
- **No deferred tidyings** worth recording: the assessor's two rejections were a doc-drift note (already covered by the plan's documentation table) and a declined unification of the update buffer with `_pendingSteers`, which re-delivers into a live session rather than rendering into a carrier's return.

## Stage: Implementation — TDD (2026-09-06T04:32:46Z)

### Session summary

Executed all five plan steps as separate commits, plus one doc fixup.
`notify_parent` now reaches every child gated only on `midRunUpdates`, and each message is routed by `record.claimed`: a claimed run's update is rendered by the carrier holding that outcome, an unclaimed run's is announced as it happens, and the lifecycle event fires either way.
Test count 1564 → 1589 (+25) in pi-subagents.

### Observations

- **Deviation — a fourth carrier site.**
  The plan listed three addenda call sites; `foreground-runner.ts`'s error branch returns before the tail, so it composes `renderRunUpdates` directly.
  That branch is where the plan's own edge-case reasoning lands ("a failed run is where mid-run findings are the only thing that survives"), so omitting it would have contradicted the design.
  The reviewer confirmed the omitted `renderQuestionAffordance` is provably a no-op there: every route to `status === "error"` clears `pendingQuestion`.
- **Deviation — TDD-order adjustment.**
  Step 2 planned the `Subagent.runUpdates` delegating getter alongside the state buffer; `pnpm fallow dead-code` rejected it as an unused class member with no consumer, so it moved to step 3 with its first reader.
  The plan's risk table predicted this getter would trace — it does, but only once a consumer exists.
- **A test that was green during Red.**
  "Leads with what the agent flagged along the way" passed pre-fix, because `indexOf` returned `-1` for the absent text and `-1 < N` holds.
  Caught before Green and strengthened with presence assertions, copying the guard comment the sibling ordering test already carried.
- **Mutation results against the plan's predictions.**
  Restoring the `isBackground` conjunct killed one test, not the two the plan named: the resume test uses a background child by default, so it belongs to the routing class (killed by removing the buffer branch) rather than the spawn-mode class.
  Every other predicted mutation killed what it named; removing `renderRunUpdates`' body reddened all four carriers plus the unit tests.
- **A stale fallow suppression surfaced.**
  The new release-then-announce test gives `Subagent.release()` a direct call site, so its `fallow-ignore-next-line` became stale.
  Removed the directive, kept the note explaining why `src/` reaches it only through structural interfaces.
- **An atomic `Edit` batch rejection dropped two edits silently.**
  The batch carrying Step 14's `✅` heading and Mermaid marks was rejected on an unrelated third edit; only the third was re-applied, so the marks were missing until the pre-completion reviewer caught it.
  This is the `AGENTS.md` hazard exactly — after a rejection, re-apply *every* intended edit, not just the one retried.
- **Pre-completion reviewer: WARN** (one finding, the missing `✅` marks above; fixed in `0f4f2e79`).
  Its requested routing re-derivation found no stranding path beyond the ones the plan enumerates and accepts.

[#885]: https://github.com/gotgenes/pi-packages/issues/885

## Stage: Sync (worktree) (2026-09-06T17:13:55Z)

### Session summary

Pre-push checks (`pnpm run lint`, `pnpm fallow dead-code`) both passed clean with no fixes needed.
The branch rebases cleanly onto local `main` with no conflicts (verified below); the plan's `**Release:** ship independently` marker stands — no batch to defer to.
Follow-up #885 (expose `resume` on `SubagentsService`, adopted as Phase 22 Step 16) is already filed and dispositioned.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-872--/2026-09-06T03-23-05-831Z_01a074bd-b8e7-731e-ab05-981b5fb1a787.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

Nothing further beyond the deviations and the reviewer's WARN already recorded in the Implementation stage above — this sync found no new issues.
