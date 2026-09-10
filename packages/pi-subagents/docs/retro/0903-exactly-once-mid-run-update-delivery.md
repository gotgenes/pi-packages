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
