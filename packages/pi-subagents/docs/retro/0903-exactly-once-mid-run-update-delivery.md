---
issue: 903
issue_title: "pi-subagents: withheld updates outlive result collection and still claim completed children are running"
---

# Retro: #903 — pi-subagents: withheld updates outlive result collection and still claim completed children are running

## Stage: Planning (2026-09-10T02:57:46Z)

### Session summary

Verified the third-party diagnosis inline (the report supplied named files and a numbered source trace, so no `Explore` hunt was needed), then traced Pi's own delivery model to decide whether the extension's withheld queue was the cause of the four-hour latency.
Two `ask_user` rounds settled the direction: an exactly-once delivery model built on a per-update `announced` latch, with the announcement channel restricted to a still-running child and the completion nudge becoming the fourth carrier that renders updates.
Plan committed at `packages/pi-subagents/docs/plans/0903-exactly-once-mid-run-update-delivery.md`; adopted as Phase 22 Step 21 by operator decision.

### Observations

- **The latency is Pi's, not ours.**
  Measured against the pinned `@earendil-works/pi-coding-agent@0.84.4` bundle: steering is polled every turn, follow-ups only where the run would otherwise end.
  So deleting the extension's withhold would move delivery by one boundary, not four hours.
  That refuted the obvious "just stop withholding" option and became the shared premise the design keeps — the withhold is the only place a stale message can still be re-checked.
- **Operator rejected `deliverAs: "steer"`** on the merits ("if the main agent dispatched the subagents, it is working — let it settle").
  End-of-run delivery becomes the designed semantics, so `README.md`'s "rather than only at the end" is corrected in this plan instead.
  No follow-up issue filed, by explicit decision.
- **The double-render I first offered was under-design, and the operator caught it.**
  A one-bit-per-update delivery latch removes it entirely; the first `ask_user` round offered a ledger with no latch and priced the duplicate as inherent.
- **The operator's idempotence argument was right and had a stronger grounding than the definition it rested on.**
  `resumeRefusal` is a live getter, so the `AgentReport` addenda tail already renders differently between two pulls today; #872's idempotence claim is about `renderOutcomeBody`, which is untouched.
- **I contradicted myself inside one `ask_user` option.**
  The label said "delete the withheld-update queue" while the delivery table one message earlier announced a still-running child's update at settle.
  Surfaced the correction explicitly before writing the plan rather than silently picking; the queue survives, the unconditional flush does not.
- **Tidy-First assessment verified every structural claim** (no fifth reader of `runUpdates`, one `recordUpdate` call site, two `emitUpdate` call sites, one `buildPointerLines` call site) and found one preparatory step: `notification.test.ts`'s mid-run-update fixtures use `createTestSubagent`'s default `"completed"` status, so the new liveness guard would turn seven tests red for reasons unrelated to what each isolates.
  It also flagged an existing `subagent.test.ts` assertion that inverts under the unconditional ledger — folded into the plan's step 3 rather than left to surface as an unexplained red.
- **`fallow dead-code` hazard carried forward from #872's retro:** it rejected the `Subagent.runUpdates` getter for landing a step ahead of its first reader, so the new `markUpdateAnnounced` lands with its `NotificationManager` call site in the same commit.

#### Deferred tidyings

- `test/observation/notification.test.ts` — a local `liveRecord()` factory to de-duplicate the repeated `{ id: "live-1", status: "running" }` literal; the assessor rated it marginal at seven sites and left it to taste.
- `src/observation/notification.ts` — the assessor considered extracting a shared announce-predicate as *preparation* and declined: the duplication does not exist in today's code, it is created by this change, so it is a shape decision inside step 3 (where the plan does adopt it as `canAnnounceUpdate`).

## Stage: Implementation — TDD (2026-09-10T03:21:58Z)

### Session summary

Four TDD cycles, exactly as planned: the fixture-status prep, the `refactor:` landing the per-update announcement latch, the `fix:` carrying the whole delivery change, and the `docs:` recording it. pi-subagents test count went 1676 → 1684 (+8: three latch tests in `subagent-state.test.ts`, four delivery-matrix tests in `notification.test.ts`, one rewritten ledger assertion in `subagent.test.ts`, and one added mid-review).
Pre-completion reviewer: PASS.

