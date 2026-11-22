---
issue: 611
issue_title: "Finish typing the model boundary in the snapshot and session-assembly thread"
---

# Finish typing the model boundary in the snapshot and session-assembly thread

## Release Recommendation

**Release:** ship independently

This is Phase 21 Step 3, tagged `Release: independent` in the architecture roadmap, with no batch membership.
It lands as a `refactor:` commit (a hidden changelog type), so it does not cut a release on its own — it auto-batches into the next unhidden (`feat:`/`fix:`/`docs:`) release.
No dedicated release is cut for this change.

## Problem Statement

Phase 20 Step 4 ([#538]) typed the resolver and tools layer against `Model<any>` but explicitly deferred the snapshot and session-assembly thread, leaving `model` / `parentModel` typed as `unknown` at seven sites.
The residue is an `as Model<any>` cast in `src/runtime.ts` and a `ctx.modelRegistry!` non-null assertion in `src/lifecycle/parent-snapshot.ts`.
The same SDK value is typed on one side of the boundary (`model-resolver.ts`, `spawn-config.ts` thread `Model<any>` correctly) and `unknown` on the other — an inconsistency, not a constraint.
This is Category C platform type threading: a raw SDK value crosses into the core untyped and is re-narrowed with a cast at the consumption site instead of being typed once at the boundary.

## Goals

- Type `model` / `parentModel` against `Model<any>` (imported from `@earendil-works/pi-ai`, as `model-resolver.ts` already does) throughout the snapshot and session-assembly thread.
- Type `modelRegistry` against the `ModelRegistry` interface (from `#src/session/model-resolver`, already used by `SessionContext`), replacing the two duplicated inline structural types.
- Drop the `runtime.ts` `as Model<any> | undefined` cast.
- Drop the `parent-snapshot.ts` `ctx.modelRegistry!` non-null assertion.
- Recompute metric: `model` / `parentModel` `unknown` sites drop 7 → 0.

This is **not** a breaking change: it is a type-only interface tightening with no observable behavior, output-shape, or default change on upgrade.

## Non-Goals

- No behavior change — model resolution, fallback semantics, and session assembly are untouched.
- Do not rework the `ModelRegistry` interface itself or its `model-resolver.ts` consumers (already typed by [#538]).
- Do not touch the `spawn-config.ts` / `resolveInvocationModel` thread (already typed).
- Do not port the `settingsManager: unknown` / `ResourceLoaderLike` fields in `CreateSessionOptions` — those are a separate opaque-field concern outside this issue's `Model`/`ModelRegistry` scope.

## Background

The affected thread is the snapshot → session-assembly path:

```text
SessionContext (types.ts)
  → buildParentSnapshot → ParentSnapshot (parent-snapshot.ts)
    → createSubagentSession (create-subagent-session.ts)
      → assembleSessionConfig → AssemblerContext / AssemblerOptions / SessionConfig (session-config.ts)
        → resolveDefaultModel (session-config.ts, private helper)
```

Relevant current state:

- `src/types.ts` — `SessionContext.model: unknown`; `SessionContext.modelRegistry: ModelRegistry | undefined` (already the `model-resolver` `ModelRegistry`).
- `src/lifecycle/parent-snapshot.ts` — `ParentSnapshot.model: unknown`; `ParentSnapshot.modelRegistry` is an inline structural type `{ find(...): unknown; getAvailable?(): Array<{ provider; id }> }`; `buildParentSnapshot` copies `ctx.modelRegistry!`.
- `src/session/session-config.ts` — `AssemblerContext.parentModel?: unknown` and `.modelRegistry` (same inline structural type as `ParentSnapshot`); `AssemblerOptions.model?: unknown`; `SessionConfig.model: unknown`; `resolveDefaultModel(parentModel: unknown, ...): unknown`.
- `src/lifecycle/create-subagent-session.ts` — `CreateSessionOptions.model?: unknown` and `.modelRegistry: unknown`.
- `src/runtime.ts` — `getModelInfo()` returns `parentModel: this.currentCtx?.model as Model<any> | undefined` (the cast); already imports `Model` from `@earendil-works/pi-ai`.

Feasibility (from the issue, verified against `packages/pi-subagents/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`):

- `ExtensionContext.model: Model<any> | undefined` (line 222).
- `ExtensionContext.modelRegistry: ModelRegistry` — **non-optional** (line 220).

The SDK guaranteeing `modelRegistry` non-optional is what lets the `parent-snapshot.ts` `!` be dropped cleanly (see Design Overview).

AGENTS.md constraints that apply:

- Code Style: keep Pi SDK type imports confined to boundary modules; `Model` / `ModelRegistry` are already imported into these files or their siblings, and the types come from `@earendil-works/pi-ai` (`Model`) and `#src/session/model-resolver` (`ModelRegistry`) — no new SDK coupling into pure helpers.
- The change lands as `refactor:` (hidden changelog type); the roadmap's Release-batches note confirms Step 3 lands as `refactor:`.
- Biome/ESLint: dropping the `runtime.ts` cast is required, not optional — once `SessionContext.model` is `Model<any> | undefined`, the cast becomes an unnecessary type assertion that `@typescript-eslint/no-unnecessary-type-assertion` would flag.

## Design Overview

### Type shapes (before → after)

```typescript
// types.ts — SessionContext
readonly model: unknown;                         // → readonly model: Model<any> | undefined;
readonly modelRegistry: ModelRegistry | undefined; // → readonly modelRegistry: ModelRegistry;

// parent-snapshot.ts — ParentSnapshot
model: unknown;                                  // → model: Model<any> | undefined;
modelRegistry: { find(...): unknown; getAvailable?(...) }; // → modelRegistry: ModelRegistry;

// session-config.ts — AssemblerContext
parentModel?: unknown;                           // → parentModel?: Model<any>;
modelRegistry: { find(...): unknown; getAvailable?(...) }; // → modelRegistry: ModelRegistry;
// session-config.ts — AssemblerOptions
model?: unknown;                                 // → model?: Model<any>;
// session-config.ts — SessionConfig
model: unknown;                                  // → model: Model<any> | undefined;
// session-config.ts — resolveDefaultModel (private helper)
function resolveDefaultModel(parentModel: unknown, registry: AssemblerContext["modelRegistry"], configModel?: string): unknown
//   → (parentModel: Model<any> | undefined, registry: AssemblerContext["modelRegistry"], configModel?: string): Model<any> | undefined

// create-subagent-session.ts — CreateSessionOptions
modelRegistry: unknown;  model?: unknown;        // → modelRegistry: ModelRegistry;  model?: Model<any>;
```

`ModelRegistry` (from `#src/session/model-resolver`) is:

```typescript
interface ModelRegistry {
  find(provider: string, modelId: string): Model<any> | undefined;
  getAll(): Model<any>[];
  getAvailable?(): Model<any>[];
}
```

### Why `SessionContext.modelRegistry` becomes non-optional

The `!` at `parent-snapshot.ts:44` exists only because `ParentSnapshot.modelRegistry` is non-optional while `ctx.modelRegistry` was `ModelRegistry | undefined`.
Two ways to drop it:

1. **Tighten `SessionContext.modelRegistry` to non-optional** (chosen) — matches the SDK truth (`ExtensionContext.modelRegistry: ModelRegistry` is non-optional), so `ctx.modelRegistry` flows into `ParentSnapshot.modelRegistry` without an assertion, and `resolveDefaultModel` keeps its existing no-guard use of `registry.find` / `registry.getAvailable?.()`.
2. Make `ParentSnapshot.modelRegistry` optional and cascade `| undefined` through `AssemblerContext` and a new guard in `resolveDefaultModel` (rejected) — adds defensive `registry?.` code and a subtle throw→fallback behavior shift in the theoretical undefined case, for no real gain.

The `| undefined` on `SessionContext.modelRegistry` was defensive and unnecessary: the real `ExtensionContext` always provides a registry, and consumers that treat it as optional do so via `currentCtx?.modelRegistry` — the `| undefined` there comes from `currentCtx` being legitimately optional (no active session), **not** from the field.
So `runtime.getModelInfo()` (`this.currentCtx?.modelRegistry`) and `service-adapter.ts:101` (`this.runtime.currentCtx?.modelRegistry`) keep their `ModelRegistry | undefined` result and need no change; `ModelInfo.modelRegistry` stays `ModelRegistry | undefined`.

### Interaction pattern (extracted-thread sanity check)

`resolveDefaultModel` already reads only `registry.find(...)` and `registry.getAvailable?.()` and returns a resolved-or-fallback value — no Tell-Don't-Ask violation, no output-argument mutation, no reach-through.
Typing its params/return changes no control flow:

```typescript
// after — behavior identical, types tightened
const found = registry.find(provider, modelId);           // Model<any> | undefined
if (found && isAvailable(provider, modelId)) return found; // Model<any>
return parentModel;                                        // Model<any> | undefined
```

Adopting the shared `ModelRegistry` interface also removes the duplicated inline structural type (`{ find(...): unknown; getAvailable?() }` appears in both `parent-snapshot.ts` and `session-config.ts`) — collapsing a small duplication onto the single owning interface.

### `CreateSessionOptions` boundary

`CreateSessionOptions.model` / `.modelRegistry` are the SDK-creation seam; the only real implementation (`src/index.ts:97`) is `createSession: (opts) => createAgentSession(opts as any)`, so the SDK sees `any` regardless.
Typing these fields to `Model<any>` / `ModelRegistry` documents the values the factory actually passes (`cfg.model`, `snapshot.modelRegistry`) and removes two more `unknown`s; only the `model` field is counted by the recompute metric.

### In-code doc staleness

`session-config.ts` carries two comments that describe the pre-typing world and go stale:

- `AssemblerContext` JSDoc: "Models are treated as opaque handles…" (line ~40) — soften to note the assembler still passes models through without inspection, but they are now typed.
- `SessionConfig.model` JSDoc: "Opaque handle… Caller casts to the SDK's `Model<any>` at the session-creation boundary." (lines ~85–87) — the cast is gone; update to state the field is the resolved `Model<any> | undefined`.

## Module-Level Changes

Source (`src/`):

- `src/types.ts` — add `Model` to the `@earendil-works/pi-ai` type import; `SessionContext.model: unknown` → `Model<any> | undefined`; `SessionContext.modelRegistry: ModelRegistry | undefined` → `ModelRegistry` (non-optional).
- `src/lifecycle/parent-snapshot.ts` — import `Model` (`@earendil-works/pi-ai`) and `ModelRegistry` (`#src/session/model-resolver`); `ParentSnapshot.model: unknown` → `Model<any> | undefined`; replace the inline `modelRegistry` structural type with `ModelRegistry`; drop the `ctx.modelRegistry!` assertion (now `ctx.modelRegistry`).
- `src/session/session-config.ts` — import `Model` and `ModelRegistry`; `AssemblerContext.parentModel?: unknown` → `Model<any>`; replace inline `modelRegistry` type with `ModelRegistry`; `AssemblerOptions.model?: unknown` → `Model<any>`; `SessionConfig.model: unknown` → `Model<any> | undefined`; `resolveDefaultModel` param `parentModel: unknown` → `Model<any> | undefined` and return `unknown` → `Model<any> | undefined`; refresh the two stale JSDoc comments.
- `src/lifecycle/create-subagent-session.ts` — `CreateSessionOptions.modelRegistry: unknown` → `ModelRegistry` (import from `#src/session/model-resolver`); `CreateSessionOptions.model?: unknown` → `Model<any>` (`Model` already imported).
- `src/runtime.ts` — drop the `as Model<any> | undefined` cast in `getModelInfo()`; `parentModel: this.currentCtx?.model`.
  Confirm `Model` import is still used (it remains, for `ModelInfo.parentModel` typing via the returned value — verify no now-unused import lint after the edit).

Tests (`test/`) — fixtures that pass partial `Model` literals or registries missing `getAll` **uncast** into the tightened types:

- `test/helpers/stub-ctx.ts` — `STUB_SNAPSHOT.modelRegistry: { find: () => undefined }` → add `getAll: () => []` (satisfy `ModelRegistry`).
  `model: undefined` already valid.
- `test/session/session-config.test.ts` — `mockRegistry`: add `getAll: vi.fn((): Model<any>[] => [])`; change `find`'s annotation `(): unknown` → `(): Model<any> | undefined`; change `getAvailable`'s return type `Array<{ provider; id }>` → `Model<any>[]` and its `mockReturnValueOnce([{ provider, id }])` calls to `[makeModel({ provider, id })]`; change the `parentModel` / `explicitModel` / `resolvedModel` / `foundModel` partial literals (`{ provider, id }`) to `makeModel({ provider, id })` (import `makeModel` from `#test/helpers/make-model`).
  `toBe(...)` assertions are unaffected (same object identity).
- `test/runtime.test.ts` — default `makeSessionCtx.modelRegistry: undefined` → a stub registry `{ find: () => undefined, getAll: () => [] }` (satisfy non-optional `SessionContext.modelRegistry`); in the `getModelInfo returns model and modelRegistry` test, change `model: { id, name }` to a `makeModel({ id, name })` captured in a var and switch the assertion `toEqual({ id, name })` → `toBe(model)`.

No change needed (verified): `test/lifecycle/parent-snapshot.test.ts` (casts via `as unknown as ExtensionContext`), `test/service/service-adapter.test.ts` (`makeStubCtx` already supplies `{ find, getAll }` and `model: undefined`), `test/print-mode.test.ts` (`as any`), `test/lifecycle/create-subagent-session.test.ts` (uses `STUB_SNAPSHOT`).

Docs — landed by the implementation stage at completion (per AGENTS.md roadmap-step doc convention):

- `packages/pi-subagents/docs/architecture/architecture.md`:
  - `### Step 3 — Finish typing the model boundary ([#611])` → `### ✅ Step 3 — …`, and add a `Landed:` note summarizing the typed thread + dropped cast/assertion.
  - Step-dependencies Mermaid: `S3["Step 3 (#611)<br/>Type the model boundary"]` → `S3["✅ Step 3 (#611)<br/>Type the model boundary"]`.
  - Health-metrics table: mark the `model`/`parentModel` typed `unknown` row complete (`7` → `0 ✅`, matching the Step 1 row's `→ N ✅` style).

## Test Impact Analysis

This is a type-threading refactor, not an extraction, so no new lower-level unit tests are enabled and no existing tests become redundant.

1. **New tests enabled:** none — the change adds no new collaborator or seam.
   The compiler (`pnpm run check`) is the primary verification that the boundary is typed end-to-end; a partial tightening leaves `tsc` red, so a green build proves the whole thread is consistent.
2. **Tests that become redundant:** none.
3. **Tests that must stay as-is (genuinely exercise this layer):** the `session-config.test.ts` model-resolution suite (`resolveDefaultModel` priority: explicit option > config-model string > parent model, plus the availability check) must stay green after fixtures switch to `makeModel(...)` — it pins the behavior this refactor must not change.
   The `parent-snapshot.test.ts` capture tests (`captures model from ctx`, `captures modelRegistry from ctx`) and `runtime.test.ts` `getModelInfo` tests likewise pin the pass-through behavior across the retyped boundary.

## Invariants at risk

Phase 20 Step 4 ([#538]) typed the resolver/tools layer against `Model<any>`; this step must not regress that thread.

- **Invariant:** model resolution priority (explicit option > config-model string that resolves and is available > parent model fallback) is unchanged.
  Pinned by `test/session/session-config.test.ts` — "options.model wins over config model and parent model", "config model string resolves via registry when available", "falls back to parentModel when config model string is not in registry", "falls back to parentModel when config model is not available".
- **Invariant:** `getModelInfo` returns the parent model and registry from the current context, undefined parent model when the context model is undefined.
  Pinned by `test/runtime.test.ts` — "getModelInfo returns model and modelRegistry from current context", "getModelInfo returns undefined parentModel when context model is undefined".

Both live in tests (not only prose); the fixture edits above keep them green without weakening the assertions.

## TDD Order

This is a `refactor:` with no behavior change; the compiler plus the existing suite are the safety net, and the type thread is entangled (`resolveDefaultModel`'s return type depends on `registry.find`'s return type), so the retyping lands as one atomic commit rather than red→green behavioral cycles.

1. **refactor** — Thread `Model<any>` / `ModelRegistry` through the snapshot and session-assembly boundary.
   Apply all `src/` changes (types.ts, parent-snapshot.ts, session-config.ts, create-subagent-session.ts, runtime.ts), drop the cast and the `!`, refresh the two stale JSDoc comments, and update the three test fixtures (`stub-ctx.ts`, `session-config.test.ts`, `runtime.test.ts`) in the same commit — tightening these shared interfaces breaks every consumer and fixture at the type level simultaneously.
   Verify: `pnpm --filter @gotgenes/pi-subagents run check` (tsc green), `pnpm --filter @gotgenes/pi-subagents run lint` (no `no-unnecessary-type-assertion`, no unused-import), `pnpm --filter @gotgenes/pi-subagents run test` (all green), and the recompute grep returns `0`: `grep -rEn "model\??: unknown|parentModel\??: unknown" packages/pi-subagents/src --include="*.ts" | wc -l`.
   Suggested message: `refactor(pi-subagents): type the model/registry snapshot and session-assembly boundary (#611)`.
2. **docs** — Land the roadmap step-mark and metric.
   Mark architecture Step 3 `✅` with a `Landed:` note, update the Mermaid `S3` node, and mark the health-metric row `0 ✅`.
   Verify: `pnpm exec rumdl check packages/pi-subagents/docs/architecture/architecture.md`.
   Suggested message: `docs(pi-subagents): mark Phase 21 Step 3 complete (#611)`.

## Risks and Mitigations

- **Risk:** making `SessionContext.modelRegistry` non-optional is a broader assertion than the issue's literal 7-site list.
  **Mitigation:** it matches the SDK truth (`ExtensionContext.modelRegistry: ModelRegistry`), is type-only (no runtime change), and is the minimal way to drop the `!` without cascading undefined-guards; only `runtime.test.ts`'s fixture default needs a one-line registry stub, and no production `SessionContext` is ever built with an undefined registry (the sole construction is `ctx as SessionContext` in `handlers/lifecycle.ts` from the real `ExtensionContext`).
- **Risk:** `getAvailable`'s return type widens from `Array<{ provider; id }>` to `Model<any>[]` when the inline type is replaced by `ModelRegistry`, forcing test fixtures to build full models.
  **Mitigation:** `resolveDefaultModel` reads only `.provider` / `.id` from the result, so production is unaffected; fixtures switch to the existing `makeModel(...)` helper (mechanical).
- **Risk:** a silently dropped `import type` removal passes `tsc` (an unused type import is not an error).
  **Mitigation:** run `pnpm run lint` (flags unused imports) after the edit and re-read `runtime.ts` to confirm the `Model` import is still referenced or removed as appropriate.

## Open Questions

None — the change is type-only, the SDK surface is verified, and the fixture impact is fully enumerated.

<!-- Reference-style issue links (long-lived doc convention) -->

[#538]: https://github.com/gotgenes/pi-packages/issues/538
