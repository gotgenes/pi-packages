---
issue: 903
issue_title: "pi-subagents: withheld updates outlive result collection and still claim completed children are running"
---

# Deliver each mid-run update once, on the channel that can reach the parent

## Release Recommendation

**Release:** ship independently

Adopted as Phase 22 Step 21 by operator decision, and that step carries `Release: independent` — it is a member of no release batch.
The behavior change is user-visible (a stale `<subagent-update>` stops arriving, and a completion nudge starts carrying the child's updates), so the `fix:` commit cuts a release on its own.

## Problem Statement

A background child's `notify_parent` updates can sit in `NotificationManager`'s withheld queue for the whole of a long parent run, survive a `get_subagent_result` collection of that same run's outcome, and then arrive together hours later still asserting:

> The agent is still running.
> Steer it with `steer_subagent("…", "…")` to redirect it, or let it continue.

The reporter observed nine such messages from three children arriving roughly four hours after they were written, prompting three `steer_subagent` calls that were all rejected because the children had completed.

Two independent defects produce this.

**The flush never re-checks.**
`sendUpdate` gates on `disposed` and `record.claimed` at enqueue time and parks the message in `pending`.
`onParentAgentSettled` walks that list and calls `emitUpdate` with no re-check at all.
Its sibling `emitIndividualNudge` re-reads `claimed` and `consumed` at emit time, which is why the completion nudge was correctly suppressed in the reporter's reproduction and the update was not.

**The update's trailing line is a frozen liveness claim.**
`formatUpdateNotification` always appends the steer affordance, and `SteerTool` refuses a non-running agent outright.
This is the shape [#878] fixed for the resume affordance: a carrier must not name a call the extension would refuse.
It is broader than the claim ordering the issue reports — a background child that sends an update and then completes **during the same parent run** produces a "still running" block immediately followed by its own completion nudge, with no `get_subagent_result` anywhere near it.

Underneath both sits a delivery gap.
`Subagent.announceUpdate` records an update onto `record.runUpdates` **only if `claimed` was already true when the message was produced**.
In the reported ordering the claim came second, so those nine messages lived on the announcement path and nowhere else — the report that collected the outcome could not have carried them.
Dropping a stale update therefore deletes content that exists in no other place, which the reporter explicitly asked us not to do by default.

## Goals

- Every update a child sends reaches the parent **exactly once**, through whichever channel can actually reach it.
- An update is announced as a `<subagent-update>` only while the child is still running, so the block's steer affordance is true by construction rather than by wording.
- An update produced for a run whose outcome a carrier delivers rides that carrier — the foreground return, the resume return, the `get_subagent_result` report, or the completion nudge.
- The completion nudge, today the one carrier that renders no updates, renders them.
- The published prose (README, `docs/configuration.md`, the package skill, the architecture module tree) states where an update actually lands.

This change is **not** breaking.
No config key, default, exported type, or `SubagentRecord` field changes; `runUpdates` is internal and appears on no public snapshot.
What changes is which channel carries a message the parent receives either way.

## Non-Goals

- **Delivering updates mid-run with `deliverAs: "steer"`.**
  Declined by operator decision, on the merits: a working parent that dispatched the children should be allowed to settle.
  Pi polls the steering queue every turn and the follow-up queue only where the run would otherwise end (measured below), so `steer` is the only mechanism that would arrive sooner and it interrupts the parent's task to do it.
  End-of-run delivery becomes the designed semantics, and `README.md`'s "rather than only at the end" is corrected in this plan rather than chased with a mechanism change.
- **Deleting the withheld-update queue.**
  Considered and rejected during the design gate: a child that is *still running* when the parent goes idle is exactly the case where an announcement is useful and its affordance is true, and dropping the queue would defer that message to the child's completion.
  What is deleted is the *unconditional* flush, which is the first defect itself.
- **Exposing `runUpdates` on the public `SubagentRecord` snapshot.**
  Nothing outside this package reads it, and [ADR 0005](../decisions/0005-subagent-record-admission-policy.md) withholds package-internal bookkeeping.
- **A `claimDelivery` service surface for external carriers** — that is [#897], unchanged here.
- **Changing the 2000-character cap on `notify_parent`**, or the `midRunUpdates` lever.
- **Reworking `sendCompletion`'s or `sendWorkspaceNotice`'s gates.**
  The liveness predicate introduced here is consulted by the update path only; [#870]'s post-result notice channel is deliberately ungated and stays that way.

## Background

Relevant modules, as of `af980a23`:

| Module                                | Role in this change                                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/lifecycle/subagent-state.ts`     | Owns `_runUpdates`, `recordUpdate()`, and the per-run clears in `markRunning()` / `resetForResume()`                       |
| `src/lifecycle/subagent.ts`           | `announceUpdate()` routes a child's message; `runUpdates` delegates to the state                                           |
| `src/observation/notification.ts`     | `sendUpdate`, the withheld queue, `onParentAgentSettled`'s flush, `emitUpdate`, `emitIndividualNudge`, `buildPointerLines` |
| `src/observation/outcome-delivery.ts` | `renderRunUpdates` and the `renderOutcomeAddenda` tail the three non-nudge carriers compose                                |
| `src/tools/get-result-tool.ts`        | `buildReport()` supplies `runUpdates: record.runUpdates`                                                                   |

### What Pi does with a withheld message

Measured against the pinned `@earendil-works/pi-coding-agent@0.84.4` bundle (`dist/bundle/chunks/chunk-OMWWHBTG.js`), not only the tracking checkout:

```js
if (await config.shouldStopAfterTurn?.(lastCompletedTurn)) { await emit({type:"agent_end"}); return }
pendingMessages = await config.getSteeringMessages?.() || []
}                                               // ← tool loop ends here
let followUpMessages = await config.getFollowUpMessages?.() || [];
if (followUpMessages.length > 0) { pendingMessages = followUpMessages; continue; }
```

Steering is polled every turn; follow-ups are polled only where the run would otherwise end.
`NotificationManager` sends with `deliverAs: "followUp"`, so deleting the extension's withhold would move delivery from "just after `agent_settled`" to "at the run-end boundary just before it" — the same wall-clock moment.
**The withhold is not what makes updates late**, and it is the only place a stale message can still be re-checked before it goes out.
That is why every part of this design keeps it.

### Constraints from `AGENTS.md`

Architecture-doc module-tree entries describe current behavior and cite an issue only when the ref encodes an active constraint, so the `notification.ts` and `subagent-state.ts` entries are rewritten to the new behavior with no `#903` ref.

A landed plan is a historical artifact: `docs/plans/0872-claim-based-mid-run-update-routing.md` is not rewritten.
It gains one sentence recording that this issue superseded its claim-gated recording, exactly as [#872] did for [#858]'s "Who gets which tool" table.

The [#872] retro records that `pnpm fallow dead-code` rejected `Subagent.runUpdates` as an unused class member when it landed a step ahead of its first reader.
The same hazard applies to the new `markUpdateAnnounced`, which is why the TDD Order lands it with its caller.

## Design Overview

### The latch

`_runUpdates` stops being a list of strings and becomes a list of entries that remember whether an announcement delivered them:

```typescript
/** One update a child sent during this run, and whether an announcement delivered it. */
interface RunUpdate {
	message: string;
	announced: boolean;
}
```

```typescript
private _runUpdates: RunUpdate[] = [];

/**
 * The updates this run produced that no announcement delivered — what an
 * outcome carrier must render.
 */
get runUpdates(): readonly string[] {
	return this._runUpdates.filter((update) => !update.announced).map((update) => update.message);
}

recordUpdate(message: string): void {
	this._runUpdates.push({ message, announced: false });
}

/** The announcement channel delivered this message; no carrier may repeat it. */
markUpdateAnnounced(message: string): void {
	const entry = this._runUpdates.find((update) => !update.announced && update.message === message);
	if (entry) entry.announced = true;
}
```

The getter keeps its `readonly string[]` type, so the four carriers that satisfy `OutcomeAddenda` and `AgentReport` structurally need no edit.
The clears in `markRunning()` and `resetForResume()` are unchanged in intent — the ledger belongs to one run.
It stays out of `SubagentStateInit` for the reason `_claimed` is: a rehydrated record has no run to have produced it.

### The routing

`Subagent` records every update, whoever ends up delivering it:

```typescript
private announceUpdate(message: string): void {
	this.state.recordUpdate(message);
	this.execution.observer?.onUpdateSent?.(this, message);
}
```

The claim condition [#872] put here moves to where announcements are decided, which is where it belonged — `Subagent` decided a delivery question it could not see the answer to.
The lifecycle event still fires unconditionally, unchanged.

`NotificationManager` owns one predicate, consulted at enqueue **and** at emit:

```typescript
/**
 * Whether an announcement is still the right channel for this run's updates.
 * A claimed outcome is one a blocked carrier delivers itself; a terminated
 * run's updates ride its outcome.
 */
private canAnnounceUpdate(record: Subagent): boolean {
	return !record.claimed && record.isActive();
}

sendUpdate(record: Subagent, message: string): void {
	if (this.disposed) return;
	if (!this.canAnnounceUpdate(record)) return;
	if (this.parentRunActive) {
		this.pending.push({ kind: "update", record, message });
		return;
	}
	this.emitUpdate(record, message);
}

private emitUpdate(record: Subagent, message: string): void {
	// Re-read at emit, as emitIndividualNudge does: the flush is a fresh check,
	// not a replay of the one taken when the message was parked.
	if (!this.canAnnounceUpdate(record)) return;
	record.markUpdateAnnounced(message);
	// …unchanged sendMessage
}
```

An update the flush declines stays unannounced in the ledger, so the run's outcome carrier renders it.
`formatUpdateNotification`'s "still running / steer" line is left **unchanged**: the guard immediately above it is what makes the sentence true, and duplicating the invariant in the wording would give it two homes.

### The fourth carrier

The completion nudge is the only outcome carrier that renders no updates today — `emitIndividualNudge` composes `formatTaskNotification` plus `buildPointerLines`, which calls `renderWorkspaceNotice` and `renderQuestionAffordance` but not `renderRunUpdates`.
[#872] left this open explicitly (*"Does a completion nudge want to summarize the updates that preceded it?*
*Not until a case is observed."*); this issue is that case, and without it a child whose parent never pulls would lose its messages.

```typescript
private buildPointerLines(record: Subagent): string {
	const outputFile = record.outputFile;
	const transcriptLine = outputFile ? `\nFull transcript available at: ${outputFile}` : "";
	return (
		// What the agent flagged along the way, then where the work went, then
		// the pointers — the order renderOutcomeAddenda already uses.
		renderRunUpdates(record.runUpdates) +
		renderWorkspaceNotice(record.workspaceNotice) +
		`${transcriptLine}\nCall get_subagent_result("${record.id}") to collect the full result.` +
		renderQuestionAffordance(record.id, record.pendingQuestion, record.resumeRefusal)
	);
}
```

A never-started agent short-circuits before `buildPointerLines`, so it is unaffected.

### The resulting delivery model

| Situation                                      | Where the message lands                                | When            |
| ---------------------------------------------- | ------------------------------------------------------ | --------------- |
| parent idle, child running                     | the `<subagent-update>` announcement, marked announced | at once         |
| parent busy, child terminates before settle    | the completion nudge's updates tail                    | at settle       |
| parent busy, outcome pulled with `wait`        | the `get_subagent_result` report's tail                | with the result |
| foreground or resume carrier holds the outcome | that carrier's return ([#872], unchanged)              | with the result |
| parent busy, child still running at settle     | the announcement, whose affordance is true             | at settle       |

Every row delivers once.
The reported incident is row 3: the nine messages ride the three reports that collected the outcomes, hours earlier than they arrive today, and nothing is announced at settle.

### Why a repeat pull may render fewer updates

Once the announcement channel has delivered a message, the carriers stop rendering it, so a second `get_subagent_result` on the same record can show fewer updates than the first.

[#872] argued the report should be idempotent.
That claim is sound about the **result** — `renderOutcomeBody` returns the same text on every call — and it survives untouched.
The **addenda tail** was never byte-stable: `resumeRefusal` is a live getter (`subagent.ts:219`), so two pulls separated by the retention sweep already render different affordance sentences, and `workspaceNotice` can arrive between two pulls.
The tail re-renders from current state rather than replaying a fixed transcript, and under the latch `runUpdates` behaves the same way — the state simply now includes "already delivered elsewhere".
[#872]'s actual objection was to a report *silently* different from the first; a message the parent read in the same conversation is not silent.

### Edge cases

- **An abandoned wait.**
  `GetResultTool` calls `record.release()` and returns the report anyway, which renders the undelivered updates.
  Nothing is stranded, and the released claim reopens the announcement channel for later messages exactly as it does today.
- **A pull without `wait` on a running child.**
  The report renders the undelivered updates without consuming, and the announcement channel does not mark them — so a later announcement could repeat one.
  It cannot: the update is only announced while the child is still running, and any update the report rendered is still in the ledger, so the duplicate window is one report on a live child followed by a flush on that same live child.
  This is the one ordering where a message can be shown twice, and it is bounded to a live child the parent is actively polling.
- **A resume.**
  `resetForResume` clears the ledger; the claim deliberately survives, so a claimed resume's stale queue entry is declined by `canAnnounceUpdate` and a service-initiated unclaimed resume ([#885], unshipped) would announce a previous run's message once.
  `markUpdateAnnounced` finds no entry and no-ops, which is correct — the ledger it belonged to is gone.
- **Disposal.**
  `dispose()` clears `pending` and silences the manager; undelivered ledger entries go with the session, as they do today.
- **`midRunUpdates: false`.**
  The child never gets the tool, so no path here is reached.

## Module-Level Changes

| File                                    | Change                                                                                                                                                                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lifecycle/subagent-state.ts`       | `_runUpdates` becomes `RunUpdate[]`; `runUpdates` filters to unannounced messages; `recordUpdate` pushes an unannounced entry; new `markUpdateAnnounced`                                                                                     |
| `src/lifecycle/subagent.ts`             | `announceUpdate` drops its `if (this.claimed)` condition and records unconditionally; new public delegating `markUpdateAnnounced`; the method comment is rewritten from claim-routing to ledger-plus-latch                                   |
| `src/observation/notification.ts`       | New private `canAnnounceUpdate`; `sendUpdate` consults it; `emitUpdate` re-checks it and marks the message announced; `buildPointerLines` gains a leading `renderRunUpdates`; the class comment and `sendUpdate`'s doc comment are rewritten |
| `test/observation/notification.test.ts` | Fixture status tidy (step 1), plus the delivery-matrix tests and the rewritten consumption test                                                                                                                                              |
| `test/lifecycle/subagent-state.test.ts` | Ledger, latch, filtering, and per-run clear coverage                                                                                                                                                                                         |
| `test/lifecycle/subagent.test.ts`       | `"holds nothing back when no carrier has claimed the outcome"` now expects the message present                                                                                                                                               |

Predicted **unchanged**, verified by the Tidy-First assessment reading each file: `src/tools/get-result-tool.ts`, `src/tools/get-result-report.ts`, `src/tools/foreground-runner.ts`, `src/tools/agent-tool.ts`, and `src/observation/outcome-delivery.ts`.
The claim they rest on is that all five consume `runUpdates` structurally as `readonly string[]`, which the filtered getter's return type preserves.
`test/helpers/make-subagent.ts` is unchanged for the same reason — it seeds through `state.recordUpdate(update)`, which still takes a string.

Documentation touch points, found by grepping `notify_parent`, `runUpdates`, `Updates this agent sent`, and "arrives as its own message" across `packages/pi-subagents/`, `README.md`, and `.pi/skills/`:

| File                                                                   | Stale text                                                                                                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md` (Features list)                                            | "so you hear about a course change rather than only at the end" — false for a busy parent, and now false by design                                                                    |
| `docs/configuration.md` (§ Tool selection)                             | "Otherwise it arrives as its own message while the agent keeps working" — true only while the agent is still running                                                                  |
| `.pi/skills/package-pi-subagents/SKILL.md`                             | "An update is routed by `record.claimed` … an unclaimed run's update is announced as it happens"                                                                                      |
| `docs/architecture/architecture.md` (module tree, `notification.ts`)   | "both gated on the carrier claim … flushed on `agent_settled`"                                                                                                                        |
| `docs/architecture/architecture.md` (module tree, `subagent-state.ts`) | The value-object summary, which gains the per-run update ledger                                                                                                                       |
| `docs/architecture/architecture.md` (Phase 22)                         | A new Step 21 entry, its `#### Open-issue sweep dispositions` line, its Mermaid node downstream of Step 14, its Track D line, and the `Release batches` independently-releasable list |
| `docs/plans/0872-claim-based-mid-run-update-routing.md`                | One sentence recording that #903 superseded the claim-gated recording; the plan body stays as the historical record                                                                   |

## Test Impact Analysis

**New tests the change enables.**
The latch is state-level, so `markUpdateAnnounced`'s first-match behavior, the getter's filtering, and the per-run clears become directly unit-testable in `subagent-state.test.ts` — today `runUpdates` has no state worth testing beyond append order.
`notification.test.ts`'s existing `makePiParent()` harness already models Pi's delivery paths, so the full delivery matrix above becomes assertable end to end against a real `Subagent` rather than through one carrier at a time.

**Tests that change meaning.**
`notification.test.ts`'s *"is announced even after the parent collected an earlier outcome"* pins [#858]'s rule that consumption gates a completion but not an update.
Its premise is narrowed rather than refuted: consumption still does not gate an update, but a consumed record is terminal, and a terminated run's updates ride the outcome.
It is rewritten to assert the message still reaches the parent — through the report — rather than through an announcement.

`subagent.test.ts`'s *"holds nothing back when no carrier has claimed the outcome"* asserts `agent.runUpdates` is `[]` after an unclaimed `notifyParent` call.
Under the unconditional ledger that assertion inverts: the message is present, because the stubbed observer in that test never announces it.
Flagged here so it does not surface as an unexplained red.

**Tests that stay as-is.**
`subagent.test.ts`'s claim-held-update test, its observer-fires-either-way test, and its `midRunUpdates: false` test; `notify-parent-tool.test.ts`'s cap and result text; `notification.test.ts`'s three `sendWorkspaceNotice` gate tests; `get-result-report.test.ts`'s body-selection suite.

**The delivery matrix is the surface to cover**, one test per row, plus the two orderings the issue reports: update-then-`wait`-collection-then-settle, and update-then-completion-then-settle.

## Invariants at risk

Step 14 ([#872]) documented three outcomes this change must not regress:

- **An update sent while a carrier holds the outcome is rendered by that carrier, not announced** — pinned by `subagent.test.ts`'s *"holds an update for the carrier that claimed the run's outcome"* and `notification.test.ts`'s *"is left to the carrier that holds the outcome, which is blocked meanwhile"*.
  Both survive: `canAnnounceUpdate` keeps `!record.claimed` as its first conjunct, and the ledger now records for every run rather than only a claimed one, which strictly widens what the carrier can render.
- **The `subagents:update` lifecycle event fires whichever channel delivers** — pinned by *"tells the observer either way, because the update is a fact about the run"*.
  `announceUpdate` still calls the observer unconditionally; the only line removed is the recording condition.
- **`midRunUpdates` is the operator's lever** — pinned by *"withholds the channel when the operator turned mid-run updates off"*, untouched.

Step 11 ([#858]) documented the 2000-character cap, applied in the tool before either path sees the message, and untouched here.

Step 12 ([#870]) established that a post-result workspace notice is announced on its own and is not withheld for the parent's run.
`canAnnounceUpdate` is consulted by `sendUpdate` and `emitUpdate` only; `sendWorkspaceNotice` and `sendCompletion` keep their own gates, and `notification.test.ts` covers all three, so a slip that applied the predicate to the wrong method goes red there.

Step 15 ([#878]) made `resumeRefusal` required on `OutcomeAddenda` and `AgentReport` so a carrier that forgets it fails to compile.
`buildPointerLines` already passes it to `renderQuestionAffordance` and keeps doing so; the new `renderRunUpdates` call is prepended, not substituted.

The constituency each invariant serves is the parent model receiving a child's message, and every row of the delivery table still serves it — what changes is the channel, never whether the message arrives.

No quantitative invariant (prefix bytes, token budget, cache characteristics) is in scope: the nudge grows an updates section only for a child that actually sent one, and every other carrier's output is unchanged for a child that did not.

## TDD Order

1. **`test(pi-subagents): pin the mid-run-update fixtures to a running child`** Prepares step 3: `describe("a running child's mid-run update")` drives every `sendUpdate` assertion through `createTestSubagent({ id: "live-1" })`, whose default status is `"completed"`.
   Once `sendUpdate` gains its liveness guard those tests go red for a reason unrelated to the claim, release, consumption, and ordering conditions each one isolates.
   Add `status: "running"` to the seven fixtures the Tidy-First assessment enumerated; the dispose test is unaffected because `disposed` short-circuits first.
   Adds no assertion and stays green under today's code — that is the point of landing it separately.
   *Killing mutation:* none by construction; the mutation that proves it was needed is reverting one fixture to the default status **after** step 3, which turns that step's liveness test red.

2. **`refactor(pi-subagents): latch each run update to the channel that delivered it`** `SubagentState` gains the `RunUpdate` entry shape, the filtered `runUpdates` getter, and `markUpdateAnnounced`; `Subagent` gains the public delegating `markUpdateAnnounced`; `NotificationManager.emitUpdate` calls it.
   Nothing observable changes: `announceUpdate` is still claim-gated here, and a claimed record never reaches `emitUpdate`, so the mark is a no-op on every path — hence `refactor:` by the observable-outcome rule.
   The manager's call site lands in this commit rather than the next because `pnpm fallow dead-code` rejected [#872]'s `runUpdates` getter for arriving a step ahead of its first reader.
   Tests in `test/lifecycle/subagent-state.test.ts`: records in order; the getter omits an announced entry; `markUpdateAnnounced` marks the first unannounced match and leaves a later duplicate alone; an unknown message is a no-op; the ledger clears at a fresh run and at a resume.
   *Killing mutations:* (a) make `markUpdateAnnounced` mark every match — the duplicate-message test goes red; (b) drop the `!update.announced` filter from the getter — the omission test goes red; (c) drop the clear from `resetForResume` — the resume test goes red.

3. **`fix(pi-subagents): deliver each mid-run update once, on the channel that can reach the parent`** The observable change, in one commit because its parts are one behavior: `announceUpdate` records unconditionally; `canAnnounceUpdate` is added and consulted by both `sendUpdate` and `emitUpdate`; `buildPointerLines` renders the run's undelivered updates.
   `subagent.test.ts`'s *"holds nothing back when no carrier has claimed the outcome"* is inverted in this commit.
   Tests, one per delivery-matrix row plus the two reported orderings: an update withheld, then a `wait: true` collection, then settle — the report carries it and nothing is announced; an update withheld, then the child completes, then settle — the nudge carries it and no `<subagent-update>` is sent; a child still running at settle — announced, and absent from a later report; a parent idle with a running child — announced at once, and absent from a later report; a claimed run — carrier renders, nothing announced.
   *Killing mutations:* (a) restore `if (this.claimed)` in `announceUpdate` — the `wait: true` ordering test goes red with an empty report tail; (b) drop `record.isActive()` from `canAnnounceUpdate` — both reported-ordering tests go red on an announced `<subagent-update>` for a terminated child; (c) remove the `canAnnounceUpdate` call from `emitUpdate` while leaving it in `sendUpdate` — the two ordering tests go red and the enqueue-time tests stay green, which is the pair proving the flush re-checks rather than replays; (d) drop `record.markUpdateAnnounced(message)` from `emitUpdate` — the two "absent from a later report" tests go red; (e) drop `renderRunUpdates` from `buildPointerLines` — the completion-nudge test goes red.

4. **`docs(pi-subagents): state where a mid-run update lands`** Every row of the documentation table in Module-Level Changes, including the new Phase 22 Step 21 entry with its `✅` mark, `Landed:` note, Mermaid node downstream of Step 14, Track D line, sweep-disposition line, and `Release batches` entry — the step does not exist yet, so it is created complete rather than added unmarked and marked later.
   *Verification:* `grep -rn 'only at the end\|arrives as its own message' packages/pi-subagents/README.md packages/pi-subagents/docs/configuration.md` returns nothing, `grep -n 'announced as it happens' .pi/skills/package-pi-subagents/SKILL.md` returns nothing, and `pnpm exec rumdl check` passes on every edited file.

## Risks and Mitigations

| Risk                                                                                                                                                     | Mitigation                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`fallow dead-code` rejects `markUpdateAnnounced`** as an unused class member, the way it rejected [#872]'s `runUpdates` getter                         | Step 2 lands the state method, the `Subagent` delegate, and the `NotificationManager` call site in one commit, and runs `pnpm fallow dead-code --workspace @gotgenes/pi-subagents` before moving on                                                               |
| **A message shown twice** after a non-waiting pull on a live child, then a flush announcing it                                                           | Enumerated in Design Overview § Edge cases and bounded to a child the parent is actively polling while it runs. The alternative — marking on render — would make the carriers non-idempotent for a case that has not been observed                                |
| **A repeat pull renders fewer updates than the first**                                                                                                   | Intended, and grounded: the addenda tail already varies between pulls (`resumeRefusal` is a live getter, `workspaceNotice` can arrive later), while the result body does not. Recorded as an amendment to [#872]'s idempotence note rather than a silent reversal |
| **The announced message is still composed one boundary before the parent reads it**, so a child terminating in that window leaves a "still running" line | Accepted residual, unavoidable for any announcement and bounded to one run-end boundary, against today's unbounded window. The guard is what makes the sentence true at emit; nothing can make it true at read                                                    |
| **The liveness guard silences an update the parent would have received**                                                                                 | It cannot: every terminated-run path has a carrier, and step 3's matrix tests cover all five. The completion nudge change is the row that would otherwise be uncovered, which is why it is in the same commit                                                     |
| **A previous run's withheld update announced after an unclaimed resume**                                                                                 | Bounded to one message, and unreachable today: `SubagentManager.resume` has one caller and it claims. Noted so [#885] does not inherit it silently                                                                                                                |

## Open Questions

- **Should a disposed manager's undelivered ledger entries reach anywhere?**
  Not until a case is observed: disposal is session shutdown, and every carrier is gone with it.
- **Should the announcement channel ever mark on a carrier's render rather than its own emit?**
  Deferred; it would trade the narrow double-render edge above for a non-idempotent report, which is the larger regression.

[#858]: https://github.com/gotgenes/pi-packages/issues/858
[#870]: https://github.com/gotgenes/pi-packages/issues/870
[#872]: https://github.com/gotgenes/pi-packages/issues/872
[#878]: https://github.com/gotgenes/pi-packages/issues/878
[#885]: https://github.com/gotgenes/pi-packages/issues/885
[#897]: https://github.com/gotgenes/pi-packages/issues/897
