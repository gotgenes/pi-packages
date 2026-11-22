---
issue: 592
issue_title: "TSC Error when importing publicly available types from the package"
---

# Ship a consumable public type surface via bundled declarations

## Release Recommendation

**Release:** ship independently

This issue is a consumer-facing bug fix and does not appear in the architecture roadmap (`docs/architecture/architecture.md` has no step referencing it), so it carries no batch tag.
The `fix:` commit cuts a patch release on its own.

## Problem Statement

A downstream TypeScript project that installs `@gotgenes/pi-permission-system` and imports any public symbol (the reporter's example is `PERMISSIONS_UI_PROMPT_CHANNEL`) fails `tsc --noEmit` with:

```text
node_modules/@gotgenes/pi-permission-system/src/rule.ts:1:33 - error TS2307: Cannot find module '#src/path/path-flavor' or its corresponding type declarations.
```

The package's `exports` maps `.` to raw `./src/service.ts`, whose transitive imports use the Node subpath-imports pattern `#src/*` (declared in `package.json` `imports` as `"#src/*": "./src/*"` — no file extension).
Node/TypeScript subpath-imports resolution, unlike TypeScript's `paths`, does **not** probe for extensions: the target `./src/path/path-flavor` has no extension and does not exist, so resolution fails.
The repo's own build hides this because its `tsconfig.json` sets `paths` (`#src/*` → `./src/*`), and TypeScript's `paths` feature *does* probe extensions — the reporter confirmed that deleting `paths` reproduces the consumer error locally.
The published package therefore leaks its internal `#src` source structure onto every consumer's `tsc`, blocking third-party extensions that want to consume the cross-extension service types or the permission-event contract.

## Goals

- A downstream extension can `import` the public surface (service accessors, `PermissionsService`, `PermissionCheckResult`, `PermissionState`, the event types, and the `PERMISSIONS_*_CHANNEL` constants) and type-check cleanly with `moduleResolution: "bundler"`.
- The published type surface is self-contained: it carries no `#src/*` aliases and does not expose the internal module tree.
- The fix follows the established sibling convention (`pi-subagents`) exactly, keeping the two packages' packaging shape identical.
- A CI guard type-checks the public surface from the *packaged tarball* as an external consumer would, so this regression class cannot return silently.
- Source files keep writing extensionless `#src/*` imports; nothing in `src/` changes.

This change is **not** breaking.
The runtime `default` condition still resolves to `./src/service.ts`, so jiti extension loading is unchanged; only the type-resolution path gains a self-contained declaration bundle.

## Non-Goals

- No change to `src/service.ts` or any runtime code — the public API surface (functions, interface, constants, event types) is exactly what it is today.
- No change to `package.json` `imports` (`#src/*` / `#test/*` stay `./src/*` / `./test/*`) and no change to `tsconfig.json` `paths`.
  Consumers resolve types through the new `exports.types` condition and never follow `#src`, so the internal-build "dogfood" (removing `paths`, appending `.ts` to the `imports` map) is unnecessary and would diverge from `pi-subagents`.
- No second export subpath — `pi-subagents` ships `.` plus `./settings`; this package ships only `.`.
- No code change in `pi-subagents` — its only touch is a `package.json` devDependency specifier swap (pinned → `catalog:`), so this stays a single-package (`pi-permission-system`) plan filed in this package's directory.

## Background

Relevant existing modules and precedent:

- `packages/pi-permission-system/package.json` — `exports` is the bare string `"./src/service.ts"`; `files` allowlists runtime code, config, schema, and docs; `imports` maps `#src/*` / `#test/*`.
- `packages/pi-permission-system/src/service.ts` — the public entry: the `Symbol.for()` accessors (`publishPermissionsService` / `getPermissionsService` / `unpublishPermissionsService`), the `PermissionsService` interface, and re-exports of `PermissionCheckResult` / `PermissionState` / `ToolInputFormatter` and the `permission-events` types and channel constants.
- `packages/pi-subagents/` — the sibling that already solved this identical problem.
  It ships a bundled `dist/public.d.ts` built by `rollup-plugin-dts`, exposed through an `exports` `types` condition, guarded by `scripts/verify-public-types.sh` wired into CI.
  Its `rollup.dts.config.mjs` inputs `src/service/service.ts`, marks `@earendil-works/*` external, and emits ES-format `.d.ts` only (no JS).
- `.github/workflows/ci.yml` — the `check` job runs `pnpm -r run check`, then `pnpm --filter @gotgenes/pi-subagents run verify:public-types`, then lint / test / fallow.
- `pnpm-workspace.yaml` — the `catalog:` block centralizes shared dev-tool versions (`typescript`, `vitest`, `rumdl`, `@biomejs/biome`, `@types/node`, `eslint`, `fallow`, …); every package references them with the `catalog:` specifier.
  `rollup` / `rollup-plugin-dts` are the exception — pinned directly in `pi-subagents` because it was their sole user.
  A second user (this package) is exactly the drift risk the catalog exists to prevent, so this plan lifts both into the catalog and migrates `pi-subagents` to reference them from it.

AGENTS.md constraints that apply:

- Docs-in-distribution: every package uses a `files` allowlist and ships `dist` (built type bundles) explicitly; `dist` is gitignored (root `.gitignore`) and rebuilt at `prepack`.
  Verify the allowlist with `pnpm pack` + `tar tzf`.
- Run `pnpm fallow dead-code` locally before pushing a dependency-changed package — CI gates on it.
- Publishing is automatic (`scripts/publish-released.sh` runs `pnpm publish`, which fires `prepack`); no publish-script edit is needed.

The public type surface is plain TypeScript: `RuleOrigin` is a string union, `PermissionState` / `PatternValue` / `DenyWithReason` / `FlatPermissionConfig` are `z.infer<...>` types (which resolve to structural TS types, not a runtime `zod` import), and `permission-events.ts` has no imports.
So the emitted declaration inlines cleanly with no `zod` or `@earendil-works/*` leakage; `external: [/^@earendil-works\//]` is a defensive match mirroring `pi-subagents`, and the self-containment guard plus the external-consumer `tsc` catch any leak the design missed.

No workspace package imports `@gotgenes/pi-permission-system` as a type dependency (the two matches in `pi-subagents` are prose comments), so `pnpm -r run check` never needs `dist/` prebuilt.

## Design Overview

Adopt the `pi-subagents` declaration-bundling convention verbatim, scoped to this package's single `.` entry.

### `exports` shape

```jsonc
"exports": {
  ".": {
    "types": "./dist/public.d.ts",
    "default": "./src/service.ts"
  }
}
```

A consumer with `moduleResolution: "bundler"` (or `node16`/`nodenext`) resolves the `types` condition to the self-contained `dist/public.d.ts`; the runtime/jiti path still follows `default` to raw `./src/service.ts`.
Condition order matters — `types` first, `default` last.

### Declaration bundle

`rollup.dts.config.mjs` mirrors the sibling:

```javascript
import { dts } from "rollup-plugin-dts";

const external = [/^@earendil-works\//];

export default [
  {
    input: "src/service.ts",
    output: { file: "dist/public.d.ts", format: "es" },
    external,
    plugins: [dts({ tsconfig: "./tsconfig.json" })],
  },
];
```

`rollup-plugin-dts` reads `tsconfig.json` for resolution, so it honors the existing `paths` (`#src/*` → `./src/*`) when following the source graph and inlines every internal module into one `dist/public.d.ts`.
`build:types` runs rollup; `prepack` runs `build:types` so `pnpm publish` / `pnpm pack` always regenerate the declaration.

### Regression guard

`scripts/verify-public-types.sh` adapts the sibling script down to the single `.` entry.
It packs the real tarball (firing `prepack`), asserts `dist/public.d.ts` contains no `#src` and does export the public symbols, then installs the tarball into a throwaway consumer and type-checks a probe that imports exactly what the reporter tried.
The consumer probe pins the reported symbol plus the accessor and a representative type:

```typescript
import {
  getPermissionsService,
  PERMISSIONS_UI_PROMPT_CHANNEL,
  type PermissionCheckResult,
  type PermissionUiPromptEvent,
} from "@gotgenes/pi-permission-system";

void getPermissionsService;
void PERMISSIONS_UI_PROMPT_CHANNEL;
const _e: PermissionUiPromptEvent | undefined = undefined;
const _r: PermissionCheckResult | undefined = undefined;
void _e;
void _r;
```

The self-containment symbol list for the `grep` assertions: `getPermissionsService`, `publishPermissionsService`, `unpublishPermissionsService`, `PermissionsService`, `PermissionCheckResult`, `PermissionState`, `ToolInputFormatter`, `PERMISSIONS_UI_PROMPT_CHANNEL`, `PERMISSIONS_READY_CHANNEL`, `PERMISSIONS_DECISION_CHANNEL`, `PermissionUiPromptEvent`.

The consumer installs the tarball plus the two peer deps (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`) with `--ignore-workspace --ignore-scripts`, then runs the workspace `tsc` against the consumer's `tsconfig.json` (`moduleResolution: "Bundler"`, matching the reporter's config).

### Edge cases

- The consumer probe uses `moduleResolution: "Bundler"` — the exact mode from the issue's reproduction `tsconfig.json` — so the guard reproduces the reported failure before the fix and passes after.
- `dist/` is already gitignored at the repo root, so no per-package `.gitignore` edit is needed; `prepack` (re)builds it for pack/publish.
- `scripts/` is absent from the `files` allowlist, so the verify script and rollup config never ship in the tarball.

## Module-Level Changes

- `packages/pi-permission-system/package.json`
  - Change `exports` from `"./src/service.ts"` to the `{ types, default }` conditional object above.
  - Add `dist` to the `files` allowlist (place it before `config/config.example.json`, matching the sibling's ordering intent).
  - Add scripts: `"build:types": "rollup -c rollup.dts.config.mjs"` and `"prepack": "pnpm run build:types"` and `"verify:public-types": "bash scripts/verify-public-types.sh"`.
  - Add devDependencies referencing the catalog: `"rollup": "catalog:"` and `"rollup-plugin-dts": "catalog:"`.

- `pnpm-workspace.yaml`
  - Add to the `catalog:` block: `rollup: "^4.62.2"` (latest; bumped from the `^4.61.1` currently pinned in `pi-subagents`) and `"rollup-plugin-dts": "^6.4.1"` (latest).
    `rollup-plugin-dts@6`'s peer range (`rollup ^3.29.4 || ^4`, `typescript ^4.5 || ^5.0 || ^6.0`) is satisfied by these and the catalog's `typescript ^6.0.3`.

- `packages/pi-subagents/package.json`
  - Migrate the two existing pinned devDependencies to the catalog: `"rollup": "catalog:"` and `"rollup-plugin-dts": "catalog:"`.
    This bumps `pi-subagents`' resolved `rollup` from `4.61.1` to `4.62.2` (within `4.x`), so its declaration build must be re-verified (see Implementation Order step 1).

- `packages/pi-permission-system/rollup.dts.config.mjs` — new; the config above.

- `packages/pi-permission-system/scripts/verify-public-types.sh` — new; single-entry adaptation of the sibling script (pack → self-containment grep → symbol presence → throwaway-consumer `tsc`).

- `.github/workflows/ci.yml` — add a step after the existing `pi-subagents` verify step:

  ```yaml
  - name: Verify pi-permission-system public types are consumable from the package
    run: pnpm --filter @gotgenes/pi-permission-system run verify:public-types
  ```

- `pnpm-lock.yaml` — regenerated by `pnpm install` after the catalog additions and the two packages' devDependency changes; committed in the same step.

- `packages/pi-permission-system/docs/architecture/architecture.md`
  - Line ~483 ("The `package.json` `exports` field points to `src/service.ts` …"): note that `exports` now exposes a `types` condition resolving to a bundled `dist/public.d.ts` (built by `rollup-plugin-dts`) for external consumers, while `default` still points to `src/service.ts` for the jiti runtime.
  - Line ~793 (the `service.ts` module-layout entry): add a brief note that its public surface is published as the self-contained `dist/public.d.ts` bundle.

- `packages/pi-permission-system/docs/cross-extension-api.md` — add a short note that the public types are directly importable (they ship as a bundled declaration with no `#src` leakage), so the `import type { … } from "@gotgenes/pi-permission-system"` examples already shown type-check for consumers.

No `src/` or `test/` file changes: the public API surface is unchanged, so no exported symbol is removed or renamed and no `SKILL.md` / narrative-prose grep target is affected.

## Test Impact Analysis

This is a packaging change, not an extraction or refactor, so it enables no new unit tests and makes no existing test redundant.

1. New coverage: `verify:public-types` — a black-box integration guard that packs the real tarball and type-checks an external consumer against it.
   It is the executable specification for #592 and the guard against its recurrence.
2. Redundant tests: none.
3. Tests that must stay as-is: all existing Vitest suites — none exercise packaging, and the runtime surface is untouched.

## Invariants at risk

None.
The change touches no surface a prior phase step refactored: `src/service.ts`, `permission-events.ts`, `types.ts`, and `rule.ts` are unchanged, so every documented `Outcome:`/`Landed:` invariant and its pinning test remain valid.

## Implementation Order

This plan adds build tooling, a packaging condition, a shell-based regression guard, and docs — there are no new Vitest red→green cycles, so it routes through `/build-plan`.
Each step names its verify criterion and suggested commit.
The release-cutting commit is the `fix:` in step 2; the surrounding `build:` / `test:` / `docs:` commits are hidden changelog types that batch into that release.

1. Declaration-bundle tooling (with catalog lift).
   Add `rollup` + `rollup-plugin-dts` to the `pnpm-workspace.yaml` catalog at the latest versions; migrate `pi-subagents`' two pins to `catalog:`; add the same two as `catalog:` devDependencies in `pi-permission-system`; run `pnpm install`.
   Add `rollup.dts.config.mjs` and the `build:types` + `prepack` scripts.
   Verify: `pnpm --filter @gotgenes/pi-permission-system run build:types` emits `dist/public.d.ts`; `grep -c '#src' dist/public.d.ts` is `0`; the bundle contains the public symbols; the `rollup` bump does not regress the sibling — `pnpm --filter @gotgenes/pi-subagents run verify:public-types` and `pnpm --filter @gotgenes/pi-subagents run test` still pass; `pnpm fallow dead-code` is clean for both packages.
   Commit: `build: bundle pi-permission-system public declarations and catalog rollup deps`. (Touches `pnpm-workspace.yaml` and both packages' `package.json`; the sibling change is a specifier-only migration.)
2. Publish the type surface.
   Change `exports` to the `{ types, default }` object and add `dist` to `files`.
   Verify: `pnpm --filter @gotgenes/pi-permission-system exec pnpm pack --pack-destination /tmp` then `tar tzf` shows `dist/public.d.ts` present and dev files (`test/`, `tsconfig.json`, `scripts/`, `rollup.dts.config.mjs`) absent; `pnpm -r run check` still green.
   Commit: `fix(pi-permission-system): ship consumable public type declarations (#592)`.
3. Regression guard.
   Add `scripts/verify-public-types.sh` (single-entry adaptation) and the `verify:public-types` script, and wire the CI step.
   Verify: `pnpm --filter @gotgenes/pi-permission-system run verify:public-types` passes end-to-end (pack → self-containment → external-consumer `tsc`).
   Commit: `test(pi-permission-system): guard public type consumability from the packaged tarball`.
4. Documentation.
   Update `architecture.md` (the two `exports` / `service.ts` references) and `cross-extension-api.md` (the consumability note).
   Verify: `pnpm --filter @gotgenes/pi-permission-system run lint:md` passes.
   Commit: `docs(pi-permission-system): document the bundled public type declaration`.

## Risks and Mitigations

- Risk: the emitted `dist/public.d.ts` accidentally references `#src` or a peer-dep type, silently shipping a broken surface.
  Mitigation: the `verify:public-types` self-containment `grep` fails the build on any `#src`, and the external-consumer `tsc` fails on any unresolved type; both run in CI on every PR.
- Risk: `prepack` does not fire during the automated publish, shipping a tarball without `dist`.
  Mitigation: `pnpm publish` runs `prepack` by contract (the same path `pi-subagents` relies on today); the `pnpm pack` verification in step 2 exercises the exact hook.
- Risk: a future edit to the public surface re-introduces an internal leak.
  Mitigation: the CI guard is permanent and type-checks the packaged artifact from a real consumer's perspective.
- Risk: adding `rollup` devDeps trips the `fallow dead-code` gate.
  Mitigation: they are consumed by `rollup.dts.config.mjs` / the `build:types` script exactly as in `pi-subagents`, which passes the gate; step 1 runs the gate locally before pushing.
- Risk: cataloging bumps `pi-subagents`' `rollup` from `4.61.1` to `4.62.2`, subtly changing its `dist/public.d.ts` build.
  Mitigation: step 1 re-runs `pi-subagents`' `verify:public-types` (which type-checks its packaged tarball from an external consumer) and its test suite after the bump; the bump stays within `rollup@4.x`.

## Open Questions

None.
The direction (fully `pi-subagents`-consistent declaration bundling, no `imports`/`paths` dogfood) is confirmed with the operator, and the third-party reporter's proposed one-line `imports` fix is deliberately not taken in favor of the sibling convention and its stronger black-box guard.
