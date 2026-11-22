---
issue: 127
issue_title: "refactor: extract SessionLogger interface to unify logging + notification"
---

# Extract SessionLogger interface

## Problem statement

Handlers receive three separate logging/notification functions via `HandlerDeps`: `writeDebugLog`, `writeReviewLog`, and `notifyWarning`.
These are always used together and always wired identically in the composition root (`src/index.ts`).
They add 3 fields to every `makeDeps()` test factory across 6 handler test files.

## Goals

- Define a `SessionLogger` interface in a new `src/session-logger.ts` module.
- Create a `createSessionLogger()` factory that wraps `createPermissionSystemLogger` + the notification callback.
- Replace the 3 separate functions in `HandlerDeps` with a single `logger: SessionLogger` field.
- Update all handler files to use `deps.logger.debug(...)`, `deps.logger.review(...)`, `deps.logger.warn(...)`.
- Update all 6 handler test `makeDeps()` factories.
- No behavioral change — pure extraction.

## Non-goals

- Changing `GateRunnerDeps.writeReviewLog` — that interface is satisfied by the tool-call handler locally and will be updated when `PermissionSession` satisfies it directly (#129).
- Changing `PermissionPrompterDeps.writeReviewLog` or `PermissionForwardingDeps.writeReviewLog` — those are separate dep interfaces with their own consumers.
- Changing `PermissionGateParams.writeLog` — that is a generic log callback, not a handler dep.
- Extracting `ForwardingManager` (#128) or `PermissionSession` (#129).

## Background

This is step 2 of the handler decomposition series (see `docs/plans/0126-handler-decomposition.md`).
Step 1 (`ExtensionPaths`, #126) is already implemented and merged.
Steps #128 and #129 are still open; #127 is independent of #128 and a prerequisite for #129.

### Permission surface

No permission surface is added, removed, or changed.
This is a pure internal refactoring of the handler dependency shape.

### Affected files

The three logging fields in `HandlerDeps` are consumed by:

| Field            | Handlers                                                                   |
| ---------------- | -------------------------------------------------------------------------- |
| `writeDebugLog`  | `lifecycle.ts` (2 sites)                                                   |
| `writeReviewLog` | `tool-call.ts` (4 sites), `input.ts` (1 site), `gates/runner.ts` (2 sites) |
| `notifyWarning`  | `lifecycle.ts` (1 site)                                                    |

The composition root (`src/index.ts`) wires all three from `runtime.writeDebugLog`/`writeReviewLog` and `runtime.runtimeContext?.ui.notify`.

## Design overview

### SessionLogger interface

```typescript
/** Unified logging + notification surface for handler deps. */
export interface SessionLogger {
  debug(event: string, details?: Record<string, unknown>): void;
  review(event: string, details?: Record<string, unknown>): void;
  warn(message: string): void;
}
```

### createSessionLogger factory

```typescript
export function createSessionLogger(
  runtime: ExtensionRuntime,
): SessionLogger {
  return {
    debug: (event, details) => runtime.writeDebugLog(event, details),
    review: (event, details) => runtime.writeReviewLog(event, details),
    warn: (message) => runtime.runtimeContext?.ui.notify(message, "warning"),
  };
}
```

The factory captures `runtime` by reference so `warn` always reads the current `runtimeContext` (same behavior as the existing `notifyWarning` closure in `index.ts`).

### HandlerDeps change

```typescript
export interface HandlerDeps {
  // Remove:
  //   writeDebugLog(event: string, details?: Record<string, unknown>): void;
  //   writeReviewLog(event: string, details?: Record<string, unknown>): void;
  //   notifyWarning(message: string): void;

  // Add:
  readonly logger: SessionLogger;
  // ... rest unchanged
}
```

### Handler migration (mechanical)

| Before                                | After                                             |
| ------------------------------------- | ------------------------------------------------- |
| `deps.writeDebugLog(event, details)`  | `deps.logger.debug(event, details)`               |
| `deps.writeReviewLog(event, details)` | `deps.logger.review(event, details)`              |
| `deps.notifyWarning(message)`         | `deps.logger.warn(message)`                       |
| `const { writeReviewLog } = deps;`    | `const { review: writeReviewLog } = deps.logger;` |

The tool-call handler destructures `writeReviewLog` from `deps` and passes it into `GateRunnerDeps`.
After this change the destructuring reads from `deps.logger` instead — `GateRunnerDeps` is unaware of the change.

### Test factory migration (mechanical)

Before (3 fields):

```typescript
writeDebugLog: vi.fn(),
writeReviewLog: vi.fn(),
// ...
notifyWarning: vi.fn(),
```

After (1 field):

```typescript
logger: {
  debug: vi.fn(),
  review: vi.fn(),
  warn: vi.fn(),
},
```

Test assertions change from `deps.writeDebugLog` to `deps.logger.debug`, etc.

## Module-level changes

### New files

| File                           | Purpose                                                     |
| ------------------------------ | ----------------------------------------------------------- |
| `src/session-logger.ts`        | `SessionLogger` interface + `createSessionLogger()` factory |
| `tests/session-logger.test.ts` | Unit tests for `createSessionLogger()`                      |

### Changed files — source

| File                           | Change                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| `src/handlers/types.ts`        | Replace 3 fields with `readonly logger: SessionLogger`; add import                              |
| `src/handlers/lifecycle.ts`    | `deps.writeDebugLog` → `deps.logger.debug`; `deps.notifyWarning` → `deps.logger.warn`           |
| `src/handlers/tool-call.ts`    | `const { writeReviewLog } = deps` → `const { review: writeReviewLog } = deps.logger`            |
| `src/handlers/input.ts`        | `deps.writeReviewLog` → `deps.logger.review`                                                    |
| `src/handlers/gates/runner.ts` | `deps.writeReviewLog` → `deps.logger.review` (2 sites: session-approved log + `writeLog` param) |
| `src/index.ts`                 | Replace 3 inline closures with `logger: createSessionLogger(runtime)`; add import               |

### Changed files — tests

| File                                        | Change                                               |
| ------------------------------------------- | ---------------------------------------------------- |
| `tests/handlers/lifecycle.test.ts`          | `makeDeps` factory + assertions                      |
| `tests/handlers/tool-call.test.ts`          | `makeDeps` factory + assertions                      |
| `tests/handlers/tool-call-events.test.ts`   | `makeDeps` factory                                   |
| `tests/handlers/input.test.ts`              | `makeDeps` factory + assertions                      |
| `tests/handlers/input-events.test.ts`       | `makeDeps` factory                                   |
| `tests/handlers/before-agent-start.test.ts` | `makeDeps` factory (no logging assertions to update) |

### Changed files — docs

| File                                | Change                                                           |
| ----------------------------------- | ---------------------------------------------------------------- |
| `docs/architecture/architecture.md` | Update `types.ts` line in module tree to mention `SessionLogger` |

### Unchanged

- `src/handlers/gates/descriptor.ts` — `GateRunnerDeps.writeReviewLog` stays as-is.
- `tests/handlers/gates/runner.test.ts` — uses `GateRunnerDeps`, not `HandlerDeps`.
- `src/permission-prompter.ts` — has its own `PermissionPrompterDeps.writeReviewLog`.
- `src/forwarded-permissions/` — has its own `ForwardedPermissionLogger` and `PermissionForwardingDeps`.
- `src/permission-event-rpc.ts` — has its own dep interface.
- `tests/permission-system.test.ts` — integration test; never constructs `HandlerDeps`.

## Test impact analysis

1. **New unit tests enabled**: `createSessionLogger()` can be tested in isolation — verify `debug`/`review` delegate to `runtime.writeDebugLog`/`writeReviewLog`, and `warn` delegates to `runtime.runtimeContext?.ui.notify` (including the null-context case).
   These were previously untestable because the closures were inline in `index.ts`.
2. **Existing tests that become simpler**: All 6 handler `makeDeps()` factories shrink by 2 net fields (3 removed, 1 added).
   Assertions on logging behavior get a single parent object (`deps.logger`) instead of reaching into `deps` directly.
3. **Existing tests that must stay as-is**: All handler behavioral tests stay — they test permission logic, not logging wiring.
   `GateRunnerDeps` tests are completely unaffected.

## TDD order

### Step 1 — SessionLogger interface + createSessionLogger factory

1. **Red**: Write `tests/session-logger.test.ts` — test that `createSessionLogger()` delegates `debug` → `runtime.writeDebugLog`, `review` → `runtime.writeReviewLog`, and `warn` → `runtime.runtimeContext.ui.notify`.
   Test the null-context `warn` no-op path.
2. **Green**: Create `src/session-logger.ts` with the `SessionLogger` interface and `createSessionLogger()` factory.
3. **Commit**: `feat: add SessionLogger interface and createSessionLogger factory (#127)`

### Step 2 — Update HandlerDeps and handler source files

1. **Red**: `pnpm run build` fails after updating `HandlerDeps` (callers still use old field names).
2. **Green**: Update `src/handlers/types.ts` to replace the 3 fields with `readonly logger: SessionLogger`.
   Update all handler source files (`lifecycle.ts`, `tool-call.ts`, `input.ts`) and `gates/runner.ts` to use `deps.logger.*`.
   Update `src/index.ts` to wire `logger: createSessionLogger(runtime)` instead of 3 separate closures.
3. **Verify**: `pnpm run build` passes.
   Tests still fail (test factories reference old fields).
4. **Commit**: `refactor: replace HandlerDeps logging fields with SessionLogger (#127)`

### Step 3 — Update handler test factories and assertions

1. **Red**: `pnpm vitest run` shows failures in all 6 handler test files (old field names in `makeDeps` + assertions).
2. **Green**: Update `makeDeps()` in each test file to use `logger: { debug: vi.fn(), review: vi.fn(), warn: vi.fn() }`.
   Update assertions that reference `deps.writeDebugLog` → `deps.logger.debug`, `deps.writeReviewLog` → `deps.logger.review`, `deps.notifyWarning` → `deps.logger.warn`.
3. **Verify**: `pnpm vitest run` passes.
   `pnpm run build` passes.
4. **Commit**: `test: update handler test factories for SessionLogger (#127)`

### Step 4 — Update architecture doc

1. **Green**: Update `docs/architecture/architecture.md` module tree entry for `types.ts`.
2. **Commit**: `docs: update architecture doc for SessionLogger (#127)`

## Risks and mitigations

| Risk                                                                 | Mitigation                                                                                                                                                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Could silently weaken a permission?                                  | No. Same `checkPermission` calls, same parameters, same gate evaluation order. Only logging/notification wiring changes. Integration test (`permission-system.test.ts`) is unaffected.                 |
| Large blast radius across test files                                 | All 6 handler test file changes are mechanical find-and-replace. Each `makeDeps()` factory is self-contained. Steps 2 and 3 are separated so source changes compile before test changes land.          |
| `GateRunnerDeps.writeReviewLog` type mismatch after rename           | `GateRunnerDeps` is unchanged. The tool-call handler destructures `const { review: writeReviewLog } = deps.logger` and passes the function to `GateRunnerDeps` — no type-level change at the boundary. |
| `createSessionLogger` captures `runtime` by reference — stale state? | Same pattern as the existing inline closures in `index.ts`. `warn` reads `runtime.runtimeContext` at call time (not capture time), matching current behavior.                                          |

## Open questions

None — the issue description is fully specified and the change is mechanical.
