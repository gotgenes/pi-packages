---
issue: 617
issue_title: "Subagent cleanup happens too often"
---

# Consumption-aware session retention

## Release Recommendation

**Release:** ship independently

This issue is not part of any architecture roadmap phase, and it is a user-reported defect (results lost to the 10-minute cleanup sweep).
The headline commits are `fix(pi-subagents):`, so landing this cuts a release on its own.

## Problem Statement

A background subagent's record is evicted from the manager's map 10 minutes after it completes.
In a long or fan-out orchestration, a fast child finishes and is swept before a slower sibling frees the parent to collect it; `get_subagent_result` then returns `Agent not found: "xxx". It may have been cleaned up.` and the run's result is lost to the parent.
The reporter (third-party, `dzervas`) asked for longer configurable cleanup plus insta-cleanup on retrieval.
The operator confirmed a different, stronger direction (via the `ask-user` gate): model consumption explicitly — a subagent's outcome is an obligation until its result has been delivered to the parent, and the runtime must not forget an undelivered result on a timer.
The operator further ruled, rejecting an earlier draft of this design, that the completion notification must remain a pure nudge: push-side consumption conditioned on the preview fitting untruncated would make `consumed` depend on result length — the parent must always pull, keeping the contract unambiguous and the responsibility with the caller.

## Goals

- A completed subagent's result remains retrievable via `get_subagent_result` for the entire parent-session lifetime — retrieval never misses for an agent spawned in the current session.
- Promote the consumed-result fact from the notification layer's shadow `Set` into the domain (`SubagentState`), where the sweep, the notification system, and the tools read one authoritative state.
- Split "free the heavy memory" from "forget the agent existed": the sweep releases the child `AgentSession` (the transcript-holding object) but retains the lightweight record (which already owns the result string).
- Consumption-aware release timing: a consumed agent's session is released 10 minutes after the last relevance event (completion or consumption); an unconsumed agent's session is held up to a long safety cap (default 12 hours).
  Consumption never accelerates release (operator decision: timer only), preserving the read-result-then-resume workflow.
- Keep the completion notification a pure nudge: it announces the outcome (with a preview) and always instructs retrieval; it never marks consumption.
  Consumption is recorded only when the parent receives the result as the return value of a call it made — an unambiguous contract that leaves the parent the choice of when to pull and the responsibility to do so.
- Make both retention windows configurable via the existing layered settings (`subagents.json`) and the `/subagents:settings` UI.
- Non-breaking `fix:` — the public `SubagentsService` surface is untouched (`EvictedSubagent`/`listEvicted` are internal), new settings are additive, and previously-failing retrievals now succeed.

## Non-Goals

- **Resume or steer after session release.**
  Resume requires the live `AgentSession`; a released agent gets an honest error pointing at `get_subagent_result`, not a rehydrated session.
  Rehydration-from-disk is out of scope.
- **Serving results from disk.**
  The stored result is not derivable from the transcript (`completeRun` appends a workspace-disposal suffix that never reaches the session JSONL), and the retrieval tool must not become a JSONL parser.
  Disk stays the navigator's and the parent's own `Read`-tool concern.
- **Cross-session retrieval.**
  `clearCompleted()` still wipes all terminal records at `session_start`/`session_before_switch`; retention is bounded by the parent-session lifetime, as today.
- **Service-level consumption.**
  `service.getRecord()`/`listAgents()` stay pure queries (CQS); cross-extension readers never mark consumption.
  Service-spawned agents fall under the unconsumed cap unless their results are pulled through the parent-facing tools.
- **Widget changes.**
  The widget's display policy is already turn-age based (`finishedTurnAge`), not eviction based — verified no change is needed.
- The pre-existing `wait: true` quirk (a `queued` agent is not awaited) is untouched.
- The 500-char notification preview length is unchanged and stays non-configurable.

## Background

- `SubagentManager` keeps every spawned `Subagent` in a `Map`; a 60-second `setInterval` sweep evicts terminal records 10 minutes after `completedAt`, retaining a hand-copied `EvictedSubagent` descriptor (no `result`/`error`) solely so the `/subagents:sessions` picker can source the transcript from disk.
- `get_subagent_result`, `steer_subagent`, and the `subagent` tool's resume path consult only the live map — eviction makes them fail even though the descriptor and the on-disk transcript survive.
- The result string already lives on `SubagentState` (`markCompleted(result)`), not on the session.
  The heavy object is `Subagent.subagentSession` (the SDK `AgentSession` holding the full message history).
  The light/heavy split this plan needs already exists in the domain model; the sweep just bulldozes both halves.
