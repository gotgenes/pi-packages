---
issue: 830
issue_title: "pi-subagents: SubagentRecord's allowlist has no stated policy; decide what the public snapshot exposes"
---

# Retro: #830 — SubagentRecord's allowlist has no stated policy

## Stage: Planning (2026-08-29T19:33:31Z)

### Session summary

Planned Phase 22 Step 2: a written admission policy for the public `SubagentRecord` snapshot, recorded as package ADR 0005, plus the field dispositions that follow from it.
The operator chose the "discrete-query answer" policy (admit identity, resolved spawn facts, cumulative metrics, and durable-artifact pointers; decline momentary activity and internal bookkeeping), declared the type producer-only with required additions, and folded the `lifetimeUsage` aliasing fix into this change.
The plan is committed at `packages/pi-subagents/docs/plans/0830-subagent-record-admission-policy.md` with six TDD steps.

### Observations

- **The record has no in-repo consumer.**
  A grep for `SubagentRecord` outside `service-adapter.ts` and its tests returns nothing — the widget reads live `Subagent` objects through `manager.listAgents()`.
  So this was a judgment about external consumers, not a response to local demand, and the no-vacant-hooks reading ("admit nothing without a named reader") was a serious candidate rather than a straw option.
- **A defect surfaced while reading for the policy.**
  `toSubagentRecord` assigns `lifetimeUsage` by reference to the object `SubagentState.addUsage()` mutates in place, so the "serializable snapshot" drifts under a consumer and lets a consumer write into a running agent's token totals.
  Defining "snapshot" as *by value* in the policy is what made the fix in-scope rather than a separate issue; the operator chose to land it here.
- **The contract direction decided the release marker, not the field list.**
  TypeScript structural typing means required additions break only *implementors*, so declaring the type producer-only makes this semver-minor.
  The roadmap anticipated exactly this (`"if its resolution is non-breaking, its plan may downgrade it to independently releasable and update this line"`), so the plan takes the downgrade and edits both the Step's `Release:` line and the `Release batches` bullet; Step 3 ([#829]) stays the batch tail.
- **Alternatives rejected at the gate:** the "mirror all serializable state" policy (would ship an unbounded `responseText` and internal `consumedAt`/`stoppedWhileQueued`), optional-forever additions (consumers null-checking fields the package always populates), and shipping the widening as breaking anyway.
  Also rejected in the plan: retyping `SubagentRecord.lifetimeUsage` as `Readonly<>` — once the value is copied, tightening a shipped public property type buys nothing and costs a breaking change.
- **Declining `activeTools`/`responseText` leaves external consumers with no live-activity path**, because no broadcast channel carries them either.
  The ADR records the revisit condition (a named consumer plus a channel for momentary state) rather than building the channel, and [#748]'s close comment should carry that reasoning back to its author.
- **Tidy-First assessment** found the production side already shaped for the change and one real friction: five accreted "strips" `it` blocks in `describe("toSubagentRecord")` re-assert overlapping subsets of the same properties, and roughly six new tests are about to join that block.
  Consolidation is Step 1 of the TDD Order.
  The assessor also independently confirmed the `lifetimeUsage` aliasing bug and all four admitted getters, and reported no contradiction with the design.

#### Deferred tidyings

- `packages/pi-subagents/test/service/service-adapter.test.ts` — a shared "expected record" builder for the two exact `toEqual` blocks was rejected: the two literals share structure but no values, so the builder would be the wrong abstraction.
- `packages/pi-subagents/src/service/service-adapter.ts` — collapsing the per-field `if (x !== undefined)` lines into a loop over an optional-field list was rejected: the explicitness *is* the allowlist's self-documentation.
- `packages/pi-subagents/test/helpers/make-subagent.ts` — an `outputFile` shorthand on `createTestSubagent` was rejected as feature-scoped rather than preparatory; the implementing step decides whether its tests want one.

[#748]: https://github.com/gotgenes/pi-packages/pull/748
[#829]: https://github.com/gotgenes/pi-packages/issues/829
