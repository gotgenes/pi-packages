---
issue: 1022
issue_title: "pi-subagents: make maxTurns a true ceiling with a budget warning tracked as running state"
---

# Make `maxTurns` a true ceiling with a live turn budget

## Release Recommendation

**Release:** ship now — batch "turn-budget" tail (this issue completes the batch)

The batch was agreed in [#1021]'s planning session (the package has no open improvement roadmap, so no `Release batches` list records it): [#1021] replaced the `steered` status with a terminal `turnBudget` field and is on `main` unreleased, and this issue redefines the mechanics under that shape.
Releasing now ships one major carrying both halves, so no published version ever carries [#1021]'s interim meaning of `turnBudget` (`used` exceeding `maxTurns` during grace turns).

## Problem Statement

`maxTurns` is where a subagent is told to wrap up, not where it stops.
The hard stop is `maxTurns + graceTurns`, where `graceTurns` is one global setting (default 5) the caller cannot see.
The budget is also invisible while the child runs: the soft-limit and abort flags are locals in `SubagentSession.runTurnLoop`, so the record, the widget, and every carrier learn the child was warned only after the run ends.
Two turn counters disagree: `runTurnLoop`'s local count and `SubagentState.turnCount` (which starts at 1 and counts every `turn_end`, including an errored response that Pi's auto-retry then repeats).

## Goals

- `maxTurns` is the ceiling: no turn after turn `maxTurns` runs, and a run the harness stops ends `aborted` with `turnBudget.phase: "exhausted"`.
- `graceTurns` is replaced by `wrapUpTurns` (default 2, minimum 1): the child is warned when `wrapUpTurns` turns remain, i.e. at `warnAt = max(0, maxTurns − wrapUpTurns)`, so `0 ≤ warnAt < maxTurns`.
  `warnAt = 0` states the budget before the first turn.
- The warning is a context-only custom message (`session.sendCustomMessage(…, { triggerTurn: false })`), never `session.steer()`: it is seen in the next turn if one runs and never forces one.
  The word "steer" stays reserved for a redirect from the operator or parent.
- One turn counter, counting only successful turns (a `turn_end` whose assistant `stopReason` is neither `error` nor `aborted`).
- `turnBudget` becomes live running state: `{ used, maxTurns?, phase }`, present from the moment a run's turn loop starts, including unlimited runs (`maxTurns` absent).
  The top-level `turnCount`/`maxTurns` on `SubagentRecord`, `AgentDetails`, `NotificationDetails`, and the widget's `WidgetAgent` are removed in its favor.
- The widget shows the budget while the child runs, in the warning color once warned.
- A resumed run gets a fresh budget with the original run's resolved ceiling.
- The minimum `maxTurns` is 2 (one turn to work, one to answer).
  A smaller value is raised to 2 for execution **with a warning** at every source: a spawn note to the parent model for a `max_turns` tool parameter, and a `console.warn` for agent frontmatter and for `defaultMaxTurns` in `subagents.json`.
- A `subagents.json` that still sets `graceTurns` gets a `console.warn` telling the user to migrate to `wrapUpTurns`; the key is otherwise ignored.
- **Breaking.**
  The meaning of an existing `max_turns`/`defaultMaxTurns` changes on upgrade with no user edit (the run now stops where it used to be warned), a persisted setting is replaced, resumed runs gain a limit, and public fields are removed from `SubagentRecord` (the `.d.ts` surface) and from tool-result details.
  Each behavior step below uses `feat(pi-subagents)!:` with a `BREAKING CHANGE:` footer.

## Non-Goals

- A phase-transition event.
  The operator found the package's channel-per-event design wrong for an event bus (Pi's `pi.events` matches channels exactly, so each new channel is invisible to existing subscribers); consolidation is [#1025], which carries the budget-warned event.
  This issue ships the live `turnBudget` on the record only.
- Withdrawing tools on the final permitted turn ([#1023]).
- A per-agent or per-call `wrapUpTurns`; it is a global setting only.
- Unifying the terminal channels `subagents:completed`/`failed`/`resumed` ([#1025]).
- Changing which runs hold their workspace for a resume: a completed run that was warned and asked a question still tears down, as [#1021] preserved.
- Cumulative turns across resumes.
  `turnCount` was cumulative over the record's life; `turnBudget.used` is per run, and nothing replaces the cumulative figure (no consumer in this repo reads it; see Risks).

## Background

Verified against the pinned Pi 1.0.0 compiled sources (`@earendil-works/pi-agent-core` `dist/agent-loop.js`, `@earendil-works/pi-coding-agent` `dist/core/agent-session.js`) and unchanged on `../pi` `main`; read, not run:

1. The agent loop continues while `hasMoreToolCalls || pendingMessages.length > 0`, polling steering messages right after `turn_end`.
   A steer queued at `turn_end` therefore forces another turn even when the turn that just ended made no tool calls, which is how a `session.steer()` warning on a child's final-answer turn would replace its answer.
2. `sendCustomMessage(msg, { triggerTurn: false })` while the run is active pushes onto `_pendingCustomMessages`, which `AgentSession` flushes into the transcript at `turn_end`, after extension and listener dispatch (Pi commit `240eb29c4`, first tagged v0.84.4; our peer floor is `>=1.0.0`).
   The next request is built from the session projection, and `convertToLlm` maps a `custom` message to `user`, so the child sees it in the next turn if one runs.
   It never forces a turn.
   Outside a run (`isStreaming` false, `triggerTurn` false) the message is appended immediately.
3. An errored response still emits `turn_end` (`stopReason: "error"`, `toolResults: []`) and `agent_end`; auto-retry then starts another run within the same `prompt()`.
4. `turn_start` is emitted for every turn after the first only after `prepareNextTurn` and the steering poll, immediately before the assistant request; `session.abort()` aborts the agent's signal synchronously before awaiting idle, so an abort there makes that request return `stopReason: "aborted"`.

In this package:

- `SubagentSession.runTurnLoop` (`src/lifecycle/subagent-session.ts`) resolves the limit as `opts.maxTurns ?? meta.agentMaxTurns ?? opts.defaultMaxTurns` through `normalizeMaxTurns` (`src/lifecycle/turn-limits.ts`), steers at the limit, aborts at `limit + graceTurns`, and returns `TurnLoopResult { responseText, turnBudget? }` built by the private `buildTurnBudget`.
- `resumeTurnLoop(prompt, signal)` returns a bare string and enforces nothing.
- `Subagent.completeRun` (`src/lifecycle/subagent.ts`) derives `aborted` from `phase === "exhausted"`; `completeResume(result: string)` always marks `completed`.
- `subscribeSubagentObserver` (`src/observation/record-observer.ts`) calls `state.incrementTurnCount()` on every `turn_end`.
- `Subagent.maxTurns` returns `execution.maxTurns`: the resolved value on the tool path (`spawn-config.ts` folds in the agent file and `defaultMaxTurns`), but only the caller's value on the service path, where the agent's frontmatter limit is applied later inside `runTurnLoop`.
  A live `turnBudget.maxTurns` resolved in one place removes that disagreement.
- `createSubagentSession` already takes callbacks that write onto the record (`askParent`, `notifyParent`); the live budget follows the same pattern.
- `SubagentRecord`'s admission policy is `docs/decisions/0005-subagent-record-admission-policy.md` (removing a field is major; snapshot is by value).
- The settings sanitizer drops unknown keys, and `saveSettings` rewrites the whole project file from `snapshot()`, so a stale `graceTurns` disappears at the next `/subagents:settings` save.
  `loadLayeredSettings` already reports a malformed file with `console.warn("[pi-subagents] …")`; the migration warnings use the same channel.
- `spawn-config.ts` already returns `notes` (`buildFallbackNote`, `buildLockNote`) that both spawn paths render ahead of the result via `renderSpawnNotes`.
- Third-party PR #1024 (widget spinner cadence) edits `src/ui/widget-renderer.ts` and `src/ui/agent-widget.ts`; whichever lands second rebases.

## Design Overview

### The budget type and tracker

```typescript
/** What the harness has done about a run's turn budget, in the order it happens. */
export type TurnBudgetPhase = "within" | "warned" | "exhausted";

/** A run's turn budget: present once its turn loop starts. */
export interface TurnBudget {
  /** Successful turns completed in this run. */
  used: number;
  /** The ceiling; absent for an unlimited run. */
  maxTurns?: number;
  phase: TurnBudgetPhase;
}

/** What the turn loop must do after a turn boundary. */
export type TurnBudgetAction = "warn" | "stop" | undefined;

export class TurnBudgetTracker {
  constructor(limits: { maxTurns?: number; wrapUpTurns: number });
  /** True when the budget must be stated before the first turn (warnAt === 0); sets phase "warned". */
  warnBeforeFirstTurn(): boolean;
  onTurnEnd(turn: { failed: boolean; ranTools: boolean }): TurnBudgetAction;
  onTurnStart(): TurnBudgetAction;
  /** Turns left before the ceiling, for the warning text; undefined when unlimited. */
  get remaining(): number | undefined;
  get budget(): TurnBudget; // a copy
}
```

The tracker owns the counting state and both decisions, so the policy is unit-testable without a session and `runTurnLoop` only translates actions into session calls (it gives behavior to the data the closure used to hold in three loose `let`s).
Rules:

- `onTurnEnd` ignores a failed turn (`failed` = assistant `stopReason` is `error` or `aborted`): no count, no action.
- After counting, if `used >= maxTurns` and `ranTools`, phase becomes `exhausted` and it returns `"stop"`.
  A ceiling turn that ran no tools is the agent's final answer: the loop ends on its own, so no stop.
- Otherwise, if phase is `within`, `used >= warnAt`, and `ranTools`, phase becomes `warned` and it returns `"warn"`.
  Warning only on a turn that ran tools means the loop is continuing anyway, so the warning is never left dangling after a final answer (where a resumed run would later read a stale "1 turn left"); a turn at `warnAt` that ran no tools defers the warning to the next turn that does.
- `onTurnStart` returns `"stop"` (phase `exhausted`) when `used >= maxTurns`: a backstop for a turn forced past the ceiling by a pending steer (`steer_subagent` landing on the final turn) or a follow-up.
- Unlimited (`maxTurns` absent): counts, never warns, never stops.
- `warnAt = max(0, maxTurns − wrapUpTurns)`; `wrapUpTurns ≥ 1` and `maxTurns ≥ 2` keep `warnAt < maxTurns`.

`ranTools` is `event.toolResults.length > 0`.
A tool batch that sets Pi's `terminate` flag also ends the loop with results present; on the ceiling turn that run is reported `exhausted` although it would have stopped anyway (Risks).

### Turn loop

```typescript
// SubagentSession.runTurnLoop, sketch
const tracker = new TurnBudgetTracker(this.resolveLimits(opts)); // stored for resume
if (tracker.warnBeforeFirstTurn()) this.sendBudgetWarning(tracker);
opts.onTurnBudget?.(tracker.budget);
const unsub = session.subscribe((event) => {
  if (event.type === "turn_end") this.act(tracker.onTurnEnd(turnOutcome(event)), tracker, opts);
  if (event.type === "turn_start") this.act(tracker.onTurnStart(), tracker, opts);
});
```

`act` sends the warning on `"warn"`, calls `void session.abort()` on `"stop"`, and reports `tracker.budget` through `onTurnBudget` after every counted turn.
`TurnLoopOptions` becomes `{ maxTurns?, defaultMaxTurns?, wrapUpTurns?, signal?, onTurnBudget? }`.
`TurnLoopResult.turnBudget` becomes required (every run has one), still returned so `completeRun`/`completeResume` decide the status from the final snapshot.

The resolved `{ maxTurns, wrapUpTurns }` is stored on the `SubagentSession` at `runTurnLoop`, and `resumeTurnLoop(prompt, { signal?, onTurnBudget? })` builds a fresh tracker from it: same ceiling, `used: 0`.

The warning text names the remaining turns and the consequence, e.g. "Turn budget: you have 2 turns left, including this one.
The harness stops you after that.
Finish your work and give your final answer within that budget."
It is sent with `customType: "subagents:turn-budget-warning"` and `display: true`, so it shows in the child's transcript.

### Live state

`Subagent.run()` and `runResume()` pass `onTurnBudget: (budget) => this.state.setTurnBudget(budget)`.
`SubagentState._turnBudget` lifecycle, all in one step (step 6):

- **Set** by `setTurnBudget` on every report from the loop (initial report before the first turn, then after each counted turn).
- **Cleared** by `resetForResume` (the resumed loop reports a fresh budget as it starts) and never otherwise; terminal transitions no longer write it (`markCompleted`/`markAborted` lose the `turnBudget` parameter [#1021] added, since the live value is already final).
- **Read** by the `turnBudget` getter, `currentOutcome()` (so a superseded outcome keeps its budget), and every carrier.

A queued agent has no budget until its loop starts; `SubagentRecord.turnBudget` stays optional for that reason.

### Status derivation

`completeRun` is unchanged (`exhausted` → `aborted`).
`completeResume(result: TurnLoopResult)` applies the same derivation, so a resume can now end `aborted`; the `subagents:resumed` channel already carries `status` (its observer comment, "terminates only as completed or error", is corrected).

### Presentation

| Site                               | Today                                                         | After                                                                              |
| ---------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `formatTurns` (`display.ts`)       | `⟳{turnCount}≤{maxTurns}` (turnCount = current turn, 1-based) | `formatTurnBudget(budget)`: `⟳{used}≤{maxTurns}` / `⟳{used}` (turns used, 0-based) |
| Widget running row                 | stats dim                                                     | the turn part in `warning` color when `phase === "warned"`                         |
| `outcome-delivery.ts` `WRAPPED_UP` | "Wrapped up (reached turn limit)"                             | "Wrapped up (after turn-budget warning)"                                           |
| `outcome-delivery.ts` `aborted`    | "max turns exceeded, output may be incomplete"                | "stopped at its turn limit, output may be incomplete"                              |
| `result-renderer.ts`               | "Wrapped up (turn limit)", "Aborted (max turns exceeded)"     | "Wrapped up (budget warning)", "Aborted (turn limit reached)"                      |
| `widget-renderer.ts` finished      | " (turn limit)"                                               | " (budget warning)"                                                                |
| `renderer.ts` notification         | "completed (wrapped up)"                                      | unchanged                                                                          |

Under the ceiling a completed run never reaches the limit, so "reached turn limit" would be false.
A consequence the operator accepted: when `wrapUpTurns ≥ maxTurns`, `warnAt = 0` and every completed run under that configuration reads as wrapped up.

### Minimum and migration

`normalizeMaxTurns` raises its floor from 1 to 2 (`0`/`undefined` still unlimited).
Warnings, each at the source a human or model can act on:

- `spawn-config.ts` gains `buildMinimumTurnsNote` beside `buildLockNote`: when `resolvedConfig.maxTurns ?? settings.defaultMaxTurns` is 1, the spawn result carries "Note: max_turns 1 is below the minimum of 2 (one turn to work, one to answer), so the subagent runs with 2."
  The tool schema keeps `minimum: 1`, so the call is not rejected.
- `custom-agents.ts`: `max_turns: 1` in frontmatter → `console.warn("[pi-subagents] agent <name>: max_turns 1 is below the minimum of 2; using 2.")`.
- `settings.ts` `load()`: `defaultMaxTurns: 1` → the same warning naming the file setting; a `graceTurns` key in either layer → `console.warn("[pi-subagents] graceTurns was removed; set wrapUpTurns (turns left when a subagent is warned, default 2) instead.")`.
  The sanitizer must surface the key's presence (it drops it today), so `SubagentsSettings` gains a load-only `legacyGraceTurns?: true` marker that `snapshot()` never writes.
- The service path (`SubagentsService.spawn({ maxTurns: 1 })`) is raised by `normalizeMaxTurns` and documented in the `SpawnOptions.maxTurns` JSDoc; a typed API caller is a developer, and the JSDoc is where they look.

### Edge cases (each pinned in the step named)

- Errored turn then retry: not counted (step 3, step 4).
- Ceiling turn with no tool calls: run ends `completed`, no abort (step 3, step 4).
- Steer-forced turn past the ceiling: aborted at `turn_start` (step 3, step 4).
- `warnAt` turn with no tool calls: warning deferred to the next tool-running turn (step 3).
- `warnAt = 0`: warning sent before `prompt()`, phase `warned` from the start (step 3, step 4).
- Unlimited run: budget `{ used, phase: "within" }`, never warns or stops (step 3, step 4).
- Stopped while warned: `stopped` keeps the live budget (`warned`) (step 6).
- Resume of an exhausted run: fresh budget, may itself end `aborted`/`exhausted` (step 7).

## Module-Level Changes

### Source

- `src/lifecycle/turn-limits.ts` — `TurnBudget.maxTurns` optional, `used` doc; add `TurnBudgetTracker`, `TurnBudgetAction`; `normalizeMaxTurns` floor 2; module doc.
- `src/lifecycle/subagent-session.ts` — tracker-driven `runTurnLoop` and `resumeTurnLoop`; stored limits; `TurnLoopOptions` (`graceTurns` → `wrapUpTurns`, `onTurnBudget`); `TurnLoopResult.turnBudget` required; `resumeTurnLoop` returns `TurnLoopResult` and takes an options object; delete `buildTurnBudget`; private `sendBudgetWarning`.
- `src/lifecycle/subagent-state.ts` — `setTurnBudget`; drop `_turnCount`, `turnCount`, `incrementTurnCount`, `SubagentStateInit.turnCount`; `markCompleted`/`markAborted` drop the `turnBudget` parameter; module doc.
- `src/lifecycle/subagent.ts` — wire `onTurnBudget` in `run()`/`runResume()`; `completeResume(TurnLoopResult)` derives status; pass `wrapUpTurns`; drop `turnCount` and `maxTurns` getters and the `turnBudget` arguments to `markCompleted`/`markAborted`.
- `src/observation/record-observer.ts` — drop the `turn_end` arm and its doc bullet.
- `src/observation/subagent-events-observer.ts` — correct the `onSubagentResumed` comment.
- `src/observation/outcome-delivery.ts` — `WRAPPED_UP` and `aborted` details.
- `src/observation/notification.ts` — `NotificationDetails` drops `turnCount`/`maxTurns`.
- `src/observation/renderer.ts` — `buildStatsParts` reads `turnBudget`.
- `src/service/service.ts` — `SubagentRecord` drops `turnCount`/`maxTurns`, `turnBudget` doc ("present once the run's turn loop starts"); `SpawnOptions.maxTurns` JSDoc names the floor of 2.
- `src/service/service-adapter.ts` — `toSubagentRecord` drops both fields.
- `src/ui/display.ts` — `AgentDetails` drops `turnCount`/`maxTurns`; `formatTurns` → `formatTurnBudget`.
- `src/ui/widget-renderer.ts`, `src/ui/agent-widget.ts` — `WidgetAgent` drops both; warned color; " (budget warning)".
- `src/tools/helpers.ts` (`buildDetails`), `src/tools/foreground-runner.ts` (`streamUpdate`), `src/tools/result-renderer.ts` — read `turnBudget`; wording.
- `src/tools/spawn-config.ts` — `buildMinimumTurnsNote`.
- `src/config/custom-agents.ts` — frontmatter warning.
- `src/settings.ts`, `src/runtime.ts`, `src/ui/subagents-settings.ts` — `graceTurns` → `wrapUpTurns` (default 2, min 1, ceiling unchanged), migration and minimum warnings, settings row "Wrap-up turns" / "Turns left when a subagent is warned to wrap up".
- `src/index.ts` — predicted unchanged (it wires `SettingsManager` as `RunConfig` by type; re-check in step 1).
- `src/tools/get-result-tool.ts`, `src/tools/get-result-report.ts`, `src/tools/get-result-renderer.ts` — predicted unchanged: they read only `turnBudget` and `status`, whose shapes they already accept (`maxTurns` turning optional narrows nothing they read).

### Tests

- `test/lifecycle/subagent-session.test.ts` — fixture prep (step 2), tracker-driven loop tests (step 4), resume budget (step 7); the 4 tests using `maxTurns: 1`/`defaultMaxTurns: 1` are rewritten (measured: `grep -rn "maxTurns: 1\b\|defaultMaxTurns: 1\b\|max_turns: 1\b" test` → 4 lines).
- `test/lifecycle/turn-limits.test.ts` — tracker table (step 3), floor (step 9).
- `test/lifecycle/subagent-state.test.ts`, `test/lifecycle/subagent.test.ts`, `test/helpers/make-subagent.ts` (+ `.test.ts`) — live budget, removed `turnCount`.
- `test/observation/record-observer.test.ts` — the `turn_end` test removed.
- `resumeTurnLoop` stubs: 61 mentions across `test/lifecycle/{subagent,subagent-manager,subagent-session}.test.ts`, `test/tools/get-result-tool.test.ts`, `test/helpers/{mock-session,manager-stubs}.ts` (measured `grep -rn resumeTurnLoop test src | wc -l`, including `src`); the string-returning stubs migrate to `turnLoopResult()` in step 1.
- Removed-field literals (assessor's per-file table, re-derive in each step with `grep -rn "turnCount\|maxTurns" <file>`): `test/observation/renderer.test.ts`, `test/tools/result-renderer.test.ts`, `test/widget-renderer.test.ts`, `test/service/service-adapter.test.ts`, `test/tools/helpers.test.ts`, `test/observation/notification.test.ts`, `test/ui/agent-widget.test.ts`.
- `graceTurns` hits: 87 test lines (`test/settings.test.ts` 62, `subagent-session` 9, `subagent-manager` 6, `subagents-settings` 6, `subagent` 4; measured `grep -rc "graceTurns\|GraceTurns" test src`).
- `test/tools/spawn-config.test.ts`, `test/config/custom-agents.test.ts`, `test/settings.test.ts` — warnings.

### Docs

- `README.md` — "Graceful Max Turns" rewritten as the ceiling + warning (rename the section "Turn Budget"; grep the README for links to the old anchor); the settings line naming "grace turns"; the record field list (line ~353) drops `turnCount`/`maxTurns`; the `max_turns` parameter row.
- `docs/configuration.md` — `max_turns` row ("stops after this many turns; minimum 2"), the settings list and defaults sentence (`graceTurns` → `wrapUpTurns`, default 2), the JSON sample, a migration note for `graceTurns`.
- `docs/architecture/architecture.md` — state diagram `running --> aborted` label ("harness stop at the turn ceiling") and a resume note; the paragraph after it on `turnBudget`; the domain model if it lists `turnCount`.
- `docs/decisions/0005-subagent-record-admission-policy.md` — rows: `turnCount`, `maxTurns` → removed (folded into `turnBudget`); `turnBudget` → live budget, optional until the run starts; the Consequences bullet naming `turnCount` against `maxTurns`.
- `.pi/skills/package-pi-subagents/SKILL.md` — upstream-assumptions table: add the `sendCustomMessage(triggerTurn: false)` turn-end flush and `turn_start` ordering rows (Behavioral-silent if they drift); grep for `graceTurns`/`turnCount` (predicted no hit).
- `docs/decisions/0004-reconsider-ui-direction.md` — predicted unchanged: a dated decision record naming the old settings list.

## Test Impact Analysis

1. **New tests enabled.**
   The tracker's policy (counting, warn deferral, ceiling, backstop, unlimited) becomes a pure table test in `turn-limits.test.ts`, where today every case needs a stubbed `AgentSession` and an event script.
2. **Tests that become redundant.**
   The `runTurnLoop` "turn limits" describe (steer at soft limit, grace window) is replaced, not kept: its claims are the removed mechanism.
   The `record-observer` `turn_end` test goes with the arm.
   `subagent-session.test.ts` keeps only wiring tests per action (warn → `sendCustomMessage`, stop → `abort`, report → `onTurnBudget`, precedence of the limit sources), not the policy table.
3. **Tests that stay as-is.**
   Response capture, provider-failure, abort-signal, lifecycle-event, and dispose tests in `subagent-session.test.ts`; the `completeRun` status-derivation and hold-for-resume tests from [#1021].

## Invariants at risk

| Invariant (from [#1021])                                                 | Constituency                                          | Pinned by                                                                                                  |
| ------------------------------------------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `aborted` ⇔ `phase: "exhausted"` for a run the harness stopped           | Paseo (maps `aborted` to canceled), event subscribers | `test/lifecycle/subagent.test.ts` `completeRun` tests; step 7 adds the same for `completeResume`           |
| A completed, warned run with a pending question tears its workspace down | `WorkspaceProvider` (worktrees)                       | `test/lifecycle/subagent.test.ts` hold-for-resume tests; unchanged derivation                              |
| A superseded outcome keeps its budget                                    | Parent model via waiters                              | `test/lifecycle/subagent-state.test.ts` `supersededOutcome` test; step 6 re-asserts with a live-set budget |
| `stopped` during the warned phase keeps the budget                       | Parent model, record readers                          | `test/lifecycle/subagent.test.ts` (#1021's follow-up pin); step 6 re-asserts it with the live budget       |
| Every terminal status is one Paseo maps                                  | Paseo                                                 | Type-level (`SubagentStatus`); `completeResume` can now produce `aborted`, which Paseo maps                |
| Wrapped-up wording on all four carriers                                  | Parent model                                          | `test/observation/outcome-delivery.test.ts` (real renderer, no mock); step 5 updates the expected text     |

New invariant: the warning never forces a turn.
Pinned in step 3 (a turn at `warnAt` that ran no tools returns no action) and step 4 (`sendCustomMessage` is called with `{ triggerTurn: false }`, and `steer` is never called).

## TDD Order

1. **`refactor(pi-subagents): return a turn-loop result from resumeTurnLoop`** `resumeTurnLoop` returns `{ responseText }` as a `TurnLoopResult` (with `turnBudget` still optional at this point) and `completeResume` takes it; migrate every string-returning stub to `turnLoopResult({ responseText })` (Tidy-First recommendation: it isolates the ~25 mechanical stub edits from step 7's behavior).
   Suite and `pnpm --filter @gotgenes/pi-subagents run check` green with no behavior change.
   Killing mutation: none (no behavior).

2. **`test(pi-subagents): drive turn-loop tests with realistic turn events`** In `test/lifecycle/subagent-session.test.ts`, `emitTurnEnd(listeners, { stopReason = "toolUse", toolResults = 1 } = {})` emits `{ type: "turn_end", message: { role: "assistant", stopReason }, toolResults }`; add `emitTurnStart`; `programTurns` emits `turn_start` before each turn after the first and accepts a per-turn spec; the `createSession` stub gains `sendCustomMessage: vi.fn()`.
   Tidy-First recommendation: the tracker reads these fields, so without this step every turn-limit test breaks inside step 4's diff.
   Suite green (the current loop ignores the new fields).
   Killing mutation: none (fixture only).

3. **`refactor(pi-subagents): decide turn-budget warnings and stops in one tracker`** Add `TurnBudgetTracker` and `TurnBudgetAction`; make `TurnBudget.maxTurns` optional.
   No consumer yet, so `refactor:`.
   Table tests in `test/lifecycle/turn-limits.test.ts`, one `describe` per concern: counting (failed turns ignored), warning (at `warnAt`, deferred past a no-tools turn, once only, `warnBeforeFirstTurn` at `warnAt = 0`), ceiling (stop only with tools; no stop on a final-answer ceiling turn), backstop (`onTurnStart` past the ceiling), unlimited (never warns or stops), `budget` returns a copy.
   Killing mutations, one per class:
   - counting: drop the `failed` guard → kills the errored-turn test;
   - warn deferral: drop `ranTools` from the warn condition → kills the deferred-warning test;
   - ceiling: drop `ranTools` from the stop condition → kills the final-answer-ceiling test;
   - backstop: make `onTurnStart` return `undefined` → kills the backstop test;
   - warnAt: compute `warnAt = maxTurns − wrapUpTurns` without `max(0, …)` → kills the `warnBeforeFirstTurn` test for `wrapUpTurns > maxTurns`;
   - copy: return the internal object from `budget` → kills the copy test.

4. **`feat(pi-subagents)!: stop a subagent at max_turns, after warning it while wrap-up turns remain`** `runTurnLoop` drives the tracker: warning via `sendCustomMessage(…, { triggerTurn: false })`, stop via `abort()`, `turn_start` backstop, warn-before-first-turn ahead of `prompt()`, `onTurnBudget` reports, `TurnLoopResult.turnBudget` always present.
   `TurnLoopOptions.graceTurns` becomes `wrapUpTurns`, and the same step renames the setting end to end, since `RunConfig` is implemented by `SettingsManager` and the option has one producer: `settings.ts` (field, default 2, min 1, sanitize, snapshot, `applyWrapUpTurns`), `runtime.ts`, `subagents-settings.ts`, and `Subagent.run()`; the 87 `graceTurns` test lines are renamed in this step.
   `TurnLoopResult.turnBudget` turning required means `test/helpers/turn-loop-result.ts`'s `turnLoopResult()` gains a default `turnBudget: { used: 1, phase: "within" }` in this step, which every stub built from it inherits.
   Tests in `subagent-session.test.ts`: warn → `sendCustomMessage` with `{ triggerTurn: false }` and `steer` never called; stop → `abort` at the ceiling; backstop at `turn_start`; up-front warning before `prompt`; errored turn not counted; unlimited run reports `{ used, phase: "within" }`; limit precedence (per-call > agent > default) with values ≥ 2; `lifecycle.completed` carries the budget.
   Killing mutations: send the warning with `session.steer` instead → kills the delivery test; drop the `turn_start` subscription → kills the backstop test; skip `onTurnBudget` after counted turns → kills the report test; read `opts.defaultMaxTurns` before `agentMaxTurns` → kills the precedence test.
   Footer:

   ```text
   BREAKING CHANGE: max_turns (and defaultMaxTurns) is now the ceiling: the
   harness stops the run after that many turns, where it used to send a
   wrap-up message and allow graceTurns more. The graceTurns setting is
   replaced by wrapUpTurns (default 2): the subagent is told its remaining
   budget when that many turns are left. Turns whose response errored no
   longer count. turnBudget is present on every run, with maxTurns absent
   when unlimited.
   ```

5. **`feat(pi-subagents): describe a warned or stopped run by its turn budget`** The wording table in Design Overview: `outcome-delivery.ts`, `result-renderer.ts`, `widget-renderer.ts`.
   Tests: `outcome-delivery.test.ts` (all four carriers), `result-renderer.test.ts`, `widget-renderer.test.ts` expected strings.
   Killing mutation: restore "reached turn limit" in `WRAPPED_UP` → kills the four-carrier wording tests.

6. **`feat(pi-subagents): track a running subagent's turn budget live`** `SubagentState.setTurnBudget` with the whole lifecycle in this step (set on each report, cleared by `resetForResume`, read by the getter and `currentOutcome`); `markCompleted`/`markAborted` drop the `turnBudget` parameter (4 test sites plus `completeRun`); `Subagent.run()` wires `onTurnBudget`.
   Records, details, and notifications now carry the budget while the run is live (additive: `turnCount`/`maxTurns` still present).
   Tests: `subagent-state.test.ts` (set, cleared by resume, superseded outcome keeps it, `stopped` keeps it), `subagent.test.ts` (a reported budget is readable on the record mid-run; `completeRun` still derives `aborted` from the final snapshot).
   Killing mutations: drop the `_turnBudget = undefined` in `resetForResume` → kills the resume-clears test; make `run()` pass no `onTurnBudget` → kills the mid-run test; drop `turnBudget` from `currentOutcome()` → kills the superseded test.

7. **`feat(pi-subagents)!: give a resumed subagent a fresh turn budget`** `resumeTurnLoop(prompt, { signal, onTurnBudget })` builds a fresh tracker from the stored limits; `runResume` wires `onTurnBudget`; `completeResume` derives `aborted` from `exhausted`; correct the `onSubagentResumed` comment.
   Tests: `subagent-session.test.ts` (a resume after an exhausted run starts at `used: 0` with the same `maxTurns` and can stop again), `subagent.test.ts` (an exhausted resume ends `aborted` and fires `onResumeFinished`).
   Killing mutations: reuse the original tracker instead of a fresh one → kills the `used: 0` test; make `completeResume` always mark completed → kills the aborted-resume test.
   Footer: `BREAKING CHANGE: a resumed subagent now runs under a fresh turn budget with its original ceiling, and can end aborted when it exhausts it; resumes were previously unlimited.`

8. **`feat(pi-subagents)!: report turns only through turnBudget`** Remove the top-level `turnCount`/`maxTurns` and the second counter in one step, since removing the state getter breaks every reader at type level: `SubagentRecord` + `toSubagentRecord`, `AgentDetails` + `buildDetails` + `foreground-runner`, `NotificationDetails` + `buildStatsParts`, `WidgetAgent` + `toWidgetAgent`, `SubagentState.turnCount`/`incrementTurnCount`/`SubagentStateInit.turnCount`, `Subagent.turnCount`/`maxTurns`, the record-observer arm, `createTestSubagent`'s `turnCount`/`maxTurns` options (it gains `turnBudget`); `formatTurns` → `formatTurnBudget`; the widget's warned color.
   The assessor declined a shared details fixture (five distinct per-file builders), so the literal edits land here per file.
   Tests: service-adapter exact `toEqual` on the admitted set (no `turnCount`/`maxTurns`), `formatTurnBudget` cases (limited, unlimited), widget running row in warning color when warned, notification stats line.
   Killing mutations: make `formatTurnBudget` ignore `maxTurns` → kills the limited-format test; drop the warned branch in the widget → kills the color test.
   Footer: `BREAKING CHANGE: SubagentRecord, the subagent tool details, and subagent notifications no longer carry turnCount or maxTurns; read turnBudget.used and turnBudget.maxTurns. used counts successful turns in the current run, not across resumes.`

9. **`feat(pi-subagents)!: run subagents for at least two turns and warn below that`** `normalizeMaxTurns` floor 2; `buildMinimumTurnsNote`; frontmatter warning; `defaultMaxTurns` floor and warning in `settings.ts`; `legacyGraceTurns` marker and the `graceTurns` migration warning; `SpawnOptions.maxTurns` JSDoc.
   Tests: `turn-limits.test.ts` (1 → 2, 0 → unlimited), `spawn-config.test.ts` (note present for `max_turns: 1` from the call and from the agent file, absent for 2), `custom-agents.test.ts` (warn spy), `settings.test.ts` (warn for `defaultMaxTurns: 1` and for a `graceTurns` key, and `snapshot()` never writes `graceTurns`).
   Killing mutations: restore `Math.max(1, n)` → kills the floor test; drop the note → kills the spawn-note test; drop the legacy check → kills the migration-warning test.
   Footer: `BREAKING CHANGE: a max_turns or defaultMaxTurns of 1 now runs with 2, with a warning; a graceTurns key in subagents.json is ignored with a warning to set wrapUpTurns.`

10. **`docs(pi-subagents): document the turn ceiling and live turn budget`** README, `docs/configuration.md`, architecture doc, ADR 0005 rows, package skill upstream-assumption rows, per Module-Level Changes.
    Verify the Mermaid diagram (load the `mermaid` skill); re-grep `graceTurns`, `grace turns`, `turnCount`, `max turns exceeded`, `reached turn limit` across `packages/pi-subagents/{README.md,docs,src}` and `.pi/skills/` — remaining hits only in plans, retros, history, and ADR 0004.

## Risks and Mitigations

- **A consumer outside this repo reads `turnCount`/`maxTurns` or `graceTurns`.**
  The `.d.ts` break surfaces the record fields at compile time; the footers name the replacement.
  Paseo reads only `details.status` ([#1021]'s source reading) and is unaffected.
  The cumulative-across-resumes count is lost; no in-repo reader uses it (`grep -rn turnCount packages --include='*.ts'` outside pi-subagents finds only pi-session-tools' own unrelated counter).
- **Existing configs stop earlier.**
  A `max_turns: 10` run that used to get up to 15 turns now gets 10; the BREAKING CHANGE footer and README say so, and operators can raise `max_turns`.
- **A terminating tool batch on the ceiling turn reads `exhausted`.**
  `turn_end` does not expose Pi's `terminate` flag; no tool in this package sets it, so the effect is limited to an extension tool that does, on exactly the ceiling turn.
- **The stop at `turn_end` happens before `prepareNextTurn`, but the `turn_start` backstop happens after it.**
  A threshold compaction could run before the backstop aborts; it fires only on a steer-forced turn past the ceiling.
- **The custom-message mechanism drifts upstream.**
  Recorded as an upstream-assumption row in the package skill (step 10) so `/upstream-impact` checks it.
- **PR #1024 conflicts in the widget files.**
  Mechanical rebase; neither change alters the other's logic.

## Open Questions

- Whether `wrapUpTurns` deserves a per-agent frontmatter override once operators use it; deferred until asked for.
- Whether the warning text should change on the final turn ("this is your last turn") versus the generic remaining-turns sentence; decide while writing step 4's tests, keeping the text in one constant.

[#1021]: https://github.com/gotgenes/pi-packages/issues/1021
[#1023]: https://github.com/gotgenes/pi-packages/issues/1023
[#1025]: https://github.com/gotgenes/pi-packages/issues/1025
