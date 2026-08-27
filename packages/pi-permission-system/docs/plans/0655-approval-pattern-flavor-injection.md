---
issue: 655
issue_title: "deriveApprovalPattern reads node:path ambiently instead of the injected PathFlavor"
---

# `deriveApprovalPattern` takes the injected `PathFlavor`

## Release Recommendation

**Release:** ship independently

Phase 13 Step 8 carries `Release: independent` in `docs/architecture/architecture.md`, and it belongs to no release batch.
The roadmap's `Outcome:` line types the step `refactor:` (hidden, batches into the next release); that types the *ambient-read* half only.
This plan carries a measured win32 behavior fix as well (see Design Overview), so the migration commit ships as `fix:` by operator decision and the step's `Outcome:` / `Release batches` lines are corrected in the same doc commit.

## Problem Statement

`deriveApprovalPattern` (`src/session-rules.ts`) derives the session-approval glob by importing `dirname` and `sep` from `node:path`.
Every other path decision in the package flows through the injected `PathFlavor`, the one home of the win32-vs-POSIX comparison ([#562], [#510]).
The ESLint `no-restricted-syntax` guard scoped to `src/` bans `process.platform`, not a `node:path` import, so this one leaf slipped through.

Two consequences follow.

The first is testability: `sep` and `dirname` resolve against the host, so a `win32PathFlavor` unit test running on POSIX CI exercises POSIX separators and cannot see win32 behavior at all.

The second is a real win32 defect the issue reports as cosmetic.
On a Windows host the derivation mixes separators — `path.win32.dirname("/dev/null")` is `/dev` while `sep` is `\`, so the pattern is `/dev\*`.
For a device token the mixed value still matches, because [#653] made the `windowsSeparators` fold symmetric.
It does not survive a **directory-shaped** token: `foldSeparators` rewrites `/` to `\` on both operands, so the pattern derived from `/other/project/src/` is `/other/project\*`, which folds to `\other\project\*` and matches `\other\project\lib\bar.ts`.
A "yes, for this session" approval on one directory silently widens to its **parent**.

## Goals

- Derive the approval pattern through an injected `PathFlavor`, never an ambient `node:path` read.
- Make win32 derivation directly testable on a POSIX CI, the way `win32PathFlavor` already allows everywhere else.
- Fix the win32 directory-token widening, and the separator incoherence that hides it.
- Give the derivation a home that removes the Ask-then-compute shape the issue diagnoses: five production call sites all hold an `AccessPath` and hand its `.value()` to a free function that re-derives path semantics.

This change is **not** breaking.
POSIX output is byte-identical for every case exercised today (measured, see Design Overview), and the win32 correction narrows an over-broad session grant rather than widening one.

## Non-Goals

- Widening the approval scope beyond the immediate parent directory — that is [#604], which proposes a `sessionApprovalScope` config knob over this same derivation.
  This plan keeps the parent-directory rule exactly as it is; [#604] lands on top of a derivation that already takes the flavor.
- Changing the `windowsSeparators` fold, the wildcard matcher, or `PATH_SURFACES` — [#653] settled the fold and it is left untouched.
- Adding a `sessionLabel` to the `path` / `external_directory` gate descriptors.
  Those gates set none today, so the prompt shows `DEFAULT_SESSION_LABEL`; whether that is a gap is out of scope (see Open Questions).
- Touching `SessionRules` itself.
  The class stays in `src/session-rules.ts`; only the free function leaves.

## Background

Relevant modules, and how they relate.

| Module                                                                              | Role                                                                                                                                          |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/session-rules.ts`                                                              | `SessionRules` store, plus the free `deriveApprovalPattern(normalizedPath)` with the ambient `node:path` import                               |
| `src/path/path-flavor.ts`                                                           | `PathFlavor` — the platform's path *language*; `impl`, `matchOptions`, `fold`, `comparable`, `isWithin`, `hasPathSeparator`, `bashTokenShape` |
| `src/path-normalizer.ts`                                                            | `PathNormalizer` — flavor + session `cwd` baked in; builds every `AccessPath` in the package                                                  |
| `src/access-intent/access-path.ts`                                                  | `AccessPath` value object; `value()` is the lexical absolute form approval patterns derive from                                               |
| `src/handlers/gates/{path,external-directory,bash-path,bash-external-directory}.ts` | the four gates that record a path session approval                                                                                            |
| `src/pattern-suggest.ts`                                                            | `suggestSessionPattern(surface, value)` — the per-tool gate's pattern + dialog label                                                          |
| `src/wildcard-matcher.ts`                                                           | `foldSeparators` rewrites `/` → `\` in pattern **and** value under `windowsSeparators` ([#653])                                               |

Measured call-site inventory — every production caller already holds an `AccessPath`:

| Call site                                          | Argument today                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/handlers/gates/path.ts:49`                    | `accessPath.value()`                                                                   |
| `src/handlers/gates/external-directory.ts:81`      | `accessPath.value()`                                                                   |
| `src/handlers/gates/bash-path.ts:123`              | `worstEntry.path.value()`                                                              |
| `src/handlers/gates/bash-external-directory.ts:97` | `path.value()`, mapped over the uncovered entries                                      |
| `src/pattern-suggest.ts:144,147,152`               | reached only from `src/handlers/gates/tool.ts:70`, whose value is `accessPath.value()` |

Constraints from `AGENTS.md` and the package skill that apply:

- The `PathFlavor` invariant: every path leaf takes the flavor injected; `index.ts` performs the single `process.platform` read.
- Windows tool-input paths carry Node `fs` win32 semantics while bash tokens carry Git Bash/MSYS semantics — the two surfaces have different platforms on the same host ([#533]).
- On win32 both `/` and `\` are separators ([#520]); `PathFlavor.hasPathSeparator` already encodes that.
- Marking a completed roadmap step (`✅` on the heading and the Mermaid node, plus `Landed:` and stale metric rows) belongs in the implementation doc-update commit, not a deferred ship commit.

## Design Overview

### Why flavor injection alone is not enough

Substituting `flavor.impl.dirname` and `flavor.impl.sep` for the ambient imports leaves consequence 2 intact: `win32.dirname("/dev/null")` is still `/dev` and `win32.sep` is still `\`.
The separator has to come from the **value**, not from the platform's default.

The four current branches collapse into one rule: *the value up to and including its last path separator, with `*` appended; a value with no separator falls back to `.<sep>*`.*
The win32 flavor counts both `/` and `\` as separators, so a POSIX-shaped MSYS token derives a POSIX-shaped pattern and a native Windows path derives a backslash pattern — with no per-token flavor selection.

Measured (`node -e` over `path.win32` / `path.posix`, both algorithms, at planning time):

| Value                       | POSIX today            | POSIX with the rule    | win32 today            | win32 with the rule    |
| --------------------------- | ---------------------- | ---------------------- | ---------------------- | ---------------------- |
| `/other/project/src/foo.ts` | `/other/project/src/*` | `/other/project/src/*` | `/other/project/src\*` | `/other/project/src/*` |
| `/other/project/src/`       | `/other/project/src/*` | `/other/project/src/*` | `/other/project\*`     | `/other/project/src/*` |
| `/other/project/src`        | `/other/project/*`     | `/other/project/*`     | `/other/project\*`     | `/other/project/*`     |
| `/`                         | `/*`                   | `/*`                   | `/*`                   | `/*`                   |
| `/foo`                      | `/*`                   | `/*`                   | `/\*`                  | `/*`                   |
| `/dev/null`                 | `/dev/*`               | `/dev/*`               | `/dev\*`               | `/dev/*`               |
| `C:/foo/bar.ts`             | `C:/foo/*`             | `C:/foo/*`             | `C:/foo\*`             | `C:/foo/*`             |
| `C:\foo\bar.ts`             | `./*`                  | `./*`                  | `C:\foo\*`             | `C:\foo\*`             |
| `src/.env`                  | `src/*`                | `src/*`                | `src\*`                | `src/*`                |
| `index.html`                | `./*`                  | `./*`                  | `.\*`                  | `.\*`                  |

POSIX is byte-identical in every row, including every case the current suite pins.

### The win32 defect, and where it is reachable

The `/other/project/src/` row is not cosmetic.
Under `windowsSeparators`, pattern `/other/project\*` and value `/other/project/lib/bar.ts` both fold to backslashes, so the compiled regex `^\other\project\.*$` matches `\other\project\lib\bar.ts`.
The approval widens from the named directory to its parent.

A trailing-separator `AccessPath.value()` is reachable on win32 through the bash surface: `PathNormalizer.forBashToken` routes a non-mount POSIX absolute to `forLiteral(normalizePathPolicyLiteral(token))`, which preserves a trailing `/` ([#533]).
So a bash command naming a directory — `grep -r x /tmp/logs/` on a Git Bash host — produces `value()` of `/tmp/logs/` and a session approval covering all of `/tmp/*`.
The `/foo` row is the mirror-image failure: `/\*` folds to `\\*` and matches nothing, so the grant is silently inert and the user is re-prompted.

Both flow through `bash-path.ts` and `bash-external-directory.ts`.
The four tool-input gates are unaffected in practice, because `forPath` values on win32 are already win32-normalized — which is why the defect has stayed invisible.

### Home for the derivation

`PathNormalizer.approvalPatternFor(accessPath: AccessPath): string` (operator decision).

The normalizer is the package's path-interpretation collaborator, it already holds the flavor and the cwd, and it already builds every `AccessPath` in the package.
Asking it for `accessPath.value()` internally mirrors the existing `isInfrastructureRead(toolName, accessPath, infraDirs)`, which reads `accessPath.boundaryValue()` the same way — a value object the normalizer itself produced, accessed through its published accessor, so this is not a Law-of-Demeter reach-through into a stranger.

The algorithm lives one level below, in a new pure leaf `src/path/approval-pattern.ts`, alongside `path-containment.ts` / `canonicalize-path.ts` / `pi-infrastructure-read.ts` — the established shape for a flavor-parameterized path primitive.
That is what lets a win32 case be pinned directly on a POSIX CI without constructing a session.

```typescript
// src/path/approval-pattern.ts
export function deriveApprovalPattern(pathValue: string, flavor: PathFlavor): string {
  const lastSeparator = flavor.lastSeparatorIndex(pathValue);
  if (lastSeparator < 0) return `.${flavor.impl.sep}*`;
  return `${pathValue.slice(0, lastSeparator + 1)}*`;
}
```

`PathFlavor` gains one member so the separator alphabet keeps a single home:

```typescript
/**
 * Index of the last path separator in `value`, or `-1` when it holds none:
 * `/` on POSIX; `/` or `\` on win32 (#520).
 */
lastSeparatorIndex(value: string): number;
```

`PlatformPathFlavor` implements both `lastSeparatorIndex` and `hasPathSeparator` over one separator list, so `hasPathSeparator(token)` becomes `this.lastSeparatorIndex(token) >= 0` and the two answers cannot drift.

### Consumer call sites

The two tool gates already hold a normalizer and need no signature change:

```typescript
// src/handlers/gates/path.ts
const accessPath = normalizer.forPath(filePath);
const pattern = normalizer.approvalPatternFor(accessPath);
```

The two bash gates hold none — `BashProgram` does not retain the normalizer it was parsed with — so each gains a trailing `normalizer: PathNormalizer` parameter.
They genuinely *use* it rather than relay it: the entry selection (`pickMostRestrictive`, `selectUncoveredExternalPaths`) happens inside the gate, so the pipeline cannot pre-derive the pattern.

```typescript
// src/handlers/gates/bash-external-directory.ts
const patterns = uncoveredEntries.map(({ path }) => normalizer.approvalPatternFor(path));
```

`uncoveredPaths` (the string list) stays as-is for `logContext.externalPaths` — the two parallel lists [#507] established are preserved.

The per-tool gate is different: it needs the *product*, not the collaborator.
`ToolCallGatePipeline.resolvePerToolCheck` already owns both the normalizer and the `AccessPath`, so it derives the pattern once and hands `describeToolGate` a pair, replacing today's lone `accessPath?` parameter:

```typescript
/** A path-bearing tool call's resolved path and the session scope approving it grants. */
export interface ToolPathAccess {
  readonly path: AccessPath;
  readonly approvalPattern: string;
}

// src/handlers/gates/tool.ts
const suggestion = pathAccess
  ? suggestPathSessionPattern(gateSurface, pathAccess.approvalPattern)
  : suggestSessionPattern(gateSurface, deriveSuggestionValue(gateSurface, check));
```

This keeps `pattern-suggest.ts` free of any path-domain import, and keeps the derivation with the object that owns the flavor.
It is also the cheaper edit: only 2 of the 17 `describeToolGate(` call sites in `test/handlers/gates/tool.test.ts` pass a 4th argument, whereas a required `normalizer` parameter would touch all 17.

### `pattern-suggest.ts`

`suggestSessionPattern` is called from exactly one production site (`tool.ts:70`), with `gateSurface` — which is `"bash"` or a tool name, never `"path"` or `"external_directory"`.
Its three `deriveApprovalPattern` arms are therefore unreachable in production, and once `tool.ts` routes path-bearing calls to the new entry point the path-bearing `default` arm is unreachable too (its `value` is then always the `"*"` sentinel).
They are removed (operator decision), and the module splits into a text entry point and a path entry point:

```typescript
export function suggestSessionPattern(surface: string, value: string): SessionApprovalSuggestion {
  let pattern: string;
  switch (surface) {
    case "bash": pattern = suggestBashPattern(value); break;
    case "mcp": pattern = suggestMcpPattern(value); break;
    case "skill": pattern = value; break;
    default: pattern = "*"; break;
  }
  return { surface, pattern, label: buildLabel(pattern, surface) };
}

/**
 * Build the suggestion for a path surface from a pattern the caller already
 * derived through its `PathNormalizer` (#655) — the derivation is the
 * normalizer's, so this module holds no path-language semantics.
 */
export function suggestPathSessionPattern(
  surface: string,
  approvalPattern: string,
): SessionApprovalSuggestion {
  return { surface, pattern: approvalPattern, label: buildLabel(approvalPattern, surface) };
}
```

`buildLabel` is left intact — its path-bearing arm is still live through `suggestPathSessionPattern`, and its `path` / `external_directory` arms were already unreachable before this change rather than made so by it.

### Edge cases

- Empty `value()` (an empty `AccessPath`): no separator → `./*` on POSIX, `.\*` on win32 — unchanged from today.
- A literal `*` path input: `forPath("*")` resolves to `<cwd>/*`, so the derived pattern is `<cwd>/*` — unchanged.
- Root (`/`, `C:\`): the last separator is the final character, so the value itself plus `*` — unchanged.
- A device `AccessPath` (`forDevice("/dev/null")` on win32): `/dev/*`, coherent with the token as typed and as matched.

## Module-Level Changes

Source:

- `src/path/path-flavor.ts` — add `lastSeparatorIndex(value: string): number` to the `PathFlavor` interface and `PlatformPathFlavor`; re-express `hasPathSeparator` over the same separator list; extend the interface doc comment's syntax clause.
- `src/path/approval-pattern.ts` (**new**) — `deriveApprovalPattern(pathValue, flavor)`, the single last-separator rule.
- `src/path-normalizer.ts` — add `approvalPatternFor(accessPath: AccessPath): string`, delegating to the leaf with the baked flavor.
- `src/session-rules.ts` — remove the `node:path` import and the `deriveApprovalPattern` export; `SessionRules` and its doc comments are untouched.
- `src/handlers/gates/path.ts` — `normalizer.approvalPatternFor(accessPath)`; drop the `#src/session-rules` import.
- `src/handlers/gates/external-directory.ts` — same.
- `src/handlers/gates/bash-path.ts` — add a trailing `normalizer: PathNormalizer` parameter; `normalizer.approvalPatternFor(worstEntry.path)`.
- `src/handlers/gates/bash-external-directory.ts` — add the same parameter; map the patterns off `uncoveredEntries` rather than `uncoveredPaths`.
- `src/handlers/gates/tool.ts` — replace the `accessPath?: AccessPath` parameter with `pathAccess?: ToolPathAccess`; drop `accessPath` from `deriveSuggestionValue` (its `default` arm becomes `"*"`); route to `suggestPathSessionPattern` when `pathAccess` is present; `accessFactsFromPath` reads `pathAccess.path`.
- `src/handlers/gates/tool-call-gate-pipeline.ts` — declare `ToolPathAccess`; pass `normalizer` to both bash gate producers; `resolvePerToolCheck` returns `{ toolCheck, pathAccess? }` and derives the pattern once.
- `src/pattern-suggest.ts` — drop the `#src/session-rules` import and the three path-deriving arms; add `suggestPathSessionPattern`.

Tests:

- `test/path/path-flavor.test.ts` — `lastSeparatorIndex` per flavor, including win32 `a\b` → `1` and POSIX `a\b` → `-1`.
- `test/path/approval-pattern.test.ts` (**new**) — the measured table above, both flavors.
- `test/path-normalizer.test.ts` — `approvalPatternFor` over a POSIX normalizer (`forPath`) and a win32 normalizer (`forBashToken("/dev/null")`, `forBashToken("/tmp/logs/")`).
- `test/session-rules.test.ts` — remove the `deriveApprovalPattern` describe block; the two round-trip tests that record a derived pattern and `evaluate()` it move to `test/path/approval-pattern.test.ts` (they pin the pattern/value contract, not the store).
- `test/pattern-suggest.test.ts` — retarget the `external_directory` / `path` / path-bearing-derivation cases to `suggestPathSessionPattern`; keep the `"*"` fallback and non-path-bearing cases on `suggestSessionPattern`.
- `test/handlers/gates/bash-path.test.ts`, `test/handlers/gates/bash-external-directory.test.ts` — pass the normalizer their local helpers already construct for `BashProgram.parse`.
- `test/handlers/gates/tool.test.ts` — 2 of 17 `describeToolGate(` sites move from `accessPath` to `pathAccess`.
- `test/handlers/gates/tool-call-gate-pipeline.test.ts` — assertions on the per-tool gate's session approval, if any read `accessPath`.

Docs:

- `packages/pi-permission-system/docs/architecture/architecture.md`:
  - module tree — `session-rules.ts` entry (drop nothing; it never named the free function), `pattern-suggest.ts` entry (name both entry points), `path-normalizer.ts` entry (add `approvalPatternFor` to its method list), `path/` subtree (add the `approval-pattern.ts` line), `path-flavor.ts` entry (add `lastSeparatorIndex` to its member list).
  - Step 8 — `✅` on the heading and on the `S8` Mermaid node; `Landed:` note; `Outcome:` line's `refactor:` corrected to `fix:`.
  - Health metrics — the `Ambient node:path import in session-rules.ts` row marked `0 ✅`.
  - `Release batches` — the `Step 8 (refactor: — hidden type, batches into the next release)` clause corrected to `fix:`.
- `.pi/skills/package-pi-permission-system/SKILL.md` — add `path/approval-pattern` to the injected-`PathFlavor` path-leaf list, and `approvalPatternFor` to the "hand the normalizer raw tokens" method list.

Grep sweep performed at planning time: `deriveApprovalPattern` appears in `src/`, `test/`, `docs/plans/`, `docs/retro/`, and `docs/architecture/architecture.md` only — not in `README.md`, `docs/configuration.md`, `docs/decisions/`, or any other shipped user doc.
`docs/plans/` and `docs/retro/` are historical records and are not edited.

## Test Impact Analysis

**New tests the change enables.**
`test/path/approval-pattern.test.ts` can pin win32 derivation on a POSIX CI for the first time — the issue's stated goal (b).
The four rows that differ on win32 (`/dev/null`, `/other/project/src/`, `/foo`, `C:/foo/bar.ts`) are untestable today because `sep` resolves against the host.
`test/path/path-flavor.test.ts` gains direct coverage of the separator alphabet, which previously existed only implicitly inside `hasPathSeparator`.

**Tests that become redundant.**
The six `deriveApprovalPattern` cases in `test/session-rules.test.ts` become the POSIX column of the new leaf's table; they move rather than duplicate.
The `external_directory` / `path` / path-bearing derivation cases in `test/pattern-suggest.test.ts` were testing `deriveApprovalPattern` through a wrapper — after the split they assert only that a caller-supplied pattern is passed through and labelled, so they shrink to label assertions.

**Tests that must stay.**
The two round-trip tests (record the derived pattern on `SessionRules`, then `evaluate()` a sibling path to `ask` and a child path to `allow`) genuinely exercise the pattern/matcher contract and must survive the move intact — they are the only place the derivation is checked against the engine that consumes it.
The gate-level session-approval assertions in `path.test.ts`, `external-directory.test.ts`, `bash-path.test.ts`, and `bash-external-directory.test.ts` stay as-is; they pin that each gate records the right surface and pattern, independent of where the derivation lives.

## Invariants at risk

| Invariant                                                                                                                           | Source                                                              | Pinned by                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| The `windowsSeparators` fold is symmetric — pattern and value both folded, never one alone                                          | [#653] step outcome                                                 | `test/wildcard-matcher.test.ts`; untouched by this plan                                                                                |
| A win32 non-mount POSIX absolute stays a literal-only `AccessPath`, matched and displayed as typed                                  | [#533] / ADR `docs/decisions/0003-git-bash-posix-path-semantics.md` | `test/path-normalizer.test.ts` `forBashToken` cases; this plan adds an `approvalPatternFor` case over the same input                   |
| `bash-external-directory.ts` keeps two parallel lists — `uncoveredPaths` for `logContext.externalPaths`, disclosures for the prompt | [#507] step outcome                                                 | `test/handlers/gates/bash-external-directory.test.ts` log assertions; the plan changes only where `patterns` is mapped from            |
| A current-directory file resolved to its canonical absolute form yields the cwd glob, not `./*`                                     | [#438]                                                              | `test/session-rules.test.ts` "binds a current-directory file to the cwd subtree once resolved" — moves to the new leaf test, unchanged |
| Every path leaf takes an injected `PathFlavor`; no `src/` module reads `process.platform`                                           | [#562] / [#510]                                                     | the ESLint `no-restricted-syntax` guard; this change closes the last `node:path` gap it does not cover                                 |

Quantitative baseline, measured at planning time:

- `grep -c "node:path" packages/pi-permission-system/src/session-rules.ts` → `1`.
  Predicted after: `0`.
- POSIX derivation output: byte-identical across all 10 measured values (table above).
  Predicted after: unchanged.

## TDD Order

1. **`PathFlavor.lastSeparatorIndex`.**
   Red: `test/path/path-flavor.test.ts` — POSIX `/a/b` → `2`, `a` → `-1`, `a\b` → `-1`; win32 `C:\a\b` → `4`, `/a/b` → `2`, `a\b` → `1`, `a` → `-1`; plus a case pinning that `hasPathSeparator` agrees with it on each.
   Green: add the member to the interface and `PlatformPathFlavor`; re-express `hasPathSeparator`.
   Commit: `refactor(pi-permission-system): give PathFlavor the separator alphabet (#655)`.
2. **The pure derivation leaf.**
   Red: `test/path/approval-pattern.test.ts` — the full measured table for both flavors, including the four win32 rows that differ.
   Green: add `src/path/approval-pattern.ts`.
   Commit: `refactor(pi-permission-system): add flavor-injected approval-pattern derivation (#655)`.
3. **`PathNormalizer.approvalPatternFor`.**
   Red: `test/path-normalizer.test.ts` — a POSIX normalizer over `forPath("/other/project/src/foo.ts")`; a win32 normalizer over `forBashToken("/dev/null")` → `/dev/*` and `forBashToken("/tmp/logs/")` → `/tmp/logs/*`.
   Green: add the delegating method.
   Commit: `refactor(pi-permission-system): add PathNormalizer.approvalPatternFor (#655)`.
4. **The four path gates migrate.**
   Red: gate-level assertions for the corrected win32 patterns — `describeBashPathGate` and `describeBashExternalDirectoryGate` under a win32 normalizer with a `/tmp/logs/` token, asserting the session approval is `/tmp/logs/*` rather than the parent glob; existing POSIX assertions unchanged.
   Green: `path.ts` and `external-directory.ts` call `normalizer.approvalPatternFor`; the two bash gates gain the parameter and the pipeline passes it.
   The old export still exists, so nothing else breaks in this commit.
   Commit: `fix(pi-permission-system): derive session-approval patterns through the injected PathFlavor (#655)`.
5. **The per-tool gate and `pattern-suggest.ts`.**
   Red: `test/pattern-suggest.test.ts` retargeted to `suggestPathSessionPattern`; `test/handlers/gates/tool.test.ts` asserting the same suggestion for a path-bearing tool via `pathAccess`.
   Green: add `suggestPathSessionPattern`, remove the three path-deriving arms, introduce `ToolPathAccess` and thread it from `resolvePerToolCheck`.
   The export removal and every consumer update land together, per the "removing an export breaks importers at the type level" rule.
   Commit: `refactor(pi-permission-system): route per-tool path suggestions through the normalizer (#655)`.
6. **Retire the ambient read.**
   Red/Green: delete `deriveApprovalPattern` and the `node:path` import from `src/session-rules.ts`; move the two round-trip tests out of `test/session-rules.test.ts` into the leaf test.
   Verify: `grep -c "node:path" packages/pi-permission-system/src/session-rules.ts` → `0`; `pnpm fallow dead-code` reports no new dead export.
   Commit: `refactor(pi-permission-system): drop the ambient node:path read from session-rules (#655)`.
7. **Docs.**
   Architecture module tree, Step 8 `✅` + Mermaid node + `Landed:` note + `Outcome:`/`Release batches` type correction, health-metric row, and the two SKILL.md lists.
   Commit: `docs(pi-permission-system): mark Phase 13 Step 8 complete (#655)`.

Steps 1–3 are pure additions (lift), steps 4–5 migrate consumers (shift), step 6 removes the old thing — no step rewrites a large test file at once.

## Risks and Mitigations

| Risk                                                                                         | Mitigation                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The single last-separator rule silently changes a POSIX pattern                              | Measured byte-identical across all 10 values, including every case the current suite pins; step 2's table is the regression guard, and steps 4–5 keep every existing gate assertion green |
| Re-expressing `hasPathSeparator` over `lastSeparatorIndex` changes bash token classification | Semantically identical (`>= 0` iff a separator exists); step 1 adds an agreement test, and `access-intent/bash/token-classification.ts`'s existing suite covers the consumer              |
| The win32 correction changes a pattern a Windows user's session already relies on            | The change narrows an over-broad grant and repairs an inert one; both directions are toward the pattern the user was shown. No POSIX user observes anything                               |
| `describeToolGate`'s signature change silently drops the `accessPath` at a call site         | `pathAccess` replaces `accessPath` at the same position, so a site passing the old shape is a type error, not a silent `undefined`                                                        |
| Removing `pattern-suggest.ts`'s path arms breaks an unnoticed caller                         | Grep confirms one production caller (`tool.ts:70`) and one test file; the export removal in step 5 makes any missed importer a compile error                                              |
| Step 4 ships as `fix:` and cuts a release mid-phase                                          | Step 8 is `Release: independent` with no batch membership, so an independent release is exactly the roadmap's intent                                                                      |

## Open Questions

- `buildLabel`'s `"path"` and `"external_directory"` arms are unreachable — nothing passes those surfaces, because the two gates that own them set no `sessionLabel` and fall back to `DEFAULT_SESSION_LABEL`.
  That predates this change and is left in place: whether those gates *should* label their session option is a prompt-presentation question, and [#604] would rework the same labels when it adds a scope knob.
  Not worth its own issue today; folding it into [#604]'s plan is the cheaper path.
- Whether `deriveApprovalPattern` should eventually move behind `AccessPath` (Tell-Don't-Ask, the issue's option b) rather than `PathNormalizer`.
  Deferred by operator decision; the normalizer home leaves that migration open, since all `AccessPath` construction already flows through the normalizer.

[#438]: https://github.com/gotgenes/pi-packages/issues/438
[#507]: https://github.com/gotgenes/pi-packages/issues/507
[#510]: https://github.com/gotgenes/pi-packages/issues/510
[#520]: https://github.com/gotgenes/pi-packages/issues/520
[#533]: https://github.com/gotgenes/pi-packages/issues/533
[#562]: https://github.com/gotgenes/pi-packages/issues/562
[#604]: https://github.com/gotgenes/pi-packages/issues/604
[#653]: https://github.com/gotgenes/pi-packages/issues/653
