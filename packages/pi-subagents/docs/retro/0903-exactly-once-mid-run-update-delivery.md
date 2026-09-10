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
