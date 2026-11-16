---
issue: 1049
issue_title: "pi-subagents: give each run its own abort lever, signal wiring, and session subscription"
---

# Give each run its own abort lever, signal wiring, and session subscription

## Release Recommendation

**Release:** ship independently

This issue's roadmap step in `docs/architecture/architecture.md` carries `Release: independent`.
Its `fix:` commits for [#949] are user-visible, so `/ship` cuts a patch release.

## Problem Statement

A subagent is a sequence of runs: the initial run, then one per resume.
The handles a run wires at its start and releases at its end live on `Subagent`, which outlives every run.
`_abortController` is minted by hand in the constructor, at the top of `run()`, and at the top of `runResume()`.
One per-agent `RunListeners` instance has its `wireSignal`/`attachObserver` called from both run paths and its `release()` called from four terminal methods plus `resetForResume`.
Phase 22's recurring bug family ([#913], [#872], [#903]) had exactly this shape: a lever set at one lifecycle edge and read at another.

[#949] is the open member of that family.
A signal that has already fired never emits another `abort` event, so both places that wire one (`RunListeners.wireSignal` and `forwardAbortSignal` in `subagent-session.ts`) register a listener that can never fire.

## Goals

- Add `SubagentRun` (`src/lifecycle/subagent-run.ts`), constructed per run and per resume, owning the run's `AbortController`, its caller-signal wiring, and the record-observer unsubscribe; `run-listeners.ts` folds into it.
- `Subagent.abort()` pulls the current run's lever; `_abortController`, the `abortController` getter, and the `listeners` field leave `Subagent`.
- A run or resume whose caller signal has already fired is **born aborted** and ends without spending a turn ([#949]):
  - A spawn stops right after `onStarted`, before workspace preparation: no workspace, no child session, no `subagents:child:*` events; the record reads `stopped` (operator decision).
  - A resume stops at its turn loop, which declines to prompt; the record reads `stopped`.
- A turn loop handed a signal that has already fired skips `session.prompt()`, returns `responseText: ""`, and (for the initial loop) still emits `subagents:child:completed`, as a mid-run abort does (operator decision).
  This also stops the child when `abort(id)` lands during workspace preparation or session creation, which today runs a full turn loop under a record that reads `stopped`.
- Not breaking.
  The documented contracts already promise it: `SpawnConfig.signal` says "when aborted, the subagent is also stopped", and `ResumeOptions.signal` and the README say the signal cancels the resumed turn loop.

## Non-Goals

- Moving the run's outcome off `SubagentState`; [#1051] owns that.
- Merging `run()`/`runResume()` or `runTurnLoop()`/`resumeTurnLoop()` into one path; [#1050] owns that, and the run-kind-forked names row stays at 16.
- A shared `beginRun(signal)` helper.
  [#913]'s assessor rejected it and this plan's assessor re-rejected it: after construction the two sites diverge (`run()` has its own early terminal, `runResume()` has `onResumeStarted` between the check and the observer attach).
- Checking the lever at every setup boundary (before session creation, after workspace preparation).
  The operator chose stop point A only; an abort that lands mid-setup still creates the session, and the turn-loop guard stops it before any turn.
- Changing ADR 0005 (`docs/decisions/0005-subagent-record-admission-policy.md` line 50 names `abortController` as an example of a withheld live object).
  It is a decision record describing the rule at decision time; the three `service-adapter.test.ts` assertions that a snapshot has no `abortController` stay as they are.

## Background

- `src/lifecycle/subagent.ts` (834 lines) holds `_abortController` (5 occurrences, measured), `private readonly listeners = new RunListeners()`, `run()`, `runResume()`, `abort()`, `resetForResume()`, and the four terminal methods `completeRun`/`failRun`/`completeResume`/`failResume`, each calling `this.listeners.release()`.
  `run()`'s workspace-failure path also calls it.
  `resetForResume()` has exactly one caller, `runResume()` (grep of `src/`).
- `src/lifecycle/run-listeners.ts` holds `RunListeners` (`wireSignal`, `attachObserver`, `release`); its only importer is `subagent.ts`, and its only test is `test/lifecycle/run-listeners.test.ts` (7 tests).
- `src/lifecycle/subagent-session.ts`: `runTurnLoop` and `resumeTurnLoop` each call the private `forwardAbortSignal(session, opts.signal)`, then `session.prompt(...)`, then `failIfProviderErrored(...)`; `responseText` falls back to `getLastAssistantText(session)` when the collector saw nothing.
- Pi's `AgentSession.abort()` ends in `this.agent.abort()`, which is `this.activeRun?.abortController.abort()`: a no-op when no run is active (read in the pinned 1.0.0 compiled `dist/core/agent-session.js` and `pi-agent-core/dist/agent.js`, and unchanged on `../../pi` `main`).
  So the fix [#949] proposed for `forwardAbortSignal` (call `session.abort()` immediately) would not stop the `prompt()` that follows; the loop must skip `prompt()` instead.
- Signal sources: a foreground spawn passes the `subagent` tool call's signal (`runForeground` → `spawnAndWait`); a resume passes the tool call's signal (`resumeExisting`) or a service caller's `ResumeOptions.signal`.
  Background spawns and service spawns carry no signal.
  `abort(id)` and the parent-interrupt handler pull the record's lever via `Subagent.abort()`.
- The `pi-subagents/lifecycle` fallow zone allows same-zone imports (`pnpm --silent fallow guard packages/pi-subagents/src/lifecycle/subagent.ts`, run at planning time); `subagent-run.ts` imports nothing from the package, so the new `subagent.ts → subagent-run.ts` edge cannot form a cycle.

### Reproduction

A disposable Vitest spike (deleted before this plan) drove the real `Subagent` and `SubagentSession` classes against the repo's own stub-session helpers (`createSubagentSessionStub`, `makeStubExecution`, and a hand-built `AgentSession` stub for the `SubagentSession` case).
The input is synthetic in that the child session is a stub, but the code under test is the production path; the code is deterministic, so n = 1 per scenario.

| Scenario                                                                        | Measured on pre-change code                                                                                  |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| S1: spawn with an already-fired signal                                          | factory called once, `runTurnLoop` called with an **unaborted** signal, status `completed`, result `"done"`  |
| S2: `abort()` while `createSubagentSession` is pending                          | `abort()` returns `true`; `runTurnLoop` called with an **aborted** signal; status `stopped`, result `"done"` |
| S3: `SubagentSession.runTurnLoop`/`resumeTurnLoop` with an already-fired signal | `session.prompt` called each time, `session.abort` never; the full answer returned                           |
| S4: resume with an already-fired signal                                         | `resumeTurnLoop` called with an unaborted signal, status `completed`, result `"resumed"`                     |

S2 is the reachable trigger with the widest window: session creation loads and binds every child extension, and a worktree provider's `prepare()` creates a git worktree, so an `abort(id)` in that window leaves a `stopped` record whose child runs a whole turn loop.

## Design Overview

### `SubagentRun`

```typescript
/** One run of a subagent (the initial run or a resume) and the handles it holds until it ends. */
export class SubagentRun {
	private readonly controller = new AbortController();
	private detachCallerSignal?: () => void;
	private unsubscribeObserver?: () => void;

	/**
	 * A caller signal that has already fired gives a run born aborted, with no
	 * listener; one that fires later calls onCallerAbort.
	 */
	constructor(callerSignal: AbortSignal | undefined, onCallerAbort: () => void);

	/** The run's own lever, handed to the turn loop. */
	get signal(): AbortSignal;
	get aborted(): boolean;
	abort(): void;
	/** Keep the record-observer unsubscribe until the run ends. */
	attachObserver(unsubscribe: () => void): void;
	/** Detach the caller signal and unsubscribe the observer. Idempotent. */
	release(): void;
}
```

The born-aborted branch aborts the run's own controller rather than calling `onCallerAbort`.
Calling back during construction would run `Subagent.abort()` before `currentRun` is assigned, so it would pull the previous run's lever.
`Subagent` instead reads `aborted` once the run is assigned and calls `abort()` itself, which is idempotent on the controller and marks the record `stopped`.
In step 2 (behavior-preserving) the constructor always wires the listener; step 4 adds the born-aborted branch.

### `Subagent`

`_abortController`, the `abortController` getter, and `listeners` are replaced by `private currentRun?: SubagentRun`, undefined until the first run; the constructor no longer mints a controller.

```typescript
abort(): boolean {
	if (!this.isRunning()) return false;
	this.currentRun?.abort();
	this.markStopped();
	return true;
}
```

Call sites after step 4:

```typescript
// run(): the run is created where the controller is minted today, so an abort during onStarted reaches it
this.currentRun = new SubagentRun(this.execution.signal, () => this.abort());
this.markRunning(Date.now());
this.execution.observer?.onStarted?.(this);
if (this.currentRun.aborted) return this.endBeforeStart(); // abort(), release, onRunFinished

// runResume(): after resetForResume, which releases the previous run
this.resetForResume(Date.now());
this.currentRun = new SubagentRun(signal, () => this.abort());
if (this.currentRun.aborted) this.abort();
this.execution.observer?.onResumeStarted?.(this);
```

`endBeforeStart()` is a private terminal next to `failRun`: `this.abort()`, `this.currentRun?.release()`, `onRunFinished`.
It takes the same shape as the workspace-failure path, with `stopped` in place of `error`.
The record ends `stopped` with `result` undefined, no session (`resumeRefusal` reads `no-session`), and no workspace notice, because no workspace was prepared.
A resume born aborted needs no new terminal: its loop returns without prompting and `completeResume` runs, as it does after a mid-run abort.

`resetForResume()` releases `this.currentRun` (the previous run) instead of `this.listeners`; every terminal path already released it, so this stays a safety net.
The five `this.listeners.release()` calls become `this.currentRun?.release()`.

### `SubagentSession` turn loops

`forwardAbortSignal` gives way to a check at the top of each loop, before `enforceTurnBudget`:

- When `opts.signal?.aborted`, the loop does not prompt, sends no budget warning, and does not call `failIfProviderErrored`.
  A resumed session whose earlier run failed would otherwise throw that old failure.
  It returns `{ responseText: "", turnBudget: tracker.budget }`.
  The initial loop still emits `lifecycle.completed`, so `subagents:child:completed` fires exactly as it does after a mid-run abort.
- `""` and not the `getLastAssistantText` fallback: on a resume, the fallback would return the **previous** run's answer.
- Otherwise the loop runs as today, with the listener-forwarding (`signal` fires mid-prompt → `session.abort()`) kept for the mid-run case.

### Edge cases and the steps that pin them

| Edge case                                                       | Behavior                                                                                             | Pinned in                   |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------- |
| Spawn born aborted                                              | stops before workspace preparation; `stopped`, no session, `onStarted` and `onRunFinished` once each | Step 4                      |
| Spawn born aborted with a workspace provider                    | `prepare()` never called                                                                             | Step 4                      |
| Resume born aborted                                             | loop receives an aborted signal; `stopped`; `onResumeFinished` once                                  | Step 4                      |
| Born-aborted run's caller listener                              | no listener registered; `onCallerAbort` never called                                                 | Step 4 (`SubagentRun` unit) |
| `abort()` during session creation                               | loop takes no turn; `stopped`, result `""`                                                           | Step 3 (loop unit)          |
| Loop with fired signal, resumed session with prior answer       | returns `""`, not the prior answer                                                                   | Step 3                      |
| Loop with fired signal, resumed session whose last turn errored | resolves, does not throw                                                                             | Step 3                      |
| Loop with fired signal, whole budget is wrap-up turns           | sends no budget warning                                                                              | Step 3                      |
| Resume after an aborted run                                     | gets an unspent lever                                                                                | Step 1 (rewritten pin)      |
| Finished run                                                    | record observer unsubscribed; later session events do not reach the record                           | Step 1 (new pin)            |

## Module-Level Changes

| File                                       | Change                                                                                                                                                                                                                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lifecycle/subagent-run.ts`            | **New**: `SubagentRun` (step 2), born-aborted branch (step 4)                                                                                                                                                                                                    |
| `src/lifecycle/run-listeners.ts`           | **Deleted** (step 2)                                                                                                                                                                                                                                             |
| `src/lifecycle/subagent.ts`                | `currentRun` replaces `_abortController`/getter/`listeners`; constructor mint removed; `abort()`; header comment ("listener lifecycle to RunListeners"), `abort()` and `resume()` doc comments (step 2); `endBeforeStart()` and the born-aborted checks (step 4) |
| `src/lifecycle/subagent-session.ts`        | the fired-signal check in both loops; `forwardAbortSignal` kept for the mid-prompt case (step 3)                                                                                                                                                                 |
| `src/service/service.ts`                   | `ResumeOptions.signal` doc comment: a signal that has already fired stops the resume before its first turn (step 4; `verify:public-types` after)                                                                                                                 |
| `test/lifecycle/subagent-run.test.ts`      | **New**: absorbs `run-listeners.test.ts` (step 2); born-aborted cases (step 4)                                                                                                                                                                                   |
| `test/lifecycle/run-listeners.test.ts`     | **Deleted** (step 2)                                                                                                                                                                                                                                             |
| `test/lifecycle/subagent.test.ts`          | step 1 migrations and the unsubscribe pin; step 2 deletes the two constructor-controller tests (around lines 79 and 98); step 4 born-aborted tests                                                                                                               |
| `test/lifecycle/subagent-manager.test.ts`  | step 1 migrates the `abortController` read (around line 1579); step 4 adds door tests                                                                                                                                                                            |
| `test/lifecycle/subagent-session.test.ts`  | step 3 fired-signal tests                                                                                                                                                                                                                                        |
| `README.md`                                | the resume `signal` paragraph (around line 404) gains the already-fired case (step 4)                                                                                                                                                                            |
| `docs/architecture/architecture.md`        | module tree line `run-listeners.ts` → `subagent-run.ts` (step 2); the step's ✅ heading, the `S1049` Mermaid node (`✅ #1049`), and a `Landed:` note (step 5)                                                                                                    |
| `.pi/skills/package-pi-subagents/SKILL.md` | Lifecycle row: `run-listeners.ts` → `subagent-run.ts`, "per-run listener handles" → "per-run abort lever, signal wiring, and observer subscription"; count stays 15 (step 2)                                                                                     |

Predicted unchanged, with the claim each rests on:

- `test/service/service-adapter.test.ts`: its three `not.toHaveProperty("abortController")` assertions still hold (a snapshot never carried the lever, and the record no longer has one).
- `docs/decisions/0005-subagent-record-admission-policy.md`: see Non-Goals.
- `architecture.md`'s other Mermaid blocks: the `Subagent` node label ("abort/steer/run lifecycle") and the state diagram's `running --> stopped : abort() called` stay accurate, since a born-aborted run reaches `stopped` through `abort()`.
- `src/lifecycle/subagent-manager.ts`, `src/tools/*`, `src/service/service-adapter.ts`: no code reads `abortController` or `RunListeners` outside `subagent.ts` (grep of `src/` and `test/` at planning time).
- The `resetForResume` row (8) and the run-kind-forked names row (16), both measured at planning time, are unchanged; the `_abortController` row goes 5 → 0.

## Test Impact Analysis

1. Enabled: `SubagentRun` is unit-testable on its own (born aborted, caller abort, release), replacing `RunListeners`' tests, which could not express "born aborted".
2. Redundant: the two constructor tests asserting `record.abortController` is a fresh `AbortController` describe removed behavior and are deleted in step 2; `run-listeners.test.ts` moves into `subagent-run.test.ts`.
3. Kept as-is: the `Subagent.resume() — cancellation` tests (around line 1742) and the manager's abort-by-id resume test, which already observe the lever through the signal the loop received; and `subagent-session.test.ts`'s mid-prompt abort tests (around line 418), which pin the forwarding this plan keeps.

The `mock.calls[N]` count in `subagent.test.ts` is 19 (measured); step 1 must not raise it, which [#1050]'s target depends on, so capture loop signals in `mockImplementation` rather than reading `mock.calls`.
Suite baseline: 2100 tests in 86 files (measured).
Predicted after step 5: about 2116 in 86 files (estimated: +1, +2, +4, +9 across steps 1-4, minus the 2 deleted constructor tests; `run-listeners.test.ts` and `subagent-run.test.ts` swap one-for-one).

## Invariants at risk

- [#913]'s Outcome: `abort(id)` cancels an in-flight resume, and a resume after an aborted run gets an unspent lever.
  Pinned by `subagent.test.ts` `Subagent.resume() — cancellation` (drives a real `resume()` against a parked loop and asserts the loop is signalled) and the manager test "stops an in-flight resume when the caller aborts it by id".
  The "not already spent" test is rewritten in step 1 to abort a real parked `run()` and stays a pin.
- A caller signal that fires mid-run stops the agent: `subagent.test.ts` `Subagent.run() — abort signal forwarding`, migrated in step 1 to assert on the signal the loop captured.
- A mid-prompt signal still aborts the session: `subagent-session.test.ts` "aborts the session when the parent signal fires mid-prompt", unchanged.
- `subagents:child:completed` still fires once per initial loop, including an aborted one: pinned in step 3.

## TDD Order

1. **`test(pi-subagents): observe the run's lever through the signal its turn loop received`**
   Preparatory, green before and after; it removes the friction of eight test reads of the `abortController` getter step 2 deletes.
   - Hoist a `parkRunUntilSignalled(stub)` helper beside `createRunnableAgent`, mirroring `parkResumeUntilSignalled`: it captures the loop's `signal`, `abortedAtEntry`, and whether it was signalled.
   - Migrate the reads: around line 346 ("fires the AbortController…") drives a parked `run()` and asserts the loop was signalled, since `abort()` on a never-run record will have no lever to observe.
     Around line 1195, capture `signal` in the `runTurnLoop` mock and assert it aborted.
     Around lines 1647 and 1684, assert via captured signal; 1684 keeps `not.toBe(callerSignal)`.
     Around line 1772 ("not already spent"), abort a real parked `run()`, keep the signal its loop saw as `spent`, then assert the resume loop's signal differs and is unaborted at entry.
     In `subagent-manager.test.ts` around line 1579, use `expect.objectContaining({ signal: expect.any(AbortSignal) })`.
   - Leave the two constructor tests (around lines 79 and 98) for step 2 to delete.
   - Add one pin: after `run()` settles, emitting a usage `message_end` on the mock session does not change `record.lifetimeUsage`; this pins the observer unsubscribe that step 2 relocates.
   - Killing mutation (unsubscribe pin): delete `this.listeners.release();` from `completeRun`; the new pin goes red.
     The migrated tests are mutated by the rule for tests written after Green: make `abort()` skip `this.abortController.abort()`; the rewritten line-346 and line-1772 tests go red.
   - Must not raise the `mock.calls[` count above 19.
2. **`refactor(pi-subagents): give each run its own abort lever and listener handles`**
   - Add `src/lifecycle/subagent-run.ts` with `SubagentRun` (constructor always wires the listener when a signal is given; no born-aborted branch yet).
   - Replace `_abortController`, the getter, and `listeners` with `currentRun`, following the Design Overview; delete the constructor mint and `run-listeners.ts`.
   - Move `run-listeners.test.ts` to `subagent-run.test.ts` under `describe("SubagentRun")`; add `abort()` aborts `signal` and an unaborted run reads `aborted === false`.
   - Delete the two constructor-controller tests.
   - Update the `subagent.ts` header, `abort()`, and `resume()` doc comments, the architecture module-tree line, and the package skill's Lifecycle row.
   - Re-read the moved `RunListeners` code against `code-design` before committing.
   - Killing mutations: delete `this.currentRun?.abort();` in `abort()` (step 1's parked-run and cancellation tests go red); delete the `this.currentRun.attachObserver(...)` call in `run()` (step 1's unsubscribe pin goes red); make the `SubagentRun` constructor skip `addEventListener` (the migrated "abort signal forwarding" test and the `subagent-run.test.ts` caller-abort test go red).
   - Verify: `grep -c '_abortController' packages/pi-subagents/src/lifecycle/subagent.ts` prints 0, `run-listeners.ts` is gone, `pnpm run check`, `fallow dead-code`.
3. **`fix(pi-subagents): a turn loop whose signal already fired takes no turn`**
   Tests in `subagent-session.test.ts`, under a new `describe("a signal that already fired")` for both loops:
   - `runTurnLoop` with an aborted signal: `session.prompt` not called, `responseText === ""`, `lifecycle.completed` called once.
   - `resumeTurnLoop` with an aborted signal on a session whose history ends in an assistant answer: `prompt` not called, `responseText === ""`.
   - `resumeTurnLoop` with an aborted signal on a session whose last assistant message has `stopReason: "error"`: resolves.
   - `runTurnLoop` with an aborted signal and `maxTurns` equal to `wrapUpTurns`: `sendCustomMessage` not called.
   Killing mutations, one per class:
   - Delete the fired-signal check in `runTurnLoop` (the prompt and completed tests go red on `prompt`).
   - On the skipped path, return `getLastAssistantText(session)` (the stale-answer test goes red).
   - Call `failIfProviderErrored` on the skipped path (the errored-history test rejects).
   - Move the check below `enforceTurnBudget` (the warning test goes red).
   - Drop `lifecycle.completed` on the skipped path (the completed assertion goes red).
4. **`fix(pi-subagents): a spawn or resume whose signal already fired stops before its first turn`**
   - `SubagentRun` gains the born-aborted branch.
     Tests: an already-fired signal gives `aborted === true` and `signal.aborted === true`; `onCallerAbort` is never called, and a later `release()` does not throw.
   - `run()` gains the check and `endBeforeStart()`.
     Tests in `subagent.test.ts` under a new `describe("a signal that already fired")` nested by run kind:
     - Spawn: factory never called, `runTurnLoop` never called, status `stopped`, `result` undefined, `resumeRefusal === "no-session"`, `onStarted` and `onRunFinished` once each.
     - Spawn with a workspace provider: `prepare` never called.
     - Resume: the loop's captured signal is aborted at entry, status `stopped`, `onResumeFinished` once.
   - Door tests in `subagent-manager.test.ts`: `spawnAndWait` with an aborted signal resolves to a `stopped` record whose factory never ran; `resume(id, prompt, { signal: aborted })` returns `resumed` with a `stopped` record.
   - Update `ResumeOptions.signal`'s doc comment and the README resume paragraph; run `pnpm --filter @gotgenes/pi-subagents run verify:public-types`.
   - Killing mutations:
     - Delete the born-aborted branch in the `SubagentRun` constructor: the unit tests go red, and so does the spawn test, because the run proceeds.
     - Delete `if (this.currentRun.aborted) return this.endBeforeStart();` from `run()`: the spawn tests go red on the factory call.
     - Move that check below workspace preparation: only the provider test goes red.
     - Delete `if (this.currentRun.aborted) this.abort();` from `runResume()`: the resume test goes red on status (`completed`), while the loop-signal assertion stays green.
5. **`docs(pi-subagents): mark the per-run lever step landed`**
   - In `architecture.md`, mark the `#### [#1049]` heading ✅ and change the `S1049` Mermaid node to `✅ #1049`.
   - Add a `Landed:` note that states the measured `_abortController` row (0), that `run-listeners.ts` is gone, and the chosen stop points.
   - Parse the Mermaid block with `mmdc` (or the repo's renderer check).

## Risks and Mitigations

- **A test relying on `abort()` reaching a controller on a never-run record.**
  Step 1 rewrites the two such tests (around lines 346 and 1772) to drive a real run, so step 2's removal of the constructor mint breaks nothing.
  The design's `currentRun?.abort()` keeps `abort()` on a seeded `running` record returning `true` and marking `stopped`, which the "marks stopped and returns true even without an AbortController" test pins.
- **Born-aborted check ordering.**
  Calling `onCallerAbort` from the constructor would pull the previous run's lever; the design reads `aborted` after assignment instead, and step 4's first mutation pins the branch.
- **The skipped loop changing what consumers of `subagents:child:completed` see.**
  The event still fires once per initial loop with the same payload shape; step 3 pins it.
- **A stale prior answer in a stopped resume's result.**
  Step 3's stale-answer test pins the `""` return.
- **Mid-setup aborts still create a session.**
  Accepted by the operator's choice of stop point A; the session's turn loop takes no turn (step 3), and its disposal follows the normal retention path.

## Open Questions

- None blocking.
  [#1050] decides whether `endBeforeStart()` survives as a separate terminal once the run kinds share one lifecycle.

[#872]: https://github.com/gotgenes/pi-packages/issues/872
[#903]: https://github.com/gotgenes/pi-packages/issues/903
[#913]: https://github.com/gotgenes/pi-packages/issues/913
[#949]: https://github.com/gotgenes/pi-packages/issues/949
[#1050]: https://github.com/gotgenes/pi-packages/issues/1050
[#1051]: https://github.com/gotgenes/pi-packages/issues/1051
