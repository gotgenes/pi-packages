---
issue: 913
issue_title: "pi-subagents: abort(id) does not cancel an in-flight resume"
---

# Give a resumed run an abort lever the record can pull

## Release Recommendation

**Release:** ship independently

Phase 22's Step 22 carries `Release: independent` in `docs/architecture/architecture.md`, and the `Release batches` subsection lists Step 22 under "Independently releasable" as a `fix:`.
It belongs to no batch, so it is its own release vehicle.

## Problem Statement

`abort(id)` reports success on a resumed agent and does not stop it.

`Subagent.abort()` fires `this.abortController`, a single controller minted at construction.
`Subagent.resume(prompt, signal)` deliberately does **not** route through that controller — a record aborted on its original run holds a spent one, so a resume routed through it would cancel instantly — and passes the caller's `signal` straight to `SubagentSession.resumeTurnLoop`.
The consequence is that the record has no live lever on a resumed run: `abort()` marks it `stopped` and returns `true` while the child keeps taking turns and spending tokens.

The `subagent` tool door masks this, because the parent's tool-call signal reaches `resumeTurnLoop` on its own.
Step 16's service door ([#885]) has no such signal unless the caller supplies one, which is what makes the gap reachable.

## Goals

- `abort(id)` cancels an in-flight resume: the record's lever reaches the resumed turn loop.
- The record holds a **live** controller for whichever run is current, so a resume that follows an aborted original run is still cancellable.
- A caller-supplied `signal` and the record's own lever are one lever, not two: the caller's signal routes through `abort()`, so `resume()` treats it the way `run()` already treats its spawn-time signal.
- The public prose that documents the gap (`ResumeOptions.signal`, `README.md`) is corrected rather than left describing a fixed defect.

This change is **not breaking**.
No `SubagentRecord` field, no `ResumeResult` shape, and no default changes; the `exports` surface is untouched.
The one observable move is a status reclassification on a path that is already a cancellation: a caller-signal cancel of a resume now lands the record on `stopped` instead of `completed`, which is what `run()` has always reported for the same event.
Commit type `fix:`, per the roadmap step.

## Non-Goals

- **`AbortSignal.any` composition.**
  Keeping the caller's signal as a second, independent lever (cancelling the loop without moving the record's status) was offered at the gate and declined: it preserves today's `completed`-after-a-cancel reading, which is the same class of untruthful outcome Steps 17, 19, and 21 removed.