### Observations

- **Two of the plan's killing-mutation predictions were wrong, and both were findings rather than passes.**
  Mutation (a) — restoring `if (this.claimed)` in `announceUpdate` — was predicted to redden the `wait: true` ordering test in `notification.test.ts`; it reddened only `subagent.test.ts`.
  The notification tests seed the ledger through `createTestSubagent`, which calls `state.recordUpdate` directly and bypasses `announceUpdate` entirely, so that layer can never exercise the conjunct.
  The reviewer confirmed this is correct test layering rather than a gap.
- **Mutation (b) exposed a real hole and produced a new test.**
  Dropping `record.isActive()` was predicted to redden both reported orderings; it reddened only the completion-nudge one, because the reporter's own scenario (`get_subagent_result` with `wait: true`) claims the outcome and is therefore suppressed by the claim conjunct alone.
  Added *"stays quiet once a pull without wait has rendered it"* — the collect-without-waiting path is the one only liveness catches, and it is a real production ordering.
  Re-ran mutation (b) afterwards: two reds, as intended.
- **The plan's predicted rewrite of *"is announced even after the parent collected an earlier outcome"* never happened.**
  The step-1 fixture tidy gave it `status: "running"`, under which it passes unchanged and still pins that consumption does not gate an update.
  Reviewer WARN (non-blocking): that fixture is now a state production cannot reach — every `markConsumed()` call site fires only after the record is terminal — so the test remains a valid unit pin on `canAnnounceUpdate` but its name implies a reachable ordering that no longer exists.
  Left as-is rather than renaming after the review; worth a rename on the next touch of that file.
- **The plan's own step-4 verification grep was imprecise.**
  It asserted `arrives as its own message` would return nothing; the corrected `configuration.md` sentence deliberately reuses the phrase ("It arrives as its own message when you are idle…").
  The doc is right and the command was wrong — a reminder that a stale-phrase grep needs a phrase the replacement will not legitimately contain.
- **No deviation in the production shape.**
  `canAnnounceUpdate`, the `RunUpdate` entry, `markUpdateAnnounced`, and the `buildPointerLines` prepend all landed as designed, and the five files the plan predicted unchanged were unchanged.
  The `fallow dead-code` hazard the plan anticipated did not fire, because step 2 landed `markUpdateAnnounced` with its `NotificationManager` call site as planned.

## Stage: Final Retrospective (2026-09-10T03:45:05Z)

### Session summary

One process carried all four stages — planning, TDD, ship, retro — for a third-party bug report against the mid-run update channel.
Shipped as `pi-subagents` 21.5.1 (Phase 22 Step 21) in four commits: a fixture prep, a `refactor:` landing a per-update announcement latch, the `fix:` itself, and the docs.
Every `ask_user` round produced a better design than the one offered into it.

### Observations

#### What went well

- **Measuring the dependency instead of reasoning about it changed the design.**
  The obvious fix — stop withholding updates — was refuted by reading Pi's own loop in the pinned `@earendil-works/pi-coding-agent@0.84.4` bundle: steering is polled every turn, follow-ups only where a run would otherwise end.
  Deleting the withhold would have moved delivery by one boundary, not four hours, and would have destroyed the only point where a parked message can still be re-checked.
  That single measurement supplied the shared premise every option was then built on, and grounded the operator's decision to decline `deliverAs: "steer"`.
- **Keeping that trace inline rather than dispatching `Explore` was the right call.**
  `AGENTS.md` endorses inline work when the output is a universal claim the design will rest on, and this was exactly that — a summary returned by a subagent would have had to be re-verified before it could carry a security-adjacent design decision.
  Cost roughly ten tool calls of context; worth it.
- **Mutation testing found a hole the plan did not predict.**
  Two of four predicted killing mutations were wrong.
  One was benign test layering; the other was real — the reporter's own `wait: true` ordering is suppressed by the claim conjunct alone, so nothing pinned the liveness conjunct at all until a test for the collect-without-waiting path was added.
  `/tdd-plan`'s rule that a mutation killing fewer tests than predicted is *a finding, not a pass* is what surfaced it.

#### What caused friction (agent side)

