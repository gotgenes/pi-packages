---
issue: 1021
issue_title: 'pi-subagents: Paseo integration is confused when there is no "finished" status'
---

# Replace the `steered` status with a `turnBudget` outcome field

## Release Recommendation

**Release:** mid-batch — defer (batch "turn-budget"); confirm at ship time

This issue opens a two-member batch with [#1022], which redefines the turn-limit mechanics underneath the shape this issue introduces.
The package has no open improvement roadmap and so no `Release batches` list; the batch was agreed in this planning session.
Holding the release until [#1022] lands means no published version ever carries the interim meaning of `turnBudget` (see Design Overview), and the batch ships one major instead of two. [#1023] (final-turn tool withdrawal spike) is released independently and is not part of the batch.

## Problem Statement

A subagent that reaches its soft turn limit and finishes within the grace turns ends with `status: "steered"`.
Paseo's subagent track recognizes only `completed`, `error`, `aborted`, and `stopped` as finished, and maps any other value to `running`, so a finished turn-limited child spins forever (reported by @maxim against Paseo 0.10.3).

The defect is ours, not Paseo's.
`steered` is a terminal status named after the mechanism that produced it — the turn loop delivers its wrap-up message through Pi's `session.steer()` — rather than after the outcome.
"Steer" means something else everywhere else in the package: the `steer_subagent` tool, `SubagentsService.steer()`, and the `subagents:steered` event all mean "a redirect was injected into a running child", which never changes status.
The architecture doc's lifecycle diagram reads the status the same wrong way (`running --> steered : steer message injected`, `steered --> running`), and the vocabulary was inherited from the upstream fork (`tintinweb/pi-subagents` 0.1.0, still present in 0.19.0).

Every in-package reader already treats `steered` as success: `isTerminalErrorStatus` excludes it, so `subagents:completed` fires; the notification renders "completed (steered)"; the result renderer draws a ✓.
The one dissenter is the widget's `ERROR_STATUSES`, which lingers a `steered` row as long as a failure.
The status conflates two orthogonal facts — how the run ended, and what happened to its turn budget — and this issue separates them.

## Goals

- Remove `steered` from `SubagentStatus`.
  A run that wraps up at the turn limit ends `completed`; the turn-limit fact moves to a new `turnBudget` outcome field.
- Keep `aborted` with a precise meaning: the harness stopped the run at its turn limit.
  `stopped` keeps meaning an external stop (operator, parent, or service caller).
  Every terminal status is then one Paseo already recognizes, with no change on Paseo's side.
- Add `turnBudget: { maxTurns, used, phase }` (`phase: "within" | "warned" | "exhausted"`) to every surface that carries a terminal status: `SubagentRecord`, tool-result `AgentDetails`, `GetResultDetails`, `NotificationDetails`, the `subagents:completed`/`failed`/`resumed` event payloads, and the persisted `subagents:record` entry.
- Replace `subagents:child:completed`'s `aborted`/`steered` booleans with `turnBudget`.
- Keep the parent model's and operator's wording: a wrapped-up run still reads "Wrapped up (reached turn limit)" and still draws a yellow ✓.
- Stop the widget from lingering a wrapped-up run as if it had failed.
- **Breaking.**
  Removing a `SubagentStatus` variant is a type-level break for consumers of the public `.d.ts`, the observable `status` value changes for wrapped-up runs, and `ChildCompletedEvent` loses two fields.
  The behavior step uses `feat(pi-subagents)!:` with a `BREAKING CHANGE:` footer.

## Non-Goals

- Changing the turn-limit mechanics — `maxTurns` as a true ceiling, removing `graceTurns`, a pre-limit warning threshold, minimum `maxTurns` of 2, one successful-turn counter, live budget state in the widget, a phase-transition event, and resume budgets are [#1022].
- Removing the top-level `turnCount`/`maxTurns` from `SubagentRecord`, `AgentDetails`, and `NotificationDetails`.
  The operator chose to make `turnBudget` the budget's only home; [#1022] removes the top-level pair when it merges the two counters, inside the same batch.
- Withdrawing tools on the final permitted turn ([#1023]).
- Unifying the terminal-event vocabulary (`subagents:completed`/`failed`/`resumed` into one channel or one channel per status).
  The operator chose to keep the channels for now; see Open Questions.
- [#833] (`SubagentsService.steer()` does not emit `subagents:steered`) — the same word, but the redirect sense this issue leaves alone.
- Filing anything against Paseo.
  The design exists so Paseo's existing mapper works unchanged.
- Changing which runs hold their workspace for a resume.
  A run that wraps up at the turn limit and declared a question tears its workspace down today; it still will (see Design Overview).

## Background

The terminal status is decided in one place, `Subagent.completeRun` (`src/lifecycle/subagent.ts`), from the `TurnLoopResult` that `SubagentSession.runTurnLoop` (`src/lifecycle/subagent-session.ts`) returns.
`runTurnLoop` counts `turn_end` events in a local `turnCount`, sends the wrap-up steer when the count reaches the resolved limit (`opts.maxTurns ?? agentMaxTurns ?? defaultMaxTurns`), and calls `session.abort()` at `limit + graceTurns`.
It returns `{ responseText, aborted, steered }` and emits `subagents:child:completed` with the same two booleans.

The status's readers, all display-only — nothing branches on `steered` to change behavior:

| Reader                                                                                                                                                                                        | Uses `steered` to                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `outcome-delivery.ts` `STATUS_MEANINGS`, `renderStatusLabel`, `renderStatusNote`                                                                                                              | Word the outcome for the parent model ("Wrapped up (reached turn limit)") in the nudge, foreground return, resume return, and pull report |
| `notification.ts` `formatTaskNotification`                                                                                                                                                    | Print `<summary>Subagent "x" steered</summary>` raw                                                                                       |
| `renderer.ts` `resolveStatusPresentation`                                                                                                                                                     | Render "completed (steered)" in the notification box                                                                                      |
| `result-renderer.ts` `renderStatusIcon`, `renderCompleted`; `get-result-renderer.ts`                                                                                                          | Draw a yellow ✓                                                                                                                           |
| `widget-renderer.ts`                                                                                                                                                                          | Draw a yellow ✓ and " (turn limit)"                                                                                                       |
| `display.ts` `ERROR_STATUSES` → `agent-widget.ts`                                                                                                                                             | Linger the finished row for the error duration                                                                                            |
| `subagent.ts` `completeRun`                                                                                                                                                                   | Exclude the run from `holdForResume` (only `completed` holds)                                                                             |
| Pass-through: `SubagentRecord.status`, `AgentDetails.status`, `GetResultDetails.status`, `NotificationDetails.status`, `buildEventData`, `subagents:record`, `WorkspaceDisposeOutcome.status` | Expose the raw value — this is what Paseo reads                                                                                           |

Paseo's mapper (`getpaseo/paseo`, `packages/server/src/server/agent/providers/pi/extensions/gotgenes-pi-subagents/index.ts`) reads `details.status` from `subagent`, `get_subagent_result`, and `steer_subagent` results and from `subagent-notification`/`subagent-update` custom messages: `completed` → completed, `error` → failed, `aborted`/`stopped` → canceled, anything else → running.
It reads no `pi.events` channel except `subagents:child:session-created`, and no top-level `turnCount`/`maxTurns`.

`SubagentRecord`'s admission policy is `docs/decisions/0005-subagent-record-admission-policy.md`: adding a field is minor, removing or retyping one is major, and the snapshot is by value.
`turnBudget` is an outcome fact of the same kind as `status` and `result`.

## Design Overview

### Vocabulary

| Terminal status | Who ended the run                              | `turnBudget.phase` (when a limit exists) | Paseo shows |
| --------------- | ---------------------------------------------- | ---------------------------------------- | ----------- |
| `completed`     | The agent, on its own                          | `within` or `warned`                     | completed   |
| `error`         | A failure                                      | absent in this issue (see below)         | failed      |
| `aborted`       | The harness, at the turn limit                 | `exhausted`                              | canceled    |
| `stopped`       | Operator, parent, or service caller            | whatever the loop reached                | canceled    |

`completed` + `warned` is exactly what `steered` meant.
`aborted` ⇔ `exhausted` holds by construction, because `completeRun` derives the status from the phase.

### The type

`src/lifecycle/turn-limits.ts` is the package's turn-limit policy home, so the type lives there and `src/service/service.ts` re-exports it:

```typescript
/** What the harness has done about a run's turn limit, in the order it happens. */
export type TurnBudgetPhase = "within" | "warned" | "exhausted";

/** A run's turn limit and its use. Present only when a limit exists. */
export interface TurnBudget {
  maxTurns: number;
  /** Completed turns. In this release it can exceed maxTurns (grace turns). */
  used: number;
  phase: TurnBudgetPhase;
}

/** A run that finished on its own after the harness warned it about the limit. */
export function wrappedUpAtTurnLimit(outcome: {
  status: SubagentStatus;
  turnBudget?: TurnBudget;
}): boolean;
```

`phase` is stored, not derived from `used` and `maxTurns`: whether the harness warned or stopped the run is an event, and the counts cannot distinguish an agent that answered on its last permitted turn from one the harness cut off.

`wrappedUpAtTurnLimit` is the single decision point for the presentation sites that today test `status === "steered"` (`renderer.ts`, `outcome-delivery.ts`, `result-renderer.ts`, `widget-renderer.ts`), per the `code-design` skill's decide-once rule.
It reads two fields, so its parameter is a two-field structural type every outcome-shaped object satisfies (`Subagent`, `SettledOutcome`, `AgentDetails`, `NotificationDetails`, `WidgetAgent`).
`turn-limits.ts` imports `SubagentStatus` as a type from `subagent-state.ts`; `subagent-state.ts` will import `TurnBudget` as a type from `turn-limits.ts`.
Both are `import type` edges, erased at compile time, but confirm `pnpm fallow dead-code` reports no cycle after the step that adds the second edge; if it does, move `wrappedUpAtTurnLimit` into `outcome-delivery.ts`, which already imports both.

### Interim meaning, inside the batch

Until [#1022] lands, `maxTurns` is the wrap-up point, not the ceiling: `warned` is set when the wrap-up steer is sent at `used === maxTurns`, `exhausted` at `limit + graceTurns`, and `used` can exceed `maxTurns`.
[#1022] keeps the shape and changes the meaning (true ceiling, `used ≤ maxTurns`).
That interim meaning is why this issue is mid-batch.

`turnBudget` is set at the run's terminal transition only.
A running record, an errored run (`runTurnLoop` throws before returning a result), and a resumed run (`resumeTurnLoop` enforces no limit) carry none.
[#1022] makes it live running state.

### Data flow

```text
runTurnLoop ──TurnLoopResult { responseText, turnBudget? }──▶ Subagent.completeRun
   │                                                             ├─ phase exhausted → markAborted(result, turnBudget)
   │                                                             └─ otherwise       → markCompleted(result, turnBudget)
   └─ lifecycle.completed({ sessionDir, agentName, turnBudget? })        │
                                                                         ▼
                                                        SubagentState._turnBudget (outcome fact)
                                                         ├─ SettledOutcome.turnBudget → carriers
                                                         └─ Subagent.turnBudget getter → records, details, events, widget
```

`completeRun` call site, after the change:

```typescript
const exhausted = result.turnBudget?.phase === "exhausted";
const finalStatus: SubagentStatus = exhausted ? "aborted" : "completed";
const holdForResume =
  finalStatus === "completed" && this.pendingQuestion !== undefined && !wrappedUpAtTurnLimit({ status: finalStatus, turnBudget: result.turnBudget });
// ...
if (exhausted) this.markAborted(finalResult, result.turnBudget);
else this.markCompleted(finalResult, result.turnBudget);
```

The `holdForResume` clause preserves today's behavior: commit `88572eff` held the workspace only for `completed` and disposed every other outcome "exactly as before", so a `steered` run with a question tears down.
Whether a wrapped-up child that asked a question should hold its workspace is a real question, but a separate behavior change (Open Questions).

`markCompleted`/`markAborted` take the budget as an optional **third** argument, `(result, completedAt?, turnBudget?)`, rather than adding a setter, so the outcome fact is set in the same transition as `result`, matching `_pendingQuestion`'s "set alongside it at the terminal transition" rule.
Appending keeps every existing caller valid: 4 test sites in `test/lifecycle/subagent-state.test.ts` pass `completedAt` positionally (measured with `grep -rn 'markCompleted(\|markAborted(' src test`), and `completeRun` passes `(finalResult, undefined, result.turnBudget)`.

`resetForResume` clears `_turnBudget` with `_result`; `currentOutcome()` includes it, so a superseded outcome keeps its budget.
`SubagentStateInit` gains `turnBudget` so tests can seed it, like `result`.
`toSubagentRecord` copies it by value (`{ ...record.turnBudget }`), per ADR 0005's by-value rule.

### Presentation

- `outcome-delivery.ts`: `STATUS_MEANINGS` drops `steered`; a separate `WRAPPED_UP` meaning is selected by `wrappedUpAtTurnLimit`.
  `renderStatusLabel` and `renderStatusNote` take `{ status, error?, turnBudget? }` instead of positional `(status, error)`/`(status)`; their four call sites (`notification.ts:47`, `get-result-report.ts:83`, `foreground-runner.ts:148`, `agent-tool.ts:153`) pass the record or report they already hold.
- `renderer.ts` `resolveStatusPresentation` takes the details object; "completed (steered)" becomes "completed (wrapped up)".
- `notification.ts` `<summary>` uses the status, now `completed`, so the raw word disappears from the model's view without a rewording.
- `result-renderer.ts` `renderStatusIcon` loses its `steered` arm; `renderCompleted` picks the warning ✓ via the predicate.
- `widget-renderer.ts` picks the yellow ✓ and " (turn limit)" via the predicate; `WidgetAgent` gains `turnBudget`.
- `display.ts` `ERROR_STATUSES` drops `steered`, so a wrapped-up row lingers one turn like any completed row.

### Edge cases

- **No limit configured** (the default): `turnBudget` is absent everywhere, and output is byte-identical to today for every non-wrapped-up run.
- **Stopped during the grace turns:** `markStopped` wins the status as today; the record still carries the loop's budget (`warned`), which is accurate.
- **Persisted `subagents:record` entries** written by earlier versions may carry `status: "steered"`.
  Nothing in this repo reads them back (grep for `subagents:record` finds only the writer), so no read-time mapping is added.

## Module-Level Changes

### Source

- `src/lifecycle/turn-limits.ts` — add `TurnBudgetPhase`, `TurnBudget`, `wrappedUpAtTurnLimit`; update the module doc.
- `src/lifecycle/subagent-session.ts` — `TurnLoopResult` becomes `{ responseText; turnBudget?: TurnBudget }`; `runTurnLoop` builds the budget from its locals (`maxTurns`, `turnCount`, `softLimitReached`, `aborted`) and passes it to `lifecycle.completed`.
- `src/lifecycle/child-lifecycle.ts` — `ChildCompletedEvent` replaces `aborted`/`steered` with `turnBudget?: TurnBudget`; the `SUBAGENT_CHILD_COMPLETED` doc comment drops "steered".
- `src/lifecycle/subagent-state.ts` — drop `"steered"` from `SubagentStatus`; delete `markSteered`; add `_turnBudget` (getter, `SubagentStateInit` field, set by `markCompleted`/`markAborted`, cleared in `resetForResume`, included in `currentOutcome`); `SettledOutcome` gains `turnBudget`; fix the `isTerminalErrorStatus` and `isTerminalError` doc comments.
- `src/lifecycle/subagent.ts` — `completeRun` derives status from the budget; delete the `markSteered` delegate (sole caller is `completeRun`); add a `turnBudget` getter; thread the budget through `markCompleted`/`markAborted`; update the `clearPendingQuestion` comment ("An aborted or steered run keeps its question").
- `src/lifecycle/workspace.ts` — predicted unchanged: `WorkspaceDisposeOutcome.status` narrows with the union, and `pi-subagents-worktrees` reads no `status` (grep of its `src/` for `status` finds only `git status`).
- `src/observation/outcome-delivery.ts` — as in Presentation.
- `src/observation/notification.ts` — `NotificationDetails` and `buildNotificationDetails` gain `turnBudget`; `buildEventData` gains `turnBudget`; `renderStatusLabel` call site.
- `src/observation/renderer.ts` — `resolveStatusPresentation` via the predicate.
- `src/observation/subagent-events-observer.ts` — the `subagents:record` entry gains `turnBudget`.
- `src/tools/helpers.ts` — `buildDetails`'s record parameter and output gain `turnBudget`.
- `src/tools/get-result-tool.ts` — `GetResultDetails` (wherever it is declared) and `buildGetResultDetails` gain `turnBudget`; `liveOutcome` copies it.
- `src/tools/get-result-report.ts` — `AgentReport` gains `turnBudget`; `renderStatusNote` call site.
- `src/tools/foreground-runner.ts`, `src/tools/agent-tool.ts` — `renderStatusNote` call sites.
- `src/tools/result-renderer.ts` — `renderStatusIcon`, the `completed || steered` dispatch, `renderCompleted`.
- `src/tools/get-result-renderer.ts` — predicted unchanged beyond what `renderStatusIcon`'s narrowed union forces; it passes `details.status` only, so a wrapped-up pull renders the green ✓ unless the step also passes the budget.
  Decide in the presentation step whether the pull view shows the warning ✓ too; the plan recommends yes, for parity with the spawn view.
- `src/ui/display.ts` — `AgentDetails.status` union drops `"steered"` and gains `turnBudget`; `ERROR_STATUSES` drops `"steered"`.
- `src/ui/widget-renderer.ts`, `src/ui/agent-widget.ts` — `WidgetAgent.turnBudget`, `toWidgetAgent` copies it, the row branch uses the predicate.
- `src/service/service.ts` — `SubagentRecord.turnBudget?`; re-export `TurnBudget`, `TurnBudgetPhase`.
- `src/service/service-adapter.ts` — `toSubagentRecord` copies the budget by value.

### Tests

- New `test/helpers/` fixture builders `turnLoopResult(overrides?)` and `childCompletedEvent(overrides?)` (step 1).
- Fixture migration: the 25 lines matching `steered: (false|true)` across 8 files (`test/tools/get-result-tool.test.ts`, `test/lifecycle/{child-lifecycle,subagent-manager,subagent-session,subagent}.test.ts`, `test/helpers/{mock-session.ts,manager-stubs.test.ts}`, `test/observation/notification.test.ts`), plus the multi-line `aborted: false` result literals in `test/helpers/mock-session.test.ts` and those files (measured with `grep -rn`; the 6 `aborted:` lines in `test/observation/record-observer.test.ts` are Pi `compaction_end` events and stay).
- `"steered"` status literals: 15 lines across `test/lifecycle/{subagent-state,subagent}.test.ts`, `test/observation/{outcome-delivery,renderer}.test.ts`, `test/tools/{get-result-renderer,get-result-report,result-renderer}.test.ts`, `test/widget-renderer.test.ts` (measured).
- `test/service/service.test.ts` asserts `SUBAGENT_EVENTS.STEERED` — the redirect event, unchanged.

### Docs

- `README.md` — "Graceful Max Turns": the status table loses `steered` and gains a sentence on `turnBudget.phase`; "Events": `subagents:completed` key fields list `status` (the payload has always carried it) and every terminal row lists `turnBudget`.
- `docs/architecture/architecture.md` — the "Agent lifecycle" state diagram drops the `steered` node and the two transitions that misread it, and labels `running --> aborted` as the harness's turn-limit stop; the domain-model and events tables if they name the status set.
- `docs/decisions/0005-subagent-record-admission-policy.md` — add a `turnBudget` row (admitted, optional, outcome fact).
- `.pi/skills/package-pi-subagents/SKILL.md` — predicted unchanged (grep for `steered` finds nothing); re-grep in the docs step.
- `docs/configuration.md` — predicted unchanged: `graceTurns` survives this issue.

## Test Impact Analysis

1. **New tests enabled.**
   `runTurnLoop`'s budget is now a returned value, so `subagent-session.test.ts` can assert `{ maxTurns, used, phase }` for each of the three paths directly, where today it asserts two booleans.
   `wrappedUpAtTurnLimit` gets its own table test over every status × phase combination.
2. **Tests that become redundant.**
   None removed: the `steered` status tests are rewritten to the `completed` + `warned` shape rather than deleted, since each pins a reader that still exists.
3. **Tests that stay as-is.**
   The `aborted` paths (status, "Aborted (max turns exceeded…)" wording, red ✗), the `stopped` paths, and every run without a limit — the byte-identical-output edge case above is pinned by them.

## Invariants at risk

| Invariant                                                                                                                          | Constituency                    | Pinned by                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A turn-limited run that finishes in time is reported to the parent model as "Wrapped up (reached turn limit)" on all four carriers | Parent model                    | `test/observation/outcome-delivery.test.ts` (rewritten from `steered` to `completed` + `warned`); open it in step 4 to confirm it exercises the real renderer, not a mock |
| A hard-stopped run fires `subagents:failed`, not `subagents:completed`                                                             | Event subscribers               | The events-observer tests; `aborted` stays in `isTerminalErrorStatus`, so unchanged                                                                                       |
| Only a `completed` run with a question and no turn-limit wrap-up holds its workspace                                               | `WorkspaceProvider` (worktrees) | `test/lifecycle/subagent.test.ts`'s hold-for-resume tests from `88572eff`; step 5 adds a wrapped-up-with-question case asserting teardown                                 |
| A carrier waiting on a superseded run still renders that run's outcome                                                             | Parent model via waiters        | `supersededOutcome` tests in `test/lifecycle/subagent-state.test.ts`; step 3 extends one to assert the budget survives supersession                                       |
| Every terminal status a consumer receives is one Paseo maps to a finished state                                                    | Paseo                           | Type-level: `SubagentStatus` no longer contains `steered`; step 5's `completeRun` tests assert `completed` for a wrapped-up run                                           |

## TDD Order

1. **`test(pi-subagents): build turn-loop results and child-completed events from fixtures`** Add `turnLoopResult(overrides?: Partial<TurnLoopResult>)` and `childCompletedEvent(overrides?)` to `test/helpers/` (beside `make-subagent.ts`), with defaults equal to today's literals, and migrate every `{ responseText, aborted, steered }` result literal and `ChildCompletedEvent` literal listed under Tests onto them.
   Refactor-only: the suite stays green with no `src/` change.
   This is the Tidy-First assessor's recommended preparation — it turns the result-shape changes in steps 2 and 6 from per-literal edits (25 measured `steered:` lines plus their `aborted:` siblings) into one fixture file.
   Killing mutation: none (no behavior); verify by `pnpm --filter @gotgenes/pi-subagents exec vitest run` and `pnpm --filter @gotgenes/pi-subagents run check` both green.

2. **`refactor(pi-subagents): report the turn loop's budget alongside its flags`** Add `TurnBudget`/`TurnBudgetPhase` to `turn-limits.ts`.
   `runTurnLoop` returns `turnBudget` **in addition to** `aborted`/`steered` (lift; the booleans go in step 6), absent when no limit resolves.
   Tests in `test/lifecycle/subagent-session.test.ts`: no limit → no budget; finishes before the limit → `within`, `used` = turns run; finishes after the wrap-up steer → `warned`; hits `limit + grace` → `exhausted`.
   Killing mutations: make `runTurnLoop` set `phase: "within"` unconditionally (kills the `warned` and `exhausted` tests); make it return a budget when `maxTurns` is undefined (kills the no-limit test); make `used` the constant `maxTurns` (kills the `within` count test).

3. **`refactor(pi-subagents): carry the turn budget as an outcome fact on the subagent state`** `SubagentState` gains `_turnBudget` with its whole lifecycle in this step: seeded by `SubagentStateInit.turnBudget`; set by `markCompleted`/`markAborted` (decide the signature per Design Overview); cleared by `resetForResume`; read through the getter and `SettledOutcome.turnBudget`.
   `Subagent` gains the getter and `completeRun` passes `result.turnBudget` to whichever transition it already calls — status derivation does not change yet.
   Tests in `test/lifecycle/subagent-state.test.ts` and `test/lifecycle/subagent.test.ts`.
   Killing mutations: delete the `_turnBudget = undefined` line in `resetForResume` (kills the resume-clears test); drop `turnBudget` from `currentOutcome()` (kills the superseded-outcome test); have `completeRun` pass `undefined` instead of `result.turnBudget` (kills the completeRun test).

4. **`feat(pi-subagents): report the turn budget on finished subagents`** Expose the field, additively, on `SubagentRecord` (`toSubagentRecord`, by value), `AgentDetails` (`buildDetails`), `GetResultDetails` (`buildGetResultDetails`, `liveOutcome`), `NotificationDetails`, `buildEventData`, the `subagents:record` entry, and `WidgetAgent`; re-export the types from `service.ts`.
   Add `wrappedUpAtTurnLimit` and route the presentation sites through it while `steered` still exists: the predicate returns true for `completed` + `warned` **or** `status === "steered"`, so real runs (still `steered`) render as today and seeded `completed` + `warned` records render identically.
   `renderStatusLabel`/`renderStatusNote`/`resolveStatusPresentation` take the outcome object; update their call sites.
   Observable: consumers can now read `turnBudget`.
   Tests: `test/service/` adapter test (by-value copy: mutating the record's budget after the snapshot does not change the snapshot), notification-details and event-data tests, a table test for the predicate, and presentation tests seeding `completed` + `warned` beside the existing `steered` ones in `outcome-delivery`, `renderer`, `result-renderer`, `get-result-renderer`, and `widget-renderer` tests.
   Killing mutations: make `toSubagentRecord` assign `record.turnBudget` without copying (kills the by-value test); drop `turnBudget` from `buildEventData` (kills the event-payload test); make the predicate ignore `turnBudget` (kills every `completed` + `warned` presentation test while the `steered` ones stay green — that split is the predicted outcome).

5. **`feat(pi-subagents)!: report a run that wraps up at its turn limit as completed`** `completeRun` derives the status from the budget; remove `"steered"` from `SubagentStatus`, the `display.ts` union, `ERROR_STATUSES`, `renderStatusIcon`, `STATUS_MEANINGS`, and the predicate's legacy arm; delete both `markSteered` methods; add the `holdForResume` clause.
   Narrowing the union breaks every `"steered"` test literal at type level, so all 15 migrate in this step (to `completed` + `turnBudget: { …, phase: "warned" }`).
   Tests: `completeRun` with a `warned` result ends `completed` and fires `subagents:completed`; with an `exhausted` result ends `aborted` and fires `subagents:failed`; a wrapped-up run with a pending question tears its workspace down; the widget lingers a wrapped-up row for the completed duration.
   Killing mutations: make `completeRun` map `warned` to `aborted` (kills the completed-status test); delete the `holdForResume` clause (kills the teardown test); make the widget's linger check also treat `wrappedUpAtTurnLimit` runs as errors (kills the linger test).
   Commit footer, as its final paragraph:

   ```text
   BREAKING CHANGE: SubagentStatus no longer includes "steered". A run that
   wraps up at its turn limit now ends with status "completed" and
   turnBudget.phase "warned"; read turnBudget for the turn-limit fact.

   Refs #1021

   Co-authored-by: Max Chernyak <7758+maxim@users.noreply.github.com>
   ```

   The trailer credits the issue's adopted constraint — every finished run reports a status consumers already treat as final.

6. **`feat(pi-subagents)!: report the turn budget on subagents:child:completed`** Drop `aborted`/`steered` from `TurnLoopResult` (`completeRun` already reads only `turnBudget`) and from `ChildCompletedEvent`, which gains `turnBudget`.
   The step-1 fixtures absorb the shape change; any literal they did not cover migrates here.
   Tests in `test/lifecycle/child-lifecycle.test.ts` and `subagent-session.test.ts`: the emitted event carries the budget and no booleans.
   Killing mutation: emit `turnBudget: undefined` from `runTurnLoop`'s `lifecycle.completed` call (kills the event-payload test).
   Footer: `BREAKING CHANGE: subagents:child:completed no longer carries aborted or steered; read turnBudget.phase ("exhausted" or "warned").`

7. **`docs(pi-subagents): document the turn budget outcome and correct the lifecycle diagram`** README, architecture doc, ADR 0005 row, per Module-Level Changes.
   Verify the Mermaid diagram renders (load the `mermaid` skill), re-grep `steered` across `packages/pi-subagents/{README.md,docs}` and `.pi/skills/` — the only remaining hits should be the `subagents:steered` redirect event, plans, retros, and history.

## Risks and Mitigations

- **A consumer outside this repo switches on `"steered"`.**
  The `.d.ts` break surfaces it at compile time; the `BREAKING CHANGE:` footer names the migration.
  Paseo is unaffected (it maps `steered` to running today, which is the bug).
- **The presentation lift (step 4) hides a regression for real runs.**
  The predicate's legacy arm keeps real `steered` runs on the old path while the new path is tested with seeded records; step 5 removes the arm and the same tests must stay green with `completed` + `warned`.
- **The interim `used > maxTurns` meaning ships.**
  Only if the batch is broken; the release marker defers it, and `/ship` confirms.
- **`markCompleted`/`markAborted` signature churn.**
  The budget is appended as a third parameter, so no existing `completedAt` caller shifts; run `pnpm run check` in step 3 to confirm.
- **An import cycle between `turn-limits.ts` and `subagent-state.ts`.**
  Both edges are type-only; run `pnpm fallow dead-code` after step 3 and relocate the predicate if it reports one.

## Open Questions

- Should a run that wraps up at the turn limit and asked a question hold its workspace for a resume, like a plain `completed` run?
  Today it tears down; this plan preserves that.
  Revisit with [#1022]'s resume-budget decision.
- Unify the terminal-event vocabulary (one `subagents:finished`-style channel carrying `status`, or one channel per status) instead of the `completed`/`failed` bucket split.
  Deferred by the operator; no issue filed yet.
- Whether to comment on this issue with the new vocabulary once the batch ships, so the reporter knows Paseo needs no change.

[#833]: https://github.com/gotgenes/pi-packages/issues/833
[#1022]: https://github.com/gotgenes/pi-packages/issues/1022
[#1023]: https://github.com/gotgenes/pi-packages/issues/1023
