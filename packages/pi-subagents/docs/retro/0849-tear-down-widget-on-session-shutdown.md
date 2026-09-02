---
issue: 849
issue_title: "pi-subagents: AgentWidget.dispose() is never called, so the widget is not torn down on session_shutdown"
---

# Retro: #849 — pi-subagents: AgentWidget.dispose() is never called, so the widget is not torn down on session_shutdown

## Stage: Planning (2026-09-01T22:59:29Z)

### Session summary

Planned Phase 22 Step 9: wire `AgentWidget.dispose()` to `session_shutdown` and make disposal final.
Ran the design gate (both recommendations accepted), measured the ordering hazard with a disposable spike, dispatched the Tidy-First assessor, and committed `packages/pi-subagents/docs/plans/0849-tear-down-widget-on-session-shutdown.md`.
The plan is six steps: one preparatory `test:` fixture widening, two `fix:` behavior steps, two `test:` pins, and a `docs:` roadmap mark.

### Observations

- **The ordering hazard is measured, not argued.**
  `abortAll()` drives `AgentWidget.update()` synchronously — `Subagent.stopQueued()` calls `observer.onRunFinished(this)` inline (`subagent.ts:479`) and `abort()` reaches the same path through `markStopped()`.
  A disposable spike (`test/ui/spike-dispose-order.test.ts`, written, run green, deleted) showed that `dispose()` **before** a terminal transition leaves the timer cleared but **re-registers** the widget — the last `setWidget` argument is a render function again.
  `dispose()` after the transition leaves timer count 0 and content `undefined`.
  That measurement is what ruled out placing the teardown early in the shutdown sequence, and it is the specific defect in [PR #850].

- **The defect is masked today by an accidental three-fact chain.**
  `manager.dispose()` empties the registry → the next 80 ms tick finds no agents → `update()`'s idle path calls `clearWidget()`.
  So the resources *are* released, by emergent behavior rather than by design.
  The plan states this honestly instead of overselling a leak: on the interactive-quit path it is moot (`InteractiveMode.shutdown()` stops the TUI before emitting `session_shutdown`, then `process.exit(0)`), and on the session-replacement paths (`/new`, `/resume`, `/fork`) the residual is a ≤ 80 ms race against a **process-global** widget key (`setExtensionWidget` looks the key up in one map on the persistent `InteractiveMode` instance).
  Framing it as a resource acquired with no explicit release, rather than as a user-visible leak, is what kept the plan's claims defensible.

- **Two gate decisions, both recommendations accepted.**
  Wiring → `WidgetEventsHandler.handleSessionShutdown()` with its own `pi.on` registration (over a `disposeWidget` dep on `SessionLifecycleHandler`), following [#827]'s landed precedent that the widget's concerns do not share a lambda with the session-lifecycle one.
  `dispose()` → also clear `uiCtx`, since `update()`'s first line is `if (!this.uiCtx) return;`, which makes the measured re-registration impossible by construction and demotes registration order from a correctness dependency to documented intent.

- **[PR #850] reaches the same diagnosis and is a ship-time close target.**
  Single commit `3d6715cc` by `mikemikimike`.
  Adopted: the fix's shape and its widget-test assertion set (`vi.getTimerCount()` → 0, both registrations cleared).
  Diverged on six points, recorded in the plan's Background — most materially that it calls `disposeWidget()` at position 2 (before `abortAll()`), which the spike measures as undone; that it defaults the dep to a silent no-op (`= () => {}`), reintroducing the very defect class the issue is about; and that it is written against pre-[#827] `index.ts`.
  `Co-authored-by: mikemikimike <13286568797@163.com>` is specified in TDD step 4, resolved from the PR's commit author rather than guessed.

- **The Tidy-First assessor found one real preparatory step and refuted nothing.**
  Recommended: widen `test/ui/agent-widget.test.ts`'s `makeWidget()` to record `setStatus` calls, which it currently discards (`setStatus: () => {}`) — without it the "both registrations cleared" assertion cannot be written through the shared helper, which is exactly why [PR #850] hand-rolled a one-off UI recorder.
  It verified rather than assumed the four things I asked it to check: the `EventDrivenWidget` interface and `handlers/index.ts` barrel extend cleanly, and both `composition-root.test.ts` and `print-mode.test.ts` already fan out per event post-[#827].

- **Step 5's mutation is predicted to possibly leave the suite green, and the plan says so.**
  Swapping the two `session_shutdown` registrations may not turn the ordering test red, precisely because Decision 2's `uiCtx` clear makes the widget inert.
  The plan instructs the implementing session to record that as a finding, keep the test as an outcome pin, and move the ordering claim into the `index.ts` comment — rather than manufacture an assertion that only fails by reaching into private state.

- **`print-mode.test.ts` is in the plan's file list as a no-change entry.**
  The [#827] retro's `missing-context` finding was that this file was omitted from a file list for exactly the reason it belongs in one — it drives the composition root without the design editing it.
  Listing it explicitly as "no change, verified" closes that loop rather than relying on the next session to re-derive it.

#### Deferred tidyings

- `packages/pi-subagents/src/ui/agent-widget.ts` — the assessor considered and declined merging `dispose()` with `clearWidget()` to remove their apparent duplication.
  The behaviors genuinely differ (`clearWidget()` also prunes `finishedTurnAge` against the live agent list) and `clearWidget()`'s own doc comment states the separation is deliberate; a shared helper would need a discriminator parameter.
  Recorded only so a later sweep does not re-discover it as a candidate.

## Stage: Implementation — TDD (2026-09-02T02:46:49Z)

### Session summary

Executed five of the plan's six TDD steps; step 5 was dropped by operator decision after measurement (see below).
`AgentWidget.dispose()` now clears its `UICtx` as well as the interval and both registrations, and `WidgetEventsHandler.handleSessionShutdown()` is registered on `session_shutdown` after the lifecycle handler.
Tests went 1438 → 1447 across an unchanged 74 files: +3 in `test/ui/agent-widget.test.ts`, +4 in `test/handlers/widget-events.test.ts`, +2 in `test/composition-root.test.ts`.
Pre-completion reviewer: WARN (two doc-accuracy findings, both fixed).

### Observations

- **Deviation 1 — `fallow` counts test call sites, which broke two plan claims in the same direction.**
  The plan deferred removing the `fallow-ignore-next-line unused-class-member` comment to step 4, reasoning that `dispose()` would have no call site until the wiring landed.
  It has one as soon as step 2's tests call it, so the suppression went stale immediately and `pnpm fallow dead-code` failed in the *opposite* direction from the plan's prediction.
  Removed it in step 2 instead.
  The same fact invalidates step 4's second killing mutation: with the registration deleted and no suppression, fallow reports zero findings.
  The gate can never pin production wiring — the composition-root tests are the only pin.
  Both corrections are recorded in the commit bodies and the architecture doc's `Landed:` note; the plan file is left as written.

- **Deviation 2 — the first draft of step 4's tests was vacuous, and the reviewer reproduced why.**
  Spawning a background agent and firing `session_shutdown` while it was still *running* passed with the wiring deleted: `abortAll()`'s notification settles after `manager.dispose()` has emptied the registry, so `update()` takes its idle path into `clearWidget()` and tears the widget down incidentally.
  That is the accidental self-heal the plan's Background described, and it is deterministic in this harness rather than the ≤ 80 ms race the plan expected.
  Driving the agent to **completion** first fixes it — `disposeSession()` notifies no observer, so no incidental `update()` lands.
  The `completeAgentIntoWidget()` doc comment records why the choice is load-bearing.

- **Deviation 3 — step 5 was dropped, not deferred.**
  The plan anticipated that the ordering mutation might stay green and pre-authorized recording it as a finding.
  Measured: swapping the two `session_shutdown` registrations leaves all 1447 tests green, because Decision 2's `uiCtx` clear makes both orders converge.
  Worse, the test written for the step survived the *wiring-deletion* mutation too, so by the `testing` skill's definition it was a broken probe — and `composition-root.test.ts`'s docstring claims only that file fails when wiring is removed, so committing it would have weakened a true claim.
  Operator chose to drop it and keep the ordering as defensive intent in an `index.ts` comment.

- **Deviation 4 — step 2 was retyped `fix:` → `refactor:`.**
  The plan suggested `fix:`, but at that commit `dispose()` had no production call site, so nothing a user could observe had changed — `AGENTS.md`'s rule types it `refactor:`.
  Caught by the changelog-preview step, corrected before anything was pushed via `git reset --hard` + `--amend` + `cherry-pick` (rebase avoided per `AGENTS.md`), and verified with an empty `git diff backup-tag HEAD`.
  The plan had applied exactly this reasoning to step 3 and not to step 2.

- **Deviation 5 — the plan's quantitative baseline row was contaminated.**
  It records 1440 tests / 75 files; the true baseline is 1438 / 74.
  The planning session measured it with its own disposable spike file still on disk.
  Recorded in the architecture doc's `Landed:` note.

- **The reviewer's two WARNs were both stale-measurement defects, and one was mine from this stage.**
  I wrote "1448 tests" into the `Landed:` note — a number measured while the step-5 test still existed, carried forward after it was dropped.
  Re-measured at HEAD: 1447.
  The other WARN was that deviation 5 appeared nowhere in the shipped record.
  Both fixed by amending the docs commit.
  The lesson is `AGENTS.md`'s own: a measurement is scoped to the commit it was taken at, and dropping a test is a behavior change that invalidates it.

- **PR #850 is credited and remains a ship-time close target.**
  `Co-authored-by: mikemikimike <13286568797@163.com>` is on the wiring commit and verified with `git interpret-trailers --parse`.

## Stage: Sync (worktree) (2026-09-02T02:49:27Z)

### Session summary

Pre-push checks passed clean: `pnpm run lint` and `pnpm fallow dead-code` both zero-finding.
The plan's `**Release:** ship independently` marker stands — no open batch names Phase 22 Step 9, and Track C (Steps 6 → 9) is now fully landed.
PR #850 remains an open close target at ship time (credited via `Co-authored-by` on `57045754`).

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-849--/2026-09-01T22-42-57-511Z_01a05f23-cf67-72ca-86a8-e3bf8df479b9.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

No deferred work for the root to pick up beyond closing PR #850.
The TDD stage's five deviations (see prior stage entry) are all resolved and re-verified; nothing further surfaced during sync.

## Stage: Final Retrospective (2026-09-02T03:00:47Z)

### Session summary

Landed the peer branch on `main` (fast-forward `65d9f053..344a1c4e`), verified CI, closed #849, released `pi-subagents-v21.2.1`, and tore the worktree down.
The ship itself was linear and clean — 26 tool calls, no rework, no failed gate, no operator intervention.
The retrospective then found two defects the ship flow had no step to catch: a fabricated commit SHA published in the close comment, and [PR #850] left open despite being a recorded close target in both the plan and the sync stage note.

### Observations

#### What went well

- **Release coordination up front worked exactly as designed.**
  The plan's `**Release:** ship independently` marker was read before any irreversible action, so no operator gate was needed and the decision never had to be revisited at the cancel point.
  `./scripts/release/next-version.sh pi-subagents` printed `pi-subagents-v21.2.1` and the dispatched run cut precisely that tag.

- **The stale-measurement discipline held across three stages.**
  The TDD stage caught its own contaminated count (1448 → 1447 after step 5 was dropped), the pre-completion reviewer caught the planning stage's contaminated baseline (1440/75 → 1438/74), and both corrections reached the architecture doc's `Landed:` note before the land.
  This is the first issue in this package where a measurement defect was corrected at every stage that introduced one.

#### What caused friction (agent side)

- `instruction-violation` (self-identified — but only at retro, after it shipped) — the close comment cites `a1c1e5c7` for the Tidy-First refactor commit.
  That object does not exist; the real commit is `a14a217c`.
  The comment's *first* SHA (`a9a7a630`) was correct because it was copied from `git log` output; the second was typed from memory mid-draft.
  `AGENTS.md` names this failure mode precisely — "including the second and third hash cited mid-draft, which is where the invention happens (Refs #777)" — and `/ship-issue` carries its operational form (resolve every SHA before drafting, then re-resolve every hex token in the finished draft, Refs #704, #788).
  `/ship-worktree` step 5 carries only the *formatting* half of that rule ("SHA as plain text (no backticks) so GitHub auto-links it") and none of the verification half.
  Impact: a wrong, non-auto-linking SHA published to a public closed issue; requires a correcting comment.

- `missing-context` — the ship session never opened the plan body or the retro file, so [PR #850] was not closed.
  The plan anticipated this exactly: its risk table has the row "[PR #850] is forgotten at ship time", whose recorded mitigation is "Recorded here and in the Planning stage note."
  That mitigation assumes the shipping step reads those artifacts, and `/ship-worktree` reads the plan only through `grep -F '**Release:**'` and never reads the retro at all.
  The sync stage note's handoff sentence — "No deferred work for the root to pick up beyond closing PR #850" — was written for a reader that the prompt never sends.
  Impact: an adopted contributor's PR is still open after the work shipped under their `Co-authored-by` credit.

- `other` — the final report asserted "Nothing skipped" while a close target had in fact been skipped.
  A report that enumerates the prompt's own step list cannot surface an omission the prompt never asked about, so the assertion was structurally unfalsifiable rather than wrong-in-fact.

#### What caused friction (user side)

- None.
  The ship ran unattended end to end, which is the intended shape; both defects are prompt gaps rather than missed interventions.

### Diagnostic details

- **Model-performance correlation** — the ship stage ran entirely on `anthropic/claude-sonnet-5` (turns 2–27), this retrospective on `anthropic/claude-opus-5`; no subagents were dispatched in either.
  No quality mismatch: the ship work is procedural, and sonnet-5 executed every literal step of the prompt without deviation.
  That is the diagnostic point rather than a caveat — neither defect is a reasoning failure, and both survived because the prompt did not ask for the check.
- **Escalation-delay tracking** — no `rabbit-hole` points; the longest same-target sequence was two calls (`git rev-parse HEAD`, then `wc -c` to confirm 40 characters).
- **Unused-tool detection** — `read` on `packages/pi-subagents/docs/retro/0849-tear-down-widget-on-session-shutdown.md` was available throughout the ship and never used.
  It is the single call that would have surfaced both the PR close target and the sync stage's handoff note.
- **Feedback-loop gap analysis** — not applicable.
  A ship flow's verification is CI, which ran to `success` on `344a1c4e` before the issue was closed or anything was released.

### Changes made

1. `.pi/prompts/ship-worktree.md` — step 5's "Implemented in <sha>" bullet gains the verification half of `/ship-issue`'s rule: resolve every SHA with `git rev-parse` before drafting, then re-resolve every hex token in the finished draft (Refs #777, #788).
2. `.pi/prompts/ship-worktree.md` — step 5 gains a close-target sweep: check the plan and the retro's stage notes for an adopted third-party PR, and close each with `gh pr comment` then `gh pr close`, crediting by `@login` (Refs #670, #690).
3. Issue #849 — posted a correcting comment retracting the fabricated `a1c1e5c7` and naming the real Tidy-First commit `a14a217c`.
   The correction's own SHAs were verified with the rule added in change 1, which caught nothing but is now the exercised path.
4. [PR #850] — closed as shipped (not merged) with a comment crediting `@mikemikimike`, naming the two recorded divergences (ordering, and the defaulted no-op dependency) and pointing at `a9a7a630`.
5. Filed #869 (`scope:repo`) for the structural cause — `/ship-worktree` and `/ship-issue` step 5 have diverged, and both gaps above were rules the trunk path already carried.
   `roadmap-fit` exited at Step 1: the issue asserts `scope:repo`, so it resolves to no package and takes no Phase 22 disposition, matching the precedent set when [#451] was relabeled out of this roadmap.

[#451]: https://github.com/gotgenes/pi-packages/issues/451
[#827]: https://github.com/gotgenes/pi-packages/issues/827
[PR #850]: https://github.com/gotgenes/pi-packages/pull/850
