---
issue: 1012
issue_title: "pi-subagents: an agent spawned in the foreground and resumed in the background has no widget row"
---

# A run owns its mode, so a background resume shows a widget row

## Release Recommendation

**Release:** ship independently

The Phase 23 roadmap step for this issue is tagged `Release: independent`, and the phase defines no batches.
Step 6 is a breaking `fix!:` (the public `SubagentRecord.isBackground` changes meaning), so the branch cuts a major release; the operator accepted the major at the planning gate.

## Problem Statement

An agent spawned in the foreground and later resumed with `run_in_background: true` runs with no widget row and no status-bar count.
The tool returns "Agent resumed in background." at once, and the parent eventually gets the completion notice, but nothing on screen shows that the agent is working.

The widget lists the records whose `isBackground` is true (`AgentWidget.listBackgroundAgents`, `src/ui/agent-widget.ts`).
`isBackground` is a `readonly` field `Subagent` sets at construction from the spawn's resolved mode, so a resume cannot change it.
The architecture doc already names the cause ("A subagent is a sequence of runs"): a run's mode is a fact about the run, not about the agent.

Planning found two more gaps in the same model:

- A foreground tool resume (`AgentTool.resumeExisting`) streams no inline progress; it passes no `onUpdate`, unlike `runForeground`.
  ADR 0004 Decision A keeps the widget to background runs because "foreground runs are rendered inline", which does not hold for a foreground resume.
