---
issue: 885
issue_title: "pi-subagents: expose resume on SubagentsService"
---

# Retro: #885 — pi-subagents: expose resume on SubagentsService

## Stage: Planning (2026-09-11T04:09:55Z)

### Session summary

Planned Phase 22 Step 16 as `packages/pi-subagents/docs/plans/0885-service-initiated-resume.md`: a public `SubagentsService.resume` returning a discriminated result, the refusal policy relocated from `AgentTool` into `SubagentManager.resume`, [#896]'s still-running refusal folded in as a fourth `ResumeRefusal` member, and [#832]'s resume-start event folded in on a new `subagents:resuming` channel.
Eight TDD steps, the first three preparatory from the Tidy-First assessment.
Filed [#912] and [#913] as follow-ups and recorded their Phase 22 dispositions (defer; new Step 22).

### Observations

- **The issue body is stale in two places, and both change the work.**
  It says the refusal policy "lives in the tool layer" and would have to move down.
  Step 15 ([#878]) already moved the *policy* onto `Subagent.resumeRefusal`; what never moved is the **check** — `SubagentManager.resume` still guards on `isSessionReady()` alone, so a second door routed through it would resume a workspace-disposed child.
  It also implies [#832] is unimplemented; `subagents:resumed` exists and fires at resume *end*, so [#832] is specifically about a *start* event.
- **Four design questions went to the operator; all four answered as recommended.**
  Discriminated result (not a throw, not `undefined`), per-call `claimOutcome` defaulting to false, promise resolving at settle, and [#832] folded in on a new channel.
- **The operator's note on the rejected pre-check option became [#912].**
  They flagged that a consumer likely needs to know an agent is "completed but no longer resumable"; `SubagentRecord` cannot express that today (`sessionReleased`/`workspaceDisposed` are not on the snapshot and are not derivable from it).
  Deferred to a later phase rather than folded in, since its shape is undecided between an ADR-0005 admission and a service query.
- **A real defect surfaced while checking whether `ResumeOptions` needs a `signal`.**
  `Subagent.abort()` fires a controller `resumeTurnLoop` never sees, so `abort(id)` reports success on a resumed agent while the child keeps taking turns, and `markStopped` then blocks the terminal `markCompleted`.
  Pre-existing on the tool door (the parent's tool-call signal masks it) and reachable through the new door — filed as [#913], adopted as Phase 22 Step 22.
- **The transient affordance was worded to keep the `resume:` token out of it.**
  `AGENTS.md`'s token-absence rule applied to my own draft: the first wording named the resume call for later ("wait, then resume"), which would have forced the existing `names no resume call for any reason` loop to stay at three reasons.
  Rewording to point at `get_subagent_result` with `wait: true` lets the loop cover all four.
- **[#903]'s accepted residual becomes reachable here.**
  Its plan predicted that "a service-initiated unclaimed resume ([#885], unshipped) would announce a previous run's message once."
  Recorded in the plan's Invariants section as accepted rather than fixed: the message was never delivered and the child is live again when it lands.
- **Tidy-First: three Recommended preparatory commits, all adopted** as TDD steps 1–3 (extract `AgentTool`'s resume branch; nest the 19-test flat resume block into refused/accepted; add a `mockResumeRecord` fixture builder).
  Two corrections it returned were folded into the plan: `test/helpers/make-deps.test.ts` calls the mock `resume` positionally and asserts on its bare return (a target file I had missed), and `test/tools/get-result-tool.test.ts` has no running-plus-question case to update, so that coverage is new test-writing rather than a migration.

#### Deferred tidyings

- `src/lifecycle/subagent-manager.ts` — `buildObserver`'s repeated `try { this.observer?.onSubagentX(agent); } catch { debugLog(…) }` clauses (a `safeNotify(label, fn)` helper); assessed as Optional and dropped, since three short clauses are not friction the change hits.
- `src/observation/composite-subagent-observer.ts` / `src/lifecycle/subagent-manager.ts` — the optional-versus-required split across `SubagentManagerObserver`'s member list, beyond the one member this change adds; rejected as scope creep.
- `src/observation/outcome-delivery.ts` — restructuring `STATUS_MEANINGS` and its adjacent renderers; rejected as scope creep.

[#832]: https://github.com/gotgenes/pi-packages/issues/832
[#878]: https://github.com/gotgenes/pi-packages/issues/878
[#896]: https://github.com/gotgenes/pi-packages/issues/896
[#903]: https://github.com/gotgenes/pi-packages/issues/903
[#912]: https://github.com/gotgenes/pi-packages/issues/912
[#913]: https://github.com/gotgenes/pi-packages/issues/913

## Stage: Implementation — TDD (2026-09-11T05:00:55Z)

### Session summary

Executed all eight planned TDD cycles plus two unplanned commits: `SubagentsService.resume` with a discriminated result and a per-call `claimOutcome`, the refusal policy relocated to `SubagentManager.resume`, [#896]'s still-running refusal, and [#832]'s `subagents:resuming` channel.
The pi-subagents suite went 1684 → 1712 tests (+28), all green, with `check`, root `lint`, `fallow dead-code`, and `verify:public-types` clean.
Pre-completion reviewer: WARN (no blocking findings).

### Observations

- **The plan's prediction for the widget was wrong, and the test caught it.**
  `Module-Level Changes` said `AgentWidget.onSubagentResuming` calls `update()`, mirroring `onSubagentResumed`.
  The test asserted the timer restarts, which `update()` does not do: `clearWidget()` stops the interval once nothing is active, so a resume arriving after a child settled would repaint once and leave a static spinner.
  `startLoop()` is the right call, and the deviation is recorded in the architecture doc's `Landed:` note.
- **The transient affordance was reworded during planning to keep `resume:` out of it**, and that paid off here: the existing `names no resume call for any reason` loop widened from three reasons to four with no exception, instead of needing one.
- **Two of the plan's preparatory steps earned their place; the third earned more than expected.**
  Extracting `resumeExisting` meant step 5 replaced one small method.
  The refused/accepted nesting turned out to mark exactly the seam the rewiring split: the five refused tests stopped constructing records entirely and now state the reason they are wording (`mockResumeRefusal`), while the accepted half only re-wrapped its mock value.
  A second builder (`mockResumeRefusal`) was added during step 5 that the plan had not named.
- **Removing the `getRecord` pre-read left seven identical three-line setups dead in the accepted tests**, since the door no longer reads the record it was mocking.
  Deleting them also emptied three imports, which `biome check --write` would not fix (unsafe-classified) and which had to be hand-edited.
- **`resetForResume` ordering was worth a dedicated pin.**
  The claim must land before `Subagent.resume()` because `resetForResume` runs synchronously inside it; the manager test drives a `resumeTurnLoop` that never settles and asserts `claimed` while the resume is in flight, and moving `claim()` after the `await` reddens exactly that test.
- **The plan's "Failed to resume" removal held up under review.**
  The reviewer re-derived it: nothing awaits between the refusal read and `agent.resume()`, and `Subagent.resume` rejects only on the missing session `resumeRefusal` has already excluded — so no path strands a claim.
- **Reviewer warnings** — WARN, two findings, neither blocking. (1) The plan's "bounded to one message per resumed run" for the accepted [#903] residual was quoted from that plan rather than re-derived: `NotificationManager.pending` does not collapse updates per record (only completions), so an unclaimed resume can flush several.
  Corrected in `099a7c35` — what is bounded is the content, not the count. (2) A pre-existing race the reviewer flagged for awareness: `abort()` sets `stopped` synchronously while the cancelled turn loop is still settling, so `resumeRefusal` reports resumable during that window.
  Unchanged by this diff (the old getter had the same gap) and adjacent to [#913], which Step 22 owns.
- **One unplanned `test:` commit** (`ea6c081a`) pins the pull path [#896] actually reports — `get_subagent_result` on a running child carrying a `pendingQuestion`.
  The plan listed that file as a touch point but the Tidy-First assessor had already found no existing case there; the test passed on first run, so it was mutation-checked (removing the `still-running` arm reddens it) before being committed as a pin rather than a probe.
