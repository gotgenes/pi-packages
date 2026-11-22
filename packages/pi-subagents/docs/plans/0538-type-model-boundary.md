---
issue: 538
issue_title: "pi-subagents Phase 20 Step 4: type the model boundary"
---

# Type the model boundary

## Release Recommendation

**Release:** ship independently

The Phase 20 roadmap tags Step 4 `Release: independent` — it has no batch dependency.
This is refactor-only work: every commit is `refactor:`/`test:` (both `hidden: true`) or a `docs:` edit under the release-excluded `packages/pi-subagents/docs/architecture` path.
None of them cut a release on their own, so the change auto-batches into the next `feat:`/`fix:` release rather than producing its own tag.

## Problem Statement

`ModelRegistry.find` / `getAll` / `getAvailable` return `any`, and that `any` (with `unknown`) threads the resolved model value through `model-resolver`, `spawn-config`, and `service-adapter`.
Two consequences follow:

- `model-resolver.ts` carries a file-level `eslint-disable` header (`no-unsafe-assignment`, `no-redundant-type-constituents`) solely because its registry and return types are untyped.
- `spawn-config.ts` carries a 4-rule file-level `eslint-disable` header because `ModelInfo.modelRegistry` is `unknown` and the resolved model is untyped, so every member access on it is "unsafe".
- `service-adapter.spawn` (16 cyclomatic, CRAP 71.3) is the sole accelerating churn file, dominated by an inline model-resolution branch that traffics an `unknown` model.

The SDK exports a `Model` type usable at all these sites, so the boundary can be typed and the suppressions removed.

## Goals

- Type the local `ModelRegistry` interface's `find` / `getAll` / `getAvailable` returns against `Model<any>` (the SDK type already imported across this package).
- Type `resolveModel`'s and `resolveInvocationModel`'s results so the resolved model is `Model<any>`, not `any`/`unknown`.
- Remove the file-level `eslint-disable` header from `model-resolver.ts`.
- Remove (or shrink to line-level) the 4-rule file-level `eslint-disable` header in `spawn-config.ts`.
- Extract the fuzzy-scoring loop from `resolveModel` so it drops below the complexity threshold (currently 17 cyclomatic).
- Extract the model-resolution branch from `service-adapter.spawn` so it drops off the HIGH-CRAP list.
- Preserve all observable behavior — the tool surface, the `SubagentsService.spawn` contract, and byte-identical model-resolution outputs.

This change is **not breaking**: it narrows internal types and removes lint suppressions; no output shape, default, or public contract changes.

## Non-Goals

