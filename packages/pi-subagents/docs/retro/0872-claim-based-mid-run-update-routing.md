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

## Stage: Final Retrospective (2026-09-06T17:25:54Z)

### Session summary

Shipped #872 through the worktree lane: fast-forward-merged `issue-872-pi-subagents-notify-parent-s-background` into `main`, verified CI, closed the issue, released `pi-subagents-v21.4.3`, and tore down the worktree.
The whole four-stage arc (plan → TDD → sync → ship) produced one friction point worth recording, and it was caught by a gate rather than by the operator.

### Observations

#### What went well

1. **The shared-premise rule produced the design.**
   `AGENTS.md` § Clarification gates says that when every option shares a premise, name it and offer the option that removes it.
   All three of the issue's options assumed the nudge is an update's only carrier; naming that premise in the gate's substance message produced option D (claim-based routing), which the operator chose.
   The rule did not merely improve the gate's phrasing — it produced a design that subsumes the old gate instead of patching it, and that no option in the issue body described.
2. **Investigation refuted the issue's own framing before the first gate.**
   Reading `get-result-tool.ts` found a third instance of the defect — `get_subagent_result(wait: true)` claims and blocks the parent on a *background* child's initial run — which no spawn-mode or resume-based predicate can express.
   This is the `/plan-issue` "trace what triggers the defect" instruction paying off on a self-filed issue, where the temptation to treat the body as a spec is strongest.
3. **The mandatory "Verify the pins" step caught a vacuous test.**
   "Leads with what the agent flagged along the way" passed pre-fix because `indexOf` returned `-1` and `-1 < N` holds.
   Red's own evidence could not have surfaced this; the step's separate mutation pass did, before Green.
4. **`fallow dead-code` shaped the commit sequence.**
   It rejected `Subagent.runUpdates` as an unused class member in step 2, moving the getter to step 3 with its first reader.
   The plan's risk table predicted the getter would trace — it does, but only once a consumer exists, which the gate made concrete rather than arguable.
5. **Zero-friction ship across a full worktree lane.**
   Lane detection, ff-merge prediction (`git merge-base --is-ancestor`), pre-push checks, CI, `next-version.sh`, release dispatch, release verification, and teardown all ran first-try with no retries and no manual recovery.

#### What caused friction (agent side)

1. `instruction-violation` — an atomic `Edit` batch on `docs/architecture/architecture.md` was rejected on its third edit; only that third edit was re-applied, silently dropping the Step 14 `✅` heading mark and its Mermaid node mark.
   `AGENTS.md` § Edit tool batches states the correct repair verbatim ("re-apply every intended edit (not just the ones you retried)").
   Neither `pnpm run lint` nor `rumdl` can see a missing `✅`, so no deterministic gate covered it.
   Caught by the `pre-completion-reviewer`, not self-identified and not operator-caught.
   Impact: one extra follow-on commit (`0f4f2e79`), no rework of code or tests.
2. `other` — the TDD stage applied killing mutations with `python3` heredoc substitutions rather than the `Edit` tool that `/tdd-plan` step 3 prescribes.
   Four of roughly six mutations were confirmed applied (`git diff --stat`, `grep -n`) before reading the suite; the rest were not.
   Impact: none observed — every mutation reddened something, so no silent no-op occurred — but the verification the rule exists to guarantee was left to discretion.

#### What caused friction (user side)

1. The intent to expose `resume` on `SubagentsService` surfaced mid-gate, after the first direction gate had already been answered.
   It falsifies "a resume implies a blocked parent" — the premise options A/B/C rested on — so it was directly material to the choice already made.
   Opportunity: an unrecorded intent that would invalidate a candidate option is worth stating at the start of planning, where it becomes an input to the first gate rather than a second one.
   The recovery was clean (both decisions were bundled into one follow-up gate, and the chosen predicate is immune to the change), so this cost a gate round-trip and nothing else.

### Diagnostic details

- **Model-performance correlation** — Planning and TDD ran on `anthropic/claude-opus-5`; Sync and Ship ran on `anthropic/claude-sonnet-5`; this retrospective on `anthropic/claude-opus-5`.
  The split matches the work: the judgment-heavy stages (refuting the issue's framing, designing the claim predicate, mutation reasoning) drew the stronger model, and the procedural stages did not.
  Ship executed a 13-step template — lane detection, ff-merge, CI, release, teardown — first-try on the cheaper model, which is evidence the template carries enough determinism to not need the expensive one.
  Two subagents were dispatched (`tidy-first-assessor` at planning, `pre-completion-reviewer` at TDD close), both on their frontmatter-locked models; no mismatch.
- **Escalation-delay tracking** — no `rabbit-hole` friction points.
  The longest same-target tool sequence was the step 3 and step 4 mutation passes (roughly two calls per mutation, save-mutate-run-restore), which is the prescribed loop rather than a stall.
- **Unused-tool detection** — `colgrep` was not used during planning exploration.
  Not a finding: every search was an exact symbol match (`canSendUpdates`, `claimed`, `onUpdateSent`, `midRunUpdates`), which is the documented `grep` case in the `colgrep` skill's decision table.
- **Feedback-loop gap analysis** — no gap.
  `pnpm run check` ran mid-step whenever a shared type changed, and `check` + `lint` + full suite + `fallow dead-code` ran at every one of the five commit boundaries rather than once at the end.
  The step 2 `fallow` finding and the step 4 stale-suppression finding were both caught at their own commit boundary, which is why neither needed a later fixup commit.

### Changes made

1. `.pi/prompts/tdd-plan.md` — step 7 gained a post-condition for the roadmap-step `✅` marks: `grep -c '✅.*Step <N>' <arch-doc>` must report 2 before committing.
   The mandate existed; the verification did not, and no lint or type gate can see a missing `✅`.
2. `.pi/prompts/build-plan.md` — the same post-condition added to step 4, which carries the identical mandate on one line.
   The operator raised this during the retro gate; `/build-plan` is the more exposed of the two, since a docs-or-config change has no test suite and leaves the `pre-completion-reviewer` as the only gate.
3. This retro file — Final Retrospective stage entry.
