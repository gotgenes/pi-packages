---
issue: 128
issue_title: "refactor: extract ForwardingManager class to encapsulate polling lifecycle"
---

# Extract ForwardingManager class

## Problem statement

Forwarding poll lifecycle is spread across 3 mutable fields on `ExtensionRuntime` (`permissionForwardingTimer`, `permissionForwardingContext`, `isProcessingForwardedRequests`), 2 free functions (`startForwardedPermissionPolling`, `stopForwardedPermissionPolling` in `runtime.ts`), and raw `PermissionForwardingDeps`.
Handlers call `deps.startForwardedPermissionPolling(ctx)` and `deps.stopForwardedPermissionPolling()` as opaque callbacks without understanding the lifecycle.
This is the third extraction in the handler decomposition series (after #126 ExtensionPaths, #127 SessionLogger).

## Goals

- Extract a `ForwardingManager` class that owns the timer, context, and processing-lock state.
- Remove `permissionForwardingTimer`, `permissionForwardingContext`, `isProcessingForwardedRequests` from `ExtensionRuntime`.
- Remove `startForwardedPermissionPolling` and `stopForwardedPermissionPolling` free functions from `runtime.ts`.
- Replace `startForwardedPermissionPolling` / `stopForwardedPermissionPolling` in `HandlerDeps` with a `forwarding: ForwardingManager` dep (or equivalent narrow interface).
- No behavioral change — same polling logic, same timer intervals, same subagent-context detection.

## Non-goals

- Changing `PermissionForwardingDeps` shape or polling logic.
- Extracting `PermissionSession` (#129) — that depends on this issue.
- Changing the `/permission-system` slash command or config format.
- Refactoring `PermissionPrompter` internals (it builds its own `PermissionForwardingDeps` internally).

## Background

### Permission surface

This is an infrastructure refactoring — no permission surface semantics change.
Forwarding is the mechanism by which subagent permission prompts are relayed to the parent agent's UI.

### Dependencies

- **#126 ExtensionPaths** — closed, implemented.
  `ForwardingManager` constructor takes `ExtensionPaths` (needs `subagentSessionsDir` for the subagent-context check).
- **#127 SessionLogger** — closed, implemented.
  Not directly consumed by `ForwardingManager` (logging goes through `PermissionForwardingDeps`).

### Current layout

| Artifact                               | Location                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 3 mutable fields                       | `ExtensionRuntime` interface in `src/runtime.ts`                                               |
| `startForwardedPermissionPolling()`    | Free function in `src/runtime.ts` (~30 lines)                                                  |
| `stopForwardedPermissionPolling()`     | Free function in `src/runtime.ts` (~10 lines)                                                  |
| `PermissionForwardingDeps`             | `src/forwarded-permissions/polling.ts`                                                         |
| `isSubagentExecutionContext()`         | `src/subagent-context.ts` (called inside `start`)                                              |
| `processForwardedPermissionRequests()` | `src/forwarded-permissions/polling.ts`                                                         |
| `HandlerDeps` forwarding fields        | `startForwardedPermissionPolling`, `stopForwardedPermissionPolling` in `src/handlers/types.ts` |
| Handler call sites                     | `before-agent-start.ts`, `input.ts`, `tool-call.ts`, `lifecycle.ts`                            |
| Composition root wiring                | `src/index.ts` lines ~46–108                                                                   |
| Runtime init (3 fields)                | `createExtensionRuntime()` in `src/runtime.ts`                                                 |

## Design overview

### ForwardingManager class

```typescript
// src/forwarding-manager.ts

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { PermissionForwardingDeps } from "./forwarded-permissions/polling";

export class ForwardingManager {
  private timer: NodeJS.Timeout | null = null;
  private context: ExtensionContext | null = null;
  private processing = false;

  constructor(
    private readonly subagentSessionsDir: string,
    private readonly forwardingDeps: PermissionForwardingDeps,
  ) {}

  /** Start polling if ctx has UI and is not a subagent. No-op if already running. */
  start(ctx: ExtensionContext): void { /* moved from runtime.ts */ }

  /** Stop polling and clear state. */
  stop(): void { /* moved from runtime.ts */ }
}
```

The constructor takes `subagentSessionsDir` (from `ExtensionPaths`) rather than the full `ExtensionPaths` object — it is the only path field used by the start/stop logic.
`PermissionForwardingDeps` is passed at construction time, same as currently wired in `index.ts`.

### HandlerDeps change

```typescript
// In src/handlers/types.ts — replace two methods with one dep:

// Before:
startForwardedPermissionPolling(ctx: ExtensionContext): void;
stopForwardedPermissionPolling(): void;

// After:
readonly forwarding: ForwardingManager;
```

Handler call sites change from `deps.startForwardedPermissionPolling(ctx)` → `deps.forwarding.start(ctx)` and `deps.stopForwardedPermissionPolling()` → `deps.forwarding.stop()`.

### ExtensionRuntime slimming

Remove from `ExtensionRuntime`:

- `permissionForwardingContext: ExtensionContext | null`
- `permissionForwardingTimer: NodeJS.Timeout | null`
- `isProcessingForwardedRequests: boolean`

Remove from `createExtensionRuntime()` the three field initializations.

### Composition root (index.ts) change

Replace the `forwardingDeps` construction + two closure wrappers with:

```typescript
const forwardingManager = new ForwardingManager(
  runtime.subagentSessionsDir,
  forwardingDeps,
);
```

And in the `deps` object: `forwarding: forwardingManager`.

## Module-level changes

### New files

1. **`src/forwarding-manager.ts`** — `ForwardingManager` class.
   Moves `startForwardedPermissionPolling` and `stopForwardedPermissionPolling` logic from `runtime.ts`.
   Imports `isSubagentExecutionContext`, `processForwardedPermissionRequests`, `PERMISSION_FORWARDING_POLL_INTERVAL_MS`.
2. **`tests/forwarding-manager.test.ts`** — Unit tests for `ForwardingManager.start()` and `.stop()`.

### Changed files

1. **`src/runtime.ts`**
   - Remove `permissionForwardingContext`, `permissionForwardingTimer`, `isProcessingForwardedRequests` from `ExtensionRuntime` interface.
   - Remove `startForwardedPermissionPolling()` and `stopForwardedPermissionPolling()` free functions.
   - Remove the three field initializations from `createExtensionRuntime()`.
   - Remove `PermissionForwardingDeps` import (if no longer needed).
2. **`src/handlers/types.ts`**
   - Replace `startForwardedPermissionPolling(ctx)` and `stopForwardedPermissionPolling()` with `readonly forwarding: ForwardingManager`.
   - Add `ForwardingManager` import.
3. **`src/index.ts`**
   - Import `ForwardingManager`.
   - Construct `ForwardingManager` instance.
   - Replace `startForwardedPermissionPolling` / `stopForwardedPermissionPolling` closures in `deps` with `forwarding: forwardingManager`.
4. **`src/handlers/before-agent-start.ts`** — `deps.startForwardedPermissionPolling(ctx)` → `deps.forwarding.start(ctx)`.
5. **`src/handlers/input.ts`** — Same call-site update.
6. **`src/handlers/tool-call.ts`** — Same call-site update.
7. **`src/handlers/lifecycle.ts`** — `deps.startForwardedPermissionPolling(ctx)` → `deps.forwarding.start(ctx)`, `deps.stopForwardedPermissionPolling()` → `deps.forwarding.stop()`.

### Changed test files

1. **`tests/runtime.test.ts`** — Remove the 3 tests asserting initial `null`/`false` values for the removed fields.
2. **`tests/handlers/before-agent-start.test.ts`** — Replace `startForwardedPermissionPolling: vi.fn()` / `stopForwardedPermissionPolling: vi.fn()` with `forwarding: { start: vi.fn(), stop: vi.fn() }`.
   Update assertion from `deps.startForwardedPermissionPolling` to `deps.forwarding.start`.
3. **`tests/handlers/input.test.ts`** — Same mock shape update + assertion update.
4. **`tests/handlers/input-events.test.ts`** — Same mock shape update (no assertions on these mocks).
5. **`tests/handlers/tool-call.test.ts`** — Same mock shape + assertion update.
6. **`tests/handlers/tool-call-events.test.ts`** — Same mock shape update.
7. **`tests/handlers/lifecycle.test.ts`** — Same mock shape + both start/stop assertion updates.

### Unchanged files

- **`src/forwarded-permissions/polling.ts`** — `PermissionForwardingDeps`, `processForwardedPermissionRequests` stay as-is.
- **`src/permission-prompter.ts`** — Builds its own `PermissionForwardingDeps` internally; no dependency on `ForwardingManager`.
- **`tests/permission-system.test.ts`** — Integration test; calls `piPermissionSystemExtension(mockPi)` and never sees handler internals.
- **`docs/architecture/architecture.md`** — Does not describe forwarding internals in detail; no update needed unless the decomposition plan doc is referenced.

## Test impact analysis

1. **New unit tests enabled**: `ForwardingManager.start()` and `.stop()` can be tested in isolation with a mock `PermissionForwardingDeps` and fake timers.
   Previously, testing required constructing a full `ExtensionRuntime` or going through the integration test.
   - `start()` with `hasUI: false` → no-op (no timer created).
   - `start()` with subagent context → stops any existing timer.
   - `start()` when already running → updates context but does not create a second timer.
   - `stop()` → clears timer, context, and processing flag.
   - `start()` followed by timer tick → calls `processForwardedPermissionRequests`.
   - Timer tick while `processing` is true → skipped.
2. **Existing tests that become simpler**: The 3 `createExtensionRuntime` init tests in `runtime.test.ts` for the forwarding fields are deleted — the class constructor handles initialization internally.
3. **Existing tests that stay**: Handler tests still verify that `start(ctx)` and `stop()` are called at the right lifecycle points — the assertion target changes from `deps.startForwardedPermissionPolling` to `deps.forwarding.start` but the intent is identical.

## TDD order

1. **Red → Green**: Add `src/forwarding-manager.ts` with the class skeleton and `tests/forwarding-manager.test.ts` with core lifecycle tests (start no-op for non-UI, start no-op for subagent, stop clears state, timer tick calls process, tick skipped while processing, idempotent start).
   Commit: `feat: add ForwardingManager class (#128)`
2. **Green → Refactor**: Remove the 3 forwarding fields from `ExtensionRuntime`, delete the two free functions from `runtime.ts`, update `createExtensionRuntime()`.
   Remove the 3 init-value tests from `runtime.test.ts`.
   Run `pnpm run build` to verify.
   Commit: `refactor: remove forwarding state from ExtensionRuntime (#128)`
3. **Green → Refactor**: Update `HandlerDeps` in `src/handlers/types.ts` — replace the two methods with `readonly forwarding: ForwardingManager`.
   Update all 4 handler files to use `deps.forwarding.start(ctx)` / `deps.forwarding.stop()`.
   Update all 7 handler test files (mock shape + assertions).
   Run `pnpm run build` and full test suite.
   Commit: `refactor: wire ForwardingManager through HandlerDeps (#128)`
4. **Green → Refactor**: Update `src/index.ts` — construct `ForwardingManager`, pass it as `forwarding` in the deps object, remove the two closure wrappers.
   Run full test suite.
   Commit: `refactor: construct ForwardingManager in composition root (#128)`

Note: Steps 2–4 can be combined into fewer commits if the changes are small enough, but the ordering must be maintained.
Step 2 will break the build until step 3 updates callers, so steps 2 and 3 should be done together or step 2 should keep the old functions as deprecated wrappers temporarily.

**Revised strategy**: Combine steps 2, 3, and 4 into a single commit since removing the fields from `ExtensionRuntime` and updating `HandlerDeps` + `index.ts` are interdependent.
The sequence becomes:

1. `feat: add ForwardingManager class (#128)` — new file + tests, no existing code changed.
2. `refactor: wire ForwardingManager and remove legacy forwarding state (#128)` — all mechanical changes in one commit: runtime, types, handlers, index, handler tests, runtime tests.

## Risks and mitigations

| Risk                                                     | Mitigation                                                                                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Could this silently weaken a permission?                 | No — pure structural refactor. Same `processForwardedPermissionRequests` call, same `isSubagentExecutionContext` guard, same timer interval. Integration tests unchanged. |
| Timer leak if `ForwardingManager` is not stopped         | Same risk exists today. `handleSessionEnd` calls `stop()` (via `deps.stopForwardedPermissionPolling()`); the new code calls `deps.forwarding.stop()` in the same place.   |
| Handler test mock shape changes break tests              | Mechanical — replace two `vi.fn()` fields with one `{ start: vi.fn(), stop: vi.fn() }` object. Grep ensures no mock factory is missed.                                    |
| `ForwardingManager` import creates a circular dependency | `forwarding-manager.ts` imports from `forwarded-permissions/polling.ts` and `subagent-context.ts` — neither imports back. No cycle.                                       |

## Open questions

- Should `ForwardingManager` accept the full `ExtensionPaths` or just `subagentSessionsDir`?
  The issue suggests `ExtensionPaths`; this plan uses the narrower `subagentSessionsDir` to follow the dependency-width heuristic.
  Either works — the `PermissionSession` (#129) will wrap it regardless.
