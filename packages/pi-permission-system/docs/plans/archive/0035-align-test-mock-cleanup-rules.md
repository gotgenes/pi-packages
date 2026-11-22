---
issue: 35
issue_title: "Align #21 test files with updated mock-cleanup and node:* default-export rules"
---

# Align #21 test files with updated mock-cleanup and node:\* default-export rules

## Problem Statement

Two AGENTS.md testing rules were added during the #21 retro, but the three test files that were written as part of #21 still violate them:

1. `vi.fn()` stubs are reset via `vi.clearAllMocks()` in `afterEach` rather than via explicit `.mockReset()` (or `.mockClear()`) calls on named module-scope references in `beforeEach`.
   `vi.restoreAllMocks()` only handles `vi.spyOn()` spies — `vi.clearAllMocks()` is the wrong hook for `vi.fn()` stubs, and reset-in-`afterEach` fires after the test body has already completed, so a leaked state from test N can pollute test N+1 before `afterEach` runs.
2. `tests/external-directory.test.ts` mocks `node:os` without a `default` export, creating a latent "No default export defined on the mock" failure for any future import path that uses the default form of that module.

## Goals

- Replace `vi.clearAllMocks()` in `afterEach` with explicit `beforeEach` + `.mockReset()` (or `.mockClear()` where the default implementation must be preserved) on named stub references in the three affected test files.
- Add the `default` mirror export to the `node:os` mock factory in `tests/external-directory.test.ts`.
- Pass `npx vitest run` and `npm run build` with no regressions.

## Non-Goals

- Changes to production source files.
- Extending test coverage beyond what is needed for the cleanup.
- Updating any other test files that were not written in #21.
- Schema, config, or documentation changes.

## Background

### Affected files

All four files were created in #21.
No permission surface or runtime behavior is involved — this is test-infrastructure hygiene.

| File                               | Violation                                                                                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/bash-filter.test.ts`        | `vi.clearAllMocks()` in `afterEach`; two `vi.fn()` stubs (`compileWildcardPatterns`, `findCompiledWildcardMatch`) cleaned up globally rather than individually |
| `tests/permission-prompts.test.ts` | `vi.clearAllMocks()` in `afterEach`; `mockedFormatToolInput` reset globally                                                                                    |
| `tests/tool-input-preview.test.ts` | `vi.clearAllMocks()` in `afterEach`; `mockedStringify` reset globally                                                                                          |
| `tests/external-directory.test.ts` | `node:os` mock factory missing `default` key; `vi.restoreAllMocks()` in `afterEach` is correct as-is (no `vi.fn()` stubs to clean up there)                    |

### Current pattern (all three mock-cleanup files)

```typescript
afterEach(() => {
  vi.clearAllMocks();    // wrong hook for vi.fn() stubs
  vi.restoreAllMocks();  // correct for vi.spyOn() spies
});
```

### Target pattern

```typescript
beforeEach(() => {
  mockedX.mockReset();   // or mockClear() when default implementation must survive
});
afterEach(() => {
  vi.restoreAllMocks();  // unchanged
});
```

### `compileWildcardPatterns` nuance in `bash-filter.test.ts`

The `vi.mock()` factory for `wildcard-matcher` supplies a non-trivial default implementation for `compileWildcardPatterns` (it transforms the patterns object into a compiled array).
Several tests assert `.toHaveBeenCalledWith(...)` on that function but rely on the default implementation being in place.
`mockReset()` would wipe the implementation and cause those tests to fail.
`mockClear()` clears call history while preserving the implementation — it is the correct choice here.
`findCompiledWildcardMatch` has no default implementation and each test that needs a return value calls `.mockReturnValue()` explicitly, so `mockReset()` is safe.

A module-scope `vi.mocked()` reference should be extracted for `compileWildcardPatterns` so it can be addressed explicitly in `beforeEach`.

## Design Overview

No new types, modules, or config changes.
All changes are confined to four test files.

### `tests/bash-filter.test.ts`

1. Extract `const mockedCompilePatterns = vi.mocked(compileWildcardPatterns);` at module scope.
2. `beforeEach`: call `mockedCompilePatterns.mockClear()` and `mockedFindMatch.mockReset()`.
3. `afterEach`: keep only `vi.restoreAllMocks()`.
4. Remove `vi.clearAllMocks()`.

### `tests/permission-prompts.test.ts`

1. `beforeEach`: call `mockedFormatToolInput.mockReset()`.
   (`mockedFormatToolInput` is already module-scope.)
2. `afterEach`: keep only `vi.restoreAllMocks()`.
3. Remove `vi.clearAllMocks()`.

### `tests/tool-input-preview.test.ts`

1. `beforeEach`: call `mockedStringify.mockReset()`.
   (`mockedStringify` is already module-scope.)
2. `afterEach`: keep only `vi.restoreAllMocks()`.
3. Remove `vi.clearAllMocks()`.

### `tests/external-directory.test.ts`

Replace the `node:os` mock factory:

```typescript
// Before
vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/mock/home"),
}));

