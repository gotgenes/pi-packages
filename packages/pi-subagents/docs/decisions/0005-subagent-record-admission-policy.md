---
status: accepted
date: 2026-08-29
---

# 0005 — What the public `SubagentRecord` snapshot exposes

## Status

Accepted.
Settles the admission policy for the public snapshot and its contract direction; the lifecycle **event payloads** keep their own guarantee unstated.

## Context

`SubagentRecord` is what `SubagentsService.getRecord()` and `.listAgents()` return.
It is produced by `toSubagentRecord()` in `src/service/service-adapter.ts`, which copies a named set of fields and drops everything else — a deliberate allowlist that keeps live session objects out of a snapshot a consumer may serialize.

The allowlist had no stated admission policy, so every proposed widening re-litigated the same trade-off from scratch.
Pull request [#748] proposed `turnCount` and `activeTools` as required fields plus an optional `outputFile`, and flagged the required-versus-optional hazard itself.
[#724] deferred `isBackground` here rather than deciding it in passing.
Several more fields — `maxTurns`, `responseText`, `consumedAt`, `stoppedWhileQueued` — exist on the live `Subagent`/`SubagentState` and were dropped with no recorded reason.

Three facts shaped the decision.

1. **The record has no in-repo consumer.**
   Outside `service-adapter.ts` and its tests, nothing in this repository reads a `SubagentRecord`; the background widget reads live `Subagent` objects through `manager.listAgents()`.
   The policy is therefore a judgment about consumers in other extensions, not a response to local demand.
2. **`architecture.md` already supplies the axis.**
   Its "Reactive versus discrete (not internal versus external)" refinement rules `SubagentsService.getRecord` a query by nature, in-package or not.
   A snapshot is the discrete half of that split, and what belongs in it follows from that rather than from a field-by-field vote.
3. **Whether the required-versus-optional question is even a semver question depends on the contract direction.**
   TypeScript is structurally typed: adding a required property to a type breaks code that *builds* the value, never code that *reads* it.

## Decision

### Admission rules

A field is admitted to `SubagentRecord` when **all four** hold.

1. **Serializable by value** — a JSON primitive, array, or plain object.
   Never a live object, a function, or a `Map`.
2. **Discrete, not momentary** — identity, a resolved spawn decision, a cumulative metric, or a pointer to a durable artifact.
   State whose value is stale the instant it is read is reactive by nature, and the discrete-query half of the split does not serve it.
3. **Meaningful outside this package** — not bookkeeping the core keeps in order to run its own sweeps.
4. **Stable in meaning** — the package can keep producing it without re-deriving it from a display snapshot or a UI concern.

Four exclusion classes follow, and a proposal is answered by naming one of them rather than by reopening the debate:

- **live objects** (rule 1) — `subagentSession`, `abortController`, `promise`, `execution`;
- **momentary activity** (rule 2) — `activeTools`, `responseText`;
- **internal bookkeeping** (rule 3) — `consumedAt`, `stoppedWhileQueued`;
- **display snapshots** (rule 4) — `invocation`, which only the tool door built.
  It was removed from `Subagent` outright by [#828], so this class currently has no live instance; the rule stands on its own and answers the next display snapshot proposed.

### `SubagentRecord` is produced, not implemented

The package constructs every `SubagentRecord` that exists; consumers read them.
`SubagentRecord` and `SubagentsService` are not contracts third parties satisfy — a consumer's test double should be a cast or a `Partial<>`, not an implementation.

The semver consequence is therefore fixed once, here:

- **adding a field is semver-minor**, required or optional, because structural typing leaves every reader unaffected;
- **removing a field, renaming one, or narrowing its type is semver-major.**

A field is optional only when its underlying value is genuinely absent in a real state — never as a compatibility hedge.

### A snapshot is by value

`getRecord()` and `listAgents()` return data that no later mutation of the agent can alter, and that no consumer mutation can write back into the agent.
This was true of every field except `lifetimeUsage`, which was assigned by reference to the object `SubagentState.addUsage()` mutates in place — so a held record drifted, and a consumer could write into a running agent's token totals.
`toSubagentRecord` now copies it.

### Dispositions

| Field                                          | Disposition                          | Basis                                                           |
| ---------------------------------------------- | ------------------------------------ | --------------------------------------------------------------- |
| `id`, `type`, `description`, `status`          | admitted (already present)           | identity and lifecycle status                                   |
| `result`, `error`, `completedAt`               | admitted, optional (already present) | terminal facts, absent until the agent ends                     |
| `toolUses`, `lifetimeUsage`, `compactionCount` | admitted (already present)           | cumulative metrics                                              |
| `startedAt`                                    | admitted (already present)           | resolved lifecycle timestamp                                    |
| `isBackground`                                 | admitted, required                   | resolved spawn fact, known from the choke point onward ([#724]) |
| `turnCount`                                    | admitted, required                   | cumulative metric; parity with `toolUses` and `compactionCount` |
| `maxTurns`                                     | admitted, optional                   | spawn-time configuration; genuinely absent when unset           |
| `outputFile`                                   | admitted, optional                   | pointer to the child's durable session transcript               |
| `activeTools`                                  | declined                             | rule 2 — momentary set, and a `Map` on the live record          |
| `responseText`                                 | declined                             | rule 2 — momentary and unbounded in size                        |
| `consumedAt`                                   | declined                             | rule 3 — result-delivery bookkeeping behind the retention sweep |
| `stoppedWhileQueued`                           | declined                             | rule 3 — internal marker selecting a never-started result text  |

## Consequences

- The public snapshot answers "what is this agent, how is it progressing, and how did it end?"
  A consumer can render progress (`turnCount` against `maxTurns`), filter the roster (`isBackground`) without reconstructing the mode from a display snapshot, and open the child's transcript (`outputFile`) — the pipeline [ADR 0004](0004-reconsider-ui-direction.md) established against the in-package record.
- Pull request [#748]'s widening is **partially adopted**: `turnCount` and `outputFile` are in, `activeTools` is declined under rule 2.
- Live agent activity has no external path at all, since no broadcast channel carries it either.
  That is the intended state of a "no vacant hooks" core, not an oversight.
  **Revisit condition:** a named consumer plus a reactive channel for momentary state.
  Whoever reopens it should add the channel, not widen the snapshot — a pulled `activeTools` would be stale on arrival.
- Both halves of the policy are pinned by tests in `test/service/service-adapter.test.ts`: exact `toEqual` assertions on the admitted set, and a test that populates every declined field on the source and asserts none of them reaches the output.
  A future widening fails those tests by design; that failure is the moment the proposal meets this policy.
- `SubagentRecord.lifetimeUsage` stays declared mutable.
  Once the value is a copy, a consumer mutating it harms nothing, and retyping a shipped public property as `Readonly` would be a breaking change bought for nothing.

[#724]: https://github.com/gotgenes/pi-packages/issues/724
[#748]: https://github.com/gotgenes/pi-packages/pull/748
[#828]: https://github.com/gotgenes/pi-packages/issues/828