- The widget never forgets a record's linger age when that record runs again, so a second run's finished row vanishes the moment the run settles instead of lingering one turn.
  A throwaway Vitest spike against the real `AgentWidget` (since deleted) observed the widget content across finish, turn, resume start, and resume finish as `function, undefined, function, undefined`; the last should be `function`.
  This has affected every background resume since [#987].

## Goals

- Each run carries its own mode.
  The initial run takes the spawn's resolved mode; a resume takes the mode its front door states.
- `Subagent.isBackground`, and the public `SubagentRecord.isBackground` copied from it, report the **current run's** mode: the run in flight, or the last one to end; the spawn's mode before the first run starts.
  **Breaking:** a consumer that read `isBackground` as the spawn-time fact sees it change after a resume in the other mode.
  Commit as `fix(pi-subagents)!:` with a `BREAKING CHANGE:` footer (operator decision).
- Every front door states a resume's mode, through a required `ResumeCallOptions.background`:
  - `subagent` with `resume` and `run_in_background: true`: background;
  - `subagent` with `resume` alone: foreground;
  - `SubagentsService.resume()`: background, matching the SDK spawn door's default (operator decision; no new public option).
- A foreground tool resume streams the same inline progress a foreground spawn does, so every foreground run renders inline and the widget's background-only rule stays sound (operator decision).
- A run that starts clears the widget's linger age for its record, so every run's finished row lingers one turn (two for an error), whatever ran before it (operator decision: folded in).

## Non-Goals

- Admitting a background resume through `maxConcurrent`: [#1013], the next Track A+ step, which builds on the per-run mode this plan lands.
- Moving a run's outcome onto `SubagentRun`: [#1051].
- A `foreground` option on `SubagentsService.resume()`.
  No consumer asks for one, and a foreground service resume would have neither a widget row nor an inline stream.
- Making a service spawn with `foreground: true` visible.
  It goes through `manager.spawn`, starts at once, and has no inline stream and no widget row today; this plan does not change it.
- Changing the `subagents:created` payload.
  It fires only at spawn, before any run exists, where the current run's mode is the spawn's.
- Reworking `RunKind` or the `onRunStarted(record, kind)` observer signature; mode is orthogonal to kind.
- Cleaning `resumeExisting`'s `signal ?? new AbortController().signal` fallback.

## Background

- `src/lifecycle/subagent-run.ts` — `SubagentRun` ([#1049], [#1050]) owns one run's abort lever, caller-signal wiring, and record-observer unsubscribe, and carries its `kind`.
  Constructor: `(kind, callerSignal, onCallerAbort)`.
- `src/lifecycle/subagent.ts` — `Subagent` keeps `currentRun` ("the run in flight, or the last one to end"), built in `run()` (initial) and `continueSession()` (resume).
  `continueSession` runs `resetForResume`, then sets `currentRun`, then fires `onRunStarted`, all synchronously inside `resume()`, so an observer reading the record at run start sees the new run.
  `run()` sets `currentRun` before its first `await`, and `start()` calls it synchronously, so a foreground spawn has a current run as soon as `spawn` returns; only a queued record (always a background spawn) or a passive test fixture has none.
- `src/lifecycle/subagent-manager.ts` — `resume()` is `startResume()` plus `await start.record.promise`.
  `startResume` checks refusals, then claims (`claimOutcome`) or releases stale claims, then calls `agent.resume(prompt, signal)`.
  `ResumeCallOptions` today is `{ signal?, claimOutcome? }`, and both methods default it to `{}`.
  `AgentSpawnConfig.background` is required "so a new front door cannot silently inherit another's policy"; this plan gives `ResumeCallOptions.background` the same treatment.
- `src/tools/agent-tool.ts` — `resumeExisting` awaits `manager.resume(id, prompt, { signal, claimOutcome: true })`; `resumeInBackground` calls `manager.startResume(id, prompt, {})`.
- `src/tools/foreground-runner.ts` — `runForeground` owns an 80 ms spinner interval and a `streamUpdate` closure that reads the record (`toolUses`, `model`, `turnBudget`, `activeTools`, `responseText`) once `onSessionCreated` hands it over.
- `src/service/service-adapter.ts` — `resume()` forwards `{ claimOutcome, signal }` to `manager.resume` through `SubagentManagerLike`.
- `docs/decisions/0005-subagent-record-admission-policy.md` — admits `isBackground` as a "resolved spawn fact, known from the choke point onward".
  Amended in place here, as [#912] and [#1022] did.
- AGENTS.md: a change that edits a tool the workflow calls needs a Pi restart before `/ship`; `subagent` is such a tool, but `/ship` does not call it.

## Design Overview

### The mode lives on the run

```typescript
// src/lifecycle/subagent-run.ts
export class SubagentRun {
  constructor(
    readonly kind: RunKind,
    readonly inBackground: boolean,
    callerSignal: AbortSignal | undefined,
    onCallerAbort: () => void,
  ) { … }
}
```

```typescript
// src/lifecycle/subagent.ts
export interface ResumeRunOptions {
  /** Whether this resume runs in the background; the front door decides. */
  background: boolean;
  signal?: AbortSignal;
}

class Subagent {
  /** The spawn's resolved mode; the current run's until the first run starts. */
  private readonly spawnedInBackground: boolean;

  /** The current run's mode: the run in flight, the last one to end, or the spawn's before any run. */
  get isBackground(): boolean {
    return this.currentRun?.inBackground ?? this.spawnedInBackground;
  }

  resume(prompt: string, options: ResumeRunOptions): Promise<void>;
}
```

`SubagentInit.isBackground` keeps its name and meaning (the spawn's resolved mode), so no fixture that builds a `Subagent` changes.
`run()` builds `new SubagentRun("initial", this.spawnedInBackground, …)`; `continueSession` builds `new SubagentRun("resume", options.background, …)`.
Whether `ResumeRunOptions` is exported or inlined is the implementer's call; `ResumeCallOptions` (the manager's) adds `claimOutcome` and a required `background` on top of it.

### Each door states the mode

```typescript
// src/lifecycle/subagent-manager.ts
export interface ResumeCallOptions {
  background: boolean;
  signal?: AbortSignal;
  claimOutcome?: boolean;
}
// startResume: … agent.resume(prompt, { background: options.background, signal: options.signal });
```

| Door                                       | `background` | Claims                     |
| ------------------------------------------ | ------------ | -------------------------- |
| Tool, `resume` + `run_in_background: true` | `true`       | no (releases stale claims) |
| Tool, `resume` alone                       | `false`      | yes                        |
| `SubagentsService.resume()`                | `true`       | `claimOutcome` as passed   |

Both manager methods lose their `= {}` default, so a new door cannot omit the mode.

### What a reader sees, by scenario

| Spawned    | Resumed via                     | `isBackground` during and after the resume | Widget row                             | Inline stream |
| ---------- | ------------------------------- | ------------------------------------------ | -------------------------------------- | ------------- |
| foreground | tool, `run_in_background: true` | `true`                                     | yes (was: no)                          | no            |
| background | tool, `run_in_background: true` | `true`                                     | yes                                    | no            |
| background | tool, foreground                | `false`                                    | no (was: yes)                          | yes (was: no) |
| foreground | tool, foreground                | `false`                                    | no                                     | yes (was: no) |
| either     | `SubagentsService.resume()`     | `true`                                     | yes (was: only for a background spawn) | no            |

A settled record keeps its last run's mode, so a finished row lingers in the surface its run was shown in.

### The foreground resume streams inline

`runForeground`'s stream moves to a new `src/tools/progress-stream.ts`:

```typescript
export function startProgressStream(params: {
  detailBase: AgentDetails;            // presentation.detailBase
  onUpdate: ((update: AgentToolResult<AgentDetails>) => void) | undefined;
  getRecord: () => Subagent | undefined;
}): () => void;                        // stop: clears the interval; idempotent
```

Its parameter type reads only those three fields.
`runForeground` passes `getRecord: () => recordRef` and stops the stream in a `finally`.
`resumeExisting` starts the resume first, so a refusal streams nothing:

```typescript
const start = this.manager.startResume(id, prompt, { background: false, signal, claimOutcome: true });
if (start.kind === "refused") return textResult(resumeRefusalMessage(start.reason, id));
const stop = startProgressStream({ detailBase, onUpdate, getRecord: () => start.record });
try { await start.record.promise; } finally { stop(); }
```

The stream reads the record (Tell-Don't-Ask holds: it renders what the record reports and decides nothing).
The import edges stay inside the `pi-subagents/tools` zone (`agent-tool.ts` and `foreground-runner.ts` to `progress-stream.ts`), and `progress-stream.ts` imports only what `foreground-runner.ts` already imports (`#src/tools/helpers`, `#src/ui/display`, `#src/ui/glyphs`), none of which imports a `tools/` runner, so no cycle forms.

### The widget forgets a record's linger age when it runs again

```typescript
onSubagentRunStarted(record: Subagent, _kind: RunKind) {
  this.finishedTurnAge.delete(record.id);
  this.update();
}
```

`seedFinishedAgents` then seeds the next settle at age 0, as for a first run.

### Edge cases (each pinned)

- A foreground-spawned agent resumed in the background reads `isBackground: true` while running and after settling: step 6 (`subagent.test.ts`, `subagent-manager.test.ts`).
- A background-spawned agent resumed in the foreground reads `false`: step 6 (`subagent.test.ts`).
- A record with no run yet reads the spawn's mode: step 6 (existing `service-adapter.test.ts` passive-fixture test, `createTestSubagent({ isBackground: false })`).
- The service door resumes in the background: step 6 (`service-adapter.test.ts`).
- A second run's finished row lingers: step 5 (`agent-widget.test.ts`).
- A foreground resume streams while running, stops when the run settles, and streams nothing on a refusal: step 7 (`agent-tool.test.ts`).

## Module-Level Changes

| File                                                      | Change                                                                                                                                                                                                                             | Step |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `src/tools/progress-stream.ts`                            | new: `startProgressStream`                                                                                                                                                                                                         | 2    |
| `src/tools/foreground-runner.ts`                          | uses `startProgressStream` with `try`/`finally`                                                                                                                                                                                    | 2    |
| `src/tools/agent-tool.ts`                                 | `resumeExisting` goes through `startResume` + `await record.promise`; `resume` drops from `AgentToolManager`                                                                                                                       | 3    |
| `src/tools/agent-tool.ts`                                 | both resume doors pass `background`                                                                                                                                                                                                | 6    |
| `src/tools/agent-tool.ts`                                 | `resumeExisting` streams through `startProgressStream`                                                                                                                                                                             | 7    |
| `src/lifecycle/subagent.ts`                               | `resume(prompt, { signal })`                                                                                                                                                                                                       | 4    |
| `src/lifecycle/subagent.ts`                               | `isBackground` becomes a getter over `currentRun`; `spawnedInBackground`; runs built with their mode                                                                                                                               | 6    |
| `src/lifecycle/subagent-manager.ts`                       | `startResume` calls `agent.resume(prompt, { signal })`                                                                                                                                                                             | 4    |
| `src/lifecycle/subagent-manager.ts`                       | `ResumeCallOptions.background` required; no `= {}` defaults                                                                                                                                                                        | 6    |
| `src/lifecycle/subagent-run.ts`                           | `readonly inBackground` constructor parameter                                                                                                                                                                                      | 6    |
| `src/service/service-adapter.ts`                          | `resume` passes `background: true`                                                                                                                                                                                                 | 6    |
| `src/service/service.ts`                                  | `SubagentRecord.isBackground` doc: the current run's mode                                                                                                                                                                          | 6    |
| `src/ui/agent-widget.ts`                                  | `onSubagentRunStarted` clears the record's linger age                                                                                                                                                                              | 5    |
| `src/ui/agent-widget.ts`                                  | `listBackgroundAgents` doc: the current run's mode; every foreground run renders inline                                                                                                                                            | 6    |
| `test/tools/foreground-runner.test.ts`                    | characterization pins                                                                                                                                                                                                              | 1    |
| `test/tools/progress-stream.test.ts`                      | new unit tests                                                                                                                                                                                                                     | 2    |
| `test/helpers/make-deps.ts`                               | `mockResumeRecord`/`mockResumeRefusal` repointed at `startResume` and merged with `mockResumeStart`/`mockResumeStartRefusal`; `resume: vi.fn()` default removed                                                                    | 3    |
| `test/helpers/make-deps.test.ts`                          | follows the helper merge (step 3) and adds `background` (step 6)                                                                                                                                                                   | 3, 6 |
| `test/tools/agent-tool.test.ts`                           | door tests follow the helper merge; method-identity assertions become argument assertions                                                                                                                                          | 3    |
| `test/tools/agent-tool.test.ts`                           | `background` arguments pinned                                                                                                                                                                                                      | 6    |
| `test/tools/agent-tool.test.ts`                           | foreground-resume stream tests                                                                                                                                                                                                     | 7    |
| `test/lifecycle/subagent.test.ts`                         | the 3 signal-passing calls (lines ~1426, ~1969, ~2029) take `{ signal }`                                                                                                                                                           | 4    |
| `test/lifecycle/subagent.test.ts`                         | every `agent.resume(` gains `{ background }`; per-run mode tests                                                                                                                                                                   | 6    |
| `test/lifecycle/subagent-run.test.ts`                     | 15 `new SubagentRun(` sites gain the mode, plus an `inBackground` test                                                                                                                                                             | 6    |
| `test/lifecycle/subagent-manager.test.ts`                 | 25 `manager.resume`/`startResume` calls gain `background`, plus a mode test                                                                                                                                                        | 6    |
| `test/tools/get-result-tool.test.ts`                      | its 2 direct `.resume(` calls gain `{ background }`                                                                                                                                                                                | 6    |
| `test/service/service-adapter.test.ts`                    | the exact `toHaveBeenCalledWith` on the forwarded options (lines ~604, ~616) gains `background: true`                                                                                                                              | 6    |
| `test/ui/agent-widget.test.ts`                            | linger test                                                                                                                                                                                                                        | 5    |
| `docs/decisions/0005-subagent-record-admission-policy.md` | `isBackground` row and the roster consequence: the current run's mode                                                                                                                                                              | 8    |
| `README.md`                                               | line ~65 (widget: every foreground run renders inline), line ~135 (a background resume shows in the widget), line ~368 (`isBackground` is the current run's mode), the `resume` contract (a service resume runs in the background) | 8    |
| `docs/architecture/architecture.md`                       | class diagram (`isBackground` getter, `resume(prompt, options)`); the "sequence of runs" section's mode sentence; the #1012 step's ✅ heading, Mermaid node `S1012`, and `Landed:` note                                            | 8    |

Re-derive the test call-site counts with `grep` at each step rather than trusting the numbers above; the Tidy-First assessor's signal-call count was off by two.

Predicted unchanged, with the claim each rests on:

- `src/observation/subagent-events-observer.ts` and its test: `subagents:created` fires from `create()` before any run exists, so it reads the spawn's mode.
- `src/observation/notification.ts`: announcement is decided by the carrier claim, never by `isBackground`.
- `src/tools/background-spawner.ts`, `src/config/invocation-config.ts`: spawn-side mode resolution is untouched.
- `test/ui/widget-viewport.test.ts`, `test/tools/background-spawner.test.ts`, `test/config/background-mode.test.ts`: they build passive records or spawn requests, whose mode is the spawn's.
- `.pi/skills/package-pi-subagents/SKILL.md`: a `grep` for `isBackground` there returns nothing.

## Test Impact Analysis

1. New tests the extraction enables: `startProgressStream` gets unit tests (frame advance, record fields, idempotent stop) without spawning anything through `runForeground`.
2. Redundant tests: none removed.
   The step 1 characterization pins stay on `runForeground`, because they pin the runner's own use of the stream (first update before the spawn, stop on both exits).
3. Tests that stay as they are because they exercise the layer itself: `subagent-manager.test.ts` (real manager, stubbed session factory) pins claim timing and the resume mode end to end; `subagent.test.ts` and `get-result-tool.test.ts` drive a real `Subagent` and `SubagentRun`.
   The `agent-tool.test.ts` door tests stub the whole manager, so they pin door wording and call arguments only, never ordering or claim timing.

## Invariants at risk

| Invariant (source)                                                                               | Constituency                                            | Pinned by                                                                                                                     |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| A resume reaches its turn loop with a fired lever when handed a fired signal ([#1049] `Landed:`) | operators cancelling a resume                           | `subagent.test.ts` signal tests (lines ~1426, ~1969, ~2029), migrated in step 4                                               |
| A claim is taken before `resetForResume`, and an unclaimed resume releases stale claims ([#987]) | the parent, which must be told exactly once             | `subagent-manager.test.ts` claim tests (real manager), unchanged in step 3 because the tool still passes `claimOutcome: true` |
| A foreground tool resume marks its outcome consumed and returns it directly ([#987])             | the parent model                                        | `agent-tool.test.ts` resume-return tests, migrated in step 3                                                                  |
| `onRunStarted` fires after `currentRun` is set ([#1050])                                         | the widget, which now reads the run's mode at that edge | step 6's `subagent-manager.test.ts` mode test reads `isBackground` from an `onSubagentRunStarted` observer                    |
| The widget shows background runs only; foreground runs render inline (ADR 0004 Decision A)       | the operator's screen                                   | `agent-widget.test.ts` "background-only filtering" plus step 7's stream tests                                                 |

## TDD Order

1. **Pin `runForeground`'s progress stream.**
   Test surface: `test/tools/foreground-runner.test.ts` (real `Subagent` record, stubbed `spawnAndWait`).
   Covers, under fake timers: the first `onUpdate` fires before `spawnAndWait` is called; the text is `"N tool uses..."`; `details.status` is `"running"`; `tokens` and `activity` come from the record; `spinnerFrame` advances by one per 80 ms tick; `durationMs` is measured from the stream's start; no `onUpdate` fires after a successful return.
   Killing mutations: delete the initial `streamUpdate()` call (kills the first-update test); change the text to `` `${toolUses} tools...` `` (kills the text test); delete the success-path `clearInterval(spinnerInterval)` (kills the no-update-after-return test); drop `spinnerFrame++` (kills the frame test).
   Commit: `test(pi-subagents): pin the foreground progress stream before extracting it`.
2. **Extract the stream.**
   Prepares step 7's friction: the foreground resume needs the identical stream, which it would otherwise copy.
   Add `src/tools/progress-stream.ts` (`startProgressStream`), have `runForeground` call it with the stop in a `finally`, and add `test/tools/progress-stream.test.ts`.
   Step 1's tests stay green unchanged.
   Re-read the moved code against the `code-design` skill before committing; an extraction carries its source's habits into a shared file.
   Killing mutations (new unit tests): make `stop` a no-op (kills the stop test); read `toolUses` as `0` instead of from `getRecord()` (kills the record-field test).
   Commit: `refactor(pi-subagents): extract the foreground progress stream`.
3. **Route the foreground tool resume through `startResume`.**
   Prepares step 7's friction: the stream needs the record before the run ends.
   `resumeExisting` calls `startResume(id, prompt, { signal, claimOutcome: true })` and awaits `start.record.promise`; `resume` leaves `AgentToolManager` (`SubagentManagerLike` keeps it, so `SubagentManager.resume` is not dead).
   In `test/helpers/make-deps.ts`, repoint `mockResumeRecord`/`mockResumeRefusal` at `startResume` and merge each with its `mockResumeStart*` twin; drop the stub's `resume: vi.fn()` default; update `make-deps.test.ts`.
   The door-identity assertions in `agent-tool.test.ts` (lines ~192, ~315, ~376–377, ~427–428, ~452–453) tell the doors apart by *which* method was called; rewrite them to tell the doors apart by arguments (`claimOutcome: true` versus none), keeping one per door, so neither assertion passes for both doors.
   Add one test with a pending `record.promise` (`Promise.withResolvers`) proving the door's result does not resolve until the run does.
   Killing mutations: delete `await start.record.promise` (kills the pending-promise test); drop `claimOutcome: true` (kills the foreground argument assertion).
   Commit: `refactor(pi-subagents): start a foreground resume through startResume`.
4. **`Subagent.resume` takes an options object.**
   Prepares step 6's friction: a required mode added to `resume(prompt, signal?)` would be a positional boolean at about 35 call sites.
   `resume(prompt, { signal })`; `startResume` passes `{ signal: options.signal }`; migrate the three signal-passing tests in `subagent.test.ts`; calls without a signal pass `{}`.
   Killing mutation: have `resume` ignore `options.signal` (kills the three fired-signal and caller-signal tests).
   Commit: `refactor(pi-subagents): pass a resume's signal in an options object`.
5. **A run that starts resets its record's linger age.**
   Test surface: `test/ui/agent-widget.test.ts`, in a new `describe("a record that runs again")` using `makeWidget`'s mutable fixture: settle, `onTurnStart` (cleared), mutate to `running` and call `onSubagentRunStarted(…, "resume")`, mutate to `completed` with a new `completedAt` and call `onSubagentRunFinished` (registered), then `onTurnStart` (cleared after one turn).
   Add the error-status sibling (lingers two turns).
   Killing mutation: delete `this.finishedTurnAge.delete(record.id)` (kills both; the registered-after-finish assertion reads `undefined`).
   Commit: `fix(pi-subagents): let a resumed run's finished widget row linger like the first run's`.
6. **A run owns its mode.**
   Source: `SubagentRun.inBackground`; `Subagent.spawnedInBackground` and the `isBackground` getter; `run()`/`continueSession` build runs with their mode; `ResumeRunOptions.background`; required `ResumeCallOptions.background` without `= {}` defaults; `startResume` forwards it; the tool's background door passes `true` and its foreground door `false`; the service adapter passes `true`; doc comments in `service.ts` and `agent-widget.ts`.
   Mechanical test edits, all in this commit (the type change breaks them together): `subagent-run.test.ts` (15 constructor sites), `subagent.test.ts` (every `agent.resume(`), `subagent-manager.test.ts` (25 calls), `get-result-tool.test.ts` (2), `make-deps.test.ts`, and the exact option assertions in `service-adapter.test.ts`.
   New tests:
   - `subagent-run.test.ts`: a run reports the `inBackground` it was built with, for both values.
   - `subagent.test.ts` (real `Subagent`, stubbed session), nested by spawn mode: a foreground-spawned, settled agent resumed with `{ background: true }` reads `true` while running and after settling; a background-spawned agent resumed with `{ background: false }` reads `false` while running and after settling.
   - `subagent-manager.test.ts` (real manager): after `spawnAndWait`, `startResume(id, p, { background: true })` makes the record read `true`, and an `onSubagentRunStarted` observer reads `true` at the start edge.
   - `agent-tool.test.ts`: the background door passes `background: true`, the foreground door `background: false`.
   - `service-adapter.test.ts`: the service forwards `background: true`.
   Killing mutations: make the getter return `this.spawnedInBackground` (kills the `subagent.test.ts` and manager mode tests); build the resume's run with `this.spawnedInBackground` instead of `options.background` (kills the same set); change the getter's fallback to `?? true` (kills the existing passive-fixture test `toSubagentRecord(createTestSubagent({ isBackground: false }))`); have `startResume` pass `background: false` regardless (kills the manager test); swap the two tool doors' values (kills the `agent-tool.test.ts` pair); pass `false` from the service adapter (kills the service test).
   Run `pnpm --filter @gotgenes/pi-subagents run check` and the full suite after this step.
   Commit:

   ```text
   fix(pi-subagents)!: report the current run's mode, so a background resume shows a widget row

   BREAKING CHANGE: `SubagentRecord.isBackground` reports the current run's
   mode instead of the mode the agent was spawned with. A resume chooses its
   own mode: `subagent` with `run_in_background: true` and
   `SubagentsService.resume()` resume in the background, and `subagent` with
   `resume` alone resumes in the foreground, so the field can change after a
   resume. Before an agent's first run it is still the spawn's mode.
   ```

7. **A foreground resume streams its progress inline.**
   `resumeExisting` starts `startProgressStream` on `start.record` after a non-refused start and stops it in a `finally` around the await.
   Tests in `agent-tool.test.ts` under fake timers, with a pending `record.promise`: `onUpdate` fires with `details.status: "running"` and the record's tool uses while the resume runs; no `onUpdate` fires after the result returns (advance the timers past it); a refused resume calls `onUpdate` zero times.
   Killing mutations: skip the `startProgressStream` call (kills the running-update test); call `stop` only on the success path's happy line rather than in `finally`, and make the run reject (kills the no-update-after-return test on that path); start the stream before the refusal check (kills the refusal test).
   Commit: `feat(pi-subagents): stream a foreground resume's progress inline`.
8. **Docs.**
   ADR 0005: the `isBackground` row becomes "admitted, required: the current run's mode, the spawn's before the first run", with a Consequences sentence that the meaning changed with #1012 because a resume chooses its own mode, and the roster consequence reads as the current run's mode.
   README, at the four places listed under Module-Level Changes.
   `architecture.md`: the class diagram, the "sequence of runs" mode sentence, and the #1012 step's ✅ heading, Mermaid node, and `Landed:` note.
   Verify with `grep -rn "spawn fact\|resolved spawn" packages/pi-subagents/README.md packages/pi-subagents/docs/decisions packages/pi-subagents/docs/architecture/architecture.md` (expected: no hit describing `isBackground`).
   Commit: `docs(pi-subagents): describe isBackground as the current run's mode`.

## Risks and Mitigations

- **A door omits the mode and silently inherits one.**
  `background` is required and the `= {}` defaults are removed, so `tsc` rejects an omission.
- **A consumer relying on the spawn-time meaning breaks silently.**
  The `BREAKING CHANGE:` footer reaches the changelog, and ADR 0005 and the README record the new meaning; no in-repo consumer reads `SubagentRecord.isBackground` (checked: the only `isBackground` hit outside `packages/pi-subagents` is an unrelated symbol in `pi-permission-system`'s bash resolver).
- **The stream outlives the run on an exception path.**
  Step 2 and step 7 stop it in a `finally`, and step 7's mutation exercises the reject path.
- **Step 3 weakens the door tests.**
  The step names each method-identity assertion and requires an argument assertion only one door can satisfy.
- **The widget reads a stale mode at the run-start edge.**
  `continueSession` sets `currentRun` before `onRunStarted`; step 6's manager test reads the mode from inside the observer.

## Open Questions

- Whether `ResumeRunOptions` is a named export or an inline type on `Subagent.resume`: decide in step 4 by whether `ResumeCallOptions` can extend it cleanly.

[#912]: https://github.com/gotgenes/pi-packages/issues/912
[#987]: https://github.com/gotgenes/pi-packages/issues/987
[#1013]: https://github.com/gotgenes/pi-packages/issues/1013
[#1022]: https://github.com/gotgenes/pi-packages/issues/1022
[#1049]: https://github.com/gotgenes/pi-packages/issues/1049
[#1050]: https://github.com/gotgenes/pi-packages/issues/1050
[#1051]: https://github.com/gotgenes/pi-packages/issues/1051
