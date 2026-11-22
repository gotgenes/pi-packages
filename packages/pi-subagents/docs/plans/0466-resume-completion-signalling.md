---
issue: 466
issue_title: "Resuming a subagent skips completion lifecycle, notification, and history emission"
---

# Route resume termination through the completion channel

## Release Recommendation

**Release:** ship independently

This is Phase 21 Step 2 in `docs/architecture/architecture.md`, tagged `Release: independent` — no batch.
It lands as `fix:` (the phase's unhidden release vehicle), so it cuts a patch release on its own.

## Problem Statement

A subagent that terminates through a normal run signals its completion three ways: it emits a public lifecycle event on the `SUBAGENT_EVENTS` bus, it appends a `subagents:record` session entry so persisted history matches the in-memory record, and it sends a completion notification to the parent.
A subagent that terminates through `resume()` signals none of them.
`resume()` calls `markCompleted()` / `markError()` directly and never invokes `onRunFinished`, so the manager-level observer chain never observes a resumed completion.
The user-visible consequences: persisted history keeps showing the pre-resume result (the snapshot goes stale), an external `SUBAGENT_EVENTS` subscriber never sees the second finish, and a resume that is not synchronously collected sends no notification.

## Goals

- A resumed run that reaches a terminal state emits a public event, re-appends its `subagents:record`, and (when unconsumed) sends a completion notification — the same observable signals a fresh completion produces.
- Completion signalling is owned by run termination generally, not fused to the first run: `resume()` routes through named termination methods (`completeResume` / `failResume`) instead of raw `this.mark*` calls.
- The resumed completion appears on a **distinct** `subagents:resumed` event channel (see Design Overview), so existing `subagents:completed` / `subagents:failed` subscribers keep their once-per-run semantics.
- The child-lifecycle arc (`spawning → session-created → completed → disposed`) stays strictly once-per-session — `resume()` emits no `subagents:child:*` event.

Not a breaking change: this is purely additive (a new event channel plus emissions on a path that previously emitted nothing).
No existing default, output shape, or behavior changes on upgrade.

## Non-Goals

- No change to `resumeTurnLoop`'s result shape.
  Because the design keeps the child-lifecycle channel silent and does not re-emit `subagents:child:completed`, `resumeTurnLoop` does not need the `aborted` / `steered` data it currently omits — it stays `Promise<string>`.
  This is a deliberate scope reduction from the roadmap Step 2's tentative target-file list, justified by the resolved design decisions below.
- No child-lifecycle event on resume (`subagents:child:resumed` is **not** added — decided at planning, see Design Overview).
- No workspace re-preparation or re-disposal on resume — `resume()` reuses the existing session; workspace bracketing is out of scope.
- No redesign of the event bus into a single multiplexed channel with a `type` discriminator — each event stays its own channel string, matching the existing `SUBAGENT_EVENTS` design.
- No change to the ask-back feature (#465) that motivated the discovery; this fix is a prerequisite for it, not part of it.

## Background

Relevant modules (pi-subagents):

- `src/lifecycle/subagent.ts` — `Subagent.run()` terminates via `completeRun()` / `failRun()`, which mark status, release listeners, dispose the workspace, and call `this.execution.observer?.onRunFinished?.(this)`.
  `Subagent.resume()` instead calls `markCompleted()` / `markError()` directly inside a `try/catch/finally` and never calls `onRunFinished`.
- `src/lifecycle/subagent-manager.ts` — `buildObserver()` maps the per-subagent `SubagentLifecycleObserver` (`onStarted` / `onSessionCreated` / `onRunFinished` / `onCompacted`) onto the manager-level `SubagentManagerObserver` (`onSubagentStarted` / `onSubagentCompleted` / `onSubagentCompacted` / `onSubagentCreated`).
  `onRunFinished` fires `onSubagentCompleted` **only when `options.isBackground`**.
- `src/observation/subagent-events-observer.ts` — `SubagentEventsObserver.onSubagentCompleted()` is the single place that emits `subagents:completed` / `subagents:failed` (via `buildEventData`), appends the `subagents:record` entry, and calls `notifications.sendCompletion(record)`.
- `src/observation/composite-subagent-observer.ts` — fans a manager notification out to every delegate (`SubagentEventsObserver`, `AgentWidget`).
- `src/ui/agent-widget.ts` — `AgentWidget implements SubagentManagerObserver`; its handlers call `this.update()` and it self-drives by polling `listAgents()`.
- `src/service/service.ts` — `SUBAGENT_EVENTS` channel constants (public, re-exported through `dist/public.d.ts`).
- `src/observation/notification.ts` — `sendCompletion()` is consumption-gated: it schedules a nudge only when `!record.consumed`, and `emitIndividualNudge` re-reads `record.consumed` at fire time.

Constraints from AGENTS.md and the package skill:

- **Open/closed core** — pi-subagents publishes events; consumers subscribe.
  Adding a channel keeps the core closed to consumer knowledge.
- **Public-type verification** — adding a `SUBAGENT_EVENTS` constant changes the public surface; run `pnpm --filter @gotgenes/pi-subagents run verify:public-types` after.
  `dist/*.d.ts` is gitignored — never commit it.
- **Architecture-doc landing (#540)** — the roadmap step's `✅` mark (heading + Mermaid node) and its `Landed:` note are landed at implementation completion, not deferred.

Soft-depends on Step 1 (#563, already landed): both edit `subagent.ts`'s termination area, and Step 1's classification predicates keep the guard clean.

## Design Overview

### The two skipped channels and the resolved decisions

The normal path signals completion on two independent seams:

1. **Manager-observer seam** (`onRunFinished` → `SubagentManagerObserver.onSubagentCompleted`): public `subagents:completed` / `subagents:failed` event, `subagents:record` persistence, and the completion notification.
   This seam is **record-scoped** — re-signalling it for a resumed termination is correct.
2. **Child-lifecycle seam** (`subagents:child:completed`, emitted inside `runTurnLoop`): the once-per-session arc `spawning → session-created → completed → disposed`.
   pi-permission-system's registry bracket subscribes only to `session-created` / `disposed`, so leaving `completed` un-re-emitted breaks nothing.

Decisions resolved with the operator at planning (the roadmap flagged both as open):

- **Public event shape → a distinct `subagents:resumed` channel.**
  A single new channel constant `SUBAGENT_EVENTS.RESUMED = "subagents:resumed"`, emitted when a resume reaches a terminal state, carrying the `buildEventData(record)` payload.
  Because a resume terminates only as `completed` or `error` (resume does not track turn limits, so never `aborted` / `steered`), the payload's `status` and `error` fields discriminate success from failure on the one channel — no paired `resume-failed` channel.
  Existing `subagents:completed` / `subagents:failed` subscribers keep their once-per-run reading; resume-aware consumers subscribe to `subagents:resumed`.
- **Child-lifecycle → silent.**
  `resume()` emits no `subagents:child:*` event, honoring the roadmap invariant "do not perturb the child-lifecycle event ordering" and adding no unconsumed child-layer surface.

### Notification behavior on the current resume path

`sendCompletion` is consumption-gated, and the current resume-via-tool path (`agent-tool.ts`) awaits `manager.resume()`, then calls `record.markConsumed()` and returns the result synchronously.
So for today's callers the scheduled nudge suppresses itself (the parent already has the result) — the correct behavior, unchanged.
The record re-append and the `subagents:resumed` event fire **unconditionally**, which is what fixes the stale-history and missing-event bugs.
The notification path becomes correct for a future non-consuming resume caller (the #465 ask-back flow), where `markConsumed` is not called and the nudge fires.

### New manager-observer method, mirroring the fresh-completion handler

`SubagentEventsObserver.onSubagentResumed` does the same three things as `onSubagentCompleted`, differing only in the event channel (always `subagents:resumed`, never the completed/failed split).
The record-append and notification are identical; a private `persistAndNotify(record)` helper may be extracted so both handlers share it (impl/tidy-first triage — the shared block gives behavior to the record's data, not a metric-only split).

Consumer call-site sketch (events observer):

```typescript
onSubagentResumed(record: Subagent): void {
  this.emit(SUBAGENT_EVENTS.RESUMED, buildEventData(record)); // status/error discriminate
  this.persistAndNotify(record); // append subagents:record + sendCompletion (consumption-gated)
}
```

### Termination path on `Subagent`, symmetric with `completeRun` / `failRun`

`resume()` stops calling `this.markCompleted` / `this.markError` directly; it routes through two dedicated termination methods that also fire a new per-subagent observer hook.
These give termination behavior to the object (mark + release + notify as one owned step), matching the existing `completeRun` / `failRun` pattern, and add the observer notification that was missing — not a metric-only relocation.

Interaction sketch (`subagent.ts`):

```typescript
async resume(prompt: string, signal?: AbortSignal): Promise<void> {
  const subagentSession = this.subagentSession;
  if (!subagentSession) throw new Error("Subagent not configured for resume — missing session");
  this.resetForResume(Date.now());
  this.listeners.attachObserver(subscribeSubagentObserver(subagentSession, this.state, {
    onCompact: (info) => this.execution.observer?.onCompacted?.(this, info),
  }));
  try {
    this.completeResume(await subagentSession.resumeTurnLoop(prompt, signal));
  } catch (err) {
    this.failResume(err);
  }
}

completeResume(result: string): void {
  this.markCompleted(result);
  this.listeners.release();
  this.execution.observer?.onResumeFinished?.(this);
}

failResume(err: unknown): void {
  this.markError(err);
  this.listeners.release();
  this.execution.observer?.onResumeFinished?.(this);
}
```

`buildObserver()` maps `onResumeFinished` onto `onSubagentResumed`, background-gated exactly like `onRunFinished` → `onSubagentCompleted`:

```typescript
onResumeFinished: (agent) => {
  if (options.isBackground) {
    try { this.observer?.onSubagentResumed(agent); }
    catch (err) { debugLog("onSubagentResumed observer", err); }
  }
},
```

### Types

```typescript
// service.ts — SUBAGENT_EVENTS gains one channel
RESUMED: "subagents:resumed",

// subagent-manager.ts — SubagentManagerObserver gains a required method
onSubagentResumed(record: Subagent): void;

// subagent.ts — SubagentLifecycleObserver gains an optional hook
onResumeFinished?(agent: Subagent): void;
```

### Edge cases

- **Foreground resume** — `onResumeFinished` fires `onSubagentResumed` only when `isBackground`, mirroring `onRunFinished`; a foreground agent's caller gets the result synchronously, so no public event / notification, consistent with fresh foreground completion.
- **Resume error** — `failResume` marks error and fires `onResumeFinished`; the observer emits `subagents:resumed` with `status: "error"` and the `error` field populated (single channel, discriminated by payload).
- **Observer throw** — the `buildObserver` wiring wraps `onSubagentResumed` in `try/catch` + `debugLog`, matching the `onSubagentCompleted` wiring, so an observer failure never breaks the resume.

## Module-Level Changes

Source:

- `src/service/service.ts` — add `RESUMED: "subagents:resumed"` to `SUBAGENT_EVENTS`. (Public surface — triggers `verify:public-types`.)
- `src/lifecycle/subagent-manager.ts` — add required `onSubagentResumed(record: Subagent): void` to `SubagentManagerObserver`; add `onResumeFinished` to the object returned by `buildObserver()`, background-gated to call `this.observer?.onSubagentResumed`.
- `src/observation/subagent-events-observer.ts` — implement `onSubagentResumed(record)`: emit `subagents:resumed` (`buildEventData` payload), append `subagents:record`, call `notifications.sendCompletion(record)`.
  Optionally extract a private `persistAndNotify(record)` shared with `onSubagentCompleted`.
- `src/observation/composite-subagent-observer.ts` — add `onSubagentResumed(record)` fan-out via `dispatch`.
- `src/ui/agent-widget.ts` — implement `onSubagentResumed(_record)` → `this.update()` (satisfies the now-wider interface and refreshes the finished state).
- `src/lifecycle/subagent.ts` — add optional `onResumeFinished?(agent)` to `SubagentLifecycleObserver`; add `completeResume(result)` / `failResume(err)` methods; route `resume()` through them, removing the two direct `this.mark*` calls from the `resume()` body.

Not changed (deviation from roadmap Step 2's tentative list, justified above):

- `src/lifecycle/subagent-session.ts` — `resumeTurnLoop` stays `Promise<string>`; no child-lifecycle emission on resume.

Tests (interface widening — the new required `SubagentManagerObserver.onSubagentResumed` breaks every full-object implementer/mock in the same commit):

- `test/observation/subagent-events-observer.test.ts` — new `onSubagentResumed` unit tests.
- `test/observation/composite-subagent-observer.test.ts` — `makeDelegate()` and the inline `SubagentManagerObserver` literals gain `onSubagentResumed`; add a fan-out test.
- `test/lifecycle/subagent.test.ts` — resume happy/error tests assert `onResumeFinished` fires; the `SubagentLifecycleObserver` mocks gain the hook.
- `test/lifecycle/subagent-manager.test.ts` — `createManager`'s observer factory gains an `onSubagentResumed` fallback; add a test that background `manager.resume()` fires `onSubagentResumed` and foreground does not.

Docs:

- `README.md` — add a `subagents:resumed` row to the Events table (§Events); add `resumed` to the "Event bus" parenthetical list (line ~32).
- `docs/architecture/architecture.md` — add a `subagents:resumed` row to the lifecycle-events channel table (§ near line 480); mark Step 2 `✅` (heading at line ~718 and the Mermaid step-dependency node at line ~747) and append its `Landed:` note.

## Test Impact Analysis

1. **New tests enabled** — the resume path previously emitted nothing, so no test could assert its signalling.
   New unit tests now cover: `SubagentEventsObserver.onSubagentResumed` (emit + append + notify), `Subagent.resume()` firing `onResumeFinished` on success and error, and `SubagentManager.resume()` firing `onSubagentResumed` for background (not foreground) agents.
2. **Redundant tests** — none.
   The existing `Subagent.resume()` happy/error/observer-lifecycle tests in `subagent.test.ts` still hold: `completeResume` / `failResume` call `markCompleted` / `markError` internally, so the status/result assertions stay green; they are augmented (assert `onResumeFinished`), not removed.
3. **Tests that must stay** — `subagent-session.test.ts`'s `resumeTurnLoop` tests (the layer is unchanged) and the `subagent.test.ts` resume status-transition tests (they pin the mark behavior the new methods delegate to).

## Invariants at risk

- **Step 1 (#563) — multi-status classification groupings outside `subagent-state.ts` stay ≤ 2.**
  Pinned by the repeated-discriminator sweep (`grep -rhoE '[A-Za-z_.]+ [!=]== "[a-z0-9_-]+"' src --include="*.ts" | sort | uniq -c | sort -rn | awk '$1 >= 3'`).
  `completeResume` / `failResume` add no `status === …` groupings; `buildObserver`'s new arm branches on the `isBackground` boolean, not a status.
  Run the sweep after Cycle 2 to confirm it stays at 2.
- **Child-lifecycle ordering (roadmap Step 2 invariant).**
  `resume()` must emit no `subagents:child:*` event.
  Guarded by leaving `subagent-session.ts` untouched and by a test asserting the child-lifecycle publisher is not called during resume (the existing resume tests already exercise a stubbed session — assert no `child:completed` emission).

## TDD Order

1. **Cycle 1 — `subagents:resumed` manager-observer channel.**
   Red (`test/observation/subagent-events-observer.test.ts`): `onSubagentResumed(record)` emits `subagents:resumed` with the `buildEventData` shape, appends a `subagents:record` entry, and calls `notifications.sendCompletion(record)`.
   Green: add `SUBAGENT_EVENTS.RESUMED`; add required `onSubagentResumed` to `SubagentManagerObserver`; implement it in `SubagentEventsObserver`; fan it out in `CompositeSubagentObserver`; add `onSubagentResumed` → `update()` to `AgentWidget`; update `composite-subagent-observer.test.ts` (`makeDelegate` + inline literals) and add its fan-out test.
   Run `pnpm --filter @gotgenes/pi-subagents run check` (shared-interface change) and `verify:public-types` (public surface change).
   Commit: `fix(pi-subagents): add subagents:resumed observer channel (#466)`.

2. **Cycle 2 — route `resume()` termination through the observer.**
   Red: `subagent.test.ts` — `resume()` calls `execution.observer.onResumeFinished` on success and when `resumeTurnLoop` rejects; `subagent-manager.test.ts` — background `manager.resume()` fires `onSubagentResumed`, foreground does not.
   Green: add optional `onResumeFinished?` to `SubagentLifecycleObserver`; add `completeResume` / `failResume` to `Subagent` and route `resume()` through them; wire `buildObserver().onResumeFinished` → background-gated `onSubagentResumed`; add the `onSubagentResumed` fallback to `createManager`'s observer factory.
   Run the repeated-discriminator sweep (Invariants) and `pnpm --filter @gotgenes/pi-subagents run check`.
   Commit: `fix(pi-subagents): route resume termination through completion observer (#466)`.

3. **Cycle 3 — documentation.**
   Update `README.md` (Events table + line-32 summary) and `docs/architecture/architecture.md` (lifecycle-events table + Step 2 `✅` heading/Mermaid node + `Landed:` note).
   No test cycle.
   Commit: `docs(pi-subagents): document subagents:resumed and land Phase 21 Step 2 (#466)`.

All three commits are `fix:` / `docs:`; per the roadmap the step is a patch-release `fix:` — the new public channel is the mechanism of the bug fix, not a separately-versioned feature.

## Risks and Mitigations

- **Interface widening breaks implementers/mocks (compile-time).**
  Adding a required `onSubagentResumed` to `SubagentManagerObserver` breaks `CompositeSubagentObserver`, `AgentWidget`, and every full-object test mock until each adds the method.
  Mitigation: Cycle 1 folds all implementer and mock updates into the one commit; `pnpm run check` gates it.
- **Notification double-fire on the current resume path.**
  The tool marks the record consumed right after resume returns; `sendCompletion` is consumption-gated (schedule-time and fire-time), so no spurious nudge.
  Mitigation: rely on the existing consumption gate; the events-observer test asserts `sendCompletion` is called, and the consumption suppression is already covered by `notification` tests.
- **Accidental child-lifecycle emission.**
  Mitigation: leave `subagent-session.ts` untouched and assert no `subagents:child:*` emission during resume (Invariants).
- **Public-type drift.**
  Mitigation: run `verify:public-types` in Cycle 1.

## Open Questions

None.
The two design decisions the roadmap flagged (distinct event vs. discriminator; child-lifecycle emission) were resolved with the operator at planning: a distinct `subagents:resumed` channel and a silent child-lifecycle.
