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

[#885]: https://github.com/gotgenes/pi-packages/issues/885
