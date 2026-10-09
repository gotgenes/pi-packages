---
issue: 947
issue_title: "pi-subagents: `get_subagent_result(wait: true)` has no timeout and reports no progress, so a stalled child blocks the parent until a human interrupts"
---

# Bound `get_subagent_result`'s wait and report a running agent's progress

## Release Recommendation

**Release:** ship independently

The Phase 23 roadmap step for #947 is tagged `Release: independent`, and the step leaves the package releasable on its own.
The release vehicle is `feat:` (an added optional parameter and added report text; no default changes).

## Problem Statement

A parent that calls `get_subagent_result({ wait: true })` on a background child waits with no bound and sees nothing until the child settles.
In the reported incident the child sat inside one wedged `bash` call for 72 minutes, the parent's wait blocked for 74 minutes, and it ended only because the human pressed Esc.
The report it then returned (`Status: running | Tool uses: 108 | … | Duration: 4712.0s`) was indistinguishable from a healthy long run.

Every fact that would have shown the stall already exists on the live record (`activeTools`, `responseText`, `turnBudget.used`) and is already rendered to the human by the widget through `describeActivity`, but the model-facing report carries none of it.
No record field says when the child last made progress.

## Goals

- `get_subagent_result` accepts an optional `timeout` in seconds (no default, mirroring Pi's `bash`); with `wait: true`, the wait ends at the bound and returns a normal report while the child keeps running.
- Every report about a running agent (from `wait: false` polls, interrupted waits, and expired waits alike) carries a progress line: the current activity, turns used, and how long since the last progress.
- An expired wait says, in the report and in the tool description, that the agent was **not** stopped, and that re-issuing the same wait on unchanged progress will not unstick it.
- An unbounded wait (no `timeout`) behaves exactly as today.
- Not breaking: no default changes, and the added report text is additive.

## Non-Goals

- **A default bound.**
  The operator chose an opt-in bound (planning gate, 2026-10-09); today's unbounded behavior stays for every call that omits `timeout`.
- **Streaming progress through `onUpdate` during a wait.**
  It would reach only the human's TUI row, and the widget already shows the same facts; deferred by operator decision.
- **The TUI details (`GetResultDetails`).**
  The progress facts go into the model-facing report text only, so [#755]'s `buildReport`/`buildGetResultDetails` mapping overlap stays as the roadmap's sweep anticipated ("rides #947 if its progress fields widen both; otherwise it stays").
- **`SubagentRecord` / the service snapshot.**
  Decision 0005 keeps momentary activity off the public snapshot; this change does not touch `src/service/`.
  [#912] settles the service side.
- **Stall detection or "return early on idle".**
  The bound is clock-based; the model decides what unchanged progress means.
- **The shared running body** (`renderOutcomeBody`'s "Agent is still running.
  Use wait: true or check back later.") stays as-is, since it is shared with other outcome carriers.
- **Pi core's `bash` timeout default**, and pi-permission-system's forwarded-permission timeouts ([#735], [#722]): different layers, per the issue.
- **Moving the run's state onto a per-run object.** [#1049]/[#1051] own that; this step adds one field to `SubagentState` and its reset, which those steps then carry.

## Background

- `src/tools/get-result-tool.ts` — `GetResultTool.execute` claims the outcome, awaits `record.waitUntilSettled(signal)`, then marks the outcome consumed (`settled`), releases the claim (`unsettled`), or reports the superseded run's outcome (`superseded`).
  `_onUpdate` is accepted and discarded.
  The params literal `{ agent_id; wait?; verbose? }` is spelled three times (`execute`, `renderCall`, the `execute` arrow in `toToolDefinition`).
- `src/lifecycle/subagent.ts` — `waitUntilSettled(signal)` races the run handle against `signal` via `settleOrAbort`; its doc comment states that ending the wait must not cancel the work.
  A bounded wait only needs a different signal; `Subagent` does not change beyond one read-through getter.
- `src/tools/get-result-report.ts` — `AgentReport` plus the pure `formatAgentReport`; no running-state progress is rendered today, and `turnBudget` is carried but not rendered in the text.
- `src/observation/record-observer.ts` — `subscribeSubagentObserver` is the single `session.subscribe` callback that accumulates stats on `SubagentState`.
- `src/lifecycle/subagent-state.ts` — owns `_startedAt`, `markRunning(startedAt)`, `resetForResume(startedAt)`, and the live `activeTools`/`responseText`.
- `src/ui/display.ts` — `describeActivity(activeTools, responseText)` (already imported by `get-result-tool.ts`, so no new zone edge) and `formatMs`.
- Pi's `bash` tool (`../../pi/packages/coding-agent/src/core/tools/bash.ts`, read at planning time): `timeout` is `Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" }))`, and a non-finite, non-positive, or over-`2_147_483_647` ms value throws `Invalid timeout: …`.
  The issue names the parameter `timeoutMs` while describing it in seconds; this plan follows `bash`'s name and unit.
- `docs/decisions/0005-subagent-record-admission-policy.md` governs `SubagentRecord` only; the get-result report is a different surface.
  The roadmap asks the ADR to gain a sentence saying so if the report admits activity facts, which it now does.

## Design Overview

### The bound

```typescript
interface GetResultParams {
	agent_id: string;
	wait?: boolean;
	verbose?: boolean;
	/** Seconds; only bounds a `wait: true`. Absent = unbounded. */
	timeout?: number;
}
```

`timeout` is validated whenever present (finite, `> 0`, at most `2_147_483.647` s), throwing `Invalid timeout: …` as `bash` does; it bounds only a `wait: true` call and is otherwise ignored.

The wait lives in a private method extracted ahead of the change (step 3).
With a timeout, that method derives a wait signal from the parent's signal plus a `setTimeout`-backed controller (`setTimeout`, not `AbortSignal.timeout`, so Vitest's fake timers drive it), passes it to the unchanged `waitUntilSettled`, and clears the timer and the parent-signal listener in a `finally`.
An expired bound therefore takes the existing `unsettled` path: the claim is released, nothing is consumed, and the child is never touched.

```typescript
// inside GetResultTool, sketch
const bound = params.timeout === undefined ? undefined : startBound(signal, params.timeout);
try {
	const wait = await record.waitUntilSettled(bound?.signal ?? signal);
	// … settled / unsettled / superseded handling unchanged …
	return { superseded, expiredAfter: bound?.expired ? params.timeout : undefined };
} finally {
	bound?.dispose();
}
```

`expired` is true only when the timer fired, so a parent interrupt (no timer fired) reports no expiry note.
When the run settles before the bound, the outcome is collected exactly as today.

### The progress line

`AgentReport` gains one optional field, present only when the reported outcome's status is `running`:

```typescript
interface ReportProgress {
	/** describeActivity(record.activeTools, record.responseText) */
	activity: string;
	/** record.turnBudget?.used; absent before the turn loop reports a budget */
	turns: number | undefined;
	/** formatMs(Date.now() - record.lastProgressAt) */
	sinceLastProgress: string;
}
```

`formatAgentReport` renders it as a line after the `Model:` line and before `Description:`, for example:

```text
Progress: running command… | Turns: 7 | Last progress: 4408.0s ago
```

The line is rendered in `formatAgentReport`, never inside the shared `renderOutcomeBody`, which other carriers use.
A superseded run's report is settled, so it carries no progress line; a `queued` agent carries none either (it has no activity yet).

`AgentReport` also gains `waitExpiredAfter?: number` (seconds).
When set, `formatAgentReport` appends after the outcome addenda and before the conversation/transcript pointers:

```text
This wait ended after its 120s timeout. The agent was not stopped and is still running.
If its progress has not changed since your last check, waiting again will not unstick it: read its transcript, steer it with steer_subagent, or tell the user it appears stuck.
```

### The last-progress timestamp

`SubagentState` gains `_lastProgressAt: number` with its whole lifecycle in one step (step 4):

- **set** at construction from `init.lastProgressAt ?? startedAt` (`SubagentStateInit` gains `lastProgressAt?: number`, in keeping with the full-value init);
- **reset** to the run's start in `markRunning(startedAt)` and `resetForResume(startedAt)`, so a new run never inherits the previous run's staleness;
- **stamped** by a new `markProgress(at = Date.now())`;
- **read** through `get lastProgressAt()`, and through a read-through getter on `Subagent` beside `activeTools`/`responseText`.

`subscribeSubagentObserver` calls `state.markProgress()` at the top of its callback for **every** session event (step 5).
Both directions of that evidence, compared with the transcript-mtime source the issue proposed:

- **Seen by events, missed by mtime:** streaming assistant deltas (`message_update`) and streaming tool output (`tool_execution_update`), so a long streamed answer or a chatty command does not read as stale.
- **Seen by mtime, missed by events:** nothing the model needs.
  Entries the session writes outside a run (for example, a steer appended while no turn runs) are not progress of the run.
- **The incident's shape:** a tool call that emits no output fires `tool_execution_start` and then nothing until `tool_execution_end`, so `lastProgressAt` freezes at the call's start, which is exactly the stall's start.

### Description text

The tool `description` gains: "With wait: true and a timeout, the wait ends at the timeout and returns the agent's current progress; this does not stop or abort the agent, unlike bash's timeout."
The `timeout` parameter description: "Seconds to wait when wait is true (optional, no default: wait until the agent finishes).
An expired wait does not stop the agent; if its progress is unchanged since your last check, do not simply wait again."
These go in `description`/parameter text, not `promptGuidelines`, since they are post-choice guidance (the `code-design` skill).
`renderCall` shows `waiting ≤120s` instead of `waiting` when a timeout is set.

### Edge cases and the steps that pin them

| Behavior                                                                                                                                             | Step |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Timeout expires while running: report returns, expiry note present, status still `running`, claim released, not consumed, no abort reached the child | 7    |
| Run settles before the timeout: collected as today, timer cleared (no pending timer)                                                                 | 7    |
| Parent interrupt with a timeout set: no expiry note                                                                                                  | 7    |
| `timeout` without `wait`: ignored (immediate report)                                                                                                 | 7    |
| Invalid `timeout` (0, negative, `NaN`, over max): throws `Invalid timeout`                                                                           | 7    |
| No `timeout`: unbounded (existing "waits for promise when wait=true" tests stay green)                                                               | 7    |
| Running report carries activity/turns/last progress; completed and superseded reports do not                                                         | 6    |
| No turn budget yet: line omits `Turns:`                                                                                                              | 6    |
| `lastProgressAt` resets at `markRunning` and `resetForResume`                                                                                        | 4    |
| Every session event stamps progress, including events the observer otherwise ignores                                                                 | 5    |

## Module-Level Changes

- `test/helpers/text-of.ts` (new) and `test/helpers/text-of.test.ts` (new): `textOf(result)` returns the first content item's text and throws when it is not a text item.
- `test/tools/{agent-tool,background-spawner,foreground-runner,get-result-tool,steer-tool}.test.ts`: the 102 `result.content[0].text` reads (measured: 30, 13, 26, 24, 9) become `textOf(result)`.
- `test/session/notify-parent-tool.test.ts`: its local `textOf` is replaced by the shared helper.
- `src/tools/get-result-tool.ts`: `GetResultParams` type; private wait method; `timeout` schema, validation, and bound; `progress` and `waitExpiredAfter` in `buildReport`; description text; `renderCall` note.
- `src/tools/get-result-report.ts`: `AgentReport.progress?`, `AgentReport.waitExpiredAfter?`; `formatAgentReport` renders both.
- `src/lifecycle/subagent-state.ts`: `_lastProgressAt`, `lastProgressAt`, `markProgress`, `SubagentStateInit.lastProgressAt?`, resets in `markRunning`/`resetForResume`; module doc comment's transition-method list.
- `src/lifecycle/subagent.ts`: `get lastProgressAt()` read-through.
- `src/observation/record-observer.ts`: `state.markProgress()` on every event; doc comment's handles list.
- `test/lifecycle/subagent-state.test.ts`, `test/observation/record-observer.test.ts`, `test/tools/get-result-report.test.ts`, `test/tools/get-result-tool.test.ts`: new tests (see TDD Order).
- `test/helpers/make-subagent.ts`: `TestSubagentOptions.lastProgressAt?` passed through to the state init.
- `README.md` (`### get_subagent_result`): `timeout` row, and one sentence on the progress line and that an expired wait does not stop the agent.
- `docs/decisions/0005-subagent-record-admission-policy.md`: one sentence under Consequences: the `get_subagent_result` report is a pull read by the model at the moment it asks, so it may carry momentary activity that the snapshot declines; the snapshot's rule is unchanged.
- `docs/architecture/architecture.md`: the #947 step heading gains `✅` and a `Landed:` note; the Mermaid node `S947` gains `✅`; the module-tree line for `get-result-tool.ts` describes the bounded wait; the `result.content[0]` metric row is re-measured (target 0).

Predicted unchanged (each a falsifiable claim):

- `src/service/service-adapter.ts`, `test/service/service-adapter.test.ts`: `toSubagentRecord` is an allowlist, so the new `Subagent.lastProgressAt` getter cannot reach the snapshot; the "declined fields" test stays green.
- `src/observation/outcome-delivery.ts`: the running body and addenda are shared and untouched.
- `src/tools/get-result-renderer.ts`, `test/tools/get-result-renderer.test.ts`: `GetResultDetails` is unchanged.
- `.pi/skills/package-pi-subagents/SKILL.md`: it names the tool only in the domain table, which still holds (grep at planning time).

## Test Impact Analysis

1. **New tests enabled:** `lastProgressAt`'s lifecycle on `SubagentState` and its stamping in `record-observer` become unit-testable in isolation; the bounded wait is testable through `GetResultTool.execute` with fake timers and a real `Subagent` built by `createTestSubagent`.
2. **Redundant tests:** none; the existing wait tests pin the unbounded path, which must stay.
3. **Tests that stay as-is:** the "carrier claim" and "a wait a resume superseded" describes in `get-result-tool.test.ts` pin the claim/consume/release semantics the bound reuses; `get-result-report.test.ts`'s `renderReportBody` running assertion (`toBe("Agent is still running…")`) stays correct because the progress line lives in `formatAgentReport`.
   The tidy-first assessor found no exact `formatAgentReport` assertion on a running report and no `toEqual` on an `AgentReport` that the optional fields would break; `makeReport` takes `Partial<AgentReport>`.

## Invariants at risk

- **Phase 22 delivery semantics** (a wait claims the outcome; an unsettled wait releases only its own claim; consumption is marked only on `settled`): pinned by `get-result-tool.test.ts` "releases the claim when the parent turn is interrupted mid-wait" and "leaves another carrier's claim in place…".
  The expiry test in step 7 adds the same assertions for the timer path (`record.claimed === false`, not consumed).
  Constituency: the completion nudge, which must announce an outcome an expired wait did not collect.
- **`waitUntilSettled` never cancels the child** (its doc comment): step 7 asserts the child's session `abort` was not called and the status is still `running` after expiry.
  Constituency: the parent model, which the description now promises this to.
- **Decision 0005's snapshot policy:** pinned by `test/service/service-adapter.test.ts`, which is predicted unchanged and must stay green unmodified.
- **The unbounded default:** the existing "waits for promise when wait=true and agent is running" and "waits for a queued agent when wait=true" tests run without `timeout` and must pass unmodified.

## TDD Order

1. **`test(pi-subagents): add a shared textOf helper for tool-result text`** (roadmap ride-along).
   Add `test/helpers/text-of.ts` and `text-of.test.ts`, migrate the 102 `result.content[0].text` reads across the five tool test files and the local `textOf` in `notify-parent-tool.test.ts`.
   Prepares the friction of adding more reads to `get-result-tool.test.ts`.
   Verify: `grep -rho 'result\.content\[0\]' packages/pi-subagents/test/tools | wc -l` prints `0`; the full suite and `pnpm --filter @gotgenes/pi-subagents run check` pass.
   Killing mutation: make `textOf` return `""` unconditionally; the helper's own test and the migrated assertions go red.
2. **`refactor(pi-subagents): name get_subagent_result's parameter type`.**
   Extract `GetResultParams` and use it at the three sites in `get-result-tool.ts`, so `timeout` is later a one-line addition.
   No new tests; suite and `check` stay green.
3. **`refactor(pi-subagents): extract get_subagent_result's wait into its own method`.**
   Move the `if (params.wait === true) { … } else if (!record.isActive()) { … }` block into a private method returning what `execute` needs (`superseded`), with its comment.
   Prepares the friction of adding a timer, combined signal, and `finally` inline in `execute`.
   No new tests; the "carrier claim" and "superseded" describes cover it.
4. **`refactor(pi-subagents): record when a subagent last made progress`.**
   `SubagentState`: `_lastProgressAt` with its whole lifecycle (set at construction from `init.lastProgressAt ?? startedAt`, reset in `markRunning` and `resetForResume`, stamped by `markProgress(at = Date.now())`, read via `lastProgressAt`); `Subagent.lastProgressAt` read-through; `TestSubagentOptions.lastProgressAt?`.
   Tests in a new `describe("lastProgressAt")` in `subagent-state.test.ts`: seeded from `startedAt`; seeded from an explicit init; `markProgress(t)` sets it; `markRunning(t)` and `resetForResume(t)` reset it to `t` after a later stamp.
   Killing mutations: make `markProgress` a no-op (kills the stamp test); delete the reset line in `resetForResume` (kills the resume test only); delete it in `markRunning` (kills the running test only).
   `refactor:` because nothing reads it yet.
5. **`refactor(pi-subagents): stamp progress on every child session event`.**
   `subscribeSubagentObserver` calls `state.markProgress()` first in its callback.
   Test: `it.each` over `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `message_update` (text delta), `message_end`, and `turn_end` (which the observer otherwise ignores), each under fake timers asserting `state.lastProgressAt` equals the advanced clock.
   Killing mutation: move `state.markProgress()` inside the `tool_execution_end` branch; every case except `tool_execution_end` goes red.
6. **`feat(pi-subagents): report a running agent's activity, turns, and last progress in get_subagent_result`.**
   `AgentReport.progress?`, rendered by `formatAgentReport`; `buildReport` fills it only when `outcome.status === "running"`.
   `get-result-report.test.ts`: the line renders with all three parts; omits `Turns:` when `turns` is undefined; absent when `progress` is undefined.
   `get-result-tool.test.ts` (new `describe("progress")`, fake timers): a running record with `activeTools: ["bash"]`, a turn budget of 7 used, and `lastProgressAt` 72s in the past reports `Progress: running command… | Turns: 7 | Last progress: 72.0s ago`; a completed record's report has no `Progress:` line; a superseded wait's report has none.
   Killing mutations: drop the line in `formatAgentReport` (kills the report tests and the running tool test); build `progress` regardless of status (kills the completed and superseded tests); pass `record.startedAt` instead of `record.lastProgressAt` (kills the running tool test, given a fixture whose two times differ).
7. **`feat(pi-subagents): let get_subagent_result bound its wait with a timeout`.**
   Schema `timeout`, validation, the timer-backed signal inside the step-3 method with `finally` cleanup, `waitExpiredAfter` in the report, description and parameter text, `renderCall`'s `waiting ≤Ns`.
   Tests in a new `describe("bounded wait")` with fake timers and a record whose run handle never settles until the test resolves it (`Promise.withResolvers`):
   - expiry: advance 120 000 ms; the call resolves; text contains the expiry note and `Progress:`; `record.status` is `running`; `record.claimed` is `false`; the outcome is not consumed; the child session's `abort` was not called;
   - before the bound: after advancing 119 999 ms the call has not resolved (assert with a settled flag, not a tick sleep);
   - settles first: resolve the run at 10 s; the report is the completed outcome with no expiry note; `vi.getTimerCount()` is `0`;
   - interrupt: abort the parent signal with `timeout: 120`; no expiry note;
   - `timeout` without `wait`: returns immediately with no expiry note;
   - invalid: `0`, `-1`, `NaN`, and `2_147_484` each reject with `Invalid timeout`;
   - description: the tool definition's `description` and the `timeout` parameter description both state that the wait does not stop the agent;
   - `renderCall` with `wait: true, timeout: 120` names `waiting ≤120s`.
   Killing mutations: pass `signal` instead of the bound's signal (kills expiry); set `waitExpiredAfter` on every `unsettled` wait (kills interrupt); remove the `finally` cleanup (kills `getTimerCount`); call `record.abort()` on expiry (kills the still-running assertion); remove the validation (kills invalid).
8. **`docs(pi-subagents): document get_subagent_result's timeout and progress line`.**
   README `### get_subagent_result` row and sentence; ADR 0005 Consequences sentence; architecture `✅` heading mark, `Landed:` note, `S947` Mermaid node, `get-result-tool.ts` module-tree line, and the re-measured `result.content[0]` row.

## Risks and Mitigations

- **Poll churn:** a model can loop on a short timeout, paying one turn per expiry.
  Mitigation: no default (opt-in), and the expiry note plus parameter description tell the model not to re-wait on unchanged progress.
- **Semantic confusion with `bash`'s timeout:** a model may read "timed out" as "aborted".
  Mitigation: the description, the parameter text, and the expiry note each say the agent was not stopped (step 7 pins the text).
- **Timer leak:** a forgotten `clearTimeout` would hold the event loop and fire into a finished call.
  Mitigation: `finally` cleanup, pinned by `vi.getTimerCount()` in step 7.
- **Parent-signal listener leak** on a long-lived parent signal across many bounded waits.
  Mitigation: the bound removes its listener in `dispose()` (the `settleOrAbort` pattern), alongside the timer.
- **[#1051] reshapes the wait next:** it moves the outcome onto a per-run object and rewrites `get-result-tool.ts`'s wait.
  Mitigation: the bound only swaps the signal handed to `waitUntilSettled`, so it survives that rewrite; `resetForResume` gains one reset line that [#1051] carries with the rest.

## Open Questions

- Whether a future `onUpdate` stream during a wait is worth adding for the human (deferred; no issue filed, since the widget already covers it).

[#722]: https://github.com/gotgenes/pi-packages/issues/722
[#735]: https://github.com/gotgenes/pi-packages/issues/735
[#755]: https://github.com/gotgenes/pi-packages/issues/755
[#912]: https://github.com/gotgenes/pi-packages/issues/912
[#1049]: https://github.com/gotgenes/pi-packages/issues/1049
[#1051]: https://github.com/gotgenes/pi-packages/issues/1051
