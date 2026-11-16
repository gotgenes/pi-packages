---
issue: 1080
issue_title: "pi-subagents: get_subagent_result reports a queued agent's Duration as running time"
---

# Report a queued agent's time in the queue, not as running time

## Release Recommendation

**Release:** ship independently

This issue's roadmap step (Phase 23, after [#1079]) is tagged `Release: independent`, and the phase has no release batches.
The one code step is a `fix(pi-subagents):` commit that changes only the text of one tool's `Duration` stat, so the release is a patch.

## Problem Statement

A background agent spawned at `maxConcurrent` capacity waits in the `queued` status until a running agent frees a slot.
While it waits, `get_subagent_result` puts `Status: queued` and `Duration: 5.0s (running)` on the same stats line.
That contradicts the status, and the number is how long the run has sat in the queue, not how long it has run.
A run stopped before the limiter ever admitted it has the same defect in a quieter form: its report reads `Duration: 5.0s`, presenting the queue time as the run's duration, while its body says it never started.
[#1079] fixed the same report's body and bounded-wait note for a queued agent and left this stat to this issue.

## Goals

- A queued agent's `get_subagent_result` report and TUI details render its `Duration` stat as its time in the queue, worded `queued <seconds>` (e.g. `Duration: queued 5.0s`), never `(running)`.
- A run stopped while queued (`stoppedWhileQueued`) renders the same way, frozen at the time it was stopped.
- Every run that started keeps today's rendering byte for byte.
- Non-breaking: the stat is free text in the report and `GetResultDetails.duration` stays a `string`.

## Non-Goals

- The `/subagents:sessions` navigator label (`buildLabel` in `src/ui/session-navigation.ts`), which also calls `formatDuration` and reads `queued · 3.0s (running)` for a queued resume.
  Filed as [#1085] and recorded as the Phase 23 step after this one (operator decision).
- Changing the shared `formatDuration` in `src/ui/display.ts` (predicted unchanged, see Module-Level Changes).
- A `neverStarted`-style predicate on `RunOutcome`: it would have one caller, and every other site branches on `queued` and `stoppedWhileQueued` as separate arms (`get-result-report.ts`, `outcome-delivery.ts`, `notification.ts`).
- The `buildReport`/`buildGetResultDetails` field-mapping overlap (already a recorded deferred tidying under [#947]).
- The widget's per-agent rows: a queued agent is a count there, not a row.

## Background

- `src/tools/get-result-tool.ts` — `GetResultTool.buildReport` and `buildGetResultDetails` each set `duration: formatDuration(outcome.startedAt, outcome.completedAt)`, where `outcome` is the collected `RunOutcome`.
  `formatMs` is already imported from `#src/ui/display`; private helpers (`progressOf`, `buildPreview`) sit below the class.
- `src/ui/display.ts` — `formatDuration(startedAt, completedAt?)` returns `formatMs(completedAt - startedAt)`, or `formatMs(Date.now() - startedAt) + " (running)"` when `completedAt` is unset.
- `src/lifecycle/subagent-run.ts` — a run's `startedAt` defaults to `Date.now()` at construction and `start()` overwrites it when the limiter admits the run.
  Both a spawn and a resume construct their run when they enqueue it, so for a never-admitted run `startedAt` is its enqueue time.
  `stopQueued()` sets `stoppedWhileQueued` only when the status is still `queued`, then `markStopped()` sets `completedAt`; the two conditions are therefore mutually exclusive (`stoppedWhileQueued` implies `status === "stopped"`).
- `src/tools/get-result-report.ts` renders `Duration: ${report.duration}` verbatim in `renderStatsParts`; `src/tools/get-result-renderer.ts` pushes `details.duration` verbatim as the collapsed row's last stat, after a status glyph (the status word itself is not on that row).
- The never-started `<task-notification>` (`formatNeverStartedNotification` in `src/observation/notification.ts`) already omits a duration for a run stopped while queued.
- Only `get_subagent_result` can observe a still-queued run: the foreground carriers render after `await record.promise` and the nudge fires on a terminal status ([#1079]'s finding).

## Design Overview

### Observed scenario (the parent's terms)

Measured with a disposable spike that called the real `GetResultTool.execute` (n=1 per row; the path is deterministic): a `createTestSubagent` with `status: "queued"`, `result`/`completedAt` unset, and `startedAt` 5 s in the past, behind a `gatedScheduler` whose slot never opens.
The input is a test fixture, not a live session, but it drives the production tool, run, and scheduler classes end to end.

| Scenario                              | Stats line today                                                  | `details.duration` today |
| ------------------------------------- | ----------------------------------------------------------------- | ------------------------ |
| Queued, no wait                       | `Status: queued \| … \| Duration: 5.0s (running)`                 | `5.0s (running)`         |
| Queued, `wait: true, timeout: 5`      | `Status: queued \| … \| Duration: 10.0s (running)`                | `10.0s (running)`        |
| Stopped while queued (`stopQueued()`) | `Status: stopped (stopped — user request) \| … \| Duration: 5.0s` | `5.0s`                   |

After the change, the three rows read `Duration: queued 5.0s`, `Duration: queued 10.0s`, and `Duration: queued 5.0s`, with `details.duration` the same string minus the label.

### One helper, both builders

The decision lives at the report's call site, in one private module function below the class, and both builders call it:

```typescript
/** A started run's duration; for a run the limiter never admitted, its time in the queue. */
function formatRunDuration(outcome: RunOutcome): string {
	if (outcome.status === "queued" || outcome.stoppedWhileQueued) {
		return `queued ${formatMs((outcome.completedAt ?? Date.now()) - outcome.startedAt)}`;
	}
	return formatDuration(outcome.startedAt, outcome.completedAt);
}
```

```typescript
// buildReport and buildGetResultDetails
duration: formatRunDuration(outcome),
```

`completedAt ?? Date.now()` makes a still-queued run's figure grow with each call and a stopped-while-queued run's figure freeze at its stop.
The wording is the same for both (operator decision): the status line and the body already distinguish a run still waiting from one stopped before it started.
The helper takes `RunOutcome` and reads four of its fields; it is private, so a `Pick<>` would add no seam a caller uses.

### Edge cases and where each is pinned

| Case                             | Rendering                                                                               | Pinned in                                              |
| -------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Queued, read without waiting     | `queued <now − enqueue>`                                                                | Step 1, report and details tests                       |
| Stopped while queued, read later | `queued <stop − enqueue>`, not growing                                                  | Step 1, stopped test (reads 3 s after the stop)        |
| A started run (completed)        | unchanged: `formatDuration`                                                             | Step 1, control test                                   |
| Queued, bounded wait expires     | `queued <now − enqueue>`                                                                | Same code path as the first row; not separately pinned |
| A queued run admitted later      | `start()` overwrites `startedAt`, status becomes `running`, so `formatDuration` resumes | Existing code, no change                               |

## Module-Level Changes

- `src/tools/get-result-tool.ts` — add `formatRunDuration(outcome: RunOutcome)` below the class (after `progressOf`); `buildReport` and `buildGetResultDetails` call it in place of `formatDuration(...)`.
  The `formatDuration` import stays (the helper calls it).
- `test/tools/get-result-tool.test.ts` — inside `describe("GetResultTool") > describe("a queued agent")`, a nested `describe("Duration stat")` with fake timers (`vi.useFakeTimers()`, `vi.setSystemTime(6_000)`; `queuedAgent()`'s `startedAt` defaults to `1000`) holding the Step 1 tests.
- `test/tools/get-result-report.test.ts` — the queued bounded-wait fixture's `duration: "130.0s (running)"` and its expected `Duration: 130.0s (running)` become `"queued 130.0s"` / `Duration: queued 130.0s`.
  `formatAgentReport` renders the string verbatim, so this passes either way; it is updated so no fixture pairs `queued` with a shape production no longer emits.
- `docs/architecture/architecture.md` — at implementation completion: `✅` on the `#### [#1080]` heading and its Mermaid node (`S1080`), its `Outcome:` widened to name a run stopped while queued, and a `Landed:` note.

Predicted unchanged:

- `src/ui/display.ts` — `formatDuration` keeps its signature and output; `session-navigation.ts` is its other caller and is [#1085]'s.
- `src/tools/get-result-renderer.ts`, `test/tools/get-result-renderer.test.ts` — `details.duration` is an opaque pre-formatted string, and the renderer's fixture (`"213.0s"`) is a started run's.
- `src/tools/get-result-report.ts` — `renderStatsParts` already renders `report.duration` verbatim.
- `README.md`, `docs/*.md`, `.pi/skills/package-pi-subagents/SKILL.md` — grep for `Duration` / `(running)` / `formatDuration` finds no live description of the stat.

## Test Impact Analysis

1. New tests: the queued and stopped-while-queued renderings through `GetResultTool.execute`, both the report text and `details.duration`; a started-run control.
2. Redundant tests: none; no existing test asserts the duration of a queued run through the tool (the tool test's superseded-wait case says duration is deliberately not checked).
3. Stay as-is: the [#1079] queued-body and queued bounded-wait tests in `get-result-tool.test.ts` assert body and note substrings, not the stats line.

## Invariants at risk

- [#1079]'s Outcome ("a queued agent's report says it is waiting for a concurrency slot and has not started, and points at `wait: true`") — pinned by `get-result-tool.test.ts` (`a queued agent` › says it has not started…) and the exact-text queued bounded-wait test in `get-result-report.test.ts`, which this plan edits only in its `Duration` fixture string.
  Constituency: the parent agent reading the report; the change touches only the stats segment.
- [#947]'s progress line appears only for `running` (`progress: outcome.status === "running" ? …`); `formatRunDuration` does not touch it.

## TDD Order

1. **`fix(pi-subagents): show a queued agent's Duration as its time in the queue`**
   - Red: in `test/tools/get-result-tool.test.ts`, under `describe("a queued agent")`, add `describe("Duration stat")` with `beforeEach` fake timers at `vi.setSystemTime(6_000)` and `afterEach(vi.useRealTimers)`:
     - a queued agent's report contains `| Duration: queued 5.0s\n` and not `(running)`;
     - its `details.duration` is exactly `"queued 5.0s"`;
     - a run stopped while queued (`record.stopQueued()` at 6_000, then `vi.setSystemTime(9_000)`) reports `| Duration: queued 5.0s\n` and `details.duration` `"queued 5.0s"`;
     - control: a completed `createTestSubagent()` (startedAt 1000, completedAt 2000) reports `| Duration: 1.0s\n` and `details.duration` `"1.0s"`.
   - Expected red: the three queued/stopped tests fail on today's code (`5.0s (running)` / `5.0s`); the control passes (an invariant pin, checked by mutation below).
   - Green: add `formatRunDuration` and call it from both builders; update the `get-result-report.test.ts` queued fixture string to `queued 130.0s`.
   - Killing mutations (one per class):
     - drop `outcome.status === "queued" ||` from the condition — the two queued tests go red, the stopped and control tests stay green;
     - drop `|| outcome.stoppedWhileQueued` — the stopped test goes red only;
     - replace `outcome.completedAt ?? Date.now()` with `Date.now()` — the stopped test goes red (`queued 8.0s`), the queued tests stay green;
     - change the condition to `true` — the control goes red (`queued 1.0s`);
     - in `buildGetResultDetails` only, revert to `formatDuration(outcome.startedAt, outcome.completedAt)` — the `details.duration` assertions go red, the report-text ones stay green.
   - Verify: `pnpm --filter @gotgenes/pi-subagents exec vitest run test/tools/get-result-tool.test.ts test/tools/get-result-report.test.ts && pnpm --filter @gotgenes/pi-subagents run check`, then the full suite.
2. **`docs(pi-subagents): land #1080 in the Phase 23 roadmap`**
   - `✅` on the `#### [#1080]` heading and the `S1080` Mermaid node; widen its `Outcome:` to a run stopped while queued; add a `Landed:` note naming `formatRunDuration` and the `queued <seconds>` wording.

## Risks and Mitigations

- **A fake-timer test hides the real enqueue time.**
  The fixture's `startedAt` is seeded, and so was the planning spike's; that a never-admitted run's `startedAt` is its enqueue time rests on reading `subagent-run.ts` (the constructor's `Date.now()` default, overwritten only by `start()`) and `Subagent.resume` (the run is built before `schedule` is called), not on a measurement.
- **Repeated `queued`.**
  The report line reads `Status: queued | … | Duration: queued 5.0s`; the operator chose this wording over relabeling the stat, which would need an `AgentReport` shape change, and in the TUI's collapsed row the status is only a glyph, so the word there is new information.
- **A future status between `queued` and `running`.**
  The condition is explicit on `queued`; a new pre-admission status would fall through to `formatDuration` and read `(running)` again, which is the same silent pass-through `renderOutcomeBody` has; noted, not mitigated.

## Open Questions

- Whether [#1085]'s navigator label adopts the same `queued <seconds>` wording, and whether the decision then moves to a shared home, is that step's call.

[#947]: https://github.com/gotgenes/pi-packages/issues/947
[#1079]: https://github.com/gotgenes/pi-packages/issues/1079
[#1085]: https://github.com/gotgenes/pi-packages/issues/1085
