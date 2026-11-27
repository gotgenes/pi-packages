---
issue: 1058
issue_title: "pi-subagents: withheld notifications cross resume boundaries and emit stale or contradictory run status"
---

# Name the run in every end-of-run and update notice

## Release Recommendation

**Release:** ship independently

The issue is not part of any `pi-subagents` roadmap step (no `(#1058)` reference in `docs/architecture/architecture.md`, and no improvement phase is open).
Steps 5–7 are `fix:` commits, so the change cuts a `pi-subagents` patch release.

## Problem Statement

A background child's completion nudge and its mid-run updates are withheld while the parent's agent run is active, then flushed when it settles.
The withheld queue stores the `Subagent` record, and every `Subagent` outcome getter reads the record's *current* run.
When a resume replaces run A with run B before the flush, A's announcements are rendered and gated from B:

- A's completion nudge goes out as `<status>Done</status>`, `<summary>… running</summary>`, `<result>No output.</result>`, followed by a `get_subagent_result` pointer that now returns B.
- A's update is announced as live progress with "The agent is still running.
  Steer it…", even after A's collected outcome already rendered it.

The issue's reporter (tonybro233) supplied a focused reproduction against 23.2.0 and suggested retaining the originating run with each announcement so a replacement run cannot authorize it.

Planning found a second trigger with no withholding at all.
`Subagent.abort()` marks the run `stopped` synchronously while its turn loop unwinds, and a resume may start in that window.
A's late `complete(run, …)` then fires `onRunFinished(agent, kind)`, and every reader falls through to B:

- with the parent idle, the same contradictory nudge is sent immediately;
- the lifecycle event goes out on `subagents:completed` (the channel is chosen from `record.isTerminalError()`, which reads B) with `status: "running"`;
- the persisted `subagents:record` entry says `running` for a run that ended `stopped`.

The root cause is one fact missing from the wiring: the observer hooks name the **agent**, not the **run**, so no reader can know which run a notice is about.

## Goals

- Every end-of-run notice and every update notice names the run it belongs to, from the producer (`Subagent`) to every reader.
- A withheld completion is gated and rendered from its own run: it is dropped when that run was claimed, consumed, or **replaced by a resume** (the operator's call: a resume supersedes the earlier run's announcement).
- A withheld update is gated from its own run: announced only while that run is unclaimed and still active, so an earlier run's update is never presented as live progress for a later one.
- The lifecycle event (`subagents:completed`/`failed`/`resumed`) and the persisted `subagents:record` entry describe the run that finished, not the run that replaced it.
- Non-breaking: no message shape, event payload shape, entry shape, or default changes; only output built from the wrong run changes.

## Non-Goals

- Delivering a replaced, uncollected run's outcome as a historical nudge.
  The operator chose drop: today's rule already lets a later run's completion supersede an earlier one for the same agent, and the bug was the only path that ever announced an earlier run after a resume.
  The replaced run's result stays in its transcript and in the resumed child's context.
- `onRunStarted(agent, kind)` keeps `kind`: it fires synchronously as the run starts, so the started run is the current run by construction, and its readers use only the agent's identity.
- The workspace an aborted run's late completion disposes while its resume runs there: filed as [#1155].
  Threading the run does not change it; it is a lifecycle defect in `complete()`/`fail()`, not a reporting one.
