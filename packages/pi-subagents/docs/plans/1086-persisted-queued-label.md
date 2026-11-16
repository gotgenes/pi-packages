---
issue: 1086
issue_title: "pi-subagents: /subagents:sessions labels a reloaded resume stopped while queued with its queue time"
---

# Label a reloaded resume stopped while queued with its time in the queue

## Release Recommendation

**Release:** ship independently

This issue's roadmap step (Phase 23, after [#1085]) is tagged `Release: independent`, and the phase has no release batches.
The behavior change is one `fix(pi-subagents):` commit that changes the text of one `/subagents:sessions` picker row and adds a field to an internal session entry, so the release is a patch.

## Problem Statement

After a `/reload` (or a `/resume` of the parent session), the manager no longer holds the runs it spawned, so the `/subagents:sessions` picker labels them from the parent session's `subagents:record` entries.
For a resume that was stopped before the limiter admitted it, that row reads `Agent (Test task) · 3 tools · stopped · 3.0s · session released (snapshot)`, presenting the time it waited as the run's duration.
The same run, still held in memory, already reads `stopped · queued 3.0s` since [#1085].
The entry never records `stoppedWhileQueued`, so the reader cannot tell a run the limiter never admitted from one that ran, and [#1085] left a `stoppedWhileQueued: false` adapter at the `listNavigableAgents` call site for this issue to remove.

## Goals

- A persisted resume stopped while queued is labeled `… · stopped · queued 3.0s · session released (snapshot)`, the same duration wording as its in-memory row.
- `PersistedSubagentRecord` and `PersistedRunSummary` carry `stoppedWhileQueued: boolean`; `toPersistedRecord` copies it, and `asRunSummary` validates it.
- An entry written before the field existed reads as `stoppedWhileQueued: false`, so every pre-upgrade row keeps today's label byte for byte.
- The `{ ...run, stoppedWhileQueued: false }` adapter and its `(#1086)` comment leave `listNavigableAgents`.
- Non-breaking: the field is additive on an internal session entry, an older reader ignores it, and no row written before the upgrade changes its label.

## Non-Goals

- `SubagentRecord` (the public snapshot) keeps declining `stoppedWhileQueued`, per `docs/decisions/0005-subagent-record-admission-policy.md`; the `subagents:record` entry is a separate, package-internal contract, and `test/service/service-adapter.test.ts` keeps pinning the snapshot's refusal.
- An initial run stopped while queued: its entry now records `stoppedWhileQueued: true` too, but it never had a session, so its `outputFile` is undefined and `listNavigableAgents` does not list it.
  No row changes for it.
- Back-filling old entries: a pre-upgrade entry for a resume stopped while queued keeps reading `stopped · 3.0s`, since the fact was never written.
- A shared optional-field guard in `asRunSummary`: the new guard normalizes absence to `false`, unlike the `completedAt`/`outputFile` guards, which pass `undefined` through (the Tidy-First assessor rejected the helper as a wrong abstraction).
- Unifying the three persisted-run fixtures across `persisted-record.test.ts`, `session-navigation.test.ts`, and `session-navigator.test.ts`; they have different shapes (full record, summary, raw entry data).

## Background

- `src/persisted-record.ts` owns the `subagents:record` entry on both sides.
  `toPersistedRecord` copies an allowlist of fields off a `Subagent` (which satisfies `PersistedSubagentRecord` structurally); `readPersistedRuns` reads every entry through `asRunSummary`, a tolerant parser that reconstructs only the fields `PersistedRunSummary` picks, so a field the writer adds is dropped on read unless the parser names it.
- The writer: `Subagent.stopQueued()` (`src/lifecycle/subagent.ts`) stops the current run and fires `onRunFinished`, which reaches `SubagentEventsObserver.persistAndNotify` (`src/observation/subagent-events-observer.ts`), which appends `toPersistedRecord(record)`.
  `Subagent` already exposes `get stoppedWhileQueued()`, delegating to the current run, so the call site compiles unchanged once the interface gains the field.
- The trigger: `SessionNavigatorHandler.handle` (`src/ui/session-navigator.ts`) passes `readPersistedRuns(sessionEntries)` to `listNavigableAgents`, whose persisted loop labels every run the manager no longer holds; after a `/reload` that is every run.
- `buildLabel` reads `LabelFields extends RunTiming` (`src/ui/display.ts`), which already requires `stoppedWhileQueued: boolean`; `formatRunDuration` renders `queued <seconds>` for a run that is queued or was stopped while queued.
- A resumed agent appends a second entry under the same id, and the last one wins, so a later resume that ran overwrites an earlier stopped-while-queued entry with `stoppedWhileQueued: false`.

## Design Overview

The evidence is the code trace above plus the issue's spike, which drove a real `Subagent` through `resume()` behind a `gatedScheduler`, `stopQueued()`, then `toPersistedRecord` → `readPersistedRuns` → `listNavigableAgents` (fake timers, n=1, deterministic path, measured in [#1085]'s planning).
Both halves of the defect are literal in the source: `toPersistedRecord` has no `stoppedWhileQueued` line, and the persisted loop hard-codes `stoppedWhileQueued: false`.

### Contract shape

```typescript
export interface PersistedSubagentRecord {
  // …existing fields…
  /** Whether the run was stopped before the limiter admitted it. */
  readonly stoppedWhileQueued: boolean;
}

export type PersistedRunSummary = Pick<
  PersistedSubagentRecord,
  "id" | "type" | "description" | "status" | "startedAt" | "completedAt" | "stoppedWhileQueued" | "toolUses" | "outputFile"
>;
```

The writer always writes the field, `false` included, so the entry's key set does not depend on the outcome.

### Reader semantics

`asRunSummary` destructures `stoppedWhileQueued` with the other fields.

| Stored value     | Read as       | Why                                                                         |
| ---------------- | ------------- | --------------------------------------------------------------------------- |
| absent           | `false`       | written before the field existed; the run's label stays what it was         |
| `true` / `false` | itself        | written by this version                                                     |
| any non-boolean  | entry skipped | matches the file's convention for a malformed `completedAt` or `outputFile` |

The skip arm has no producer (only `toPersistedRecord` writes the entry), so it is a validation-edge guard, not a reachable path; it follows the existing convention rather than inventing a coercion.

### Navigator call site

```typescript
for (const run of persisted) {
  if (held.has(run.id) || !run.outputFile) continue;
  const label = buildLabel(run, registry, true);
  snapshots.push({ kind: "snapshot", outputFile: run.outputFile, heading: buildHeading(run, registry), label });
}
```

`PersistedRunSummary` now satisfies `LabelFields` directly, so the adapter goes and no new import edge appears (`session-navigation.ts` already imports `#src/persisted-record`).

### Edge cases stated as behavior

- A legacy entry (no field) reads `false` and keeps its label — Step 1 (`persisted-record.test.ts` legacy test, and the unchanged raw-entry block in `session-navigator.test.ts`).
- A non-boolean value skips the entry — Step 1.
- A stopped-while-queued record round-trips through writer and reader as `true` — Step 1.
- A persisted run stopped while queued is labeled `queued <seconds>` — Step 1 (`session-navigation.test.ts` flipped test, and a new raw-entry case in `session-navigator.test.ts`).

## Module-Level Changes

- `src/persisted-record.ts` — `PersistedSubagentRecord` gains `stoppedWhileQueued`; `PersistedRunSummary`'s `Pick` adds it; `toPersistedRecord` copies it; `asRunSummary` validates and normalizes it; the `readPersistedRuns` doc comment notes that an entry written before the field existed reads as not stopped while queued.
- `src/ui/session-navigation.ts` — the persisted loop passes `run` to `buildLabel` and loses the `(#1086)` comment.
- `test/persisted-record.test.ts` — the `persistedRecord()` fixture and the `summary` literal gain `stoppedWhileQueued: false`; the `toPersistedRecord` `toStrictEqual` gains the field; new tests for copying `true`, the legacy read, the non-boolean skip, and a stopped-while-queued round trip.
- `test/ui/session-navigation.test.ts` — `persistedRun()` gains `stoppedWhileQueued: false`; the test `labels a persisted resume stopped while queued from its entry, which does not record it` becomes `labels a persisted resume stopped while queued with the time it waited`, with `stoppedWhileQueued: true` and the expectation `… · stopped · queued 1.0s · session released (snapshot)`, and loses its `(#1086)` comment.
- `test/ui/session-navigator.test.ts` — the `after the manager lost its records (a reload)` block gains one case: a raw entry with `stoppedWhileQueued: true` and `status: "stopped"` is offered as `… · stopped · queued 3.0s · session released (snapshot)`.
  Its existing `recordEntry` has no `stoppedWhileQueued` key and stays unchanged, as the end-to-end legacy pin.
- `test/observation/subagent-events-observer.test.ts` — the two exact `toHaveBeenCalledExactlyOnceWith("subagents:record", {…})` assertions (initial run and resumed run) gain `stoppedWhileQueued: false`; a defined `false` does not match an absent key.
- `docs/architecture/architecture.md` — the `#### [#1086]` step heading gains `✅`, the `S1086` Mermaid node gains `✅`, and the step gains a `Landed:` note.
  The [#1085] `Landed:` note's "that row is [#1086]'s" and the sweep disposition bullet are history and stay.

Predicted unchanged, and the claim each rests on:

- `src/observation/subagent-events-observer.ts` — `Subagent` already has `get stoppedWhileQueued()`, so `toPersistedRecord(record)` type-checks.
- `src/ui/session-navigator.ts` — it only passes `readPersistedRuns`' result through.
- `src/ui/display.ts` — `RunTiming` already requires the field.
- `test/helpers/make-navigable.ts`, `test/helpers/make-subagent.ts` — they already default `stoppedWhileQueued` to `false`.
- `.pi/skills/package-pi-subagents/SKILL.md` — it names `persisted-record.ts` as the entry contract, not its field list.
- The architecture doc's module tree (`persisted-record.ts` line) and the navigator paragraph describing `subagents:record` — neither names the field set.

## Test Impact Analysis

1. New tests: the reader's legacy-default and non-boolean-skip arms, a writer→reader round trip of a stopped-while-queued record, and a raw-entry→label case that exercises the post-`/reload` path through `SessionNavigatorHandler`.
2. Redundant tests: none; the flipped `session-navigation.test.ts` test replaces the characterization [#1085] left as a pin for this defect.
3. Stay as-is: `session-navigator.test.ts`'s existing raw-entry block (now the legacy-entry pin end to end), the `a run the limiter never admitted` in-memory tests from [#1085], and `readPersistedRuns`' filtering, last-wins, and order tests.

## Invariants at risk

From [#1085]'s `Landed:` note, each pinned by a test opened at planning time (none mocks `listNavigableAgents` or `formatRunDuration`):

- A queued resume's live row reads `queued · queued <seconds>` — `session-navigation.test.ts`, `labels a queued resume with its time in the queue, not as running`.
- A resume stopped while queued reads `stopped · queued <seconds>` live and released in memory — the two sibling tests in the same block.
- A run that started keeps its label — `session-navigator.test.ts`, `after the manager lost its records (a reload)` (`completed · 3.0s`), and the released-pane tests above it.

From the entry contract itself:

- An entry written before the entry recorded `toolUses` is skipped — `persisted-record.test.ts`, `skips an entry written before the entry recorded toolUses`; the new field must not loosen that.
- The last entry for an id wins — `keeps the last entry for an id, so a resumed run reports its latest outcome`.
- A run with no transcript is read but not listed — `keeps a run that recorded no transcript` and `omits a persisted run that recorded no transcript`.

## TDD Order

1. **Record whether a run was stopped while queued, and label a reloaded one from it.**
   One step: the writer, the reader, and the navigator call site change together, since writing a field nothing reads changes no observable outcome, and the type change forces the fixture updates into the same commit regardless.
   - Red: in `test/persisted-record.test.ts`, add `copies stoppedWhileQueued off a run stopped while queued` (`createTestSubagent({ status: "stopped", stoppedWhileQueued: true })` → `toPersistedRecord(...).stoppedWhileQueued === true`), `reads an entry written before the entry recorded stoppedWhileQueued as not stopped while queued` (a `persistedRecord()` with the key deleted → `[summary]`), `skips an entry whose stoppedWhileQueued is not a boolean` (`"yes"` → `[]`), and `reads back a run stopped while queued` (round trip of a `stoppedWhileQueued: true` subagent → `{ ...summary, status: "stopped", stoppedWhileQueued: true, … }`).
     Add `stoppedWhileQueued: false` to the `persistedRecord()` fixture, the `summary` literal, and the `toPersistedRecord` `toStrictEqual`.
     In `test/ui/session-navigation.test.ts`, add the field to `persistedRun()` and flip the persisted-row test to expect `queued 1.0s`.
     In `test/ui/session-navigator.test.ts`, add the raw-entry `stoppedWhileQueued: true` case.
     In `test/observation/subagent-events-observer.test.ts`, add `stoppedWhileQueued: false` to both exact assertions.
     Predicted red: all four new `persisted-record` tests (today's `asRunSummary` drops the key, so even the skip test gets a summary back), the `toPersistedRecord` exact test, the filtering/last-wins/no-transcript/round-trip tests (their `summary` now carries a key the reader drops), both observer assertions, the flipped navigation test, and the new navigator case.
   - Green: the `src/persisted-record.ts` and `src/ui/session-navigation.ts` changes in Module-Level Changes.
   - Verify: `pnpm --filter @gotgenes/pi-subagents exec vitest run test/persisted-record.test.ts test/ui/session-navigation.test.ts test/ui/session-navigator.test.ts test/observation/subagent-events-observer.test.ts && pnpm --filter @gotgenes/pi-subagents run check`, then the full package suite, `pnpm run lint`, and `pnpm fallow dead-code`.
   - Killing mutations, one per equivalence class:
     - Writer: delete the `stoppedWhileQueued: record.stoppedWhileQueued,` line from `toPersistedRecord` — kills the copy test, the `toPersistedRecord` exact test, the stopped-while-queued round trip, and both observer assertions.
     - Reader value: make `asRunSummary` return `stoppedWhileQueued: false` unconditionally — kills the stopped-while-queued round trip and the new navigator raw-entry case, and leaves the legacy test green (it is the default).
     - Reader default: make the absent arm read `true` (`stoppedWhileQueued ?? true`) — kills the legacy test and the existing raw-entry navigator block (`completed · 3.0s` becomes `queued 3.0s`); the filtering and last-wins tests stay green, since their fixture now writes `false` explicitly.
     - Reader guard: delete the non-boolean guard (returning the raw value) — kills the skip test.
     - Call site: restore `buildLabel({ ...run, stoppedWhileQueued: false }, registry, true)` — kills the flipped navigation test and the new navigator case.
   - Commit: `fix(pi-subagents): label a reloaded resume stopped while queued with its time in the queue (#1086)`.
     Body: the `subagents:record` entry now records `stoppedWhileQueued`, an entry written before it reads as `false`, and the `/subagents:sessions` row reads `stopped · queued 3.0s · session released (snapshot)`.
2. **Land the roadmap step.**
   - In `docs/architecture/architecture.md`: `✅` on the `#### [#1086]` heading and the `S1086` node, and a `Landed:` note after the step's `Impact` line stating that the entry records `stoppedWhileQueued`, a pre-upgrade entry reads as not stopped while queued, and the persisted row reads `stopped · queued <seconds> · session released (snapshot)`.
   - Verify: `pnpm exec rumdl check packages/pi-subagents/docs/architecture/architecture.md`.
   - Commit: `docs(pi-subagents): mark the persisted queued label step landed (#1086)`.

## Risks and Mitigations

- A pre-upgrade entry is misread as stopped while queued, relabeling history: the absent arm reads `false`, pinned by the legacy unit test and by the unchanged raw-entry navigator block, which the reader-default mutation turns red.
- The writer adds the field and the tolerant reader silently drops it (the allowlist-parser hazard): the writer→reader round trip of a `true` record pins both sides in one test.
- A downgrade to an older version reads a newer entry: `asRunSummary` destructures named fields only, so the extra key is ignored and the row reads as it does today.
- An exact-equality assertion on the entry is missed and fails only in the full suite: the assessor confirmed the two observer assertions are the only exact ones (the `turnBudget` test uses `expect.objectContaining`); Step 1's verify runs the full suite before the commit.

## Open Questions

None.

[#1085]: https://github.com/gotgenes/pi-packages/issues/1085