// After
vi.mock("node:os", () => {
  const homedir = vi.fn(() => "/mock/home");
  return {
    homedir,
    default: { homedir },
  };
});
```

No `beforeEach` changes are needed here — `homedir` is not referenced by a module-scope `vi.mocked()` variable, and the `afterEach` `vi.restoreAllMocks()` is correct as-is.

## Module-Level Changes

| File                               | Change                                                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `tests/bash-filter.test.ts`        | Extract `mockedCompilePatterns`; add `beforeEach` with `mockClear`/`mockReset`; replace `afterEach` body |
| `tests/permission-prompts.test.ts` | Add `beforeEach` with `mockReset`; replace `afterEach` body                                              |
| `tests/tool-input-preview.test.ts` | Add `beforeEach` with `mockReset`; replace `afterEach` body                                              |
| `tests/external-directory.test.ts` | Refactor `node:os` mock factory to include `default` key                                                 |

No source files, schemas, config, or documentation are modified.

## TDD Order

Because this issue is a test-file refactor with no production code changes, each cycle is: verify tests still pass (green) → make the change → verify still green → commit.

1. Verify baseline: `npx vitest run` passes for all four test files.
   Commit message: *(no commit — baseline only)*
2. Refactor `tests/bash-filter.test.ts`: extract `mockedCompilePatterns`, add `beforeEach` with `mockClear`/`mockReset`, drop `vi.clearAllMocks()`.
   Commit message: `test: use beforeEach mockReset/mockClear in bash-filter tests (#35)`
3. Refactor `tests/permission-prompts.test.ts`: add `beforeEach` with `mockReset`, drop `vi.clearAllMocks()`.
   Commit message: `test: use beforeEach mockReset in permission-prompts tests (#35)`
4. Refactor `tests/tool-input-preview.test.ts`: add `beforeEach` with `mockReset`, drop `vi.clearAllMocks()`.
   Commit message: `test: use beforeEach mockReset in tool-input-preview tests (#35)`
5. Refactor `tests/external-directory.test.ts`: extract `homedir` into a named variable and return it with a `default` mirror in the `node:os` mock factory.
   Commit message: `test: add default export to node:os mock in external-directory tests (#35)`
6. Final verification: `npx vitest run` and `npm run build` both pass.
   Commit message: *(included in step 5 commit or a follow-up if build reveals type issues)*

## Risks and Mitigations

| Risk                                                                                                        | Mitigation                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `mockReset()` on `compileWildcardPatterns` wipes the default implementation, breaking tests that rely on it | Use `mockClear()` for that stub; confirmed safe because it only clears call history                                                    |
| Removing `vi.clearAllMocks()` leaves state leak between tests if a stub is missed                           | The `beforeEach` hooks are exhaustive — every `vi.fn()` in each file is listed; run `npx vitest run` after each file change to confirm |
| Could this silently weaken a permission?                                                                    | No. No production code or policy logic is modified. These are test-only changes.                                                       |
| `default` key addition to `node:os` mock could break existing tests that rely on named imports only         | Adding `default` is purely additive; tests using `import { homedir } from "node:os"` are unaffected                                    |

## Open Questions

- None.
  The changes are fully specified by the issue and the AGENTS.md rules.
