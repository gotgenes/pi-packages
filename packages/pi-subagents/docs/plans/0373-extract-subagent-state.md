---
issue: 373
issue_title: "Extract SubagentState; make Subagent execution deps mandatory"
---

# Extract `SubagentState`; make `Subagent` execution deps mandatory

## Problem Statement

`Subagent` is simultaneously a passive record and an executor.
Its `SubagentInit` carries ~20 fields — nearly all optional with "required for `run()`, optional for tests" semantics — and `run()` compensates with two runtime guards that throw `"Subagent not configured for execution"`.
This violates the construct-complete principle: one class is both a display-only snapshot (tests and the UI read `.status`/`.result`/stats) and an executor (production wires the session factory, observer, run config, and workspace provider).

The earlier framing — split `SubagentInit` into a present-or-absent `SubagentRunSpec` + `SubagentExecutionDeps` pair — only *type-encodes* the duality; it does not remove it.
The stronger move (captured in the architecture doc's "First-principles refinement") observes that the passive-record need is *test-only*: production constructs a `Subagent` in exactly one place (`SubagentManager.spawn`), always fully wired.
So the readable state is the common denominator (extract it as a value object), and the execution deps are the optional-only-for-tests part (make them mandatory; push the passive case into the test factory).

## Goals

- Extract `SubagentState` — a value object owning status, result, error, timestamps, and stats (`toolUses`, `lifetimeUsage`, `compactionCount`) plus their transition (`markRunning`, `markCompleted`, …) and accumulation (`incrementToolUses`, `addUsage`, `incrementCompactions`) methods.
- `Subagent` holds one `SubagentState` privately; its existing getters and `markX`/`incrementX`/`addUsage` methods become one-line delegations, leaving the ~40 read sites and the external mutation callers (`markStopped` in the manager, `markCompleted` in `get-result-tool.test.ts`) unchanged.
- Collapse the ~12 remaining execution inputs into a single **mandatory** `SubagentExecution` collaborator; `SubagentManager.spawn` always supplies it.
- Delete the two `"not configured for execution"` throws in `run()` — impossible by construction.
- Move the passive-record construction entirely into `test/helpers/make-subagent.ts`.
- Retarget `subscribeSubagentObserver` at `SubagentState` so state-machine and observer tests need no stub execution.

This change is **not breaking** for the published service surface.
`src/service/service.ts` exposes `SubagentRecord`, `SubagentStatus`, and the spawn-config types — not `SubagentInit` or the `Subagent` constructor.
The read API (getters, `SubagentStatus`) is unchanged; only the internal constructor signature changes.

## Non-Goals

- Hoisting **metrics** (tool uses, token usage, compaction count) into a projection over the child session's event stream — stats stay on `SubagentState` for now (the third of four domains in the refinement, deferred).
- Extracting **result delivery** (`notification` / `resultConsumed`) into its own domain — the fourth domain, deferred.
- Encapsulating run start / making `promise` and `notification` read-only — that is Step 3 (#374); `notification` stays created in the constructor here.
- Extracting run-listener / workspace-bracket collaborators — Step 4 (#375).
- Renaming `record-observer.ts` — only its parameter type changes.

## Background

- `src/lifecycle/subagent.ts` — the class under change.
  State fields (`_status`, `_result`, `_error`, `_startedAt`, `_completedAt`, `_toolUses`, `_lifetimeUsage`, `_compactionCount`) sit behind getters; transition/accumulation methods mutate them.
  `run()` reads the execution inputs and throws if `createSubagentSession`/`snapshot`/`prompt` are missing.
  `resume()` reads `observer` and throws only on a missing session (a genuine runtime condition — kept).
- `src/lifecycle/subagent-manager.ts` — `spawn()` (line ~139) is the **only** production `new Subagent(...)` site; it sets the initial status (`queued` for background so the limiter thunk's `status !== "queued"` guard works, `running` for foreground).
- `src/observation/record-observer.ts` — `subscribeSubagentObserver(session, record, { onCompact })` calls `record.incrementToolUses()`, `record.addUsage(…)`, `record.incrementCompactions()`, and forwards `onCompact(record, info)`.
- `src/lifecycle/usage.ts` — `LifetimeUsage` type and the `addUsage(into, delta)` accumulator that `SubagentState` will own.
- `test/helpers/make-subagent.ts` — `createTestSubagent` builds passive records; stat shorthands apply via mutation methods.
- `test/lifecycle/subagent.test.ts` (~700 LOC) and `test/observation/record-observer.test.ts` — the test files that construct `Subagent` directly.

AGENTS.md / code-design constraints that apply:

- Keep Pi SDK imports out of `SubagentState` — it is a pure value object (imports only `LifetimeUsage`/`addUsage`).
- `Subagent` is exported from the `types.ts` barrel; verify the barrel re-export still resolves after the file split.
- `SubagentStatus` is re-exported by `src/service/service.ts` from `#src/lifecycle/subagent` — keep that import path valid (re-export `SubagentStatus` from `subagent.ts` even if its definition moves to `subagent-state.ts`), so the public type bundle path is unchanged.

## Design Overview

### `SubagentState` value object (`src/lifecycle/subagent-state.ts`)

A pure, independently constructible value object.
`SubagentStatus` moves here (its natural home) and is re-exported from `subagent.ts`.

```ts
export type SubagentStatus =
	| "queued" | "running" | "completed" | "steered"
	| "aborted" | "stopped" | "error";

export interface SubagentStateInit {
	status?: SubagentStatus;
	result?: string;
	error?: string;
	startedAt?: number;
	completedAt?: number;
	// stats always start at zero; callers accumulate via mutation methods
}

export class SubagentState {
	constructor(init?: SubagentStateInit); // status ?? "queued", startedAt ?? Date.now()
	// getters: status, result, error, startedAt, completedAt,
	//          toolUses, lifetimeUsage (Readonly), compactionCount
	// transitions: markRunning, markCompleted, markAborted, markSteered,
	//              markError, markStopped, resetForResume
	// accumulators: incrementToolUses, addUsage, incrementCompactions
}
```

It owns its mutations (no output arguments — methods write only its own private fields) and carries no upstream dependency beyond `usage.ts`.

### `SubagentExecution` collaborator (in `src/lifecycle/subagent.ts`)

```ts
export interface SubagentExecution {
	createSubagentSession: (params: CreateSubagentSessionParams) => Promise<SubagentSession>;
	snapshot: ParentSnapshot;
	prompt: string;
	baseCwd: string;
	observer?: SubagentLifecycleObserver;
	getRunConfig?: () => RunConfig;
	getWorkspaceProvider?: () => WorkspaceProvider | undefined;
	model?: Model<any>;
	maxTurns?: number;
	thinkingLevel?: ThinkingLevel;
	parentSession?: ParentSessionInfo;
	signal?: AbortSignal;
}
```

The four fields the old `run()` guards required (`createSubagentSession`, `snapshot`, `prompt`, plus `baseCwd`) are mandatory; the genuinely-optional behavior knobs stay optional.

### `Subagent` constructor

```ts
export interface SubagentInit {
	id: string;
	type: SubagentType;
	description: string;
	invocation?: AgentInvocation;
	execution: SubagentExecution;   // mandatory — no more "optional for tests"
	state?: SubagentState;          // defaults to new SubagentState() (fresh "queued")
}
```

`SubagentInit` drops from ~20 fields to 5.
`Subagent` keeps `id`/`type`/`description`/`invocation`, `abortController`, `subagentSession?`, `notification?`, steer buffer, and per-run listener handles; it holds `private readonly state` and `private readonly execution`.
Getters and mutation methods delegate one line to `this.state`.
`notification` is still created in the constructor from `execution.parentSession?.toolCallId` (Step 3 moves it).

### Consumer call site — `SubagentManager.spawn`

```ts
const execution: SubagentExecution = {
	createSubagentSession: this.createSubagentSession,
	snapshot, prompt, baseCwd: this.baseCwd,
	observer: this.buildObserver(options),
	getRunConfig: this.getRunConfig,
	getWorkspaceProvider: () => this._workspaceProvider,
	model: options.model, maxTurns: options.maxTurns,
	thinkingLevel: options.thinkingLevel,
	parentSession: options.parentSession, signal: options.signal,
};
const record = new Subagent({
	id, type, description: options.description, invocation: options.invocation,
	execution,
	state: new SubagentState({ status: options.isBackground ? "queued" : "running", startedAt: Date.now() }),
});
```

Tell-Don't-Ask: the execution bundle is assembled once and handed over; nothing reaches back into `spawn`'s locals afterward.

### Observer retarget (`src/observation/record-observer.ts`)

The observer accumulates *stats*, not lifecycle — point it at `SubagentState` and drop the record from `onCompact`:

```ts
export function subscribeSubagentObserver(
	session: SubscribableSession,
	state: SubagentState,
	options?: { onCompact?: (info: CompactionInfo) => void },
): () => void
```

`Subagent.run()`/`resume()` wire it with `this.state` and close over `this` to forward itself to the lifecycle observer:

```ts
this.attachObserver(subscribeSubagentObserver(this.subagentSession, this.state, {
	onCompact: (info) => this.execution.observer?.onCompacted?.(this, info),
}));
```

This removes the observer's only dependency on `Subagent`, so observer tests construct a `SubagentState` directly.
`SubagentLifecycleObserver.onCompacted(agent, info)` is unchanged — it still receives the `Subagent`.

Decision: the observer takes `SubagentState` concretely rather than a one-off narrow `incrementToolUses`/`addUsage`/`incrementCompactions` interface.
`SubagentState` is a cohesive owned value object, not a wide dependency bag, and a single internal call site does not justify a speculative interface (recorded in Open Questions).

### Edge cases

- **Initial status for the limiter guard** — production passes `state: new SubagentState({ status: queued|running })`; the background path still observes `queued` so `limiter.schedule(() => record.status !== "queued" ? … : record.run())` behaves identically.
- **`resume()` without a prior run** — the `"not configured for resume — missing session"` throw stays; it guards a genuine runtime state (no session was ever created), not a construction concern.
- **`make-subagent.ts` passive records** — built as `state: new SubagentState({ status: "completed", result, startedAt, completedAt })` plus a `makeStubExecution()`; stat shorthands keep delegating through `Subagent`'s methods.

## Module-Level Changes

- **`src/lifecycle/subagent-state.ts`** (new) — `SubagentState`, `SubagentStateInit`, and the `SubagentStatus` type (moved from `subagent.ts`).
- **`src/lifecycle/subagent.ts`** —
  - Re-export `SubagentStatus` from `subagent-state.ts` (keeps service.ts import path valid).
  - Add `SubagentExecution`; rewrite `SubagentInit` to the 5-field shape; remove the flat execution/run-config fields.
  - Remove the (unused) `isBackground?` field from `SubagentInit` — never read in this class.
  - Hold `private readonly state` / `private readonly execution`; convert getters and `markX`/`incrementX`/`addUsage`/`resetForResume` to delegations.
  - `run()`: delete the two `"not configured for execution"` throws; read inputs from `this.execution`; wire the observer at `this.state`.
  - `resume()`: read `observer` from `this.execution`; keep the missing-session throw.
- **`src/lifecycle/subagent-manager.ts`** — `spawn()` builds the `SubagentExecution` bundle and the initial `SubagentState`; no other change (`markStopped` calls untouched).
- **`src/observation/record-observer.ts`** — param `record: Subagent` → `state: SubagentState`; `onCompact` signature `(record, info)` → `(info)`; update the JSDoc bullet wording.
- **`test/helpers/make-subagent.ts`** — add `makeStubExecution()`; build the passive record via `state` + `execution`.
- **`test/lifecycle/subagent.test.ts`** — funnel constructions through a local helper (prep refactor); move the pure state-machine `describe` blocks to the new state test; supply `execution` everywhere; update the missing-factory test (the throw is gone — replace with a type-level/construction assertion or remove).
- **`test/lifecycle/subagent-state.test.ts`** (new) — state-machine + accumulation tests targeting `SubagentState` directly.
- **`test/observation/record-observer.test.ts`** — `makeRecord` → build a `SubagentState`; assert stats on it; `onCompact` test uses `(info)`.
- **Docs** —
  - `docs/architecture/architecture.md`: add `subagent-state.ts` to the lifecycle directory listing; update the `Subagent` class diagram (state delegations, new collaborators); mark **Step 2 ✅ Complete**; refresh the Phase 17 problem-statement prose (line ~879) and the type-complexity table (`SubagentInit` row at line ~649, add `SubagentExecution`).
  - `.pi/skills/package-pi-subagents/SKILL.md`: Lifecycle domain `10 → 11` modules (add `subagent-state.ts`); total `56 → 57` files.

Grep sweep confirmed no other `src/`, `test/`, or `SKILL.md` references to the removed flat fields or the `"not configured for execution"` string outside `subagent.ts`.

## Test Impact Analysis

1. **New tests the extraction enables** — `test/lifecycle/subagent-state.test.ts` exercises every transition and accumulator on `SubagentState` with no `Subagent`, no execution stub, no session.
   This is the construct-complete payoff: the state machine is now unit-testable in isolation.
2. **Tests that become redundant** — the state-machine `describe` blocks in `subagent.test.ts` (`markRunning`, `markCompleted`, `markAborted`, `markSteered`, `markError`, `markStopped`, `incrementToolUses`, `addUsage`, `incrementCompactions`, `resetForResume`, and the pure constructor-defaults cases) move out, leaving `subagent.test.ts` to cover identity, session-encapsulation delegation, abort, `run()`/`resume()`, `completeRun`/`failRun`, and listeners.
   `record-observer.test.ts` no longer constructs a `Subagent` — it builds a `SubagentState`.
3. **Tests that must stay as-is** — `run()`/`resume()` integration tests genuinely exercise the executor (factory wiring, observer lifecycle, workspace bracket); the `createTestSubagent` consumers across `test/ui/` and `test/tools/` exercise read sites and are unaffected (the helper absorbs the construction change).

## TDD Order

1. **Extract `SubagentState` (pure addition; lift-and-shift prep).**
   - Create `src/lifecycle/subagent-state.ts` and `test/lifecycle/subagent-state.test.ts` (red → green for every transition/accumulator).
   - Refactor `Subagent` to hold a `SubagentState` built from the *existing* `SubagentInit` fields; getters/mutators delegate.
     `SubagentStatus` moves to `subagent-state.ts`, re-exported from `subagent.ts`.
   - In `subagent.test.ts`, introduce a local construction helper and route call sites through it; move the pure state-machine `describe` blocks into `subagent-state.test.ts`.
   - No consumer breaks (init shape unchanged).
     `pnpm run check` + `test`.
   - Commit: `refactor: extract SubagentState value object (#373)`.
2. **Retarget the observer at `SubagentState`.**
   - Change `subscribeSubagentObserver` to accept `SubagentState` and an `onCompact(info)`; update the two `subagent.ts` call sites (pass `this.state`, close over `this`).
   - Rewrite `record-observer.test.ts` to build a `SubagentState`.
   - Commit: `refactor: target SubagentState in subagent observer (#373)`.
3. **Make execution mandatory (the atomic construction flip).**
   - Add `SubagentExecution`; rewrite `SubagentInit` to the 5-field shape; remove flat execution/run-config fields and `isBackground?`; delete the two `run()` throws; read from `this.execution`.
   - Update the single production site (`subagent-manager.ts spawn`) and `make-subagent.ts` (`makeStubExecution` + `state`) and the `subagent.test.ts` helper/`createRunnableAgent`/`createResumableAgent` in the **same commit** — removing the optional fields breaks every construction at the type level simultaneously.
   - Adjust the now-obsolete "missing session factory" test (throw is gone).
   - `pnpm run check`, `lint`, `test`, `fallow dead-code`.
   - Commit: `refactor: make Subagent execution deps mandatory (#373)`.
4. **Docs.**
   - Update `architecture.md` (file listing, class diagram, mark Step 2 complete, prose, type table) and `SKILL.md` (domain counts).
   - Commit: `docs: record SubagentState extraction in architecture and skill (#373)`.

Optionally run `pnpm run verify:public-types` after Step 3 to confirm the public bundle is unaffected (expected: no change — the bundle does not reference `SubagentInit`).

## Risks and Mitigations

- **Large test file churn (`subagent.test.ts`, ~700 LOC).**
  Mitigated by lift-and-shift: Step 1 funnels constructions through a local helper and moves state tests out, so Step 3's mandatory-execution flip edits the helper + two run/resume factories rather than rewriting the file.
- **Initial-status regression for the limiter.**
  Production explicitly sets `state` status in `spawn`; a `subagent-manager` test should assert a background spawn reports `queued` before its slot opens (existing coverage; re-verify).
- **`SubagentStatus` re-export path.**
  Keep `SubagentStatus` re-exported from `subagent.ts`; `verify:public-types` (and `pnpm run check`) confirm `service.ts` still resolves it.
- **Circular import (`subagent.ts` ↔ `subagent-state.ts`).**
  Avoided: `subagent-state.ts` defines `SubagentStatus` and imports nothing from `subagent.ts`; `subagent.ts` imports `SubagentState`/`SubagentStatus` from `subagent-state.ts`.

## Open Questions

- Whether the observer should accept a narrow `{ incrementToolUses; addUsage; incrementCompactions }` interface instead of `SubagentState` concretely — deferred; revisit if a second consumer of the stats sink appears (defer-until-needed, per the metrics-projection work in a later phase).
- Whether the `make-subagent.ts` stat shorthands should construct `SubagentState` directly rather than delegating through `Subagent` — cosmetic; left until Step 7's fixture consolidation (#378).
