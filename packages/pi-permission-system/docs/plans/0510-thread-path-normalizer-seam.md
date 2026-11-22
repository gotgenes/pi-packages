---
issue: 510
issue_title: "Thread an injected platform/path-semantics seam through the bash path pipeline"
---

# Thread a PathNormalizer collaborator through the bash path pipeline

## Release Recommendation

**Release:** ship independently

This issue is not part of a named roadmap batch.
It is a behavior-preserving `refactor:`, so it does not cut a release on its own — it lands on `main` and auto-batches into the next `feat:`/`fix:` release.
In practice that release is [#508]'s `fix:` (the Windows drive-letter gate), which is sequenced to land immediately after this refactor and depends on the seam it establishes.
The rationale must not claim this issue itself cuts a release.

## Problem Statement

The bash path pipeline reads `process.platform` ambiently — directly, or through the host-bound `node:path` import — in roughly six interior modules, instead of injecting the platform once at the edge and threading it through.
The package already discovered the injectable-platform pattern (`isPathWithinDirectory`, `rule.ts` `shouldFoldCase`) but applied it only to a few leaf predicates, never end-to-end.
This half-built seam is the root cause behind the recurring Windows-path bugs ([#382], [#345], [#418], [#508]): each fix either hand-rolls a platform check that drifts from `node:path` (the [#508] `startsWith("/")` drift) or reaches for a fragile module-level `vi.mock("node:path")` to test Windows behavior on a POSIX CI.

The correction is to stop threading platform *knobs* into the pipeline and re-deriving path forms *during* evaluation.
Instead, inject a single collaborator constructed at the edge with the platform (and the working directory) baked in, hand it raw path tokens, and let it return the normalized values the gates expect.
Path interpretation — "by which platform's rules, and against which working directory, do we read this path?" — becomes one collaborator's job, prepared before evaluation rather than scattered through it.

## Goals

- Introduce a `PathNormalizer` collaborator constructed once at the edge, carrying the platform and the session working directory, that produces the pipeline's prepared path values (`AccessPath`s) and answers the platform-dependent routing questions (absoluteness, `cd`-base resolution, working-directory containment).
- Thread `PathNormalizer` through the bash path pipeline: `BashProgram.parse` → `cwd-projection.ts` → the per-tool and external-directory path gates, replacing the host-bound `node:path` import, the inline `process.platform` ternaries, and the ad-hoc `cwd` threading.
- Complete the half-built leaf seam: `normalizePathForComparison`, `canonicalNormalizePathForComparison`, `canonicalizePath`, and `AccessPath.forPath`/`forLiteral` accept the platform flavor instead of reading `process.platform` inline.
- Eliminate every interior `process.platform` read (`path-utils.ts`, `subagent-context.ts`, `rule.ts` defaults) so the only reader is the composition-root edge, and add a lint guard that makes that enforceable.
- Make Windows path behavior testable on a POSIX CI by injecting a `win32` `PathNormalizer` — no `vi.mock("node:path")`.

This is a **behavior-preserving refactor** (`refactor:`).
Every interior op converted to a `PathNormalizer` call already used the host-bound `node:path` (so it already behaved as `win32` on Windows and `posix` on POSIX); the one POSIX-hard-coded drift — `isRelativeCandidate`'s `startsWith("/")` — is intentionally **left as-is** and deferred to [#508] (see Non-Goals).
On the POSIX CI there is no observable change; the `win32` seam is newly exercised only by injected-platform unit tests.

## Non-Goals

- **The `isRelativeCandidate` → injected `isAbsolute` conversion.**
  Converting `cwd-projection.ts`'s `isRelativeCandidate` from the hand-rolled `!candidate.startsWith("/")` to `!normalizer.isAbsolute(candidate)` changes Windows routing for drive-letter tokens — it is the *semantic* Windows correction, not a structural threading change.
  It is deferred to [#508] (whose plan already folds it into its step 1), so this issue stays strictly behavior-preserving.
  `isRelativeCandidate` remains pure host-independent string matching (no `process.platform`, no `node:path`), so it does not block the lint guard.
- **Recognizing Windows drive-letter shapes in the classifiers.**
  That is the [#508] fix (`token-classification.ts`); this issue only builds the seam [#508] lands on.
- **Dissolving `path-utils.ts` into the access-intent domain.**
  That relocation is Phase 7 Step 4 ([#505]).
  `PathNormalizer` is a facade *over* the (now platform-parameterized) `path-utils` and `AccessPath` primitives; it does not move them.
  [#505] can later relocate those internals behind the facade without changing it.
- **Config-pattern path handling and prompt-input paths.**
  Out of scope ([#487] residual work); the gates' pattern matching stays as-is.
- **Extending the `process.platform` lint guard package-wide or to other packages.**
  The guard is scoped to `pi-permission-system/src`; no concrete need is named for widening it.

## Background

Relevant modules and the platform reads they carry today:

- `src/path-utils.ts` — `normalizePathForComparison` and `canonicalNormalizePathForComparison` hard-code `process.platform === "win32"` inline; `isPathWithinDirectory` and `isPiInfrastructureRead` already take an injectable `platform: NodeJS.Platform = process.platform`.
- `src/canonicalize-path.ts` — `canonicalizePath` splits and rejoins on `/` only (POSIX-only); takes no flavor.
- `src/access-intent/access-path.ts` — `AccessPath.forPath`/`forLiteral` are static factories delegating to the three `path-utils` normalizers above; no platform option.
- `src/access-intent/bash/cwd-projection.ts` — imports `isAbsolute`/`join`/`resolve` from the host-bound `node:path`, hand-rolls `isRelativeCandidate` with `startsWith("/")`, and calls `isPathWithinDirectory(canonical, normalizedCwd)` **without** a platform argument (so even the one good seam falls back to the host).
- `src/access-intent/bash/program.ts` — `BashProgram.parse(command, cwd)` threads a bare `cwd` into the projection.
- `src/subagent-context.ts` — `normalizeFilesystemPath` and `isPathWithinDirectoryForSubagent` re-hand-roll `process.platform === "win32"` for case-folding and the separator.
- `src/rule.ts` — `evaluate` and `evaluateMostRestrictive`/`evaluateFirst`/`pathMatchOptions` decide case-insensitive matching via an injectable `platform: NodeJS.Platform = process.platform` (already injectable, but every caller relies on the default rather than supplying it).

Two distinct edges (this shapes the wiring):

- **`process.platform` is process-global** and known when the extension factory runs (`index.ts`).
  It can be read **once** there and injected into `PermissionManager` (for `rule.ts` matching) and `PermissionSession` (to build the normalizer).
- **`cwd` is session-scoped.**
  It is not available in the factory body; it arrives at `session_start` as `ctx.cwd` (`handlers/lifecycle.ts` → `session.resetForNewSession(ctx)`; `session.getRuntimeContext()?.cwd`).
  So `PathNormalizer` is constructed when the session resets, not in the factory body.

Constraints from AGENTS.md / package skill:

- `code-design`: do not read `process.platform` inside library/utility functions — accept it as a parameter (or, here, bake it into the collaborator at the edge).
- The bash gates share a single `BashProgram.parse` per `evaluate` ([#308]); the seam must not reintroduce a re-parse.
- The pipeline already pulls session-scoped values (`getInfrastructureReadDirs`, `getToolPreviewLimits`) from `PermissionSession` via the `ToolCallGateInputs` interface; the normalizer follows that established pattern (`getPathNormalizer()`).
- `docs/architecture/architecture.md` inline-copies the `rule.ts` types; touching `rule.ts`'s signature means checking that listing.

## Design Overview

### The `PathNormalizer` collaborator

A single value-bound collaborator, constructed at the edge with the two ambient inputs baked in, and handed raw tokens thereafter.

```typescript
export class PathNormalizer {
  constructor(
    private readonly platform: NodeJS.Platform,
    private readonly cwd: string,
  ) {}

  /** Build an AccessPath for a token, resolved against `resolveBase` (default cwd). */
  forPath(pathValue: string, options?: { resolveBase?: string }): AccessPath;

  /** Build a literal-only AccessPath (unknown base after a non-literal `cd`). */
  forLiteral(literal: string): AccessPath;

  /** Platform-aware absoluteness (`win32` vs `posix` rules). */
  isAbsolute(pathValue: string): boolean;

  /** Resolve a `cd`-folded offset against the baked cwd (platform-aware). */
  resolveBase(offset: string): string;

  /** Join a `cd` offset with a relative target (platform-aware), for cd-folding. */
  joinBase(offset: string, target: string): string;

  /** Containment of `pathValue` within `directory` (platform-aware). */
  isWithinDirectory(pathValue: string, directory: string): boolean;

  /** Canonical (symlink-resolved) outside-cwd test against the baked cwd. */
  isOutsideWorkingDirectory(pathValue: string): boolean;
}
```

The methods are intention-revealing domain operations ("is this path absolute *under our platform*", "resolve a `cd` offset *against our cwd*"), not a generic re-export of `node:path`.
Internally `PathNormalizer` selects `path.win32`/`path.posix` and the case-fold once, and delegates to the platform-parameterized `path-utils`/`canonicalize-path`/`AccessPath.forPath` primitives.
No consumer sees `platform`, selects a flavor, or threads `cwd`.

### Consumer call sites (Tell-Don't-Ask check)

Projection (`cwd-projection.ts`) — hands the normalizer a token, gets a prepared `AccessPath`; no `cwd`, no `node:path`:

```typescript
// buildRuleCandidatePath
if (base.kind === "unknown" && isRelativeCandidate(candidate)) {
  return normalizer.forLiteral(normalizePathPolicyLiteral(candidate));
}
const resolveBase =
  base.kind === "known" ? normalizer.resolveBase(base.offset) : undefined;
return normalizer.forPath(candidate, { resolveBase });
```

`foldCd` asks the normalizer the platform questions instead of importing them:

```typescript
if (normalizer.isAbsolute(target)) return { kind: "known", offset: target };
if (base.kind === "unknown") return UNKNOWN_BASE;
return { kind: "known", offset: normalizer.joinBase(base.offset, target) };
```

Per-tool path gate (`path.ts`) — the ambient `tcc.cwd` is gone; the session's normalizer already carries it:

```typescript
const accessPath = normalizer.forPath(filePath);
```

The normalizer reaches the gates the same way the infra-dir list does — the pipeline pulls it from the session per `evaluate`:

```typescript
// tool-call-gate-pipeline.evaluate
const normalizer = this.inputs.getPathNormalizer();
const bashProgram =
  tcc.toolName === "bash" && command
    ? await BashProgram.parse(command, normalizer)
    : null;
```

### Edge wiring

```typescript
// index.ts (factory body) — the single process.platform read
const hostPlatform = process.platform; // eslint guard exemption: composition root
const permissionManager = new PermissionManager({ agentDir, platform: hostPlatform });
session = new PermissionSession(/* …, */ hostPlatform);
```

```typescript
// PermissionSession.resetForNewSession(ctx) — cwd now known
this.pathNormalizer = new PathNormalizer(this.platform, ctx.cwd);
```

`PermissionSession` exposes `getPathNormalizer(): PathNormalizer`, added to the `ToolCallGateInputs` interface alongside the existing query methods.

### Lint guard

A flat-config block scoped to `packages/pi-permission-system/src/**/*.ts` forbids `process.platform`, exempting only the composition root (`index.ts`):

```javascript
{
  files: ["packages/pi-permission-system/src/**/*.ts"],
  ignores: ["packages/pi-permission-system/src/index.ts"],
  rules: {
    "no-restricted-syntax": ["error", {
      selector: 'MemberExpression[object.name="process"][property.name="platform"]',
      message: "Read process.platform only at the composition root; inject the platform (PathNormalizer / rule platform) into interior modules.",
    }],
  },
}
```

`process.env` (used legitimately by `subagent-context.ts` for subagent env hints) is untouched — the guard targets `process.platform` only.

### Edge cases preserved

- **Behavior parity per platform.**
  Every converted op already used host `node:path` / `process.platform`; with the default platform = host, each produces the identical result.
  `canonicalizePath` gains `win32`-aware splitting — a no-op on POSIX (splits on `/` as before) and a latent correctness gain on Windows that becomes observable only once [#508] feeds drive tokens through it; validated here by injected-`win32` unit tests.
- **[#393] literal-only guard.**
  A relative candidate under an unknown `cd` base still routes to `forLiteral` — `isRelativeCandidate` is unchanged.
- **[#418] lexical-vs-canonical split.**
  `AccessPath`'s accessors and the projection's "boundary uses canonical, returned value is lexical" logic are unchanged; only their construction is platform-parameterized.
- **[#308] single parse.**
  `BashProgram.parse` still parses once; it gains the normalizer in place of `cwd`.

## Module-Level Changes

- `src/path-utils.ts` — add `platform: NodeJS.Platform` to `normalizePathForComparison` and `canonicalNormalizePathForComparison` (replacing the inline `process.platform === "win32"`), threading it to the private absolute/relative helpers and the existing `isPathWithinDirectory` call; remove the `= process.platform` *inline reads* (the injectable defaults on `isPathWithinDirectory`/`isPiInfrastructureRead` are removed in the lint-guard step once all callers supply it).
- `src/canonicalize-path.ts` — `canonicalizePath` accepts the platform flavor (or `PlatformPath`) and splits/rejoins on the platform separator (`win32`-aware), defaulting to host.
- `src/access-intent/access-path.ts` — `forPath`/`forLiteral` accept a `platform` option, threaded to the three normalizers.
- `src/path-normalizer.ts` — **new** `PathNormalizer` class (platform + cwd baked) wrapping `AccessPath.forPath`/`forLiteral` and exposing `isAbsolute`/`resolveBase`/`joinBase`/`isWithinDirectory`/`isOutsideWorkingDirectory`.
- `src/access-intent/bash/cwd-projection.ts` — drop the `import { isAbsolute, join, resolve } from "node:path"`; `projectExternalPaths`/`projectRuleCandidates`/`buildRuleCandidatePath`/`foldCd` take a `PathNormalizer` in place of the `cwd` parameter and call its methods; `isRelativeCandidate` stays `startsWith` (deferred to [#508]).
- `src/access-intent/bash/program.ts` — `BashProgram.parse(command, normalizer)` replaces `cwd`; thread `normalizer` into the projection calls.
- `src/handlers/gates/bash-path-extractor.ts` — `BashProgram.parse(command, normalizer)`.
- `src/handlers/gates/tool-call-gate-pipeline.ts` — pull `getPathNormalizer()` from `inputs`; pass it to `BashProgram.parse` and the path-gate producers; add `getPathNormalizer` to the `ToolCallGateInputs` interface.
- `src/handlers/gates/path.ts`, `src/handlers/gates/external-directory.ts`, `src/handlers/gates/bash-external-directory.ts`, `src/handlers/gates/bash-path.ts` — replace `AccessPath.forPath({ cwd: tcc.cwd })` with the injected `normalizer.forPath(...)`.
- `src/permission-session.ts` — constructor accepts `platform`; `resetForNewSession` builds the `PathNormalizer` from `{ platform, ctx.cwd }`; add `getPathNormalizer()`; declare it on the `ToolCallGateInputs` it implements.
- `src/permission-manager.ts` — constructor accepts `platform`; supply it to the `evaluate`/`evaluateFirst`/`evaluateAnyValue` calls.
- `src/rule.ts` — remove the `= process.platform` defaults on `evaluate` and `evaluateMostRestrictive`/`evaluateFirst` (thread `platform` from the manager); `pathMatchOptions`/`ruleMatches` already take it.
- `src/subagent-context.ts` — `normalizeFilesystemPath` and `isSubagentExecutionContext` accept `platform` (injected from the composition root via the lifecycle/registry caller); remove the hand-rolled `process.platform === "win32"` branches.
- `src/index.ts` — read `process.platform` once; inject into `PermissionManager`, `PermissionSession`, and the `subagent-context` caller path.
- `eslint.config.js` (repo root) — add the `process.platform` `no-restricted-syntax` block scoped to `pi-permission-system/src`, exempting `index.ts`.
- `packages/pi-permission-system/docs/architecture/architecture.md` — record the `PathNormalizer` seam and its relationship to Phase 7 [#505]; update the `rule.ts` type/signature listing if the `evaluate` signature note changes; add a roadmap entry referencing [#510] (the issue notes this is "probably a roadmap step").
- `.pi/skills/package-pi-permission-system/SKILL.md` — update the path/platform handling notes (the "check how pi-coding-agent solves it" debugging note and any `process.platform` guidance) to point at `PathNormalizer` as the single home; note the lint guard.

A grep of `src/`, `test/`, `architecture.md`, and the package SKILL confirms `process.platform` lives only in the modules listed above; `AccessPath.forPath`/`forLiteral` callers are `cwd-projection.ts` and the four gates listed (all migrated); `BashProgram.parse` callers are `tool-call-gate-pipeline.ts` and `bash-path-extractor.ts` (both migrated).

## Test Impact Analysis

1. **New tests enabled.**
   Injected-`win32` unit tests across the seam **without** `vi.mock("node:path")`: `path-utils` normalizers and `canonicalizePath` driven with `platform: "win32"`; `AccessPath.forPath` with the `win32` option; a `PathNormalizer` unit suite (both flavors) covering `forPath`/`forLiteral`/`isAbsolute`/`resolveBase`/`joinBase`/containment; and an end-to-end projection/external-directory assertion driving a `win32` `PathNormalizer` through `BashProgram.parse` (the seam [#508] then exercises with drive tokens).
2. **Redundant tests.**
   Any existing Windows-path test relying on a `process.platform` stub or `vi.mock("node:path")` for these modules can be simplified to inject a `win32` `PathNormalizer`/platform (none currently exist for the bash pipeline — `skill-prompt-sanitizer.test.ts`'s `node:path` mock is a different module, out of scope).
3. **Tests that must stay as-is.**
   The existing POSIX projection / `bash-external-directory` / `program` / `access-path` / `path-utils` / `rule` suites are the regression guard that POSIX behavior is unchanged; they stay green untouched (modulo the mechanical signature migration — `BashProgram.parse(command, cwd)` → `(command, normalizer)`, `AccessPath.forPath({cwd})` call shape).

## Invariants at risk

This change touches surfaces earlier phases refactored; their documented outcomes must not regress:

- **[#418]** (lexical-vs-canonical conflation is a compile error) — pinned by `test/access-intent/access-path.test.ts` and the projection's lexical-return/canonical-boundary assertions in `bash-external-directory.test.ts`.
  Preserved: only construction is platform-parameterized.
- **[#393]** (relative candidate under unknown `cd` base stays literal-only) — pinned by the unknown-base projection tests in `program.test.ts`/`bash-external-directory.test.ts`.
  Preserved: `isRelativeCandidate` unchanged.
- **[#308]** (single `BashProgram.parse` per `evaluate`) — pinned by `program.test.ts` and the pipeline tests.
  Preserved: parse count unchanged.
- **[#382]** (`win32` boundary values lowercased) — pinned by the `win32` `path-utils`/`AccessPath` tests; the `PathNormalizer` `win32` suite extends this coverage.
- **[#478]** (single resolver/manager resolution entry point) — the manager's new `platform` field does not add a resolution method; pinned by the manager/resolver suites.

## TDD Order

1. `refactor:` Thread the platform flavor through the leaf normalizers (preparatory, additive).
   Red: `path-utils.test.ts` cases asserting `normalizePathForComparison`/`canonicalNormalizePathForComparison` with `platform: "win32"` lowercase and use `win32` resolution; `canonicalize-path.test.ts` cases asserting `win32`-separator splitting.
   Green: add the `platform` parameter (defaulting to host) to `normalizePathForComparison`, `canonicalNormalizePathForComparison`, and `canonicalizePath`, threading to the private helpers.
   Commit: `refactor(pi-permission-system): accept platform flavor in path normalizers (#510)`.

2. `refactor:` Add the platform option to `AccessPath.forPath`/`forLiteral`.
   Red: `access-path.test.ts` cases building a `win32` `AccessPath` and asserting `value`/`matchValues`/`boundaryValue`.
   Green: add the `platform` option, threaded to the normalizers.
   Commit: `refactor(pi-permission-system): thread platform option through AccessPath factory (#510)`.

3. `feat:` Introduce the `PathNormalizer` collaborator (not yet wired).
   Red: `path-normalizer.test.ts` (both flavors) covering `forPath`/`forLiteral`/`isAbsolute`/`resolveBase`/`joinBase`/`isWithinDirectory`/`isOutsideWorkingDirectory`.
   Green: add `src/path-normalizer.ts` wrapping the platform-parameterized primitives.
   Commit: `feat(pi-permission-system): add PathNormalizer collaborator (#510)`.

4. `refactor:` Build the normalizer at the session edge and expose it.
   Red: `permission-session` test asserting `getPathNormalizer()` returns a normalizer bound to the reset cwd; composition-root test asserting the single platform read flows to session + manager.
   Green: `index.ts` reads `process.platform` once and injects it; `PermissionSession` constructor takes `platform`, `resetForNewSession` builds the normalizer, `getPathNormalizer()` added to the class and the `ToolCallGateInputs` interface.
   Commit: `refactor(pi-permission-system): construct PathNormalizer at the session edge (#510)`.

5. `refactor:` Migrate the bash projection and `BashProgram.parse` onto the normalizer.
   Red/Green together (signature change breaks call sites in one commit): `cwd-projection.ts` and `BashProgram.parse` take a `PathNormalizer` in place of `cwd`; drop the `node:path` import; update the two `parse` call sites (`tool-call-gate-pipeline.ts`, `bash-path-extractor.ts`) and migrate `program.test.ts`/`bash-external-directory.test.ts` fixtures (lift-and-shift: pass a host-default `PathNormalizer`).
   Add the end-to-end `win32`-normalizer projection assertion.
   Commit: `refactor(pi-permission-system): drive bash path projection through PathNormalizer (#510)`.

6. `refactor:` Migrate the per-tool and external-directory path gates onto the session normalizer.
   Red/Green: `path.ts`, `external-directory.ts`, `bash-external-directory.ts`, `bash-path.ts` use `getPathNormalizer()`/the threaded normalizer instead of `AccessPath.forPath({ cwd: tcc.cwd })`; update gate tests.
   Commit: `refactor(pi-permission-system): route path gates through the session PathNormalizer (#510)`.

7. `refactor:` Inject the platform into `rule.ts` matching.
   Red/Green: remove the `= process.platform` defaults on `evaluate`/`evaluateMostRestrictive`/`evaluateFirst`; `PermissionManager` takes `platform` and supplies it; update `rule.test.ts`/`permission-manager` tests and the `architecture.md` `rule.ts` listing if the signature note changes.
   Commit: `refactor(pi-permission-system): inject platform into rule evaluation (#510)`.

8. `refactor:` Inject the platform into `subagent-context.ts`.
   Red/Green: `normalizeFilesystemPath`/`isSubagentExecutionContext` accept `platform` from the composition-root caller; remove the hand-rolled branches; update `subagent-context.test.ts` and the composition-root wiring.
   Commit: `refactor(pi-permission-system): inject platform into subagent context detection (#510)`.

9. `build:` Add the `process.platform` lint guard and remove the last interior defaults.
   Red: confirm the guard fires on a temporary interior `process.platform` (sanity), then remove the now-unused injectable `= process.platform` defaults on `isPathWithinDirectory`/`isPiInfrastructureRead` (all callers supply it).
   Green: add the scoped `no-restricted-syntax` block to `eslint.config.js`; run `pnpm run lint` + the full package suite to confirm `index.ts` is the only reader.
   Commit: `build(pi-permission-system): forbid interior process.platform reads (#510)`.

10. `docs:` Record the seam.
    Update `architecture.md` (the `PathNormalizer` seam, its relationship to Phase 7 [#505], a roadmap entry for [#510]) and `SKILL.md` (path/platform handling points at `PathNormalizer`; note the lint guard).
    Commit: `docs(pi-permission-system): document the PathNormalizer platform seam (#510)`.

## Risks and Mitigations

- **`cwd` source change (per-call → baked).**
  The pipeline currently reads `ctx.cwd` on every tool call; baking it into the session normalizer assumes `cwd` is stable within a session.
  In Pi a session is bound to one project directory and `ctx.cwd` is that directory on every event (the package already treats `session.getRuntimeContext()?.cwd` as the session cwd), so this holds.
  Mitigation: build/refresh the normalizer in `resetForNewSession` (which already runs on every `session_start`, including `/new`/`/resume`/`/fork`), so a session switch rebinds it; pin with a composition-root test that the normalizer's cwd tracks the reset ctx.
- **Accidental Windows behavior change.**
  The point of the refactor is parity; the only POSIX-hard-coded drift (`isRelativeCandidate`) is deliberately left for [#508].
  Mitigation: the converted ops all previously used host `node:path`; the POSIX suite stays green untouched, and the new `win32` tests assert the seam, not a host-default change.
- **`canonicalizePath` `win32` branch is newly reachable.**
  Mitigation: it is a no-op on POSIX; the `win32` unit tests validate the new branch in isolation before [#508] exercises it end-to-end.
- **Large multi-step migration.**
  Mitigation: lift-and-shift — additive seam first (steps 1–3), edge wiring (step 4), then consumer migration (steps 5–8) one surface per commit, each leaving the suite green; the lint guard (step 9) lands only after the last interior read is gone.
- **Overlap with Phase 7 [#505] (path-utils dissolution).**
  Mitigation: `PathNormalizer` is a facade over `path-utils`, not a relocation; [#505] can later move the internals behind it without re-touching the seam.

## Open Questions

None blocking.
The collaborator shape (single `PathNormalizer` owning construction + routing, name confirmed), the `cwd`-baked construction edge, the behavior-preserving scope (defer `isRelativeCandidate` to [#508]), and the full enforcement scope (lint guard + `rule.ts`/`subagent-context` cleanup) were confirmed with the operator during planning.

[#308]: https://github.com/gotgenes/pi-packages/issues/308
[#345]: https://github.com/gotgenes/pi-packages/issues/345
[#382]: https://github.com/gotgenes/pi-packages/issues/382
[#393]: https://github.com/gotgenes/pi-packages/issues/393
[#418]: https://github.com/gotgenes/pi-packages/issues/418
[#478]: https://github.com/gotgenes/pi-packages/issues/478
[#487]: https://github.com/gotgenes/pi-packages/issues/487
[#505]: https://github.com/gotgenes/pi-packages/issues/505
[#508]: https://github.com/gotgenes/pi-packages/issues/508
[#510]: https://github.com/gotgenes/pi-packages/issues/510
