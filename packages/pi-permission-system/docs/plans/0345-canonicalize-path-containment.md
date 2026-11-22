---
issue: 345
issue_title: "external_directory gate uses lexical path normalization (no symlink resolution) — in-cwd symlink escapes the cwd boundary"
---

# Canonicalize paths before the external-directory containment check

## Problem Statement

Containment in the `external_directory` gate is decided lexically (`path.resolve` + `path.normalize`) with no symlink canonicalization, so the gate disagrees with what the shell does at exec time.
One root cause, two symptoms:

1. Escape (security-relevant): an in-cwd symlink pointing outside cwd is treated as internal.
   A `./link -> /etc` symlink lets `cat ./link/hosts` read `/etc/hosts` with no prompt, because `./link/hosts` normalizes lexically to `<cwd>/link/hosts`, which passes the within-cwd check.
2. False prompt (nuisance): a symlinked working directory flags its own paths as external.
   On macOS `/tmp` is a symlink to `/private/tmp` and `cwd` resolves to `/private/tmp`, so a `/tmp/foo` token is flagged as outside cwd and prompts (or, headless, blocks).

Both reported repros run through `bash` (`BashProgram.externalPaths`), but the tool-call surface (`read`/`write`/`edit`/`find`/`grep`/`ls` via `isPathOutsideWorkingDirectory`) carries the identical lexical flaw — a `read` of `./link/hosts` escapes the same way.

The fix is to decide containment on canonical (symlink-resolved) paths so that a path resolving outside cwd via an in-cwd symlink is recognized as external (1), and a path under a symlinked cwd is recognized as internal (2).

## Goals

- Resolve symlinks (best-effort) on both the candidate path and cwd before the within-directory comparison, for the tool-call surface (`isPathOutsideWorkingDirectory`) and the bash surface (`BashProgram.externalPaths`).
- Close the in-cwd-symlink escape (symptom 1) so the gate fires on the real target.
- Stop flagging paths under a symlinked cwd as external (symptom 2).
- Handle non-existent write targets: `fs.realpathSync` throws `ENOENT`, so resolve the longest existing ancestor and re-append the non-existent tail.
- Degrade gracefully: any path that cannot be canonicalized (missing root, permission error, symlink loop) falls back to the current lexical behavior, so non-symlink paths are unaffected.

## Non-Goals

- The optional, separate path-pattern deny-evasion surface (a `notes -> .env` symlink evading a `*.env` deny) is out of scope.
  It is a different code path (`normalizeInput` → `evaluate`, not the containment check) and the issue marks it optional.
- No canonicalization of skill-read / skill-prompt-sanitizer path matching.
  Those match skill file locations for prompt filtering, not a security boundary, and adding a filesystem hit there is unwarranted.