- Typing `ParentSnapshot.model` / `SessionContext.model` / `assembleSessionConfig`'s `parentModel`.
  That is a separate `unknown` thread captured at the SDK boundary (Pi's `ExtensionContext.model` is itself untyped in our narrow `SessionContext` interface); typing it would cascade into session-config assembly.
  Left as a residual, tracked by the phase's broader SDK-boundary theme, not filed as a follow-up.
- Step 5's `tui`/`theme` render-interface work (`agent-widget.ts`, `agent-tool.ts` render callbacks) — a separate issue ([#539]).
- Any change to the fuzzy-matching algorithm, scoring weights, or the "available models" listing.

## Background

Relevant modules:

- `src/session/model-resolver.ts` — pure resolver.
  Exports `ModelRegistry` (narrow structural interface: `find`, `getAll`, `getAvailable?`), `ModelEntry` (internal-only projection: `id`, `name`, `provider`), `ModelResolution` union, `resolveModel(input, registry)`, `resolveInvocationModel(parentModel, modelInput, modelFromParams, registry)`.
- `src/tools/spawn-config.ts` — pure config resolution; defines `ModelInfo` (`parentModel: { id; name? }`, `modelRegistry: unknown`) and calls `resolveInvocationModel`.
- `src/service/service-adapter.ts` — `SubagentsServiceAdapter.spawn`; injects a `resolveModel` function typed `(input, registry) => unknown` and resolves the model inline.
- `src/runtime.ts` — `getModelInfo()` builds `ModelInfo`, casting `currentCtx?.model` and reading `currentCtx?.modelRegistry`.
- `src/types.ts` — `SessionContext.modelRegistry` is already `ModelRegistry | undefined` (the local interface); no change needed.

SDK facts (verified against `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent`):

- `Model<TApi extends Api>` (from `@earendil-works/pi-ai`) has `id: string`, `name: string`, `provider: Provider` — exactly the three fields the scoring loop reads.
  `.id` / `.name` are `string` regardless of `TApi`, so `Model<any>` yields typed member access, not `any`.
- The real `ModelRegistry` class (`@earendil-works/pi-coding-agent`) returns `Model<Api>[]` from `getAll` / `getAvailable` and `Model<Api> | undefined` from `find` — structurally satisfying the local narrow interface once its return types are `Model<any>`.
- `@typescript-eslint/no-explicit-any` is **off** globally (`eslint.config.js`), so `Model<any>` is lint-clean and matches the existing convention in `spawn-config.ts`, `subagent.ts`, `subagent-manager.ts`, and `create-subagent-session.ts`.

Convention: `Model<any>` (not `Model<Api>`) — the issue and roadmap both specify it, and four sibling modules already use it.
The narrow local `ModelRegistry` interface is kept (ISP): the resolver needs only three of the SDK class's ~20 methods.

## Design Overview

### Typed registry and resolver (`model-resolver.ts`)

```typescript
export interface ModelRegistry {
  find(provider: string, modelId: string): Model<any> | undefined;
  getAll(): Model<any>[];
  getAvailable?(): Model<any>[];
}

export interface ModelResolutionResult {
  model: Model<any> | undefined; // undefined = inherit parent (no override)
  error?: undefined;
}

export function resolveModel(input: string, registry: ModelRegistry): Model<any> | string;

export function resolveInvocationModel(
  parentModel: Model<any> | undefined,
  modelInput: string | undefined,
  modelFromParams: boolean,
  registry: ModelRegistry | undefined,
): ModelResolution;
```

- `ModelEntry` is removed — `getAll()` now returns `Model<any>[]`, so the `as ModelEntry[]` cast disappears and the scoring loop reads `Model<any>` directly.

- The fuzzy-scoring loop is extracted into a private, in-file helper `findBestFuzzyMatch(models: Model<any>[], query: string): Model<any> | undefined` (placed below `resolveModel` per the stepdown rule).
  This drops `resolveModel` below the complexity threshold; the helper stays private (not exported) — it is covered transitively by the existing `resolveModel` tests, and exporting it would trip fallow `unused-exports`.

- `resolveInvocationModel` accepts `registry: ModelRegistry | undefined` (matching the honest type of `ModelInfo.modelRegistry`) and gains one guard after the no-`modelInput` short-circuit:

  ```typescript
  if (!modelInput) return { model: parentModel };
  if (!registry) return { error: "No model registry available." };
  const resolved = resolveModel(modelInput, registry);
  // …
  ```

  This makes the function total.
  The guarded path is unreachable in practice (a live session always has a registry when a model override is requested); previously it would have thrown a `TypeError` on `registry.getAll`.
  Converting an unreachable crash into a typed error result is internal hardening, not a user-facing behavior change — hence `refactor:`, not `fix:`.

- The file-level `eslint-disable` header is removed: `no-redundant-type-constituents` was for `any | string` (now `Model<any> | string`, a genuine union); `no-unsafe-assignment` was for the untyped registry reads (now typed).

### Typed model boundary in `spawn-config.ts` + `runtime.ts`

`ModelInfo` becomes honestly typed:

```typescript
export interface ModelInfo {
  parentModel: Model<any> | undefined; // was { id: string; name?: string } | undefined
  modelRegistry: ModelRegistry | undefined; // was unknown
}
```

- `resolveInvocationModel(modelInfo.parentModel, …, modelInfo.modelRegistry)` — the `as any` cast on the registry is removed.
- `const model = resolution.model` is now `Model<any> | undefined`, so `model?.id` / `model?.name` are typed member access — the 4-rule file-level `eslint-disable` header is removed.
- `runtime.getModelInfo()` casts `this.currentCtx?.model as Model<any> | undefined` (was `as ModelInfo["parentModel"]`); `modelRegistry: this.currentCtx?.modelRegistry` already yields `ModelRegistry | undefined`.

Widening `parentModel` from `{ id; name? }` to `Model<any>` is more honest — spawn-config already returns `modelInfo.parentModel` as the inherited `SpawnExecution.model` (typed `Model<any> | undefined`), so the narrow projection was under-typing a full model.

This coupling means the `model-resolver.ts` and `spawn-config.ts`/`runtime.ts` changes land in **one commit**: retyping `resolveInvocationModel`'s `parentModel` parameter to `Model<any> | undefined` breaks the spawn-config call site (a `{ id; name? }` is not a `Model<any>`) at typecheck, so the caller must move with it.

### Typed resolved model in `service-adapter.ts`

The injected resolver field is typed, and the inline branch is extracted:

```typescript
private readonly resolveModel: (input: string, registry: ModelRegistry) => Model<any> | string;

private resolveModelOption(modelInput: string | undefined): Model<any> | undefined {
  if (!modelInput) return undefined;
  const registry = this.runtime.currentCtx?.modelRegistry;
  if (!registry) throw new Error("No model registry available.");
  const resolved = this.resolveModel(modelInput, registry);
  if (typeof resolved === "string") throw new Error(resolved);
  return resolved;
}
```

`spawn` calls `const model = this.resolveModelOption(options?.model);` after its own `currentCtx` guard.
`model` is `Model<any> | undefined` and flows into `manager.spawn({ …, model })` unchanged.
Extracting the branch removes three decision points (`if (options?.model)`, `if (!registry)`, `if (typeof resolved === "string")`) plus an optional access from `spawn`, dropping it off the high-complexity/HIGH-CRAP list.

Call-site sketch (Tell-Don't-Ask preserved — `spawn` tells the helper the input, gets back the resolved model or a throw):

```typescript
spawn(type, prompt, options?) {
  if (!this.runtime.currentCtx) throw new Error("No active session …");
  const model = this.resolveModelOption(options?.model);
  // … description, isBackground, snapshot, manager.spawn({ …, model })
}
```

`index.ts` wiring is unchanged — the real `resolveModel` (now returning `Model<any> | string`) is assignable to the typed field.

Verify with fallow after the extraction: `spawn` off the HIGH-CRAP list, `resolveModel` off the complexity list.
If `spawn` is still at/above threshold after the branch extraction, also extract the `manager.spawn` options-assembly into a private `buildSpawnConfig`.

## Module-Level Changes

- `src/session/model-resolver.ts` — remove the file-level `eslint-disable`; type `ModelRegistry` returns as `Model<any>`; add `import type { Model } from "@earendil-works/pi-ai"`; remove `ModelEntry`; type `resolveModel` return as `Model<any> | string`; extract private `findBestFuzzyMatch`; type `ModelResolutionResult.model` as `Model<any> | undefined`; retype `resolveInvocationModel`'s `parentModel` (`Model<any> | undefined`) and `registry` (`ModelRegistry | undefined`) and add the no-registry guard.
- `src/tools/spawn-config.ts` — remove the 4-rule file-level `eslint-disable`; retype `ModelInfo.parentModel` (`Model<any> | undefined`) and `ModelInfo.modelRegistry` (`ModelRegistry | undefined`, importing `ModelRegistry` from `#src/session/model-resolver`); drop the `modelInfo.modelRegistry as any` cast.
- `src/runtime.ts` — `getModelInfo()` casts `currentCtx?.model as Model<any> | undefined`; add `import type { Model }` if not present.
- `src/service/service-adapter.ts` — type the injected `resolveModel` field return as `Model<any> | string`; add `import type { Model }`; extract `resolveModelOption`; type `model` in `spawn` as `Model<any> | undefined`.
- `test/helpers/make-model.ts` (new) — `makeModel(overrides?: Partial<Model<any>>): Model<any>` fixture builder filling the SDK-required fields (`api`, `baseUrl`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`) with inert defaults, overridable via `{ id, name, provider }`.
  Landed together with its first consumer (not as a standalone commit) so fallow `unused-exports` stays green.
- `test/session/model-resolver.test.ts` — rebuild `MODELS` as full `Model<any>` via `makeModel`; `makeRegistry` returns the typed registry; add a test for the new `resolveInvocationModel` no-registry guard.
- `test/tools/spawn-config.test.ts` — `makeModelInfo` builds `parentModel` via `makeModel` and a typed `modelRegistry` (drop the `as unknown` cast); the `expect(result.execution.model).toBe(parentModel)` case passes a `Model<any>`.
- `test/service/service-adapter.test.ts` — the `resolveModel` stubs return `Model<any>` via `makeModel` (the typed field forces full-model returns); assertions unchanged.
- `packages/pi-subagents/docs/architecture/architecture.md` — append a `Landed:` note to the `#### Step 4` section (final `docs:` commit), recording: `model-resolver.ts` file-level disable removed, `spawn-config.ts` 4-rule disable removed, `service-adapter.spawn` resolved (running HIGH-CRAP tally 2 → 1 remaining: the notification renderer arrow), `resolveModel` off the complexity list.
  The Phase-20 discovery-findings snapshot and health-metrics table (Phase-19-end baseline) are left as-is, matching the prior steps' convention.

`ParentSnapshot` is untouched (its `modelRegistry` shape differs and is out of scope), so `test/helpers/stub-ctx.ts` (`STUB_SNAPSHOT`) needs no change.

## Test Impact Analysis

1. **New tests enabled** — the `resolveInvocationModel` no-registry guard is a new, directly-testable branch (`modelInput` set + `registry: undefined` → `{ error }`).
   `findBestFuzzyMatch` is exercised through the existing `resolveModel` suite; no new file.
2. **Redundant tests** — none become redundant.
   The fuzzy-match extraction is behavior-preserving, so the existing `resolveModel` cases remain the coverage for the extracted helper.
3. **Tests that must stay** — the full `resolveModel` fuzzy/exact-match suite (`model-resolver.test.ts`), the `service-adapter.spawn` model-resolution cases (`resolves string model names`, `throws on model resolution failure`, `delegates to manager.spawn with resolved model`, `does not call resolveModel when no model option`), and the `spawn-config` model cases — all genuinely exercise the boundary being typed and must pass unchanged (byte-identical behavior).

The fixture migration (partial model literals → `makeModel`) is mechanical: the scoring reads only `id`/`name`/`provider`, so full-model fixtures produce identical resolutions and the `toEqual(MODELS[i])` assertions still hold.

## Invariants at risk

- **Step 3 (#537) — `service-adapter.steer` outcome mapping**: not touched (this change is confined to `spawn`).
- **`SubagentsService.spawn` contract**: resolves a string model to a `Model`, throws on resolution failure, passes the resolved model to `manager.spawn`.
  Pinned by `test/service/service-adapter.test.ts` (`resolves string model names`, `throws on model resolution failure`, `delegates to manager.spawn with resolved model`) — kept green through the `resolveModelOption` extraction.
- **Fuzzy/exact model resolution output**: byte-identical.
  Pinned by the `model-resolver.test.ts` suite — the extraction and typing must not alter any resolution or the "Available models" error listing.

## TDD Order

1. **Type the resolver + spawn-config model boundary** (one commit — shared `resolveInvocationModel` signature).
   - Add `test/helpers/make-model.ts`; migrate `model-resolver.test.ts` (`MODELS`/`makeRegistry`) and `spawn-config.test.ts` (`makeModelInfo`) to it; add the `resolveInvocationModel` no-registry-guard test.
   - Apply the `model-resolver.ts`, `spawn-config.ts`, and `runtime.ts` changes (typed registry/returns, `findBestFuzzyMatch` extraction, guard, removed disables, retyped `ModelInfo`).
   - The existing suite is the refactor safety net (behavior-preserving); the new guard test is the one genuine red→green.
   - Run `pnpm run check` (shared-interface change) + `pnpm run lint` (confirm both disables are gone with no new violations) + the affected suites.
   - Commit: `refactor(pi-subagents): type model-resolver + spawn-config model boundary`.
2. **Type the resolved model in `service-adapter.spawn`**.
   - Migrate the `resolveModel` stubs in `service-adapter.test.ts` to `makeModel` (forced by the typed field).
   - Type the injected field return, extract `resolveModelOption`, type `model`.
   - Run `pnpm run check` + the service-adapter suite + `fallow health --complexity` (confirm `spawn` off the HIGH-CRAP list; if not, also extract `buildSpawnConfig`).
   - Commit: `refactor(pi-subagents): type resolved model in service-adapter spawn`.
3. **Record the landing in the architecture doc**.
   - Append the `#### Step 4` `Landed:` note (disable/CRAP/complexity tally as above).
   - Commit: `docs(pi-subagents): mark Phase 20 Step 4 landed (#538)`.

## Risks and Mitigations

- **Risk**: `Model<any>` re-introduces `any` at member-access sites.
  *Mitigation*: `Model<TApi>.id`/`.name`/`.provider` are typed independent of `TApi`; only the phantom generic is `any`, so accesses stay typed.
  Verified against the SDK `Model` interface.
- **Risk**: fixture migration silently changes resolution results.
  *Mitigation*: scoring reads only `id`/`name`/`provider`; `makeModel` preserves those from the old literals, and the `toEqual` assertions catch any drift.
- **Risk**: the extraction doesn't drop `spawn` below threshold.
  *Mitigation*: Step 2 verifies with `fallow health --complexity` and, if needed, extracts the options-assembly too.
- **Risk**: removing a file-level disable surfaces a genuinely irreducible SDK-gap line.
  *Mitigation*: fall back to a line-level suppression with the specific named rule (per the roadmap's "line-level precision, not zero" guidance), not a re-added file header.

## Open Questions

- None blocking.
  The residual `unknown` model thread through `ParentSnapshot` / `SessionContext.model` / `assembleSessionConfig` is deferred (see Non-Goals) — it sits behind a genuine SDK-typing gap and is not required by the Step 4 outcome.

[#539]: https://github.com/gotgenes/pi-packages/issues/539
