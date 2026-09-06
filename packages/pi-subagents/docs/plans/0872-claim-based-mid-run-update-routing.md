---
issue: 872
issue_title: "pi-subagents: notify_parent's background-only gate does not hold for a resumed run"
---

# Route a mid-run update by who holds the outcome, not by spawn mode

## Release Recommendation

**Release:** ship independently

Phase 22 Step 14 carries `Release: independent`, and it is a member of no release batch.
The behavior change is user-visible (`notify_parent` reaches every child, and a blocked carrier renders the updates into its own return), so the `fix:` commit cuts a release on its own.

## Problem Statement

`notify_parent` is given only to a background child, decided once at spawn from `Subagent.isBackground` and consulted only inside `run()`.
A resume reuses the same session, so the tool installed at creation is still there and nothing recomputes the gate — while `AgentTool` awaits `manager.resume(...)` inside the parent's own tool call, which is the blockage the gate was written to refuse.

Investigating the fix found the gate is wrong in a second way the issue does not name.
`GetResultTool` blocks the parent identically when called with `wait: true`, on a background child's **initial** run, with no resume involved:

```typescript
const waited = params.wait === true;
if (waited) {
  record.claim();
  await record.waitUntilSettled(signal);
}
```

So there are three windows in which an update cannot reach the parent in time, and spawn mode expresses only one of them.
What all three have in common is already tracked on the record: `claimed` — "a carrier has committed to delivering this outcome" — set at every blocking front door (`SubagentManager.spawnAndWait`, `AgentTool`'s resume branch, `GetResultTool`'s wait) and revocable when a carrier abandons its commitment.

The cost in each window is not a lost message.
`NotificationManager` withholds the announcement while the parent's run is active and flushes it at `agent_settled` as a `followUp` with `triggerTurn: true`, so the update arrives **after** the carrier already delivered the result, and costs the parent an extra turn to read what it largely already has.

## Goals

- `notify_parent` reaches every child on every run, gated only on the `midRunUpdates` setting.
- An update sent while a blocking carrier holds the run's outcome is rendered into that carrier's own return, so it arrives with the result rather than after it.
- An update sent when nothing has claimed the outcome keeps today's nudge path unchanged.
- The `subagents:update` lifecycle event fires in both cases — which carrier delivers an update is an announcement decision, not a fact about the run.
- The stated rationale in the module comment, `docs/configuration.md`, the README, the package skill, and the architecture doc matches the shipped behavior on every path a child can run.

This change is **not** breaking.
It adds a tool to foreground children (additive capability), adds text to three carrier results, and changes no config key, default, or exported type.
The `SubagentRecord` public snapshot is untouched.

## Non-Goals

