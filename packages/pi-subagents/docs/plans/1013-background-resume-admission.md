---
issue: 1013
issue_title: "pi-subagents: a background resume is not admitted through maxConcurrent"
---

# Admit a background resume through `maxConcurrent`

## Release Recommendation

**Release:** ship independently

This issue's roadmap step (Phase 23, Track A+) is tagged `Release: independent`, and the phase has no release batches.
Step 5 is a `fix(pi-subagents)!:` commit (a new `ResumeRefusal` member), so the release is a major.

## Problem Statement

`SubagentManager.startResume` hands a resume straight to `Subagent.resume`, so a resumed run never goes through the `ConcurrencyLimiter`: it neither waits for a slot nor holds one.
Since [#987] a `subagent` call with `resume` and `run_in_background: true` resumes in the background, and since [#1012] that run is a background run (it shows in the widget, `isBackground` reads `true`).
A background spawn at capacity queues; a background resume starts anyway.
The README's Concurrency section ("Background agents are subject to a configurable concurrency limit") is false for every background resume, from the tool and from `SubagentsService.resume()`.

The issue named three obstacles to queueing one: no queued-for-resume state, a `resumeRefusal` that treats a non-running record as resumable, and an abort-while-queued path that ends a queued run as an initial run.
Phase 23 removed most of the first and third ([#1050], [#1051]); this plan closes all three.

## Goals

- A background resume (the tool's `run_in_background: true` resume and `SubagentsService.resume()`) is admitted through the limiter like a background spawn: at capacity it reads `queued` and starts when a slot frees; below capacity it starts at once, exactly as today.
- A foreground tool resume bypasses the limiter, as a foreground spawn does.
- A record whose resume is queued refuses a second resume with a new refusal member, `resume-queued`.
- A queued resume stopped by `abort(id)` or `abortAll()` ends as a resume: it is reported on the resume path (`subagents:resumed`), once, and its turn loop never runs.
- The tool's background-resume launch message says when the resume was queued, with the same `Position:` line a queued spawn gets.

This change is **breaking**.
`ResumeRefusal` is published on `SubagentRecord.resumeRefusal` and `ResumeResult.reason`, and it gains `resume-queued`; a consumer's exhaustive `switch` over either stops compiling (operator decision at the planning gate, choosing the precise member over reusing `still-running`).
The behavior change itself is a fix: at capacity a background resume now queues, which is what the documented concurrency contract already promised; below capacity nothing changes.
Step 5 carries `fix(pi-subagents)!:` and its `BREAKING CHANGE:` footer.

## Non-Goals

- **A queued agent's `get_subagent_result` body.**
  `renderOutcomeBody` has no arm for a queued run that was not stopped, so the report says `No output.` under `Status: queued`.
  Queued spawns reach it today; this change makes background resumes reach it too.
  Filed as [#1079], recorded as a new Phase 23 step after this one.
- **Withheld notifications crossing a resume** ([#1058]).
  A queued resume widens the window between an announcement being withheld and the replacing run, but the defect is in `notification.ts`, which this plan does not change.
- **A `bypassQueue` option on `SubagentsService.resume()`.**
  The service spawn has one; no consumer of the service resume exists in this monorepo (`grep -rn '\.resume(' packages/*/src` outside `pi-subagents` returns nothing), and an option is a mechanism the package then carries forever.
- **Queue priority for resumes.**
  The limiter is FIFO; a queued resume waits behind spawns queued before it.
- **A caller signal that fires while the resume is queued.**
  `SubagentRun.start` wires the caller's signal at admission, so a service `resume(…, { signal })` whose signal fires while queued is stopped when admitted (the born-aborted path from [#1049]), not when the signal fires.
  A queued spawn's `execution.signal` behaves the same today.
- **The wording of a stopped queued resume's notice.**
  It reads "stopped while queued and never started" (`notification.ts`, `outcome-delivery.ts`), which is accurate for the run it reports: that resume never ran.
  The earlier run's outcome was delivered before the resume was issued.
- **The `resumedWhileWaiting` sentence** in `get-result-report.ts` ("…and is running again").
  When the replacing resume is queued, "running" is loose, but the action it names (call `get_subagent_result` for that run's outcome) is correct in both states.
- **`ConcurrencyLimiter`'s API.**
  The roadmap step names `concurrency-limiter.ts` as a target, but `schedule` already does what a resume needs; it is predicted unchanged.
- **Stating the union-widening rule in decision 0005.**
  See Open Questions.

## Background

- `src/lifecycle/subagent-manager.ts`
  - `create()` schedules a background spawn with `record.scheduleVia((thunk) => this.limiter.schedule(thunk))` unless `bypassQueue`; otherwise `record.start()`.
  - `startResume()` refuses (`unknown-agent`, `record.resumeRefusal`), then `void agent.resume(prompt, { background, signal, claimOutcome })` and returns `{ kind: "started", record }`; `resume()` awaits `start.record.promise`.
  - `abort()` and `abortAll()` route `record.status === "queued"` to `record.stopQueued()`.
- `src/lifecycle/concurrency-limiter.ts`
  - `schedule(task)` pushes the task and calls `recheck()`, which starts it **synchronously** when a slot is free.
  - `active` counts only scheduled tasks, so foreground spawns, `bypassQueue` spawns, and every resume today run outside it.
  - The scheduled promise settles one microtask after the task, via `task().then(resolve, reject)`.
  - A slot frees in `.finally`, after that.
- `src/lifecycle/subagent.ts`
  - `resume(prompt, options)` sets `_promise = continueSession(...)`.
  - `continueSession`'s prefix is synchronous: it releases the current run and marks it replaced, creates `new SubagentRun("resume", options.background)` (born `queued`), claims it when `claimOutcome`, sets `currentRun`, then `startRun` (transitions to `running` and wires the caller's signal), the born-aborted check, and `onRunStarted`.
  - Then it awaits `runOnSession`.
  - `scheduleVia(schedule)` and `guardedRun()` (a record-level `isActive()` guard) are the spawn's queued path.
  - `stopQueued()` stops the current run and reports `onRunFinished(this, "initial")`, hard-coded.
  - `resumeRefusal` returns `still-running` for `isRunning()` (which excludes `queued`), then the session facts, then `workspace-disposed`.
- `src/lifecycle/subagent-run.ts`: a run is born `queued` (`_status = init.status ?? "queued"`) and `stopQueued()` sets `stoppedWhileQueued` when it is still queued.
- `src/observation/subagent-events-observer.ts`: maps `onSubagentRunStarted/Finished(record, kind)` to `subagents:started`/`resuming` and `completed`/`failed`/`resumed`, so the kind `stopQueued` reports picks the channel.
- `src/tools/agent-tool.ts`: `resumeInBackground` calls `startResume(id, prompt, { background: true })` and renders `Agent resumed in background.` through `renderBackgroundLaunch`; `resumeRefusalMessage` is an exhaustive `switch` over `ResumeRefusalReason`.
- `src/observation/outcome-delivery.ts`: `RESUME_REFUSAL_CLAUSES` is typed `Record<Exclude<ResumeRefusal, "still-running">, string>`; `renderQuestionAffordance` branches on `still-running`.
- `src/service/service-adapter.ts`: `resume` forwards `{ background: true, claimOutcome, signal }` to `manager.resume`.
- AGENTS.md: the package's README documents the tool parameters, the Concurrency contract, the events table, and the service `resume` contract; all four are in this change's doc surface.

## Design Overview

### Observed scenario (the parent's terms)

1. The parent has four background agents running (the default `maxConcurrent`) and a fifth queued.
2. An earlier agent asked a question; the parent answers it with `subagent({ resume: "<id>", prompt: "<answer>", run_in_background: true })`.
3. Today the answer starts a fifth run at once, ahead of the agent that was queued first.
   After this change the call returns `Agent resume queued in background.` with a `Position:` line, the widget's queued count goes up by one, and the resumed run starts when a slot frees.

Measured with a throwaway Vitest spike against the real `SubagentManager` and `ConcurrencyLimiter` at `maxConcurrent: 1` (spike removed).
Agent X settled, background spawn Z held the slot, and background spawn W read `queued`.
`startResume(X, …, { background: true })` returned `started` with X reading `running`: two live runs under a limit of 1.

### Subagent: a resume is born, then admitted

The birth half of a resume (the synchronous prefix of `continueSession`) runs when `resume()` is called; the start half runs when the scheduler admits it.

```typescript
/** Runs a run's thunk now or later; the limiter's `schedule` is one. */
export type RunScheduler = (thunk: () => Promise<void>) => Promise<void>;

resume(prompt: string, options: ResumeRunOptions, schedule: RunScheduler = (thunk) => thunk()): Promise<void> {
  const session = this.subagentSession;
  if (!session) return Promise.reject(new Error("Subagent not configured for resume — missing session"));
  const run = this.beginResume(options); // replaces the current run with a queued resume run, claimed if asked
  // A run stopped while it waited never starts; checked on the run, not the record,
  // because a later resume may already have replaced it.
  this._promise = schedule(() => (run.isActive() ? this.startResumedRun(run, session, prompt, options.signal) : Promise.resolve()));
  return this._promise;
}
```

- The default scheduler calls the thunk at once, so `Subagent.resume(prompt, options)` behaves exactly as today.
  `startResumedRun` is `async` and synchronous up to the turn loop, so the record reads `running` when `resume()` returns.
- The limiter's `schedule` with a free slot also calls the thunk synchronously, so a background resume below capacity still reads `running` when `startResume` returns (pinned by the existing manager test `returns the record already running the resume`).
- The thunk never throws synchronously: `startResumedRun` is `async`, so a failure rejects its promise instead of escaping `limiter.start` after `active++`.
- **Why the guard is on the run.**
  A queued resume stopped by `stopQueued()` leaves the record `stopped` with its session ready, so `resumeRefusal` accepts a new resume.
  That resume replaces `currentRun`, and the record is active again.
  When the first resume's slot frees, a record-level `isActive()` guard would start the stopped resume as a second turn loop.
  `run.isActive()` is false for the stopped run.
  The initial run's `guardedRun` cannot go stale this way, because a queued initial run answers `no-session`, so nothing replaces it; it stays as is.
- `scheduleVia(schedule: RunScheduler)` takes the same type.

### Manager: one admission rule for background runs

```typescript
// Background runs, spawned or resumed, wait for and hold a slot.
private readonly admitBackground: RunScheduler = (thunk) => this.limiter.schedule(thunk);

// create():      record.scheduleVia(this.admitBackground);
// startResume(): void agent.resume(prompt, { background, signal, claimOutcome },
//                  options.background ? this.admitBackground : undefined);
```

- `ResumeStart` keeps one success arm, `started`; its doc says the record is now running the resume or queued for a slot.
  A door that cares reads `record.status === "queued"`, as `spawnBackground` already does.
- `abort()`/`abortAll()` need no change: they already send a `queued` record to `stopQueued()`.
- The waiting door (`resume()`, which the service calls) awaits `record.promise`, which is now the limiter's promise for a background resume, so it spans the queue and the run.

### Abort while queued

`stopQueued()` reports `this.currentRun.kind` instead of `"initial"`.
A stopped queued resume then reaches `SubagentEventsObserver.onSubagentRunFinished(record, "resume")`, which emits `subagents:resumed` (status `stopped`), persists the record, and offers the completion nudge.
No `subagents:resuming` precedes it, matching a queued spawn's stop, which emits `subagents:failed` with no `subagents:started`.
The nudge renders the never-started notice (`stoppedWhileQueued` is set on the run, which was still queued).
After the stop the record is resumable again (`stopped`, session ready).

### Refusal: `resume-queued`

```typescript
export type ResumeRefusal =
  | "still-running"
  | "resume-queued"
  | "no-session"
  | "session-released"
  | "workspace-disposed";

get resumeRefusal(): ResumeRefusal | undefined {
  if (this.isRunning()) return "still-running";
  // A queued resume run has a live session; a queued initial run has none and keeps no-session.
  if (this.status === "queued" && this.currentRun.kind === "resume") return "resume-queued";
  if (!this.isSessionReady()) return this._sessionReleased ? "session-released" : "no-session";
  if (this.workspaceDisposed) return "workspace-disposed";
  return undefined;
}
```

- It is transient like `still-running`: it clears when the queued resume settles.
- `resumeRefusalMessage` gains: `Agent "<id>" already has a resume waiting for a concurrency slot; wait for that run to finish before resuming it again (get_subagent_result with wait: true returns when it does).`
- `outcome-delivery.ts`: `RESUME_REFUSAL_CLAUSES` excludes both transient members, and `renderQuestionAffordance` gives `resume-queued` the same wait sentence `still-running` gets.
  Through a real record the pairing is unreachable: a queued resume's run is new (no question) and the run it replaced reports `pendingQuestion` as `undefined`.
  The branch exists because the type requires it, so its test calls the function directly.
- A queued **initial** spawn keeps `no-session`, which the README promises ("a queued agent's `no-session` clears once it starts").

### Tool: a queued launch message

```typescript
const queued = start.record.status === "queued";
return renderBackgroundLaunch({
  headline: queued ? "Agent resume queued in background." : "Agent resumed in background.",
  // …id, displayName, description, detailBase, outputFile as today
  queuePosition: queued ? { maxConcurrent: this.settings.maxConcurrent } : undefined,
});
```

### Edge cases and where each is pinned

| Edge case                                                          | Behavior                                                          | Pinned in                                         |
| ------------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------- |
| Background resume below capacity                                   | Starts synchronously; reads `running` when `startResume` returns  | existing test, verified in step 7                 |
| Background resume at capacity                                      | Reads `queued`; starts when a slot frees                          | steps 3, 7                                        |
| Foreground tool resume at capacity                                 | Starts at once                                                    | step 7                                            |
| Queued resume claimed by its caller                                | Claimed while it waits                                            | step 3                                            |
| Queued resume stopped, slot later frees                            | Never runs; reported once, as a resume                            | steps 3, 4, 7                                     |
| Queued resume stopped, agent resumed again, first slot frees       | Only the second resume runs                                       | step 3                                            |
| Second resume while one is queued                                  | Refused `resume-queued`                                           | steps 5, 7                                        |
| Queued initial spawn                                               | Still `no-session`                                                | existing test, verified in step 5                 |
| `abortAll()` with a queued resume                                  | Stopped as a resume                                               | step 7                                            |
| Waiting door (`resume()`) on a queued resume                       | Resolves `resumed` after the queue and the run                    | step 7                                            |
| Resume issued from the agent's own finish observer at a full limit | Queues until that run's slot frees a microtask later, then starts | not tested; follows from the limiter's `.finally` |

## Module-Level Changes

- `src/lifecycle/subagent.ts`
  - Steps 2–5.
  - Adds `RunScheduler` and the private `beginResume`/`startResumedRun`, replacing `continueSession`.
  - `resume` gains the optional `schedule` parameter, and `scheduleVia` is retyped.
  - `stopQueued` reports the current run's kind.
  - `ResumeRefusal` gains `resume-queued`, and the `resumeRefusal` getter gains its arm.
  - Doc comments for `resume`, `stopQueued`, `resumeRefusal`, and `ResumeRefusal` are updated.
- `src/lifecycle/subagent-manager.ts`
  - Step 7.
  - Adds `admitBackground`, used by `create()` and `startResume()`.
  - Doc updates: the file header ("Background agents…" covers background resumes), `resume`, `startResume`, and `ResumeStart`.
- `src/tools/agent-tool.ts`
  - Step 5: `resumeRefusalMessage` gains the `resume-queued` case.
  - Step 6: `resumeInBackground` gets the queued headline and `queuePosition`.
- `src/observation/outcome-delivery.ts` (step 5): the `RESUME_REFUSAL_CLAUSES` exclusion and the `renderQuestionAffordance` branch.
- `src/service/service.ts`
  - Step 5: the `SubagentRecord.resumeRefusal` JSDoc names `resume-queued` as transient.
  - Step 7: the `resume()` JSDoc says a resume waits for a concurrency slot first, like a background spawn.
- `test/helpers/gated-scheduler.ts` and `test/helpers/gated-scheduler.test.ts` (step 1, new).
- `test/lifecycle/subagent.test.ts`
  - Step 1 migrates 3 gated scheduler sites (lines ~1187, ~1234, ~1250).
  - Steps 3–5 add tests under `describe("a resume")`, `describe("stopQueued")`, and `describe("resumeRefusal")`.
- `test/tools/get-result-tool.test.ts` (step 1): migrates 2 gated scheduler sites (lines ~50, ~420).
- `test/lifecycle/subagent-manager.test.ts` (step 7): new `describe("a background resume")` under `describe("concurrency")`.
- `test/tools/agent-tool.test.ts`
  - Step 5: a `resume-queued` refusal test, and `resume-queued` added to the background door's `it.for` refusal parity list.
  - Step 6: the queued launch-message test.
- `test/observation/outcome-delivery.test.ts` (step 5): `renderQuestionAffordance` with `resume-queued`.
- `README.md` (step 8):
  - The `subagent` parameter paragraph (a background resume may queue).
  - The Concurrency section (background resumes queue too; a foreground resume bypasses).
  - The events table (`subagents:resuming` fires once a queued resume is admitted; `subagents:resumed` covers a resume stopped while queued).
  - The `SubagentRecord` paragraph ("`still-running` and `resume-queued` clear when the run settles").
  - The `resume` contract: a `resume-queued` row in the refusal table, and a sentence that the returned promise spans the wait for a slot.
- `docs/architecture/architecture.md` (step 8):
  - The state diagram's `queued --> running` label ("…when capacity frees for a queued spawn" becomes "…for a queued background run").
  - The `subagent-manager.ts` and `subagent.ts` module-tree entries.
  - The roadmap step's `✅` (heading and the `S1013` Mermaid node), its `Landed:` note, and the release-vehicles entry (`[#1013] (decided at plan time)` becomes `fix!:`).
- `CHANGELOG.md`: generated at release; no hand edit.

Predicted unchanged, in the blast radius:

- `src/service/service-adapter.ts` and `test/service/service-adapter.test.ts`: the adapter forwards `background: true` as today; its tests drive a mocked manager and assert only the forwarded options.
- `src/lifecycle/concurrency-limiter.ts` and its tests: `schedule` is called with the same thunk shape `scheduleVia` already passes.
- `src/lifecycle/subagent-run.ts`: a run is already born `queued`, and `stopQueued`/`isActive` already exist.
- `src/observation/subagent-events-observer.ts`, `src/observation/notification.ts`: they map the kind they are handed and render `stoppedWhileQueued` per run.
- `src/ui/agent-widget.ts`
  - It counts `queued` records among the current-run-background ones.
  - It gets no render on enqueue (no observer event fires), but at capacity a background run is live, so its animation timer picks the queued count up on its next tick.
- `src/tools/get-result-tool.ts`, `src/tools/get-result-report.ts`: see Non-Goals.
- `.pi/skills/package-pi-subagents/SKILL.md`: I grepped `queued` and `resume`, and no passage describes resume admission or the refusal members.
- `docs/decisions/0005-subagent-record-admission-policy.md`: its `resumeRefusal` row is unchanged (see Open Questions).
- `docs/configuration.md`: `maxConcurrent` appears only in the settings list and example, with no description of who it gates.

## Test Impact Analysis

1. New tests enabled.
   The `schedule` parameter makes a queued resume constructible at the `Subagent` level with a gated scheduler.
   That covers the birth/admission split, the run-scoped guard, the kind `stopQueued` reports, and the `resume-queued` refusal, without a manager or a limiter.
   The manager tests then pin only the admission rule (which doors queue) end to end against the real limiter.
2. Redundant tests: none.
   The step 1 helper replaces 5 copies of the gate boilerplate without changing what those tests assert.
3. Tests that stay as-is and pin invariants this change must preserve:
   - `subagent.test.ts` "is under way by the time resume() returns" (around line 2259).
   - The manager's "claims the outcome before the turn loop starts when the caller asks" and "returns the record already running the resume".
   - "stops a resume whose caller signal already fired".
   - The `#665` "stopping a queued agent" trio (around lines 526–605).
   - `stopQueued`'s initial-kind test (around lines 538–566).
   - "leaves a queued agent reporting no-session" in `describe("resumeRefusal")`.
   About 20 manager tests now take the limiter path through `background: true` with a free slot.
   Each awaits `record.promise` or `manager.resume`, which absorbs the limiter's extra microtask; step 7 runs the whole file to confirm.

## Invariants at risk

| Invariant (source)                                                                                      | Constituency                                             | Pinned by                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A resume is synchronous up to its turn loop, so its claim lands before the loop ([#1050] retro; [#987]) | The foreground tool resume; the service's claimed resume | `subagent.test.ts` "is under way by the time resume() returns"; manager "claims the outcome before the turn loop starts" (both on the default/bypass path); manager `startResume` "returns the record already running the resume" (limiter path, free slot) |
| One terminal path per run kind ([#1050] `Landed:`)                                                      | Event subscribers (`subagents:resumed`), the nudge       | Step 4's `stopQueued` resume-kind test; step 7's abort tests                                                                                                                                                                                                |
| A run is born queued with its resume and wires the caller's signal when it starts ([#1051] `Landed:`)   | Service callers passing `signal`                         | "stops a resume whose caller signal already fired" (limiter path, free slot); step 3's queued-birth test                                                                                                                                                    |
| A transition lands on the run it ends ([#1051] `Landed:`)                                               | Waiters holding a replaced run                           | Step 3's "only the second resume runs" test (a stale thunk must not start the stopped run)                                                                                                                                                                  |
| A run's mode decides the widget row ([#1012] `Landed:`)                                                 | Widget users                                             | Step 3 asserts `isBackground` on the queued resume                                                                                                                                                                                                          |
| A queued stop notifies exactly once ([#665])                                                            | Parent agent                                             | Existing "notifies exactly once, even after the stopped agent's slot frees"; step 7's queued-resume twin                                                                                                                                                    |
| A queued initial spawn answers `no-session` ([#912] README promise)                                     | Service consumers rendering a Resume affordance          | Existing "leaves a queued agent reporting no-session"                                                                                                                                                                                                       |

## TDD Order

1. **`test(pi-subagents): share a gated scheduler across the scheduleVia tests`**
   - Add `test/helpers/gated-scheduler.ts` exporting `gatedScheduler(): { schedule: (thunk: () => Promise<void>) => Promise<void>; openSlot: () => void }`, typed as a plain function so it does not depend on step 3's alias.
   - Add `test/helpers/gated-scheduler.test.ts`:
     - The thunk does not run before `openSlot()`.
     - `schedule`'s promise settles with the thunk after `openSlot()`.
   - Migrate the 5 gated copies:
     - `subagent.test.ts` around lines 1187, 1234, and 1250.
     - `get-result-tool.test.ts` around lines 50 and 420.
   - Killing mutation: make `schedule` call `thunk()` before awaiting the gate.
     The "does not run before `openSlot()`" test goes red.
   - Verify: the migrated tests pass unmodified in their assertions.
   - Prepares: the gated resumes in steps 3–5 (Tidy-First assessor, recommended).
2. **`refactor(pi-subagents): split a resume's birth from its start`**
   - In `src/lifecycle/subagent.ts`, replace `continueSession` with:
     - a private synchronous `beginResume(options): SubagentRun`: release and `markReplaced` the current run, `new SubagentRun("resume", options.background)`, `claim()` when `claimOutcome`, set `currentRun`;
     - a private `async startResumedRun(run, session, prompt, signal)`: `startRun`, the born-aborted check, `onRunStarted`, `runOnSession`.
   - `resume()` calls `beginResume`, then `this._promise = this.startResumedRun(...)`.
   - The missing-session rejection stays ahead of `beginResume`.
   - No new tests: the step preserves behavior.
   - Verify: the full `subagent.test.ts` and `subagent-manager.test.ts`, including "is under way by the time resume() returns" and "claims the outcome before the turn loop starts when the caller asks".
   - Re-read the moved code against the `code-design` skill before committing.
   - Prepares: step 3 only has to wrap the second call in `schedule(...)` (Tidy-First assessor, recommended).
3. **`refactor(pi-subagents): let a resume wait for admission through a scheduler`**
   - Add `RunScheduler`, retype `scheduleVia`, and give `resume` the optional `schedule` parameter (default: call the thunk at once).
   - The thunk starts the run only while `run.isActive()`.
   - Tests in `test/lifecycle/subagent.test.ts`, new `describe("admission")` inside `describe("a resume")`, each on a settled agent with a live session and the step 1 helper:
     - (a) "waits as the resume's own queued run until admitted": after `resume(…, { background: true }, gated.schedule)`, the record reads `queued` and `isBackground` is `true`.
       `promise` is a `Promise`, `runTurnLoop` has been called once (the initial run), and the observer saw no `"resume"` start.
       After `openSlot()` and `await agent.promise`, the record reads `completed`, `runTurnLoop` was last called with the resume's prompt, and the observer saw the resume start.
     - (b) "is born claimed while it waits, when the caller claims it": with `claimOutcome: true`, `claimed` is `true` while still `queued`.
     - (c) "never runs a resume stopped before its slot opened": `stopQueued()`, then `openSlot()`. `runTurnLoop` is still called once.
     - (d) "runs only the resume that replaced a stopped one": queue resume A (gated), `stopQueued()`, resume B with the default scheduler, `await agent.promise`, then `openSlot()` and flush A's thunk. `runTurnLoop` was called exactly twice and never with A's prompt.
   - Killing mutations, one per class:
     - Call `this.startResumedRun(...)` directly and ignore `schedule`: (a) goes red.
     - Move `claim()` from `beginResume` into the admitted half: (b) goes red.
     - Drop the guard: (c) and (d) go red.
     - Guard on `this.isActive()` instead of `run.isActive()`: (d) goes red and (c) stays green, which is the reason the guard is on the run.
   - Verify: the existing default-scheduler resume tests stay green.
4. **`refactor(pi-subagents): end a queued resume stopped before its slot as a resume`**
   - `stopQueued()` reports `onRunFinished(this, this.currentRun.kind)`; update its doc comment.
   - Test in `test/lifecycle/subagent.test.ts` `describe("stopQueued")`: queue a resume through the gated scheduler with a recording observer, then `stopQueued()`. `onRunFinished` was called exactly once, with `(agent, "resume")`, and `stoppedWhileQueued` is `true`.
   - The existing initial-kind test stays.
   - Killing mutation: restore the hard-coded `"initial"`.
     The new test goes red.
   - Typed `refactor:` because no front door queues a resume until step 7.
5. **`fix(pi-subagents)!: refuse a second resume while one waits for a concurrency slot`**
   - Add `resume-queued` to `ResumeRefusal`, with its doc, and add the getter arm from the Design Overview.
   - Add the `resumeRefusalMessage` case.
   - In `outcome-delivery.ts`, exclude both transient members from `RESUME_REFUSAL_CLAUSES` and branch `renderQuestionAffordance` on either.
   - Update the `SubagentRecord.resumeRefusal` JSDoc in `service.ts`.
   - Tests:
     - `subagent.test.ts` `describe("resumeRefusal")`: "refuses a second resume while one waits for a slot".
       Queue a resume through the gated scheduler; it reads `resume-queued`.
       Open the slot and settle; it reads `undefined`.
     - `agent-tool.test.ts` `describe("refused")`: "tells the parent a resume is already waiting for a slot", with a full-string `toBe` on the sentence above.
     - `agent-tool.test.ts`: add `"resume-queued"` to the background door's `it.for` parity list.
     - `outcome-delivery.test.ts`: `renderQuestionAffordance("agent-1", "Which file?", "resume-queued")` equals the `still-running` rendering for the same arguments and contains no `resume:` token.
   - Killing mutations:
     - Delete the getter's `resume-queued` arm: the `subagent.test.ts` test goes red (it reads `undefined`).
     - Drop the `kind === "resume"` conjunct: the existing "leaves a queued agent reporting no-session" goes red.
     - Remove `resume-queued` from the affordance's transient branch: the outcome-delivery test goes red, since the clause lookup yields `undefined` at runtime.
   - Run `pnpm --filter @gotgenes/pi-subagents run check` after this step: it confirms both exhaustive sites compile, and it fails if one was missed.
   - Commit footer:

     ```text
     BREAKING CHANGE: `ResumeRefusal`, read on `SubagentRecord.resumeRefusal` and
     `ResumeResult.reason`, gains `resume-queued`: an agent whose background resume
     is waiting for a concurrency slot refuses another resume with it, and the
     refusal clears when that run settles. An exhaustive `switch` over either must
     handle the new member.
     ```

6. **`refactor(pi-subagents): report a queued background resume in its launch message`**
   - `resumeInBackground` reads `start.record.status === "queued"` for the headline and `queuePosition`, as sketched.
   - Test in `agent-tool.test.ts` `describe("background resume")`: "says the resume is queued, with its position, when it waits for a slot".
     Use `mockResumeStart(deps, { status: "queued" })` and a full-string `toBe`, starting `Agent resume queued in background.\n` and including `Position: queued (max 4 concurrent)\n` before the blank line.
   - The existing launch-message test pins the unqueued text.
   - Killing mutations:
     - Pass `queuePosition: undefined` unconditionally: red.
     - Hard-code the `resumed` headline: red.
   - Typed `refactor:` because no record reaches the tool queued until step 7.
7. **`fix(pi-subagents): admit a background resume through maxConcurrent`**
   - Add `admitBackground` to `SubagentManager`, use it in `create()` and `startResume()` as sketched, and update the manager's doc comments and `service.ts`'s `resume()` JSDoc.
   - Tests in `test/lifecycle/subagent-manager.test.ts`, new `describe("a background resume")` under `describe("concurrency")`.
   - Arrange at `getMaxConcurrent: () => 1`, using per-spawn session stubs as `queueing with injected stubs` does (around line 416):
     - Agent X settles first.
     - Then a holder spawn with a gated turn loop takes the slot; wait for it to read `running`, because X's slot frees a microtask after X's promise resolves.
   - Tests:
     - (a) "queues at capacity and starts when the slot frees": `startResume(X, …, { background: true })` returns `started`, and X reads `queued` with no second turn loop.
       Release the holder; X runs the resume's prompt and reads `completed`.
     - (b) "starts a foreground resume at capacity, as a foreground spawn does": `{ background: false, claimOutcome: true }`, and X reads `running` at once.
     - (c) "refuses a second resume while the first waits": `{ kind: "refused", reason: "resume-queued" }`.
     - (d) "stops a queued resume as a resume, once, without running it": `manager.abort(X)` reports `onSubagentRunFinished` exactly once, with `(X, "resume")`.
       X reads `stopped` with `stoppedWhileQueued`.
       After the holder finishes, X's resume loop never ran and there is still one report.
     - (e) "abortAll stops a queued resume as a resume".
     - (f) "the waiting door spans the queue": `manager.resume(X, …, { background: true })` stays pending while X is queued, then resolves `{ kind: "resumed", record }` with status `completed` after the holder finishes.
   - Killing mutations:
     - `startResume` passes no scheduler: (a), (c), (d), (e), and (f) go red.
     - Pass `admitBackground` unconditionally: (b) goes red.
     - Hard-code `stopQueued`'s kind as `"initial"`: (d) and (e) go red.
   - Verify: run the whole `subagent-manager.test.ts`. "returns the record already running the resume" stays green through the limiter's synchronous free-slot start, and the other `background: true` resume tests absorb the extra microtask.
   - Commit body: `SubagentsService.resume()` always resumes in the background, so it queues at capacity too, which makes the README's concurrency contract true for it.
8. **`docs(pi-subagents): document resume admission through maxConcurrent`**
   - `README.md` and `docs/architecture/architecture.md`, as listed in Module-Level Changes, including the roadmap step's `✅` (heading and Mermaid node), its `Landed:` note, and the release-vehicles entry.
   - Verify with `pnpm exec rumdl check packages/pi-subagents/README.md packages/pi-subagents/docs/architecture/architecture.md`.

## Risks and Mitigations

- **A stale thunk starts a stopped resume.**
  Steps 3 and 7 guard on the run, and test (d) in step 3 is the case a record-level guard misses.
- **The synchronous start regresses.**
  A background resume below capacity must still read `running` when `startResume` returns, or a claimed resume could reach its terminal edge unclaimed.
  The limiter starts a free-slot task synchronously, and the existing manager test pins it on that path.
- **The limiter's extra microtask breaks an existing test.**
  The scheduled promise settles one tick after the run.
  Tests awaiting `record.promise` absorb it.
  Step 7 runs the whole manager file, and the planning-time trace found no test that reads the resume's terminal state synchronously after `startResume` on the background path.
- **A waiting service `resume()` on a stopped queued resume resolves late.**
  `manager.abort(id)` stops the run, but the limiter's promise settles only when the stale thunk's turn comes and it no-ops.
  So a caller awaiting `resume()` resolves when a slot frees, not at the stop.
  The same is true today of `get_subagent_result(wait: true)` on a stopped queued spawn, and `abortAll()`/`dispose()` settle it at once through `limiter.clear()`.
  Accepted, and not filed: it resolves, with the correct `stopped` record.
- **An exhaustive consumer of `ResumeRefusal` breaks on upgrade.**
  This is intended and declared: `fix!:` with a `BREAKING CHANGE:` footer, a major release.
  No consumer in this monorepo switches over it (`grep -rn ResumeRefusal packages/*/src` outside `pi-subagents` returns nothing).

## Open Questions

- Should decision 0005 state that adding a member to a field's value union (`resumeRefusal`, `status`) is semver-major for exhaustive readers?
  Its rule list names adding, removing, renaming, and narrowing a field, but not widening a field's value set.
  This plan classifies one case by operator decision; it leaves the general rule to whoever next widens one.

[#665]: https://github.com/gotgenes/pi-packages/issues/665
[#912]: https://github.com/gotgenes/pi-packages/issues/912
[#987]: https://github.com/gotgenes/pi-packages/issues/987
[#1012]: https://github.com/gotgenes/pi-packages/issues/1012
[#1049]: https://github.com/gotgenes/pi-packages/issues/1049
[#1050]: https://github.com/gotgenes/pi-packages/issues/1050
[#1051]: https://github.com/gotgenes/pi-packages/issues/1051
[#1058]: https://github.com/gotgenes/pi-packages/issues/1058
[#1079]: https://github.com/gotgenes/pi-packages/issues/1079
