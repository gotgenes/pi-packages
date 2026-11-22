---
issue: 256
issue_title: "Extract WorktreeIsolation collaborator"
---

# Extract WorktreeIsolation collaborator

## Problem Statement

`Agent` currently holds three separate worktree-related members — `_worktrees` (a shared `WorktreeManager`), `_isolation` (the `IsolationMode`), and `worktreeState` (a `WorktreeState` phase object) — and orchestrates the worktree internals itself.
It checks `this._isolation !== "worktree"`, calls `this._worktrees.create()`, constructs the `WorktreeState`, and drives `worktreeState.performCleanup(this._worktrees, ...)` from both `completeRun()` and `failRun()`.
This is Ask-Don't-Tell: `Agent` asks its collaborators for raw materials and does the worktree work itself rather than telling a single collaborator to handle its own lifecycle.

This is Phase 16, Step 1 of the agent-collaborator architecture (`docs/architecture/architecture.md`).

## Goals

- Introduce a `WorktreeIsolation` collaborator that owns the entire worktree lifecycle: `setup()`, `path` access, and `cleanup(description)`.
- `AgentManager` constructs the collaborator only when `isolation === "worktree"` and passes it to `Agent` ready to go.
- Replace `Agent`'s mode check (`this._isolation !== "worktree"`) with a null check (`this.worktree?.setup()`).
- Fold the existing `WorktreeState` value object into `WorktreeIsolation` (delete `worktree-state.ts`), matching the architecture's target table which lists `WorktreeIsolation` as absorbing `worktrees` + `isolation` + `worktreeState`.
- Shrink `Agent`: remove `_worktrees`, `_isolation`, `worktreeState`, and `setupWorktree()`; add a single `worktree?: WorktreeIsolation` collaborator.

This change is **not** breaking to any published API — `WorktreeManager`, `WorktreeState`, and `AgentInit` are all internal to the package.

## Non-Goals