- `premature-convergence` — the second `ask_user` round offered a ledger design and priced its duplicate-render cost as **inherent**, when a one-bit-per-update delivery latch removes it entirely.
  `AGENTS.md`'s premise rule ("name it and offer the option that removes it") was applied to one premise — the withheld queue, named and defended with a measurement — and missed a second: that the ledger carries no per-message delivery state.
  Impact: one extra `ask_user` round; the operator's "why does this have to be true?"
  produced the mechanism that became the change's core.
  The rule is correctly stated; the failure was applying it once rather than exhaustively, so no prose change was proposed.
- `missing-context` — framed the exactly-once trade as a reversal of [#872]'s report-idempotence decision without first checking whether the addenda tail was actually byte-stable.
  It never was: `resumeRefusal` is a live getter, so two pulls separated by the retention sweep already render different affordance sentences.
  Impact: no rework — the operator's challenge arrived before the plan was written — but the plan would have shipped a supersession claim that overstated what was being changed.
- `other` — the round-2 `ask_user` option label said "delete the withheld-update queue" while the delivery table one message earlier announced a still-running child's update at settle.
  Self-identified after the operator answered, and surfaced explicitly before the plan was written rather than silently resolved.
  Impact: no rework; one correction message.
- `instruction-violation` (self-caught, repeat of #839) — after `git rev-parse HEAD` returned a normal 40-character SHA, judged it "41 characters … likely an extra character got added" and spent two tool calls measuring it with `wc -c`.
  `AGENTS.md` § Shell and search forbids exactly this, and the `/ship` prompt repeats it inline ("Do not measure its shape").
  Both were in context.
  Impact: two wasted tool calls, no rework.
  Deliberately **not** turned into new prose — the rule already exists twice, stated crisply; recorded here as a salience datum, and if it recurs the answer is a hard gate rather than a third statement.

#### What caused friction (user side)

- The operator interrupted to report repeated access prompts for `/dev/stdin`, caused by committing multi-line bodies with `git commit -F /dev/stdin <<'EOF'`.
  Three commits hit it before the interruption.
  `AGENTS.md` says such a body "belongs in a file passed with `-F`", which `/dev/stdin` satisfies literally while tripping the external-path permission gate.
  A one-sentence `AGENTS.md` amendment naming a real path (`/tmp/msg.txt`) was proposed and **declined**; recorded here instead.
- Round 1 of the clarification gate was bounced with a precise reason: *"I need a greater explanation of the situation, and the shape of our proposed fixes, especially in terms of what the user notices."*
  The first substance message was an accurate code trace with no scenario written from the parent agent's vantage point.
  This is the one friction point that produced a prompt change (see below) — the existing gate guidance requires concrete examples but never says *whose* view they take.

### Diagnostic details

- **Model-performance correlation** — the main session ran `anthropic/claude-opus-5` throughout all four stages; the two subagent dispatches (`tidy-first-assessor`, `pre-completion-reviewer`) ran `anthropic/claude-sonnet-5` as their frontmatter declares.
  The `model_change` entries in the session file reflect those dispatches, not switches in the main thread.
  No mismatch: both subagent tasks are judgment-heavy but bounded, and both returned substantive findings — the assessor corrected the fixture-status hazard before it could redden seven tests, and the reviewer independently re-derived all five cross-step invariants.
- **Escalation-delay tracking** — no sequence exceeded five consecutive tool calls on the same error.
  The longest run (roughly ten calls) was the mutation-verification loop in step 3, which was productive throughout rather than stuck.
- **Unused-tool detection** — nothing notable.
  The one candidate dispatch that was deliberately *not* made (`Explore` for the Pi source trace) is recorded above as a win rather than a gap.
- **Feedback-loop gap analysis** — no gap.
  `pnpm run check` and the package suite ran after every TDD step, `pnpm fallow dead-code` ran before the step-2 commit where the plan flagged a hazard, and the full root-level `lint`/`fallow` gates ran again at ship time on the exact tree being pushed.

### Changes made

1. `.pi/prompts/plan-issue.md` — added two sentences to the `Decide` section requiring a bug report's clarification gate to lead with the observed scenario in the affected party's terms before the code trace.
2. `packages/pi-subagents/docs/retro/0903-exactly-once-mid-run-update-delivery.md` — this Final Retrospective entry.

[#872]: https://github.com/gotgenes/pi-packages/issues/872