- The consumed fact already exists as shadow state: `NotificationManager.consumed` (a `Set<string>`), fed by `GetResultTool` through a `GetResultToolNotifications` dependency — a tool reporting a domain event to an observer that secretly owns the lifecycle fact.
  The architecture doc already diagnosed this: its Phase 17 motivation names "Result delivery — whether the parent has consumed the result" as a distinct domain and calls the flag "the homeless `notification.resultConsumed` field".
- The widget (`agent-widget.ts`) filters `listAgents()` by its own turn-age linger policy, so record retention does not change what it displays.
- AGENTS.md constraints that apply: no `Closes #N` in commits; conventional commits with scope `pi-subagents`; `pnpm` only; do not edit `CHANGELOG.md`.

## Design Overview

### The model

Two orthogonal axes, not a new status value:

| Axis                      | Values                                                    | Owner                              |
| ------------------------- | --------------------------------------------------------- | ---------------------------------- |
| How it ended              | `completed` / `steered` / `aborted` / `error` / `stopped` | `SubagentState.status` (unchanged) |
| Was the outcome collected | `consumedAt?: number` (undefined = obligation open)       | `SubagentState` (new)              |

Making consumption a status enum value would conflate the axes and break every `status !== "running"` check.

```typescript
// subagent-state.ts (additions)
private _consumedAt?: number;
get consumedAt(): number | undefined;
get consumed(): boolean; // consumedAt != null
/** Record the parent collected the outcome. Idempotent — keeps the first collection time. */
markConsumed(at?: number): void; // this._consumedAt ??= at ?? Date.now()
// resetForResume() additionally clears _consumedAt — a resumed run creates a new pending outcome.
```

`Subagent` delegates `consumed`/`consumedAt`/`markConsumed()` to its state, matching every other getter.

### Consumption edges — parent-initiated calls only

One rule: **consumption is recorded only in the response to a call the parent made.**
The runtime never consumes on the parent's behalf.
Three edges:

