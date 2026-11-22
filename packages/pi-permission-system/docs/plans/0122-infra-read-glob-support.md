---
issue: 122
issue_title: "piInfrastructureReadPaths doesn't support glob patterns (**), causing confusing fallback to external_directory"
---

# Glob support for `piInfrastructureReadPaths`

## Problem Statement

`piInfrastructureReadPaths` only supports exact directory prefixes via `isPathWithinDirectory()`.
Users who configure glob patterns (e.g. `/opt/homebrew/**/@earendil-works/pi-coding-agent/**`) see silent failures — the path never matches, and reads fall through to the `external_directory` gate.
The docs say the field "supports `~`", but even `~` expansion is missing for plain entries because `path-utils.ts` never calls `expandHomePath()`.

## Goals

- Support `*` and `?` wildcards in `piInfrastructureReadPaths` entries, using the existing `wildcardMatch()` semantics (where `*` matches any characters including `/`).
- Fix `~` expansion for plain (non-glob) directory entries.
- Update schema description, docs, and example config to reflect glob support.
- Fully backward-compatible — plain directory entries keep prefix-match behavior.

## Non-Goals

- Adding true globstar (`**` vs `*` distinction) — the existing wildcard matcher treats them identically, which is fine for path matching.
- Changing the `wildcardMatch()` implementation itself.
- Glob support for the static `piInfrastructureDirs` (computed internally, always absolute paths).

## Background

The infrastructure read bypass is wired as follows:

1. `PermissionSession.getInfrastructureReadPaths()` returns `config.piInfrastructureReadPaths ?? []`.
2. `PermissionGateHandler` merges these with `session.getInfrastructureDirs()` into a single `infraDirs` array.
3. `describeExternalDirectoryGate()` passes `infraDirs` to `isPiInfrastructureRead()`.
4. `isPiInfrastructureRead()` iterates `infrastructureDirs` and calls `isPathWithinDirectory()` — pure prefix matching.

The existing `wildcardMatch()` in `src/wildcard-matcher.ts` already handles `*` (any characters), `?` (one character), and `~`/`$HOME` expansion.
It is used by the rule evaluator for `external_directory` permission patterns, which is why the reporter's workaround with `external_directory` rules worked.

The original plan (archive/0048) explicitly deferred glob support as an open question: "Starting with directory prefixes (simpler).
Globs can be added later if needed."
This issue is that "later."

## Design Overview

The change is contained in `isPiInfrastructureRead()`.
For each entry in `infrastructureDirs`, detect whether it contains glob characters (`*` or `?`).
If it does, use `wildcardMatch(entry, normalizedPath)`.
If it does not, expand `~` via `expandHomePath()` and use the existing `isPathWithinDirectory()` prefix match.

```typescript
import { expandHomePath } from "./expand-home";
import { wildcardMatch } from "./wildcard-matcher";

function containsGlobChars(value: string): boolean {
  return value.includes("*") || value.includes("?");
}

// Inside isPiInfrastructureRead, the loop becomes:
for (const dir of infrastructureDirs) {
  if (containsGlobChars(dir)) {
    if (wildcardMatch(dir, normalizedPath)) return true;
  } else {
    if (isPathWithinDirectory(normalizedPath, expandHomePath(dir))) return true;
  }
}
```

This is backward-compatible: entries without glob characters behave identically (prefix match), with the bonus that `~` now expands correctly.
Entries with glob characters get full wildcard matching.

The `containsGlobChars` helper is a private function — not exported, no new module.

## Module-Level Changes

| File                                   | Change                                                                                                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/path-utils.ts`                    | Import `expandHomePath` and `wildcardMatch`. Add private `containsGlobChars()`. Update the loop in `isPiInfrastructureRead()` to branch on glob detection. |
| `schemas/permissions.schema.json`      | Update `piInfrastructureReadPaths` description: remove "no globs" caveat, document `*` and `?` support.                                                    |
| `docs/configuration.md`                | Update the `piInfrastructureReadPaths` row to mention wildcard support and add an example.                                                                 |
| `tests/pi-infrastructure-read.test.ts` | Add tests for glob patterns matching, glob patterns not matching, `~` expansion in plain entries, and mixed glob + plain entries.                          |
| `tests/path-utils.test.ts`             | Add corresponding `isPiInfrastructureRead` glob tests in the existing describe block.                                                                      |

## Test Impact Analysis

1. The new glob branch in `isPiInfrastructureRead()` enables unit tests that were previously impossible: verifying that `*` and `?` patterns in infrastructure dirs match versioned/nested paths.
2. No existing tests become redundant — they all exercise the plain-directory branch which is preserved.
3. All existing `isPiInfrastructureRead` tests must stay as-is; they verify the prefix-match path still works.

## TDD Order

1. **test: glob patterns in `isPiInfrastructureRead`** Add failing tests to `tests/pi-infrastructure-read.test.ts`:
   - Glob entry `/opt/homebrew/*/@earendil-works/pi-coding-agent/*` matches a versioned path.
   - Glob entry with `**` behaves the same as `*` (matches across `/`).
   - Glob entry that doesn't match returns false.
   - `?` in a glob entry matches exactly one character.
   - Mixed array of plain dirs and glob patterns — both branches work.
   - Plain entry with `~` prefix now matches (currently broken).
   - Write tool with a glob-matching path is still rejected (read-only guard).

2. **feat: support glob patterns in `piInfrastructureReadPaths`** Update `src/path-utils.ts`:
   - Import `expandHomePath` from `./expand-home` and `wildcardMatch` from `./wildcard-matcher`.
   - Add private `containsGlobChars()` helper.
   - Update the `infrastructureDirs` loop in `isPiInfrastructureRead()` to branch on glob detection.
   Commit: `feat: support glob patterns in piInfrastructureReadPaths (#122)`

3. **test: add glob coverage to `path-utils.test.ts`** Add a few representative glob tests to the `isPiInfrastructureRead` describe block in `tests/path-utils.test.ts` to ensure both test files cover the feature.
   Commit: `test: add glob infra-read coverage to path-utils tests`

4. **docs: update schema and docs for glob support**
   - Update `schemas/permissions.schema.json`: change `piInfrastructureReadPaths` description to document `*`, `?`, and `~` support.
   - Update `docs/configuration.md`: revise the `piInfrastructureReadPaths` row and add a glob example.
   Commit: `docs: document piInfrastructureReadPaths glob support (#122)`

## Risks and Mitigations

| Risk                                                                            | Mitigation                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overly broad glob pattern (e.g. `/*`) silently auto-allows reads everywhere     | This is a user-configured field with the same trust model as `external_directory: allow` rules. The review log already records every `infrastructure_auto_allowed` bypass, making over-broad patterns visible. |
| `wildcardMatch` treats `*` as `.*` (crosses `/`), so `*` and `**` are identical | This matches the existing wildcard semantics used everywhere else in the permission system. Document it clearly — users don't need to learn a different globbing dialect.                                      |
| Plain entries with `~` were silently broken before this change                  | Adding `expandHomePath()` to the non-glob branch fixes this as a side effect. Backward-compatible because previously `~` entries simply never matched.                                                         |
| `containsGlobChars` false-positive on literal `*` or `?` in a path              | Filesystem paths virtually never contain literal `*` or `?`. On macOS/Linux these characters are legal but extremely rare and strongly discouraged. The risk is negligible.                                    |

## Open Questions

- None — the design reuses existing infrastructure (`wildcardMatch`, `expandHomePath`) with minimal new code.
