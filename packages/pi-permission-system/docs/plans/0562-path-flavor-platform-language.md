---
issue: 562
issue_title: "Leaf path modules re-derive the win32 path flavor from a raw platform parameter"
---

# PathFlavor: pass the platform's path language, not the raw discriminator

## Release Recommendation

**Release:** ship independently

This is Step 3 of the pi-permission-system Phase 10 roadmap, tagged `Release: independent` (a member of no batch).
It is a behavior-preserving refactor, so every implementation commit is `refactor:` (a hidden changelog type) — the work lands on `main` and auto-batches into the next `feat:`/`fix:` release rather than cutting one of its own (Refs [#479]).
The closing documentation commit touches only release-excluded paths (`docs/architecture`, `.pi/`), so it does not cut a release either.

## Problem Statement

The win32-vs-POSIX path flavor is re-derived from a raw `platform: NodeJS.Platform` parameter at 13 sites across the package.
Six leaf functions open with the identical `const impl = platform === "win32" ? winPath : posixPath` ternary; the win32 case fold (`toLowerCase()`), the separator pick, and the `{ caseInsensitive: true, windowsSeparators: true }` match-options literal are each independently re-derived at further sites.

The variant set is closed (win32 vs. POSIX), so the risk is not variant growth — it is **connascence of algorithm**: every site must re-derive the same mapping identically, and in a permission system a leaf that misses the case fold or separator fold is a silent bypass (the [#382]/[#508] bug class).
The [#505]/[#510] seam made the leaves pure platform-parameterized functions behind the `PathNormalizer` facade — it fixed *where the platform is read* but threaded the raw discriminator rather than the resolved product, so each leaf still re-interprets it.

## Goals

- Introduce `PathFlavor`, a value object that is the resolved product of the single `platform === "win32"` decision, and thread it into the leaves in place of the raw `platform` string.
- Make the [#382]/[#508] must-agree bug class **structurally impossible**: the case fold, the containment geometry, and the match-options each have exactly one implementation, owned by the flavor.
- Remove `NodeJS.Platform` from every domain signature: after this change, no `src/` module outside `index.ts` and the `PathFlavor` factory names `platform`.
- Preserve behavior exactly — identical decisions on every input, on both platforms.
  This is not a breaking change.
- Advance the roadmap's structural metrics: `platform === "win32"` sites 13 → 1; `caseInsensitive` derivations → 1; flat `src/` root 62 → 59 (three leaves relocate into `src/path/`).

## Non-Goals

- Unifying `subagent-context`'s bespoke prefix-containment onto `PathFlavor.isWithin`.
  That check (`isPathWithinDirectoryForSubagent`) uses a different algorithm than `path.relative`-based containment and diverges on `..` segments and cross-root paths, so collapsing it is **behavior-affecting**, not a pure refactor.
  Filed as a follow-up: [#571].
- Splitting a separate `BashDialect` collaborator out of the win32 flavor.
  Pi core guarantees bash-on-win32 is always Git Bash (no cmd/PowerShell branch in core's `shell.ts`), so the win32⇔MSYS pairing is fixed; a second object would be polymorphism over an axis that cannot vary independently.
  Track-and-watch: extract it only if core ever un-fixes the pairing (WSL, PowerShell).
- Any change to config, schema, the permission model, or user-facing docs — this is an internal structural refactor with no observable surface change.

## Background

The relevant modules and their current platform coupling:

- `src/path-normalizer.ts` — the facade constructed at the session edge with `(platform, cwd)`.
  Selects `this.impl` once, but also carries two `this.platform !== "win32"` guards in `forBashToken` / `interpretBashCdTarget` for Git Bash/MSYS semantics, and a `usesWindowsSeparators()` accessor.
- `src/access-intent/path-normalization.ts` — `normalizePathForComparison` (resolve + normalize + fold), `canonicalNormalizePathForComparison` (+ realpath + fold), `getPathPolicyValues` / `getAbsolutePathPolicyValues` / `getCwdRelativePathPolicyValues`.
  Called by `AccessPath.forPath`.
- `src/path-containment.ts` — `isPathWithinDirectory` (the `path.relative` containment geometry) and `isPathOutsideWorkingDirectory` (geometry + `isSafeSystemPath` exclusion).
- `src/canonicalize-path.ts` — `canonicalizePath` (best-effort `realpathSync` walk using `impl.parse`/`impl.sep`/`impl.join`).
- `src/pi-infrastructure-read.ts` — `isPiInfrastructureRead` (re-derives the win32 match-options literal, calls `isPathWithinDirectory`).
- `src/authority/subagent-context.ts` — `normalizeFilesystemPath` (normalize + fold) and `isSubagentExecutionContext`, plus a private prefix-containment helper.
- `src/rule.ts` — `pathMatchOptions` (re-derives the match-options literal, gated by `PATH_SURFACES`) and the `evaluate`/`evaluateFirst`/`evaluateAnyValue`/`evaluateMostRestrictive`/`ruleMatches` family, all threaded `platform`.
- `src/permission-manager.ts` — holds `this.platform`, relays it to the `rule.ts` family.
  Consumes `ResolvedAccessIntent` and **must not import `AccessPath`** (ADR-0002, enforced by a `no-restricted-imports` rule scoped to this file).
  `PathFlavor` is a plain value object, not `AccessPath`, so it is safe to consume here.
- `src/access-intent/bash/token-classification.ts` — `classifyTokenAsRuleCandidate` takes a `windowsSeparators` boolean derived from `PathNormalizer.usesWindowsSeparators()` by `bash-path-resolver.ts` ([#520]).
- `src/index.ts` — the sole `process.platform` reader (the ESLint `no-restricted-syntax` guard exempts only this file); threads `hostPlatform` into `PermissionManager`, `PermissionSession` (→ `PathNormalizer`), and `SubagentDetection`.

Constraints from AGENTS.md and the package skill that apply:

- Platform handling has a single home (`PathNormalizer`); no `src/` module reads `process.platform` (ESLint-guarded).
  `PathFlavor` becomes a second platform-semantics home, still fed exclusively from `index.ts`'s one read.
- To test Windows behavior on POSIX CI, inject a win32 flavor — never `vi.mock("node:path")`.
  The documented `new PathNormalizer("win32", cwd)` idiom becomes `new PathNormalizer(win32PathFlavor, cwd)`.
- `permission-manager.ts` stays string-based (ADR-0002); a `PathFlavor` import is allowed (the guard bans only `access-intent/access-path`).

## Design Overview

### The `PathFlavor` value object

`PathFlavor` is the platform's **path language** expressed as one object: syntax recognition, token semantics, and an equivalence relation — the three things the leaves currently re-derive.
It is pure (no filesystem access) and immutable; two cached singletons are selected by a factory that holds the package's one remaining `=== "win32"` comparison.

```typescript
// src/path/path-flavor.ts
import type { PlatformPath } from "node:path";
import type { BashTokenShape } from "#src/access-intent/bash/msys-bash-tokens";
import type { WildcardMatchOptions } from "#src/wildcard-matcher";

export interface PathFlavor {
  /** Node's own platform strategy (path.win32 | path.posix). Path-domain primitives use it directly. */
  readonly impl: PlatformPath;
  /** Win32 { caseInsensitive, windowsSeparators } | undefined — the match-options product for the wildcard engine. */
  readonly matchOptions: WildcardMatchOptions | undefined;
  /** Comparison case fold: win32 => value.toLowerCase(), posix => value. */
  fold(value: string): string;
  /** resolve + normalize + fold against a base — the #382 invariant's single home. */
  comparable(pathValue: string, base: string): string;
  /** path.relative-based containment geometry. */
  isWithin(pathValue: string, directory: string): boolean;
  /** True when the token contains a path separator under this platform (posix: "/"; win32: "/" or "\"). */
  hasPathSeparator(token: string): boolean;
  /** MSYS/Git-Bash token shape on win32; always { kind: "plain" } on posix. */
  bashTokenShape(token: string): BashTokenShape;
}

export const posixPathFlavor: PathFlavor;
export const win32PathFlavor: PathFlavor;

/** The one `platform === "win32"` decision in the package. */
export function pathFlavorForPlatform(platform: NodeJS.Platform): PathFlavor;
```

Ownership rule (prevents god-object drift): the flavor owns **platform semantics** (fold, geometry, token shape, match options, separator syntax).
**Domain policy** stays in the functions that consume it — the lexical cleanup in `normalizePathForComparison` (trim / strip quotes / strip `@` / `expandHome`), the alias generation in `getPathPolicyValues`, the `isSafeSystemPath` exclusion in `isPathOutsideWorkingDirectory`, the infra-read rules, and `rule.ts`'s `PATH_SURFACES`-gated dispatch.

`impl` is exposed rather than wrapped: post-migration its consumers are exclusively path-domain primitives, and `PlatformPath` is itself a strategy object Node maintains — wrapping it would add ~7 forwarding methods with no semantics.
The doc comment states the ownership rule; sealing it later (make it private, mirror the used methods) is a two-line change if it ever itches.

### How the flavor dissolves each site

`fold` / `comparable` / `matchOptions` collapse the equivalence family — the #382/#508 must-agree class.
A leaf can no longer re-derive-and-diverge because it never derives at all:

```typescript
// path-normalization.ts — after
export function normalizePathForComparison(pathValue: string, base: string, flavor: PathFlavor): string {
  const cleaned = lexicalCleanup(pathValue); // domain policy stays here
  return cleaned ? flavor.comparable(cleaned, base) : "";
}
```

`bashTokenShape` dissolves `PathNormalizer`'s two `!== "win32"` guards into uniform dispatch — the posix flavor returns `{ kind: "plain" }` (semantically correct: every posix token is an ordinary path), so the switch runs unchanged on both platforms:

```typescript
// path-normalizer.ts — after; no platform conditional remains
forBashToken(token: string, options?: { resolveBase?: string }): AccessPath {
  const shape = this.flavor.bashTokenShape(token);
  switch (shape.kind) {
    case "device":        return AccessPath.forDevice(token);
    case "drive-mount":   return this.forPath(shape.windowsPath, options);
    case "posix-absolute": { /* literal-only + backslash alias, unchanged */ }
    case "plain":         return this.forPath(token, options);
  }
}
```

`hasPathSeparator` dissolves the ask-leak in the bash rule-candidate classifier — the resolver stops asking `usesWindowsSeparators()` and relaying a boolean through an options bag:

```typescript
// token-classification.ts — after; the two includes() lines become one
if (token.startsWith(".")) return token;
if (flavor.hasPathSeparator(token)) return token; // was: includes("/") + (windowsSeparators && includes("\\"))
if (token.includes("..")) return token;
if (WINDOWS_DRIVE_PATH_PATTERN.test(token)) return token;
```

`PathNormalizer` exposes its flavor (`readonly flavor: PathFlavor`) so `bash-path-resolver.ts` passes `this.normalizer.flavor` to the classifier; `PathNormalizer.usesWindowsSeparators()` and `RuleCandidateOptions.windowsSeparators` are deleted.

### Construction and threading

`index.ts` performs the one `process.platform` read, resolves it into the flavor once, and injects that collaborator into the three holders — "instantiate the right collaborator as soon as we know the platform":

```typescript
// index.ts
const flavor = pathFlavorForPlatform(process.platform);
const permissionManager = new PermissionManager({ agentDir, flavor, isYoloEnabled });
const subagentDetection = new SubagentDetection({ subagentSessionsDir, flavor, registry });
// session ctor: new PermissionSession(..., flavor) -> new PathNormalizer(flavor, cwd)
```

`PathNormalizer` and `PermissionManager` hold `this.flavor` and drop their `platform` fields; `PermissionManager`'s constructor option becomes `flavor?: PathFlavor` (defaulting to `posixPathFlavor`, mirroring the old `platform ?? "linux"`); `SubagentDetection`'s dep becomes `flavor: PathFlavor`.

### Lift-and-shift bridge

Migrating a leaf's signature from `platform` to `PathFlavor` breaks its callers at the type level.
To keep every commit compiling and green, the migration is bottom-up: each leaf switches to `PathFlavor` first, and its not-yet-migrated callers bridge with an inline `pathFlavorForPlatform(platform)` at the call site.
Because `pathFlavorForPlatform` returns cached singletons, the bridge is cheap and cannot diverge — the transitional state is still bypass-safe.
The final threading step removes every inline bridge once the holders carry the flavor directly.

## Module-Level Changes

New:

- `src/path/path-flavor.ts` — the `PathFlavor` interface, `posixPathFlavor` / `win32PathFlavor` singletons, `pathFlavorForPlatform` factory.
- `test/path/path-flavor.test.ts` — unit tests for every capability, on both flavors.

Relocated into `src/path/` (tidy-first — these leaves reach their final home; three fewer files at the flat `src/` root, 62 → 59):

- `src/path-containment.ts` → `src/path/path-containment.ts`.
  Delete the standalone `isPathWithinDirectory` export (geometry moves onto `flavor.isWithin`); keep `isPathOutsideWorkingDirectory(canonicalPath, canonicalCwd, flavor)`.
- `src/canonicalize-path.ts` → `src/path/canonicalize-path.ts`; `platform` → `flavor` (`flavor.impl`).
- `src/pi-infrastructure-read.ts` → `src/path/pi-infrastructure-read.ts`; `platform` → `flavor` (`flavor.matchOptions`, `flavor.isWithin`); delete the re-derived match-options literal.
- Move each module's test to `test/path/` and update the `#src/...` import.

Edited (signature/body, no relocation):

- `src/access-intent/path-normalization.ts` — all five exports `platform` → `flavor`; `normalizePathForComparison` = lexical cleanup + `flavor.comparable`; `canonicalNormalizePathForComparison` = `flavor.comparable` + `canonicalizePath` + `flavor.fold`; `getCwdRelativePathPolicyValues` uses `flavor.impl.relative` + `flavor.isWithin`.
- `src/access-intent/access-path.ts` — `AccessPath.forPath` option `platform` → `flavor` (its only caller is `PathNormalizer.forPath`).
- `src/path-normalizer.ts` — constructor `platform` → `flavor`; hold `this.flavor`; expose `readonly flavor`; drop both `!== "win32"` guards via `flavor.bashTokenShape`; delete `usesWindowsSeparators()`; relay `this.flavor` to every leaf; import the relocated leaves from `#src/path/...`.
- `src/authority/subagent-context.ts` — `normalizeFilesystemPath` and `isSubagentExecutionContext` `platform` → `flavor` (`flavor.impl`, `flavor.fold`, `flavor.impl.sep`).
- `src/authority/subagent-detection.ts` — `SubagentDetectionDeps.platform` → `flavor: PathFlavor`.
- `src/rule.ts` — `pathMatchOptions(surface, flavor)` returns `PATH_SURFACES.has(surface) ? flavor.matchOptions : undefined`; `ruleMatches` / `evaluate` / `evaluateFirst` / `evaluateAnyValue` / `evaluateMostRestrictive` `platform` → `flavor`.
- `src/permission-manager.ts` — option `platform?` → `flavor?: PathFlavor` (default `posixPathFlavor`); hold `this.flavor`; relay to the `rule.ts` family.
  Import `#src/path/path-flavor` (allowed by the `no-restricted-imports` guard, which bans only `access-intent/access-path`).
- `src/permission-session.ts` — constructor `platform` → `flavor`; build `new PathNormalizer(flavor, "")` and rebuild on `activate`.
- `src/access-intent/bash/token-classification.ts` — `classifyTokenAsRuleCandidate(token, flavor)` via `flavor.hasPathSeparator`; delete `RuleCandidateOptions.windowsSeparators` (and the interface if it empties).
- `src/access-intent/bash/bash-path-resolver.ts` — pass `this.normalizer.flavor` to the classifier; drop the `usesWindowsSeparators()` read.
- `src/index.ts` — construct the flavor once; inject into `PermissionManager`, `PermissionSession`, `SubagentDetection`.
  `hostPlatform` stays only as the argument to `pathFlavorForPlatform`.

Verify `BashTokenShape` is exported from `src/access-intent/bash/msys-bash-tokens.ts` for `path-flavor.ts` to import (it holds the discriminated union `classifyWin32BashToken` returns); export it if it is currently local.

Test fixtures/harnesses:

- `test/helpers/session-fixtures.ts` — `makeRealSession`'s `platform?` override → `flavor?: PathFlavor` (or accept `platform` and map to `pathFlavorForPlatform` at the boundary); it builds a real `PermissionManager` + `PermissionSession`.
- `test/helpers/gate-fixtures.ts` — the `new PathNormalizer(process.platform, ...)` construction → `pathFlavorForPlatform(process.platform)`.
- Every `new PathNormalizer("win32"|"linux"|process.platform, cwd)` site (~30 across `test/`) → the corresponding singleton (`win32PathFlavor` / `posixPathFlavor`) or `pathFlavorForPlatform(process.platform)`.
- `test/rule.test.ts` (49 platform references) and the manager tests → flavor singletons.

Documentation (final commit; all release-excluded, so no release impact):

- `.pi/skills/package-pi-permission-system/SKILL.md` — rework the prose naming the removed/changed mechanisms: the leaf list ("every `path-containment` / `path-normalization` / `pi-infrastructure-read` / `canonicalize-path` / `rule.ts` / `subagent-context.ts` leaf takes an injected `platform` parameter"), the `usesWindowsSeparators()` reference in the bash `external_directory` note, and the "pass `platform: 'win32'`" test idiom → "pass `win32PathFlavor`".
  These are reworded-prose updates carrying no removed symbol, so grep the skill for each mechanism name.
- `packages/pi-permission-system/docs/architecture/architecture.md` — mark Step 3 complete (`✅` on the step heading and the `S3` Mermaid node); update the health-metric rows (`platform === "win32"` 13 → 1, flat `src/` root 62 → 59, `caseInsensitive` derivations → 1); refresh any module-layout listing or narrative that names the relocated files or the `platform` threading.
  `architecture.md` inline-copies the `rule.ts` `Rule`/`RuleOrigin`/`Ruleset` types — those are unchanged (only function signatures change), so that listing needs no edit; confirm during the pass.
- `packages/pi-permission-system/docs/decisions/0002-path-values-string-boundary.md` — confirm it stays accurate; the manager now consumes a `PathFlavor` but still not `AccessPath`, so the boundary holds.
  Add a clarifying sentence only if the ADR's wording implies the manager holds a raw `platform`.

## Test Impact Analysis

1. New unit tests the extraction enables (previously impractical): `path-flavor.test.ts` directly exercises `fold`, `comparable`, `isWithin`, `hasPathSeparator`, `bashTokenShape`, and `matchOptions` on both singletons — the win32 case/separator semantics that were previously only reachable transitively through `AccessPath` / gate tests now have a focused home.
2. Tests that become redundant: the win32-specific assertions scattered in `path-containment.test.ts` (containment geometry) and portions of `path-normalization.test.ts` (fold behavior) overlap with the new flavor tests.
   Keep them for now — they exercise the leaf functions' domain-policy wrapping (lexical cleanup, alias generation), not the flavor's raw geometry — but simplify any assertion that only re-checks the fold once `path-flavor.test.ts` owns it.
3. Tests that must stay as-is: the `PathNormalizer` win32 tests (`path-normalizer.test.ts`), the bash MSYS token tests (`msys-bash-tokens.test.ts`, `bash-external-directory.test.ts`), and the gate acceptance tests genuinely exercise the composed behavior (token shape → AccessPath → decision) and pin the [#533]/[#520] semantics end-to-end; they only swap their construction idiom to the flavor singleton.

## Invariants at risk

This change touches surfaces earlier phases refactored; each documented outcome must stay green:

- [#382]/[#508] — win32 case/separator fold on path-surface matching.
  Pinned by the win32 path-matching tests in `rule.test.ts` and `permission-manager-unified.test.ts` (`new PathNormalizer("win32", ...)`).
  The fold moving onto `flavor.fold`/`flavor.matchOptions` must not change any decision — these tests are the guard.
- [#533] — Git Bash/MSYS bash-token semantics (safe devices preserved, `/c/` mounts translated, other POSIX absolutes literal-only).
  Pinned by `bash-external-directory.test.ts` and `msys-bash-tokens.test.ts`; `bashTokenShape` dispatch must reproduce them exactly.
- [#520] — win32 backslash-relative token recognized as path-shaped.
  Pinned by the backslash-token cases in the bash path tests; `hasPathSeparator` replacing the `windowsSeparators` flag must keep the same classification.
- [#510]/[#505] — `PathNormalizer` is the single platform home fed from one `process.platform` read.
  Pinned by the ESLint `no-restricted-syntax` guard (still exempting only `index.ts`) and the `test/composition-root.test.ts` wiring tests.

No new test is needed — each invariant already lives in a test, not only prose.

## TDD Order

Every step below is behavior-preserving; each keeps the suite green and compiling.
Commit type is `refactor:` throughout (the closing docs commit is `docs:`), so nothing cuts a release on its own.
`pnpm fallow dead-code` is a final-state gate — the flavor's methods are consumed incrementally across steps 2–9 and are all live by step 8; do not expect a clean fallow run mid-sequence.

1. **Add `PathFlavor` (pure addition).**
   Red: `test/path/path-flavor.test.ts` asserts `fold` / `comparable` / `isWithin` / `hasPathSeparator` / `bashTokenShape` / `matchOptions` / `impl` on `win32PathFlavor` and `posixPathFlavor`, plus `pathFlavorForPlatform` selection.
   Green: implement `src/path/path-flavor.ts`; export `BashTokenShape` from `msys-bash-tokens.ts` if needed.
   `refactor(pi-permission-system): add PathFlavor value object`.
2. **Relocate + migrate `canonicalize-path`.**
   Move to `src/path/`, signature `platform` → `flavor`; bridge its one caller (`path-normalization`) inline; move its test; update importers.
   `refactor(pi-permission-system): thread PathFlavor through canonicalize-path`.
3. **Relocate + migrate `path-containment`; move geometry onto `flavor.isWithin`.**
   Delete standalone `isPathWithinDirectory`; migrate all callers (`path-normalization`, `pi-infrastructure-read`, `path-normalizer`) to `flavor.isWithin` (inline bridge where the holder still has `platform`); keep `isPathOutsideWorkingDirectory(..., flavor)`; move test.
   `refactor(pi-permission-system): move containment geometry onto PathFlavor`.
4. **Migrate `path-normalization` + `access-path.forPath`.**
   All five `path-normalization` exports → `flavor` (`comparable`/`fold`/`impl`); `AccessPath.forPath` option `platform` → `flavor`; bridge the caller (`PathNormalizer.forPath`); update `path-normalization` tests.
   `refactor(pi-permission-system): thread PathFlavor through path normalization`.
5. **Relocate + migrate `pi-infrastructure-read`.**
   Move to `src/path/`, `platform` → `flavor` (`matchOptions`, `isWithin`); delete the re-derived match-options literal; bridge the caller; move test.
   `refactor(pi-permission-system): thread PathFlavor through infrastructure-read`.
6. **Migrate `subagent-context` + `subagent-detection`.**
   Leaves → `flavor` (`impl`, `fold`, `impl.sep`); `SubagentDetectionDeps.platform` → `flavor`; bridge `index.ts`'s construction inline; update subagent tests.
   `refactor(pi-permission-system): thread PathFlavor through subagent detection`.
7. **Migrate `rule.ts` + `permission-manager`.**
   `pathMatchOptions` and the `evaluate` family `platform` → `flavor`; manager option `platform?` → `flavor?` (default `posixPathFlavor`); migrate `rule.test.ts` (49 sites) and the manager tests to the singletons via a lift-and-shift within the step.
   `refactor(pi-permission-system): thread PathFlavor through rule evaluation`.
8. **Thread the flavor from `index.ts`; dissolve `PathNormalizer`'s platform conditionals.**
   `index.ts` constructs the flavor once and injects it into `PermissionManager` / `PermissionSession` / `SubagentDetection`; `PermissionSession` + `PathNormalizer` constructors `platform` → `flavor`; `PathNormalizer` exposes `readonly flavor`, drops both `!== "win32"` guards via `bashTokenShape`; remove every inline `pathFlavorForPlatform(platform)` bridge from steps 2–7; update all ~30 `PathNormalizer` test constructors, `session-fixtures`, `gate-fixtures`, and `composition-root.test.ts`.
   `refactor(pi-permission-system): inject PathFlavor from the composition root`.
9. **Migrate the bash rule-candidate classifier; delete `usesWindowsSeparators`.**
   `classifyTokenAsRuleCandidate(token, flavor)` via `flavor.hasPathSeparator`; `bash-path-resolver` passes `this.normalizer.flavor`; delete `usesWindowsSeparators()` and `RuleCandidateOptions.windowsSeparators`; update classifier + resolver tests.
   `refactor(pi-permission-system): answer path-separator syntax on PathFlavor`.
10. **Documentation.**
    Update the package skill's reworded prose and the architecture roadmap (Step 3 `✅` + Mermaid node + health metrics); confirm ADR-0002 accuracy.
    `docs(pi-permission-system): record PathFlavor and complete roadmap Step 3`.

## Risks and Mitigations

- **Silent decision drift (the exact bug class this fixes).**
  Mitigation: behavior-preserving throughout, guarded by the [#382]/[#508]/[#533]/[#520] invariant tests listed above; each step keeps the suite green before committing.
- **Large mechanical test migration (`rule.test.ts`, ~30 `PathNormalizer` constructors).**
  Mitigation: lift-and-shift with the cached-singleton bridge so no step rewrites a whole test file at once; the singleton swap is a construction-idiom change, not a behavior change.
- **Transitional dead code failing a mid-sequence `fallow` run.**
  Mitigation: treat fallow as a final-state gate (documented above); the pre-completion reviewer runs it once at the end when every flavor method is live.
- **Intermediary inline `pathFlavorForPlatform(platform)` bridges left behind.**
  Mitigation: step 8 explicitly removes every bridge; a grep for `pathFlavorForPlatform(` outside `index.ts`, the factory, and tests must return nothing at the end.
- **`permission-manager.ts` accidentally importing `AccessPath` while adding the `PathFlavor` import.**
  Mitigation: the `no-restricted-imports` rule already bans it; `PathFlavor` lives in `src/path/`, a different module, so the guard is untouched.

## Open Questions

- None blocking.
  The `subagent-context` containment unification is deferred by design to [#571]; the `BashDialect` split is track-and-watch (Non-Goals).

[#382]: https://github.com/gotgenes/pi-packages/issues/382
[#479]: https://github.com/gotgenes/pi-packages/issues/479
[#505]: https://github.com/gotgenes/pi-packages/issues/505
[#508]: https://github.com/gotgenes/pi-packages/issues/508
[#510]: https://github.com/gotgenes/pi-packages/issues/510
[#520]: https://github.com/gotgenes/pi-packages/issues/520
[#533]: https://github.com/gotgenes/pi-packages/issues/533
[#571]: https://github.com/gotgenes/pi-packages/issues/571
