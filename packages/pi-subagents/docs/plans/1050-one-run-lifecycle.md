---
issue: 1050
issue_title: "pi-subagents: run initial and resumed runs through one lifecycle"
---

# Run initial and resumed runs through one lifecycle

## Release Recommendation

**Release:** ship independently

The roadmap step is tagged `Release: independent`, and Phase 23 defines no batches.
Step 3 is a `fix:` (a run that wraps up at its turn limit with a question keeps its workspace), so the branch cuts a patch release; every other step is `refactor:`, `test:`, or `docs:`.

## Problem Statement

A subagent is a sequence of runs: the initial run, then one per resume.
Whether a run is the initial run or a resume is a property of the run, but the code re-decides it in parallel method pairs at three layers:

| Layer                             | Initial run                  | Resume                                |
| --------------------------------- | ---------------------------- | ------------------------------------- |
| Turn loop (`SubagentSession`)     | `runTurnLoop`                | `resumeTurnLoop`                      |
| Run body (`Subagent`)             | `run`                        | `runResume`                           |
| Terminal transitions (`Subagent`) | `completeRun`, `failRun`     | `completeResume`, `failResume`        |
| Lifecycle observer                | `onStarted`, `onRunFinished` | `onResumeStarted`, `onResumeFinished` |

The pairs have already diverged.
A run that wraps up at its turn limit (`completed`, `phase: "warned"`) after asking a question tears its workspace down when it is the initial run, and keeps it when it is a resume.
No test covers the resume side.

The concentrated test-design debt the Phase 23 craftsmanship scout found sits in the same seam: `test/lifecycle/subagent.test.ts` calls the terminal methods directly, reads the factory's channels through `mock.calls`, duplicates its run-to-outcome arranges, and lists 37 flat top-level `describe` blocks.

## Goals

- Both run kinds follow one workspace rule: a `completed` run that declared a question holds its workspace for the resume that answers it, whether or not it wrapped up at its turn limit (operator decision; see Design Overview).
  This changes the initial run, the side the user-facing docs already contradict.
- One turn loop in `SubagentSession`; the session owns its first run (parent-context prefix, `subagents:child:completed`), and its turn limits are resolved once, at creation.
- One run body and one private pair of terminal transitions in `Subagent`, parameterized by the run's kind, which `SubagentRun` carries.
- One `onRunStarted`/`onRunFinished(agent, kind)` pair on `SubagentLifecycleObserver`, and one `onSubagentRunStarted`/`onSubagentRunFinished(record, kind)` pair on `SubagentManagerObserver`; `SubagentEventsObserver` maps the kind to the unchanged published channels in one place.
- The roadmap's ride-alongs: one `{ id, type, description }` payload builder in the events observer, an assistant-message factory in `subagent-session.test.ts`, and that file's local session mock folded onto the shared helpers.
- `test/lifecycle/subagent.test.ts`: terminal tests drive real runs, one run helper captures the session factory's channels, and the tests nest under one root with run-kind groups.
- Not breaking: the published `subagents:*` and `subagents:child:*` channels, their payloads, and `SubagentRecord` are unchanged; both observer interfaces are internal (neither is reachable from `src/service/service.ts`).

## Non-Goals

