---
issue: 505
issue_title: "pi-permission-system: dissolve the path-utils grab-bag behind AccessPath (Phase 7 Step 4)"
---

# Dissolve the `path-utils.ts` grab-bag into cohesive path modules

## Release Recommendation

**Release:** ship independently

This is Phase 7 Step 4 ([#505]) of the [#487] roadmap, tagged `Release: independent` — a pure structural refactor with no behavior change.
It is not part of the `symlink-resistant-path-matching` batch (Steps 1–3, already shipped), so it carries no batch obligation.
The commits are `refactor:` / `docs:` (changelog-`hidden`), so this work lands on `main` and auto-batches into the next `feat:`/`fix:` release rather than cutting one on its own.

## Problem Statement

`path-utils.ts` is the package's path-derivation grab-bag — 18 symbols spanning four unrelated jobs (representation derivation, geometric containment, tool-input extraction, static lookup sets), 13 fan-in, and an accelerating churn hotspot (266 churn over six months, trending up).
It is the ad-hoc "re-derive path representations" surface the [#487] vision exists to consolidate.
After Steps 1–3 ([#502], [#503], [#504]) routed the per-tool gate and service/RPC queries onto `AccessPath`, the lexical/canonical/policy-value derivation in this file is consumed almost entirely by `AccessPath` — so it belongs *with* `AccessPath` in the `access-intent/` domain, and the rest belongs in focused single-job modules.

## Goals

- Dissolve `path-utils.ts` entirely into cohesive, single-responsibility modules.
- Relocate the representation derivation (`normalizePathForComparison`, `canonicalNormalizePathForComparison`, `normalizePathPolicyLiteral`, `getPathPolicyValues` + private helpers, `PathPolicyValueOptions`) into `src/access-intent/path-normalization.ts` as `AccessPath`'s backing.
- Keep the geometric-containment predicates (`isPathWithinDirectory`, `isPathOutsideWorkingDirectory`) together in a focused `src/path-containment.ts`.
- Split the remaining jobs into focused modules: safe-system paths, Pi infrastructure-read, tool-input extraction, and the surface/tool lookup sets.
- Preserve behavior exactly — this is non-breaking at every surface (no public API, config, schema, or decision change).
- Mirror the module split in the test suite: each new module gets a focused test file; `path-utils.test.ts` is dissolved.

## Non-Goals

- **No config-pattern derivation.**
  Rule patterns (`*.env`, `src/*`) stay raw globs/regex — they are never path-derived (a standing Phase 7 Non-goal).
  Nothing in this work touches the matcher.
- **No change to `AccessPath`'s outputs or accessors.**
  `matchValues()` / `boundaryValue()` / `value()` keep their exact results; only the import path of their backing functions moves.
- **No deeper boundary rework.**
  We do not re-express `isPathOutsideWorkingDirectory` as an `AccessPath` method or collapse it into the gate flow beyond the minimal prep refactor below — the `path-values` boundary formalization is Step 5 ([#506]), a separate issue.
- **No `PathNormalizer` API change.**
  Its public method surface (`forPath`/`forLiteral`/`isAbsolute`/`isWithinDirectory`/`isOutsideWorkingDirectory`/`comparableValue`/`isInfrastructureRead`/…) is unchanged; only its private delegation targets move.
- The frozen historical doc `docs/architecture/history/phase-6-access-intent-extraction.md` references `path-utils` as it was — it is a snapshot and is **not** edited.

## Background

Relevant existing modules:

- `src/path-utils.ts` — the grab-bag being dissolved (full inventory in Design Overview).
- `src/access-intent/access-path.ts` — `AccessPath` value object; `forPath` composes `normalizePathForComparison` + `getPathPolicyValues` + `canonicalNormalizePathForComparison`.
- `src/path-normalizer.ts` — `PathNormalizer` facade, constructed at the session edge with `platform` + `cwd` baked in; delegates to the `path-utils` leaf functions.
  The **sole** caller of the free `isPathOutsideWorkingDirectory`.
- `src/access-intent/bash/bash-path-resolver.ts` — imports `isSafeSystemPath`, `normalizePathPolicyLiteral`.
- `src/rule.ts`, `src/permission-manager.ts`, `src/input-normalizer.ts` — import `PATH_SURFACES`.
- `src/pattern-suggest.ts`, `src/handlers/gates/tool.ts` — import `PATH_BEARING_TOOLS`.
- `src/handlers/gates/{path,external-directory,tool,tool-call-gate-pipeline}.ts` — import `getToolInputPath` / `getPathBearingToolPath`.

Constraints from AGENTS.md / the package skill that apply:

- The ESLint `no-restricted-syntax` guard forbids `process.platform` in `pi-permission-system/src/**` (except `index.ts`).
  Every relocated leaf must keep taking an injected `platform` parameter — no `= process.platform` defaults.
- `docs/architecture/architecture.md` module-tree, Phase 7 step list, Mermaid node, findings metrics, and the "PathNormalizer platform seam" prose all name `path-utils.ts` and must be updated in the implementation doc commit (mark Step 4 ✅ there, not at ship).
- `.pi/skills/package-pi-permission-system/SKILL.md` names `src/path-utils.ts` in prose — reworded mechanism prose carries no removed symbol, so it must be grepped and updated.
- `subagent-context.ts` has its **own** private `isPathWithinDirectoryForSubagent` — it does not consume `path-utils` and is out of scope.

## Design Overview

### The carve: representation vs geometry, on a shared primitive

Every function in `path-utils.ts` operates on the **accessed-path side** (a path the agent is trying to touch), not the config side.
The real seam is two different jobs done to that path:

| Job                         | Functions                                                                                                                                      | Feeds                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Representation (derivation) | `normalizePathForComparison`, `canonicalNormalizePathForComparison`, `normalizePathPolicyLiteral`, `getPathPolicyValues` (+ 2 private helpers) | `AccessPath` match/boundary/display values → resolver pattern test |
| Geometry (containment)      | `isPathWithinDirectory`, `isPathOutsideWorkingDirectory`                                                                                       | gate bypass / auto-allow boundary decisions                        |
| Extraction                  | `getToolInputPath`, `getPathBearingToolPath`                                                                                                   | pulls the path out of a tool payload                               |
| Lookup sets                 | `PATH_BEARING_TOOLS`, `READ_ONLY_PATH_BEARING_TOOLS`, `PATH_SURFACES`                                                                          | static surface membership                                          |
| Safe-system                 | `SAFE_SYSTEM_PATHS`, `isSafeSystemPath`                                                                                                        | OS device-file allowlist                                           |
| Infra-read                  | `isPiInfrastructureRead` (+ private `containsGlobChars`)                                                                                       | Pi infrastructure auto-allow                                       |

`isPathWithinDirectory` is the truly foundational piece: pure `path.relative` math, zero dependencies, used by representation (for the cwd-relative alias), by both boundary predicates, and by `PathNormalizer` directly.

### Breaking the apparent cycle: "prepare the data, then ask"

A naïve split (representation → `access-intent/`, both containment funcs → `path-containment.ts`) appears to force a module cycle: `getPathPolicyValues` (representation) calls `isPathWithinDirectory` (geometry), while `isPathOutsideWorkingDirectory` (geometry) calls `canonicalNormalizePathForComparison` (representation).

The cycle is not fundamental — it is an artifact of `isPathOutsideWorkingDirectory` being mis-factored.
It bundles "prepare the data" with "ask the question":

```typescript
// today: derives BOTH operands inline, then asks — the only geometry→representation edge
export function isPathOutsideWorkingDirectory(pathValue, cwd, platform) {
  const normalizedCwd = canonicalNormalizePathForComparison(cwd, cwd, platform);
  const normalizedPath = canonicalNormalizePathForComparison(pathValue, cwd, platform);
  if (!normalizedCwd || !normalizedPath) return false;
  if (isSafeSystemPath(normalizedPath)) return false;
  return !isPathWithinDirectory(normalizedPath, normalizedCwd, platform);
}
```

Its sibling `isPiInfrastructureRead` already follows the right discipline: it receives the already-canonical `accessPath.boundaryValue()` from `PathNormalizer` and never re-derives.
`isPathWithinDirectory` already follows it too: pure geometry over normalized operands.

The fix is to make `isPathOutsideWorkingDirectory` pure geometry as well — receive prepared canonical operands, and push the canonicalization up to its single caller, `PathNormalizer.isOutsideWorkingDirectory`, which already owns `cwd` and `platform`:

```typescript
// path-containment.ts — pure geometry, no representation import
export function isPathOutsideWorkingDirectory(
  canonicalPath: string,
  canonicalCwd: string,
  platform: NodeJS.Platform,
): boolean {
  if (!canonicalCwd || !canonicalPath) return false;
  if (isSafeSystemPath(canonicalPath)) return false;
  return !isPathWithinDirectory(canonicalPath, canonicalCwd, platform);
}

// path-normalizer.ts — the caller prepares the operands (canonical cwd cached once)
isOutsideWorkingDirectory(pathValue: string): boolean {
  const canonicalPath = canonicalNormalizePathForComparison(
    pathValue, this.cwd, this.platform,
  );
  return isPathOutsideWorkingDirectory(canonicalPath, this.canonicalCwd, this.platform);
}
```

With the inline derivation removed, geometry no longer imports representation, and the dependency graph is a strict DAG:

```text
safe-system-paths.ts ─┐
                      ▼
path-containment.ts  (isPathWithinDirectory, isPathOutsideWorkingDirectory — pure geometry)
        ▲
access-intent/path-normalization.ts  (all representation; calls the geometry primitive downward)
        ▲
access-intent/access-path.ts (AccessPath)
        ▲
path-normalizer.ts  (derives canonical operands, hands them to geometry)
```

This honors the issue's literal grouping: representation lands in **one** `access-intent/path-normalization.ts`, and both containment predicates stay together in **one** focused `path-containment.ts`.

### Final module set (six modules; `path-utils.ts` deleted)

| New module                                | Residents                                                                                                                                                                                                                    | Imports                                                                                                                                    |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/access-intent/path-normalization.ts` | `normalizePathForComparison`, `canonicalNormalizePathForComparison`, `normalizePathPolicyLiteral`, `getPathPolicyValues`, `PathPolicyValueOptions`, private `getAbsolutePathPolicyValues` / `getCwdRelativePathPolicyValues` | `isPathWithinDirectory` (path-containment), `expandHomePath`, `canonicalizePath`, `node:path`                                              |
| `src/path-containment.ts`                 | `isPathWithinDirectory`, `isPathOutsideWorkingDirectory` (pure geometry)                                                                                                                                                     | `isSafeSystemPath` (safe-system-paths), `node:path`                                                                                        |
| `src/safe-system-paths.ts`                | `SAFE_SYSTEM_PATHS`, `isSafeSystemPath`                                                                                                                                                                                      | —                                                                                                                                          |
| `src/pi-infrastructure-read.ts`           | `isPiInfrastructureRead`, private `containsGlobChars`                                                                                                                                                                        | `isPathWithinDirectory` (path-containment), `READ_ONLY_PATH_BEARING_TOOLS` (path-surfaces), `expandHomePath`, `wildcardMatch`, `node:path` |
| `src/tool-input-path.ts`                  | `getToolInputPath`, `getPathBearingToolPath`                                                                                                                                                                                 | `PATH_BEARING_TOOLS` (path-surfaces), `getNonEmptyString` / `toRecord` (value-guards), `ToolAccessExtractorLookup` (type)                  |
| `src/path-surfaces.ts`                    | `PATH_BEARING_TOOLS`, `READ_ONLY_PATH_BEARING_TOOLS`, `PATH_SURFACES`                                                                                                                                                        | —                                                                                                                                          |

DAG verification: `path-surfaces` and `safe-system-paths` are leaves; `path-containment → safe-system-paths`; `path-normalization → path-containment`; `pi-infrastructure-read → {path-containment, path-surfaces}`; `tool-input-path → path-surfaces`.
No cycles.

### Edge cases preserved

- `isPathOutsideWorkingDirectory` keeps its empty-operand guard, safe-system short-circuit, and `platform` (for `path.relative` separator choice) — only the canonicalization moves out.
- `PathNormalizer` canonicalizes its `cwd` once at construction (`this.canonicalCwd`), matching today's per-call result but avoiding a redundant `realpathSync` per query (a behavior-equivalent improvement; cwd symlink target does not change mid-session).
- All leaf functions keep their injected `platform` parameter (the `no-restricted-syntax` guard stays green).

## Module-Level Changes

### Source — new files

- `src/access-intent/path-normalization.ts` — representation derivation (see table).
- `src/path-containment.ts` — `isPathWithinDirectory` + pure-geometry `isPathOutsideWorkingDirectory`.
- `src/safe-system-paths.ts` — `SAFE_SYSTEM_PATHS`, `isSafeSystemPath`.
- `src/pi-infrastructure-read.ts` — `isPiInfrastructureRead` + `containsGlobChars`.
- `src/tool-input-path.ts` — `getToolInputPath`, `getPathBearingToolPath`.
- `src/path-surfaces.ts` — the three lookup sets.

### Source — deleted

- `src/path-utils.ts` — removed once empty (its last residents, the containment pair, move to `path-containment.ts`).

### Source — importer updates (every removed export breaks importers at the type level → updated in the same commit as its move)

- `src/path-normalizer.ts` — re-point `normalizePathForComparison`, `canonicalNormalizePathForComparison` → `access-intent/path-normalization`; `isPathWithinDirectory`, `isPathOutsideWorkingDirectory` → `path-containment`; `isPiInfrastructureRead` → `pi-infrastructure-read`.
  Add the `isOutsideWorkingDirectory` prep refactor (canonicalize operands; cache `canonicalCwd`).
- `src/access-intent/access-path.ts` — re-point the three derivation imports → `access-intent/path-normalization`.
- `src/access-intent/bash/bash-path-resolver.ts` — `isSafeSystemPath` → `safe-system-paths`; `normalizePathPolicyLiteral` → `access-intent/path-normalization`.
- `src/rule.ts`, `src/permission-manager.ts`, `src/input-normalizer.ts` — `PATH_SURFACES` → `path-surfaces`.
- `src/pattern-suggest.ts` — `PATH_BEARING_TOOLS` → `path-surfaces`.
- `src/handlers/gates/tool.ts` — `getPathBearingToolPath` → `tool-input-path`; `PATH_BEARING_TOOLS` → `path-surfaces`.
- `src/handlers/gates/path.ts`, `src/handlers/gates/external-directory.ts` — `getToolInputPath` → `tool-input-path`.
- `src/handlers/gates/tool-call-gate-pipeline.ts` — `getPathBearingToolPath` → `tool-input-path`.

### Tests — split to mirror modules

- `test/path-utils.test.ts` (695 LOC) is dissolved; each `describe` block moves to a focused file carrying the same `node:os` / `node:fs` mocks where needed:
  - `test/path-normalization.test.ts` — `normalizePathForComparison`, `canonicalNormalizePathForComparison`, `normalizePathPolicyLiteral`, `getPathPolicyValues`.
  - `test/path-containment.test.ts` — `isPathWithinDirectory`; pure-geometry `isPathOutsideWorkingDirectory` (operands pre-canonicalized — no `realpathSync` needed).
  - `test/safe-system-paths.test.ts` — `SAFE_SYSTEM_PATHS`, `isSafeSystemPath`.
  - `test/tool-input-path.test.ts` — `getToolInputPath`, `getPathBearingToolPath`.
  - `test/path-surfaces.test.ts` — the three lookup sets.
- `test/pi-infrastructure-read.test.ts` — re-point import → `#src/pi-infrastructure-read`; absorb the overlapping `isPiInfrastructureRead` `describe` from `path-utils.test.ts` (de-duplicate).
- `test/permission-manager-unified.test.ts` — re-point `getPathPolicyValues` → `#src/access-intent/path-normalization`.
- `test/path-normalizer.test.ts` — gains the symlink/`./link/hosts`/safe-system integration cases that move off `path-utils.test.ts`'s `isPathOutsideWorkingDirectory` block (they exercise canonicalization, now owned by `PathNormalizer`).

### Docs — updated in the implementation doc commit

- `packages/pi-permission-system/docs/architecture/architecture.md`:
  - Module-tree: replace the `path-utils.ts` entry with the six new module entries; update the `access-path.ts` and `path-normalizer.ts` entries to name `access-intent/path-normalization.ts` + `path-containment.ts` (and note `isOutsideWorkingDirectory` now canonicalizes operands before the pure check).
  - Phase 7 Step 4 heading → ✅; update its Outcome line; flip the Mermaid `S4` node to ✅.
  - Findings metric row (`path-utils.ts` fan-in → distributed) and the prose at the grab-bag references (the "residual ad-hoc path handling" bullet, the findings paragraph) → past-tense / resolved.
  - "Related: PathNormalizer platform seam" section: update "`path-utils`/`AccessPath` primitives … Phase 7 [#505] can later move them behind it" (now done), "leaf `platform` parameters in `path-utils.ts` persist" → "in the relocated path modules persist", and the `isPiInfrastructureRead` / `isPathWithinDirectory` / `isPathOutsideWorkingDirectory` references → new module names.
- `.pi/skills/package-pi-permission-system/SKILL.md`:
  - `getToolInputPath` (`src/path-utils.ts`) → `src/tool-input-path.ts`.
  - "every path-utils / `canonicalize-path` / `rule.ts` / `subagent-context.ts` leaf takes an injected `platform`" → re-word "path-utils" to the relocated path modules.

`README.md` and `docs/configuration.md` name no internal symbols here (verified) — no update.

## Test Impact Analysis

1. **New tests the split enables.**
   The pure-geometry `isPathOutsideWorkingDirectory(canonicalPath, canonicalCwd, platform)` becomes testable with plain string operands — no `node:fs`/`realpathSync` mock and no symlink fixture, a faster and more direct unit.
   Each focused test file documents one module's surface instead of a 695-line catch-all.
2. **Tests that become redundant.**
   `path-utils.test.ts`'s `isPathOutsideWorkingDirectory` cases that exercised *canonicalization* (symlink resolution, `./link/hosts`, safe-system device files) are redundant at the pure-geometry layer — they move to `path-normalizer.test.ts`, which now owns canonicalization (some overlap already exists there).
   The `isPiInfrastructureRead` `describe` duplicated across `path-utils.test.ts` and `pi-infrastructure-read.test.ts` collapses into the latter.
3. **Tests that must stay as-is.**
   The representation tests (`normalizePathForComparison`, `canonicalNormalizePathForComparison`, `normalizePathPolicyLiteral`, `getPathPolicyValues`) genuinely exercise derivation and move verbatim to `path-normalization.test.ts`.
   The `isPathWithinDirectory` geometry tests move verbatim to `path-containment.test.ts`.
   The lookup-set and extraction tests move verbatim.

## Invariants at risk

This refactor touches surfaces that Phase 7 Steps 1–3 and the [#510]/[#511] seam already refactored:

- **[#502]/[#503] — per-tool & service/RPC paths match lexical ∪ canonical.**
  `AccessPath` outputs must not change.
  Pinned by `test/path-normalizer.test.ts` (`forPath().matchValues()` / `value()` / `boundaryValue()`) and the external-directory / gate integration tests.
  Keep green.
- **[#382] — win32 canonical lowercasing.**
  Pinned by `path-normalizer.test.ts` win32 cases and the (relocating) `canonicalNormalizePathForComparison` tests.
- **[#418] — symlink pattern matching.**
  Pinned by the external-directory integration tests (unchanged).
- **[#510]/[#511] — no interior `process.platform`; the `PathNormalizer` facade is the platform seam.**
  The ESLint `no-restricted-syntax` guard must stay green — every relocated leaf keeps its injected `platform`.
  `PathNormalizer.isOutsideWorkingDirectory(pathValue)`'s observable contract is unchanged; pinned by `path-normalizer.test.ts` (augmented with the moved integration cases).
  Run `pnpm run lint` after the prep refactor to confirm the guard.

## TDD Order

Step 1 is a genuine behavior-contract change (red→green).
Steps 2–7 are pure relocations: the safety net is the **existing** suite staying green after each move + importer update (`pnpm run check` + `pnpm -r run test`).
Each step leaves the build valid and is committed separately.

1. **Prep refactor — make `isPathOutsideWorkingDirectory` pure geometry ("tidy first").**
   Red: add `test/path-containment.test.ts` (or extend in place) asserting `isPathOutsideWorkingDirectory(canonicalPath, canonicalCwd, platform)` over **pre-canonicalized** operands (within/outside/equal/empty/safe-system).
   Green: change the signature to receive prepared operands (drop the inline `canonicalNormalizePathForComparison` calls); move canonicalization into `PathNormalizer.isOutsideWorkingDirectory` (cache `canonicalCwd` in the constructor); update the `isPathOutsideWorkingDirectory` cases in `path-utils.test.ts` to pass canonical operands and migrate the symlink/safe-system integration cases into `path-normalizer.test.ts`.
   Run `pnpm run check` + `pnpm run lint` (interface change + guard).
   Commit `refactor(pi-permission-system): make isPathOutsideWorkingDirectory pure geometry over prepared operands`.

2. **Extract `path-surfaces.ts`.**
   Move the three lookup sets; update `rule.ts`, `permission-manager.ts`, `input-normalizer.ts`, `pattern-suggest.ts`, `handlers/gates/tool.ts`, and the `path-utils.ts` internal `READ_ONLY` user; move the lookup-set `describe`s to `test/path-surfaces.test.ts`.
   Commit `refactor(pi-permission-system): extract path-surfaces module`.

3. **Extract `safe-system-paths.ts`.**
   Move `SAFE_SYSTEM_PATHS` + `isSafeSystemPath`; update `bash-path-resolver.ts`, the `path-utils.ts` `isPathOutsideWorkingDirectory` user, and `path-containment.ts` (once it exists, step 7 — until then `path-utils.ts`); move the `describe`s to `test/safe-system-paths.test.ts`.
   Commit `refactor(pi-permission-system): extract safe-system-paths module`.

4. **Extract `tool-input-path.ts`.**
   Move `getToolInputPath` + `getPathBearingToolPath`; update `handlers/gates/{path,external-directory,tool,tool-call-gate-pipeline}.ts`; move the `describe`s to `test/tool-input-path.test.ts`.
   Commit `refactor(pi-permission-system): extract tool-input-path module`.

5. **Extract `pi-infrastructure-read.ts`.**
   Move `isPiInfrastructureRead` + `containsGlobChars`; update `path-normalizer.ts`; re-point and de-duplicate `test/pi-infrastructure-read.test.ts` (absorb the `path-utils.test.ts` `isPiInfrastructureRead` block).
   Commit `refactor(pi-permission-system): extract pi-infrastructure-read module`.

6. **Extract `access-intent/path-normalization.ts` (representation).**
   Move `normalizePathForComparison`, `canonicalNormalizePathForComparison`, `normalizePathPolicyLiteral`, `getPathPolicyValues`, `PathPolicyValueOptions`, and the two private helpers; update `access-path.ts`, `bash-path-resolver.ts`, `path-normalizer.ts`, `permission-manager-unified.test.ts`; move the derivation `describe`s to `test/path-normalization.test.ts`.
   Run `pnpm run check`.
   Commit `refactor(pi-permission-system): relocate path representation into access-intent`.

7. **Rename the residue to `path-containment.ts` and delete `path-utils.ts`.**
   The only remaining residents are `isPathWithinDirectory` + `isPathOutsideWorkingDirectory` — rename the file to `src/path-containment.ts`; update its importers (`path-normalizer.ts`, `pi-infrastructure-read.ts`, `path-normalization.ts`); finish migrating `test/path-containment.test.ts`; delete `test/path-utils.test.ts`.
   Run `pnpm fallow dead-code`.
   Commit `refactor(pi-permission-system): rename path-utils residue to path-containment`.

8. **Docs — mark Step 4 complete and re-point module references.**
   Update `docs/architecture/architecture.md` (module tree, Step 4 ✅ + Outcome, Mermaid `S4` ✅, findings metric, PathNormalizer-seam prose) and `.pi/skills/package-pi-permission-system/SKILL.md` (module-name references).
   Commit `docs(pi-permission-system): record path-utils dissolution (Phase 7 Step 4)`.

## Risks and Mitigations

- **Silent default drift from a moved lookup set or interface.**
  `esbuild` does not reject unknown properties at runtime, so a mis-pointed import could fail only at runtime.
  Mitigation: run `pnpm run check` (a moved export becomes `TS2305` if mis-pointed) plus the full `pnpm -r run test` after each step.
- **The prep refactor (Step 1) changing observable behavior.**
  Mitigation: it is behavior-preserving by construction (canonicalization merely relocates from callee to single caller); the `path-normalizer.test.ts` integration cases pin the end-to-end `isOutsideWorkingDirectory(pathValue)` contract, and the new pure-geometry tests pin the extracted function.
- **An orphaned import after a test `describe` moves.**
  Biome's `noUnusedImports` is warning-level (exit 0).
  Mitigation: re-check each touched test file's imports as part of its step; the pre-completion reviewer is the backstop.
- **A missed `path-utils` reference in prose.**
  Mitigation: after Step 8, `grep -rn "path-utils" packages/pi-permission-system/{src,test,docs/architecture/architecture.md} .pi/skills/package-pi-permission-system/SKILL.md` returns only the frozen `history/` snapshot.
- **`fallow dead-code` flagging a newly-unreferenced export.**
  Mitigation: these are all moves (every export keeps its consumer); run `pnpm fallow dead-code` at Step 7.

## Open Questions

- None blocking.
  Step 5 ([#506], the `path-values` boundary decision) is already a separate roadmap issue and is unaffected by this relocation.

[#487]: https://github.com/gotgenes/pi-packages/issues/487
[#502]: https://github.com/gotgenes/pi-packages/issues/502
[#503]: https://github.com/gotgenes/pi-packages/issues/503
[#504]: https://github.com/gotgenes/pi-packages/issues/504
[#505]: https://github.com/gotgenes/pi-packages/issues/505
[#506]: https://github.com/gotgenes/pi-packages/issues/506
[#510]: https://github.com/gotgenes/pi-packages/issues/510
[#511]: https://github.com/gotgenes/pi-packages/issues/511
[#382]: https://github.com/gotgenes/pi-packages/issues/382
[#418]: https://github.com/gotgenes/pi-packages/issues/418