- No `$HOME` expansion work — issue [#350] already added `$HOME` to `normalizePathForComparison`.
- No new config fields, schema entries, or surfaces.
- No change to cwd-resolution or pattern-matching semantics outside the containment decision.

## Background

Relevant modules:

- `src/path-utils.ts` — `normalizePathForComparison(pathValue, cwd)` trims, strips a leading `@`, home-expands (`~`, `$HOME`), resolves against cwd, normalizes, and lowercases on win32.
  `isPathWithinDirectory(path, dir)` is a pure string prefix check.
  `isPathOutsideWorkingDirectory(pathValue, cwd)` normalizes both sides lexically and returns `!within`.
  `grep -rn realpath src/` is empty today.
- `src/handlers/gates/external-directory.ts` — `describeExternalDirectoryGate` calls `isPathOutsideWorkingDirectory` for the gate condition, then computes `normalizedExtPath = normalizePathForComparison(...)` used for the infrastructure-read check, the session-approval pattern, and the resolver input.
- `src/handlers/gates/bash-program.ts` — `BashProgram.externalPaths(cwd)` normalizes cwd and each cd-aware candidate lexically, then filters by `isPathWithinDirectory`; returns the surviving normalized paths (used for the prompt, the approval patterns, and the resolver checks in `describeBashExternalDirectoryGate`).
- `src/handlers/gates/tool-call-gate-pipeline.ts` — assembles and runs the gate producers; constructed once in the composition root.

Constraints from AGENTS.md / skills:

- Default to least privilege; under-matching a containment check on an `external_directory` `ask`/`deny` is the dangerous direction (symptom 1).
- The `code-design` skill prefers pure functions with IO at the edges.
  We localize the `realpathSync` call in a single small module so the rest of `path-utils` stays lexical, and tests mock `node:fs` (the same technique `path-utils.test.ts` already uses for `node:os`) rather than threading a `realpath` dependency through the pipeline. (User-confirmed: direct `fs.realpathSync` over DI threading; scope covers both bash and tool-call surfaces.)
- `node:*` mocks must include a `default` key mirroring named exports (testing skill).

## Design Overview

### Best-effort canonicalization

A new module `src/canonicalize-path.ts` resolves symlinks for an already-absolute path, tolerating non-existent tails:

```typescript
import { realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * Resolve symlinks in an absolute path, best-effort.
 *
 * Walks up to the longest existing ancestor, canonicalizes it, and re-appends
 * the non-existent tail. Returns the input unchanged when it cannot be
 * canonicalized (no existing ancestor, permission error, or symlink loop),
 * so callers fall back to lexical containment for non-symlink paths.
 */
export function canonicalizePath(absolutePath: string): string {
  if (!absolutePath) return absolutePath;

  const tail: string[] = [];
  let current = absolutePath;
  while (true) {
    try {
      const real = realpathSync(current);
      return tail.length === 0 ? real : join(real, ...tail.toReversed());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        return absolutePath; // EACCES, ELOOP, … → lexical fallback
      }
      const parent = dirname(current);
      if (parent === current) return absolutePath; // reached root, still missing
      tail.push(basename(current));
      current = parent;
    }
  }
}
```

Properties:

- An existing symlink anywhere in the path is resolved by `realpathSync` in one call.
- A non-existent leaf (a `write` target) walks up one level, canonicalizes the existing parent, and re-appends the leaf.
- A path with no existing ancestor (e.g. the synthetic `/test/project` used in integration tests) walks to root and returns the lexical input unchanged — so existing tests that use non-existent paths keep their current behavior with no mocking.
- `ELOOP` / `EACCES` fall back to lexical rather than throwing.

### Canonical containment in path-utils

Add a canonicalizing variant alongside the lexical normalizer (keeping `normalizePathForComparison` lexical for skill matching):

```typescript
export function canonicalNormalizePathForComparison(
  pathValue: string,
  cwd: string,
): string {
  const lexical = normalizePathForComparison(pathValue, cwd);
  if (!lexical) return "";
  const canonical = canonicalizePath(lexical);
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}
```

`isPathOutsideWorkingDirectory` switches both sides to the canonical variant:

```typescript
export function isPathOutsideWorkingDirectory(
  pathValue: string,
  cwd: string,
): boolean {
  const normalizedCwd = canonicalNormalizePathForComparison(cwd, cwd);
  const normalizedPath = canonicalNormalizePathForComparison(pathValue, cwd);
  if (!normalizedCwd || !normalizedPath) return false;
  if (isSafeSystemPath(normalizedPath)) return false;
  return !isPathWithinDirectory(normalizedPath, normalizedCwd);
}
```

`isSafeSystemPath` still runs on the canonical path; `/dev/null` etc. canonicalize to themselves, so the device-file allowlist is unaffected.

### Gate coherence

`describeExternalDirectoryGate` recomputes its `normalizedExtPath` via `canonicalNormalizePathForComparison` so the gate's fire decision, the infrastructure-read check, the derived approval pattern, and the resolver input all reference the same canonical target.
The raw `externalDirectoryPath` is still used for the user-facing display message, so the prompt continues to echo what the user wrote (e.g. `./link/hosts`), while the approval pattern now covers the real target (`/etc/hosts`).

`BashProgram.externalPaths(cwd)` canonicalizes the normalized cwd once and each normalized candidate before the within-directory filter and dedup `seen` set, and returns the canonical paths.
Downstream (`describeBashExternalDirectoryGate`) keeps deriving patterns and resolving against those values, now canonical.

### Worked outcomes

| Repro                                  | Lexical (today)                                       | Canonical (fixed)                                           |
| -------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------- |
| `cat ./link/hosts`, `./link -> /etc`   | `<cwd>/link/hosts` → inside → no gate                 | `/etc/hosts` → outside → gate fires                         |
| `read` of `./link/hosts`               | `<cwd>/link/hosts` → inside → no gate                 | `/etc/hosts` → outside → gate fires                         |
| `/tmp/foo` under cwd `/private/tmp`    | token `/tmp/foo` vs `/private/tmp` → outside → prompt | both canonicalize under `/private/tmp` → inside → no prompt |
| non-existent `/test/project/x` (tests) | lexical                                               | walk-to-root fallback → lexical (unchanged)                 |

## Module-Level Changes

- `src/canonicalize-path.ts` (new) — `canonicalizePath(absolutePath)`; direct `node:fs` `realpathSync` import.
- `src/path-utils.ts` — add `canonicalNormalizePathForComparison`; switch `isPathOutsideWorkingDirectory` to it.
  Import `canonicalizePath`.
- `src/handlers/gates/external-directory.ts` — compute `normalizedExtPath` via `canonicalNormalizePathForComparison` (replacing the lexical call).
- `src/handlers/gates/bash-program.ts` — canonicalize `normalizedCwd` and each candidate `normalized` in `externalPaths` before the containment filter.
- `docs/architecture/architecture.md` — add `canonicalize-path.ts` to the source-tree listing and extend the `path-utils.ts` description to mention symlink canonicalization for containment.

No exports are removed or renamed, so no consumer-import sweep is needed; the only existing call sites of `isPathOutsideWorkingDirectory` and `externalPaths` keep their signatures.

## Test Impact Analysis

1. New lower-level tests the change enables: `canonicalize-path.test.ts` unit-tests the walk-up algorithm in isolation (existing symlink, non-existent leaf, deeply non-existent, root fallback, `ELOOP`/`EACCES` fallback, empty input) with a mocked `node:fs` `realpathSync`.
   This is now possible because the FS effect is isolated in one tiny module.
2. Redundant tests: none.
   Existing `isPathOutsideWorkingDirectory` and `externalPaths` cases assert containment, not canonicalization; they stay as behavioral guards (and pass with an identity `realpathSync` mock).
3. Tests that must stay as-is: `external-directory-integration.test.ts` and `external-directory-session-dedup.test.ts` use synthetic non-existent paths (`/test/project`, `/outside/...`); the walk-to-root fallback returns them unchanged, so they exercise the unchanged lexical path with no mock and need no edits.

## TDD Order

1. `test:` + `feat:` — `canonicalize-path.ts` + `test/canonicalize-path.test.ts`.
   Red: `vi.mock("node:fs")` (with `default` key) supplying a map-based `realpathSync`; cover existing-symlink resolution, non-existent-leaf re-append, deep walk-up, root-level `ENOENT` → lexical fallback, `ELOOP`/`EACCES` → lexical fallback, and empty-string input.
   Green: implement `canonicalizePath`.
   Commit: `feat(pi-permission-system): add best-effort canonicalizePath helper`.
2. `test:` + `fix:` — tool-call containment.
   Add `vi.mock("node:fs")` to `test/path-utils.test.ts` with an identity `realpathSync` default (so all existing cases pass) plus per-test symlink mappings.
   Red: in-cwd symlink to `/etc` → `isPathOutsideWorkingDirectory` true (symptom 1); path under a symlinked cwd → false (symptom 2).
   Update `test/handlers/gates/external-directory.test.ts` for the now-canonical `normalizedExtPath` in the descriptor's `input`, `sessionApproval` pattern, and infra-read path (fold into this commit — same surface).
   Green: add `canonicalNormalizePathForComparison`, switch `isPathOutsideWorkingDirectory`, and update `describeExternalDirectoryGate`.
   Run `pnpm run check` (shared-function change).
   Commit: `fix(pi-permission-system): canonicalize tool-call external-directory containment (#345)`.
3. `test:` + `fix:` — bash containment.
   Add `vi.mock("node:fs")` to `test/handlers/gates/bash-program.test.ts` with an identity default.
   Red: an in-cwd symlink token resolves to its external target and is flagged (symptom 1); a `/tmp/...` token under a symlinked `/private/tmp` cwd is not flagged (symptom 2).
   Green: canonicalize cwd and candidates in `BashProgram.externalPaths`.
   Verify `test/handlers/gates/bash-external-directory.test.ts` still passes (identity mock keeps non-symlink fixtures stable); adjust only if a fixture path happens to canonicalize differently.
   Commit: `fix(pi-permission-system): canonicalize bash external-path containment (#345)`.
4. `docs:` — update `docs/architecture/architecture.md` source-tree listing and `path-utils.ts` description.
   Check `README.md` / `docs/configuration.md` for any claim that external-directory matching is purely lexical; update if present.
   Commit: `docs(pi-permission-system): note symlink canonicalization in architecture`.

Run the full suite (`pnpm --filter @gotgenes/pi-permission-system exec vitest run`) after step 3, since steps 2 and 3 change shared helpers consumed across the gate suite.

## Risks and Mitigations

- TOCTOU: canonicalization is inherently best-effort — a symlink can change between the check and exec.
  This narrows the gap dramatically versus today (no resolution at all) but does not close it; documented as accepted.
- Performance: one or more `realpathSync` syscalls per path check.
  The walk-up is bounded by path depth and only runs on the gate path (not hot); acceptable.
- Visible behavior change: prompts/patterns for symlinked inputs now reference the canonical target.
  This is an improvement (the approval covers the real destination); the user-facing display still echoes the raw input via `externalDirectoryPath`.
- Cross-platform: `realpathSync` returns canonical case on win32; `canonicalNormalizePathForComparison` re-lowercases.
  All unit tests mock `node:fs`, so they are deterministic regardless of host platform.
- Existing tests with synthetic paths: the root-fallback property keeps them on the lexical path; verified by the integration-test note above.

## Open Questions

- The optional path-pattern deny-evasion surface (symlink alias vs `*.env`) is deferred; file a follow-up if it warrants its own gate-level fix.
- Whether to canonicalize skill-read matching is deferred until there is a concrete skill-path symlink case.

[#350]: https://github.com/gotgenes/pi-packages/issues/350