- `resetForResume`, `_superseded`, and per-run outcome ownership: [#1051].
  `resetForResume` stays, so the roadmap's `resetForResume` row is unchanged at 8.
- A queued resume and `stopQueued` for a resume kind: [#1013].
  `stopQueued` reports kind `"initial"`, the only kind a queued record can have until then.
- Per-run mode (`isBackground`) for the widget: [#1012].
- Withheld notifications crossing a resume boundary: [#1058] (third-party report, `src/observation/notification.ts`).
  This plan does not touch `notification.ts`; `persistAndNotify` still runs once per terminal transition of either kind.
- Consolidating the published event channels: [#1025], deferred by the operator at phase planning.
- Deduplicating `DEFAULT_WRAP_UP_TURNS` against `src/settings.ts`: the constant moves to `turn-limits.ts` here, but `settings.ts` is not touched (recorded as a deferred tidying).

## Background

- `src/lifecycle/subagent.ts` (850 lines, measured): `run()` is the initial run's prefix (new `SubagentRun`, `markRunning`, `onStarted`, the born-aborted early end, workspace preparation, session creation, steer flush, `onSessionCreated`) followed by the turn loop and `completeRun`/`failRun`.
  `resume()` checks for a session and publishes `runResume()`'s promise; `runResume()` rewinds (`resetForResume`), mints a new `SubagentRun`, aborts a born-aborted one, fires `onResumeStarted`, attaches the record observer, and ends in `completeResume`/`failResume`.
  The four terminal methods are public, called only from inside the class in `src/` (measured with grep), and directly by tests.
- `completeRun` (line ~697) releases the run, then decides `holdForResume = completed && pendingQuestion && !wrappedUpAtTurnLimit(...)`.
  `completeResume` (line ~558) marks first, releases after, and holds on `!exhausted && pendingQuestion`.
  `failRun` and `failResume` are identical apart from the observer method.
  The workspace-prepare failure in `run()` is a third terminal sequence (`markError`, `release`, `onRunFinished`).
- `src/lifecycle/subagent-session.ts`: `runTurnLoop` resolves and stores `turnLimits` (`opts.maxTurns ?? meta.agentMaxTurns ?? opts.defaultMaxTurns`), prefixes `meta.parentContext`, and emits `lifecycle.completed`; `resumeTurnLoop` reuses the stored limits.
  Both share the private `promptForAnswer` since [#1049], so `fallow dupes` already reports no `runTurnLoop`/`resumeTurnLoop` clone.
- `src/lifecycle/subagent-run.ts` ([#1049]): one run's abort lever, caller-signal wiring, and record-observer unsubscribe.
- `SubagentManager.buildObserver` (`subagent-manager.ts:262`) maps the lifecycle observer to `SubagentManagerObserver`, wrapping `onRunFinished`/`onResumeStarted`/`onResumeFinished` in `try`/`debugLog` but not `onStarted`.
  `SubagentManagerObserver` is implemented by `SubagentEventsObserver`, `CompositeSubagentObserver`, and `AgentWidget`; production's manager observer is always the composite, which isolates each delegate.
- The events observer writes `{ id: record.id, type: record.type, description: record.description }` by hand at 5 sites (measured).
- AGENTS.md constraints that apply: run package scripts from the root with `pnpm --filter @gotgenes/pi-subagents`; never `cd packages/...`.

### The workspace rule, and why it is "hold"

The scenario, under a `WorkspaceProvider` such as pi-subagents-worktrees: the harness warns a child it has 2 turns left; the child calls `ask_parent` and finishes in time (`completed`, `phase: "warned"`).
An initial run tears the worktree down, appends "Changes saved to branch…", and reports `resumeRefusal: "workspace-disposed"`, so every carrier shows the question with "can no longer be resumed".
A resumed run keeps the worktree and shows the question with the `resume` call that answers it.
With no workspace provider the two are indistinguishable (`dispose()` returns `""` and `workspaceDisposed` stays false).

The initial run's rule lives only in [#1021]'s plan and one test.
That plan kept it for continuity with the retired `steered` status and listed "should a wrapped-up run with a question hold?"
as an open question, to revisit with [#1022]'s resume budgets; [#1022] then gave every resume a fresh budget and left the rule as a non-goal.
Every user-facing doc already describes hold: `docs/configuration.md` ("a workspace is torn down at run end unless the child completed"), `README.md` (resumable "until you answer it"), and `pi-subagents-worktrees/README.md` ("When the child ends its turn with a question for you, the worktree is kept").
The operator chose hold for both kinds (2026-10-16), which answers [#1021]'s open question.

## Design Overview

### Run kind

```typescript
// src/lifecycle/subagent-run.ts
export type RunKind = "initial" | "resume";

export class SubagentRun {
  constructor(readonly kind: RunKind, callerSignal: AbortSignal | undefined, onCallerAbort: () => void) { … }
}
```

Each prefix decides the kind once, where it mints the run: `run()` mints `"initial"`, the resume prefix mints `"resume"`.
Nothing downstream re-derives it; the terminal transitions read `run.kind`.

### Session layer: the session owns its first run

```typescript
// src/lifecycle/turn-limits.ts
export interface TurnLimitRequest { maxTurns?: number; defaultMaxTurns?: number; wrapUpTurns?: number }
export interface TurnLimits { maxTurns?: number; wrapUpTurns: number }
export function resolveTurnLimits(request: TurnLimitRequest | undefined, agentMaxTurns: number | undefined): TurnLimits;
// maxTurns: normalizeMaxTurns(request.maxTurns ?? agentMaxTurns ?? request.defaultMaxTurns)
// wrapUpTurns: request.wrapUpTurns ?? DEFAULT_WRAP_UP_TURNS (moved from subagent-session.ts, private)

// src/lifecycle/create-subagent-session.ts
interface CreateSubagentSessionParams { …; turnLimits?: TurnLimitRequest }   // 8 → 9 fields
// meta: turnLimits: resolveTurnLimits(params.turnLimits, cfg.agentMaxTurns)  (replaces agentMaxTurns)

// src/lifecycle/subagent-session.ts
interface TurnLoopOptions { signal?: AbortSignal; onTurnBudget?: (budget: TurnBudget) => void }
async runTurnLoop(prompt: string, opts: TurnLoopOptions): Promise<TurnLoopResult>
```

`Subagent.run()` already reads `getRunConfig()` once, immediately before `createSubagentSession`, and hands the same snapshot to the turn loop, so passing `{ maxTurns: execution.maxTurns, defaultMaxTurns, wrapUpTurns }` at creation resolves identical limits; the mutable `turnLimits` field and its "unlimited until the initial run starts" state go away.

The session keeps one private flag, set at the **start** of the first `runTurnLoop` call:

```typescript
async runTurnLoop(prompt, opts) {
  const firstRun = !this.hasRun;
  this.hasRun = true;
  const tracker = new TurnBudgetTracker(this.meta.turnLimits);
  const responseText = await this.promptForAnswer(firstRun ? this.withParentContext(prompt) : prompt, tracker, opts);
  if (firstRun) this.meta.lifecycle.completed({ sessionDir, agentName, turnBudget: tracker.budget });
  return { responseText, turnBudget: tracker.budget };
}
```

Setting the flag at the start preserves today's edges: a first run whose prompt throws never emits `completed`, and a resume after it neither prefixes nor emits (as `resumeTurnLoop` never did); a first run handed a fired signal takes no turn and still emits `completed` ([#1049]'s outcome).
The session's first run and the record's `"initial"` kind are the same fact by construction: production creates a session only inside `Subagent.run()`, and `resume()` refuses without one.

### Record layer: one run body, private terminal transitions

```typescript
async run() {                                   // initial prefix
  const run = this.beginRun(new SubagentRun("initial", this.execution.signal, () => this.abort()));
  this.markRunning(Date.now());
  this.notifyRunStarted(run);
  if (run.aborted) return this.endBeforeStart(run);
  … prepare workspace (catch → this.fail(run, err)) …
  … createSubagentSession({ …, turnLimits }) (catch → this.fail(run, err)) …
  this.flushPendingSteers(); this.execution.observer?.onSessionCreated?.(this);
  await this.runOnSession(run, this.subagentSession, this.execution.prompt);
}

private async continueSession(session, prompt, signal) {   // resume prefix: no await before runOnSession
  this.resetForResume(Date.now());
  const run = this.beginRun(new SubagentRun("resume", signal, () => this.abort()));
  if (run.aborted) this.abort();
  this.notifyRunStarted(run);
  await this.runOnSession(run, session, prompt);
}

private async runOnSession(run, session, prompt) {          // the shared body
  run.attachObserver(subscribeSubagentObserver(session, this.state, { onCompact: … }));
  try { this.complete(run, await session.runTurnLoop(prompt, { signal: run.signal, onTurnBudget: … })); }
  catch (err) { this.fail(run, err); }
}

private complete(run: SubagentRun, result: TurnLoopResult): void {
  run.release();
  const finalStatus = result.turnBudget.phase === "exhausted" ? "aborted" : "completed";
  const holdForResume = finalStatus === "completed" && this.pendingQuestion !== undefined;
  … mark, then this.execution.observer?.onRunFinished?.(this, run.kind);
}

private fail(run: SubagentRun, err: unknown): void {  // markError, clearPendingQuestion, release, quiet dispose, notify
}
```

The method names are the plan's proposal; the implementing session may rename them, but none may reintroduce a name the run-kind grep counts.
`complete` releases before marking (`completeRun`'s order); the release unsubscribes the record observer and detaches the caller signal, and nothing observes the order between them.
The workspace-prepare failure routes through `fail`: nothing was prepared, so `workspaceBracket.dispose()` returns `""` without setting `wasDisposed`, and no question exists yet, so the path is behavior-identical.
`endBeforeStart` and `stopQueued` stay; they notify `onRunFinished(this, run.kind)` and `onRunFinished(this, "initial")`.

**Invariant kept:** the resume prefix runs synchronously inside `resume()` up to `runTurnLoop`'s first await, as `runResume` does today, so `startResume`'s claim and the `running` status are in place before `resume()` returns.
Step 11 pins it with a new test.

### Observer layer

```typescript
// SubagentLifecycleObserver
onRunStarted?(agent: Subagent, kind: RunKind): void;
onRunFinished?(agent: Subagent, kind: RunKind): void;

// SubagentManagerObserver
onSubagentRunStarted(record: Subagent, kind: RunKind): void;
onSubagentRunFinished(record: Subagent, kind: RunKind): void;
```

`buildObserver` passes both through, each wrapped in `try`/`debugLog`.
That wraps the initial run's start for the first time; production cannot observe it, since the composite already isolates every delegate.

`SubagentEventsObserver` is the one place the kind becomes a channel:

```typescript
onSubagentRunStarted(record, kind) {
  this.emit(kind === "initial" ? "subagents:started" : "subagents:resuming", identityOf(record));
}
onSubagentRunFinished(record, kind) {
  this.emit(finishedChannel(record, kind), buildEventData(record));   // resume → resumed; initial → failed | completed
  this.persistAndNotify(record);
}
```

`AgentWidget` and `CompositeSubagentObserver` collapse their four methods to two; the widget ignores the kind.
`identityOf(record)` is a private builder in the events observer, used by the started/resuming, update, compacted, and created payloads.

### Edge cases and the step that tests each

| Edge case                                                | Behavior                                                          | Step                 |
| -------------------------------------------------------- | ----------------------------------------------------------------- | -------------------- |
| Completed with a question, initial or resume             | Holds the workspace                                               | 3, 13                |
| Wrapped up (`warned`) with a question, initial or resume | Holds the workspace                                               | 3, 13                |
| Exhausted with a question                                | Disposes as `aborted`, keeps the question                         | 13                   |
| Failure after a question                                 | Disposes as `error`, drops the question                           | 1, 13                |
| Workspace prepare rejects                                | `error`, `onRunFinished` once with `"initial"`                    | 11                   |
| First `runTurnLoop` handed a fired signal                | No turn, `""`, still emits `completed`                            | existing, kept in 10 |
| Second `runTurnLoop`                                     | No prefix, no `completed`, fresh budget under the creation limits | 10                   |
| First `runTurnLoop` throws                               | No `completed`; a later run still neither prefixes nor emits      | 10                   |
| `resume()` returns                                       | Status `running`, `onRunStarted(agent, "resume")` already fired   | 11                   |
| A throwing manager run-started observer                  | The run still completes                                           | 12                   |

### Design-review checklist

- Dependency width: `CreateSubagentSessionParams` grows from 8 to 9 fields with one cohesive value (`TurnLimitRequest`); `SubagentSessionMeta` swaps `agentMaxTurns` for the resolved `turnLimits`, so its width is unchanged.
- Parameter relay: the kind flows `Subagent` → `buildObserver` → composite → events observer; only the events observer reads it.
  The widget ignores it, which is the same relay the record itself takes today.
- Repeated discriminators: `kind === "initial"` appears at one dispatch point (the events observer's two channel mappings); the session's `firstRun` is its own state, not a relayed kind.
- Output arguments, scattered resets, Law of Demeter: none introduced.
- Fallow zones: `RunKind` is imported type-only by `observation/` and `ui/`, both of which already import `lifecycle/` (`pnpm --silent fallow guard packages/pi-subagents/src/ui/agent-widget.ts` lists `pi-subagents/lifecycle` as allowed).
  `subagent-run.ts` imports nothing, so no cycle.

## Module-Level Changes

### `src/`

- `src/lifecycle/subagent-run.ts`: export `RunKind`; `SubagentRun` takes and exposes `kind` (step 11).
- `src/lifecycle/turn-limits.ts`: add `TurnLimitRequest`, `TurnLimits`, `resolveTurnLimits`, and the private `DEFAULT_WRAP_UP_TURNS` (step 9).
- `src/lifecycle/create-subagent-session.ts`: `CreateSubagentSessionParams.turnLimits`; build meta with `resolveTurnLimits` (step 9).
- `src/lifecycle/subagent-session.ts`: meta `turnLimits` replaces `agentMaxTurns`; the mutable `turnLimits` field and `DEFAULT_WRAP_UP_TURNS` go (step 9); one `runTurnLoop` with the first-run flag; delete `resumeTurnLoop` and `ResumeTurnLoopOptions` (step 10).
- `src/lifecycle/subagent.ts`: drop the `wrappedUpAtTurnLimit` clause and import (step 3); pass `turnLimits` to the factory (step 9); call `runTurnLoop` for a resume (step 10); one run body, private `complete`/`fail`, the kind-carrying observer pair, prepare failure through `fail` (step 11).
- `src/lifecycle/subagent-manager.ts`: `buildObserver` maps the kind-carrying pair onto the four manager methods (step 11, transitional), then `SubagentManagerObserver` collapses and `buildObserver` passes through (step 12).
- `src/observation/subagent-events-observer.ts`: `identityOf` builder (step 4); two methods mapping kind to channel (step 12).
- `src/observation/composite-subagent-observer.ts`, `src/ui/agent-widget.ts`: two methods instead of four (step 12).
- `src/session/session-config.ts`: the line-205 comment naming `SubagentSession.runTurnLoop` as where the limits combine now names `resolveTurnLimits` (step 9).

### `test/`

- `test/lifecycle/subagent.test.ts`: steps 1, 2, 3, 8, 9 (RunConfig threading asserts factory params; real-session fixture meta), 10 (stub sites), 11 (observer names, guards), 13 (nesting).
- `test/lifecycle/subagent-session.test.ts`: steps 5, 6, 7, 9 (14 limit-option calls move to meta; precedence tests move out), 10.
- `test/lifecycle/turn-limits.test.ts`: `resolveTurnLimits` tests (step 9).
- `test/lifecycle/create-subagent-session.test.ts`: the factory resolves turn limits with the agent's `maxTurns` (step 9).
- `test/lifecycle/subagent-run.test.ts`: 13 `new SubagentRun(` sites gain the kind; one kind test (step 11).
- `test/lifecycle/subagent-manager.test.ts`: steps 8, 10 (22 `resumeTurnLoop` sites), 12 (35 observer-name references, the `createManager` defaults at lines 65-68, guards on resume-from-finish observers).
- `test/observation/subagent-events-observer.test.ts` (24 references), `test/observation/composite-subagent-observer.test.ts` (28), `test/ui/agent-widget.test.ts` (19), `test/ui/widget-viewport.test.ts` (1): step 12.
- `test/tools/get-result-tool.test.ts`: 2 `resumeTurnLoop` sites (step 10); 2 `onRunFinished` resume-from-finish observers gain a kind guard (step 11).
- `test/helpers/mock-session.ts`: `listenerCount()` on `MockSession` (step 6); `createSubagentSessionStub` drops `resumeTurnLoop` (step 10).
- `test/helpers/mock-session.test.ts`: a `listenerCount` test (step 6).
- `test/helpers/manager-stubs.ts`: the line-36 comment naming `resumeTurnLoop` (step 10).

### Docs (step 14)

- `docs/architecture/architecture.md`:
  - The class diagram drops `+completeRun`/`+failRun`/`+completeResume`/`+failResume`.
  - The turn-budget prose (lines ~287-292) stops naming the four methods: "the one case a run ends `aborted`", "under the limits the session resolved at creation", and `stopQueued` "like every terminal transition".
  - The module tree describes `subagent-session.ts` (one turn loop; the first run carries the parent context and announces completion), `subagent-run.ts` (carries its kind), and `turn-limits.ts` (`resolveTurnLimits`).
  - "What the core owns" (line ~474) stops naming `resumeTurnLoop`.
  - The `subagents:resumed` row says any terminal status, not `completed`/`error`.
  - The "Production duplication" paragraph is rewritten from a fresh `pnpm fallow dupes --workspace @gotgenes/pi-subagents` run.
  - The roadmap gets the `✅` on the [#1050] heading and its Mermaid node, plus a `Landed:` note recording the hold decision, the final run-kind, payload, and `mock.calls` counts, and `subagent.ts`'s line count.
- Predicted unchanged: the execution-flow sequence diagram (`Ag->>Sub: runTurnLoop(prompt, opts)` stays true) and the agent-lifecycle state diagram (statuses and transitions do not change).
  The same holds for `README.md`, `docs/configuration.md`, and `pi-subagents-worktrees/README.md`, which already describe hold, and for `.pi/skills/package-pi-subagents/SKILL.md`, where a grep for every renamed symbol finds nothing.
- The roadmap's Findings and metric baselines are history and stay as written.

## Test Impact Analysis

1. Newly possible: the hold rule as a grid over both run kinds (step 13), because one stubbed `runTurnLoop` and one terminal path let a `describe.each` drive either kind through the same assertions.
   `resolveTurnLimits` becomes a pure-function test instead of three session tests.
   `resume()`'s synchronous prefix gets an explicit pin (step 11).
2. Redundant: the direct `completeRun`/`failRun` tests (`createCompletionAgent`) are replaced by driven ones in step 1, not duplicated.
   The three limit-precedence tests in `subagent-session.test.ts` move to `turn-limits.test.ts`.
   The resume-only `resumeTurnLoop` describe in `subagent-session.test.ts` becomes "a later run" tests on a primed session.
3. Must stay as-is: the "provider failures reach the record" tests (real `SubagentSession` over a mock `AgentSession`, run then resume); the "a signal that already fired" tests for both layers; the subagent-manager resume tests that pin claims and announcements end to end.

Counts, measured at planning (`12e693a6`) and predicted:

| Metric                                                   | Now (measured)         | After                                                                                    | Recompute                                                                                                     |
| -------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Run-kind-forked names in `src/`                          | 16                     | 0 after step 11                                                                          | the roadmap's fenced grep                                                                                     |
| `description: record.description` in the events observer | 5                      | 1 after step 4 (the builder)                                                             | `grep -c 'description: record.description' packages/pi-subagents/src/observation/subagent-events-observer.ts` |
| `mock.calls[` lines in `subagent.test.ts`                | 16                     | 2 after step 2, 1 after step 9 (the `prepare` `toStrictEqual` read its comment explains) | `grep -c 'mock\.calls\[' packages/pi-subagents/test/lifecycle/subagent.test.ts`                               |
| Top-level `describe(` in `subagent.test.ts`              | 37                     | 1 after step 13                                                                          | `grep -c '^describe(' packages/pi-subagents/test/lifecycle/subagent.test.ts`                                  |
| `lifecycle/subagent.ts` lines                            | 850                    | about 815 (estimated)                                                                    | `wc -l`                                                                                                       |
| Production clone groups                                  | 0 between `src/` files | 0                                                                                        | `pnpm fallow dupes --workspace @gotgenes/pi-subagents`                                                        |
| Tests                                                    | 2116 in 86 files       | about 2125 (estimated)                                                                   | `pnpm --filter @gotgenes/pi-subagents exec vitest run`                                                        |

The roadmap's `mock.calls` baseline (19) predates [#1049]; 16 is today's.

## Invariants at risk

| Invariant (source)                                                                                                                  | Constituency                                          | Pinned by                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| A spawn whose signal already fired stops after the started notification, before the workspace or session exists ([#1049] `Landed:`) | Parents that cancel during setup                      | `subagent.test.ts` "a signal that already fired > run()" (3 tests); kept through step 11                                                           |
| A turn loop handed a fired signal takes no turn and returns `""`; the initial one still emits `subagents:child:completed` ([#1049]) | Child-lifecycle subscribers                           | `subagent-session.test.ts` "a turn loop whose signal already fired"; step 10 keeps both halves                                                     |
| A resume gets a fresh budget under the initial run's ceiling ([#1022])                                                              | Parents resuming a budgeted child                     | `subagent-session.test.ts` "gives a resume a fresh budget…" and "stops a resume at the original run's ceiling"; limits now come from meta (step 9) |
| `aborted` ⇔ `phase: "exhausted"` ([#1021])                                                                                          | Paseo, event subscribers                              | the driven completion tests from step 1, then the step-13 grid                                                                                     |
| A claim taken by `startResume` is in place before the turn loop starts ([#1015])                                                    | Result carriers                                       | `subagent-manager.test.ts` "claims the outcome before the turn loop starts when the caller asks"; plus step 11's synchronous-prefix test           |
| A provider error on either kind lands on the record ([#889], [#898])                                                                | Every parent                                          | `subagent.test.ts` "provider failures reach the record" (real session)                                                                             |
| Published channels per kind are unchanged                                                                                           | pi-permission-system, Paseo, any `pi.events` consumer | `subagent-events-observer.test.ts`, rewritten in step 12 to assert the channel for each kind and status                                            |
| `subagents:child:completed` fires once per child, after its first run                                                               | Child-lifecycle subscribers                           | `subagent-session.test.ts` lifecycle-event tests plus step 10's "a later run emits no completed"                                                   |

Each named file drives the real layer under test: `subagent-session.test.ts` constructs a real `SubagentSession`, `subagent.test.ts` a real `Subagent` (stubbing only the session, except the provider-failure describe), and `subagent-events-observer.test.ts` a real observer over a recording `emit`.

## TDD Order

Run each step's tests and `pnpm --filter @gotgenes/pi-subagents run check` before its commit; run the full package suite after steps 9, 10, 11, and 12, which change shared interfaces or a shared stub.
Steps 1-8 are preparatory (the Tidy-First assessment); each leaves the tree green.

1. **`test(pi-subagents): drive the terminal-transition tests through real runs`** Rewrite the `createCompletionAgent` describes (`completeRun`, `failRun`) and the ask-back recorder's two direct `failRun`/`failResume` tests to run the agent through `run()`/`resume()` with a stubbed turn-loop result or rejection.
   The resumed-failure test must ask its question from inside the resume loop: `resetForResume` clears a seeded `pendingQuestion`, so seeding would make the test vacuous.
   Killing mutations: delete `this.clearPendingQuestion()` from `failResume` (kills the resumed-failure test); make `completeRun` call `markCompleted` for an exhausted result (kills the exhausted-status test).
2. **`test(pi-subagents): one run helper that captures the session factory's channels`** Add a factory helper that records the `CreateSubagentSessionParams` it receives and exposes `ask(question)`/`notify(message)`/`params()`.
   It replaces the 12 `factory.mock.calls[0][0].askParent`/`.notifyParent` reads and the two `cwd` reads (lines ~754, ~785).
   Merge `runWithWorkspace` and `runAsking`, plus `heldAgentWithObserver`'s hand-rolled capture, into one run-to-outcome helper with an optional workspace.
   Keep `createRunnableAgent`'s `run-1`/`run test` identity, which the dispose assertions read, and strip the `question` key before building the turn-loop result.
   Leave the `prepare.mock.calls` read (line ~765), whose comment explains the `toStrictEqual`.
   Killing mutations: make `run()` pass `askParent: undefined` to the factory (kills the ask-back recorder tests); pass `cwd: undefined` (kills the workspace cwd test).
3. **`fix(pi-subagents): keep the workspace of a run that wraps up at its turn limit with a question`** Red: flip "disposes a run that wrapped up at its turn limit and declared a question" to assert the workspace is held (`dispose` not called, `result` without the addendum, `workspaceDisposed` false, `resumeRefusal` undefined), and add the resume twin (a held agent resumed, asking again, ending `warned`).
   The resume twin passes before the fix; it is the pin for the side that already holds.
   Green: `holdForResume` in `completeRun` becomes `finalStatus === "completed" && this.pendingQuestion !== undefined`; drop the `wrappedUpAtTurnLimit` import and fix the comment.
   Killing mutations: restore the `!wrappedUpAtTurnLimit(...)` clause in `completeRun` (kills the initial test); add `&& result.turnBudget.phase !== "warned"` to `completeResume`'s hold (kills the resume twin).
4. **`refactor(pi-subagents): build the events observer's identity payload once`** A private `identityOf(record)` serves the started, resuming, update, compacted, and created payloads (spread where extra fields follow); the payload row reads 1.
   Killing mutation: make `identityOf` omit `description` (kills the started, resuming, update, compacted, and created payload assertions, all full-shape).
5. **`test(pi-subagents): build assistant messages through one factory in the session tests`** An `assistantMessage(text, extra?)` factory in `subagent-session.test.ts` replaces the repeated `{ role: "assistant", content: [{ type: "text", text }] … }` literal (14 `role: "assistant"` lines, measured; the `turn_end` and `providerErrorMessage` shapes keep their own builders if they do not fit).
   Pure test refactor; mutation check: change the factory's `role` to `"user"` and confirm the response-capture tests go red.
6. **`test(pi-subagents): fold the session tests' local mock onto the shared session helpers`** `createSession(finalText)` becomes a thin layer over `createFactorySession()` that adds only `sendCustomMessage`, `getSessionStats` (the 100-token / 42% values its tests read), and a `prompt` that appends the final assistant message.
   `emit(listeners, …)` and the `program*` helpers take the session and call `session.emit`; the one listener-length assertion uses a new `MockSession.listenerCount()`; the teardown-order assertions use `invocationCallOrder` of `extensionRunner.emit` and `dispose` instead of the `calls` array.
   Killing mutations: make `listenerCount()` return the number of `subscribe` calls rather than live subscribers (kills the new `mock-session.test.ts` test and the dispose-releases-subscription test); swap `emitChildSessionShutdown` and `dispose` in `SubagentSession.dispose` (kills the teardown-order test).
7. **`test(pi-subagents): give the resume-path session tests a settled first run`** In `subagent-session.test.ts`, the `resumeTurnLoop` and "signal already fired > resumeTurnLoop" tests that call it on a never-run session first `await sub.runTurnLoop("go", {})`.
   The tests that seed an errored history (`collectTurnFailure` reads it at construction, so priming would throw) stay unprimed; step 10 renames them into first-run tests, and the primed ones cover the later-run path.
   Killing mutation: make `resumeTurnLoop` emit `lifecycle.completed` (kills "does not emit completed or disposed", which today passes on a never-run session for the wrong reason).
8. **`test(pi-subagents): stage each resume's turn-loop stub after the run it follows`** In `subagent-manager.test.ts`, move every `stub.resumeTurnLoop.mock*` set before the initial spawn to after `await …promise` (lines ~1205, 1306, 1321, 1334, 1510, 1523, 1536, 1568, and the `beforeEach` at ~1659).
   In `subagent.test.ts`, the resume happy-path tests set their `"resumed"` text explicitly instead of reading the stub's default.
   This is the same behavior today; after step 10 it becomes a one-word rename instead of an override the initial run would consume.
   Killing mutation: make `Subagent.resume`'s body call `subagentSession.runTurnLoop` instead of `resumeTurnLoop` (kills every staged test, whose resume no longer reads the resume stub).
9. **`refactor(pi-subagents): resolve a session's turn limits when it is created`** Red/green on `resolveTurnLimits` in `turn-limits.test.ts`: the three precedence cases moved from `subagent-session.test.ts`, the default wrap-up, and normalization below the minimum.
   Wire `CreateSubagentSessionParams.turnLimits` → `meta.turnLimits`; `Subagent.run()` passes it; `runTurnLoop` builds its tracker from meta and `TurnLoopOptions` loses the limit fields.
   Migrate the 14 `subagent-session.test.ts` calls that pass limit options into `makeSubagentSession` meta, the `realSessionFactory` meta in `subagent.test.ts`, and "RunConfig threading" to assert the captured factory params' `turnLimits`.
   Add a `create-subagent-session.test.ts` test: an agent config with `maxTurns: 7` and `turnLimits: { defaultMaxTurns: 9, wrapUpTurns: 3 }` yields a session whose first run reports `maxTurns: 7`.
   Update the `session-config.ts:205` comment.
   Killing mutations: in `resolveTurnLimits`, try `agentMaxTurns` before `request.maxTurns` (kills the precedence test); drop `turnLimits` from `run()`'s factory params (kills RunConfig threading); build the session tracker from `{ wrapUpTurns: 2 }` instead of meta (kills the ceiling tests).
10. **`refactor(pi-subagents): drive every run through one session turn loop`** Red: in `subagent-session.test.ts`, the primed later-run tests call `runTurnLoop`, and new tests assert a later run gets no parent-context prefix, emits no `completed`, and starts a fresh budget under the creation limits; a first run that throws leaves a later run unprefixed and silent.
    Green: the first-run flag; delete `resumeTurnLoop` and `ResumeTurnLoopOptions`; `Subagent`'s resume calls `runTurnLoop`; `createSubagentSessionStub` drops `resumeTurnLoop`.
    Migrate every `resumeTurnLoop` stub site in `subagent.test.ts`, `subagent-manager.test.ts`, and `get-result-tool.test.ts`; the four tests that resume from a finish observer (`subagent.test.ts` ~1580, `get-result-tool.test.ts` ~125 and ~174, `subagent-manager.test.ts` ~1689) chain `mockResolvedValueOnce(first).mockReturnValueOnce(resumed.promise)`.
    Fix the comments and test titles that name `resumeTurnLoop` (`subagent.test.ts` ~36, 1715, 2077, 2119; `manager-stubs.ts:36`).
    Killing mutations: never set the first-run flag (kills "a later run emits no completed" and "takes no parent-context prefix"); start it set (kills "prepends parentContext" and the `completed` emission tests); set it after the prompt instead of before (kills "a first run that throws leaves a later run unprefixed").
11. **`refactor(pi-subagents): run every run through one body with one pair of terminal transitions`** `SubagentRun` carries its kind; `Subagent` has the initial prefix, the resume prefix, the shared `runOnSession`, and private `complete`/`fail`; the prepare failure goes through `fail`; `SubagentLifecycleObserver` has `onRunStarted`/`onRunFinished(agent, kind)`; `buildObserver` maps the kind onto the four existing manager methods (removed in step 12).
    Tests: `subagent.test.ts` observers move to the pair and assert the kind (`"initial"` from `run()`, `stopQueued`, the prepare failure, and the born-aborted spawn; `"resume"` from `resume()`).
    The resume-from-finish observers in `subagent.test.ts` and `get-result-tool.test.ts` guard on `kind === "initial"`, or they recurse once the resume's finish reaches them.
    `subagent-run.test.ts`'s 13 constructor sites gain a kind, plus one test that the run exposes it.
    New test: after `resume()` returns, without awaiting, the record reads `running` and `onRunStarted` has fired with `"resume"`.
    The run-kind row reads 0.
    Killing mutations: make `complete` and `fail` report `"initial"` unconditionally (kills the resume-kind assertions and, through the transitional mapping, the manager's resumed-notification tests); delete the `fail` call in the prepare catch (kills "marks error and fires onRunFinished when prepare rejects"); add `await Promise.resolve()` at the top of the resume prefix (kills the synchronous-prefix test).
12. **`refactor(pi-subagents): report run starts and finishes once, with their kind, to every manager observer`** `SubagentManagerObserver` collapses to `onSubagentRunStarted`/`onSubagentRunFinished(record, kind)`; `buildObserver` passes both through inside `try`/`debugLog`; the events observer maps the kind to the published channels; composite and widget collapse.
    Migrate the 107 references (36/34/13/24, measured) across the five test files and `createManager`'s defaults; manager-test observers that resume from a finish guard on `kind === "initial"`, and resume-only observers (`onSubagentResumed` at ~1319, 1332, 1662, 1700) guard on `kind === "resume"`, so the initial finish does not double their counts.
    The events-observer tests assert, per kind and status, the exact channel and payload, including that a resumed run that errors emits `subagents:resumed`, not `subagents:failed`.
    New test: a manager observer whose `onSubagentRunStarted` throws does not fail the initial run.
    Killing mutations: map `"resume"` to `subagents:started` (kills the resuming-channel test); route a resumed error to `subagents:failed` (kills the resumed-error test); drop the `try` around `onSubagentRunStarted` in `buildObserver` (kills the throwing-observer test); make the composite skip `onSubagentRunFinished` (kills its fan-out test).
13. **`test(pi-subagents): nest the Subagent tests by concern and run kind`** One root `describe("Subagent")`; record-level concerns (construction, getters, session encapsulation, steer, abort, queued stop, release and teardown, model, `resumeRefusal`, `waitUntilSettled`) as children; run concerns under `describe("a run")` with a `describe.each` over a two-entry run-kind driver (`initial` runs the agent; `resume` runs it, then resumes) for the terminal rules in the edge-case table.
    Kind-specific behavior (the initial prefix, the resume rewind) stays in `describe("initial run")` and `describe("resume")`.
    No test is dropped: the count before and after the re-indent is equal apart from rows the grid adds.
    The top-level `describe` row reads 1.
    Killing mutation: make `complete` dispose when `run.kind === "resume"` and a question is pending (kills only the grid's resume rows, proving the grid reaches both kinds).
14. **`docs(pi-subagents): record the one run lifecycle in the architecture doc`**
    The doc updates listed under Module-Level Changes; re-run every count in the Test Impact table and write what it prints into the `Landed:` note.

## Risks and Mitigations

- **A test passes for the wrong reason once one stub serves both runs.**
  An override set before the initial spawn would be consumed by the initial run; step 8 stages them first, and step 8's killing mutation proves each staged test reads the resume's stub.
- **Observers that resume from a finish recurse, or resume-only observers double-count, once finishes carry both kinds.**
  Steps 11 and 12 add the kind guard in the same commit that widens the callback; the sites are enumerated above (assessor-found, re-verified by reading `get-result-tool.test.ts:121-140` and `subagent-manager.test.ts:1650-1705`).
- **The resume prefix gains an await and `startResume`'s claim lands late.**
  Step 11's synchronous-prefix test and its killing mutation.
- **Moving limits to creation changes which `RunConfig` a run sees.**
  It does not: `run()` reads `getRunConfig()` once, before `createSubagentSession`, and today passes that same object to `runTurnLoop`; a resume already used the stored limits.
- **The session's first run and the record's kind disagree.**
  Only a session created outside `Subagent.run()` could make them disagree, and production has none; the test stubs do not implement the flag.
- **Step 12's churn (107 references) hides a semantic slip.**
  It is a mechanical rename plus guards; the events-observer tests are rewritten to full-shape channel assertions per kind, the one place the mapping lives.
- **The hold change leaves a worktree alive longer.**
  The worktree lives exactly as long as a plain completed-with-question run's already does: until the resume finishes, or until the retention sweep releases the session (an unanswered question holds the 720-minute safety cap).

## Open Questions

- None blocking.
  Whether `stopQueued` needs a resume kind is [#1013]'s to settle when a resume can be queued.

[#889]: https://github.com/gotgenes/pi-packages/issues/889
[#898]: https://github.com/gotgenes/pi-packages/issues/898
[#1013]: https://github.com/gotgenes/pi-packages/issues/1013
[#1012]: https://github.com/gotgenes/pi-packages/issues/1012
[#1015]: https://github.com/gotgenes/pi-packages/issues/1015
[#1021]: https://github.com/gotgenes/pi-packages/issues/1021
[#1022]: https://github.com/gotgenes/pi-packages/issues/1022
[#1025]: https://github.com/gotgenes/pi-packages/issues/1025
[#1049]: https://github.com/gotgenes/pi-packages/issues/1049
[#1051]: https://github.com/gotgenes/pi-packages/issues/1051
[#1058]: https://github.com/gotgenes/pi-packages/issues/1058