- Foreground carriers (`foreground-runner.ts`, `AgentTool.resumeExisting`) still mark `record.markConsumed()` on the current run after awaiting; recorded as a Non-Goal in #1051's plan and unchanged here.
- `Subagent.claimed` keeps its getter: after step 6 its only `src/` reader is gone, but 16 test references use it as observable claim state (assessor's count).
  If `pnpm fallow dead-code` flags it at step 6, retarget those reads to `record.latestRun.claimed` in the same step rather than suppressing.
- Merging the persisted-record writer with Phase 24's restore work (PR [#1136]); the entry's shape does not change.

## Background

- `src/lifecycle/subagent-run.ts` — `SubagentRun` owns one run's outcome (status, result, timestamps, question, notice, budget, update ledger, consumption, claims) and its `replaced` flag ([#1051]).
  `RunOutcome` is the read-and-record view carriers hold; it lacks `kind`, `claimed`, `consumed`, `isTerminalError()`, and `markUpdateAnnounced()`, all of which `SubagentRun` already implements.
- `src/lifecycle/subagent.ts` — `Subagent` delegates every outcome getter to `currentRun`.
  `complete(run, …)`, `fail(run, …)`, and `endBeforeStart(run)` already transition the run they receive (the #1051 late-completion fix), then call `observer.onRunFinished(this, run.kind)`; `stopQueued()` passes `this.currentRun.kind`.
  `announceUpdate(message)` records on `currentRun` and calls `observer.onUpdateSent(this, message)` synchronously.
- `src/lifecycle/subagent-manager.ts` — `buildObserver` relays the per-agent hooks to the manager-level `SubagentManagerObserver` (`onSubagentRunFinished(record, kind)`, `onSubagentUpdate?(record, message)`).
- `src/observation/composite-subagent-observer.ts` fans out to `SubagentEventsObserver` and `AgentWidget` (wired in `src/index.ts`); the widget ignores both arguments and repaints.
- `src/observation/subagent-events-observer.ts` — on a finished run: emits on `finishedChannel(record, kind)` with `buildEventData(record)`, appends `toPersistedRecord(record)`, and calls `notifications.sendCompletion(record)`; on an update: emits `subagents:update` and calls `notifications.sendUpdate(record, message)`.
- `src/observation/notification.ts` — `NotificationManager` withholds announcements in one arrival-ordered queue (`PendingAnnouncement` holds the record) and re-checks each at emit: a completion on `record.claimed`/`record.consumed`, an update on `canAnnounceUpdate(record)` (`!record.claimed && record.isActive()`).
  A completion for an agent supersedes an earlier queued one for the same agent id in place.
- `src/tools/get-result-tool.ts` is the precedent for the rendering split: "outcome fields from the collected run, everything else from the live record".
- `src/persisted-record.ts` — `toPersistedRecord(record)` accepts anything shaped like `PersistedSubagentRecord`; a `Subagent` satisfies it structurally.

AGENTS.md constraints that apply: `pnpm` only; the `pi-autoformat` reflow after every edit; `fallow guard` before a cross-directory import (none is added: `observation/` and `ui/` already import from `lifecycle/subagent-run`).

## Design Overview

### How the reproduction was produced

A disposable vitest spike (deleted before this commit) under `packages/pi-subagents/test/`, run once per case on `main` (deterministic code, n=1, no cache involved).
Input was synthetic: records built with `createTestSubagent({ sessionReady: true })`, driven through the **real** `Subagent.resume`/`Subagent.run`/`abort`, the real `NotificationManager`, `buildEventData`, and `toPersistedRecord`.
Every case emitted the stale output:

| Case                                                       | Observed                                                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Withheld completion, A collected, background resume B      | `<status>Done</status>` / `running` / `No output.`                                                                     |
| Withheld completion, A uncollected, background resume B    | same                                                                                                                   |
| Withheld update, A completed and collected, resume B       | `<subagent-update>` with "The agent is still running"                                                                  |
| Parent idle; abort A, resume B, A's turn loop then returns | same contradictory nudge sent at once; event `status: "running"`, `isTerminalError()` false; entry `status: "running"` |

The control is the existing suite: the same flows without a resume deliver correctly (`notification.test.ts` "parent-turn boundary").

### Decision model

The run travels with the notice.
`Subagent` is the only party that knows which run ended or which run an update joined, so it names it at the source, and every relay passes it through unchanged.

```typescript
// src/lifecycle/subagent-run.ts — RunOutcome grows, in the step that first reads each member
export interface RunOutcome {
	readonly kind: RunKind;            // step 4
	readonly claimed: boolean;         // step 6
	readonly consumed: boolean;        // step 6
	isTerminalError(): boolean;        // step 5
	markUpdateAnnounced(message: string): void; // step 7
	// …existing members unchanged
}

// src/lifecycle/subagent.ts
interface SubagentLifecycleObserver {
	onRunFinished?(agent: Subagent, run: RunOutcome): void;              // was (agent, kind)
	onUpdateSent?(agent: Subagent, run: RunOutcome, message: string): void; // was (agent, message)
}

// src/lifecycle/subagent-manager.ts
interface SubagentManagerObserver {
	onSubagentRunFinished(record: Subagent, run: RunOutcome): void;
	onSubagentUpdate?(record: Subagent, run: RunOutcome, message: string): void;
}

// src/observation/notification.ts
interface NotificationSystem {
	sendCompletion(record: Subagent, run: RunOutcome): void;
	sendUpdate(record: Subagent, run: RunOutcome, message: string): void;
	// sendWorkspaceNotice, dispose unchanged
}
type PendingAnnouncement =
	| { kind: "completion"; record: Subagent; run: RunOutcome }
	| { kind: "update"; record: Subagent; run: RunOutcome; message: string };
```

`kind` leaves the hook signatures because it is a projection of the run (`run.kind`).

Consumer call site in the events observer (Tell-Don't-Ask holds: each reader receives both facts and asks neither the record for the run nor the run for the record):

```typescript
onSubagentRunFinished(record: Subagent, run: RunOutcome): void {
	this.emit(finishedChannel(run), buildEventData(record, run));
	this.appendEntry(SUBAGENT_RECORD_ENTRY, toPersistedRecord(record, run));
	this.notifications.sendCompletion(record, run);
}
```

### Gates

```typescript
/** A completion is announceable while nothing delivered, committed to, or superseded this run's outcome. */
private canAnnounceCompletion(run: RunOutcome): boolean {
	return !run.claimed && !run.consumed && !run.replaced;
}
/** Unchanged rule, now about the run the update joined. */
private canAnnounceUpdate(run: RunOutcome): boolean {
	return !run.claimed && run.isActive();
}
```

Both are consulted at enqueue and again at emit, as today.
`replaced` needs no term in the update gate: a resume is refused while a run is active, so a replaced run is never active.

Scenario table after the change (the replacing run is B):

| Withheld entry | What happened before the flush           | Today                                | After                                         |
| -------------- | ---------------------------------------- | ------------------------------------ | --------------------------------------------- |
| A completion   | A collected, then background resume      | contradictory nudge from B           | dropped (A consumed and replaced)             |
| A completion   | uncollected, background resume running   | contradictory nudge from B           | dropped (A replaced)                          |
| A completion   | uncollected, foreground resume (claimed) | dropped (B claimed)                  | dropped (A replaced)                          |
| A completion   | background resume B already finished     | B's nudge, in A's queue slot         | B's nudge, in A's queue slot (supersede)      |
| A update       | A finished and collected, resume running | announced as live progress           | dropped (A inactive); it rode A's outcome     |
| A update       | A finished uncollected, resume running   | announced as live progress           | dropped (A inactive and replaced)             |
| (idle) late A  | abort A, resume B, A's loop returns      | nudge from B; event and entry from B | no nudge (A replaced); event and entry from A |

The withhold rule's supersede stays keyed by agent id: a later run's completion takes the earlier entry's queue position and replaces its run.
Because a replaced run is dropped at emit anyway, keying per run would only add a dropped entry.

### Rendering

`formatTaskNotification(record, run, max)`, `buildNotificationDetails(record, run, max)`, the manager's private `buildPointerLines(record, run)`, `buildEventData(record, run)`, and `toPersistedRecord(identity, outcome)` take **outcome** fields from the run (status, result, error, turnBudget, startedAt, completedAt, stoppedWhileQueued, runUpdates, workspaceNotice, pendingQuestion) and **identity, location, and cross-run metrics** from the record (id, type, description, toolCallId, outputFile, toolUses, lifetimeUsage, compactionCount, `getContextPercent()`, resumeRefusal).
This mirrors `GetResultTool.buildReport`.

`toPersistedRecord` gets two ISP parameters instead of a `Subagent`:

```typescript
export type PersistedIdentity = Pick<PersistedSubagentRecord, "id" | "type" | "description" | "outputFile" | "toolUses">;
export type PersistedOutcome = Pick<PersistedSubagentRecord, "status" | "result" | "error" | "turnBudget" | "startedAt" | "completedAt" | "stoppedWhileQueued">;
export function toPersistedRecord(identity: PersistedIdentity, outcome: PersistedOutcome): PersistedSubagentRecord;
```

`Subagent` satisfies `PersistedIdentity` and `RunOutcome` satisfies `PersistedOutcome` structurally.

### Edge cases (each tested in the named step)

- A run stopped while queued reports through `stopQueued()` with the current run, which is the queued run itself (step 4, existing "fires observer.onRunFinished once" test migrated to assert the run).
- Abort → resume → late finish: the observer receives the stopped run A, not B (step 4 at `Subagent`, step 5 at the manager and events observer).
- Two completions for the same agent within one parent turn keep the first arrival's queue position (step 6, existing "keeps a re-completed agent in the queue position it first took").
- A replaced run's withheld completion is dropped, collected or not (step 6).
- An earlier run's withheld update is dropped once that run ended, whether or not a resume is running (step 7).

## Module-Level Changes

- `src/lifecycle/subagent-run.ts` — `RunOutcome` gains `kind` (step 4), `isTerminalError()` (step 5), `claimed` and `consumed` (step 6), `markUpdateAnnounced()` (step 7).
  `SubagentRun` already implements each; no class change.
- `src/lifecycle/subagent.ts` — `SubagentLifecycleObserver.onRunFinished(agent, run)` (step 4); `complete`/`fail`/`endBeforeStart` pass `run`, `stopQueued` passes `this.currentRun` (step 4).
  `onUpdateSent(agent, run, message)`; `announceUpdate` captures `this.currentRun` once and both records on and passes it (step 7).
  Remove `Subagent.isTerminalError()` (step 5: sole `src/` caller was `finishedChannel`) and `Subagent.markUpdateAnnounced()` (step 7: sole caller was `notification.ts`).
- `src/lifecycle/subagent-manager.ts` — `SubagentManagerObserver.onSubagentRunFinished(record, run)` (step 5); `onSubagentUpdate?(record, run, message)` (step 7); `buildObserver` relays `run` (step 4 relays `run.kind` to the still-old manager hook; step 5 relays `run`).
- `src/observation/composite-subagent-observer.ts` — forwards the new signatures (steps 5, 7).
- `src/ui/agent-widget.ts` — `onSubagentRunFinished(_record, _run: RunOutcome)` (step 5); its import of `RunKind` becomes `RunOutcome`.
- `src/observation/subagent-events-observer.ts` — `finishedChannel(run)`, `buildEventData(record, run)`, `toPersistedRecord(record, run)` (step 5); `sendCompletion(record, run)` (step 6); `onSubagentUpdate(record, run, message)` and `sendUpdate(record, run, message)` (step 7).
  Its `RunKind` import becomes `RunOutcome`; doc comments on `persistAndNotify` updated.
- `src/observation/notification.ts` — `buildEventData(record, run)` (step 2); `formatTaskNotification(record, run, max)`, `buildNotificationDetails(record, run, max)`, `buildPointerLines(record, run)` (step 3); `NotificationSystem`, `PendingAnnouncement`, `sendCompletion`, `withholdCompletion`, `emitIndividualNudge`, new `canAnnounceCompletion` (step 6); `sendUpdate`, `canAnnounceUpdate`, `emitUpdate` (step 7).
  The class header comment and `withholdCompletion`'s doc ("a re-completion is the same fact told again") are reworded to the run-identity rule in step 6.
- `src/persisted-record.ts` — `toPersistedRecord(identity, outcome)` with `PersistedIdentity`/`PersistedOutcome`; its doc comment ("A `Subagent` satisfies the parameter structurally") rewritten (step 2).
- `src/index.ts` — predicted **unchanged**: it constructs `NotificationManager`, `SubagentEventsObserver`, and the composite, and calls none of the changed methods.
- `src/service/*` — predicted **unchanged**: `SubagentManagerObserver` and `NotificationSystem` are not part of the public service surface (`service.ts` exports neither), so `dist/public.d.ts` does not move; `verify:public-types` is not required but is cheap to run once at the end.
- `test/helpers/make-subagent.ts` (+ `make-subagent.test.ts`) — `createTestRun(kind, overrides)` and a shared `testRunOutcome(overrides)` seed block that `createTestSubagent` also uses (step 1).
- Tests (steps named in TDD Order): `test/observation/notification.test.ts`, `test/observation/subagent-events-observer.test.ts`, `test/observation/composite-subagent-observer.test.ts`, `test/persisted-record.test.ts`, `test/lifecycle/subagent.test.ts`, `test/lifecycle/subagent-manager.test.ts`, `test/ui/agent-widget.test.ts`, `test/tools/get-result-tool.test.ts`.
  Measured blast radius at planning: 97 lines matching `onSubagentRunFinished|onRunFinished` across 6 test files (subagent 43, manager 26, events observer 17, composite 5, widget 4, get-result 2), and 58 lines matching `sendCompletion|sendUpdate` across 3 (notification 40, events observer 12, manager 6).
- `docs/architecture/architecture.md` (step 8) — the `notification.ts` module-tree entry (gates re-read on the announcement's own run; a replaced run's completion is dropped); the "Observation model" section gains one sentence: end-of-run and update hooks name the run, and readers take outcome fields from it.
  Predicted unchanged: the lifecycle-events table (lines ~604–620) and `README.md` § events (payload shapes do not change).
- `.pi/skills/package-pi-subagents/SKILL.md` (step 8) — the `NotificationManager` sentence ("announces one only while nothing has claimed the outcome and the child is still running") becomes "…while nothing has claimed the run the update joined and that run is still active".

## Test Impact Analysis

1. Newly possible: unit tests where the record and the run disagree (the pure helpers in steps 2–3, the events observer in step 5, the manager's queue in steps 6–7), using `createTestRun` instead of a full resume.
2. Redundant: none removed.
   The two `subagent.test.ts` assertions on `record.isTerminalError()` (in "transitions to aborted…" and "transitions to completed…") retarget to `record.latestRun.isTerminalError()` in step 5 rather than being deleted; `subagent-run.test.ts`'s status table already pins the predicate itself.
3. Must stay as-is in intent: the "parent-turn boundary" and "a withheld update whose child terminates before the flush" blocks in `notification.test.ts` (they exercise the real queue with a Pi delivery model); only their call arguments change.
   The `get-result-tool.test.ts` observers that resume on the initial run's finish switch from `kind` to `run.kind`, keeping their behavior.

## Invariants at risk

| Invariant (source)                                                                                         | Constituency     | Pinned by                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| An update reaches the parent once: by announcement, or with its run's outcome ([#903])                     | parent LLM       | `notification.test.ts` "a withheld update whose child terminates before the flush" (3 tests); `subagent-run.test.ts` ledger tests           |
| An announcement's steer hint is true: announced only while the run runs, re-read at emit ([#903])          | parent LLM       | "is announced when the child is still running as the run settles"; step 7's new tests                                                       |
| A completion is not announced once claimed or consumed (#617, [#987])                                      | parent LLM       | "suppresses the nudge when the parent pulls the result later in the same turn", "is left to the carrier that holds the outcome…"            |
| Withheld announcements flush in arrival order; a re-completion keeps the first position                    | parent LLM       | "flushes nudges from different agents in the order they arrived", "keeps a re-completed agent in the queue position it first took"          |
| A transition lands on the run it receives; a waiter reports the run it waited on ([#1051])                 | carriers, waiter | `subagent.test.ts` late-completion tests; `get-result-tool.test.ts` "resumedWhileWaiting" tests (observer migrates to `run.kind` in step 4) |
| `subagents:started`/`completed`/`failed` fire once per agent; a resumed run reports on `subagents:resumed` | event consumers  | `subagent-events-observer.test.ts` "an initial run" / "a resumed run" blocks (migrated to `createTestRun` in step 5)                        |
| Nothing is announced after `dispose()`                                                                     | session shutdown | `notification.test.ts` "disposal" block                                                                                                     |

Each named test exercises the real `NotificationManager`, `SubagentEventsObserver`, or `Subagent` (none mocks the layer under change); the events-observer tests mock only `NotificationSystem`, which is the layer step 5 does not change.

## TDD Order

Run `pnpm --filter @gotgenes/pi-subagents exec vitest run <file> && pnpm --filter @gotgenes/pi-subagents run check` after each step, and the package suite plus `pnpm fallow dead-code` before each commit.
Baseline at planning: 2249 tests in 91 files pass; `pnpm fallow dead-code` exits 0.

1. **`test(pi-subagents): add a test run fixture that defaults like the test record`.**
   `test/helpers/make-subagent.ts`: extract the outcome seed block of `createTestSubagent` into `testRunOutcome(overrides)`, and add `createTestRun(kind: RunKind, overrides?)` returning `new SubagentRun(kind, overrides.isBackground ?? true, testRunOutcome(overrides))`.
   `createTestSubagent` uses `testRunOutcome` so both fixtures share defaults (status `completed`, result `"All done."`, startedAt 1000, completedAt 2000) and the explicit-`undefined` handling of `seeded`.
   Test in `make-subagent.test.ts` (`describe("createTestRun")`): a `"resume"` run with no overrides reads `kind: "resume"`, status `completed`, result `"All done."`; a running override with `completedAt: undefined` keeps it undefined.
   Killing mutation: make `createTestRun` construct `new SubagentRun("initial", …)` regardless of `kind`.
   Prepares: every later step needs a run that is not `record.latestRun` (assessor-recommended).

2. **`refactor(pi-subagents): build lifecycle event data and session records from a named run`.**
   `buildEventData(record, run)` in `notification.ts`; `toPersistedRecord(identity, outcome)` with `PersistedIdentity`/`PersistedOutcome` in `persisted-record.ts`.
   `SubagentEventsObserver` passes `record.latestRun` for now (behavior unchanged).
   Test updates: `notification.test.ts` `describe("buildEventData")` (4 call sites), `persisted-record.test.ts` (4 call sites), `subagent-events-observer.test.ts` assertions `buildEventData(record)` → `buildEventData(record, record.latestRun)` (7 sites).
   New tests: `buildEventData` with a `createTestSubagent()` record and a `createTestRun("resume", { status: "stopped", result: "Partial.", startedAt: 1000, completedAt: 1500 })` reports status `stopped`, result `Partial.`, `durationMs: 500`, and the record's id/type/description/toolUses/tokens (`toStrictEqual`); `toPersistedRecord` with the same pair reports the run's status/result/timestamps and the record's id/outputFile/toolUses.
   Killing mutations: in `buildEventData`, read `status: record.status` (the new `buildEventData` test goes red); in `toPersistedRecord`, write `completedAt: outcome.startedAt` (the new `toPersistedRecord` test goes red).

3. **`refactor(pi-subagents): render the completion nudge from a named run`.**
   `formatTaskNotification(record, run, max)`, `buildNotificationDetails(record, run, max)`, private `buildPointerLines(record, run)`; `NotificationManager.emitIndividualNudge` passes `record.latestRun` for now.
   Test updates: `notification.test.ts` `formatTaskNotification` (8 sites) and `buildNotificationDetails` (4 sites) blocks, and the "omits the retrieval instruction for an agent that never started" expectation.
   New tests: with a completed record and a stopped run, `formatTaskNotification` shows `<status>Stopped (user request)</status>`, `<summary>Subagent "…" stopped</summary>`, the run's result, the run's duration, and the record's tool uses; `buildNotificationDetails` reports the run's status and `resultPreview`.
   Killing mutation: in `formatTaskNotification`, write the summary from `record.status`.

4. **`refactor(pi-subagents): name the run that finished in the per-agent observer hook`.**
   `RunOutcome` gains `readonly kind: RunKind`.
   `SubagentLifecycleObserver.onRunFinished(agent, run: RunOutcome)`; `complete`, `fail`, `endBeforeStart` pass `run`; `stopQueued` passes `this.currentRun`.
   `SubagentManager.buildObserver` relays `run.kind` to the unchanged `onSubagentRunFinished(record, kind)`.
   Test updates: `subagent.test.ts` (~11 `toHaveBeenCalledExactlyOnceWith(agent, "initial" | "resume")` assertions become `(agent, agent.latestRun)`; observer callbacks reading `kind` read `run.kind`), `get-result-tool.test.ts` (2 observers read `run.kind`).
   New test in `subagent.test.ts` (in the existing late-completion / abort-while-unwinding area): abort a running agent, resume it in the background, then let the first turn loop return — `onRunFinished` is called with the first run (captured as `agent.latestRun` before the resume), that run reads `stopped`, and it is not `agent.latestRun`.
   Killing mutation: in `complete()`, pass `this.currentRun` instead of `run`.

5. **`fix(pi-subagents): report the run that finished in lifecycle events and session records`.**
   `RunOutcome` gains `isTerminalError()`.
   `SubagentManagerObserver.onSubagentRunFinished(record, run)`; `buildObserver` relays `run`; `CompositeSubagentObserver` and `AgentWidget` take `run`; `SubagentEventsObserver` uses `finishedChannel(run)` (`run.kind`, `run.isTerminalError()`), `buildEventData(record, run)`, `toPersistedRecord(record, run)`; `sendCompletion(record)` is still record-only until step 6.
   Remove `Subagent.isTerminalError()`; retarget its two `subagent.test.ts` assertions to `record.latestRun.isTerminalError()`.
   Test updates: `subagent-manager.test.ts` (26 lines: callbacks read `run.kind`, the two `toHaveBeenNthCalledWith(…, "initial" | "resume")` assertions compare `run.kind`, the notification fixtures at lines ~118/134 forward `(r) => notifications.sendCompletion(r)` unchanged for now), `subagent-events-observer.test.ts` (17 lines; the "a resumed run" block builds each outcome with `createTestRun("resume", …)` instead of seeding the record), `composite-subagent-observer.test.ts` (5), `agent-widget.test.ts` (4).
   Optional tidying, folded here: merge the two initial/resume pairs that differ only in kind ("calls notifications.sendCompletion unconditionally", "emits exactly once and appends exactly once") into `it.each(["initial", "resume"])`.
   New tests: events observer — a record whose latest run is a running resume, finishing a stopped initial run (`createTestRun("initial", { status: "stopped" })`), emits once on `subagents:failed` with `status: "stopped"` and appends an entry with `status: "stopped"`; manager — spawn in the background, abort, resume in the background, then release the first turn loop: `onSubagentRunFinished` receives the stopped first run (use the gated factory pattern of the existing abort/resume tests near lines ~1826/1865).
   Killing mutations: (a) in `onSubagentRunFinished`, emit `buildEventData(record, record.latestRun)` — the events-observer test goes red on `status`; (b) in `buildObserver`, relay `agent.latestRun` instead of `run` — the manager test goes red.

6. **`fix(pi-subagents): keep a withheld completion nudge to the run that produced it`.**
   `RunOutcome` gains `claimed` and `consumed`.
   `NotificationSystem.sendCompletion(record, run)`; `PendingAnnouncement` completion holds `run`; `canAnnounceCompletion(run)` gates `sendCompletion` and `emitIndividualNudge`; rendering passes the held run to the step-4 helpers; `withholdCompletion` supersedes by agent id, replacing the entry's run in place.
   `SubagentEventsObserver` passes `run`.
   Test updates: `notification.test.ts` `sendCompletion` calls become `(record, record.latestRun)`; `subagent-events-observer.test.ts` `sendCompletion` assertions add the run; `subagent-manager.test.ts` notification fixtures forward `(r, run) => notifications.sendCompletion(r, run)`.
   New tests in `notification.test.ts`, `describe("a withheld completion whose run a resume replaced")`, each on a `createTestSubagent({ sessionReady: true })` record resumed in the background with a never-settling turn loop: (a) collected, then resumed → nothing delivered at settle (the issue's case 1); (b) uncollected, then resumed → nothing delivered; (c) resumed run completes before the settle → one nudge, carrying the resumed run's result, in the first entry's queue position; (d) parent idle: `sendCompletion(record, replacedRun)` after the resume started → nothing sent (scenario C).
   Plus one manager-level regression on `seedNotificationScenario`: a background spawn completes while the parent run is active, is resumed in the background, and the settle delivers no `<task-notification>`.
   Killing mutations: (i) at emit, gate and render `record.latestRun` instead of the held run → (a), (b) red; (ii) delete `!run.replaced` from `canAnnounceCompletion` → (b), (d), and the manager regression red, (a) stays green on consumption (predicted); (iii) make `withholdCompletion` always `push` → (c) and the existing "collapses a re-completion" test red.
   Commit trailer (final paragraph, below `Refs #1058`):

   ```text
   Co-authored-by: Tony Wong <27016195+tonybro233@users.noreply.github.com>
   ```

7. **`fix(pi-subagents): stop announcing an earlier run's update as live progress`.**
   `RunOutcome` gains `markUpdateAnnounced(message)`.
   `SubagentLifecycleObserver.onUpdateSent(agent, run, message)` (`announceUpdate` captures `this.currentRun` once); `SubagentManagerObserver.onSubagentUpdate?(record, run, message)`; composite; `SubagentEventsObserver.onSubagentUpdate(record, run, message)` (the `subagents:update` payload is unchanged); `NotificationSystem.sendUpdate(record, run, message)`; `PendingAnnouncement` update holds `run`; `canAnnounceUpdate(run)`; `emitUpdate` calls `run.markUpdateAnnounced(message)`.
   Remove `Subagent.markUpdateAnnounced()` (no test callers).
   Test updates: `notification.test.ts` `sendUpdate` calls, `subagent-events-observer.test.ts` `onSubagentUpdate` block, composite test, any `onUpdateSent` observer in `subagent.test.ts`.
   New tests: `subagent.test.ts` — `onUpdateSent` receives the run the update joined (`agent.latestRun` at send time); `notification.test.ts`, `describe("a withheld update whose run a resume replaced")`: (a) the run completes and is collected, then a background resume runs → nothing delivered at settle (the issue's case 2); (b) the run completes uncollected, then a background resume runs → nothing delivered, and the run's own completion entry is dropped too.
   Killing mutation: make `canAnnounceUpdate` read `entry.record.isActive()` (the latest run) → (a), (b) red.
   Same `Co-authored-by:` trailer as step 6.

8. **`docs(pi-subagents): describe run-scoped announcements`.**
   `docs/architecture/architecture.md` module-tree entry for `notification.ts` and the "Observation model" sentence; `.pi/skills/package-pi-subagents/SKILL.md` `NotificationManager` sentence.
   Grep `packages/pi-subagents/docs` and `.pi/skills` for `onRunFinished`, `onSubagentRunFinished`, `sendCompletion`, `canAnnounceUpdate`, and "still running" before committing (planning-time grep found only the SKILL.md line and the architecture entries named here).
   Run `pnpm run verify:public-types` once (predicted unchanged).

## Risks and Mitigations

- **Large mechanical test churn hides a weakened assertion.**
  Steps 4–7 rewrite about 155 test lines; a `toHaveBeenCalledExactlyOnceWith(agent, agent.latestRun)` passes for the wrong run when no resume intervenes.
  Mitigation: each step adds at least one test where the run and `latestRun` differ, with a named killing mutation.
- **A test observer reads `kind` from the wrong object after migration** (`run.kind` vs a stale closure).
  Mitigation: `tsc` rejects a `RunKind` passed where `RunOutcome` is expected, and the `get-result-tool` resume-on-finish tests fail loudly if the observer never resumes.
- **Dropping a replaced, uncollected run's completion loses information the parent never saw.**
  Accepted by the operator; today's supersede rule already behaves this way except in the bug.
  The result remains in the transcript (`outputFile`) and in the resumed child's context.
- **`fallow dead-code` flags `Subagent.claimed` after step 6.**
  Mitigation: retarget its test readers to `record.latestRun.claimed` in step 6 (see Non-Goals); do not suppress.
- **Step 5 changes the `subagents:completed`/`failed` choice in the abort→resume window.**
  A consumer that counted `subagents:completed` for a stopped-then-resumed agent now sees `subagents:failed`; this is the documented contract (`failed` for `error`/`stopped`/`aborted`), so it is a fix, not a break.

## Open Questions

- None blocking.
  Whether the persisted entry should also carry the run's kind (for Phase 24 restore, PR [#1136]) is that work's question, not this one's.

[#903]: https://github.com/gotgenes/pi-packages/issues/903
[#987]: https://github.com/gotgenes/pi-packages/issues/987
[#1051]: https://github.com/gotgenes/pi-packages/issues/1051
[#1136]: https://github.com/gotgenes/pi-packages/pull/1136
[#1155]: https://github.com/gotgenes/pi-packages/issues/1155
