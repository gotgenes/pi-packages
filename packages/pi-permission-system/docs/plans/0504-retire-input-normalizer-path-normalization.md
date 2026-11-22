---
issue: 504
issue_title: "pi-permission-system: retire input-normalizer path normalization (Phase 7 Step 3)"
---

# Retire input-normalizer path normalization (Phase 7 Step 3)

## Release Recommendation

**Release:** ship now — batch "symlink-resistant-path-matching" tail (this issue completes the batch)

This is the tail of the three-step batch "symlink-resistant-path-matching" (Phase 7 Steps 1–3 of [#487]).
Steps 1 ([#502]) and 2 ([#503]) already landed their breaking `feat!:` parity changes on `main`, where they have been auto-batching, un-released, waiting for the tail.
This tail commit is itself a `refactor:` (dead-code removal, no observable behavior change) and a hidden changelog type that would not cut a release on its own — but its landing is the cue to ship the major-bump release that the two pending `feat!:` commits have been batching.
So at ship time, merge the release-please PR (the breaking parity changes drive the major bump); do not defer.

## Problem Statement

After Steps 1 and 2, the per-tool path-bearing gate and the service/RPC policy queries emit `access-path` intents that the resolver unwraps to `path-values`, so `input-normalizer.ts`'s lexical-only path derivation is dead.
Specifically, `normalizePathSurfaceValues`, the special-surface (`path` / `external_directory`) branch, and the `PATH_BEARING_TOOLS` branch of `normalizeInput` no longer receive any production caller for a real path value, and the `platform`/`cwd` parameters they consumed are dead.
Removing this dead path eliminates the duplicate, symlink-blind normalization the [#487] vision targets and leaves a single `AccessPath`-based path-derivation entry.

## Goals

- Remove `normalizePathSurfaceValues`, the special-surface branch, and the `PATH_BEARING_TOOLS` branch from `normalizeInput` in `src/input-normalizer.ts`.
- Drop the now-unused `platform` and `cwd` parameters from `normalizeInput`; `normalizeInput` then handles only bash / skill / mcp / extension surfaces.
- In `src/permission-manager.ts`, stop passing `this.platform` / `this.currentCwd` to `normalizeInput` (the `tool` branch no longer normalizes paths), and remove the now-dead `currentCwd` field and its `configureForCwd` assignment.
- Migrate the manager-level path-surface integration tests off the dead `tool`-intent path branches and onto the production `path-values` intent.
- Update the architecture doc and package skill to reflect the removed mechanism, and mark Phase 7 Step 3 complete.

This change is **non-breaking**: production path surfaces already route through `access-path` → `path-values`, so no observable decision, output shape, or default changes on upgrade.

## Non-Goals

- Dissolving the `path-utils.ts` grab-bag (relocating `getPathPolicyValues` and friends behind `AccessPath`) — that is Phase 7 Step 4 ([#505]).
- Deciding/formalizing the `path-values` boundary — Phase 7 Step 5 ([#506]).
- Any change to `buildAccessIntentForSurface` (the service/RPC path-query builder added in Step 2) — it stays, still consuming `PATH_SURFACES` and `normalizer.forPath`.
- Any change to the manager's own `SPECIAL_PERMISSION_KEYS` constant (`permission-manager.ts:41`) — it backs `getToolPermission` and `deriveSource` and is unrelated to the `input-normalizer.ts` copy being removed.

## Background

Relevant modules and their current state after Steps 1 and 2:

- `src/input-normalizer.ts` — `normalizeInput(toolName, input, configuredMcpServerNames, platform, cwd)` maps a raw tool invocation to a `{ surface, values, resultExtras }` triple.
  The `tool`-intent branch of `PermissionManager.check` calls it.
  Its special-surface and `PATH_BEARING_TOOLS` branches both call the private `normalizePathSurfaceValues` → `getPathPolicyValues` (lexical only); `platform`/`cwd` exist only to feed that derivation.
  `buildAccessIntentForSurface` (the inverse, for service/RPC queries) also lives here and is unaffected.
- `src/permission-manager.ts` — `check(intent)` dispatches on `intent.kind`: `path-values` evaluates precomputed values directly; `tool` calls `normalizeInput(..., this.platform, this.currentCwd)`.
  `currentCwd` is set only by `configureForCwd` and read only by that `normalizeInput` call (verified by grep) — removing the call makes the field dead.
- `src/handlers/gates/tool-call-gate-pipeline.ts` — `resolvePerToolCheck` emits `access-path` for a path-bearing tool with a present `input.path` (via `getPathBearingToolPath`), and a `tool` intent only when the path is absent (missing-path case).
- `src/handlers/gates/path.ts` / `external-directory-policy.ts` — emit `access-path` and carry a `preCheck`, so the `path` / `external_directory` surfaces never re-emit a `tool` intent through the runner.
- `src/permission-resolver.ts` — `toResolvedIntent` unwraps `access-path` → `path-values` via `AccessPath.matchValues()` (the sole unwrap site).

Constraints from AGENTS.md / package skill that apply:

- No `src/` module may read `process.platform`; leaf functions take an injected `platform`.
  Dropping `platform` from `normalizeInput` removes a relay, not a guard exemption.
- Keep schema/example/loader/docs aligned — this change touches no config field, so only the architecture doc and skill need updating.
- `pnpm fallow dead-code` is a CI gate; the `currentCwd` field, `normalizePathSurfaceValues`, the `SPECIAL_PERMISSION_KEYS` const, and the removed imports must all go, or fallow flags them.

## Design Overview

### Decision model: why the branches are dead

After Steps 1 and 2, every production path that once reached `normalizeInput`'s path branches with a real value now routes elsewhere:

| Surface                                                    | Production path after Steps 1–2                                          | Reaches `normalizeInput` path branch? |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------- |
| `path`                                                     | gate emits `access-path` (preCheck) → resolver → `path-values`           | no                                    |
| `external_directory`                                       | gate emits `access-path` (preCheck) → resolver → `path-values`           | no                                    |
| `read`/`write`/`edit`/`grep`/`find`/`ls` with `input.path` | pipeline emits `access-path` → resolver → `path-values`                  | no                                    |
| path-bearing tool with **no** `input.path`                 | pipeline emits `tool` → `normalizeInput` → `["*"]`                       | yes (collapses to `["*"]`)            |
| service/RPC path query                                     | `buildAccessIntentForSurface` → `access-path` → resolver → `path-values` | no                                    |

The only surviving caller is the missing-path case, which produces `["*"]`.
After removal, that input falls through to the generic extension-tool branch (`surface: toolName, values: ["*"]`) — an **identical** result.
So the special-surface branch and the `PATH_BEARING_TOOLS` branch can be deleted with no behavior change.

### Result equivalence for the missing-path / empty-input case

`normalizeInput("read", {})` today (path-bearing branch): `normalizePathSurfaceValues({})` → path is `null` → `["*"]`, `surface: "read"`, `resultExtras: {}`.
After removal (generic branch): `surface: "read"`, `values: ["*"]`, `resultExtras: {}`.
`buildCheckResult` is unchanged — `read` ∈ `PATH_SURFACES`, so both feed `evaluateAnyValue(surface, ["*"], …)`, and `deriveSource("read")` → `"tool"` either way.
The same holds for `external_directory` with empty input (`["*"]`, source `"special"`).

### `normalizeInput` after the change

```typescript
export function normalizeInput(
  toolName: string,
  input: unknown,
  configuredMcpServerNames: readonly string[],
): NormalizedInput {
  if (toolName === "skill") {
    /* unchanged */
  }
  if (toolName === "bash") {
    /* unchanged */
  }
  if (toolName === "mcp") {
    /* unchanged */
  }
  // Extension tools (and path-bearing tools, now uniformly) → surface catch-all.
  return { surface: toolName, values: ["*"], resultExtras: {} };
}
```

Removed: the `SPECIAL_PERMISSION_KEYS` const, the special-surface branch, the `PATH_BEARING_TOOLS` branch, the private `normalizePathSurfaceValues`, the `platform`/`cwd` parameters, and the `getPathPolicyValues` / `PATH_BEARING_TOOLS` imports.
Retained: `PATH_SURFACES`, `getNonEmptyString`, `toRecord`, `stripBashCommentLines`, `createMcpPermissionTargets` (all still used — `PATH_SURFACES` and `getNonEmptyString` by `buildAccessIntentForSurface`).

### `permission-manager.ts` call site

The `tool` branch drops the two trailing arguments:

```typescript
// kind === "tool"
const toolName = intent.surface.trim();
const { surface, values, resultExtras } = normalizeInput(
  toolName,
  intent.input,
  this.loader.getConfiguredMcpServerNames(),
);
```

`currentCwd` (field declaration + the `this.currentCwd = …` line in `configureForCwd`) is removed; `configureForCwd` keeps its loader-rebuild logic, which already reads its `cwd` parameter directly, not the field.

### Test migration (the bulk of the work)

`test/permission-manager-unified.test.ts` exercises path-surface pattern matching via the `checkTool` adapter, which builds a `tool` intent.
~30 calls pass a real `{ path: … }` and rely on `normalizeInput`'s path derivation; the ~39 empty-input `checkTool(manager, <surface>, {})` calls produce `["*"]` and are unaffected.

The ~30 real-path calls migrate to the production intent kind via a new local helper that computes the same lexical alias set `normalizeInput` produced today:

```typescript
function checkPath(
  manager: PermissionManager,
  path: string,
  opts: { cwd?: string } = {},
  surface = "path",
  agentName?: string,
  sessionRules?: Ruleset,
): PermissionCheckResult {
  return checkPathValues(
    manager,
    getPathPolicyValues(path, opts.cwd ? { cwd: opts.cwd } : {}, "linux"),
    agentName,
    sessionRules,
    surface,
  );
}
```

This is faithful: the old `tool` branch computed `getPathPolicyValues(path, cwd ? { cwd } : {}, this.platform)` (platform defaults to `"linux"` in these tests), and the `path-values` branch evaluates the same values through the same `evaluateAnyValue` with identical `toolName`/`source`/`origin` results.
So the migration is **green against current production** — a tidy-first preparatory step that decouples the manager integration tests from the doomed branches before they are removed.
`getPathPolicyValues` is imported from `#src/path-utils` (it stays — `AccessPath` consumes it).

## Module-Level Changes

- `src/input-normalizer.ts` — remove `normalizePathSurfaceValues`, the `SPECIAL_PERMISSION_KEYS` const, the special-surface branch, and the `PATH_BEARING_TOOLS` branch from `normalizeInput`; drop the `platform`/`cwd` parameters; remove the `getPathPolicyValues` and `PATH_BEARING_TOOLS` imports.
  Update the `normalizeInput` JSDoc (it documents the path/special handling).
- `src/permission-manager.ts` — drop `this.platform, this.currentCwd` from the `normalizeInput` call in `check`; remove the `currentCwd` field declaration and its assignment in `configureForCwd`.
  Update the `check` JSDoc bullet `"tool" → normalizes raw input through normalizeInput` if it implies path handling.
- `test/permission-manager-unified.test.ts` — add the `checkPath` helper; migrate the ~30 real-path `checkTool(manager, <path-surface>, { path })` calls to it (preserving every assertion); import `getPathPolicyValues` from `#src/path-utils`.
  The ~39 empty-input `checkTool` calls stay as-is.
- `test/input-normalizer.test.ts` — remove the `special / path`, `special / external_directory`, and `path-bearing tools` describe blocks; add a small block asserting the post-removal contract (`normalizeInput("read"/"path"/"external_directory", { path: P })` → `{ surface, values: ["*"] }`); drop the trailing `"linux"` argument from every remaining `normalizeInput(...)` call (bash / skill / mcp / extension).
  The `buildAccessIntentForSurface` describe block is unaffected.
- `docs/architecture/architecture.md` — rewrite the `### Path-bearing tool normalization` section (lines ~292–303): per-tool path patterns now match via the `access-path` intent the per-tool gate emits ([#502]); the missing-path case falls through to the generic `["*"]` branch; home-expansion/alias derivation is attributed to `getPathPolicyValues`/`AccessPath`, not `normalizeInput`.
  Mark Phase 7 Step 3 complete: `✅` on the Step 3 heading (line ~810) and the `S3` Mermaid node (line ~837).
  Update the migration tracker (line ~886) noting the `normalizePathSurfaceValues` retirement is now done.
  Adjust the high-level `normalizeInput()` pseudocode reference (line ~397) only if it now misleads; leave the conceptual `evaluate()` flow otherwise.
- `.pi/skills/package-pi-permission-system/SKILL.md` — reword the deferred-follow-up note (line ~130) that describes "threading the extractor through `normalizeInput`": `normalizeInput` no longer derives paths, so describe the follow-up without naming it as the mechanism.

Note: `docs/plans/**` and `docs/retro/**` are historical snapshots and are not retroactively edited; the archive plans referencing `normalizeInput` are out of scope.

## Test Impact Analysis

1. **New coverage enabled.**
   None required — this removes code rather than adding a collaborator.
   The post-removal `normalizeInput` contract (path-bearing/special tool names collapse to `["*"]`) gains a focused unit assertion.
2. **Tests that become redundant / simplified.**
   The `input-normalizer.test.ts` `special / path`, `special / external_directory`, and `path-bearing tools` describe blocks test branches that no longer exist — removed.
   Their pattern-matching intent is preserved at the integration layer by the migrated `permission-manager-unified.test.ts` `checkPath` tests (which now exercise the production `path-values` intent) and by the existing gate/resolver tests (`path.test.ts`, `tool-call-gate-pipeline.test.ts`) that drive the `access-path` flow end to end.
3. **Tests that must stay as-is.**
   The `buildAccessIntentForSurface` block in `input-normalizer.test.ts` (the surviving path-query builder), the bash/skill/mcp/extension `normalizeInput` blocks (modulo the dropped `"linux"` arg), the `check — path-values intent` and `check — tool intent (bash/read)` blocks in `permission-manager-unified.test.ts`, and `permission-resolver.test.ts` (the unwrap site).

## Invariants at risk

This change touches surfaces refactored by [#393], [#486], [#502], and [#503]; their documented outcomes must stay green:

- **[#393] / [#486] per-tool and `path` pattern matching** (e.g. `*.env` denies `.env` but not `.env.example`) — pinned by the migrated `checkPath` tests in `permission-manager-unified.test.ts` (kept, just rerouted through `path-values`).
- **[#502] per-tool gate emits `access-path`; missing-path falls back to `["*"]`** — pinned by `tool-call-gate-pipeline.test.ts` and the new `normalizeInput("read", {}) → ["*"]` assertion.
- **[#503] service/RPC path queries match lexical ∪ canonical** — pinned by `service.test.ts` / `permission-event-rpc.test.ts`; untouched here (`buildAccessIntentForSurface` is unchanged).
- **[#438] cwd-bounding** and **external-directory** semantics — pinned by the existing gate tests; the `tool`-branch removal does not touch them.

No invariant lives only in prose; each has a pinning test.

## TDD Order

1. **`test:` migrate manager path-surface tests to the `path-values` intent.**
   Add the `checkPath` helper and the `getPathPolicyValues` import to `test/permission-manager-unified.test.ts`; migrate the ~30 real-path `checkTool(manager, <path-surface>, { path })` calls to `checkPath`, preserving every assertion.
   Green against current production (preparatory tidy-first — no production change).
   Run the full package suite to confirm green.
   Commit: `test(pi-permission-system): route manager path-surface checks through path-values intent`.
2. **`test:` red — assert the post-removal `normalizeInput` contract.**
   In `test/input-normalizer.test.ts`, replace the three path-related describe blocks with assertions that `normalizeInput("read"/"path"/"external_directory", { path: ".env" }, [], "linux")` yields `{ surface, values: ["*"] }` (keep the current 5-arg signature so the file still compiles); these fail against current code.
   Commit: `test(pi-permission-system): expect normalizeInput to drop path special-casing`.
3. **`refactor:` green — remove the dead path normalization.**
   In `src/input-normalizer.ts`: delete `normalizePathSurfaceValues`, the `SPECIAL_PERMISSION_KEYS` const, the special-surface branch, the `PATH_BEARING_TOOLS` branch, and the `getPathPolicyValues`/`PATH_BEARING_TOOLS` imports; drop the `platform`/`cwd` parameters; update JSDoc.
   In `src/permission-manager.ts`: drop the two trailing args from the `normalizeInput` call; remove the `currentCwd` field and its `configureForCwd` assignment.
   In `test/input-normalizer.test.ts`: drop the trailing `"linux"` arg from every remaining `normalizeInput(...)` call (this rides with the signature change — `tsc` rejects the extra arg otherwise).
   Run `pnpm run check` (signature change), the full suite, and `pnpm fallow dead-code`.
   Commit: `refactor(pi-permission-system): retire input-normalizer path normalization (#504)`.
4. **`docs:` update architecture + skill and mark Step 3 complete.**
   Rewrite the `### Path-bearing tool normalization` section; mark Phase 7 Step 3 `✅` (heading + `S3` Mermaid node); update the migration tracker; reword the SKILL deferred-follow-up note.
   Commit: `docs(pi-permission-system): retire path-bearing normalization; mark Phase 7 Step 3 done (#504)`.

## Risks and Mitigations

- **Risk: a missed `checkTool` path call breaks at runtime, not `tsc`** (esbuild skips types; the `tool` intent shape is unchanged).
  Mitigation: Step 1 lands green first and the full suite runs after each step; any unmigrated real-path `checkTool` surfaces as a red in Step 3's full-suite run.
- **Risk: `currentCwd` removal silently changes loader behavior.**
  Mitigation: grep confirms `configureForCwd` rebuilds the loader from its `cwd` parameter, not the field; the field is read only by the removed `normalizeInput` call.
  The `configureForCwd` tests (`permission-manager-unified.test.ts`) pin loader behavior.
- **Risk: a stale fallow suppression or a now-unused import survives** (the [#502] lesson).
  Mitigation: run `pnpm fallow dead-code` after Step 3, before the docs commit.
- **Risk: the architecture-doc rewrite drifts from the code** (per-tool patterns still work, only the mechanism moved).
  Mitigation: the rewrite attributes per-tool matching to the `access-path` gate ([#502]) and keeps the feature description (`read: { *.env: deny }`) intact.

## Open Questions

None.
The proposal is unambiguous, operator-authored, and roadmap-blessed; no follow-up issues are filed.

[#393]: https://github.com/gotgenes/pi-packages/issues/393
[#438]: https://github.com/gotgenes/pi-packages/issues/438
[#486]: https://github.com/gotgenes/pi-packages/issues/486
[#487]: https://github.com/gotgenes/pi-packages/issues/487
[#502]: https://github.com/gotgenes/pi-packages/issues/502
[#503]: https://github.com/gotgenes/pi-packages/issues/503
[#505]: https://github.com/gotgenes/pi-packages/issues/505
[#506]: https://github.com/gotgenes/pi-packages/issues/506