1. **Pull** — `GetResultTool` marks after building a terminal report (same guard as today's `notifications.consume` call).
   The `wait: true` pre-consume hack is dropped; the post-report mark plus the nudge's fire-time re-check covers the race (the mark lands in the same microtask cascade, well inside the 200 ms `NUDGE_HOLD_MS` slack).
2. **Foreground return** — `runForeground` marks after `spawnAndWait` resolves (the result goes out in the tool result, success or error — the synchronous form of the pull).
3. **Resume return** — the `subagent` tool's resume path marks after `manager.resume()` resolves (the result is returned directly).

The completion notification is deliberately **not** an edge.
It is a nudge: it announces the outcome, carries the preview, and now always ends with the retrieval instruction (today only the truncated case says "use `get_subagent_result` for full output").
An earlier draft marked consumption when the preview fit untruncated; the operator rejected it — a lifecycle fact decided by result length is ambiguous, and the parent, not the formatter, owns the decision of when to collect.

```typescript
// notification.ts — emission sketch
if (record.consumed) return; // fire-time re-check: suppress only when the parent already pulled
this.sendMessage({ customType: "subagent-notification", content: notification + retrievalFooter, ... });
// no markConsumed here — the nudge announces; the parent collects
```

What dissolves anyway: `NotificationManager.consumed`, `consume(id)`, the `ResultDelivery` interface, and `GetResultTool`'s `GetResultToolNotifications` constructor dependency — suppression becomes a read of `record.consumed`, and the tool never talks to the notification layer again.

### The sweep: release, don't evict

`cleanup()` becomes `sweep()`: it releases heavy sessions and never removes records.

```typescript
// subagent-manager.ts — sweep sketch
const policy = this.getRetentionPolicy?.() ?? DEFAULT_RETENTION_POLICY;
for (const record of this.agents.values()) {
  if (record.status === "running" || record.status === "queued") continue;
  if (!record.isSessionReady()) continue; // never had a session, or already released
  const referenceAt = record.consumed
    ? Math.max(record.completedAt ?? 0, record.consumedAt ?? 0)
    : (record.completedAt ?? 0);
  const windowMinutes = record.consumed
    ? policy.consumedSessionRetentionMinutes
    : policy.unconsumedSessionRetentionMinutes;
  if (Date.now() - referenceAt >= windowMinutes * 60_000) record.releaseSession();
}
```

The consumed window measures from `max(completedAt, consumedAt)` — a late read (the bug's own scenario) still gets a full 10-minute resume window after consumption; this is the derived consequence of "timer only, never accelerate".

`Subagent.releaseSession()` captures `outputFile` into a private field (the getter falls back to it), disposes the wrapped session (firing the existing `disposed` lifecycle event), clears `subagentSession`, and sets a `sessionReleased` flag so the resume path can distinguish "released" from "never had a session".

`EvictedSubagent`, the `evicted` map, `listEvicted()`, and `toEvictedSubagent()` are deleted — the retained record now serves every consumer the descriptor served.
`clearCompleted()` (session start/switch) and `dispose()` keep today's semantics; `removeRecord`'s `disposeSession()` is a safe no-op on released records.

A released record still serves: `result`/`error`/stats (full report), `outputFile` (transcript pointer), picker navigation (disk snapshot).
It cannot serve: `getContextPercent()` (null), verbose conversation (degrades to a transcript pointer), resume/steer (honest rejection).

### Retention policy configuration

```typescript
// subagent-manager.ts — consumer-owned interface (ISP); SettingsManager satisfies it structurally
export interface RetentionPolicy {
  readonly consumedSessionRetentionMinutes: number;
  readonly unconsumedSessionRetentionMinutes: number;
}
```

- `SubagentManagerOptions` gains optional `getRetentionPolicy?: () => RetentionPolicy` (live getter, like `getRunConfig`); defaults applied internally when absent.
- `SubagentsSettings` gains both keys; sanitize accepts integers 1–20160 (minutes; two weeks ceiling).
  No `0` semantics — `defaultMaxTurns` owns the `0 = unlimited` convention and a second meaning for `0` would clash.
- Defaults: `consumedSessionRetentionMinutes: 10` (today's window), `unconsumedSessionRetentionMinutes: 720` (the issue's 12-hour ask).
- Two new table-driven descriptors in `/subagents:settings`; the command description in `index.ts` becomes "(concurrency, turn limits, retention)".

### Navigation without the side table

`listNavigableAgents(agents, registry)` drops the `evicted` parameter and the dedupe: one list, two sourcing modes.
A record with `isSessionReady()` is a `live` entry; a record with a captured `outputFile` but no live session becomes a `snapshot` entry (kind renamed from `evicted`), sourced by the existing `fileSnapshotSource`.
`NavigableSubagent` gains `readonly outputFile: string | undefined`.
Records that errored before session creation (no `outputFile`) are not navigable — same as today.

### Design-review notes

- ISP: `RetentionPolicy` is a two-field consumer-owned interface; `RunConfig` (turn-loop fields) is not widened.
- Dependency width: `GetResultTool` drops from three constructor deps to two.
- CQS: `getRecord`/`listAgents` (manager and service) stay pure — a telemetry reader polling records must not suppress the parent's delivery.
- Scattered decisions: the three `markConsumed` sites are the three parent-initiated return edges of one decision — no observer-side writes.
- Pre-existing smell, out of scope: `status === "running" || status === "queued"` recurs across manager methods; noted for the tidy-first assessor, not folded into this fix.

## Module-Level Changes

- `src/lifecycle/subagent-state.ts` — add `_consumedAt`, `consumedAt`/`consumed` getters, `markConsumed()`; clear in `resetForResume()`; add `consumedAt` to `SubagentStateInit`.
- `src/lifecycle/subagent.ts` — delegate `consumed`/`consumedAt`/`markConsumed()`; add `releaseSession()`, `sessionReleased` getter, `outputFile` fallback to the captured path.
- `src/lifecycle/subagent-manager.ts` — add `RetentionPolicy` + default constants + `getRetentionPolicy` option; rework `cleanup()` → `sweep()` (release, never delete); delete `EvictedSubagent`, `evicted` map, `listEvicted()`, `toEvictedSubagent()`; update the constructor comment (stale "keep sessions for resume" wording).
- `src/observation/notification.ts` — guard `sendCompletion`/emission on `record.consumed`; delete `consumed` set, `consume()`, `ResultDelivery`; append the retrieval instruction to every nudge (not only the truncated case); no consumption writes.
- `src/observation/subagent-events-observer.ts` — fix the stale comment ("the manager decides whether to nudge (it owns the consumed-result state)").
- `src/tools/get-result-tool.ts` — drop `GetResultToolNotifications` dep and pre-consume; `record.markConsumed()` on terminal report; pass `outputFile` into the report; degraded-verbose note when the session is released.
- `src/tools/get-result-report.ts` — add optional `transcriptPath` to `AgentReport`; render a `Full transcript: <path>` line when present.
- `src/tools/foreground-runner.ts` — `record.markConsumed()` after `spawnAndWait` resolves.
- `src/tools/agent-tool.ts` — resume path: `record.markConsumed()` after resume resolves; released-session resume message pointing at `get_subagent_result`; not-found copy no longer claims "cleaned up".
- `src/tools/steer-tool.ts` — not-found copy tweak only (terminal records now hit the accurate status-rejection path).
- `src/settings.ts` — two retention fields: getters/setters, sanitize bounds, `snapshot()`, `apply*` methods, defaults.
- `src/ui/subagents-settings.ts` — two new setting descriptors.
- `src/ui/session-navigation.ts` — drop `EvictedSubagent` import and `evicted` param; `snapshot` entry kind from released records; `outputFile` on `NavigableSubagent`; label marker "session released (snapshot)".
- `src/ui/session-navigator.ts` — drop `evicted` from `SessionNavigatorParams`/`handle()`.
- `src/index.ts` — `GetResultTool(manager, registry)`; `getRetentionPolicy: () => settings`; drop `evicted:` from the sessions command; settings command description.
- Tests: `test/lifecycle/subagent-state.test.ts`, `subagent.test.ts`, `subagent-manager.test.ts` (Bug-1 race describe migrates to `markConsumed`; evicted-descriptors describe becomes released-session coverage; new sweep-policy describe), `test/observation/notification.test.ts`, `test/tools/get-result-tool.test.ts`, `get-result-report.test.ts`, `foreground-runner.test.ts`, `agent-tool.test.ts`, `steer-tool.test.ts`, `test/settings.test.ts`, `test/ui/subagents-settings.test.ts`, `session-navigation.test.ts`, `session-navigator.test.ts`; helpers `make-subagent.ts` (seed `consumedAt`), `make-navigable.ts`, `manager-stubs.ts` (drop notification stubs from get-result wiring).
- `docs/architecture/architecture.md` — module-tree one-liner for `notification.ts` ("completion nudges + per-agent consumed-result tracking" → delivery wording); amend the Phase 17 motivation clause about the "homeless `notification.resultConsumed` field" to reflect its new home; check touched one-liners (`subagent-manager.ts`, `subagent-state.ts`) for staleness.
- `README.md` — "evicted" wording (lines 21, 238) → released/snapshot; document both new `subagents.json` keys in the settings section.
- `.pi/skills/package-pi-subagents/SKILL.md` — Observation-domain row ("completion nudges + consumed-result tracking") reworded to delivery + domain-owned consumption.

## Test Impact Analysis

1. New unit tests enabled: consumption transitions on `SubagentState` in isolation (idempotence, resume reset); sweep policy as pure timing behavior against fake timers (consumed vs unconsumed windows, `max(completedAt, consumedAt)` reference).
2. Redundant after the change: `notification.test.ts`'s consume-set tests (`consume cancels…`, `dispose clears consumed state`) — replaced by domain-flag guards; `subagent-manager.test.ts`'s evicted-descriptor describe — replaced by released-record coverage.
3. Must stay: the Bug-1 race tests (wait-path suppression) — they pin the cross-component guarantee and migrate mechanism, not intent; `clearCompleted` boundary tests — retention must not leak across sessions; widget tests — unchanged, they pin the turn-age policy that makes retention UI-safe.

## Invariants at risk

- Nudge-suppression race (pinned by `subagent-manager.test.ts` "Bug 1" describe): a result retrieved via `wait: true` must not produce a follow-up nudge.
  Preserved by post-report `markConsumed` + fire-time re-check; the migrated tests keep pinning it.
- Session-boundary hygiene (pinned by "Bug 3 clearCompleted" describe): terminal records and their sessions are dropped at session start/switch.
  Unchanged code path; tests stay green as-is.
- Foreground same-tick factory timing (pinned in `subagent.test.ts`, per the no-provider synchronous-guard comment): untouched — `releaseSession` only runs from the sweep.
- The `disposed` lifecycle event fires exactly once per child session (registry unregister): `releaseSession` disposes; `removeRecord`/`dispose()` on a released record must be a no-op second call (`subagentSession` already cleared) — add an explicit test.

## TDD Order

1. `feat(pi-subagents): add consumption state to SubagentState (#617)` — red: `subagent-state.test.ts` (markConsumed sets/keeps first timestamp, `consumed` getter, `resetForResume` clears, init seeding) + `subagent.test.ts` delegation; green: state + `Subagent` delegation + `make-subagent.ts` seeding.
2. `feat(pi-subagents): add Subagent.releaseSession with outputFile capture (#617)` — red: `subagent.test.ts` (release disposes session, captures `outputFile`, sets `sessionReleased`, `isSessionReady()` false, second release/dispose is a no-op); green: `releaseSession()` + getter fallback.
3. `feat(pi-subagents): add session-retention settings (#617)` — red: `settings.test.ts` (defaults, sanitize bounds, snapshot, apply methods) + `subagents-settings.test.ts` (two descriptors); green: settings fields + UI rows + command description.
4. `fix(pi-subagents): move consumed-result tracking from notification layer to domain (#617)` — red: `notification.test.ts` (`sendCompletion` and fire-time guards read `record.consumed`; emission never marks consumed; every nudge carries the retrieval instruction) + `get-result-tool.test.ts` (no notifications dep; terminal report marks consumed; wait-path race stays suppressed) + migrated manager Bug-1 tests; green: notification rework + tool dep drop + `index.ts` wiring + `manager-stubs.ts`; `ResultDelivery`/`consume()` deleted.
5. `fix(pi-subagents): mark foreground and resume returns consumed (#617)` — red: `foreground-runner.test.ts` + `agent-tool.test.ts` (resume marks consumed; resumed record's new run resets consumption via step-1 state); green: two one-line marks.
6. `fix(pi-subagents): retain records and release sessions via consumption-aware sweep (#617)` — red: `subagent-manager.test.ts` sweep-policy describe (fake timers via `advanceTimersByTimeAsync`: consumed released after 10 min from `max(completedAt, consumedAt)`; unconsumed held at 10 min, released at cap; running/queued untouched; record + `getRecord` survive release; policy getter honored, defaults without it) + `session-navigation.test.ts`/`session-navigator.test.ts` (snapshot entries from released records, no `evicted` param); green: manager rework + `EvictedSubagent` family deletion + navigation/navigator/`index.ts` updates + `make-navigable.ts`.
   Run `pnpm --filter @gotgenes/pi-subagents run verify:public-types` here (surface should be unchanged).
7. `fix(pi-subagents): honest messages and transcript pointer for released sessions (#617)` — red: `get-result-report.test.ts` (`transcriptPath` line), `get-result-tool.test.ts` (degraded verbose note), `agent-tool.test.ts` (released-resume message), `steer-tool.test.ts`/not-found copy; green: report field + message updates.
8. `docs(pi-subagents): update architecture, README, and skill for consumption-aware retention (#617)` — architecture module tree + homeless-field clause, README evicted wording + settings keys, SKILL.md Observation row.

Each step ends with `pnpm --filter @gotgenes/pi-subagents exec vitest run` and `pnpm run check`; step 6 changes a shared interface surface, so run the full `pnpm -r run test` there and at the end.

## Risks and Mitigations

- **Unconsumed sessions held up to 12 h** — the cost of the always-pull contract: a parent that reads the nudge preview and never pulls leaves the session pinned until the cap.
  Accepted by design (operator-confirmed): retrieval responsibility is the parent's; the always-present retrieval instruction reinforces it, and the configurable cap bounds the cost.
- **Record map grows for the session lifetime** — records are result-string sized (KBs); the map is cleared at session boundaries; the widget's turn-age policy keeps the UI unaffected.
  `finishedTurnAge` entries now persist alongside records — same order of growth, same boundary cleanup.
- **Double-dispose of a released session** — `releaseSession` clears the reference; `disposeSession()` becomes a no-op; pinned by an explicit test (Invariants).
- **Fake-timer hazards** — the sweep uses `setInterval`; tests must use `vi.advanceTimersByTimeAsync(ms)`, never `runAllTimersAsync` (testing skill).
- **Consumption races (wait-path vs nudge)** — post-report mark lands within the 200 ms hold; fire-time re-check is the backstop; migrated Bug-1 tests pin both.
- **Step 6 is the large step** — the `EvictedSubagent` export removal forces manager + navigation + navigator + `index.ts` + tests into one commit (export-removal rule); steps 1–5 deliberately land every prerequisite first so step 6 is wiring, not invention.

## Open Questions

- Should `SubagentRecord` (service surface) expose `consumedAt`?
  Additive if a cross-extension consumer ever wants it; the allowlist serializer makes it a one-line opt-in later.
- Service-level consumption (an explicit `consumeResult(id)` for RPC spawners) — defer until a real consumer surfaces; the unconsumed cap bounds the cost of not having it.
- Whether the `snapshot` picker label wording ("session released (snapshot)") should surface retention timing — cosmetic, decide at implementation.