- **A pre-call resumability query ([#912]).**
  A sibling issue on the same door, deferred to a later phase; nothing here depends on it.
- **The already-aborted-signal gap ([#949]).**
  `RunListeners.wireSignal` and `forwardAbortSignal` both register with `addEventListener`, which never fires for a signal that is already aborted (measured: `node -e 'const c=new AbortController(); c.abort(); c.signal.addEventListener("abort", …)'` never fires).
  A caller that passes an already-cancelled signal to `resume()` — or a spawn whose `execution.signal` is already aborted — gets a run that is never cancelled.
  This change neither creates nor widens that gap: it holds on both paths today and on both paths after.
  Filed as [#949] rather than folded in, because the fix changes `run()`'s spawn-path behavior too.
- **`SubagentSession.resumeTurnLoop`'s signature and `forwardAbortSignal`.**
  The roadmap's Target line names `subagent-session.ts`; the settled design leaves it unchanged (see Module-Level Changes).
- **Retention, workspace, and claim semantics on resume.**
  `completeResume`/`failResume`, `WorkspaceBracket`, and the `claimOutcome` path are untouched.

## Background

Relevant modules, all in `packages/pi-subagents/`:

- `src/lifecycle/subagent.ts` — `Subagent` owns the record.
  `readonly abortController: AbortController` (line ~168) is assigned once in the constructor (line ~305); `run()` passes `this.abortController.signal` into `runTurnLoop` and wires the spawn-time signal with `this.listeners.wireSignal(this.execution.signal, () => this.abort())`; `runResume()` passes the caller's `signal` through to `resumeTurnLoop` and wires nothing; `abort()` guards on `isRunning()`, fires the controller, and calls `markStopped()`.
- `src/lifecycle/run-listeners.ts` — `RunListeners.wireSignal(signal, onAbort)` stores a detach handle; `release()` drops both the observer unsubscribe and the signal listener.
  `resetForResume()` calls `listeners.release()`, which is the ordering constraint the resume wiring must respect.
- `src/lifecycle/subagent-session.ts` — `resumeTurnLoop(prompt, signal?)` calls `forwardAbortSignal(session, signal)`, which turns an abort into `session.abort()`.
- `src/lifecycle/subagent-manager.ts` — `abort(id)` routes a `queued` record to `stopQueued()` and everything else to `record.abort()`; `resume(id, prompt, options)` owns the refusal policy and forwards `options.signal`.
- `src/service/service.ts` / `src/service/service-adapter.ts` — the public `ResumeOptions.signal`, whose doc comment currently documents the defect.
- `src/tools/agent-tool.ts` — `resumeExisting` passes `signal ?? new AbortController().signal`, so the tool door always supplies one (a never-firing dummy when the SDK gave it none).

Constraint from `AGENTS.md` and the package skill: `Subagent`'s abort controller is excluded from `SubagentRecord` by `docs/decisions/0005-subagent-record-admission-policy.md` (rule 1, live objects), so nothing about this change crosses the by-value service boundary.
Pi's own agent loop already mints a fresh `AbortController` per run (`.pi/skills/pi-extension-lifecycle/SKILL.md`; `docs/plans/0403-abort-subagents-on-interrupt.md` records the same reading of `pi-agent-core`), so per-run controller lifetime is the host's own shape, not an invention here.

### Reproduction

Measured with a disposable Vitest spike driving the real `Subagent` class against the suite's own `createSubagentSessionStub` — the same seam `test/lifecycle/subagent.test.ts` drives, and the path the issue's "Steps to reproduce" names.
The spike was deleted after the measurement; its three readings:

| Scenario                                                    | Reading                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resume()` with no signal, then `abort()`                   | `abort()` → `true`; status `stopped` immediately; `resumeTurnLoop` received `undefined` as its signal; the loop was never signalled; the late answer still landed in `result`, so the record reads `stopped` while carrying the text of a run that ran to completion |
| `resume(prompt, callerSignal)`, then `callerSignal.abort()` | the loop was signalled once; the record landed on `completed` with the partial text — the cancel is invisible on the record                                                                                                                                          |
| `run()` aborted, then `resume()`                            | the construction-time controller reads `signal.aborted === true` at resume entry — the spent-controller fact the bypass exists to avoid                                                                                                                              |

## Design Overview

One lever, minted per run.

`Subagent` keeps a private mutable controller behind a read-only getter with the existing public name:

```typescript
private _abortController: AbortController;
/** Cancels whichever run is current — the initial run, or the resume that replaced it. */
get abortController(): AbortController { return this._abortController; }
```

The constructor still assigns one, so a record that has never run (and a test that constructs one with `status: "running"` and calls `abort()`) still holds a live controller.
`run()` and `runResume()` each **remint** it as their first synchronous statement, before any `await`:

- `run()`: remint, then `markRunning`, then `wireSignal(this.execution.signal, () => this.abort())` — unchanged in shape, and unobservable on its own (the constructor's controller was never fired before `run()`).
- `runResume()`: remint, then `resetForResume()` (which releases the previous run's listeners), then `wireSignal(signal, () => this.abort())`, then `attachObserver(...)`, then `resumeTurnLoop(prompt, this.abortController.signal)`.

The remint is what removes the reason the bypass existed: at the top of a resume the controller is always fresh, so a record aborted on its original run resumes under a signal that is not already spent.

Both writes are synchronous before the first `await` in `runResume()`, so the controller and the `running` status are both in place by the time `resume()` returns its promise — an `abort()` issued immediately after `await manager.resume(...)` starts, or in the same tick, finds a live lever.

`resumeTurnLoop`'s signature and `forwardAbortSignal` do not change: the resume simply hands it a different signal.

### Caller call site

The service door is unchanged, and reads the same either way:

```typescript
const outcome = await subagents.resume(id, "answer", { signal: ctl.signal });
// Either lever now stops the same run:
ctl.abort();          // routes through record.abort() → status "stopped"
subagents.abort(id);  // fires the record's current controller → status "stopped"
```

### Edge cases

- **`abort()` between runs.**
  Status is terminal, `isRunning()` is false, `abort()` returns `false` — unchanged.
- **Abort mid-resume, then the loop resolves.**
  `completeResume` calls `markCompleted`, whose status guard refuses to overwrite `stopped`; `result` is still set (measured), so the record reads `stopped` carrying whatever text the loop produced.
  Unchanged by this plan, and the same as the initial-run abort path.
- **A caller signal that fires after the resume settles.**
  `completeResume`/`failResume` call `listeners.release()`, which detaches the signal listener — so a late fire reaches nothing, and `abort()` would decline on status anyway.
- **Repeated resumes.**
  Each mints its own controller; the previous one is dropped un-aborted, exactly as Pi's own loop discards a finished run's controller.
- **`abortAll()` / interrupt.**
  A resumed agent is now actually stopped by `abortAll()`, which is the behavior `docs/plans/0664-abort-all-on-interrupt-policy-setting.md` assumes for every active record.

## Module-Level Changes

### Changed

- `src/lifecycle/subagent.ts`
  - `readonly abortController: AbortController` → private `_abortController` + read-only getter (same public name).
  - `run()`: remint the controller as the first statement.
  - `runResume()`: remint the controller; wire the caller's `signal` through `this.listeners.wireSignal(signal, () => this.abort())` **after** `resetForResume()`; pass `this.abortController.signal` to `resumeTurnLoop`.
  - `resume()` JSDoc: the sentence "The parent signal flows straight through to resumeTurnLoop — resume does not route through this.abortController" is now false and is replaced by the new contract.
- `src/lifecycle/subagent-manager.ts` — doc comment on `ResumeCallOptions.signal` ("Cancels the resumed turn loop.
  A resume does not run under the record's own controller.") is now false.
- `src/service/service.ts` — doc comment on `ResumeOptions.signal` ("`abort(id)` does not reach it: a resume does not run under the record's own abort controller.") is now false.
  This is public `.d.ts` prose: it is rolled into `dist/public.d.ts`.
- `README.md` line ~362 — "`abort(id)` does not reach it: a resume does not run under the record's own abort controller." is the same claim in the user-facing guide.
  Grepped: this is the only `abort(id)` occurrence in `README.md` and `docs/*.md`.
- `docs/architecture/architecture.md` — Step 22's heading gains `✅`, the step gains its `Landed:` note, and the Mermaid node `S22["Step 22 (#913)<br/>Resume abort lever"]` gains `✅`.
- `test/lifecycle/subagent.test.ts` — two assertions of the removed forwarding must be rewritten: `"completes the round trip: ask, answer by resuming, continue"` (`toHaveBeenCalledWith("The project one.", undefined)`, line ~1550) and `"passes the prompt and signal straight through to resumeTurnLoop"` (`mock.calls[0][1]).toBe(signal)`, line ~1584).
  New tests for the three equivalence classes below.
- `test/lifecycle/subagent-manager.test.ts` — `"forwards the caller's signal to the resumed turn loop"` (line ~1565) asserts `toHaveBeenCalledWith("continue", signal)` against the caller's raw signal and breaks in the same commit.
  Found by the Tidy-First assessor; not in the issue's file list.

### Predicted unchanged (falsifiable claims)

- `src/lifecycle/subagent-session.ts` — `resumeTurnLoop(prompt, signal?)` and `forwardAbortSignal` already accept any signal; only the argument changes.
  The roadmap's Target line names this file; the design does not need it.
- `src/lifecycle/run-listeners.ts` — `wireSignal` is used as-is on the resume path. (The already-aborted gap it carries is [#949], a Non-Goal.)
- `src/service/service-adapter.ts`, `src/tools/agent-tool.ts` — no code change.
  `agent-tool.ts`'s `signal ?? new AbortController().signal` keeps working; the dummy simply never fires.
- `test/service/service-adapter.test.ts` (line ~576) — asserts `service.resume()` forwards the `signal` option to a **mocked** manager, so `Subagent`'s internal routing is invisible to it.
  `test/tools/agent-tool.test.ts` likewise drives a mocked manager.
- `test/helpers/make-subagent.ts`, `test/helpers/mock-session.ts` — `createSubagentSessionStub.resumeTurnLoop` is a plain `vi.fn()`, so a test can record the signal it received with no fixture change.
- The five existing `record.abortController` / `agent.abortController` assertions (`subagent.test.ts` lines ~75, ~94, ~95, ~355, ~1135) — a getter preserves the read shape exactly, and the constructor still assigns one.

## Test Impact Analysis

The change enables a test that was previously impossible: "abort during a resume signals the resumed turn loop."
Today there is nothing to assert — `resumeTurnLoop` receives `undefined` when no caller signal is supplied.

- **New, enabled.**
  Three classes (below), all at the `Subagent` unit level, plus one at the manager door (`manager.abort(id)` during a resume).
- **Redundant.**
  None.
  `"passes the prompt and signal straight through to resumeTurnLoop"` is not redundant but **wrong** after the change: it pins the defect.
  It is rewritten to assert the new contract (the loop receives the record's live signal, and the caller's signal moves the record).
- **Must stay.**
  `"completes the round trip: ask, answer by resuming, continue"` keeps every assertion about status, result, and `pendingQuestion`; only its `toHaveBeenCalledWith` argument changes.
  The resume observer-lifecycle block, the workspace-hold block, and `service-adapter.test.ts`'s forwarding test all genuinely exercise layers this change does not touch.

The assertion shape matters for class 3: assert that the signal handed to `resumeTurnLoop` is **not** aborted at entry and **becomes** aborted after `abort()`.
An end-state-only assertion (`signal.aborted === true`) passes under a stale pre-aborted controller and does not discriminate.

## Invariants at risk

| Invariant (roadmap step)                                                                                                 | Constituency                       | Pinned by                                                                                                 | Status after                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step 8 ([#465]) — a child's question survives a round trip; a resumed answer clears it                                   | the parent agent answering a child | `subagent.test.ts` `"completes the round trip…"`, `"records a follow-up question a resumed run declares"` | holds; the round-trip test's forwarding argument changes, its outcome assertions do not                                                                                    |
| Step 10 / 12 — a question-holding child's workspace survives to the resume and is disposed on the resume's terminal edge | a workspace-backed child           | `subagent.test.ts` resume/workspace block (`completeResume` disposal)                                     | holds; `completeResume`/`failResume` untouched                                                                                                                             |
| Step 14 ([#872]) — the mid-run update gate is re-read on resume, not decided at spawn                                    | the parent receiving updates       | `subagent.test.ts` / `subagent-manager.test.ts` update-gate tests                                         | holds; a mid-resume abort makes the record inactive, so a later update rides the outcome instead of being announced — the same rule an aborted initial run already follows |
| Step 16 ([#885]) — the service door resumes and `ResumeOptions.signal` cancels the resumed loop                          | a cross-extension consumer         | `service-adapter.test.ts` `resume` forwarding tests                                                       | holds; the signal still cancels, and now also moves the record's status                                                                                                    |
| Step 21 ([#903]) — a resumed outcome reaches the parent exactly once                                                     | the parent agent                   | `subagent-manager.test.ts` / outcome-delivery tests                                                       | holds; `onResumeFinished` still fires from both terminal paths                                                                                                             |

No invariant here is quantitative, and none is discharged by "no input of this shape exists".

## TDD Order

1. **`refactor: back Subagent.abortController with a getter over a private field`** Prepares: the behavioral fix reassigns the controller in two places, which in one diff would be entangled with the field's `readonly` → mutable shape change.
   Landing the shape change first keeps step 2 purely behavioral (two remints plus the routing swap).
   `src/lifecycle/subagent.ts` only: `readonly abortController` → `private _abortController` + `get abortController()`; constructor assigns `this._abortController`.
   No new tests; the five existing `abortController` assertions verify it green-to-green.
   Killing mutation: make the getter return `new AbortController()` on each call — `"fires the AbortController, marks stopped, and returns true when running"` (line ~355) goes red.
   Verify: `pnpm --filter @gotgenes/pi-subagents exec vitest run` and `pnpm run check`.

2. **`fix: cancel an in-flight resume when abort(id) is called`** Test surface: `test/lifecycle/subagent.test.ts` (new `describe("Subagent.resume() — cancellation")`) and `test/lifecycle/subagent-manager.test.ts`.
   Red first, then the `subagent.ts` change; the three stale forwarding assertions are rewritten in this same commit, because the routing change breaks them at this commit.

   Covered, by equivalence class:
   - **(a) The record's lever reaches the loop.**
     `resume()` with no caller signal, then `abort()`: the signal `resumeTurnLoop` received fires, the record reads `stopped`, `abort()` returns `true`.
     Also at the manager door: `manager.abort(id)` during a resume.
     Killing mutation: in `runResume()`, pass the caller's `signal` to `resumeTurnLoop` instead of `this.abortController.signal` — (a) goes red, (b) and (c) stay green.
   - **(b) The caller's signal is the same lever.**
     `resume(prompt, callerSignal)`, then `callerSignal.abort()`: the loop is signalled **and** the record reads `stopped` (today: `completed`).
     The rewritten `"…straight through to resumeTurnLoop"` and the manager's `"forwards the caller's signal…"` assert this contract instead of raw identity.
     Killing mutation: delete `this.listeners.wireSignal(signal, () => this.abort())` from `runResume()` — (b) goes red on the status assertion, (a) stays green.
   - **(c) The lever is live after an aborted original run.**
     Abort the initial run, then `resume()` and `abort()` again: the signal `resumeTurnLoop` received is **not** aborted at entry and fires on the second `abort()`.
     Killing mutation: delete the remint at the top of `runResume()` — (c) goes red (the signal arrives pre-aborted and never fires), (a) and (b) stay green.

   Implementation: remint in `run()` and `runResume()`; wire the caller's signal after `resetForResume()`; pass `this.abortController.signal` to `resumeTurnLoop`; rewrite the `resume()` JSDoc and the `ResumeCallOptions.signal` / `ResumeOptions.signal` doc comments to state the new contract.
   Verify: full suite, `pnpm run check`, `pnpm run lint`, and `pnpm run verify:public-types` (the `service.ts` doc comment is rolled into `dist/public.d.ts`).

3. **`docs: record the resume abort lever in the README and roadmap`** `README.md`'s `Pass signal to cancel the resumed turn loop.` paragraph loses the "`abort(id)` does not reach it" sentence and gains the composed contract.
   `docs/architecture/architecture.md`: Step 22 heading gains `✅`, a `Landed:` note is added, and the Mermaid `S22` node is marked.
   Verify: `pnpm exec rumdl check` on both files.

## Risks and Mitigations

- **A caller that relied on a resume reading `completed` after its own cancel.**
  The only in-repo caller is `agent-tool.ts`'s `resumeExisting`, which renders `renderStatusNote(record.status)` — a parent that interrupted its own tool call is not reading that result anyway.
  Mitigated by being the point of the change: `run()` has always reported `stopped` for the same event, and the gate settled it.
- **The remint is placed after an `await`.**
  Then an `abort()` issued in the same tick as `resume()` fires a stale controller and the fix silently does not hold.
  Mitigated by class (c)'s assertion (the signal is not aborted at entry) plus a test that calls `abort()` synchronously after `resume()` returns its promise.
- **A dropped, un-aborted controller leaks a listener.**
  `forwardAbortSignal` removes its listener in `resumeTurnLoop`'s `finally`, and `RunListeners.release()` detaches the wired caller signal on every terminal path, so neither survives the run.
  Mitigated by the existing `"releases the observer subscription after resume completes"` test plus `listeners.release()` coverage.
- **`abort()`'s `isRunning()` guard races the resume's status write.**
  `resetForResume()` runs synchronously inside `runResume()` before the first `await`, so `resume()` cannot return before the record is `running`.
  Verified by the existing `onResumeStarted` test, which observes `status: "running"` at that edge.

## Open Questions

- Whether the already-aborted-signal gap ([#949]) should also make `abort()` idempotent across runs (firing a controller that a previous run already spent).
  Defer until [#949] is planned; nothing here depends on it.

[#465]: https://github.com/gotgenes/pi-packages/issues/465
[#872]: https://github.com/gotgenes/pi-packages/issues/872
[#885]: https://github.com/gotgenes/pi-packages/issues/885
[#903]: https://github.com/gotgenes/pi-packages/issues/903
[#912]: https://github.com/gotgenes/pi-packages/issues/912
[#949]: https://github.com/gotgenes/pi-packages/issues/949
