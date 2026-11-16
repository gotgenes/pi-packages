---
issue: 1051
issue_title: "pi-subagents: let each run own its outcome, so a waiter holds the run it waited on"
---

# Let each run own its outcome

## Release Recommendation

**Release:** ship independently

The Phase 23 roadmap step for this issue is tagged `Release: independent`, and the roadmap lists it as `refactor:` only, so it cuts no release on its own.

## Problem Statement

A subagent is a sequence of runs (the initial run, then one per resume), but one run's outcome lives on the per-agent `SubagentState`, which simulates the sequence by hand.
`resetForResume` clears the outcome fields one by one to start the next run, and `markRunning` clears the update ledger again.
A one-slot `_superseded` buffer stands in for "the run this waiter waited on", so `waitUntilSettled` can report a run a resume replaced.
Claims are special-cased to survive the reset because they belong to "the caller rather than the run", the seam [#1015] fixed a bug in.
`get_subagent_result` carries matching workarounds: a `superseded` outcome threaded through `CollectedOutcome`, and a `withoutQuestion` helper that strips a question the replacing resume already answered.

When each run owns its outcome, a waiter holds the run it waited on and reads that run's outcome directly, a resume starts a new run instead of resetting fields, and a claim taken for a resume is taken on the run it delivers.

## Goals

- `SubagentRun` owns one run's outcome and its transitions: status, result, error, `startedAt`, `completedAt`, `stoppedWhileQueued`, the pending question, the workspace notice, the turn budget, the update ledger, consumption, and the carrier claims.
- `SubagentState` keeps only what spans runs: tool uses, lifetime usage, compaction count, active tools, response text, and `lastProgressAt`.
- `Subagent` reads through to its current run, so `SubagentRecord`, the service, and every carrier see the same fields.
- `waitUntilSettled` returns the run the wait began on; `_superseded`, `supersededOutcome`, the run ordinal, `resetForResume`, `releaseClaims`, `WaitOutcome`, `SettledOutcome`, `liveOutcome`, and `withoutQuestion` go away.
- `SubagentManager.startResume` passes the caller's claim into the resume, so the new run is born claimed.
- Ride-along: the retention sweep is driven through its real interval in tests, and the 8 `as any` reaches in `subagent-manager.test.ts` go.
- Non-breaking.
  `SubagentRecord`, the `SubagentsService` contract, the published `subagents:*` events, and the `get_subagent_result` report text are unchanged, and `test/service/` passes without edits.

## Non-Goals

- [#1058] (third-party: withheld notifications cross a resume boundary).
  `NotificationManager` keeps queuing the `Subagent` record and reading the current run through it, so #1058 still reproduces after this change; it lands later as its own `fix:` on top of the per-run object (operator decision, this planning session).
- [#1013] (admitting a background resume through `maxConcurrent`).
  This change makes a run exist while queued, which #1013 needs, but resumes still start immediately.
- Moving `SubagentStatus` and the status predicates (`isActiveStatus`, …) out of `subagent-state.ts`.
  Ten importers read them from there; the vocabulary stays put and `subagent-run.ts` imports it.
- The foreground carriers (`foreground-runner.ts`, the foreground resume in `agent-tool.ts`) keep marking `record.markConsumed()` after awaiting the run.
  Under per-run consumption that marks the current run, which differs from the awaited run only if a resume starts between the run settling and the carrier's continuation.
  That is [#1015]'s trigger (a cross-extension consumer resuming synchronously from `subagents:completed`), which no consumer in this monorepo produces; no issue is filed.
- Rehydration: no `src/` path builds a `Subagent` from persisted state (`grep -rn 'new Subagent(' src` finds only `SubagentManager.create`).
- ADR prose that names `SubagentState` (`docs/decisions/0004-*.md`, `0005-*.md`) records the state at decision time and is not edited.

## Background

- `src/lifecycle/subagent-run.ts` (69 lines, from [#1049]): `SubagentRun(kind, inBackground, callerSignal, onCallerAbort)` owns the abort controller, the caller-signal wiring (born aborted when the signal already fired), and the record-observer unsubscribe.
  [#1050] gave it the run kind and one lifecycle; [#1012] gave it the mode.
- `src/lifecycle/subagent-state.ts` (467 lines): status, result, error, timestamps, `stoppedWhileQueued`, consumption, the claim set, the run ordinal, `_superseded`, pending question, workspace notice, turn budget, update ledger, plus the cross-run metrics and live activity.
  `resetForResume` captures `currentOutcome()` into `_superseded`, increments the ordinal, and clears the outcome fields; claims survive it.
- `src/lifecycle/subagent.ts` (846 lines): `currentRun?: SubagentRun` is undefined until `run()`; `isBackground` falls back to `spawnedInBackground`; the session's `askParent`/`notifyParent` callbacks are bound once at session creation and survive resumes; `waitUntilSettled` returns the `WaitOutcome` union.
- `src/lifecycle/subagent-manager.ts`: `create` seeds `new SubagentState({ status: isBackground ? "queued" : "running", startedAt })`; `startResume` calls `agent.claim()` or `agent.releaseClaims()` before `agent.resume()`; the retention sweep reads `consumed`/`consumedAt`/`completedAt`/`pendingQuestion` through `Subagent` getters.
- `src/tools/get-result-tool.ts`: `collectOutcome` claims, waits, and on `superseded` releases its claim without marking consumption; `buildReport`/`buildGetResultDetails` read outcome fields from a `SettledOutcome`.
- A queued background agent can be claimed by a `wait: true` before its slot opens, so the initial run must exist from the record's construction, not from `run()`.
- AGENTS.md constraints that apply: run Vitest from the root with `pnpm --filter @gotgenes/pi-subagents exec vitest run <path>`; `pnpm --silent fallow guard <file>` before a cross-directory import (none is added: every new edge is inside `lifecycle/`, and `tools/` already imports `lifecycle/`).

## Design Overview

### The run's lifecycle

A run is born queued, started once, and ended once:

```typescript
export class SubagentRun implements RunOutcome {
	constructor(kind: RunKind, inBackground: boolean, init?: RunOutcomeInit);
	/** Wire the caller's signal (born aborted when it already fired) and transition to running. */
	start(startedAt: number, callerSignal: AbortSignal | undefined, onCallerAbort: () => void): void;
	// terminal transitions: markCompleted, markAborted, markError, markStopped, stopQueued
	// delivery: claim(): CarrierClaim, claimed, markConsumed(at?), consumed, consumedAt
	// outcome facts: setPendingQuestion, setWorkspaceNotice, setTurnBudget, recordUpdate, markUpdateAnnounced
	/** A later run replaced this one; the resume that started it answers this run's question. */
	markReplaced(): void;
	// existing handles: signal, aborted, abort(), attachObserver(), release()
}
```

`Subagent`'s constructor creates the initial run from `init.isBackground` (and `init.outcome`, a fixture-only seed), so `currentRun` is never undefined and `spawnedInBackground` goes.
`run()` calls `currentRun.start(now, execution.signal, () => this.abort())`; `continueSession` releases and marks the previous run replaced, then creates and starts the resume run, born claimed when `claimOutcome` is set.
Each run start calls `state.markProgress(startedAt)`, which replaces the `lastProgressAt` line of the reset.

The `start` split keeps [#1049]'s guarantees: the lever exists from construction, and a run started with a fired signal is born aborted and stops before the workspace or the session costs anything.
Before `start`, nothing reads the lever: a queued agent is stopped by `stopQueued`, never by `abort()`.

### What a carrier holds

```typescript
/** What one run ended with (or has so far), as a carrier reads and records it. */
export interface RunOutcome {
	readonly status: SubagentStatus;
	readonly result: string | undefined;
	readonly error: string | undefined;
	readonly startedAt: number;
	readonly completedAt: number | undefined;
	readonly stoppedWhileQueued: boolean;
	/** Undefined once a later run replaced this one: that resume is the answer. */
	readonly pendingQuestion: string | undefined;
	readonly workspaceNotice: string | undefined;
	readonly runUpdates: readonly string[];
	readonly turnBudget: TurnBudget | undefined;
	/** A resume replaced this run after it settled. */
	readonly replaced: boolean;
	isActive(): boolean;
	markConsumed(at?: number): void;
}
```

`Subagent.waitUntilSettled(signal): Promise<RunOutcome>` captures the current run and its promise handle, waits, and returns that run.
`Subagent.latestRun: RunOutcome` is the current run for the non-wait path.
The waiter's call site:

```typescript
const claim = record.claim(); // lands on the current run, the one the wait captures next
const run = await record.waitUntilSettled(bound?.signal ?? signal);
if (run.isActive()) claim.release(); // interrupted or expired
else run.markConsumed(); // the waited run, never a resume that replaced it
// report: outcome fields from `run`; stats, model, transcript, resumeRefusal, progress from `record`
// resumedWhileWaiting: run.replaced
```

`buildReport` and `buildGetResultDetails` take the `RunOutcome`; `stoppedWhileQueued` is read from it rather than the live record.
`liveOutcome`, `withoutQuestion`, and `CollectedOutcome.superseded` are deleted.

### One consumption change, unobservable

Today a waiter whose run a resume replaced releases its claim and marks nothing, because consumption is record-wide and marking it would silence the resume's nudge.
With per-run consumption the waiter marks the run it waited on consumed and keeps its claim, which is the same rule it applies to a run that was not replaced.
No reader can tell: `record.consumed`, the retention sweep, and `NotificationManager` all read the current run, and the replaced run's own nudge was already suppressed by the waiter's claim at its terminal edge.
The existing test "leaves the resumed run's outcome uncollected" (`get-result-tool.test.ts`) pins that the resume stays unconsumed.

### Per-run facts that used to survive a resume

`resetForResume` never cleared `workspaceNotice` or `stoppedWhileQueued`, so on the old record a resumed agent kept them; on a new run they start empty.
Neither difference is observable, because a record carrying either fact refuses every resume:

- `stoppedWhileQueued` is set only on a never-started agent, which has no session (`no-session`).
- A workspace notice is recorded only when a provider disposed a workspace, by a failed run (`workspace-disposed`) or by a session release or teardown (`session-released`, or the record is gone).

### A terminal transition lands on the run it ends

`complete(run, …)`, `fail(run, …)`, and `endBeforeStart(run)` already receive their run; after the move they transition that run rather than whatever run is current.
On today's record, an aborted run whose turn loop is still unwinding when a resume starts would write its late completion onto the resumed run's shared fields.
After the move that write lands on the aborted run, and step 7 pins it.
Whether a front door can reach that window (a resume issued while Pi's `prompt()` for the aborted run has not yet resolved) was not verified at planning time; if the implementing session finds it reachable through `steer_subagent`, the `Agent` tool, or the service, retype step 7 `fix:`.

### Seeding a run in tests

`RunOutcomeInit` seeds the outcome fields, including `runUpdates` (each replayed through `recordUpdate`).
`SubagentInit.outcome?: RunOutcomeInit` seeds the initial run; production never passes it (step 3 drops the manager's redundant seed).
`SubagentInit.state` stays, so `test/service/service-adapter.test.ts` (`new SubagentState({ lifetimeUsage })`) compiles unchanged.
`createTestSubagent`'s `TestSubagentOptions` keeps its shape; the helper splits the keys between `state` and `outcome`, and defaults `lastProgressAt` to `startedAt` as `SubagentState` does today.

### Sweep ride-along

The sweep tests install `vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })` before creating the manager and fire the sweep with `vi.advanceTimersByTime(60_000)`; `Date` stays real, so the existing `Date.now` spies keep setting the clock.
The `hasRef()` reach becomes a `process.getActiveResourcesInfo()` count of `"Timeout"` entries before and after `createManager`, which an unref'd interval does not change.
Both were spiked at planning time in a disposable test (since deleted): the sweep test passed through the real interval, and deleting `this.sweepInterval.unref()` turned the timer-count test red (measured).

### Design-review checklist

- Dependency width: `RunOutcome` carries exactly what `get-result-tool.ts` reads from the waited run (the ten outcome fields, `replaced`, `isActive()`, `markConsumed()`); claims stay on `Subagent.claim()`, so the interface does not grow a `claim`.
- Law of Demeter: the tool reads `run.status`, not `record.currentRun.status`; `Subagent`'s one-line getters keep every other consumer off the run.
- Scattered resets: `resetForResume` and `markRunning`'s ledger clear go; a resume constructs a new run.
- Output arguments: none added; `markReplaced()` is a transition the record tells the run it owns.
- Import edges: `subagent-run.ts` gains imports of `subagent-state.ts` (status vocabulary) and `turn-limits.ts` (`TurnBudget`); neither imports `subagent-run.ts`, so no cycle.
  `get-result-tool.ts` swaps its `subagent-state` type import for `subagent-run`, inside the `tools → lifecycle` edge it already has.

## Module-Level Changes

- `src/lifecycle/subagent-run.ts`: the constructor drops the signal arguments and gains `init?: RunOutcomeInit`; `start(startedAt, callerSignal, onCallerAbort)`; the outcome fields and transitions listed above; `CarrierClaim` (moved from `subagent-state.ts`), `RunOutcome`, `RunOutcomeInit`; `markReplaced`/`replaced`; instance predicates (`isActive`, `isTerminalError`, `isRunning`, `canBeSteered`); header comment rewritten.
- `src/lifecycle/subagent-state.ts`: loses every outcome field, `SettledOutcome`, `CarrierClaim`, `RunUpdate`, the run ordinal, `_superseded`, `supersededOutcome`, `currentOutcome`, `markRunning`, the terminal transitions, `markConsumed`, `claim`/`releaseClaims`, `setPendingQuestion`, `setWorkspaceNotice`, `setTurnBudget`, `recordUpdate`, `markUpdateAnnounced`, `resetForResume`, and the instance predicates; `SubagentStateInit` keeps `lastProgressAt`, `toolUses`, `lifetimeUsage`, `compactionCount`, `activeTools`, `responseText`; `lastProgressAt` defaults to `Date.now()`; header comment rewritten.
  `SubagentStatus` and the exported status predicates stay.
- `src/lifecycle/subagent.ts`: `currentRun` non-optional and created in the constructor; `spawnedInBackground` removed; `SubagentInit.outcome`; getters read through to `currentRun`; `run()`/`continueSession` start runs and mark progress; `ResumeRunOptions.claimOutcome`; `askParent`/`notifyParent` write to the current run; `onTurnBudget` to the run passed in; `complete`/`fail`/`endBeforeStart`/`abort`/`stopQueued`/`disposeWorkspaceQuietly` transition a named run; `waitUntilSettled` returns `RunOutcome`; `latestRun`; `markRunning`, `releaseClaims`, `resetForResume`, `WaitOutcome` removed.
  `lifecycle/subagent.ts` line count: 846 today, estimated 800–840 after (estimated).
- `src/lifecycle/subagent-manager.ts`: `create` stops passing `state`; the `SubagentState` import goes; `startResume` passes `claimOutcome` into `agent.resume` and drops the claim/release pair and its `resetForResume` comment; `ResumeCallOptions` inherits `claimOutcome` from `ResumeRunOptions` (its JSDoc moves there).
- `src/tools/get-result-tool.ts`: as in "What a carrier holds".
- `src/tools/get-result-report.ts`: predicted unchanged (`resumedWhileWaiting` keeps its type and rendering).
- `src/observation/notification.ts`, `src/observation/outcome-delivery.ts`, `src/service/*`, `src/lifecycle/record-observer.ts`, `src/persisted-record.ts`: predicted unchanged; each reads through `Subagent` getters or `SubagentState` members that stay (`record-observer` calls only the metric and activity methods, plus `markProgress`).
- `test/lifecycle/subagent-run.test.ts`: constructor sites migrate to `start()`; gains the outcome `describe` blocks migrated from `subagent-state.test.ts` slice by slice, plus `markReplaced`.
- `test/lifecycle/subagent-state.test.ts`: shrinks to the metric, activity, and `lastProgressAt` blocks and the exported status-function block.
- `test/lifecycle/subagent.test.ts`: `makeSubagent` stops extending `SubagentStateInit`; the three `markRunning(Date.now())` sites (lines ~389, ~397, ~1673) seed `status: "running"`; the `state.consumedAt` (~332) and `state.setTurnBudget` (~302–318) arranges are rewritten; `waitUntilSettled` tests (~1219–1297) assert on the returned run; new tests named in the TDD Order.
- `test/lifecycle/subagent-manager.test.ts`: the sweep ride-along; the `resetForResume` comment (~1566) is reworded.
- `test/tools/get-result-tool.test.ts`: the two `agent.claim(); void agent.resume(…)` observers (~137, ~189) become `agent.resume(…, { background: true, claimOutcome: true })`; the superseded `describe` keeps its five assertions.
- `test/tools/agent-tool.test.ts`: the `resetForResume` comment (~318) is reworded.
- `test/helpers/make-subagent.ts`: seeds split by owner; predicted call-site-neutral for its ~250 callers.
- `test/lifecycle/record-observer.test.ts`: the unread `status` seeds (lines 7, 228) are dropped.
- `test/observation/notification.test.ts`: `record.claim(); record.releaseClaims();` (~675) becomes `record.claim().release()`.
- `test/service/service-adapter.test.ts`: predicted unchanged (the issue's constraint).
- `docs/architecture/architecture.md`:
  - The module-tree lines for `subagent-run.ts`, `subagent-state.ts`, `subagent.ts`, and `get-result-tool.ts` change.
  - The `Key domain types` class diagram gains `SubagentRun` with the outcome and `Subagent --> SubagentRun : current run`, and `SubagentState` shrinks.
  - The `Agent lifecycle` state diagram replaces the four `resetForResume` edges with a resume starting a new run, and the note below it ("only `resetForResume` can return it to `running`") is reworded.
  - The first-principles prose naming `consumedAt` on `SubagentState` and the `resetForResume` paragraph under "A subagent is a sequence of runs" change.
  - The roadmap step gets its ✅ heading, its ✅ Mermaid node, and a `Landed:` note with the measured rows.
- `.pi/skills/package-pi-subagents/SKILL.md`: line 29 ("the run's ledger on `SubagentState`") names `SubagentRun`; the Lifecycle row of the domain table rewords "lifecycle-state value object, per-run abort lever" to the run owning its outcome.

## Test Impact Analysis

1. Newly enabled tests: a run's outcome transitions, claims, consumption, and ledger as pure `SubagentRun` facts, including two runs that do not share them; `markReplaced` hiding the question; a late terminal transition of an aborted run landing on that run.
2. Redundant tests: the `subagent-state.test.ts` `resetForResume`, `run ordinal`, and `superseded outcome` blocks are deleted rather than migrated, since the mechanism is gone.
   Their claims (a resume starts unconsumed, unclaimed unless asked, with no updates owed, with a fresh start time) are pinned at the `Subagent` level by tests the steps name.
3. Tests that stay as-is: the `get-result-tool.test.ts` superseded `describe` (five assertions, arrange migrated), the `subagent-manager.test.ts` #987 announcement tests, the notification claim and ledger tests, and every `createTestSubagent` caller.

## Invariants at risk

| Invariant (source)                                                                                       | Constituency                                          | Pinned by                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A run started with a fired signal stops before workspace or session cost ([#1049] Landed)                | Parent whose interrupt arrived during setup           | `subagent.test.ts` "a signal that already fired" block; `subagent-run.test.ts` "is born aborted when the signal has already fired"                            |
| Both run kinds hold the workspace of a completed run that declared a question ([#1050] Landed)           | Parent answering a question by resume                 | `subagent.test.ts` run-kind terminal grid (~1755–1937)                                                                                                        |
| `isBackground` reports the current run's mode, the spawn's before the first run ([#1012] Landed)         | Widget, `SubagentRecord.isBackground` consumers       | `subagent-manager.test.ts` "stamps the resolved mode on the record…" (~265, ~271, ~322) and the widget tests over `createTestSubagent`                        |
| A waiter releases only its own claim; a waiter a resume overtook reports the run it waited for ([#1015]) | Parent collecting via `wait: true`; a claimed resumer | `get-result-tool.test.ts` "carrier claim" and "a wait a resume superseded" blocks; `subagent-manager.test.ts` duplicate-nudge test                            |
| A resume nobody claims is announced ([#987])                                                             | Parent of a background resume                         | `subagent-manager.test.ts` "announces an unclaimed resume of an agent a foreground spawn delivered" / "…a claimed resume delivered" (~1683, ~1692)            |
| An update reaches the parent exactly once, through whichever channel could ([#872], [#903])              | Parent reading updates                                | `notification.test.ts` ledger and claim tests (real `Subagent` via `createTestSubagent`); `subagent.test.ts` "keeps the channel live across a resume" (~1120) |
| A resume's start counts as progress ([#947])                                                             | Parent reading `Progress:`                            | `subagent-state.test.ts` "restarts at the resumed run's start on resume" today; step 7 re-pins it at the `Subagent` level                                     |

Each named test file builds a real `Subagent` (or `SubagentRun`) and mocks only the session, so none mocks the layer under change.

## TDD Order

1. `test(pi-subagents): drive the retention sweep through its interval in tests`
   - Roadmap ride-along.
   - `subagent-manager.test.ts` "consumption-aware session release sweep": a `beforeEach` installs `vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })`, the `afterEach` restores real timers, and each `(manager as any).sweep()` becomes `vi.advanceTimersByTime(60_000)`.
   - "cleanup timer": `(manager as any).sweepInterval.hasRef()` becomes the `process.getActiveResourcesInfo()` `"Timeout"` count, equal before and after `createManager()`.
   - Killing mutation (timer class): delete `this.sweepInterval.unref();` in the `SubagentManager` constructor; kills "does not keep the process alive on its own" (measured at planning).
   - Killing mutation (sweep class): replace `() => this.sweep()` with `() => {}` in the `setInterval` call; kills "releases a consumed agent's session…", "holds an unconsumed agent's session past 10 min and releases it at the cap", and "honors a custom retention policy…"; "never releases a running or queued agent's session" and "leaves records in place after release" stay green (predicted; they assert no release or record survival).
   - Verify: `grep -c 'as any' packages/pi-subagents/test/lifecycle/subagent-manager.test.ts` reads 0 (from 8).
2. `refactor(pi-subagents): give a subagent its initial run from construction`
   - Tidy-First: every later step re-points getters at `currentRun`, which this makes non-optional, and a queued agent becomes claimable on a real run.
   - `SubagentRun` constructor `(kind, inBackground)`; `start(callerSignal, onCallerAbort)` holds today's wiring (the `startedAt` parameter arrives in step 7).
     `Subagent`'s constructor creates the initial run; `run()` starts it; `continueSession` creates and starts the resume run; `spawnedInBackground` goes.
   - Tests: the `subagent-run.test.ts` constructor sites migrate to `start()`; new test "wires the caller's signal only once started": a signal that fires between construction and `start()` calls no `onCallerAbort`, and the run reads aborted after `start()`.
   - Killing mutation: in `start()`, drop the `if (callerSignal.aborted) { this.controller.abort(); return; }` branch; kills the new test and "is born aborted when the signal has already fired".
   - Killing mutation: construct the initial run with `inBackground: false` in `Subagent`'s constructor; kills `subagent-manager.test.ts` "stamps the resolved mode on the record when it resolves to background".
3. `refactor(pi-subagents): stop seeding the initial status in SubagentManager.create`
   - Tidy-First: production then never seeds a run, so only fixtures need `SubagentInit.outcome`.
   - `create` drops `state: new SubagentState({ status, startedAt })` and the import.
     The foreground `running` seed is unobservable: `create` calls `record.start()` synchronously, `guardedRun` admits a queued status, and `run()` marks running before anything reads it.
   - No new tests; pinned by "clearCompleted does not remove running or queued agents" and the `spawnFg` tests.
4. `test(pi-subagents): name fixture seeds by owner ahead of the outcome move`
   - Tidy-First: both fixtures forward seeds with a rest spread, so a key leaving `SubagentStateInit` would be dropped silently at runtime rather than rejected by `tsc`.
   - `createTestSubagent` destructures the outcome keys and the cross-run keys explicitly, re-merged into one `SubagentState` init for now, preserving an explicit `completedAt: undefined` override (`make-subagent.test.ts` ~88) and `lastProgressAt ?? startedAt`.
   - `subagent.test.ts`'s `MakeSubagentOptions` stops extending `SubagentStateInit` and lists its keys.
   - `record-observer.test.ts` drops its unread `status` seeds; `notification.test.ts` ~675 becomes `record.claim().release()`.
   - No new tests; the suite stays green.
5. `refactor(pi-subagents): keep the replaced run's outcome on Subagent while the outcome moves`
   - Tidy-First scaffold, deleted in step 10: `SubagentState.currentOutcome()` reads every outcome field, so moving any one of them first would break the `_superseded` snapshot.
   - The slot moves to `Subagent`: `continueSession` snapshots the outgoing run's outcome from `Subagent`'s own getters before starting the resume, and `waitUntilSettled` compares run identity instead of an ordinal.
     `SubagentState` loses `_run`, `run`, `_superseded`, `supersededOutcome`, and `currentOutcome`.
   - Tests: the `subagent-state.test.ts` "run ordinal" and "superseded outcome" blocks are deleted; "keeps only the most recently superseded run" is ported to `subagent.test.ts`, beside "reports the waited run's outcome when a resume replaced it" (~1277).
   - Killing mutation: take the snapshot after the resume run starts; kills ~1277 and the `get-result-tool.test.ts` "reports the run it waited for…".
   - Verify: `grep -c '_superseded' packages/pi-subagents/src/lifecycle/subagent-state.ts` reads 0 (from 3).
6. `refactor(pi-subagents): give each run its own claims and consumption`
   - `CarrierClaim`, the claim set, `consumedAt`/`consumed`/`markConsumed` move to `SubagentRun`; `RunOutcomeInit` and `SubagentInit.outcome` arrive with `consumedAt`; fixtures move that key.
   - `ResumeRunOptions.claimOutcome`; `continueSession` claims the new run when set; `startResume` drops `claim()`/`releaseClaims()`; `releaseClaims` is deleted from `Subagent` and `SubagentState`.
   - Tests: the "consumption" and "carrier claim" blocks move to `subagent-run.test.ts` (minus "survives resetForResume"); `get-result-tool.test.ts` ~137 and ~189 switch to `claimOutcome: true` in this commit, since a claim taken before the resume now lands on the settled run; `subagent.test.ts` ~332 rewritten.
   - New test (`subagent.test.ts`): "a claim on a settled run does not claim the resume that follows it".
   - Killing mutation: make `continueSession` claim the new run whenever the previous run is claimed; kills the new test and `subagent-manager.test.ts` "leaves the outcome unclaimed by default".
   - Killing mutation: make `continueSession` ignore `options.claimOutcome`; kills "claims the outcome before the turn loop starts when the caller asks" and `get-result-tool.test.ts` "leaves a claimed resume's claim in place when the wait wakes after the resume started".
   - Killing mutation: seed the resume run with the previous run's `consumedAt`; kills the #987 announcement tests (~1683, ~1692).
7. `refactor(pi-subagents): give each run its own status, result, and timestamps`
   - Status, result, error, `startedAt`, `completedAt`, `stoppedWhileQueued`, the terminal transitions, `stopQueued`, and the instance predicates move to `SubagentRun`; `start(startedAt, …)` marks running; each run start calls `state.markProgress(startedAt)`; `SubagentState.lastProgressAt` defaults to `Date.now()`.
   - `SubagentState.markRunning` and `Subagent.markRunning` go; the three test sites seed `status: "running"`.
   - `complete`/`fail`/`endBeforeStart` transition the run they receive; `abort` and `stopQueued` transition the current run.
   - Tests: the "markRunning", "markCompleted", "markAborted", "markError", "markStopped", "stopQueued", constructor-outcome, and instance-predicate blocks move to `subagent-run.test.ts`; the `lastProgressAt` "restarts at the run's start" / "…on resume" tests become `subagent.test.ts` "a run's start counts as progress" and "a resume's start counts as progress".
   - New test (`subagent.test.ts`): "a late completion of an aborted run lands on that run, not on the resume that replaced it" (the first turn loop ignores its signal and resolves after a resume started; the record still reads `running`).
   - Killing mutation: make `complete()` call `this.currentRun.markCompleted(…)` instead of `run.markCompleted(…)`; kills the new test.
   - Killing mutation: delete the `state.markProgress(startedAt)` call in `continueSession`; kills "a resume's start counts as progress".
   - Commit type: `refactor:`, unless the implementing session finds the late-completion window reachable through a front door (see Design Overview), then `fix:`.
8. `refactor(pi-subagents): give each run its own question, workspace notice, and turn budget`
   - The three fields and their setters move to `SubagentRun`; `askParent` writes to `this.currentRun` (a session-lifetime callback); `onTurnBudget` writes to the run `runOnSession` received; `fail` clears the question on its run; `disposeWorkspaceQuietly` takes the run that records the notice (the failing run, or the current run for a held-workspace teardown).
   - Tests: the "turn budget" block and the seeding cases move to `subagent-run.test.ts`; `subagent.test.ts` ~302–318 rewritten to seed through `outcome` or drive the turn loop.
   - Killing mutation: capture `const run = this.currentRun` at session creation and bind `askParent` to it; kills "records a follow-up question a resumed run declares" (~1348).
   - Killing mutation: bind `onTurnBudget` to the initial run; kills "shows the budget the resumed turn loop reports while the resume is going" (~2018).
9. `refactor(pi-subagents): give each run its own update ledger, and start a resume as a new run`
   - The ledger (`recordUpdate`, `markUpdateAnnounced`, `runUpdates`) moves to `SubagentRun`, seedable through `RunOutcomeInit.runUpdates` for fixtures; `announceUpdate` records on `this.currentRun`.
   - `resetForResume` is deleted from `Subagent` and `SubagentState`; `continueSession` releases the previous run and starts a new one; every `resetForResume` mention in `src/` comments goes.
   - Tests: the "run updates" and "the announcement latch" blocks move to `subagent-run.test.ts`; the `resetForResume` block is deleted; new `subagent.test.ts` test "a resume starts with no updates owed".
   - Killing mutation: seed the resume run with `runUpdates: previous.runUpdates`; kills the new test.
   - Killing mutation: make `announceUpdate` record on the initial run; kills "keeps the channel live across a resume, whose parent is blocked awaiting it" (~1120).
   - Verify: `grep -rhoE 'resetForResume' packages/pi-subagents/src | wc -l` reads 0 (from 8).
10. `refactor(pi-subagents): hand a get_subagent_result waiter the run it waited on`
    - `markReplaced`/`replaced`, the question hidden once replaced, `RunOutcome`; `waitUntilSettled` returns the captured run; `latestRun`; `WaitOutcome`, `SettledOutcome`, and step 5's scaffold go.
    - `get-result-tool.ts` as in "What a carrier holds".
    - Tests: `subagent.test.ts` `waitUntilSettled` block asserts on the returned run (`isActive()`, `status`, `result`, `replaced`); `subagent-run.test.ts` "a replaced run reports no open question"; the `get-result-tool.test.ts` superseded block passes with its assertions unchanged.
    - Killing mutation: return `this.currentRun` read after the await; kills ~1277 and `get-result-tool.test.ts` "reports the run it waited for, and that the agent is running again" and "summarises the run it waited for in the TUI details".
    - Killing mutation: make `pendingQuestion` ignore `replaced`; kills "drops the question the resume is already answering" and the new run-level test.
    - Killing mutation: call `record.markConsumed()` instead of `run.markConsumed()` in `collectOutcome`; kills "leaves the resumed run's outcome uncollected".
    - Killing mutation: delete `previous.markReplaced()` in `continueSession`; kills the resumed-line assertion in "reports the run it waited for…".
11. `docs(pi-subagents): record that each run owns its outcome`
    - The `docs/architecture/architecture.md` and `SKILL.md` edits listed under Module-Level Changes, including the roadmap ✅ heading, ✅ Mermaid node, and `Landed:` note with re-measured rows (`_superseded`, `resetForResume`, `as any`, `lifecycle/subagent.ts` lines, `fallow dupes`, health score).
    - Re-read both Mermaid diagrams against the `mermaid` skill.

No `Co-authored-by:` trailer: the mechanism comes from the operator's own issue, and #1058 is not adopted here.

## Risks and Mitigations

- Fixture seeds dropped silently: mitigated by step 4's explicit partition, which turns a misplaced key into a `tsc` error in every later step.
- Session-lifetime callbacks bound to the wrong run: `askParent`/`notifyParent` are created once per session and serve every resume; steps 8 and 9 route them through `this.currentRun` and name the killing mutations that pin it.
- The step 5 scaffold lives for four commits: it is deleted in step 10, and step 10's verification includes `grep -rn 'supersededOutcome\|_superseded' packages/pi-subagents/src` printing nothing.
- `fallow dupes`: today's only clone group pairs `SubagentStateInit` with `TestSubagentOptions` (21 lines, measured).
  The init shrinks to six keys, and a group pairing `RunOutcomeInit` with the fixture options may form instead; re-measure at step 11 and record the result in the `Landed:` note.
- `fallow dead-code` (0 today): members a later step deletes (`releaseClaims`, `resetForResume`, the scaffold) are removed in the step that drops their last caller, so no step leaves an unused export.
- #1058 is unchanged by this refactor, and still reproduces afterwards: `NotificationManager` reads `claimed`, `consumed`, and `isActive()` through the record's current run, exactly as it reads the record's fields today.

## Open Questions

None.

[#872]: https://github.com/gotgenes/pi-packages/issues/872
[#903]: https://github.com/gotgenes/pi-packages/issues/903
[#947]: https://github.com/gotgenes/pi-packages/issues/947
[#987]: https://github.com/gotgenes/pi-packages/issues/987
[#1012]: https://github.com/gotgenes/pi-packages/issues/1012
[#1013]: https://github.com/gotgenes/pi-packages/issues/1013
[#1015]: https://github.com/gotgenes/pi-packages/issues/1015
[#1049]: https://github.com/gotgenes/pi-packages/issues/1049
[#1050]: https://github.com/gotgenes/pi-packages/issues/1050
[#1058]: https://github.com/gotgenes/pi-packages/issues/1058
