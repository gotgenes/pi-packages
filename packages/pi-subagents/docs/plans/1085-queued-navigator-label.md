---
issue: 1085
issue_title: "pi-subagents: /subagents:sessions labels a queued resume's queue time as running"
---

# Label a queued resume's navigator entry with its time in the queue

## Release Recommendation

**Release:** ship independently

This issue's roadmap step (Phase 23, after [#1080]) is tagged `Release: independent`, and the phase has no release batches.
The behavior change is one `fix(pi-subagents):` commit that changes only the text of the `/subagents:sessions` picker label, so the release is a patch.

## Problem Statement

A resume started at `maxConcurrent` capacity waits in the `queued` status until the limiter admits it.
Its record keeps the prior run's live session, so the `/subagents:sessions` picker lists it as a live entry, and the label calls its time in the queue running time: `Agent (Test task) · 3 tools · queued · 3.0s (running)`.
A resume stopped before the limiter admitted it keeps the same figure without the suffix (`stopped · 3.0s`), presenting the time it waited as the run's duration.
[#1080] fixed the same defect in `get_subagent_result` with a private `formatRunDuration` and left the navigator, the shared `formatDuration`'s other caller, to this issue.

## Goals

- A queued resume's navigator label renders its duration segment as `queued <seconds>`, reusing [#1080]'s wording: `… · queued · queued 3.0s` (operator decision).
- A resume stopped while queued renders `… · stopped · queued 3.0s`, frozen at the stop, whether its entry is live or an in-memory released snapshot.
- The decision lives in one exported `formatRunDuration` in `src/ui/display.ts`, called by both `get_subagent_result` and the navigator, so the two carriers cannot diverge.
- Every run that started keeps today's label byte for byte.
- Non-breaking: the label is display text, and `formatDuration` was never part of a public entry.

## Non-Goals

- The persisted (post-`/reload`) snapshot row of a resume stopped while queued, which still reads `stopped · 3.0s · session released (snapshot)` because the `subagents:record` entry does not record `stoppedWhileQueued`.
  Filed as [#1086] (operator decision) and recorded as the Phase 23 step after this one; this plan passes `stoppedWhileQueued: false` for persisted runs at the `listNavigableAgents` call site, which [#1086] removes.
- A label-specific branch that drops the repeated `queued` word (`· queued 3.0s`); the operator chose the shared wording over it.
- A lifecycle-owned timing type that `RunOutcome` extends: `RunTiming` is the formatter's narrow read-side view, and `subagent-run.ts` is otherwise untouched.
- The persisted entry's last-wins replacement of a resumed agent's earlier run record.

## Background

- `src/ui/session-navigation.ts` — `listNavigableAgents` labels each in-memory record live (session ready) or as a snapshot (released, has `outputFile`), then each persisted run the manager no longer holds as a snapshot.
  All three paths call the private `buildLabel(fields: LabelFields, registry, released)`, which renders `formatDuration(fields.startedAt, fields.completedAt)`.
  `NavigableSubagent` is the record view the navigator reads; `Subagent` satisfies it structurally (`session-navigator.ts` passes `manager.listAgents()`), and `makeNavigable` (`test/helpers/make-navigable.ts`) is the only literal construction of it in `src/` or `test/`.
- `src/ui/display.ts` — `formatDuration(startedAt, completedAt?)` returns `formatMs(completedAt - startedAt)`, or `formatMs(Date.now() - startedAt) + " (running)"` when `completedAt` is unset.
  Its only callers are `session-navigation.ts` and `get-result-tool.ts`'s `formatRunDuration`; nothing outside the package imports it, and no test calls it directly.
- `src/tools/get-result-tool.ts` — the private `formatRunDuration(outcome: RunOutcome)` renders `queued ${formatMs((completedAt ?? Date.now()) - startedAt)}` when `status === "queued" || stoppedWhileQueued`, otherwise `formatDuration(...)`; `buildReport` and `buildGetResultDetails` both call it.
- `src/lifecycle/subagent.ts` — `resume()` builds the resume's run, born `queued`, before `schedule` admits it, and `SubagentRun`'s `startedAt` defaults to construction time until `start()` overwrites it.
  The record exposes `stoppedWhileQueued` as a getter over its current run, and `stopQueued()` sets it only when the run is still queued.
- Zone check: `pnpm --silent fallow guard packages/pi-subagents/src/ui/display.ts` lists `pi-subagents/lifecycle` among the zones `ui` may import, and `display.ts` already imports `#src/lifecycle/turn-limits`; `lifecycle/subagent-state.ts` imports only `lifecycle/usage`, so a type import of `SubagentStatus` adds no cycle.

## Design Overview

### Observed scenario (the operator's terms)

Measured with a disposable Vitest spike, deleted after the run.
It drove a real `Subagent` (`createTestSubagent` with a stub session from `createSubagentSessionStub`) through `resume()` behind a `gatedScheduler` that never opens, then `stopQueued()`, and labeled each state with the real `listNavigableAgents`.
The persisted row round-trips the record through `toPersistedRecord` and `readPersistedRuns`.
Times are fake-timer seeded (n=1 per row; the path is deterministic), so the input is a fixture driving production classes, not a live session.

| Scenario                                   | Label today                                             | Label after                 |
| ------------------------------------------ | ------------------------------------------------------- | --------------------------- |
| Completed (control)                        | `Agent (Test task) · 3 tools · completed · 0.8s`        | unchanged                   |
| Queued resume (live)                       | `Agent (Test task) · 3 tools · queued · 3.0s (running)` | `… · queued · queued 3.0s`  |
| Resume stopped while queued (live)         | `Agent (Test task) · 3 tools · stopped · 3.0s`          | `… · stopped · queued 3.0s` |
| Same, after `/reload` (persisted snapshot) | `… · stopped · 3.0s · session released (snapshot)`      | unchanged ([#1086])         |

The spike's in-memory released row came back unlisted because the stub session has no `outputFile`; that path is covered by a `makeNavigable` fixture instead (Step 2).

### One decision, two carriers

`formatRunDuration` moves into `src/ui/display.ts` beside `formatMs`, exported over a narrow read-side type, and `formatDuration` becomes module-private below it:

```typescript
/** The run facts a duration reads. `RunOutcome` and a navigator record both satisfy it. */
export interface RunTiming {
  readonly status: SubagentStatus;
  readonly startedAt: number;
  readonly completedAt: number | undefined;
  readonly stoppedWhileQueued: boolean;
}

/** A started run's duration; for a run the limiter never admitted, its time in the queue. */
export function formatRunDuration(run: RunTiming): string {
  if (run.status === "queued" || run.stoppedWhileQueued) {
    return `queued ${formatMs((run.completedAt ?? Date.now()) - run.startedAt)}`;
  }
  return formatDuration(run.startedAt, run.completedAt);
}
```

`RunTiming` carries exactly the four fields the function reads.
`get-result-tool.ts` keeps its two call sites verbatim, now importing the function; `RunOutcome` satisfies `RunTiming` structurally.

The navigator's side:

```typescript
interface LabelFields extends RunTiming {
  readonly type: SubagentType;
  readonly description: string;
  readonly toolUses: number;
}

// buildLabel
const duration = formatRunDuration(fields);

// listNavigableAgents, persisted loop: the entry does not record it yet (#1086)
label: buildLabel({ ...run, stoppedWhileQueued: false }, registry, true)
```

`NavigableSubagent` gains `readonly stoppedWhileQueued: boolean`, so the live and in-memory snapshot paths pass the record straight through.

### Edge cases and where each is pinned

| Case                                              | Rendering                                                            | Pinned in                                                         |
| ------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Queued resume, live entry                         | `queued · queued <now − enqueue>`                                    | Step 2                                                            |
| Stopped while queued, live entry                  | `stopped · queued <stop − enqueue>`, not growing                     | Step 2                                                            |
| Stopped while queued, in-memory released snapshot | `stopped · queued <stop − enqueue> · session released (snapshot)`    | Step 2                                                            |
| Persisted resume stopped while queued             | `stopped · <stop − enqueue> · session released (snapshot)` (today's) | Step 2, pinned as current until [#1086]                           |
| A started run, completed                          | `formatDuration`, unchanged                                          | Step 1 (unit) and the existing `builds a label…` test             |
| A started run, still running                      | `<now − start> (running)`, unchanged                                 | Step 1 (unit); no test pins it today                              |
| `get_subagent_result` Duration stat               | unchanged from [#1080]                                               | existing `describe("Duration stat")` in `get-result-tool.test.ts` |

A queued initial spawn has no session and no `outputFile`, so it is not listed; that is existing behavior and not pinned anew.

## Module-Level Changes

- `src/ui/display.ts` — add `RunTiming` and exported `formatRunDuration` (with its doc comment from `get-result-tool.ts`); `formatDuration` loses `export` and sits below `formatRunDuration`; add `import type { SubagentStatus } from "#src/lifecycle/subagent-state"`.
- `src/tools/get-result-tool.ts` — remove the private `formatRunDuration` and the `formatDuration` import; import `formatRunDuration` from `#src/ui/display` (`formatMs` stays, still used by `progressOf`); `RunOutcome` stays imported (the `buildGetResultDetails` parameter and an interface field still use it).
- `src/ui/session-navigation.ts` — `NavigableSubagent` gains `stoppedWhileQueued`; `LabelFields` extends `RunTiming`; `buildLabel` calls `formatRunDuration`; the persisted loop passes `{ ...run, stoppedWhileQueued: false }` with a one-line comment naming the entry's missing field; the `#src/ui/display` import swaps `formatDuration` for `formatRunDuration` and `type RunTiming`.
- `test/display.test.ts` — new `describe("formatRunDuration")` (Step 1).
- `test/helpers/make-navigable.ts` — default `stoppedWhileQueued: false`.
- `test/ui/session-navigation.test.ts` — new `describe("a run the limiter never admitted")` inside `describe("listNavigableAgents")` (Step 2).
- `docs/architecture/architecture.md` — at implementation completion: `✅` on the `#### [#1085]` heading and the `S1085` Mermaid node, and a `Landed:` note naming the shared `formatRunDuration` in `src/ui/display.ts` and the persisted row left to [#1086].

Predicted unchanged:

- `src/ui/session-navigator.ts` — passes `Subagent[]` as `NavigableSubagent[]`, and `Subagent` already has the `stoppedWhileQueued` getter.
- `test/tools/get-result-tool.test.ts`, `test/tools/get-result-report.test.ts` — the report's output is unchanged by the move.
- `test/helpers/make-navigable.test.ts` — asserts individual default fields, not the whole shape.
- `test/ui/session-navigator.test.ts` — builds its records through `makeNavigable`; every fixture there is a started run.
- `src/persisted-record.ts`, `test/persisted-record.test.ts` — [#1086]'s.
- The module-tree entries for `display.ts` ("pure formatters and shared types") and `session-navigation.ts` stay accurate; `README.md`, `docs/*.md`, and `.pi/skills/package-pi-subagents/SKILL.md` name neither `formatDuration` nor the label's duration (grepped).
- [#1080]'s `Landed:` note, which records `formatRunDuration` in `get-result-tool.ts` as of that step; [#1085]'s `Landed:` note records the move.

## Test Impact Analysis

1. New tests the move enables: direct unit tests of the duration decision in `test/display.test.ts`, including the still-running `(running)` arm, which no test pins today; and the navigator label for a queued and a stopped-while-queued run, which needed the shared helper to reach.
2. Redundant tests: none removed.
   The `get-result-tool.test.ts` `Duration stat` tests now overlap the unit tests on the decision, but they are the only pins that both builders call the helper (report text and `details.duration`), so they stay.
3. Stay as-is: the existing `listNavigableAgents` label tests (`builds a label…`, the released and persisted snapshot labels) are the started-run controls for Step 2.

## Invariants at risk

- [#1080]'s Outcome ("a queued agent's report, and that of a run stopped while queued, does not label its time in the queue as running time") — pinned by the four `describe("Duration stat")` tests in `test/tools/get-result-tool.test.ts`, which drive the real `GetResultTool.execute`.
  Step 1 moves the code they pin; its killing mutation is applied at the new home, so a green suite there is a measurement of the relocated decision.
  Constituency: the parent agent reading `get_subagent_result`.
- [#1079]'s queued body and bounded-wait note — untouched; `formatRunDuration` renders only the stats segment.

## TDD Order

1. **`refactor(pi-subagents): share the run-duration decision from display.ts`**
   - Prepares Step 2: the navigator cannot reach the private helper today (Tidy-First assessor, Recommended).
   - Move `formatRunDuration` into `src/ui/display.ts` over `RunTiming` as sketched; make `formatDuration` module-private; update `get-result-tool.ts`'s imports.
     Re-read the moved code against the `code-design` skill before committing (stepdown order: `formatRunDuration` above `formatDuration`).
   - Tests (characterization, expected green on arrival): in `test/display.test.ts`, `describe("formatRunDuration")` with fake timers at `vi.setSystemTime(6_000)`:
     - a queued run (`startedAt: 1000`, `completedAt: undefined`) → exactly `"queued 5.0s"`;
     - a stopped-while-queued run (`status: "stopped"`, `stoppedWhileQueued: true`, `startedAt: 1000`, `completedAt: 4000`) → exactly `"queued 3.0s"`;
     - a completed run (`startedAt: 1000`, `completedAt: 4000`) → exactly `"3.0s"`;
     - a running run (`completedAt: undefined`) → exactly `"5.0s (running)"`.
   - Killing mutations (applied in `display.ts`, one per class):
     - drop `run.status === "queued" ||` — the queued unit test and the two queued `get-result-tool` `Duration stat` tests go red;
     - drop `|| run.stoppedWhileQueued` — the stopped unit test and the stopped `Duration stat` test go red;
     - replace `run.completedAt ?? Date.now()` with `Date.now()` — the stopped unit test goes red (`queued 5.0s`) and the stopped `Duration stat` test goes red (`queued 8.0s`);
     - in `formatDuration`, drop the `" (running)"` suffix — the running unit test goes red, nothing else.
   - Verify: `pnpm --filter @gotgenes/pi-subagents exec vitest run test/display.test.ts test/tools/get-result-tool.test.ts && pnpm --filter @gotgenes/pi-subagents run check`, then `pnpm fallow dead-code` (the now-private `formatDuration` must not be flagged; the removed export must not leave an orphan).
2. **`fix(pi-subagents): label a queued resume's navigator entry with its time in the queue`**
   - Red: in `test/ui/session-navigation.test.ts`, inside `describe("listNavigableAgents")`, add `describe("a run the limiter never admitted")` with `beforeEach` fake timers at `vi.setSystemTime(4_000)` and `afterEach(vi.useRealTimers)`:
     - a live queued record (`makeNavigable({ status: "queued", startedAt: 1000, completedAt: undefined, toolUses: 3, description: "Investigate the bug" })`) labels exactly `"Agent (Investigate the bug) · 3 tools · queued · queued 3.0s"`;
     - a live record stopped while queued (`status: "stopped"`, `stoppedWhileQueued: true`, `startedAt: 1000`, `completedAt: 2000`), read at 4_000, labels exactly `"… · stopped · queued 1.0s"` (frozen at the stop, not `3.0s`);
     - the same record released in memory (`isSessionReady: () => false`, `outputFile: "/tasks/q.jsonl"`) labels exactly `"… · stopped · queued 1.0s · session released (snapshot)"`;
     - a persisted run (`persistedRun({ status: "stopped", startedAt: 1000, completedAt: 2000 })`) labels exactly `"Agent (Earlier task) · 7 tools · stopped · 1.0s · session released (snapshot)"`, with a comment that [#1086] flips it.
   - Expected red: the first three fail on today's code (`3.0s (running)`, `1.0s`, `1.0s`); the persisted test passes (an invariant pin of the deferred row, checked by mutation below).
     The second and third need `stoppedWhileQueued` on `NavigableSubagent` to typecheck, which is part of Green.
   - Green: add `stoppedWhileQueued` to `NavigableSubagent` and the `makeNavigable` default; `LabelFields extends RunTiming`; `buildLabel` calls `formatRunDuration`; the persisted loop passes `{ ...run, stoppedWhileQueued: false }`.
   - Killing mutations:
     - in `buildLabel`, revert to `formatDuration(fields.startedAt, fields.completedAt)` (temporarily re-exported) — the first three tests go red, the persisted pin and the existing started-run label tests stay green;
     - in the live branch of `listNavigableAgents`, pass `{ ...record, stoppedWhileQueued: false }` — the live stopped test goes red only;
     - in the in-memory snapshot branch, pass `{ ...record, stoppedWhileQueued: false }` — the released stopped test goes red only;
     - in the persisted loop, pass `stoppedWhileQueued: true` — the persisted pin goes red (`stopped · queued 1.0s`), proving it is not a broken probe.
   - Verify: `pnpm --filter @gotgenes/pi-subagents exec vitest run test/ui/ test/helpers/make-navigable.test.ts && pnpm --filter @gotgenes/pi-subagents run check`, then the full suite, root `pnpm run lint`, and `pnpm fallow dead-code`.
3. **`docs(pi-subagents): land #1085 in the Phase 23 roadmap`**
   - `✅` on the `#### [#1085]` heading and the `S1085` Mermaid node; a `Landed:` note: the navigator labels a queued resume `queued · queued <seconds>` and a resume stopped while queued `stopped · queued <seconds>`, through `formatRunDuration`, now shared from `src/ui/display.ts` with `get_subagent_result`; the persisted row is [#1086]'s.

## Risks and Mitigations

- **The repeated word reads awkwardly** (`queued · queued 3.0s`).
  Accepted by the operator for one shared wording across carriers; a later label-only branch can merge the segments without touching the decision.
- **A `{ ...run }` spread in the persisted loop copies every `PersistedRunSummary` field into `buildLabel`.**
  `buildLabel` reads only `LabelFields`, and TypeScript accepts the wider object; the spread is a deliberate seam [#1086] deletes.
- **The spike's released in-memory row did not list** (stub session, no `outputFile`), so that row's label is pinned only by a `makeNavigable` fixture.
  The branch is the same `buildLabel(record, registry, true)` call the persisted test and the existing released test exercise; the mutation in Step 2 pins it separately.
- **A future pre-admission status** between `queued` and `running` would fall through to `formatDuration` and read `(running)` in both carriers at once; one site now, so one edit fixes both.

## Open Questions

- None; [#1086] owns the persisted row.

[#1079]: https://github.com/gotgenes/pi-packages/issues/1079
[#1080]: https://github.com/gotgenes/pi-packages/issues/1080
[#1086]: https://github.com/gotgenes/pi-packages/issues/1086
