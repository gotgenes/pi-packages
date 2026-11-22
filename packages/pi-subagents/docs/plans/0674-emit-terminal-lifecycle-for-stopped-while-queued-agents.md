---
issue: 674
issue_title: "fix(pi-subagents): emit terminal lifecycle for stopped-while-queued agents"
---

# Emit terminal lifecycle for stopped-while-queued agents

## Release Recommendation

**Release:** ship independently

No roadmap step in `docs/architecture/architecture.md` references [#674] or [#665], so this issue belongs to no release batch.
It is a `fix:` commit series, which cuts a release on its own at the next release-please merge.

## Problem Statement

Whether stopping a background agent produces a terminal lifecycle signal depends on whether the concurrency limiter had admitted it yet.
`SubagentManager.abort()` and `abortAll()` both shortcut the queued branch — `record.markStopped()` and return — while a *running* agent's stop flows through `completeRun`/`failRun` → `onRunFinished` → `onSubagentCompleted`.

Nothing downstream fires for a queued stop: no `subagents:failed` event, no `subagents:record` session entry, no completion nudge.
The identical user action produces a terminal event or not by scheduling accident.
That is a defect in this package's core promise — a minimal core that publishes events.

The naive fix trades one defect for another.
A queued-stopped agent never ran, so it has no result — not an empty one.
`formatTaskNotification` would render `<result>No output.</result>` and `emitIndividualNudge` would append `Call get_subagent_result("<id>") to collect the full result.`, pointing the parent at something that does not exist.

## Goals

- Stopping a queued agent fires the same terminal-notification funnel a running agent's stop fires — one dispatch site, not two.
- The notification tells the truth: the agent was stopped while queued and never started, so there is nothing to collect.
- A session that is shutting down is not nudged.
- The stale `fallow-ignore-next-line unused-class-member` above `abortAll()` is removed, so `pnpm fallow audit --base origin/main` stays green.
- The three tests from [#665] are carried over with attribution to @daoguademeng.

Not breaking.
No config edit is required on upgrade, and no existing default changes.
It is an observable behavior change — new `subagents:failed` events, new `subagents:record` entries, and new nudges appear where none did — so the commits are `fix:`, not `feat:`.

## Non-Goals

- **Reworking the `NotificationManager` withholding model.**
  The `parentRunActive` withhold/flush contract from [#661] is untouched; the shutdown fix adds a disposal latch beside it, not inside it.
- **Any change to running-agent abort behavior**, apart from the shutdown-time nudge suppression named in Design Overview (which today leaks asynchronously and is deliberately included).
- **Adding the never-started fact to the `subagents:failed` payload or the `subagents:record` session entry.**
  Both already carry `status: "stopped"`.
  Two tests pin the record entry's exact eight fields (`toHaveBeenCalledExactlyOnceWith`), and widening a cross-extension wire payload is a separate decision — see Open Questions.
- **ESC blast radius** ([#664]) and **the stop-shortcut picker** ([#676]).
  Both change *which* agents get stopped; this issue changes what happens when one is.
- **Merging [#665].**
  It stays open as the reference until this lands, then is closed with credit.

## Background

Relevant modules, all under `packages/pi-subagents/src/`:

| Module                                    | Role in this change                                                                                                                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lifecycle/subagent-state.ts`             | `SubagentState` value object: status, result, timestamps, transitions (`markRunning`, `markStopped`, …). Constructed at spawn, so a queued agent already has one.                                        |
| `lifecycle/subagent.ts`                   | `Subagent` owns the terminal funnel: `completeRun`/`failRun` transition, then call `this.execution.observer?.onRunFinished?.(this)`. `guardedRun()` resolves without running when `isActive()` is false. |
| `lifecycle/subagent-manager.ts`           | `abort()` / `abortAll()` queued branches; `buildObserver()` owns the `options.isBackground` guard and the `try`/`catch` + `debugLog` around `onSubagentCompleted`.                                       |
| `observation/subagent-events-observer.ts` | `onSubagentCompleted` fans out to the lifecycle event, the `subagents:record` entry, and `NotificationManager.sendCompletion`.                                                                           |
| `observation/notification.ts`             | `formatTaskNotification` (agent-facing XML), `buildNotificationDetails` (TUI renderer DTO), `NotificationManager` (withhold/flush, `dispose`).                                                           |
| `handlers/lifecycle.ts`                   | `handleSessionShutdown` cleanup sequence, with a numbered comment asserting the order matters.                                                                                                           |
| `tools/get-result-report.ts`              | `renderReportBody` selects the per-status body for `get_subagent_result`.                                                                                                                                |

Two facts that shape the design:

1. `queued` status implies `isBackground && !bypassQueue` — a foreground or bypass spawn calls `record.start()` synchronously.
   So `abort()` and `abortAll()` are the only two reachable queued-stop sites, and `buildObserver`'s `isBackground` guard is satisfied by construction.
2. `RunListeners` wires nothing before `run()` (`wireSignal` is the first statement of `run()`, `attachObserver` comes after session creation).
   A queued agent therefore has no listeners to release, so the new transition needs no `listeners.release()` — unlike `completeRun`/`failRun`.

Constraints from `AGENTS.md` that apply:

- Conventional Commits with the scope before `!`; no `Closes #N` in commit bodies — reference [#665] as `Refs #665`.

- Every implementation and docs commit for this issue carries, after a blank line at the end of the body:

  ```text
  Co-authored-by: daoguademeng <whumaple@gmail.com>
  ```

- Architecture-doc module-tree entries describe current behavior; do not append issue-provenance trails.

- Load the `mermaid` skill before editing the agent-lifecycle state diagram.

## Design Overview

### The funnel

`Subagent` already owns terminal notification.
Add a third terminal transition beside `completeRun` and `failRun`:

```typescript
/**
 * Stop an agent that never started, then notify like any other terminal
 * transition. No listener release: nothing is wired before run().
 */
stopQueued(): void {
  this.state.stopQueued();
  this.execution.observer?.onRunFinished?.(this);
}
```

Both manager sites collapse to `record.stopQueued()`.
There is no second dispatch site, no duplicated `try`/`catch`, and `buildObserver`'s `isBackground` guard is preserved — which is the whole difference from [#665]'s private `notifyQueuedStopped()`.

Exactly-once is structural, not defensive: `stopQueued()` leaves the record non-active, so when the limiter finally frees the slot, `guardedRun()`'s `isActive()` check resolves the thunk without running.
That is the invariant [#665]'s middle test found, and it is carried over verbatim in intent.

### Where "never started" lives

`SubagentState` is constructed at spawn with `status: "queued"`, so the fact belongs there — there is no pre-start gap to fill upstream.

```typescript
private _stoppedWhileQueued: boolean;
get stoppedWhileQueued(): boolean { return this._stoppedWhileQueued; }

/**
 * Stop an agent that is still awaiting a concurrency slot. Records the
 * never-started fact only when the agent is genuinely still queued, so a
 * mis-targeted call cannot claim it.
 */
stopQueued(completedAt?: number): void {
  if (this._status === "queued") this._stoppedWhileQueued = true;
  this.markStopped(completedAt);
}
```

One writer, one meaning.
`SubagentStateInit` gains `stoppedWhileQueued?: boolean` so the init stays full-value ([#542]) and test fixtures can seed the state without replaying the transition.
`Subagent` exposes a delegating getter, so consumers read `record.stoppedWhileQueued` — a predicate on the object that owns the data, no reach-through.

A new `SubagentStatus` union member was rejected: it is wire-visible on `subagents:failed` and `subagents:record`, and every status switch — `renderer.ts`, the widget, `get-result-report.ts`, the classification predicates — would have to grow an arm for a case that carries no new presentation.

### The honest notification

`formatTaskNotification` branches once and returns a trimmed block.
A zeroed `<usage>` and an empty `<result>` are themselves a lie of shape, so neither is emitted:

```text
<task-notification>
<task-id>a1b2c3</task-id>
<tool-use-id>toolu_01…</tool-use-id>
<status>Stopped before starting</status>
<summary>Subagent "research the limiter" was stopped while queued and never started</summary>
</task-notification>
```

`<tool-use-id>` is kept — the parent needs it to correlate the notification with its own tool call.
`<output-file>` is absent by construction (no session was ever created).

`emitIndividualNudge` drops the trailing pointer lines for a never-started agent: there is no transcript and nothing to collect.

```typescript
private emitIndividualNudge(record: Subagent): void {
  if (record.consumed) return;
  const notification = formatTaskNotification(record, 500);
  // A never-started agent has no transcript and nothing to collect.
  const pointerLines = record.stoppedWhileQueued ? "" : this.buildPointerLines(record);
  this.sendMessage({ …, content: notification + pointerLines, … }, { deliverAs: "followUp", triggerTurn: true });
}
```

`buildNotificationDetails` sets `resultPreview` to the same truth (`"Never started — stopped while queued."`) rather than `"No output."`, so the TUI notification box does not contradict the XML the model reads.

`getStatusLabel` is left alone.
Its `switch` maps a bare `SubagentStatus`, and `stoppedWhileQueued` is not a status — threading a second discriminator into a pure status mapper would be exactly the "raw discriminator each site re-interprets" smell.
The trimmed block carries its own status text.

### Shutdown

At `session_shutdown` no parent run is active, so `sendCompletion` skips the `pendingNudges` path entirely and calls `pi.sendMessage(…, { deliverAs: "followUp", triggerTurn: true })` synchronously — inside the shutdown handler, before `disposeNotifications()` runs.
`dispose()` only clears the pending map, so it cannot recall a message already handed to Pi.

Two coupled changes:

1. `NotificationManager.dispose()` sets a `_disposed` latch; `sendCompletion` returns immediately when it is set.
   `dispose()` stops meaning "clear pending" and starts meaning "this manager is dead" — one-shot, matching its single call site.
2. `handleSessionShutdown` moves `disposeNotifications()` ahead of `abortAll()`, so the latch is closed before any terminal transition can fire.

The latch alone is too late in the current order; the reorder alone leaves no guard for any later caller.

This is deliberately broader than the headline fix.
Today a *running* agent aborted at shutdown also leaks a nudge — its turn loop rejects after the handler has returned, `parentRunActive` is false, and `dispose()` cannot recall it either.
The latch closes that path too, and the plan tests it.

The ESC path is unaffected and needs no special handling: `InterruptHandler` fires inside the parent's run, so `parentRunActive` is true and every nudge — queued or running — is withheld and flushed on `agent_settled`, exactly as [#661] specified.

### `get_subagent_result`

The nudge no longer points the parent at the tool, but the tool remains callable (and the UI still exposes the agent).
`renderReportBody` would return `"No output."` — the same lie in a second place.
`AgentReport` gains a required `stoppedWhileQueued: boolean` (required, so the single builder in `get-result-tool.ts` is compiler-checked) and `renderReportBody` gains a branch ahead of the result fallback:

```typescript
if (report.stoppedWhileQueued)
  return "Agent was stopped while queued and never started. No work was performed.";
```

### Design-review notes

- **Dependency width.**
  `AgentReport` grows from 14 to 15 fields; `renderReportBody` reads 4 of them.
  The file's own convention is full-DTO parameters (`renderStatsParts` also takes `AgentReport`), unlike `renderer.ts`'s `Pick<>`-narrowed `StatsSource`.
  Track and watch — narrowing both helpers is a separate tidy, not this fix.
- **Repeated discriminator.**
  `stoppedWhileQueued` is read at three presentation sites (`formatTaskNotification`, `emitIndividualNudge`, `buildNotificationDetails`) plus `renderReportBody`.
  Per-variant presentation dispatch is idiomatic; the smell would be a *decision* re-derived.
  If a fourth, non-presentation site appears, hoist it.
- **No output arguments, no reach-through.**
  The flag is written only by its owning value object and read through a delegating getter.

## Module-Level Changes

### Source

- **`src/lifecycle/subagent-state.ts`** — add `_stoppedWhileQueued` + getter; add `stoppedWhileQueued?: boolean` to `SubagentStateInit` and seed it in the constructor; add the `stopQueued(completedAt?)` transition.
  `markStopped` is unchanged and keeps both its existing callers.
- **`src/lifecycle/subagent.ts`** — add a delegating `get stoppedWhileQueued()`; add `stopQueued()`; update `abort()`'s doc comment, which currently says "A still-queued agent is stopped by SubagentManager" — after this change the manager delegates to `stopQueued()`.
- **`src/lifecycle/subagent-manager.ts`** — `abort()`'s queued branch and `abortAll()`'s queued branch both call `record.stopQueued()`; update the `abort()` inline comment; remove the stale `// fallow-ignore-next-line unused-class-member` above `abortAll()` (the suppressions above `hasRunning()` and `waitForAll()` stay).
- **`src/observation/notification.ts`** — `formatTaskNotification` branches to a trimmed never-started block; `buildNotificationDetails` sets the honest `resultPreview`; `NotificationManager` gains the `_disposed` latch, `sendCompletion` returns early when set, and `emitIndividualNudge` drops the pointer lines for a never-started record.
- **`src/handlers/lifecycle.ts`** — reorder `handleSessionShutdown` to `unpublishService → clearSessionContext → disposeNotifications → abortAll → dispose`; rewrite the numbered cleanup comment to state *why* notifications die first.
- **`src/tools/get-result-report.ts`** — `AgentReport` gains required `stoppedWhileQueued: boolean`; `renderReportBody` gains the never-started branch.
- **`src/tools/get-result-tool.ts`** — `buildReport` populates `stoppedWhileQueued: record.stoppedWhileQueued`.

### Tests

- **`test/helpers/make-subagent.ts`** — `TestSubagentOptions` gains `stoppedWhileQueued?: boolean`.
  It is not destructured out, so it flows through `stateOverrides` into `SubagentState` once the init accepts it; only the type declaration is needed.
- **`test/lifecycle/subagent-state.test.ts`**, **`test/lifecycle/subagent.test.ts`**, **`test/lifecycle/subagent-manager.test.ts`**, **`test/observation/notification.test.ts`**, **`test/handlers/lifecycle.test.ts`**, **`test/tools/get-result-report.test.ts`** — see TDD Order.
- **`test/tools/get-result-report.test.ts` fixtures** — making `AgentReport.stoppedWhileQueued` required breaks every partial report literal in this file at compile time (6 `status:`-bearing literals today).
  Each must gain the field in the same commit.

### Docs

- **`README.md`** — the Concurrency section gains a sentence: stopping a queued agent before it starts still produces a completion notification, and that notification says the agent never started.
  The status table's `stopped` row ("User-initiated abort") stays accurate and is not edited.
- **`docs/architecture/architecture.md`** — the *Agent lifecycle* state diagram gains `queued --> stopped : stopQueued() (never started)`.
  While in the diagram, correct two pre-existing swapped labels: `running --> aborted` is currently labelled "abort() called" and `running --> stopped` "max turns reached", but `abort()` calls `markStopped()` (→ `stopped`) and the turn-limit path calls `markAborted()` (→ `aborted`).
  The README status table already has this right.
  No module-tree entry changes: the `notification.ts`, `subagent-state.ts`, and `handlers/lifecycle.ts` entries stay accurate.
  No health-metrics refresh: no file is added or removed.
- **`.pi/skills/package-pi-subagents/SKILL.md`** — the Observation domain row describes the nudge mechanism ("withheld during the parent's agent run and flushed on `agent_settled`"); add that nudges are silenced once the manager is disposed.

### Grep verification performed

- No export is removed or renamed, so no `src/`, `test/`, `docs/`, or `.pi/skills/` symbol sweep is owed.
- `"No output."` appears in four `src/` files; only `notification.ts` and `get-result-report.ts` are reachable for a queued stop.
  `foreground-runner.ts` and `agent-tool.ts` are foreground paths, and a foreground spawn bypasses the queue.
- `subagents:record` / `subagents:completed` are referenced in `README.md` (event table), `docs/architecture/architecture.md` (lifecycle-events table), and `dist/public.d.ts` (generated).
  No payload changes, so none needs an edit.
- `.pi/skills/` grep for `nudge` / `session_shutdown` / `abortAll` found exactly one affected line — the `package-pi-subagents` Observation row.

## Test Impact Analysis

**New unit tests the change enables.**
`SubagentState.stopQueued()` and `Subagent.stopQueued()` are testable in isolation — the state transition without a `Subagent`, and the observer funnel without a `SubagentManager` or a limiter.
Before this change the only way to exercise a queued stop was through the manager plus a stalled session factory (`arrangeQueuedPair`).

**Existing tests that become redundant.**
None.
`subagent-manager.test.ts`'s "abort removes a queued agent without ever running it" overlaps the new coverage but pins a different thing — that the session factory is never called — and stays.

**Existing tests that must stay as-is.**
The limiter-interplay tests (`gives a queued agent an awaitable promise at spawn`, `onStart fires when agent transitions from queued to running`) exercise the admission path the new transition must not disturb.
`notification.test.ts`'s `parent-turn boundary` describe pins the [#661] withhold/flush contract; the shutdown latch must not weaken it.

## Invariants at risk

| Invariant                                                                                                                                | Source                                                             | Pinned by                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| A stopped-while-queued agent notifies **exactly once**, even after its slot frees — `guardedRun()`'s `isActive()` guard is the mechanism | [#563] classification predicates; `scheduleVia` doc comment        | New test (TDD 3, carried from [#665])                                                                                  |
| Nudges are withheld while the parent's agent run is active and flushed on `agent_settled`                                                | [#661]                                                             | Existing `parent-turn boundary` tests + new test (TDD 5) that an ESC-time queued stop is withheld, not emitted mid-run |
| `SubagentStateInit` is full-value — every state field is seedable without replaying transitions                                          | [#542]                                                             | New `SubagentStateInit` seed test (TDD 1)                                                                              |
| `handleSessionShutdown` runs a fixed cleanup sequence                                                                                    | `test/handlers/lifecycle.test.ts` "calls cleanup in correct order" | Same test, deliberately updated to the new order; the assertion remains exact                                          |

No quantitative invariant (byte-identical prefix, token budget, latency) is touched.
Baseline on `b1722630`: 64 test files, 1095 tests, all green; `pnpm fallow audit --base origin/main` clean.

## TDD Order

Every commit body ends with a blank line and `Co-authored-by: daoguademeng <whumaple@gmail.com>`.

1. **`SubagentState.stopQueued()`.**
   Red — `test/lifecycle/subagent-state.test.ts`: `stopQueued()` sets `status` to `stopped`, sets `completedAt`, and sets `stoppedWhileQueued`; `markStopped()` alone leaves `stoppedWhileQueued` false; `stopQueued()` on a `running` state stops it but does **not** claim it never started; `new SubagentState({ stoppedWhileQueued: true })` seeds the getter.
   Green — add the field, the getter, the `SubagentStateInit` entry, and the transition.
   Commit: `feat(pi-subagents): add a stopQueued transition to SubagentState`.

2. **`Subagent.stopQueued()` funnel.**
   Red — `test/lifecycle/subagent.test.ts`: `stopQueued()` transitions the record to `stopped`, exposes `stoppedWhileQueued`, and fires `observer.onRunFinished` exactly once with the record.
   Green — add the delegating getter and the method; update `abort()`'s doc comment.
   Commit: `feat(pi-subagents): fire the terminal observer from Subagent.stopQueued`.

3. **Manager call sites (the carried-over [#665] tests).**
   Red — `test/lifecycle/subagent-manager.test.ts`, using the existing `arrangeQueuedPair` helper:
   - `abort()` on a queued agent notifies `onSubagentCompleted` with status `stopped`;
   - a stopped-while-queued agent notifies exactly once even after its slot frees;
   - `abortAll()` notifies `onSubagentCompleted` for queued agents.

   Green — both queued branches call `record.stopQueued()`; remove the now-stale `fallow-ignore-next-line unused-class-member` above `abortAll()`.
   Verify — `pnpm fallow audit --base origin/main` exits 0.
   Commit: `fix(pi-subagents): emit terminal lifecycle when a queued agent is stopped`, body crediting the diagnosis and tests to @daoguademeng with `Refs #665`.

4. **Honest notification.**
   Red — `test/observation/notification.test.ts`: `formatTaskNotification` on a `stoppedWhileQueued` record emits the trimmed block — contains `<task-id>`, `<tool-use-id>` when present, `Stopped before starting`, and the never-started summary; contains no `<result>`, no `<usage>`, no `<output-file>`.
   `buildNotificationDetails` sets the never-started `resultPreview`.
   `NotificationManager.sendCompletion` (no parent run active) sends content with no `get_subagent_result(` pointer line, while a normal completed record still gets one.
   Green — implement the branch, the preview, and the pointer-line guard.
   Commit: `fix(pi-subagents): tell the truth in a stopped-while-queued notification`.

5. **Shutdown suppression.**
   Red — `test/observation/notification.test.ts`: `sendCompletion` after `dispose()` sends nothing, with no parent run active (this is the leak the issue asked to confirm); a queued stop *during* an active parent run is still withheld and flushed on `onParentAgentSettled` (the [#661] guard).
   `test/handlers/lifecycle.test.ts`: the cleanup order is `unpublishService, clearSessionContext, disposeNotifications, abortAll, dispose`.
   Green — add the `_disposed` latch and the early return; reorder `handleSessionShutdown` and rewrite its numbered comment.
   Commit: `fix(pi-subagents): stop nudging a session that is shutting down`.

6. **`get_subagent_result` honesty.**
   Red — `test/tools/get-result-report.test.ts`: `renderReportBody` returns the never-started line for a `stoppedWhileQueued` report and is unchanged for every other case.
   Green — add the required `AgentReport` field, the `renderReportBody` branch, and the `buildReport` wiring; update all existing report literals in the file (required field ⇒ they fail `tsc` in this commit, so builder, branch, and fixtures land together).
   Commit: `fix(pi-subagents): report a never-started agent honestly in get_subagent_result`.

7. **Docs.**
   No test cycle.
   Update `README.md` (Concurrency section), `docs/architecture/architecture.md` (state diagram: new `queued --> stopped` edge plus the two swapped-label corrections — load the `mermaid` skill first and verify the diagram renders), and `.pi/skills/package-pi-subagents/SKILL.md` (Observation row).
   Commit: `docs(pi-subagents): document the stopped-while-queued lifecycle`.

Final gate before handoff: `pnpm run check`, `pnpm run lint`, `pnpm --filter @gotgenes/pi-subagents run test`, `pnpm fallow dead-code`, `pnpm fallow audit --base origin/main`.

## Risks and Mitigations

| Risk                                                                                                                              | Mitigation                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nudge volume on a mass stop — ESC or `abortAll()` with N queued agents now produces N extra nudges, each with `triggerTurn: true` | Already the behavior for N *running* agents, so this is parity, not a new class of event. The nudges are withheld by [#661] and flushed once on `agent_settled`, so they arrive as one batch after the turn, not mid-stream. Blast-radius control is [#664]/[#676]. |
| Shutdown reorder is broader than the headline fix — it also suppresses running agents' shutdown nudges                            | Deliberate and tested (TDD 5). Those nudges fire into a session that is already gone; suppressing them is the fix, not a regression. Recorded here so a future reader does not read it as accidental scope.                                                         |
| `dispose()` becomes one-shot; a future caller that disposes and reuses the manager gets silence                                   | Single call site (`handleSessionShutdown`), and the extension factory constructs a fresh `NotificationManager` per session. The latch is documented on `dispose()`.                                                                                                 |
| The cleanup-order test is an intentionally-changed pinned invariant                                                               | The updated assertion stays exact (`toEqual` on the full sequence), and the handler's numbered comment is rewritten to state why notifications die before aborts — so the next reader sees intent, not drift.                                                       |
| Fourth read site for `stoppedWhileQueued` turns presentation dispatch into a scattered decision                                   | Three of the four sites are in one module. If a fifth appears, or a non-presentation consumer needs it, hoist to a resolved presentation product like `renderer.ts`'s `resolveStatusPresentation`.                                                                  |
| `AgentReport` widening breaks test fixtures at compile time                                                                       | Expected and planned: the required field, the builder, the branch, and every fixture land in TDD 6 together.                                                                                                                                                        |

## Open Questions

- **Should `subagents:failed` / `subagents:record` carry the never-started fact?**
  A cross-extension consumer currently sees `status: "stopped"` with `result: undefined` and cannot distinguish never-started from stopped-before-first-output.
  Deferred, not filed: two tests pin the record entry's exact field set, and no consumer has asked.
  Revisit if [#676]'s picker makes selective stops common enough that history reconstruction needs the distinction.
- **Narrowing `get-result-report.ts`'s helper parameters to `Pick<AgentReport, …>`**, matching `renderer.ts`'s `StatsSource`.
  A tidy, not part of this fix.

[#542]: https://github.com/gotgenes/pi-packages/issues/542
[#563]: https://github.com/gotgenes/pi-packages/issues/563
[#661]: https://github.com/gotgenes/pi-packages/issues/661
[#664]: https://github.com/gotgenes/pi-packages/issues/664
[#665]: https://github.com/gotgenes/pi-packages/issues/665
[#676]: https://github.com/gotgenes/pi-packages/issues/676
