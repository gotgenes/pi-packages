---
issue: 478
issue_title: "pi-permission-system: narrow ScopedPermissionResolver to a single resolve(intent) (Phase 6 Step 6)"
---

# Narrow `ScopedPermissionResolver` to a single `resolve(intent)`

## Release Recommendation

**Release:** ship independently

This is Phase 6 Step 6, tagged `Release: independent` in the architecture roadmap (it is not a member of either Phase 6 batch).
It is a self-contained, behavior-preserving structural refactor of the resolver/manager surface, so it ships on its own.

## Problem Statement

The permission-resolution surface widens once per gate.
Gates today call either `resolver.resolve(surface, input, agentName)` (tool-shaped) or `resolver.resolvePathPolicy(values, agentName, surface)` (precomputed path values), and the underlying `ScopedPermissionManager` mirrors that split with `checkPermission` + `checkPathPolicy`.
Adding a gate can widen this surface again, and — because the surface is a method pair rather than a single entry — a test fixture can stub one method and forget the other.
That is the structural cause of the [#393] false-green: a stubbed-but-unrouted `checkPathPolicy` silently returned its default (`allow`), a bug invisible in the edited test file and caught only by the full suite.

The fix is to make gates *emit* a minimal access intent that one `resolve(intent)` answers.
Adding a gate then cannot widen the resolver surface, and — by collapsing the manager to a single resolution method — the false-green class becomes structurally impossible (there is no second method to forget).

## Goals

- Introduce a minimal `AccessIntent` value that each gate emits (surface + value-or-`AccessPath` + `agentName`), carrying no principal identity.
- Collapse `ScopedPermissionResolver.resolve` + `resolvePathPolicy` into one `resolve(intent)`.
- Collapse `ScopedPermissionManager.checkPermission` + `checkPathPolicy` into one `check(intent, sessionRules?)`, migrating every raw (non-gate) caller onto it.
- Preserve all current behavior — this is a structural refactor, not a behavior change.
- Let `AccessPath` flow into the resolver as a first-class intent variant (the resolver, not the gate, asks it for `matchValues()`), seeding the `AccessPath`-as-universal-representation direction ([#487]).

## Non-Goals

- No change to what either path surface matches against.
  The `path` surface stays lexical-only; `external_directory` stays lexical ∪ canonical (the [#418] set).
  Whether `path` should also match the canonical form is tracked separately in [#486].
- No migration of bash-path's `path-values` intent onto `AccessPath` — that depends on [#486] and is part of the broader [#487] direction.
- No principal identity on `AccessIntent`; cross-session path portability stays deferred ([#309] tracks the related advisory-path unification).
- No change to the resolver's query methods (`getToolPermission`, `getConfigIssues`) or to the resolver's raw `checkPermission` (the no-session-rules path the skill-input gate depends on via `SkillInputGateInputs`).
- No change to `configuration.md` — there is no user-facing behavior or config change.

## Background

Relevant modules and how they relate:

- `src/permission-resolver.ts` — the `ScopedPermissionResolver` interface (`resolve` + `resolvePathPolicy`) and the `PermissionResolver` class.
  The class composes a `ScopedPermissionManager` with a `SessionRules` store so gates never thread the session ruleset by hand (the [#319] / [#340] seam).
  The class also exposes `checkPermission` (raw, no session rules), `getToolPermission`, and `getConfigIssues` — these are **not** on the narrow interface and are out of scope.
- `src/permission-manager.ts` — `ScopedPermissionManager` interface + `PermissionManager` class.
  `checkPermission(toolName, input, agentName?, sessionRules?)` runs `normalizeInput` (needs `getConfiguredMcpServerNames()` + `currentCwd`) then `buildCheckResult`.
  `checkPathPolicy(values, agentName?, sessionRules?, surface="path")` skips normalization, uses precomputed values, then `buildCheckResult`.
  Both already funnel through the shared private `buildCheckResult` helper ([#393]).
- `src/access-intent/access-path.ts` — the `AccessPath` value object ([#476]); `matchValues()` returns the lexical alias union ∪ canonical for the `external_directory` surface.
- Gate descriptor factories that resolve: `src/handlers/gates/path.ts` (`resolve("path", {path})`), `bash-command.ts` (three `resolve("bash", {command})` calls), `bash-path.ts` (`resolvePathPolicy(policyValues)`), `external-directory-policy.ts` (`resolvePathPolicy(path.matchValues(), …, "external_directory")`), plus the tool-resolve site in `tool-call-gate-pipeline.ts` and the descriptor-resolve site in `runner.ts`.
- Raw (non-gate) manager callers: `src/permissions-service.ts`, `src/skill-prompt-sanitizer.ts`, `src/permission-event-rpc.ts`, and the resolver's own raw `checkPermission`.

AGENTS.md / skill constraints that apply:

- The `architecture.md` "ScopedPermissionResolver surface" health-metric row and the access-intent directory listing must be updated when this lands (the package skill's "module-move check misses narrative prose" rule).
- The package skill's testing notes about wiring new manager/resolver methods through `makeHandler`'s surface dispatcher ([#393] / [#418]) must be rewritten, because there is now a single method.

## Design Overview

### `AccessIntent` — the gate-emitted value

Three variants, modeling the three genuine ways a gate supplies "what is being accessed":

```typescript
// src/access-intent/access-intent.ts
import type { AccessPath } from "#src/access-intent/access-path";

/** Raw tool input the manager must normalize (path/bash/MCP/extension tools). */
export interface ToolAccessIntent {
  kind: "tool";
  /** Tool name fed to input normalization (e.g. "read", "bash", "path", an MCP name). */
  surface: string;
  input: unknown;
  agentName?: string;
}

/** Precomputed equivalent policy values for a path-shaped surface (bash-path). */
export interface PathValuesAccessIntent {
  kind: "path-values";
  /** "path" or "external_directory". */
  surface: string;
  values: readonly string[];
  agentName?: string;
}

/** An AccessPath value object for a path-shaped surface (external-directory). */
export interface AccessPathAccessIntent {
  kind: "access-path";
  surface: string;
  path: AccessPath;
  agentName?: string;
}

/** What a gate emits. */
export type AccessIntent =
  | ToolAccessIntent
  | PathValuesAccessIntent
  | AccessPathAccessIntent;

/** What the manager consumes — access-path already unwrapped to values. */
export type ResolvedAccessIntent = ToolAccessIntent | PathValuesAccessIntent;
```

Why three variants and not two:

- The `tool` variant carries raw input only the manager can normalize (it needs `getConfiguredMcpServerNames()` + `currentCwd`).
- The `path-values` variant carries bash-path's cd-resolved lexical `string[]` for the `path` surface, which has no canonical-boundary notion.
- The `access-path` variant lets the external-directory gate hand its `AccessPath` directly, so `AccessPath` flows into the resolver (a meaningful domain boundary) rather than being flattened at the gate.
  Forcing bash-path's plain `string[]` into an `AccessPath` would inject the canonical alias the `path` surface does not match today — a behavior change out of scope here.

### Where the unwrap happens

The **resolver** unwraps the `access-path` variant via `path.matchValues()` (Tell-Don't-Ask: it asks the `AccessPath` for its match set) and hands a `ResolvedAccessIntent` (string-based) to the manager.
The low-level `PermissionManager` stays string-based — it never imports `AccessPath`.

### Resolver

```typescript
export interface ScopedPermissionResolver {
  resolve(intent: AccessIntent): PermissionCheckResult;
}

// PermissionResolver class
resolve(intent: AccessIntent): PermissionCheckResult {
  return this.permissionManager.check(
    toResolvedIntent(intent),
    this.sessionRules.getRuleset(),
  );
}
```

`toResolvedIntent` is a private module helper:

```typescript
function toResolvedIntent(intent: AccessIntent): ResolvedAccessIntent {
  if (intent.kind === "access-path") {
    return {
      kind: "path-values",
      surface: intent.surface,
      values: intent.path.matchValues(),
      agentName: intent.agentName,
    };
  }
  return intent;
}
```

The class keeps `checkPermission` (raw, for skill-input), `getToolPermission`, and `getConfigIssues` unchanged — they remain off the narrow interface.
The raw `checkPermission` body now builds a `tool` intent and calls `manager.check(intent, sessionRules)`.

### Manager

```typescript
export interface ScopedPermissionManager {
  configureForCwd(cwd: string | undefined | null): void;
  check(
    intent: ResolvedAccessIntent,
    sessionRules?: Ruleset,
  ): PermissionCheckResult;
  getToolPermission(toolName: string, agentName?: string): PermissionState;
  getConfigIssues(agentName?: string): string[];
}

// PermissionManager class
check(intent: ResolvedAccessIntent, sessionRules?: Ruleset): PermissionCheckResult {
  const { composedRules } = this.resolvePermissions(intent.agentName);
  const fullRules: Ruleset = sessionRules?.length
    ? [...composedRules, ...sessionRules]
    : composedRules;

  if (intent.kind === "path-values") {
    const lookupValues = intent.values.length > 0 ? [...intent.values] : ["*"];
    return buildCheckResult(
      intent.surface, lookupValues, {}, intent.surface, intent.surface, fullRules,
    );
  }

  const toolName = intent.surface.trim();
  const { surface, values, resultExtras } = normalizeInput(
    toolName, intent.input, this.loader.getConfiguredMcpServerNames(), this.currentCwd,
  );
  return buildCheckResult(
    surface, values, resultExtras, toolName, intent.surface, fullRules,
  );
}
```

The two branches are exactly the former `checkPermission` and `checkPathPolicy` bodies, preserving the trimmed-toolName-for-source / original-toolName-for-result distinction.

### Consumer call-site sketches

External-directory policy helper (the `AccessPath` now flows into the resolver):

```typescript
// external-directory-policy.ts
export function resolveExternalDirectoryPolicy(path, resolver, agentName) {
  return resolver.resolve({
    kind: "access-path",
    surface: "external_directory",
    path,
    agentName,
  });
}
```

bash-path gate (precomputed values):

```typescript
// bash-path.ts
const check = resolver.resolve({
  kind: "path-values",
  surface: "path",
  values: policyValues,
  agentName: tcc.agentName ?? undefined,
});
```

Tool/path/bash-command/runner sites emit a `tool` intent:

```typescript
const check = resolver.resolve({
  kind: "tool",
  surface: "path", // or "bash" / tcc.toolName / descriptor.surface
  input: { path: filePath }, // or { command } / tcc.input / descriptor.input
  agentName: tcc.agentName ?? undefined,
});
```

### Edge cases preserved

- Empty `path-values` falls back to `["*"]` (the former `checkPathPolicy` behavior).
- The `path` vs `external_directory` surface tag still drives `evaluateAnyValue` (last-match-wins across aliases) via `PATH_SURFACES` inside `buildCheckResult` — unchanged.
- The bash-command unparseable-command fail-closed sentinel ([#452]) is in `resolveBashCommandCheck`, which now emits `tool` intents; the sentinel path is untouched.
- The `path`-surface "only the universal default fired → skip gate" guard ([#58]) lives in the gate factories, not the resolver — untouched.

## Module-Level Changes

### Added

- `src/access-intent/access-intent.ts` — `ToolAccessIntent`, `PathValuesAccessIntent`, `AccessPathAccessIntent`, `AccessIntent`, `ResolvedAccessIntent`.

### Changed — production

- `src/permission-manager.ts` — replace `checkPermission` + `checkPathPolicy` (interface + class) with `check(intent, sessionRules?)`; the two former bodies become the intent-kind branches; `buildCheckResult` unchanged.
- `src/permission-resolver.ts` — narrow `ScopedPermissionResolver` to `resolve(intent: AccessIntent)`; remove `resolvePathPolicy`; `resolve` delegates via `toResolvedIntent`; raw `checkPermission` body builds a `tool` intent; add `toResolvedIntent` private helper.
- `src/permissions-service.ts` — `checkPermission` → `check({ kind: "tool", … })`.
- `src/skill-prompt-sanitizer.ts` — `checkPermission` → `check({ kind: "tool", … })`.
- `src/permission-event-rpc.ts` — `checkPermission` → `check({ kind: "tool", … })`.
- `src/handlers/gates/path.ts` — emit a `tool` intent.
- `src/handlers/gates/bash-command.ts` — three call sites emit `tool` intents.
- `src/handlers/gates/bash-path.ts` — emit a `path-values` intent.
- `src/handlers/gates/external-directory-policy.ts` — `resolveExternalDirectoryPolicy` emits an `access-path` intent (drops the inline `path.matchValues()` call).
- `src/handlers/gates/tool-call-gate-pipeline.ts` — the tool-resolve site emits a `tool` intent.
- `src/handlers/gates/runner.ts` — the descriptor-resolve site emits a `tool` intent from `descriptor.surface` + `descriptor.input`.

### Changed — tests and fixtures

- `test/helpers/session-fixtures.ts` — `makeFakePermissionManager`: replace `checkPermission` + `checkPathPolicy` stubs with a single `check` stub.
- `test/helpers/handler-fixtures.ts` — `makeHandler`: route the `surfaceCheck` override onto the single `permissionManager.check` via an intent→(surface,input) adapter (replaces the dual `checkPermission`/`checkPathPolicy` routing); the `MockGateHandlerSession.checkPermission` override surface is unchanged.
- `test/helpers/gate-fixtures.ts` — `makeResolver`, `makeGateRunner`, `makePathDispatchResolver`: drop `resolvePathPolicy`; `makePathDispatchResolver`'s single `resolve` dispatches on intent kind (`tool` → `input.path`; `path-values` → any matching value; `access-path` → `path.matchValues()`).
- `test/permission-manager-unified.test.ts` — migrate `checkPermission`/`checkPathPolicy` tests to `check(intent)`.
- `test/permission-resolver.test.ts` — migrate `resolve`/`resolvePathPolicy` tests to `resolve(intent)` (including an `access-path` unwrap test).
- `test/handlers/gates/path.test.ts`, `bash-path.test.ts`, `bash-external-directory.test.ts`, `external-directory-policy.test.ts`, `external-directory.test.ts`, `bash-command-metamorphic.test.ts` — update resolver-mock assertions to the intent shape.
- `test/handlers/external-directory-session-dedup.test.ts` — update the inline manager mocks (`checkPermission`/`checkPathPolicy`) to the single `check`.
- Grep `test/` for any inline `ScopedPermissionResolver` / `ScopedPermissionManager` mock not covered by the fixtures and migrate it in the same commit as the interface change.

### Changed — docs

- `docs/architecture/architecture.md` — mark Step 6 ✅ (heading + Mermaid `S6` node); update the "ScopedPermissionResolver surface" health-metric row to met (`resolve(intent)`); rewrite the `permission-resolver.ts`, `permission-manager.ts`, `bash-path.ts`, and `external-directory-policy.ts` directory-listing descriptions to the new surface; add `access-intent.ts` to the access-intent directory listing; refresh the line-622 resolver-surface-widening narrative.
- `.pi/skills/package-pi-permission-system/SKILL.md` — rewrite the `makeFakePermissionManager` / `makeResolver` / `makePathDispatchResolver` / `makeGateRunner` / `makeHandler` fixture notes for the single `check` / `resolve(intent)`; rewrite the [#393] / [#418] "wire the new method through the surface dispatcher" testing notes to state the false-green is now structurally impossible (one method).

## Test Impact Analysis

1. **New unit tests enabled.**
   `resolve(intent)` can be tested per-variant in one place, including the `access-path` → `matchValues()` unwrap (previously only reachable indirectly through the external-directory gate).
   `check(intent)` can be tested per-kind directly on the manager.
2. **Tests that become redundant.**
   The separate `checkPermission` vs `checkPathPolicy` manager test groups merge into intent-kind cases of `check`.
   The separate `resolve` vs `resolvePathPolicy` resolver test groups merge into intent-variant cases of `resolve`.
   Consolidate, do not duplicate.
3. **Tests that must stay.**
   The gate behavior tests (path, bash-path, external-directory single/bash, bash-command chain) still exercise gate → resolver → manager end-to-end; they only change the asserted mock shape.
   The [#393] / [#418] integration tests (`external-directory-session-dedup.test.ts`, the `tool-call.test.ts` bash-path/external-directory blocks) stay — they pin that the unification did not reintroduce a silent `allow`.

## Invariants at risk

This step touches surfaces earlier Phase 6 / earlier-phase steps refactored.
List and pin:

- **[#393] false-green class** — pinned by the `external-directory-session-dedup` and `tool-call` integration tests routing through real instances.
  After unification the class is structurally impossible (single `check`); the tests must still pass green.
- **[#418] external_directory alias matching (lexical ∪ canonical)** — pinned by `bash-external-directory.test.ts` / `external-directory.test.ts` asserting both typed and symlink-resolved patterns match; the `access-path` variant must resolve the same `matchValues()` set.
- **[#452] bash fail-closed sentinel** — pinned by the bash-command unparseable-command tests; `resolveBashCommandCheck` keeps the sentinel.
- **[#58] universal-default skip on `path`** — pinned by the path-gate tests asserting no prompt when only the universal default fired.
- **[#306] / [#301] bash chain most-restrictive** — pinned by `bash-command-metamorphic.test.ts`.

All invariants live in existing tests; none rely on prose only, so no new pinning test is required beyond the migrated assertions.

## TDD Order

Lift-and-shift where an existing name's signature changes, to avoid a single giant test rewrite (per the testing skill).

1. **Add `AccessIntent` types + manager `check(intent)` alongside the old pair.**
   New `src/access-intent/access-intent.ts`; add `check` to the `ScopedPermissionManager` interface + `PermissionManager` class (delegating through the existing `buildCheckResult`), leaving `checkPermission`/`checkPathPolicy` in place; add a `check` stub to `makeFakePermissionManager` and route it in `makeHandler` alongside the existing dispatch.
   Red: `permission-manager-unified.test.ts` cases for `check` covering `tool` and `path-values` intents.
   Commit: `feat(pi-permission-system): add ScopedPermissionManager.check(intent) (#478)`.
2. **Migrate manager callers to `check`; remove `checkPermission`/`checkPathPolicy`.**
   Switch resolver internals (`resolve`/`resolvePathPolicy`/raw `checkPermission` bodies), `permissions-service.ts`, `skill-prompt-sanitizer.ts`, `permission-event-rpc.ts` to `check`; remove the old pair from the interface + class; drop the old stubs from `makeFakePermissionManager`, `makeHandler`, and the inline dedup-test mocks; migrate `permission-manager-unified.test.ts`.
   One commit (interface removal breaks all manager mocks at the type level).
   Run `pnpm run check` immediately after.
   The resolver's **public** surface is unchanged here, so gates and resolver fixtures are untouched.
   Commit: `refactor(pi-permission-system): route all callers through manager.check (#478)`.
3. **Add resolver `resolveIntent(intent)` alongside the old pair; migrate gates incrementally.**
   Add `resolveIntent` to the interface + class (with `toResolvedIntent`); add a `resolveIntent` stub to `makeResolver`/`makeGateRunner`/`makePathDispatchResolver` alongside the existing `resolve`/`resolvePathPolicy`; add resolver-level tests for all three intent variants.
   Then migrate each gate + its tests to `resolveIntent`, one commit per gate: `path.ts`, `bash-command.ts` (+ the `tool-call-gate-pipeline` tool-resolve site + `runner.ts`), `bash-path.ts`, `external-directory-policy.ts` (+ external-directory test files).
   Commits: `feat(pi-permission-system): add resolver resolveIntent seam (#478)` then `refactor(pi-permission-system): emit AccessIntent from <gate> (#478)` per gate.
4. **Remove `resolve(surface,input)` + `resolvePathPolicy`; rename `resolveIntent` → `resolve`.**
   Drop the old pair from the interface + class + fixtures; rename `resolveIntent` to `resolve` across the migrated call sites and tests; migrate `permission-resolver.test.ts` to the final `resolve(intent)`.
   One commit (mechanical rename + final interface narrowing).
   Run `pnpm run check` immediately after.
   Commit: `refactor(pi-permission-system): narrow ScopedPermissionResolver to resolve(intent) (#478)`.
5. **Docs.**
   Update `architecture.md` (Step 6 ✅, surface metric, directory descriptions, access-intent listing) and the package `SKILL.md` fixture/testing notes.
   Commit: `docs(pi-permission-system): record resolve(intent) narrowing (#478)`.

If `/tdd-plan` judges the per-gate lift-and-shift heavier than an atomic resolver narrowing (only six production call sites), it may collapse steps 3–4 into a single atomic interface-change commit — the interface removal forces all consumers into one commit either way.

## Risks and Mitigations

- **Large interface-removal commits.**
  Both the manager (step 2) and resolver (step 4) removals break every typed mock at once.
  Mitigation: lift-and-shift the new method in first (steps 1, 3), grep `test/` for inline mocks before the removal commit, and run `pnpm run check` immediately after each removal.
- **Silent behavior change in the `tool`-intent branch.**
  The trimmed-vs-original tool-name distinction (`deriveSource` uses trimmed; the result reports original) must be preserved.
  Mitigation: keep `buildCheckResult(surface, values, extras, trimmedToolName, originalSurface, fullRules)` argument order; the manager-unified tests assert `source` and `toolName`.
- **`AccessPath` coupling creep.**
  Mitigation: the manager consumes `ResolvedAccessIntent` (no `AccessPath`); only the resolver imports `AccessPath`, via `toResolvedIntent`.
- **Reintroducing the [#393] false-green during migration.**
  Mitigation: the integration tests route through real instances; keep them green at every step.

## Open Questions

- Should the `path` surface match the canonical form like `external_directory`?
  Filed as [#486]; resolving it gates the bash-path → `AccessPath` migration.
- Adopt `AccessPath` as the universal internal path representation?
  Filed as [#487]; this step's `path-values` variant is the transitional accommodation that shrinks under that direction.

[#58]: https://github.com/gotgenes/pi-packages/issues/58
[#301]: https://github.com/gotgenes/pi-packages/issues/301
[#306]: https://github.com/gotgenes/pi-packages/issues/306
[#309]: https://github.com/gotgenes/pi-packages/issues/309
[#319]: https://github.com/gotgenes/pi-packages/issues/319
[#340]: https://github.com/gotgenes/pi-packages/issues/340
[#393]: https://github.com/gotgenes/pi-packages/issues/393
[#418]: https://github.com/gotgenes/pi-packages/issues/418
[#452]: https://github.com/gotgenes/pi-packages/issues/452
[#476]: https://github.com/gotgenes/pi-packages/issues/476
[#486]: https://github.com/gotgenes/pi-packages/issues/486
[#487]: https://github.com/gotgenes/pi-packages/issues/487
