---
issue: 87
issue_title: "refactor: evolve SubagentRuntime from data bag to object with methods"
---

# Evolve SubagentRuntime from data bag to object with methods

## Problem Statement

`SubagentRuntime` (introduced in #69) consolidates all mutable extension state into one object, but it remains a plain data bag — an interface with public mutable fields and no methods.
This causes two structural smells in `index.ts`:

1. **Output arguments** — handlers write raw fields on the runtime instead of calling methods: `runtime.currentCtx = { pi, ctx }` and `runtime.currentCtx = undefined`.
2. **Law of Demeter violations** — 8 occurrences of `runtime.widget!.method()` across 4 call sites in `index.ts`, where callers reach through the runtime to talk to the widget with unsafe `!` non-null assertions.

Issue #70 (extract event handlers) explicitly lists this issue as a prerequisite.
Without these methods, extracted handlers would just move the output-argument and LoD smells from `index.ts` into handler classes.

## Goals

- Convert `SubagentRuntime` from an interface + factory to a class with methods.
- Add session-context methods: `setSessionContext(pi, ctx)` and `clearSessionContext()`.
- Add widget delegation methods that absorb the `runtime.widget!` reach-throughs: `setUICtx()`, `onTurnStart()`, `markFinished()`, `updateWidget()`, `ensureTimer()`.
- Update all 10 call sites in `index.ts` to use the new methods — eliminate raw `currentCtx` field writes and `widget!` assertions.
- No behavior change; pure structural refactor.

## Non-Goals

- Extracting event handlers into separate files (that is #70).
- Adding methods for `defaultMaxTurns` / `graceTurns` writes — those field writes remain as-is; the issue scope covers `currentCtx` and `widget!` only.
- Changing the `SubagentsService` interface.
- Making `widget` private — `index.ts` still assigns `runtime.widget = new AgentWidget(...)` after construction.
- Adding new features.

## Background

### Prior art

`pi-permission-system`'s `PermissionSession` is a class with lifecycle methods (`refreshConfig`, `resetForNewSession`, `shutdown`).
Lifecycle handlers in `src/handlers/lifecycle.ts` call those methods instead of writing fields.
This issue brings `SubagentRuntime` to the same level.

### Current runtime shape

`src/runtime.ts` exports a `SubagentRuntime` interface and a `createSubagentRuntime()` factory:

```typescript
export interface SubagentRuntime {
  defaultMaxTurns: number | undefined;
  graceTurns: number;
  currentCtx: { pi: unknown; ctx: unknown } | undefined;
  readonly agentActivity: Map<string, AgentActivity>;
  widget: AgentWidget | null;
}
```

### Call sites to migrate

Two `currentCtx` writes (output arguments):

| Line | Current                            | After                                |
| ---- | ---------------------------------- | ------------------------------------ |
| 126  | `runtime.currentCtx = { pi, ctx }` | `runtime.setSessionContext(pi, ctx)` |
| 138  | `runtime.currentCtx = undefined`   | `runtime.clearSessionContext()`      |

Eight `widget!` reach-throughs (LoD violations):

| Line | Current                                     | After                               |
| ---- | ------------------------------------------- | ----------------------------------- |
| 60   | `runtime.widget!.markFinished(id)`          | `runtime.markFinished(id)`          |
| 61   | `runtime.widget!.update()`                  | `runtime.updateWidget()`            |
| 149  | `runtime.widget!.setUICtx(ctx.ui as UICtx)` | `runtime.setUICtx(ctx.ui as UICtx)` |
| 150  | `runtime.widget!.onTurnStart()`             | `runtime.onTurnStart()`             |
| 204  | `runtime.widget!.setUICtx(ctx as UICtx)`    | `runtime.setUICtx(ctx as UICtx)`    |
| 205  | `runtime.widget!.ensureTimer()`             | `runtime.ensureTimer()`             |
| 206  | `runtime.widget!.update()`                  | `runtime.updateWidget()`            |
| 207  | `runtime.widget!.markFinished(id)`          | `runtime.markFinished(id)`          |

### Dependency chain

Issue #69 (SubagentRuntime) is closed/implemented.
This issue (#87) is a prerequisite for #70 (extract event handlers).
The #70 plan defines narrow handler interfaces (`LifecycleRuntime`, `ToolStartRuntime`) that the runtime class satisfies structurally.

### Relevant constraints from AGENTS.md / code-style skill

- Keep modules focused and composable (one concern per file).
- Do not pass a shared dependency bag to functions that only use a subset — define narrow interfaces per consumer.
- Do not write back into a received dependency bag (output arguments).
- Do not reach through an injected collaborator to talk to a stranger (Law of Demeter).
- When multiple callers perform the same reach-through, the missing abstraction is a method on the intermediate object that delegates internally.

## Design Overview

### Class conversion

Convert `SubagentRuntime` from an interface to a class.
Public fields stay as-is — callers that read `runtime.defaultMaxTurns`, `runtime.currentCtx`, `runtime.agentActivity`, etc. continue to work.
The `createSubagentRuntime()` factory becomes a thin alias returning `new SubagentRuntime()`, preserving backward compatibility for `index.ts` and existing tests during the transition.

```typescript
export class SubagentRuntime {
  defaultMaxTurns: number | undefined = undefined;
  graceTurns: number = 5;
  currentCtx: { pi: unknown; ctx: unknown } | undefined = undefined;
  readonly agentActivity: Map<string, AgentActivity> = new Map();
  widget: AgentWidget | null = null;

  setSessionContext(pi: unknown, ctx: unknown): void {
    this.currentCtx = { pi, ctx };
  }

  clearSessionContext(): void {
    this.currentCtx = undefined;
  }

  setUICtx(ctx: UICtx): void {
    this.widget?.setUICtx(ctx);
  }

  onTurnStart(): void {
    this.widget?.onTurnStart();
  }

  markFinished(id: string): void {
    this.widget?.markFinished(id);
  }

  updateWidget(): void {
    this.widget?.update();
  }

  ensureTimer(): void {
    this.widget?.ensureTimer();
  }
}
```

### Widget delegation null safety

Current code uses `runtime.widget!.method()` — an unsafe non-null assertion that would throw if widget were null.
The delegation methods use optional chaining (`this.widget?.method()`), which silently no-ops when widget is null.
This is safe and intentional: widget is always assigned before any agent can complete, so the null path is unreachable in practice, but the delegation removes the assertion smell.
The #70 plan explicitly expects this behavior: "Widget null safety: after #87, the runtime's delegation methods handle null internally."

### UICtx type import

`runtime.ts` already imports `AgentActivity` and `AgentWidget` from `ui/agent-widget.ts`.
Adding `UICtx` to the same type import is consistent with the existing dependency.
`UICtx` is a lean local interface (two method signatures), not a Pi SDK type.

### What stays unchanged

- `RunConfig` interface — remains as-is.
- `defaultMaxTurns` / `graceTurns` field writes from settings appliers — out of scope per non-goals.
- `runtime.currentCtx` reads via getter callbacks (`getCtx: () => runtime.currentCtx`) — reads are not output arguments.
- `runtime.widget = new AgentWidget(...)` assignment — `widget` stays public.
- `agentActivity` map usage across notification, tool, and menu deps — unchanged.

## Module-Level Changes

### `src/runtime.ts` (modified)

- Convert `SubagentRuntime` from `export interface` to `export class` with field initializers.
- Add `setSessionContext(pi, ctx)` and `clearSessionContext()` methods.
- Add `setUICtx(ctx)`, `onTurnStart()`, `markFinished(id)`, `updateWidget()`, `ensureTimer()` delegation methods.
- Add `UICtx` to the existing type import from `./ui/agent-widget.js`.
- Keep `createSubagentRuntime()` as `() => new SubagentRuntime()` for backward compat.
- Keep `RunConfig` interface unchanged.

### `src/index.ts` (modified)

- Replace `runtime.currentCtx = { pi, ctx }` with `runtime.setSessionContext(pi, ctx)` (line 126).
- Replace `runtime.currentCtx = undefined` with `runtime.clearSessionContext()` (line 138).
- Replace all 8 `runtime.widget!.method()` reach-throughs with `runtime.method()` delegation calls (lines 60, 61, 149, 150, 204–207).
- No import changes needed — `runtime` is already imported via the factory.

### `test/runtime.test.ts` (modified)

- Add tests for `setSessionContext` / `clearSessionContext` methods.
- Add tests for each widget delegation method using duck-typed widget stubs.
- Add test verifying delegation methods no-op when widget is null.
- Existing tests remain — factory defaults, field mutability, instance isolation, and widget assignment all still apply.

## Test Impact Analysis

### New unit tests enabled

1. `test/runtime.test.ts` additions — `setSessionContext` sets `currentCtx` correctly; `clearSessionContext` resets it to `undefined`.
2. `test/runtime.test.ts` additions — Each widget delegation method forwards to the widget's corresponding method; all delegation methods silently no-op when widget is null.

### Existing tests that become redundant

None.
The existing `runtime.test.ts` tests cover factory defaults, field mutability, and instance isolation — all still valid with the class conversion.
The "fields are independently mutable" test exercises direct field writes, which remain supported.

### Existing tests that stay as-is

- `test/runtime.test.ts` — All 5 existing tests pass unchanged (the class satisfies the same structural contract as the previous interface-based object).
- `test/print-mode.test.ts` — Calls `session_shutdown` via the extension's handler map; transparent to runtime internals.
- All other test files — No dependency on `SubagentRuntime` fields or methods.

## TDD Order

1. **Convert `SubagentRuntime` to a class; add session-context methods.**
   Convert the interface to a class with field initializers matching current defaults.
   Add `setSessionContext(pi, ctx)` and `clearSessionContext()` methods.
   Update `createSubagentRuntime()` to return `new SubagentRuntime()`.
   Add tests in `runtime.test.ts`: `setSessionContext` sets `currentCtx`; `clearSessionContext` resets to `undefined`; round-trip set→clear.
   Run existing tests to verify no regressions.
   Commit: `feat: add session-context methods to SubagentRuntime`

2. **Add widget delegation methods; add tests.**
   Add `setUICtx(ctx)`, `onTurnStart()`, `markFinished(id)`, `updateWidget()`, `ensureTimer()` methods to the class.
   Add `UICtx` to the type import from `./ui/agent-widget.js`.
   Add tests in `runtime.test.ts`: each delegation method forwards to the widget stub; all methods no-op when widget is null.
   Commit: `feat: add widget delegation methods to SubagentRuntime`

3. **Migrate all call sites in `index.ts` to use the new methods.**
   Replace the 2 `currentCtx` writes with `setSessionContext` / `clearSessionContext`.
   Replace the 8 `widget!` reach-throughs with delegation methods.
   Run full test suite and `pnpm run check`.
   Commit: `refactor: use SubagentRuntime methods in extension factory (#87)`

## Risks and Mitigations

| Risk                                                                                                  | Mitigation                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Class conversion breaks code that constructs `SubagentRuntime` as a plain object                      | Only `createSubagentRuntime()` constructs runtime instances (in `index.ts` and tests). The factory is updated to return `new SubagentRuntime()`. No code constructs a `{ ... } as SubagentRuntime` literal. |
| Widget delegation silently swallows errors when widget is null (changes behavior from throw to no-op) | The null path is unreachable in practice — widget is always assigned before any agent completes. The silent no-op is strictly safer than the `!` assertion. The #70 plan explicitly expects this behavior.  |
| Adding `UICtx` import to `runtime.ts` increases coupling to the widget module                         | `runtime.ts` already imports `AgentActivity` and `AgentWidget` from the same module. `UICtx` is a lean 2-method interface, not a Pi SDK type. Coupling is minimal and consistent.                           |
| Remaining output-argument writes (`defaultMaxTurns`, `graceTurns`) are left unaddressed               | Explicitly out of scope per the issue's acceptance criteria. Can be addressed in a follow-up if the pattern becomes painful.                                                                                |

## Open Questions

- Should `createSubagentRuntime()` be removed in favor of `new SubagentRuntime()` directly?
  The factory adds no value over a no-arg constructor, but removing it widens the blast radius without benefit.
  Defer — remove it as part of #70 or a future cleanup if it feels redundant.