- No changes to the runner, session creation, or `ChildSessionFactory` — that is Step 2 (#257).
- No changes to `Agent.run()`'s session-interaction logic, turn-limit enforcement, or response collection — that is Step 3 (#258).
- No changes to the low-level git plumbing in `worktree.ts` (`createWorktree`, `cleanupWorktree`, `pruneWorktrees`, `GitWorktreeManager`) — those free functions and the `WorktreeManager` interface stay as-is.
- No change to the `worktreeResult` shape exposed by `service-adapter.ts` — only the access path changes.

## Background

Relevant modules:

- `src/lifecycle/agent.ts` — the `Agent` class.
  Holds `_worktrees: WorktreeManager`, `_isolation: IsolationMode`, `worktreeState?: WorktreeState`; defines `setupWorktree()`; reads `this.worktreeState?.path` for the runner `cwd`; drives cleanup in `completeRun()` / `failRun()`.
- `src/lifecycle/agent-manager.ts` — `AgentManager` holds the shared `WorktreeManager` (`this.worktrees`), passes `worktrees` + `isolation` into each `Agent` via `AgentInit`, and calls `this.worktrees.prune()` on `dispose()`.
- `src/lifecycle/worktree.ts` — `WorktreeManager` interface + `GitWorktreeManager` impl + free functions.
  `WorktreeManager.cleanup(wt, description)` mutates `wt.branch` in place (in `cleanupWorktree`), so the object passed must carry a writable `branch`.
- `src/lifecycle/worktree-state.ts` — `WorktreeState`: holds `path`/`branch`, tracks `cleanupResult`, exposes `performCleanup(worktrees, description)`.
  Re-exports `WorktreeCleanupResult` and `WorktreeInfo` (no external consumer imports those two from this path — verified by grep).
- `src/service/service-adapter.ts:131` — reads `record.worktreeState?.cleanupResult` to populate `worktreeResult`.
- `src/index.ts:167` — constructs `new GitWorktreeManager(process.cwd())` and passes it to `AgentManager`.

AGENTS.md constraints that apply:

- This package targets ES2024; Biome (not Prettier) formats.
- Tests use `vi.hoisted(...)` patterns; the full vitest suite must pass before publishing.
- When a barrel/module gains exports, verify a consumer imports them — fallow flags speculative re-exports.
  Here we are removing a module, not adding one, so the risk is dangling imports rather than dead exports.

## Design Overview

### Decision model

`AgentManager` owns the shared `WorktreeManager` (one instance, repo-root-bound).
Per spawn, when `isolation === "worktree"`, it constructs a per-agent `WorktreeIsolation` bound to that `WorktreeManager` and the agent id, and hands it to `Agent`.
When isolation is not requested, no collaborator is created and `Agent.worktree` is `undefined`.

`Agent` no longer knows the isolation mode or the `WorktreeManager`.
The presence/absence of the collaborator *is* the mode: `this.worktree?.setup()` and `this.worktree?.cleanup(...)`.

### WorktreeIsolation shape

```typescript
// src/lifecycle/worktree-isolation.ts
import type { WorktreeCleanupResult, WorktreeInfo, WorktreeManager } from "#src/lifecycle/worktree";

export class WorktreeIsolation {
	private _info?: WorktreeInfo;
	private _cleanupResult?: WorktreeCleanupResult;

	constructor(
		private readonly worktrees: WorktreeManager,
		private readonly agentId: string,
	) {}

	/** Absolute worktree path — undefined before setup(). */
	get path(): string | undefined {
		return this._info?.path;
	}

	/** Cleanup outcome — undefined until cleanup() runs. */
	get cleanupResult(): WorktreeCleanupResult | undefined {
		return this._cleanupResult;
	}

	/**
	 * Create the git worktree and store its info.
	 * Throws on failure (strict isolation — no silent fallback).
	 */
	setup(): void {
		const wt = this.worktrees.create(this.agentId);
		if (!wt) {
			throw new Error(
				'Cannot run with isolation: "worktree" — not a git repo, no commits yet, or `git worktree add` failed. ' +
				"Initialize git and commit at least once, or omit `isolation`.",
			);
		}
		this._info = wt;
	}

	/** Perform cleanup and record the result. No-op ({ hasChanges: false }) if setup never ran. */
	cleanup(description: string): WorktreeCleanupResult {
		if (!this._info) return { hasChanges: false };
		const result = this.worktrees.cleanup(this._info, description);
		this._cleanupResult = result;
		return result;
	}
}
```

Notes:

- `_info` is a mutable `WorktreeInfo`, so `WorktreeManager.cleanup` mutating `branch` in place keeps working (the same behavior `WorktreeState` relied on today).
- The `missing worktrees dependency` error from `setupWorktree()` disappears: the collaborator is only ever created with a `WorktreeManager`, so that defensive branch is structurally impossible.
- `cleanup()` returns `{ hasChanges: false }` when `setup()` never ran, so `Agent`'s `completeRun()`/`failRun()` can call it unconditionally via the optional-chain without a separate guard.

### Agent call sites (Tell-Don't-Ask)

`Agent.run()` setup:

```typescript
try {
	this.worktree?.setup();   // was: this.setupWorktree() with internal mode check
} catch (err) {
	this.markError(err);
	this.releaseListeners();
	this.observer?.onRunFinished?.(this);
	return;
}
// ...
cwd: this.worktree?.path,   // was: this.worktreeState?.path
```

`Agent.completeRun()`:

```typescript
let finalResult = result.responseText;
const wtResult = this.worktree?.cleanup(this.description);
if (wtResult?.hasChanges && wtResult.branch) {
	finalResult += `\n\n---\nChanges saved to branch \`${wtResult.branch}\`. Merge with: \`git merge ${wtResult.branch}\``;
}
```

`Agent.failRun()`:

```typescript
try {
	this.worktree?.cleanup(this.description);
} catch (cleanupErr) {
	debugLog("cleanupWorktree on agent error", cleanupErr);
}
```

`AgentManager.spawn()`:

```typescript
const worktree = options.isolation === "worktree"
	? new WorktreeIsolation(this.worktrees, id)
	: undefined;
