---
status: accepted
date: 2026-06-30
---

# 0002 — Keep `path-values` as the manager's string boundary

## Status

Accepted.

## Context

Phase 7 Steps 1 and 2 ([#502], [#503]) routed every path-shaped surface onto the `AccessPath` value object: the per-tool path gate, the cross-cutting `path` and `external_directory` gates, and the service/RPC policy queries all emit an `access-path` `AccessIntent`.
The resolver unwraps that intent via `AccessPath.matchValues()` into a string-based `path-values` intent before the low-level manager evaluates rules.

This left the resolver as the **sole producer** of the `path-values` variant.
The [#487] vision ("adopt `AccessPath` as the universal internal path representation") listed "collapse the `path-values` variant" as a goal — but the residual variant is not transitional scaffolding.
It is the seam between the path-aware resolver and the deliberately string-based manager, so its fate is a design decision, not a mechanical cleanup.

### The three actors

The resolve path runs through three collaborators in a strict path-awareness gradient:

| Actor    | File                                | `AccessPath`-aware?                           | Job                                                         |
| -------- | ----------------------------------- | --------------------------------------------- | ----------------------------------------------------------- |
| Gate     | `src/handlers/gates/*.ts`           | Yes — builds it via `normalizer.forPath(...)` | Turn a tool call into an `AccessIntent`                     |
| Resolver | `src/policy/permission-resolver.ts` | Yes — calls `matchValues()`                   | Compose session rules; unwrap `access-path` → `path-values` |
| Manager  | `src/policy/permission-manager.ts`  | **No** — string-based                         | Evaluate `(surface, string[])` against the ruleset          |

### The type split is load-bearing

Two distinct discriminated unions encode the seam, with exactly one converter between them:

- `AccessIntent = ToolAccessIntent | AccessPathAccessIntent` — what a gate emits.
- `ResolvedAccessIntent = ToolAccessIntent | PathValuesAccessIntent` — what the manager consumes.

`PermissionResolver.toResolvedIntent` is the **only** function that converts `access-path` → `path-values`, calling `path.matchValues()` exactly once.
Its JSDoc already states the intent: "Tell-Don't-Ask: the resolver asks an `AccessPath` for its `matchValues()`, so the low-level manager never imports the value object." `PermissionManager.check` consumes `ResolvedAccessIntent` and has zero imports from `access-intent/access-path` — the manager's entire path contract is a `string[]` plus a surface name.

## Decision

**Formalize the boundary: keep `path-values` as the manager's intentional string seam.**

The invariant, stated as a three-part contract:

1. The resolver is the **sole** `matchValues()` unwrap site (`toResolvedIntent`), so the lexical ∪ canonical alias set ([#418]) is derived once, centrally.
2. The manager is **string-based**: `check()` consumes `ResolvedAccessIntent` (`tool | path-values`) and never imports `AccessPath`.
3. Path-awareness flows downward and **stops at the resolver** — the manager is a leaf with no `access-intent/access-path` dependency.

To keep the invariant from eroding silently, an ESLint `no-restricted-imports` rule scoped to `permission-manager.ts` forbids importing `access-intent/access-path`, mirroring the existing `process.platform` `no-restricted-syntax` guard ([#510]).
Collapsing the boundary would then require an explicit, reviewed lint exception rather than an unremarked import.

This decision is non-breaking: no runtime behavior changes, no public type changes, no config changes.

## Consequences

- The manager stays a string-matching leaf with a single responsibility — evaluate `(surface, string[])` against a ruleset — and no path semantics.
- `matchValues()` keeps a single call site, so the [#418] lexical ∪ canonical alias derivation stays central.
- The lint guard pins "the manager never imports `AccessPath`" deterministically, verified in CI via `pnpm run lint`.
- Phase 7 Step 5 ([#506]) is the last open step; with Steps 1–4 already shipped, this closes Phase 7.

## Alternatives considered

**Collapse the variant — move the `matchValues()` unwrap into the manager.**
The manager's `check()` would accept the `access-path` variant directly and call `matchValues()` itself, deleting `PathValuesAccessIntent` / `ResolvedAccessIntent` and importing `AccessPath`.
Rejected on three grounds:

- **Single responsibility.**
  The manager evaluates `(surface, string[])` against a ruleset — a complete, testable contract with no path semantics.
  Collapsing grows the engine a second concern (path representation) it currently delegates away.
- **Tell-Don't-Ask wash.**
  Collapse does not remove the `matchValues()` ask; it relocates the single unwrap one layer deeper, into the busier string-matching engine.
- **Dependency direction.**
  Collapse widens the manager (a leaf) with an `AccessPath` import to save one nominal type (`PathValuesAccessIntent`) and one converter — removing a real seam for a nominal gain.

The entire upside of collapse is one fewer named type and one fewer converter; the cost is the manager's lost string-engine invariant and a wider dependency surface.
By the "structural reasons before extracting" and ISP heuristics, that is the wrong trade.

[#418]: https://github.com/gotgenes/pi-packages/issues/418
[#487]: https://github.com/gotgenes/pi-packages/issues/487
[#502]: https://github.com/gotgenes/pi-packages/issues/502
[#503]: https://github.com/gotgenes/pi-packages/issues/503
[#506]: https://github.com/gotgenes/pi-packages/issues/506
[#510]: https://github.com/gotgenes/pi-packages/issues/510