- **Exposing `resume` on `SubagentsService`** — filed as [#885] and adopted as Phase 22 Step 16 by operator decision.
  This plan's predicate is chosen so that a non-blocking front door needs no rework: a caller that will not carry the result simply does not claim.
- **Relocating `AgentTool`'s four resume refusals into `SubagentManager`** — that is [#885]'s substantial half, not this fix.
- **Emitting `subagents:resumed` at resume start** — [#832], unchanged here.
- **Changing the 2000-character cap or its rationale.**
  The cap exists because a nudge is the message's only carrier; that remains true of every update that takes the nudge path, and the buffered path inherits the same cap for uniformity.
- **Varying the tool's result text by delivery path.**
  Its "the delegating agent may steer you if it wants to redirect" is already conditional, and the claim can flip mid-run (a parent may call `get_subagent_result(wait: true)` at any moment), so no static text the child sees can be more precise than "may".
- **Reworking `renderOutcomeBody` or `renderReportBody`.**
  The preparatory extraction below takes the addenda **tail** only; body selection stays as it is, with its own test suite.

## Background

Relevant modules, as of `1efdc9b5`:

| Module                                                  | Role in this change                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/lifecycle/subagent.ts`                             | `canSendUpdates()` (the gate) and the `notifyParent` callback it guards, at the `createSubagentSession` call |
| `src/lifecycle/subagent-state.ts`                       | The lifecycle value object; owns `_pendingQuestion`, `_workspaceNotice`, and the revocable `_claimed`        |
| `src/observation/notification.ts`                       | `sendCompletion` already returns early on `record.claimed`; `sendUpdate` deliberately does not               |
| `src/observation/outcome-delivery.ts`                   | The shared pure renderers every carrier composes                                                             |
| `src/tools/foreground-runner.ts`                        | Carrier 1 — the foreground tool return                                                                       |
| `src/tools/agent-tool.ts`                               | Carrier 2 — the resume tool return; also the sole caller of `manager.resume`                                 |
| `src/tools/get-result-tool.ts` / `get-result-report.ts` | Carrier 3 — the pull report; `buildReport` assembles `AgentReport`                                           |
| `src/session/notify-parent-tool.ts`                     | The tool definition; its module comment states the background-only rationale                                 |

Two constraints from `AGENTS.md` apply.

Architecture-doc module-tree entries describe **current behavior**, and cite an issue only when the ref encodes an active constraint — so the `notification.ts` and `outcome-delivery.ts` entries are rewritten to the new behavior with no `#872` ref.

A landed plan is a historical artifact.
`docs/plans/0858-child-to-parent-tool-channel.md`'s "Who gets which tool" table is not rewritten; it gains one sentence recording that #872 superseded it, so the record of what Step 11 decided stays readable.

`SubagentManager.resume` has exactly one caller today (`src/tools/agent-tool.ts`), and `SubagentsService` exposes no resume — which is why "a resume is running" currently implies "the parent is blocked."
This plan does not depend on that implication; [#885] removes it.

## Design Overview

### The predicate

`record.claimed` replaces `isBackground` as the thing the update channel consults.
It is not a new concept: it is the same fact `NotificationManager.sendCompletion` already consults, applied to the announcement it currently skips.

The substitution **subsumes** the old gate rather than replacing it.
A foreground initial run is claimed by `spawnAndWait` before the run starts and stays claimed for its whole duration, so today's foreground exclusion falls out as a consequence instead of being a rule:

| Front door                                    | Claims?                | Where an update goes       |
| --------------------------------------------- | ---------------------- | -------------------------- |
| `spawnAndWait` (foreground `subagent`)        | yes, before the run    | the foreground tool return |
| `AgentTool` resume                            | yes, before the resume | the resume tool return     |
| `GetResultTool` with `wait: true`             | yes, for the wait      | the pull report            |
| background spawn, nobody waiting              | no                     | the nudge, as today        |
| a future non-blocking service resume ([#885]) | no, by choice          | the nudge                  |

### Routing

`Subagent` decides once, at the child's callback:

```typescript
private announceUpdate(message: string): void {
  if (this.claimed) this.state.recordUpdate(message);
  this.execution.observer?.onUpdateSent?.(this, message);
}
```

The observer is told either way.
This follows the rule `SubagentManager` already states at its `onRunFinished` wiring — suppressing the observer would also suppress the lifecycle event and the session-history record, "which are facts about the run rather than announcements."
The **announcement** decision stays where announcements are decided:

```typescript
sendUpdate(record: Subagent, message: string): void {
  if (this.disposed) return;
  if (record.claimed) return;   // the carrier holding the outcome renders it
  if (this.parentRunActive) { this.pending.push({ kind: "update", record, message }); return; }
  this.emitUpdate(record, message);
}
```

Reading `claimed` at both layers is not a race: `announceUpdate` → `observer.onUpdateSent` → `CompositeSubagentObserver` → `SubagentEventsObserver.onSubagentUpdate` → `notifications.sendUpdate` is one synchronous call chain from a single tool execution, so the value cannot change between the two reads.

### Storage: an outcome fact, not a queue

The buffer is **not drained** by the carrier that renders it.
It is cleared at the start of each run (`markRunning`) and each resume (`resetForResume`), exactly like `_pendingQuestion`, and every carrier renders it from the record for as long as that run's outcome stands.

This is the same treatment `pendingQuestion` and `workspaceNotice` already get, and it makes a second `get_subagent_result` call idempotent: it re-renders the result, so it must re-render the updates that accompanied it.
A drain would make the second report silently different from the first.

```typescript
// subagent-state.ts — beside _pendingQuestion and _workspaceNotice
private _runUpdates: string[] = [];
get runUpdates(): readonly string[] { return this._runUpdates; }

recordUpdate(message: string): void { this._runUpdates.push(message); }
```

Not seedable through `SubagentStateInit`, for the reason `_claimed` is not: it is transient runtime state, and a rehydrated record has no run to have produced it.

### Rendering: one addenda tail, three carriers

All three carriers already end with the identical two-call sequence, in the same order, on shapes that both satisfy the same structural type:

```typescript
renderOutcomeBody(record) +
  renderWorkspaceNotice(record.workspaceNotice) +
  renderQuestionAffordance(record.id, record.pendingQuestion)
```

The Tidy-First assessment recommends consolidating that tail **before** inserting a third element into it, which turns three order-sensitive multi-line edits into one function body:

```typescript
/** What every outcome carrier appends after the body — the fields, not the record. */
export interface OutcomeAddenda {
	id: string;
	runUpdates?: readonly string[];
	workspaceNotice?: string;
	pendingQuestion?: string;
}

export function renderOutcomeAddenda(outcome: OutcomeAddenda): string {
	return (
		renderRunUpdates(outcome.runUpdates) +
		renderWorkspaceNotice(outcome.workspaceNotice) +
		renderQuestionAffordance(outcome.id, outcome.pendingQuestion)
	);
}
```

`Subagent` and `AgentReport` both satisfy `OutcomeAddenda` structurally once `runUpdates` is added, exactly as they already satisfy `OutcomeBody` — so the feature step adds one field and one call **inside** the helper, and edits no call site.

Order within the tail: updates, then where the work went, then the call to action.
That extends the existing comment at `formatAgentReport` ("Where the work went, before the call to action that follows it") rather than contradicting it — what the child flagged along the way precedes the artifact pointer, which precedes the affordance.

```typescript
export function renderRunUpdates(updates: readonly string[] | undefined): string {
	if (!updates?.length) return "";
	const quoted = updates
		.map((update) => update.split("\n").map((line) => `  ${line}`).join("\n"))
		.join("\n\n");
	return `\n\nUpdates this agent sent while it worked:\n\n${quoted}`;
}
```

The two-space indent matches `renderQuestionAffordance`'s treatment of quoted child text.

### The gate that remains

```typescript
private canSendUpdates(runConfig: RunConfig | undefined): boolean {
  return runConfig?.midRunUpdates ?? true;
}
```

`midRunUpdates: false` still withholds the tool from the child entirely, which is unchanged operator-facing semantics — it now withholds from foreground children too, which never had the tool anyway.

### Edge cases

- **An abandoned wait.**
  `GetResultTool` calls `record.release()` when the wait was interrupted, then returns the report anyway — and the report renders `runUpdates`.
  So a released claim strands nothing, and no flush-on-release path is needed.
- **A completion nudge after a released claim.**
  The updates were already delivered by the report that released the claim, and the nudge carries the outcome, not the updates.
  No duplication.
- **A spawn that throws.** `spawnAndWait` can throw only from `resolveSpawn`/`create`, before the child exists, so there is no run to have produced updates.
- **A run that errors.** `renderOutcomeBody` returns only `Error: …`, so the updates are the one place the child's mid-run findings survive — a gain over today, where a foreground child cannot report them at all.

## Module-Level Changes

| File                                  | Change                                                                                                                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lifecycle/subagent-state.ts`     | Add `_runUpdates`, its getter, and `recordUpdate()`; clear it in `markRunning()` and `resetForResume()`. Not added to `SubagentStateInit`                                                 |
| `src/lifecycle/subagent.ts`           | `canSendUpdates()` drops the `isBackground` conjunct and its comment is rewritten; `notifyParent` routes through a new private `announceUpdate()`; add the delegating `runUpdates` getter |
| `src/observation/notification.ts`     | `sendUpdate()` gains the `record.claimed` early return; the class-level comment that says updates deliberately do not consult the claim is rewritten                                      |
| `src/observation/outcome-delivery.ts` | New `OutcomeAddenda` interface, `renderOutcomeAddenda()`, and `renderRunUpdates()`; module comment gains the addenda tail                                                                 |
| `src/tools/foreground-runner.ts`      | Its two-call tail becomes `renderOutcomeAddenda(record)`                                                                                                                                  |
| `src/tools/agent-tool.ts`             | The resume branch's two-call tail becomes `renderOutcomeAddenda(record)`                                                                                                                  |
| `src/tools/get-result-report.ts`      | `AgentReport` gains `runUpdates?: readonly string[]`; `formatAgentReport` calls `renderOutcomeAddenda(report)`                                                                            |
| `src/tools/get-result-tool.ts`        | `buildReport()` supplies `runUpdates: record.runUpdates`                                                                                                                                  |
| `src/session/notify-parent-tool.ts`   | Module comment only: the "Supplied only to a background child" paragraph is replaced by the claim-based rationale                                                                         |

Neither tool's narrow manager interface needs widening: `AgentToolManager` and `GetResultToolManager` both type `getRecord` as the real `Subagent`, so the new getter is visible without an interface edit.

Documentation touch points, found by grepping `notify_parent`, `midRunUpdates`, and "background" across `packages/pi-subagents/docs/`, `README.md`, and `.pi/skills/`:

| File                                                                     | Stale text                                                                                                                                              |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/configuration.md` (§ Tool selection)                               | "`notify_parent` is given only to a background agent — a foreground parent is blocked awaiting its child…"                                              |
| `docs/configuration.md` (§ Persistent settings)                          | "Set `midRunUpdates` to `false` to withhold `notify_parent` from background agents"                                                                     |
| `README.md` (Features list)                                              | "a **background** agent that finds something material calls `notify_parent`"                                                                            |
| `.pi/skills/package-pi-subagents/SKILL.md`                               | "`notify_parent` (one-way mid-run update; background children only, gated on the `midRunUpdates` setting)"                                              |
| `docs/architecture/architecture.md` (module tree, `notification.ts`)     | "completions gated on the carrier claim, updates not"                                                                                                   |
| `docs/architecture/architecture.md` (module tree, `outcome-delivery.ts`) | The renderer list, which gains the addenda tail                                                                                                         |
| `docs/architecture/architecture.md` (Step 11 landed note)                | "`notify_parent` is background-only — a foreground parent is blocked inside its own `subagent` call…"                                                   |
| `docs/architecture/architecture.md` (Step 14)                            | The `✅` heading mark, the Mermaid node, and a `Landed:` note                                                                                           |
| `docs/plans/0858-child-to-parent-tool-channel.md`                        | One sentence under the "Who gets which tool" table recording that #872 superseded the foreground row; the table itself is left as the historical record |

## Test Impact Analysis

**New tests the change enables.**
`renderOutcomeAddenda` is a pure function over a small structural type, so the addenda **order** — updates, notice, affordance — becomes directly testable for the first time; today it is asserted only incidentally, through three carriers' full output strings.
`renderRunUpdates` gets its own unit tests for the empty, single, and multi-line cases.

**Tests that change meaning.**
`test/lifecycle/subagent.test.ts`'s `describe("Subagent — the mid-run update channel")` block has a test named "withholds the channel from a foreground child, whose update could not arrive in time" — its premise is what this change refutes.
It is rewritten, not deleted: the channel is now supplied to a foreground child, and the assertion moves to where the update lands.
The `midRunUpdates: false` test is unaffected and stays as the setting's pin.

**Tests that stay as-is.**
`test/tools/get-result-report.test.ts`'s `renderReportBody` suite exercises body selection, which this change does not touch.
`test/session/notify-parent-tool.test.ts` covers the tool's truncation and result text, both unchanged.

**Fixtures.**
`makeReport()` in `test/tools/get-result-report.test.ts` is the only `AgentReport` constructor in the suite, and `runUpdates` is optional, so no fixture edit is forced.
`createTestSubagent` already exists and is reused across the tool tests.

**The carrier matrix is the surface to cover**, not the paths that are easy to picture.
Each of the three claiming front doors gets a test that an update sent during its window appears in **its** return and produces no nudge, plus one background-unclaimed test that the nudge path is unchanged.

## Invariants at risk

Step 11 ([#858]) documented two outcomes this change must not regress:

- **"`midRunUpdates` is the operator's lever"** — pinned by `test/lifecycle/subagent.test.ts`'s "withholds the channel when the operator turned mid-run updates off".
  That test survives untouched and is the reason `canSendUpdates` keeps the setting conjunct rather than being deleted outright.
- **The 2000-character cap** — pinned by `test/session/notify-parent-tool.test.ts`.
  Untouched: the cap is applied in the tool, before either delivery path sees the message.

Step 12 ([#870]) established that a workspace notice produced **after** the result was delivered is announced on its own, and that `sendWorkspaceNotice` is not withheld for the parent's run.
The `record.claimed` early return added here is on `sendUpdate` only; `sendWorkspaceNotice` and `sendCompletion` are not touched.
`test/observation/notification.test.ts` covers all three, so a slip that added the guard to the wrong method goes red there.

Step 12 also recorded that `CompositeSubagentObserver` declares `onSubagentUpdate` **required** though `SubagentManagerObserver` has it optional, because an optional member the composite omits is dropped with no compiler error.
This change does not add an observer member, so that hazard is not re-entered.

No quantitative invariant (prefix bytes, token budget, cache characteristics) is in scope: the change adds text to a tool result only when a child actually sent an update.

## TDD Order

1. **`refactor(pi-subagents): consolidate the outcome-carrier addenda tail`** Prepares the change: three carriers repeat `renderWorkspaceNotice(...) + renderQuestionAffordance(...)` in the same order, and this change must insert a third element into that sequence at each.
   Add `OutcomeAddenda` and `renderOutcomeAddenda()` to `outcome-delivery.ts` (without `runUpdates` yet) and replace the tail in `foreground-runner.ts`, `agent-tool.ts`, and `get-result-report.ts`.
   Add a unit test pinning the addenda order if the carriers' existing tests do not already assert a notice and an affordance together in one output.
   *Killing mutation:* swap the two calls inside `renderOutcomeAddenda` so the affordance precedes the notice — the order test goes red.

2. **`refactor(pi-subagents): record the updates a child sends during a claimed run`** `SubagentState` gains `_runUpdates`, `get runUpdates()`, and `recordUpdate()`, cleared in `markRunning()` and `resetForResume()`; `Subagent` gains the delegating getter.
   Nothing calls `recordUpdate` yet, so this is `refactor:` by the observable-outcome rule.
   Tests in `test/lifecycle/subagent-state.test.ts`: records in order; cleared at a fresh run; cleared at a resume; not seedable from `SubagentStateInit`.
   *Killing mutations:* (a) drop the clear from `resetForResume` — the resume test goes red; (b) drop it from `markRunning` — the fresh-run test goes red; (c) return the live array from the getter instead of a `readonly` view — no test catches this, so type the getter `readonly string[]` and rely on `tsc`.

3. **`refactor(pi-subagents): render a run's updates in every outcome carrier`** `renderRunUpdates()` plus `runUpdates?` on `OutcomeAddenda` and `AgentReport`; `renderOutcomeAddenda` calls it first; `buildReport()` supplies `record.runUpdates`.
   No record populates the buffer yet, so every carrier's output is byte-identical — still `refactor:`.
   Tests: `renderRunUpdates` for empty/undefined, one message, several, and a multi-line message's indentation; one carrier test per carrier that a record carrying updates renders them ahead of the notice.
   *Killing mutations:* (a) make `renderRunUpdates` return `""` unconditionally — the carrier tests go red; (b) drop the `!updates?.length` guard — the empty-case tests go red on the stray heading.

4. **`fix(pi-subagents): deliver a child's update with the result when its parent is blocked`** The observable change, in one commit because its three parts are one behavior: `canSendUpdates()` drops the `isBackground` conjunct; `notifyParent` routes through `announceUpdate()`, which buffers when `this.claimed` and always calls `observer.onUpdateSent`; `NotificationManager.sendUpdate()` returns early on `record.claimed`.
   Tests: the channel is supplied to a foreground child and across a resume; an update sent while claimed is buffered and **not** nudged; an update sent while unclaimed is nudged and **not** buffered; the `subagents:update` event fires in both cases; the `midRunUpdates: false` withholding is unchanged.
   *Killing mutations:* (a) restore `this.isBackground &&` in `canSendUpdates` — the foreground and resume channel tests go red; (b) drop the `if (this.claimed)` in `announceUpdate` — the buffered-update test goes red; (c) drop the `record.claimed` early return in `sendUpdate` — the no-nudge-while-claimed test goes red; (d) suppress `observer.onUpdateSent` when claimed — the event-fires-either-way test goes red.
   Mutation (c) left green while (b) is red would mean the two layers disagree, which is the failure the single call chain is supposed to make impossible.

5. **`docs(pi-subagents): state the update channel's rationale as claim-based`** Every row of the documentation table in Module-Level Changes, plus Step 14's `✅` mark, Mermaid node, and `Landed:` note in the architecture roadmap.
   *Verification:* `grep -rn 'background' packages/pi-subagents/docs/configuration.md packages/pi-subagents/README.md .pi/skills/package-pi-subagents/SKILL.md` returns no sentence conditioning `notify_parent` on spawn mode, and `pnpm exec rumdl check` passes on every edited file.

## Risks and Mitigations

| Risk                                                                                                                | Mitigation                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A chatty foreground child.** The tool now reaches children that never had it, and a child that can interrupt will | Delivery is bounded by construction: while a carrier is blocked, the updates ride its return, so a chatty child costs the parent no extra turns at all — strictly better than the background case the operator already accepts. The tool description's bar and the `midRunUpdates` lever are unchanged    |
| **Two layers read `claimed` and could disagree**                                                                    | They are one synchronous call chain from a single tool execution, so no interleaving is possible; step 4's mutation (c)-vs-(b) pair is the pin. Documented at both sites                                                                                                                                  |
| **Buffered updates are stranded if no carrier renders them**                                                        | Enumerated in Design Overview § Edge cases: the only claiming doors are the three carriers, an abandoned wait still returns its report after `release()`, and a throw from `spawnAndWait` precedes the child's existence. A `markRunning`/`resetForResume` clear bounds any residue to one run regardless |
| **Non-drain means a second `get_subagent_result` repeats the updates**                                              | Intended, and consistent: that report re-renders the result and the question affordance too. A drain would make the second report differ from the first for no stated reason                                                                                                                              |
| **The addenda extraction collides with Step 15 ([#878])**, which reworks `renderQuestionAffordance`'s inputs        | The extraction helps rather than hinders: after this change there is one composition site to teach about resumability instead of three. Step 15 is unplanned, so nothing is frozen against                                                                                                                |
| **`fallow dead-code` flags the new `runUpdates` getter**                                                            | It is read through the real `Subagent` type in both tools, not a structural interface, so it should trace — unlike `release()`, which needed an ignore comment. Verified by running `pnpm fallow dead-code --workspace @gotgenes/pi-subagents` in step 2, before more code depends on it                  |

## Open Questions

- **Should a service-initiated resume claim the outcome?**
  Deferred to [#885], where the caller's intent is the design's input.
  This plan's predicate is the reason that question can be answered there rather than here.
- **Does a completion nudge want to summarize the updates that preceded it?**
  Not until a case is observed.
  Today an unclaimed run's updates were each already announced, so the nudge would repeat them.

[#832]: https://github.com/gotgenes/pi-packages/issues/832
[#858]: https://github.com/gotgenes/pi-packages/issues/858
[#870]: https://github.com/gotgenes/pi-packages/issues/870
[#878]: https://github.com/gotgenes/pi-packages/issues/878
[#885]: https://github.com/gotgenes/pi-packages/issues/885
