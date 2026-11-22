---
issue: 381
issue_title: "Replace ConcurrencyQueue with a thunk-based ConcurrencyLimiter"
---

# Replace ConcurrencyQueue with a thunk-based ConcurrencyLimiter

## Problem Statement

The `ConcurrencyQueue` stores background-agent IDs and decides *when* to start them, but it cannot start an agent itself.
It compensates with a `startAgent(id)` callback that reaches back into the manager (`getRecord(id)`, status check, `run()`) — a dependency back-edge that forces forward-referenced bindings in both `index.ts` and the manager test helper.
The queue also keeps its own `running` counter, fed by `markStarted`/`markFinished` relays in the manager's observer, duplicating state the agents already carry.
A queued agent has `promise === undefined` until the queue starts it, which is the direct cause of `waitForAll`'s `while (true)` drain loop and its `eslint-disable`.

These are three symptoms of one root cause: the queue schedules *identifiers it cannot act on* instead of *work it can run*.
Scheduling thunks (`() => Promise<void>`) instead of IDs dissolves all three at the source.

This is Phase 17 Step 1 (core consolidation), recorded in `docs/architecture/architecture.md` under "Improvement roadmap (Phase 17 — core consolidation)".
It unblocks Phase 17 Step 3 ([#374], run-start encapsulation).

## Goals

- Replace `ConcurrencyQueue` (ID registry + back-edge callback) with a `ConcurrencyLimiter` that schedules run closures FIFO against a dynamic limit and knows nothing about agents, IDs, or the manager.
- Make the dependency direction strictly `SubagentManager → ConcurrencyLimiter`: no callback back-edge, no forward-referenced bindings.
- Derive the active count from the limiter's own task lifecycle (increment on task start, decrement on settle); delete the observer's `markStarted`/`markFinished` relays.
- Give every spawned agent a real `promise` at spawn time, collapsing `waitForAll`'s `while (true)` drain loop and its `eslint-disable`.
- This is a non-breaking internal refactor: the FIFO admission behavior against `maxConcurrent` is preserved, and no public API, config key, or observable behavior changes.

## Non-Goals

- Renaming the `bypassQueue` spawn option.
  It is part of the published `SubagentsService` type surface (`src/service/service.ts`), so renaming it would churn the type bundle and break consumers — out of scope; track in Open Questions.
- Folding the queued-status guard into `Subagent.start()` — that is Phase 17 Step 3 ([#374]).
  This plan keeps the guard inside the scheduled thunk.
- Extracting `SubagentState` or making execution deps mandatory ([#373], Step 2).
- Any change to foreground execution (`spawnAndWait`) or to `bypassQueue` runs — both continue to invoke `record.run()` directly, never touching the limiter.
- Touching `src/service/service.ts` or `src/service/service-adapter.ts` — `bypassQueue` flows through unchanged.

## Background

Relevant modules:

- `src/lifecycle/concurrency-queue.ts` — the current `ConcurrencyQueue`: `isFull`, `enqueue`, `dequeue`, `markStarted`, `markFinished`, `drain`, `clear`, `queuedIds`.
  Stores IDs; `drain()` calls the injected `startAgent(id)` back-edge.
- `src/lifecycle/subagent-manager.ts` — injects the queue via `SubagentManagerOptions.queue`.
  `buildObserver` relays `markStarted`/`markFinished`; `spawn` enqueues when `isFull()`; `abort` calls `dequeue`; `abortAll` iterates `queuedIds` + `clear()`; `waitForAll` loops `drain()` + `Promise.allSettled`; `dispose` calls `clear()`.
- `src/index.ts` — constructs the queue with a `startAgent` callback that forward-references the manager (`manager.getRecord(id)` then `agent.run()`); wires `settings.onMaxConcurrentChanged` to `queue.drain()`.
- `src/lifecycle/subagent.ts` — `run()` sets status to `running` synchronously (`markRunning`) before its first `await`; `run()` always resolves (errors captured internally).
  `abort()` acts only on `running` agents; its docstring references `ConcurrencyQueue.dequeue()`.
- `test/lifecycle/subagent-manager.test.ts` — `createManager` helper replicates the `index.ts` start callback with a `prefer-const` `eslint-disable` for the forward reference.
- `test/lifecycle/concurrency-queue.test.ts` — unit tests for the queue (drain ordering, `markStarted`/`markFinished` counting, `enqueue`/`dequeue`).

Constraints from AGENTS.md and skills:

- ES2024 `Promise.withResolvers` is available and preferred (`code-design` skill).
- The `bypassQueue` field lives in the public type bundle (`exports`, `verify:public-types`); renaming public surface is breaking (`package-pi-subagents` skill).
- `@typescript-eslint/require-await` is enabled for `src/`; a thunk with no `await` must return a `Promise` without `async`.
- Where the old `drain()` used `while (… && !isFull())` with `this.queue.shift()!`, prefer a bounded loop without a non-null assertion (`code-design` Biome/ESLint notes).

The current observer-relay path (`buildObserver` → `queue.markStarted`/`markFinished`) confirmed: the queue's `running` counter mirrors the per-agent status the manager already tracks (the manager filters on `status === "running" || "queued"` in `cleanup`, `clearCompleted`, `hasRunning`, `waitForAll`).
No production caller awaits a *queued* agent's promise (`get-result-tool.ts` guards on `status === "running"`; `spawnAndWait` is foreground; `waitForAll` filters by status), so giving queued agents a settled-on-completion promise is safe.

## Design Overview

### `ConcurrencyLimiter`

A pure FIFO scheduler over thunks.
It owns the active count and the pending queue; it has no knowledge of agents, IDs, or the manager.

```typescript
export class ConcurrencyLimiter {
	private active = 0;
	private readonly pending: Array<{ start: () => void; settle: () => void }> = [];

	constructor(private readonly getLimit: () => number) {}

	/**
	 * Schedule a task to run FIFO once a slot is free.
	 * The returned promise always settles: it follows the task's settlement when
	 * the task runs, or resolves early if clear() drops it before it starts.
	 */
	schedule(task: () => Promise<void>): Promise<void> {
		const { promise, resolve, reject } = Promise.withResolvers<void>();
		this.pending.push({
			start: () => {
				this.active++;
				task().then(resolve, reject).finally(() => {
					this.active--;
					this.recheck();
				});
			},
			settle: resolve,
		});
		this.recheck();
		return promise;
	}

	/** Start pending tasks until the limit is reached. Call when the limit may have grown. */
	recheck(): void {
		while (this.active < this.getLimit()) {
			const next = this.pending.shift();
			if (!next) break;
			next.start();
		}
	}

	/** Drop all pending tasks, resolving their promises without running them. */
	clear(): void {
		const dropped = this.pending.splice(0);
		for (const task of dropped) task.settle();
	}
}
```

Design decisions:

- **Active count derived from task lifecycle.**
  `active++` happens synchronously inside `start()` before the task's first `await`; `active--` runs in `finally`.
  This replaces the queue's `running` counter and the two observer relays.
- **`recheck()` is bounded.**
  The loop terminates when the limit is reached or the pending queue empties — no `while (true)`, no `this.pending.shift()!` non-null assertion.
- **`clear()` settles dropped promises.**
  Every `schedule()` promise becomes `record.promise`; the contract is that it always settles.
  Dropping a thunk without resolving would leave a forever-pending `record.promise`.
  `clear()` resolves dropped tasks so `dispose()`/`abortAll()` cannot strand a promise. (This is a few lines beyond the issue's "~40 lines" sketch; the extra `settle` handle is the deliberate cost of that invariant.)
- **Synchronous start.**
  When a slot is free, `schedule()` runs the thunk synchronously inside `recheck()`, so `record.run()` executes its synchronous prefix (`markRunning`) immediately — preserving today's behavior where `record.promise = record.run()` flips status to `running` at once.

### Manager spawn call site

```typescript
// spawn(), background and not bypassQueue:
record.promise = this.limiter.schedule(() => {
	// Guard: an abort-while-queued task is a no-op (Step 3 folds this into Subagent.start()).
	if (record.status !== "queued") return Promise.resolve();
	return record.run();
});
// foreground or bypassQueue:
record.promise = record.run();
```

This is Tell-Don't-Ask toward the limiter: the manager hands it work, the limiter decides timing.
The status guard replaces `dequeue` — an aborted queued agent (status `stopped`) becomes a no-op when its slot finally opens.

### Manager lifecycle methods

- `buildObserver` — drop the `markStarted` (in `onStarted`) and `markFinished` (in `onRunFinished`) relays; `onRunFinished` keeps the background `onSubagentCompleted` dispatch.

- `abort(id)` — for a `queued` agent, just `record.markStopped()` (no `dequeue`); otherwise `record.abort()`.

- `abortAll()` — iterate agents: `markStopped()` each `queued` agent (count it), else `record.abort()`; then `this.limiter.clear()` to drop pending thunks (their promises resolve).

- `waitForAll()` — every spawned agent has a `promise`, so the manual `drain()` loop collapses:

  ```typescript
  async waitForAll(): Promise<void> {
   let pending = this.pendingPromises();
   while (pending.length > 0) {
    await Promise.allSettled(pending);
    pending = this.pendingPromises();
   }
  }

  private pendingPromises(): Promise<void>[] {
   return [...this.agents.values()]
    .filter(r => r.status === "running" || r.status === "queued")
    .map(r => r.promise)
    .filter((p): p is Promise<void> => p != null);
  }
  ```

  The re-check loop is no longer `while (true)` and no longer drives scheduling — the limiter auto-starts queued agents as slots free, so a single `allSettled` covers the queued case.
  The loop survives only to catch agents spawned *during* the wait.
  The `eslint-disable @typescript-eslint/no-unnecessary-condition` is deleted.

- `dispose()` — `this.limiter.clear()` (unchanged in intent).

### `index.ts` wiring

```typescript
const settings = new SettingsManager({
	// …
	onMaxConcurrentChanged: () => limiter.recheck(), // forward-ref closure (settings → limiter); benign
});
settings.load();
// …
const limiter = new ConcurrencyLimiter(() => settings.maxConcurrent);
const manager = new SubagentManager({ /* … */ limiter, /* … */ });
```

The only surviving forward reference is `settings → limiter` (a runtime-only closure, the same shape as today's `settings → queue.drain`).
The `limiter → manager` back-edge (the `startAgent` callback and its explanatory comment) is **deleted entirely** — that is the structural win.

### Edge cases

- **Abort while queued** — `markStopped()` flips status; the scheduled thunk, when run, returns `Promise.resolve()` (no-op), settling `record.promise`.
- **Limit decreased below active count** — `recheck()` simply starts nothing (`active < getLimit()` is false); in-flight tasks finish normally.
- **Limit increased** — `onMaxConcurrentChanged → limiter.recheck()` starts newly-admissible pending tasks.
- **`clear()` with in-flight tasks** — only *pending* tasks are dropped; running tasks complete and `active--` on settle.

## Module-Level Changes

| File                                         | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lifecycle/concurrency-limiter.ts`       | Add — new `ConcurrencyLimiter` (`schedule`, `recheck`, `clear`).                                                                                                                                                                                                                                                                                                                                                                                                              |
| `src/lifecycle/concurrency-queue.ts`         | Remove — replaced by the limiter.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `src/lifecycle/subagent-manager.ts`          | Change — import limiter; `SubagentManagerOptions.queue` → `limiter: ConcurrencyLimiter` and the private field; drop `markStarted`/`markFinished` from `buildObserver`; `spawn` schedules a status-guarded thunk; `abort` drops `dequeue`; `abortAll` iterates agents + `limiter.clear()`; `waitForAll` simplified (add `pendingPromises` helper, delete the `while (true)` loop and its `eslint-disable`); `dispose` calls `limiter.clear()`; update the file-header comment. |
| `src/lifecycle/subagent.ts`                  | Change — `abort()` docstring: remove the `ConcurrencyQueue.dequeue()` reference (queue removal is now a status-guard no-op).                                                                                                                                                                                                                                                                                                                                                  |
| `src/index.ts`                               | Change — import `ConcurrencyLimiter`; construct it as `new ConcurrencyLimiter(() => settings.maxConcurrent)`; `onMaxConcurrentChanged: () => limiter.recheck()`; delete the `startAgent` callback and its forward-ref comment; inject `limiter` into the manager.                                                                                                                                                                                                             |
| `test/lifecycle/concurrency-limiter.test.ts` | Add — limiter unit tests (no `startAgent` mock).                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `test/lifecycle/concurrency-queue.test.ts`   | Remove — the queue is gone.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `test/lifecycle/subagent-manager.test.ts`    | Change — `createManager` constructs a `ConcurrencyLimiter`; delete the forward-ref `let mgr` + `prefer-const` `eslint-disable`; drop the unused `queue` field from the returned object.                                                                                                                                                                                                                                                                                       |
| `docs/architecture/architecture.md`          | Change — Mermaid lifecycle node (`ConcurrencyQueue<br/>(scheduling, drain)` → `ConcurrencyLimiter<br/>(thunk admission gate)`); layout listing (`concurrency-queue.ts` → `concurrency-limiter.ts`); "What the core owns" bullet; mark roadmap Step 1 done; fix the Step 7 ([#378]) target filename reference.                                                                                                                                                                 |
| `.pi/skills/package-pi-subagents/SKILL.md`   | Change — lifecycle-domain table: `concurrency-queue.ts` → `concurrency-limiter.ts` and adjust the "scheduling" wording to "concurrency admission".                                                                                                                                                                                                                                                                                                                            |

Verified by grep that no other `src/`, `test/`, `docs/` (excluding `docs/architecture/history/` and prior plans/retros, which are historical), or `.pi/skills/` file references `ConcurrencyQueue`, `concurrency-queue`, `enqueue`, `dequeue`, `markStarted`/`markFinished` (queue), `drain`, `isFull`, or `queuedIds` for this queue.
`SKILL.md` line 80 (Phase 15 history) keeps `ConcurrencyQueue` — it is a historical record, not current state.

## Test Impact Analysis

1. **New tests the change enables.**
   `ConcurrencyLimiter` is a pure thunk scheduler with no agent/manager knowledge, so it is unit-testable with plain `() => Promise<void>` tasks and `Promise.withResolvers` gates — no `startAgent` mock, no re-entrant `markStarted` simulation.
   New coverage: FIFO start order; slot gating (only `limit` tasks run concurrently); `active` decrement frees a slot for the next pending task on settle; `recheck()` starts newly-admissible tasks when the limit grows; dynamic limit re-evaluation; `clear()` resolves pending promises without running their tasks; a task that rejects still frees its slot.
2. **Tests that become redundant.**
   The entire `test/lifecycle/concurrency-queue.test.ts` (`isFull`, `enqueue`/`dequeue`, `markStarted`/`markFinished`, `drain`, auto-drain, `clear`, `queuedIds`) — those methods no longer exist; the limiter tests replace them at a cleaner seam.
3. **Tests that stay as-is (genuinely exercise the layer).**
   The `SubagentManager — queueing and concurrency with injected stubs` describe block asserts manager-level behavior (queued → running transition order, abort-while-queued never runs the factory, `onSubagentStarted` fires on the queued → running transition).
   These remain valid against the manager + limiter integration and need only the `createManager` helper change (construct a `ConcurrencyLimiter`), not a behavioral rewrite.
   The `clearCompleted does not remove running or queued agents` test (maxConcurrent=1, blocking factory) also stays.

## TDD Order

Priority = preparatory addition first, then the atomic interface swap, then docs.

1. **Add `ConcurrencyLimiter` (red → green).**
   Surface: new `test/lifecycle/concurrency-limiter.test.ts` against new `src/lifecycle/concurrency-limiter.ts`.
   Covers FIFO start order, slot gating, `active`-frees-slot-on-settle, `recheck()` on limit growth, dynamic limit, `clear()` resolves pending without running, reject-frees-slot.
   Pure addition — `ConcurrencyQueue` still exists and its tests still pass; the suite stays green.
   Commit: `feat(pi-subagents): add ConcurrencyLimiter (#381)`.

2. **Migrate `SubagentManager`, `index.ts`, and the manager test helper to the limiter; delete the queue (red → green).**
   Surface: `src/lifecycle/subagent-manager.ts`, `src/index.ts`, `src/lifecycle/subagent.ts` (docstring), `test/lifecycle/subagent-manager.test.ts`, and deletion of `src/lifecycle/concurrency-queue.ts` + `test/lifecycle/concurrency-queue.test.ts`.
   This is one atomic commit: changing `SubagentManagerOptions.queue` → `limiter` breaks both call sites (`index.ts` and the test helper) at the type level simultaneously, and the old test file imports the deleted source — all must land together.
   Drop the observer relays, the `dequeue`/`drain`/`isFull`/`queuedIds` usage, the `while (true)` loop + its `eslint-disable`, and the test helper's forward-ref `eslint-disable`.
   Run `pnpm run check` immediately after (shared-interface change with multiple call sites), then the full `pnpm --filter @gotgenes/pi-subagents exec vitest run` (the queueing/concurrency integration tests must still pass).
   Commit: `refactor(pi-subagents): replace ConcurrencyQueue with thunk-based ConcurrencyLimiter (#381)`.

3. **Update architecture doc and package skill (docs).**
   Surface: `docs/architecture/architecture.md` (Mermaid node, layout listing, "What the core owns" bullet, roadmap Step 1 marked done, Step 7 filename reference) and `.pi/skills/package-pi-subagents/SKILL.md` (lifecycle-domain table entry + wording).
   Commit: `docs(pi-subagents): update architecture and skill for ConcurrencyLimiter (#381)`.

## Risks and Mitigations

| Risk                                                                   | Mitigation                                                                                                                                                                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A dropped pending thunk leaves `record.promise` forever pending.       | `clear()` resolves dropped tasks' promises; the limiter's contract is that every `schedule()` promise settles.                                                                                                |
| `waitForAll` could spin or miss queued agents.                         | Queued agents now carry real promises, so a single `Promise.allSettled` covers them; the bounded re-check loop only catches agents spawned during the wait, and terminates when `pendingPromises()` is empty. |
| An abort-while-queued no-op thunk briefly occupies a slot.             | The thunk returns a synchronously-resolved promise; `active++`/`active--` round-trip in one microtask and `recheck()` immediately pulls the next task — negligible.                                           |
| Renaming the file/class leaves stale references.                       | Grep-verified inventory in Module-Level Changes; the migration deletes the source and its test in the same commit; docs updated in step 3.                                                                    |
| `bypassQueue` public-surface name now slightly misnames the mechanism. | Out of scope (breaking); recorded in Open Questions.                                                                                                                                                          |

## Open Questions

- Should `bypassQueue` be renamed (e.g. `bypassLimiter`) for accuracy?
  It is public type surface, so a rename is breaking and belongs in its own change — defer.
- Should the `code-design` "narrow interface, not concrete class" guidance be applied to the manager's `limiter` field (typed as `{ schedule; clear }` rather than the concrete `ConcurrencyLimiter`)?
  Tests construct a real limiter (it is pure and trivially constructible), so no mock-cast pressure exists today; keep the concrete type to match the issue and existing pattern, and revisit only if a test needs to substitute it.

[#373]: https://github.com/gotgenes/pi-packages/issues/373
[#374]: https://github.com/gotgenes/pi-packages/issues/374
[#378]: https://github.com/gotgenes/pi-packages/issues/378
