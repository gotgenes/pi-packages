---
issue: 57
issue_title: "feat: structured debug logging for silenced catch blocks"
---

# Structured debug logging for silenced catch blocks

## Problem Statement

The codebase contains ~20 `catch { /* ignore */ }` blocks spread across `agent-manager.ts`, `worktree.ts`, `output-file.ts`, `skill-loader.ts`, `custom-agents.ts`, `memory.ts`, `env.ts`, and `notification.ts`.
Each block correctly suppresses a non-essential side-effect failure, but in development the silence makes it impossible to diagnose what is actually failing inside those paths.

## Goals

- Add a `debugLog(context, err)` utility in `src/debug.ts` gated on `PI_SUBAGENTS_DEBUG=1`.
- Thread `debugLog` into every silenced `catch` block listed in the issue scope.
- Leave production behavior **completely unchanged** — no new log output unless the env var is explicitly set.
- Provide a `debug.test.ts` unit test covering the on/off branching.

## Non-Goals

- `usage.ts` catch blocks — they return `0`/`null` on failure and are already recoverable, not truly "silent drops"; they are out of scope.
- `settings.ts` catch block — it returns `false` on failure, already surfaced to the caller; out of scope.
- Log rotation, structured JSON output, or stderr vs. stdout routing.
- Wiring debug output to the Pi UI; `console.warn` to stderr is sufficient.

## Background

The `AGENTS.md` rule "prefer explicit configuration over hidden behavior" aligns with gating noise behind an opt-in env var rather than always-on logging.
The code-style skill notes that business logic should remain pure — `debug.ts` must not import the Pi SDK; it only reads `process.env`.

The `DEBUG` constant is evaluated once at module import time (top-level `const`).
That matches how similar opt-in env vars work in Node.js tooling and keeps the hot path to a single boolean branch.

### Catch blocks in scope

| File               | Line(s)                              | Context label(s)                                        |
| ------------------ | ------------------------------------ | ------------------------------------------------------- |
| `env.ts`           | 15, 23                               | `"git rev-parse"`, `"git branch"`                       |
| `skill-loader.ts`  | 74                                   | `"readdirSync skill root"`                              |
| `custom-agents.ts` | 37, 47                               | `"readdirSync agents dir"`, `"readFileSync agent file"` |
| `memory.ts`        | 33, 47                               | `"lstatSync"`, `"readFileSync"`                         |
| `output-file.ts`   | 83                                   | `"write JSONL chunk"`                                   |
| `worktree.ts`      | 40, 56, 110, 130, 132, 147, 151, 161 | `"git rev-parse"`, `"git worktree add"`, etc.           |
| `agent-manager.ts` | 233, 249, 266, 275, 480              | `"outputCleanup"`, `"onComplete callback"`, etc.        |
| `notification.ts`  | 145                                  | `"notification render"`                                 |

## Design Overview

### `src/debug.ts`

```typescript
export const DEBUG = process.env.PI_SUBAGENTS_DEBUG === "1";

export function debugLog(context: string, err: unknown): void {
  if (DEBUG) console.warn(`[pi-subagents:debug] ${context}:`, err);
}
```

The module-level `DEBUG` constant is the canonical source.
`debugLog` is a pure side-effect function: no return value, no SDK dependency, no coupling to Pi types.

### Threading pattern

Every silenced `catch` block is updated from:

```typescript
} catch { /* ignore */ }
```

to:

```typescript
} catch (err) { debugLog("<context label>", err); }
```

When the block already had a named error (`catch (err)`), only the `debugLog` call is added; the existing comment, if descriptive, is removed in favour of the context string.

### Context label convention

Labels read as `"<verb> <noun>"`, lower-case, mirroring the surrounding function name when unambiguous (e.g., `"removeWorktree"`, `"outputCleanup"`).

## Module-Level Changes

