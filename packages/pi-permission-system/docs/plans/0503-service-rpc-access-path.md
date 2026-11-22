---
issue: 503
issue_title: "pi-permission-system: migrate the service/RPC path queries onto AccessPath (Phase 7 Step 2)"
---

# Migrate the service/RPC path queries onto `AccessPath`

## Release Recommendation

**Release:** mid-batch — defer (batch "symlink-resistant-path-matching"); confirm at ship time

This is Phase 7 Step 2 of the [#487] roadmap.
The architecture's `Release batches` subsection puts Steps 1, 2, 3 in the breaking batch "symlink-resistant-path-matching", with the **tail at Step 3** ([#504]).
This issue is Step 2, not the tail, so its breaking `feat!:` commits land on `main` and auto-batch; the major-bump release cuts when Step 3 lands.
Confirm the deferral at ship time.

## Problem Statement

External callers query our policy two ways: the `Symbol.for()` service (`LocalPermissionsService.checkPermission`) and the deprecated event-bus RPC (`permissions:rpc:check`).
Both build a query input with `buildInputForSurface` and resolve a `kind: "tool"` intent, which the manager normalizes **lexically only** via `normalizeInput` → `normalizePathSurfaceValues` → `getPathPolicyValues`.
So an external caller asking "would this path be allowed?" for `path` / `external_directory` / a path-bearing surface gets lexical-only matching — inconsistent with the gates, which match the lexical aliases ∪ canonical (symlink-resolved) set after [#486] and Phase 7 Step 1 ([#502]).
A query for a symlinked path therefore misses a rule that fires on the canonical alias at the gate.

This is the second of the two residual lexical-only path-derivation paths Phase 7 closes (Step 1 closed the per-tool gate).
Route the service/RPC path queries through `AccessPath` and the resolver so external policy queries match the same set the gates do.

## Goals

- For `path` / `external_directory` / path-bearing surface queries (the `PATH_SURFACES` set) with a non-empty value, build an `AccessPath` from the value and emit a `kind: "access-path"` intent, so external policy queries match the lexical aliases ∪ canonical form — at parity with the gates.
- Route both the service and RPC check paths through the **resolver** (`resolve(intent)`), which already unwraps `access-path` → `path-values` via `matchValues()`, keeping the manager string-based.
  This makes the resolver the sole `path-values` producer, the premise Phase 7 Step 5 ([#506]) decides the boundary against.
- Keep non-path surfaces (bash, skill, mcp, extension tools) and value-less surface-level queries on the existing `kind: "tool"` intent — `["*"]` fallback preserved.
- Narrow the service and RPC collaborators: the resolver subsumes the manager + `SessionRules` pair (it composes the session ruleset internally), so each consumer holds one resolution collaborator plus the session's `PathNormalizer`.

This is a **breaking change** for external consumers: a service/RPC path query now resolves against the canonical alias too.
Two observable shifts on upgrade with no caller edit:

1. An `external_directory` query for a symlinked path now matches a rule on its canonical target where it previously matched lexically only.
2. A `path` or path-bearing-tool query (`read` / `write` / `edit` / `grep` / `find` / `ls`) now evaluates the supplied path instead of collapsing to `["*"]` — see Background (latent gap).

The behavior commits are `feat(pi-permission-system)!:` with a `BREAKING CHANGE:` footer.

## Non-Goals

- No removal of `input-normalizer`'s `normalizePathSurfaceValues` / special-surface / `PATH_BEARING_TOOLS` branches — that is Phase 7 Step 3 ([#504]), after Steps 1 and 2 strip their last gate/service/RPC callers.
  This plan leaves `normalizeInput` intact; the per-tool gate's missing-path case still routes through it for the `["*"]` fallback.
- No decision on the `path-values` boundary (formalize the string seam vs. move the unwrap into the manager) — that is Phase 7 Step 5 ([#506]).
  This plan only advances its premise (resolver = sole producer).
- No change to the RPC **prompt** handler (`permissions:rpc:prompt`) — it shows a dialog and never resolves policy.
- No change to `path-utils.ts` derivation consolidation — that is Phase 7 Step 4 ([#505]).
- No change to dedup/approval-key identity or principal identity on `AccessIntent`.

## Background

Relevant modules (all in `packages/pi-permission-system/`):

- `src/permissions-service.ts` — `LocalPermissionsService.checkPermission(surface, value, agentName)` builds `buildInputForSurface(surface, value)` and calls `permissionManager.check({ kind: "tool", surface, input, agentName }, sessionRules.getRuleset())`.
  `getToolPermission` delegates to `permissionManager.getToolPermission`.
  Constructed in `index.ts` with `(permissionManager, sessionRules, formatterRegistry, accessExtractorRegistry)` (narrowed in [#366]).
- `src/permission-event-rpc.ts` — `handleCheckRpc` builds `buildInputForSurface(surface, value)` and calls `deps.permissionManager.check({ kind: "tool", ... }, deps.sessionRules.getRuleset())`.
  The deprecated channel (`/* eslint-disable @typescript-eslint/no-deprecated */` at the top).
  `handlePromptRpc` uses `value` only for the UI prompt display; it never resolves policy.
- `src/input-normalizer.ts` — `buildInputForSurface(surface, value)` is the inverse of `normalizeInput`: it builds the minimal `tool`-intent input from a `(surface, value)` pair.
  It maps `bash` → `{ command }`, `skill` → `{ name }`, `external_directory` → `{ path }`, and **everything else (including `path` and the path-bearing tools) → `{}`** — so the value is dropped for those surfaces.
- `src/permission-resolver.ts` — `PermissionResolver.resolve(intent: AccessIntent)` reduces a gate-emitted intent to the manager's `ResolvedAccessIntent`, unwrapping `access-path` → `path-values` via `path.matchValues()`, and composes `sessionRules.getRuleset()` internally so callers never thread it.
  Also exposes `getToolPermission`, `getConfigIssues`, `checkPermission` (the no-session-rules skill path).
  Constructed in `index.ts` as `new PermissionResolver(permissionManager, sessionRules)` — **after** the service and RPC today (line ~177 vs. ~145 / ~137); the move-up is mechanical (it depends only on `permissionManager` + `sessionRules`).
- `src/permission-session.ts` — `getPathNormalizer(): PathNormalizer` returns the session's normalizer, rebuilt on each `activate(ctx)` / `resetForNewSession` so it tracks the active cwd.
  A placeholder (`new PathNormalizer(platform, "")`) until the first `activate` binds the real cwd.
- `src/path-normalizer.ts` — `PathNormalizer.forPath(value)` builds an `AccessPath` resolved against the baked session `cwd` + `platform`.
- `src/access-intent/access-intent.ts` — `AccessPathAccessIntent` (`kind: "access-path"`); its doc comment names the gate emitters (the `path`/`external_directory`/per-tool surfaces).
- `src/path-utils.ts` — `PATH_SURFACES = PATH_BEARING_TOOLS ∪ { "external_directory", "path" }`.
- `src/value-guards.ts` — `getNonEmptyString(value): string | null` (trims; `null` for empty/whitespace).

### Latent gap this fixes

Because `buildInputForSurface` only wires the value into `external_directory` (returns `{ path }`) and the catch-all `{}` for `path` and the path-bearing tools, a service/RPC query like `checkPermission("read", "/etc/passwd")` today normalizes to `["*"]` — the supplied path is **silently dropped** (asserted today by `test/service.test.ts`: `checkPermission("read", "/tmp/file")` → input `{}`).
So in practice the only meaningful path query was `external_directory`.
Building an `AccessPath` for the whole `PATH_SURFACES` set fixes this drop as a natural consequence — `path` and path-bearing queries now evaluate the supplied path.
This is part of the breaking surface and is documented as such.

### Constraints (AGENTS.md / SKILL)

- The manager stays string-based and never imports `AccessPath`; the resolver does the `matchValues()` unwrap.
  This plan preserves that — the service/RPC emit `access-path` to the resolver, the resolver unwraps, the manager is untouched.
- Default to least privilege: the change only widens the match set (more rules can fire), never loosens — no `ask`/`deny` becomes `allow`.

## Design Overview

### Routing decision: through the resolver, not a second `path-values` producer

The manager's `check` accepts only `ResolvedAccessIntent` (`tool | path-values`); it cannot consume an `access-path` intent.
Two ways to give the service/RPC canonical parity:

1. Have the service/RPC build the `AccessPath`, call `matchValues()` themselves, and pass a `path-values` intent to `manager.check`.
2. Have the service/RPC emit an `access-path` intent to `resolver.resolve`, which unwraps it.

Option 1 makes the service/RPC a **second** `path-values` producer, contradicting the premise Phase 7 Step 5 ([#506]) decides against ("with the resolver the sole `path-values` producer after Steps 1 and 2").
Option 2 is chosen: it routes both consumers through the resolver — the single unwrap site — and is a clean 1:1 substitution for today's `manager.check(..., sessionRules.getRuleset())`, since `resolver.resolve` does exactly that plus the unwrap.

### Shared intent builder (`input-normalizer.ts`)

Add `buildAccessIntentForSurface`, the surface→intent mapping shared by the service and RPC.
It builds an `access-path` intent for a `PATH_SURFACES` surface carrying a non-empty value, and a `tool` intent (via the existing `buildInputForSurface`) otherwise:

```typescript
import type { AccessIntent } from "./access-intent/access-intent";
import type { PathNormalizer } from "./path-normalizer";
import { PATH_SURFACES } from "./path-utils";
import { getNonEmptyString } from "./value-guards";

export function buildAccessIntentForSurface(
  surface: string,
  value: string | undefined,
  normalizer: PathNormalizer,
  agentName: string | undefined,
): AccessIntent {
  const pathValue = getNonEmptyString(value);
  if (pathValue !== null && PATH_SURFACES.has(surface)) {
    return { kind: "access-path", surface, path: normalizer.forPath(pathValue), agentName };
  }
  return { kind: "tool", surface, input: buildInputForSurface(surface, value), agentName };
}
```

`buildInputForSurface` stays exported (still used here for the `tool` branch, and imported by `test/service.test.ts`).
No import cycle: `path-normalizer.ts` and `access-intent/access-intent.ts` do not import `input-normalizer.ts`; `PathNormalizer` / `AccessIntent` are `import type`.

The `getNonEmptyString` guard preserves the value-less surface-level query (`checkPermission("path")` → `tool` → `["*"]`) and the whitespace-only case, matching today's `normalizePathSurfaceValues` `["*"]` fallback.

### Service (`permissions-service.ts`)

Swap the `(permissionManager, sessionRules)` pair for a single resolver plus the session's `PathNormalizer` provider:

```typescript
interface ResolverForService {
  resolve(intent: AccessIntent): PermissionCheckResult;
  getToolPermission(toolName: string, agentName?: string): PermissionState;
}
interface PathNormalizerProvider {
  getPathNormalizer(): PathNormalizer;
}

export class LocalPermissionsService implements PermissionsService {
  constructor(
    private readonly resolver: ResolverForService,
    private readonly session: PathNormalizerProvider,
    private readonly formatterRegistry: ToolInputFormatterRegistrar,
    private readonly accessExtractorRegistry: ToolAccessExtractorRegistrar,
  ) {}

  checkPermission(surface, value, agentName) {
    const intent = buildAccessIntentForSurface(
      surface, value, this.session.getPathNormalizer(), agentName,
    );
    return this.resolver.resolve(intent);
  }

  getToolPermission(toolName, agentName) {
    return this.resolver.getToolPermission(toolName, agentName);
  }
  // registerToolInputFormatter / registerToolAccessExtractor unchanged
}
```

`PermissionResolver` satisfies `ResolverForService`; `PermissionSession` satisfies `PathNormalizerProvider`.
`getPathNormalizer()` is fetched **per call** (the normalizer rebinds on cwd change), and the published service always answers against the parent session's cwd (a child never publishes, [#302]).
The service holds one resolution collaborator — narrower than today's manager + `SessionRules`, keeping the [#366] narrowing intent (4 fields → 4 fields, but the resolution surface collapses to one).

### RPC (`permission-event-rpc.ts`)

`PermissionRpcDeps` drops `permissionManager` and `sessionRules`, gains `resolver`, and extends the narrow `session` view with `getPathNormalizer`:

```typescript
export interface PermissionRpcDeps {
  resolver: Pick<ScopedPermissionResolver, "resolve">;
  session: {
    getRuntimeContext(): ExtensionContext | null;
    getPathNormalizer(): PathNormalizer;
  };
  requestPermissionDecisionFromUi(/* … */): Promise<PermissionPromptDecision>;
  logger: ReviewLogger;
}
```

`handleCheckRpc` builds the intent and resolves:

```typescript
const intent = buildAccessIntentForSurface(
  surface, value, deps.session.getPathNormalizer(), agentName ?? undefined,
);
const result = deps.resolver.resolve(intent);
```

The reply shape (`result.state` / `matchedPattern` / `origin`) is unchanged.
`handlePromptRpc` is untouched (it uses neither collaborator).

### Composition root (`index.ts`)

- Move `const resolver = new PermissionResolver(permissionManager, sessionRules);` up to before `registerPermissionRpcHandlers` (the only ordering change; downstream consumers reference the same const).
- RPC deps: `{ resolver, session, requestPermissionDecisionFromUi, logger }` (the full `PermissionSession` satisfies both narrow `session` needs).
- `new LocalPermissionsService(resolver, session, formatterRegistry, accessExtractorRegistry)`.

### Call-site interaction sketch (Law of Demeter / Tell-Don't-Ask)

The service hands the normalizer to the builder rather than reaching through it:

```typescript
const normalizer = this.session.getPathNormalizer(); // a.b() — the documented session accessor
const intent = buildAccessIntentForSurface(surface, value, normalizer, agentName);
return this.resolver.resolve(intent); // resolver owns the unwrap + session-rule composition
```

`forPath` is invoked inside the builder, not by the service — no `session.getPathNormalizer().forPath(...)` chain at the consumer.
This mirrors the gate pipeline's established `inputs.getPathNormalizer()` → builder convention.

### Edge cases

- **Value-less / whitespace-only path query:** `getNonEmptyString` → `null` → `tool` intent → `["*"]` (preserved).
- **Non-path surface (bash/skill/mcp/extension):** `tool` intent via `buildInputForSurface` (unchanged).
- **Not a symlink:** `matchValues()` collapses to the lexical aliases — no spurious extra value.
- **Unresolvable path (ELOOP / EACCES):** `AccessPath`'s canonical step falls back to the lexical form — no new match beyond today's lexical behavior.
- **Child session:** never publishes the service; the parent's normalizer answers external queries.

## Module-Level Changes

Source:

- `src/input-normalizer.ts` — add `buildAccessIntentForSurface` (path-surface → `access-path`, else `tool`); keep `buildInputForSurface` exported as the `tool`-branch input builder.
  Add imports: `PATH_SURFACES` (`#src/path-utils`), `getNonEmptyString` is already imported, type imports `AccessIntent` (`#src/access-intent/access-intent`) and `PathNormalizer` (`#src/path-normalizer`).
- `src/permissions-service.ts` — constructor takes `(resolver, session, formatterRegistry, accessExtractorRegistry)`; `checkPermission` builds the intent via `buildAccessIntentForSurface` and calls `resolver.resolve`; `getToolPermission` delegates to `resolver.getToolPermission`.
  Define local `ResolverForService` + `PathNormalizerProvider` interfaces; drop the `ScopedPermissionManager` / `SessionRules` / `buildInputForSurface` imports, add `buildAccessIntentForSurface`, `AccessIntent`, `PathNormalizer`, `PermissionState` type imports.
- `src/permission-event-rpc.ts` — `PermissionRpcDeps` drops `permissionManager` + `sessionRules`, adds `resolver: Pick<ScopedPermissionResolver, "resolve">`, extends `session` with `getPathNormalizer`; `handleCheckRpc` builds the intent and calls `deps.resolver.resolve`.
  Swap the `ScopedPermissionManager` import for `ScopedPermissionResolver`, drop `buildInputForSurface`, add `buildAccessIntentForSurface` and a `PathNormalizer` type import.
- `src/index.ts` — move the `resolver` construction above the RPC registration; pass `resolver` + `session` into the RPC deps and `LocalPermissionsService`.
- `src/access-intent/access-intent.ts` — update the `AccessPathAccessIntent` doc comment: emitters now also include the service/RPC path queries (not only the gates).

Tests:

- `test/input-normalizer.test.ts` — add a `buildAccessIntentForSurface` describe: a `PATH_SURFACES` surface (`path`, `external_directory`, `read`) with a value emits `access-path` whose `path.matchValues()` carries the canonical alias (use the `node:fs` `realpathSync` mock convention from `path.test.ts` for the symlink case); a non-path surface (`bash`) emits `tool` with `buildInputForSurface` input; an empty/whitespace value on a path surface emits `tool` (`["*"]` path via the manager).
- `test/permissions-service.test.ts` — rewrite to inject a fake resolver (`resolve` + `getToolPermission` stubs) and a real `PathNormalizer` provider; assert `checkPermission("bash", "echo hi")` calls `resolver.resolve` with a `tool` intent; `checkPermission("external_directory", "/sym/link")` and `checkPermission("read", "/p")` call it with an `access-path` intent whose `path` matches the expected lexical ∪ canonical set; a value-less path query falls to `tool`; `getToolPermission` delegates to `resolver.getToolPermission`.
  Drop the `vi.mock("#src/input-normalizer")` `buildInputForSurface` stub.
- `test/permission-event-rpc.test.ts` — `makeDeps` swaps `permissionManager` + `sessionRules` for `resolver: { resolve: vi.fn() }` and adds `session.getPathNormalizer`; the existing allow/deny check-RPC tests assert on `resolver.resolve` instead of `permissionManager.check`; add a path-surface RPC test asserting an `access-path` intent reaches the resolver (canonical alias in the match set).
- `test/service.test.ts` — update the "service adapter delegation" describe: replace the hand-rolled `buildInputForSurface` adapter (which simulated the **old** `index.ts` wiring) with the current `buildAccessIntentForSurface` + resolver pattern, so the round-trip tests document the new wiring; the stale `checkPermission("read", "/tmp/file") → {}` assertion is replaced by an `access-path`-intent assertion.
- `test/composition-root.test.ts` — the existing `checkPermission("demo")` queries (non-path) stay green through the new wiring; add a path-surface service query (`checkPermission("path", <symlink>)`) asserting canonical matching end-to-end via the real factory (the harness fires `session_start`, so `getPathNormalizer()` is cwd-bound).

Documentation (grep-verified — symbol/behavior named in prose):

- `docs/architecture/architecture.md` — mark Phase 7 Step 2 ([#503]) complete (`✅` on the step heading ~line 801 and the `S2` Mermaid node ~line 835); update the `permissions-service.ts` entry (~line 716) and `permission-event-rpc.ts` entry (~line 720) to note they route path-surface queries through the resolver as `access-path`; rewrite the Phase-7 intro framing (~line 768, "Two ad-hoc path-derivation paths remain") and the residual "Service/RPC queries" bullet (~line 788) to past tense now both access-side parity migrations (Steps 1 and 2) have landed.
  Leave the health-metric/target table (~line 778) unchanged (it describes the phase endpoint, not a per-step state — per the [#502] precedent).
- `docs/cross-extension-api.md` — the `checkPermission` section (~lines 81–94) and the RPC `permissions:rpc:check` section (~line 444): add that `path` / `external_directory` / path-bearing path values now match the canonical (symlink-resolved) form, at parity with the gates, and that a path-bearing-surface query now evaluates the supplied path (previously collapsed to `*`).
- `.pi/skills/package-pi-permission-system/SKILL.md` — update the `LocalPermissionsService` note (~line 118) to record that path-surface service/RPC queries route through the resolver as `access-path` (canonical parity), fetching the session `PathNormalizer` per call.

README is not updated: it documents config surfaces, not the `getPermissionsService` query API, and already describes symlink-resistant `path`/per-tool matching.

## Test Impact Analysis

1. **New tests the change enables:**
   - `buildAccessIntentForSurface` as a directly unit-testable surface→intent mapping (no manager round-trip needed) — the symlink-canonical match set is asserted on the built `AccessPath`.
   - A service/RPC path query whose canonical alias matches a `deny` (e.g. `external_directory` reached via a symlink) — assertable with a fake resolver dispatching on `intent.kind` / `intent.surface`.
   - A `read`/`path` query now evaluates the supplied path (the latent-gap fix), replacing the old `→ {}` drop assertion.
2. **Tests that become redundant:** the `test/service.test.ts` hand-rolled-adapter tests that simulated the old `buildInputForSurface` index.ts wiring lose their reason to exist as wiring docs — folded into the rewritten "service adapter delegation" block (current wiring) and `permissions-service.test.ts` (real class).
   No test is deleted outright.
3. **Tests that must stay as-is:** the existing `permission-event-rpc.test.ts` reply-shape / error-path / prompt-RPC tests (they exercise the envelope and the untouched prompt handler); the `normalizeInput` / `buildInputForSurface` tests in `input-normalizer.test.ts` (the `tool`-branch path is unchanged); `permission-resolver.test.ts` (the unwrap site, now load-bearing for two more consumers).

## Invariants at risk

This change touches surfaces [#478], [#486], and [#366] refactored.

- **[#486] / [#478] — the resolver is the sole `path-values` producer; the manager stays string-based and never imports `AccessPath`.**
  Preserved and advanced: the service/RPC now emit `access-path` to the resolver (not `path-values` to the manager).
  Pinned by `test/permission-resolver.test.ts` (the unwrap) plus the new service/RPC tests asserting an `access-path` (not `path-values`) intent reaches `resolve`.
- **[#478] — manager/resolver each expose a single resolution method.**
  Preserved: no new resolution method; the service routes through `resolve` / `getToolPermission`.
- **[#366] — narrow service collaborators.**
  Preserved/advanced: the resolution surface collapses from manager + `SessionRules` to one resolver.
  Pinned by `test/permissions-service.test.ts`.
- **Value-less / missing-path `["*"]` fallback.**
  Preserved by the `getNonEmptyString` guard routing value-less path queries through the `tool` intent.
  Pinned by a `buildAccessIntentForSurface` test and a service value-less-query test.

No [#438] session-approval invariant is at risk: the service/RPC are query-only (no prompting / approval-pattern derivation).

## TDD Order

1. **`feat(pi-permission-system)!: match the canonical form on service path queries`** Test surface: `test/input-normalizer.test.ts` + `test/permissions-service.test.ts` + `test/service.test.ts` + `test/composition-root.test.ts`.
   Add `buildAccessIntentForSurface` to `input-normalizer.ts`; migrate `LocalPermissionsService` onto `(resolver, session, …)` using it; move the `resolver` construction up in `index.ts` and change the `LocalPermissionsService` call site.
   The helper's first consumer is the service, so it lands non-dead.
   The constructor change has a single production call site (`index.ts`), so the class change + call-site update land together.
   Red: a service `external_directory` query for a symlinked path now matches a `deny` on its canonical target; a `read` query now evaluates the supplied path (not `*`); the bash/non-path queries stay on `tool`.
   Breaking — `feat!:` with a `BREAKING CHANGE:` footer (service path queries now match canonical; path-bearing queries now evaluate the path).
   Run `pnpm run check` after this commit (constructor + interface change).
   The RPC still uses its old `{ permissionManager, sessionRules, … }` deps here — a valid green state.

2. **`feat(pi-permission-system)!: match the canonical form on the RPC check query`** Test surface: `test/permission-event-rpc.test.ts`.
   Change `PermissionRpcDeps` (drop `permissionManager` + `sessionRules`, add `resolver`, extend `session` with `getPathNormalizer`); migrate `handleCheckRpc` onto `buildAccessIntentForSurface` + `resolver.resolve`; update the RPC deps in `index.ts` (the `resolver` is already constructed above from Step 1).
   The deps change + `makeDeps` fixture + `index.ts` call site break together (one commit).
   Red: a `permissions:rpc:check` query for a symlinked `external_directory` path now matches the canonical alias; allow/deny/reply-shape tests stay green against the resolver.
   Breaking — `feat!:` with a `BREAKING CHANGE:` footer (RPC check now matches canonical).

3. **`docs(pi-permission-system): document canonical service/RPC path matching`** Update `docs/architecture/architecture.md` (mark Step 2 ✅ + `S2` node; `permissions-service.ts` / `permission-event-rpc.ts` entries; intro framing + residual bullet to past tense), `docs/cross-extension-api.md` (checkPermission + RPC-check canonical note + path-bearing-query fix), `.pi/skills/package-pi-permission-system/SKILL.md`, and the `access-intent.ts` doc comment per Module-Level Changes.
   No release impact on its own — rides the breaking `feat!:` commits.

## Risks and Mitigations

- **Risk: the resolver-injection rewiring is broader than "swap the intent."**
  Mitigation: it is a clean 1:1 substitution — `resolver.resolve(intent)` does exactly what `manager.check(toResolvedIntent(intent), sessionRules.getRuleset())` did, plus the `access-path` unwrap; the resolver subsumes the dropped `SessionRules` dependency.
  The only ordering change is moving one `const resolver = …` up, with no new dependency for the resolver.
- **Risk: the published service answers against the wrong cwd.**
  Mitigation: `getPathNormalizer()` is fetched per call and the service is published only by the parent ([#302]); a `composition-root.test.ts` path query exercises the cwd-bound normalizer after `session_start`.
- **Risk: the latent path-bearing-query fix surprises a consumer relying on the old `*` collapse.**
  Mitigation: this is the intended breaking behavior; documented in the `BREAKING CHANGE:` footer, the cross-extension API doc, and the close comment.
  The change only widens the match set (least-privilege preserving).
- **Risk: an import cycle from `input-normalizer.ts` importing `PathNormalizer` / `AccessIntent`.**
  Mitigation: both are `import type`, and neither `path-normalizer.ts` nor `access-intent/access-intent.ts` imports `input-normalizer.ts`; `pnpm run check` confirms.
- **Risk: a stale fallow suppression surfaces (as in [#502]).**
  Mitigation: run `pnpm fallow dead-code` after the source steps; the baseline check/lint/test triad does not catch a now-stale suppression.

## Open Questions

- None blocking.
  Step 3 ([#504]) removes the now-callerless `input-normalizer` path branches; Step 5 ([#506]) decides the `path-values` boundary — both already filed, both unblocked by this work.
  No new follow-up issue is needed (the latent path-bearing-query gap is fixed inline, not deferred).

[#302]: https://github.com/gotgenes/pi-packages/issues/302
[#366]: https://github.com/gotgenes/pi-packages/issues/366
[#438]: https://github.com/gotgenes/pi-packages/issues/438
[#478]: https://github.com/gotgenes/pi-packages/issues/478
[#486]: https://github.com/gotgenes/pi-packages/issues/486
[#487]: https://github.com/gotgenes/pi-packages/issues/487
[#502]: https://github.com/gotgenes/pi-packages/issues/502
[#504]: https://github.com/gotgenes/pi-packages/issues/504
[#505]: https://github.com/gotgenes/pi-packages/issues/505
[#506]: https://github.com/gotgenes/pi-packages/issues/506
