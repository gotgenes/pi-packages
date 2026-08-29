---
issue: 830
issue_title: "pi-subagents: SubagentRecord's allowlist has no stated policy; decide what the public snapshot exposes"
---

# Decide and document the `SubagentRecord` admission policy

## Release Recommendation

**Release:** ship independently

Phase 22's roadmap places this issue in batch `"front-door-majors"` (Steps 2, 4, 3; tail = Step 3) *"so its required/optional decision rides the same major if it comes out breaking — if its resolution is non-breaking, its plan may downgrade it to independently releasable and update this line."*
The operator settled the contract direction as **producer-only with required additions**, which is semver-minor: TypeScript's structural typing means a consumer that *reads* a `SubagentRecord` is unaffected by new fields, and the package declares that third parties do not implement the interface.
This plan therefore takes the downgrade the roadmap anticipated, ships as `feat:`, and updates the roadmap's `Release:` line and `Release batches` bullet in the same change.

## Problem Statement

`SubagentRecord` — the serializable snapshot `SubagentsService.getRecord()` and `.listAgents()` return — is produced by an explicit allowlist in `toSubagentRecord()`.
The allowlist is deliberate (it keeps live session objects out of a snapshot consumers may serialize), but it has never had a stated admission policy.
So every proposed widening re-litigates the same trade-off case by case: [#748] proposes `turnCount`/`activeTools` as required fields plus an optional `outputFile`, [#724] deferred `isBackground` to this issue, and several more fields exist on the live `Subagent`/`SubagentState` and are dropped with no recorded reason.

Two questions sit underneath the field list.
What earns a field a place in the public snapshot, and is `SubagentRecord` a contract third parties implement — which is what decides whether a required addition is breaking?
Neither is written down anywhere.

## Goals

- Record a written admission policy for `SubagentRecord` as a package ADR, derived from the architecture doc's reactive-versus-discrete split rather than from a field-by-field vote.
- Declare the contract direction: `SubagentRecord` is a **producer-only** return type, so a required addition is semver-minor.
- Disposition all seven candidates the issue names, plus `stoppedWhileQueued` (which a "mirror all state" policy would have admitted), and pin both halves — admitted and declined — with tests.
- Admit `turnCount`, `isBackground`, `maxTurns`, and `outputFile` under the policy.
- Fix the snapshot-aliasing defect the policy exposes: `toSubagentRecord` currently assigns `lifetimeUsage` by reference to an object `SubagentState.addUsage()` mutates in place.
- Document the resulting contract where third-party authors read it (`README.md` § For Extension Authors) and where the package's own agents read it (the package skill).

This change is **not** breaking.

## Non-Goals

- **Adding an event channel for live agent activity.**
  The policy declines `activeTools` and `responseText` because a pulled snapshot of momentary state is stale on arrival; the reactive half of that split would need a broadcast channel, and no consumer has asked for one.
  The ADR records the revisit condition instead of building the channel.
- **Settling the stability guarantee carried by the lifecycle *event payloads*.**
  `architecture.md` names the record's guarantee and the event payloads' guarantee in the same sentence; this change settles only the record's.
- **Changing `SubagentsService`'s method set, `SpawnOptions`, or the `SUBAGENT_EVENTS` channel constants.**
- **Retyping `SubagentRecord.lifetimeUsage` as `Readonly<LifetimeUsage>`.**
  Once the snapshot is a copy, a consumer mutating it harms nothing, and tightening a shipped public property type would be a needless breaking change.
- **[#827] (widget `UICtx` capture), which is [#748]'s *first* commit and Phase 22 Step 6.**
  Only [#748]'s second commit is this issue's close target.
- **Removing or renaming any field the record exposes today.**
  The policy is applied additively; a removal would be semver-major and no candidate warrants one.

## Background

### Where the record is produced

`toSubagentRecord(record: Subagent): SubagentRecord` lives at the bottom of `src/service/service-adapter.ts` (148 lines).
It builds a required-field object literal, then appends `result`, `error`, and `completedAt` behind `if (x !== undefined)` guards.
`SubagentsServiceAdapter.getRecord` and `.listAgents` are its only callers.

### The record has no in-repo consumer

Outside `service-adapter.ts` and its tests, nothing in this repository reads a `SubagentRecord`.
The widget reads live `Subagent` objects through `manager.listAgents()`, not through the service.
So no candidate field has a named in-repo reader, and the policy is a judgment about *external* consumers rather than a response to local demand.

### Candidate inventory

Every candidate already exists as a getter on `Subagent` or `SubagentState`.

| Candidate            | Shape on the live record                                                                | Kind                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `turnCount`          | `number`                                                                                | cumulative counter — the same family as `toolUses`/`compactionCount`, both already exposed |
| `isBackground`       | `boolean`                                                                               | resolved spawn fact, first-class record state since [#724]                                 |
| `maxTurns`           | `number \| undefined` (reads `execution.maxTurns`)                                      | spawn-time configuration                                                                   |
| `outputFile`         | `string \| undefined` (live session path, falling back to the path captured at release) | pointer to a durable artifact                                                              |
| `activeTools`        | `ReadonlyMap<string, string>`                                                           | momentary set, mutated on every tool start and end                                         |
| `responseText`       | `string`, unbounded                                                                     | momentary streaming buffer, reset at each `message_start`                                  |
| `consumedAt`         | `number \| undefined`                                                                   | internal bookkeeping — drives the session-retention sweep ([#617])                         |
| `stoppedWhileQueued` | `boolean`                                                                               | internal never-started marker, used to choose result text                                  |

### The aliasing defect

`SubagentState` exposes `get lifetimeUsage(): Readonly<LifetimeUsage>` returning its own internal object, and `addUsage(this._lifetimeUsage, delta)` mutates that object in place on every `message_end`.
`toSubagentRecord` assigns that same object into the record, and `SubagentRecord.lifetimeUsage` is declared mutable.
So the "serializable snapshot" (a) drifts under a consumer that holds it and (b) lets a consumer write into a running agent's token totals.
This is not a hypothetical: `listAgents()` hands the same live object to every caller.

### Constraints from `AGENTS.md`

- `docs/decisions` is already in the package's `files` allowlist, so a new ADR ships in the tarball and `README.md` may link it relatively.
- The public type surface is rolled into `dist/public.d.ts`; run `pnpm --filter @gotgenes/pi-subagents run verify:public-types` after the `service.ts` change.
- Do not name an unreleased version anywhere in the ADR or README text.
- The roadmap step's `✅` mark, its `Landed:` note, and the `Release:` marker are doc updates this change lands, not phase-close work.

## Design Overview

### The admission policy (ADR 0005)

A field is admitted to `SubagentRecord` when **all four** hold:

1. **Serializable by value** — a JSON primitive, array, or plain object; never a live object, function, or `Map`.
2. **Discrete, not momentary** — it is identity, a resolved spawn decision, a cumulative metric, or a pointer to a durable artifact.
   State whose value is stale the instant it is read is reactive by nature; the discrete-query half of the split does not serve it.
3. **Meaningful outside the package** — not bookkeeping the core keeps in order to run its own sweeps.
4. **Stable in meaning** — the package can keep producing it without re-deriving it from a display snapshot or a UI concern.

Four exclusion classes follow, each with a reason the ADR states once so a future proposal is answered by the rule rather than by a fresh debate: live objects (rule 1), momentary activity (rule 2), internal bookkeeping (rule 3), and display snapshots such as `invocation` (rule 4).

### Candidate dispositions under the policy

| Candidate            | Disposition     | Rule                                                                 |
| -------------------- | --------------- | -------------------------------------------------------------------- |
| `turnCount`          | admit, required | cumulative metric; parity with `toolUses`/`compactionCount`          |
| `isBackground`       | admit, required | resolved spawn fact, always known                                    |
| `maxTurns`           | admit, optional | spawn-time configuration; genuinely absent when unset                |
| `outputFile`         | admit, optional | durable artifact pointer; absent until the session exists            |
| `activeTools`        | decline         | rule 2 — momentary set; also not serializable in its live `Map` form |
| `responseText`       | decline         | rule 2 — momentary, and unbounded in size                            |
| `consumedAt`         | decline         | rule 3 — retention-sweep bookkeeping                                 |
| `stoppedWhileQueued` | decline         | rule 3 — internal marker for result-text selection                   |

`maxTurns` and `outputFile` are optional because the underlying value is genuinely absent in real states, not as a compatibility hedge — the policy has no "optional for safety" category.

### Contract direction: producer-only

The ADR declares `SubagentRecord` (and `SubagentsService`) a type this package **produces** and consumers **read**.
Third parties do not implement it; a test double should be a cast or a `Partial<>`, not an implementation.

The consequence is stated in the ADR so no future widening re-derives it: **adding a field is semver-minor** (structural typing leaves readers unaffected), while **removing or retyping a field remains semver-major**.

### Snapshot semantics: by value

The policy defines "snapshot" as *by value*: each call returns data that no later mutation of the agent can alter, and that no consumer mutation can write back into the agent.
`lifetimeUsage` is the only field that violates this today; the fix is `lifetimeUsage: { ...record.lifetimeUsage }`.
`LifetimeUsage` is a flat three-number object, so a shallow copy is a full copy.

### Resulting public shape

```typescript
/**
 * Serializable by-value snapshot of an agent's state — see
 * docs/decisions/0005-subagent-record-admission-policy.md for what earns a
 * field a place here. Produced by this package and read by consumers; not a
 * contract third parties implement.
 */
export interface SubagentRecord {
  id: string;
  type: string;
  description: string;
  status: SubagentStatus;
  /** Scheduling and announcement mode, resolved once at the manager choke point. */
  isBackground: boolean;
  result?: string;
  error?: string;
  toolUses: number;
  /** Turns consumed so far; starts at 1. */
  turnCount: number;
  /** Turn ceiling for this run, when one was set. */
  maxTurns?: number;
  startedAt: number;
  completedAt?: number;
  lifetimeUsage: LifetimeUsage;
  compactionCount: number;
  /** Path to the child's session JSONL, once the session exists. */
  outputFile?: string;
}
```

### Consumer call sites the shape has to serve

Progress display in a sibling extension, the case [#748] motivates:

```typescript
const rec = svc.getRecord(id);
if (rec?.status === "running") {
  const ceiling = rec.maxTurns === undefined ? "" : `/${rec.maxTurns}`;
  render(`${rec.type}: turn ${rec.turnCount}${ceiling}, ${rec.toolUses} tool uses`);
}
```

Transcript access, the case ADR 0004 already established against the in-package record:

```typescript
const rec = svc.getRecord(id);
if (rec?.outputFile) {
  const entries = parseSessionEntries(readFileSync(rec.outputFile, "utf8"));
}
```

Both read fields off the record and ask it nothing further — no reach-through, no second lookup.
`isBackground` serves the roster filter a consumer would otherwise reconstruct from a display snapshot, which is exactly the reconstruction [#724] removed in-package.

### Interface segregation check

`SubagentRecord` gains four fields and reaches 15.
It is a DTO, not a dependency bag: no consumer is forced to *supply* it, and each reader picks the fields it needs.
The design-review dependency-width test targets interfaces a caller must satisfy; the applicable discipline for a return DTO is the admission policy itself, which is the deliverable here.

## Module-Level Changes

| File                                                                            | Change                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/pi-subagents/docs/decisions/0005-subagent-record-admission-policy.md` | **New.** Frontmatter `status: accepted`; Context (no stated policy, [#748]'s prompt, no in-repo consumer), Decision (the four rules, the four exclusion classes, producer-only contract, by-value snapshot), Dispositions table for all eight candidates, Consequences (semver rules, the `lifetimeUsage` fix, the revisit condition for the declined momentary fields).                                                     |
| `packages/pi-subagents/src/service/service.ts`                                  | `SubagentRecord` gains `isBackground: boolean`, `turnCount: number`, `maxTurns?: number`, `outputFile?: string`; the interface doc comment states by-value snapshot semantics, producer-only direction, and points at the ADR.                                                                                                                                                                                               |
| `packages/pi-subagents/src/service/service-adapter.ts`                          | `toSubagentRecord` adds `isBackground` and `turnCount` to the required literal, two `if (x !== undefined)` lines for `maxTurns` and `outputFile`, and copies `lifetimeUsage`. Its doc comment replaces "explicit allowlist — new fields must be opted in" with the policy statement and ADR pointer.                                                                                                                         |
| `packages/pi-subagents/test/service/service-adapter.test.ts`                    | Consolidate the five overlapping "strips" tests; update both exact `toEqual` blocks for the two new required fields; add admitted-field, declined-field, and `lifetimeUsage`-copy tests.                                                                                                                                                                                                                                     |
| `packages/pi-subagents/README.md`                                               | § For Extension Authors gains a short `getRecord` / `listAgents` contract subsection: what the record carries, that it is a by-value snapshot, that it is produced-not-implemented, and a link to the ADR.                                                                                                                                                                                                                   |
| `packages/pi-subagents/docs/architecture/architecture.md`                       | Four edits: the "not boundaries" paragraph (line ~58) drops the record's stability guarantee from the unsettled list, keeping the event payloads there; the public-surface bullet (line ~518) points at the ADR; Step 2 gains `✅`, a `Landed:` note, and `Release: independent`; the `Release batches` bullet drops Step 2 from `"front-door-majors"` (tail stays Step 3) and adds it to the independently-releasable list. |
| `.pi/skills/package-pi-subagents/SKILL.md`                                      | § Public exports gains one sentence naming the admission policy and its ADR, so a future session finds the rule before proposing a field.                                                                                                                                                                                                                                                                                    |

Greps performed for touch points:

- `SubagentRecord` across `packages/`, `.pi/`, `docs/` (excluding `plans/`, `retro/`, `history/`): only `service.ts`, `service-adapter.ts`, `test/service/service-adapter.test.ts`, `architecture.md` (lines 58, 234, 235, 421, 518, 819–824, 910), and `CHANGELOG.md` (release-please-owned, not edited).
- No file outside `service-adapter.ts` constructs a `SubagentRecord` literal, so the two new required fields break no existing call site.
- `turnCount|activeTools|outputFile|maxTurns` across `packages/pi-subagents/docs/` and `README.md`: hits in `0004-reconsider-ui-direction.md` all describe the **in-package** `Subagent` record (`record.activeTools`, `record.outputFile`), which this change does not alter — no edit needed, and the ADR should not be re-read as describing the public snapshot.
- `test/helpers/make-subagent.ts` already exposes `isBackground`, `turnCount`, `activeTools`, `responseText`, `consumedAt`, `stoppedWhileQueued`, and `maxTurns` options, so no fixture change is forced.

## Test Impact Analysis

**New tests the change enables.**
The policy's *declined* half has never been testable as a statement of intent — an absent field is indistinguishable from an oversight.
Tests that populate `activeTools`, `responseText`, `consumedAt`, and `stoppedWhileQueued` on the source and assert their absence from the output turn the policy into an executable claim.
The by-value semantics likewise become testable: mutate the snapshot and re-read the agent, and accumulate usage on the agent and re-read the snapshot.

**Tests that become redundant.**
Five `it` blocks in `describe("toSubagentRecord")` (`service-adapter.test.ts:43–78`) re-assert overlapping subsets of `subagentSession` / `abortController` / `promise` / `execution` / `notification` / `invocation` — four separate re-checks of the same four properties.
The Tidy-First assessor flagged this as the one real friction: roughly six new tests join this block, and consolidating first keeps it readable.
The consolidation must preserve all six property names.

**Tests that must stay as-is.**
The two exact `expect(result).toEqual({...})` blocks (lines ~27–41 and ~87–105) are the strongest policy pin available: any field added to the record without a deliberate test edit fails them.
They gain the two new required fields and otherwise stay exact — never `toMatchObject`.
They are not a substitute for the declined-field tests, because their fixtures leave `activeTools` empty and `responseText` blank; only a test that *populates* the declined fields discriminates "policy applied" from "field happened to be empty".

The adapter tests below the `toSubagentRecord` block (`spawn` background-request assertions at lines ~301–341) exercise a different surface and are untouched.

## Invariants at risk

| Invariant                                                                                                                  | Origin                           | Pinned by                                                                        | Risk from this change                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The snapshot contains no live session objects, controllers, promises, collaborators, or the `invocation` display snapshot. | The allowlist's original purpose | The five "strips" tests being consolidated in Step 1                             | Consolidation could silently drop a property name — Step 1's verify criterion lists all six by name.                                                                                        |
| `Subagent.isBackground` is first-class record state, not re-derived from `invocation`.                                     | [#724] Step 1 `Outcome:`         | `test/lifecycle/subagent-manager.test.ts:248,254`                                | None — this change reads that field; the new adapter test asserts a foreground agent's record reports `false`, which also fails if the field is ever re-derived from a display snapshot.    |
| `consumedAt` is package-internal domain state driving the retention sweep.                                                 | [#617]                           | `test/observation/notification.test.ts`, `test/lifecycle/subagent-state.test.ts` | None — the field stays internal; the new declined-field test pins that it does not leak.                                                                                                    |
| `lifetimeUsage` survives compaction because it is an independent accumulator.                                              | `usage.ts` doc comment           | `test/lifecycle/subagent-state.test.ts`                                          | The copy is taken at snapshot time, so accumulation continues on the agent's own object; the new test asserts exactly that (a post-snapshot `addUsage` does not change the taken snapshot). |

No quantitative invariant (prefix bytes, token budget, latency) is in play.

## TDD Order

1. **`test:` consolidate the overlapping "strips" assertions in `describe("toSubagentRecord")`** *(Tidy-First preparation)*.
   Friction it prepares: roughly six new tests land in this block, and five accreted `it` blocks already re-assert overlapping subsets of the same properties.
   Merge them into one test asserting all six absent properties by name — `subagentSession`, `abortController`, `promise`, `execution`, `notification`, `invocation` — over a fixture that sets a session, an `invocation`, and a `toolCallId`.
   No production change.
   Verify: the six names all appear in the consolidated test; `pnpm --filter @gotgenes/pi-subagents run test` green.
   Commit: `test(pi-subagents): consolidate overlapping toSubagentRecord strip assertions`.

2. **`docs:` record the admission policy as ADR 0005.**
   Write `docs/decisions/0005-subagent-record-admission-policy.md` per the Design Overview: the four admission rules, the four exclusion classes, the producer-only contract with its semver consequence, by-value snapshot semantics, the eight dispositions, and the revisit condition for `activeTools`/`responseText` (a named consumer plus a broadcast channel for momentary state).
   No code change; the ADR is this issue's actual deliverable and the later steps' doc comments cite it.
   Verify: `pnpm exec rumdl check packages/pi-subagents/docs/decisions/0005-subagent-record-admission-policy.md`; every disposition in the table matches the Design Overview.
   Commit: `docs(pi-subagents): record the SubagentRecord admission policy`.

3. **`feat:` admit `isBackground`, `turnCount`, `maxTurns`, and `outputFile`.**
   Red: extend both exact `toEqual` blocks with `isBackground` and `turnCount`; add tests that a record from a foreground agent reports `isBackground: false`, that `turnCount` reflects a multi-turn agent, that `maxTurns` and `outputFile` appear when set, and that both are omitted when the source has neither.
   Green: add the four fields to `SubagentRecord` and populate them in `toSubagentRecord` (two in the required literal, two behind `!== undefined` guards); rewrite both doc comments to state the policy and cite the ADR.
   Killing mutations: (a) hardcode `turnCount: 1` in the literal → the multi-turn test fails; (b) hardcode `isBackground: true` → the foreground test fails; (c) assign `out.outputFile = record.outputFile` unconditionally → the omitted-when-absent test fails (the same mutation on `maxTurns` kills its twin).
   Verify: package test suite, `pnpm run check`, `pnpm run lint`, and `pnpm --filter @gotgenes/pi-subagents run verify:public-types` (the public surface changed).
   Commit: `feat(pi-subagents): report turn count, background mode, turn limit, and transcript path in agent snapshots`.

4. **`test:` pin the declined fields' absence.**
   Add one test that builds a source agent with `activeTools`, `responseText`, `consumedAt`, and `stoppedWhileQueued` all populated and asserts none of the four appears on the serialized record, with a comment citing the ADR rule each is declined under.
   No production change — this is the policy's negative half made executable.
   Killing mutation: apply [#748]'s widening — add `activeTools: string[]` to `SubagentRecord` and `activeTools: Array.from(record.activeTools.values())` to `toSubagentRecord` — and both this test and the two exact `toEqual` blocks turn red. (The interface edit is part of the mutation because TypeScript's excess-property check rejects the literal alone.) Verify: the mutation reddens the named tests; reverted, the suite is green.
   Commit: `test(pi-subagents): pin the fields SubagentRecord declines to expose`.

5. **`fix:` take `lifetimeUsage` by value.**
   Red: two tests — mutating `snapshot.lifetimeUsage.input` leaves `agent.lifetimeUsage.input` unchanged, and calling `agent.addUsage(delta)` after the snapshot leaves the snapshot's totals unchanged.
   Green: `lifetimeUsage: { ...record.lifetimeUsage }`.
   Killing mutation: restore `lifetimeUsage: record.lifetimeUsage` → both tests fail.
   Verify: package test suite; `pnpm run check`.
   Commit: `fix(pi-subagents): stop agent snapshots from aliasing live token totals`.

6. **`docs:` publish the contract and land the roadmap marks.**
   `README.md` § For Extension Authors gains the `getRecord` contract subsection; `architecture.md` gets the four edits listed in Module-Level Changes (unsettled-guarantee paragraph, public-surface bullet, Step 2 `✅` + `Landed:` + `Release: independent`, `Release batches` bullet); `.pi/skills/package-pi-subagents/SKILL.md` § Public exports gains the one-sentence policy pointer.
   Verify: `pnpm --filter @gotgenes/pi-subagents run lint:md`; `pnpm exec rumdl check .pi/skills/package-pi-subagents/SKILL.md`; the `Release batches` bullet still names Step 3 as the batch tail.
   Commit: `docs(pi-subagents): document the public agent-snapshot contract`.

Final gate before shipping: `pnpm run check`, `pnpm run lint`, `pnpm -r run test`, `pnpm fallow dead-code`.

## Risks and Mitigations

| Risk                                                                                                                                                         | Mitigation                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A third party has implemented `SubagentRecord` (e.g. a hand-rolled service double) and breaks on the two required fields.                                    | The ADR, the interface doc comment, and the README all declare the type produced-not-implemented, and the `feat:` commit body names the addition so it reaches the changelog. The alternative — optional-forever fields — was weighed and rejected at the clarification gate. |
| Declining `activeTools` and `responseText` leaves an external consumer with no path to live activity at all, since no broadcast channel carries them either. | The ADR records the revisit condition explicitly (a named consumer plus a channel for momentary state), so the decline is a stated position rather than an omission; [#748]'s close comment carries the same reasoning back to its author.                                    |
| The exact `toEqual` assertions make every future widening a test edit.                                                                                       | Intended: that edit is the moment a proposal meets the policy. The ADR says so, so the friction is not mistaken for a stale test.                                                                                                                                             |
| Editing the roadmap's `Release batches` bullet desynchronizes the batch from its tail.                                                                       | Step 3 ([#829]) remains the tail; Step 6's verify criterion re-reads the bullet after the edit.                                                                                                                                                                               |
| `outputFile` exposes a filesystem path across the extension boundary.                                                                                        | The path is already readable in-package and by any extension in the same process; ADR 0004 established transcript access against exactly this pointer.                                                                                                                        |

## Open Questions

- The stability guarantee carried by the **lifecycle event payloads** stays unstated (`architecture.md`'s "not boundaries" paragraph keeps that half).
  No issue is filed: the payloads have no pending proposal, and filing one now would be speculative.
- Whether `SubagentRecord` should eventually carry a schema version for out-of-process consumers.
  Not applicable while every consumer is an in-process extension compiled against the same types; the ADR's semver rules cover the current world.

[#617]: https://github.com/gotgenes/pi-packages/issues/617
[#724]: https://github.com/gotgenes/pi-packages/issues/724
[#748]: https://github.com/gotgenes/pi-packages/pull/748
[#827]: https://github.com/gotgenes/pi-packages/issues/827
[#829]: https://github.com/gotgenes/pi-packages/issues/829