const record = new Agent({ /* ... */, worktree /* was: worktrees + isolation */ });
```

The reach-through `agent.worktreeState.cleanupResult` in `service-adapter.ts` becomes `agent.worktree?.cleanupResult` — the collaborator owns the result, so this is a single-hop access, not a reach-through into a phase object.

### Edge cases

- Isolation not requested → `worktree` is `undefined` → `setup()`/`cleanup()` are skipped via optional chaining; behavior identical to today's `_isolation !== "worktree"` early-return.
- `create()` returns `undefined` (not a git repo) → `setup()` throws; `Agent.run()` catches, marks error, releases listeners, fires `onRunFinished`.
  The existing AgentManager regression test (worktree fails loud, no silent fallback) is preserved.
- Cleanup throws in `failRun()` → caught and logged best-effort, identical to today.

## Module-Level Changes

- New: `src/lifecycle/worktree-isolation.ts` — the `WorktreeIsolation` class (shape above).
- Changed: `src/lifecycle/agent.ts`
  - Remove imports of `WorktreeManager` (type) and `WorktreeState`; add import of `WorktreeIsolation`.
  - `AgentInit`: remove `worktrees?: WorktreeManager` and `isolation?: IsolationMode`; add `worktree?: WorktreeIsolation`.
    (`IsolationMode` may remain imported if still referenced elsewhere in the file; grep confirms it is only used for the removed field — remove the now-unused import.)
  - Remove instance fields `_worktrees`, `_isolation`, `worktreeState`; add `worktree?: WorktreeIsolation`.
  - Remove the `setupWorktree()` method.
  - Constructor: replace the `_worktrees`/`_isolation` assignments with `this.worktree = init.worktree`.
  - `run()`: `this.worktree?.setup()`; `cwd: this.worktree?.path`.
  - `completeRun()` / `failRun()`: replace the 4-line `worktreeState && _worktrees` blocks with `this.worktree?.cleanup(this.description)`.
  - Update the file header doc comment (lists `worktreeState` as a phase-specific collaborator).
- Changed: `src/lifecycle/agent-manager.ts`
  - Import `WorktreeIsolation`.
  - `spawn()`: construct the per-agent `WorktreeIsolation` when `options.isolation === "worktree"`; pass `worktree` to `Agent` instead of `worktrees` + `isolation`.
  - Keep `this.worktrees` field, `AgentManagerOptions.worktrees`, and the `dispose()` → `this.worktrees.prune()` call unchanged.
- Changed: `src/service/service-adapter.ts`
  - `record.worktreeState?.cleanupResult` → `record.worktree?.cleanupResult`.
- Removed: `src/lifecycle/worktree-state.ts` (folded into `WorktreeIsolation`).
- Doc updates (`docs/architecture/architecture.md`):
  - Class diagram (line ~115): `+worktreeState?: WorktreeState` → `+worktree?: WorktreeIsolation`; remove the `+setupWorktree(...)` method line.
  - Layout listing (lines ~279–280): replace `worktree-state.ts  worktree phase state` with `worktree-isolation.ts  worktree lifecycle collaborator`.
- Doc update (`.pi/skills/package-pi-subagents/SKILL.md`): Lifecycle domain row — replace `worktree-state.ts` with `worktree-isolation.ts` (module count stays 9).

Symbols removed and their consumers (grepped across `src/` and `test/`):

- `WorktreeState` (class): `src/lifecycle/agent.ts` (removed in this plan), `test/lifecycle/agent.test.ts`, `test/service/service-adapter.test.ts`, `test/lifecycle/worktree-state.test.ts` — all updated/removed below.
- `Agent.setupWorktree()`: only `test/lifecycle/agent.test.ts` — removed below.
- `Agent.worktreeState`: `service-adapter.ts` + several tests — all migrated to `worktree`.
- The `WorktreeCleanupResult`/`WorktreeInfo` re-exports from `worktree-state.ts`: no external importer (verified) — safe to drop.

## Test Impact Analysis

1. New unit tests enabled by the extraction: `WorktreeIsolation` is now independently testable without an `Agent` — `worktree-isolation.test.ts` covers `setup()` (success stores path; failure throws), `cleanup()` (delegates to `worktrees.cleanup` with stored info + description, records `cleanupResult`; no-op before setup), and `path`/`cleanupResult` getters.
   These absorb the existing `worktree-state.test.ts` coverage (constructor, `recordCleanup`, `performCleanup`) at the same granularity.
2. Existing tests that become redundant / simplified: `test/lifecycle/worktree-state.test.ts` is removed (its behavior is covered by the new collaborator tests).
   The `Agent — setupWorktree` describe block in `agent.test.ts` is removed (the method is gone); its intent migrates to the `WorktreeIsolation` unit tests plus the existing `Agent.run() — worktree` integration tests.
3. Existing tests that must stay (genuinely exercise the layer): `test/lifecycle/worktree.test.ts` (git plumbing + `GitWorktreeManager`) is untouched.
   `Agent.run() — worktree` integration tests stay but switch their assertions from `agent.worktreeState` to `agent.worktree` and construct the agent with a `WorktreeIsolation`.
   `agent-manager.test.ts` worktree tests stay but assert via `record.worktree?.path` / `record.worktree?.cleanupResult`.

## TDD Order

1. Add `WorktreeIsolation` with unit tests — new module, no consumers yet.
   Surface: `test/lifecycle/worktree-isolation.test.ts`.
   Covers: `setup()` success/failure, `cleanup()` delegation + result recording + pre-setup no-op, `path`/`cleanupResult` getters (migrating `worktree-state.test.ts` coverage).
   Commit: `test: add WorktreeIsolation collaborator tests` then `feat(pi-subagents): add WorktreeIsolation collaborator`. (May be a single `feat` commit with the test if preferred — the module is self-contained.)
2. Wire `WorktreeIsolation` into `Agent` and `AgentManager`; drop the old fields.
   This is one commit because TypeScript will not accept `AgentInit` losing `worktrees`/`isolation` while call sites still pass them.
   Changes: `agent.ts` (remove `_worktrees`/`_isolation`/`worktreeState`/`setupWorktree`, add `worktree`, update `run`/`completeRun`/`failRun`), `agent-manager.ts` (construct collaborator in `spawn`), `service-adapter.ts` (`record.worktree?.cleanupResult`), and their tests (`agent.test.ts` helpers `createRunnableAgent`/`createAgentWithWorktrees` + worktree describe blocks; remove the `setupWorktree` block; `agent-manager.test.ts` worktree assertions; `service-adapter.test.ts` setup).
   Commit: `refactor(pi-subagents): Agent delegates worktree lifecycle to WorktreeIsolation`.
3. Delete the now-orphaned `WorktreeState`.
   Remove `src/lifecycle/worktree-state.ts` and `test/lifecycle/worktree-state.test.ts`; remove any remaining `WorktreeState` imports.
   Run `pnpm fallow dead-code` to confirm no dangling exports.
   Commit: `refactor(pi-subagents): remove WorktreeState, folded into WorktreeIsolation`.
4. Update architecture doc + package skill.
   `docs/architecture/architecture.md` class diagram + layout listing; `SKILL.md` Lifecycle domain row.
   Commit: `docs(pi-subagents): reflect WorktreeIsolation extraction in architecture`.

After all steps: `pnpm run check`, `pnpm run lint`, `pnpm -r run test`, `pnpm fallow dead-code`.

## Risks and Mitigations

- Risk: `WorktreeManager.cleanup` mutates `branch` in place; folding `WorktreeState` could lose that behavior.
  Mitigation: `WorktreeIsolation` stores a mutable `WorktreeInfo` (`_info`) and passes it directly to `cleanup`, preserving the in-place mutation.
- Risk: a hidden consumer imports `WorktreeCleanupResult`/`WorktreeInfo` from `worktree-state.ts`.
  Mitigation: grep confirms all consumers import those types from `worktree.ts`; the deletion step re-runs the grep and `pnpm run check`.
- Risk: the combined Step 2 commit touches several test files at once.
  Mitigation: the changes are mechanical and localized to worktree-specific helpers/describe blocks; the type checker pinpoints every call site.
  The bulk of `agent.test.ts` is untouched.
- Risk: AgentManager's `dispose()` prune path relies on `this.worktrees`.
  Mitigation: `AgentManager` keeps ownership of the shared `WorktreeManager`; only per-agent collaborator construction is added.

## Open Questions

- Whether `setup()` should return the path (as `setupWorktree()` did) for symmetry.
  Deferred: no caller needs the return value once `Agent` reads `this.worktree?.path`; keep `setup(): void` until a consumer needs otherwise.
- Whether `WorktreeIsolation` should later absorb the parent `cwd`/repo-root concern from `GitWorktreeManager`.
  Deferred to the broader Phase 16 collaborator work; out of scope for Step 1.