| File                   | Change                                                                       |
| ---------------------- | ---------------------------------------------------------------------------- |
| `src/debug.ts`         | **New.** Exports `DEBUG` constant and `debugLog` function.                   |
| `test/debug.test.ts`   | **New.** Unit tests for `debugLog` on/off behaviour.                         |
| `src/env.ts`           | Add `debugLog` import; name the two bare `catch` errors; call `debugLog`.    |
| `src/skill-loader.ts`  | Add `debugLog` import; name the bare `catch` error; call `debugLog`.         |
| `src/custom-agents.ts` | Add `debugLog` import; name the two bare `catch` errors; call `debugLog`.    |
| `src/memory.ts`        | Add `debugLog` import; name the two bare `catch` errors; call `debugLog`.    |
| `src/output-file.ts`   | Add `debugLog` import; name the bare `catch` error; call `debugLog`.         |
| `src/worktree.ts`      | Add `debugLog` import; name the eight bare `catch` errors; call `debugLog`.  |
| `src/agent-manager.ts` | Add `debugLog` import; name/update the five `catch` blocks; call `debugLog`. |
| `src/notification.ts`  | Add `debugLog` import; name the bare `catch` error; call `debugLog`.         |

## Test Impact Analysis

1. **New tests enabled** — `debug.test.ts` can directly unit-test `debugLog` in isolation.
   Asserting `console.warn` is/isn't called based on the env var is now trivial.
   Previously this path was entirely untested.

2. **Existing tests become redundant** — None.
   The catch blocks were never exercised by existing tests (they were silent drops), so no existing test coverage needs to be removed.

3. **Tests that must stay as-is** — All existing tests remain valid.
   The threading adds a call inside each catch but does not change control flow, return values, or thrown exceptions; no test expectations change.

## TDD Order

1. **`src/debug.ts` + `test/debug.test.ts`** Test surface: `debugLog` calls `console.warn` when `PI_SUBAGENTS_DEBUG=1`; does nothing when unset or `"0"`.
   Use `vi.spyOn(console, 'warn')` + `vi.stubEnv('PI_SUBAGENTS_DEBUG', '1')` + `vi.resetModules()` + dynamic import to exercise both branches.
   Suggested commit: `feat: add debugLog utility gated on PI_SUBAGENTS_DEBUG (#57)`

2. **Thread into `env.ts`** Test surface: `env.test.ts` — existing tests still pass (no new assertions required because the catch paths are tested implicitly by the non-git-dir test already covering the swallowed failures).
   Suggested commit: `feat: thread debugLog into env catch blocks (#57)`

3. **Thread into `skill-loader.ts`** Test surface: `skill-loader.test.ts` — existing tests still pass.
   The readdirSync-error catch is exercised when the skill root does not exist (covered by existing "not found" test paths).
   Suggested commit: `feat: thread debugLog into skill-loader catch block (#57)`

4. **Thread into `custom-agents.ts` and `memory.ts`** These two files have structurally identical filesystem-error catch blocks and can land in a single step.
   Test surface: `custom-agents.test.ts`, `memory.test.ts` — existing tests still pass.
   Suggested commit: `feat: thread debugLog into custom-agents and memory catch blocks (#57)`

5. **Thread into `output-file.ts`** Test surface: `output-file.test.ts` — existing tests still pass.
   Suggested commit: `feat: thread debugLog into output-file catch block (#57)`

6. **Thread into `worktree.ts`** Test surface: `worktree.test.ts` — existing tests still pass.
   Eight catch sites; name each with its enclosing function for label clarity.
   Suggested commit: `feat: thread debugLog into worktree catch blocks (#57)`

7. **Thread into `agent-manager.ts` and `notification.ts`** Test surface: `agent-manager.test.ts`, `notification.test.ts` — existing tests still pass.
   Suggested commit: `feat: thread debugLog into agent-manager and notification catch blocks (#57)`

## Risks and Mitigations

| Risk                                                                                                          | Mitigation                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEBUG` is a module-level constant — `vi.stubEnv` alone won't flip it mid-test                                | Use `vi.resetModules()` + dynamic `import()` inside a test that sets the env var before re-importing; the test skill documents this pattern |
| Adding `(err)` to a bare `catch` in TypeScript is type-safe (`unknown`) but a `noImplicitAny`-adjacent change | `tsconfig` already uses `"useUnknownInCatchVariables": true` (default in strict mode); no cast needed                                       |
| Verbose worktree.ts threading (8 sites) could miss one                                                        | The TDD step runs `pnpm vitest run worktree` and `pnpm run check` before committing                                                         |

## Open Questions

- Should a future issue expose `debugLog` as part of the public `service.ts` API so consumer extensions can share the same debug flag?
  Deferred — out of scope for this change; no consumer currently needs it.
- Should `PI_SUBAGENTS_DEBUG` be documented in the package `README.md`?
  Likely yes, but deferred to a follow-up doc PR.
