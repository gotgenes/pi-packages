---
issue: 1077
issue_title: "pi-permission-model-judge: the test fixture's PromptPayload lacks matchedSpelling and decidingPath"
---

# Bump the judge's dev pins to pi-permission-system 40.3.0 and Pi 1.0.0

## Release Recommendation

**Release:** ship independently

This package has no architecture roadmap and no release-batch membership.
Every commit is `test:` or `build:`, both skipped by `cliff.toml`, so `next-version.sh` is expected to print nothing for this package; `/ship` should confirm that rather than cut a release.

## Problem Statement

The judge's `devDependencies` pin `@gotgenes/pi-permission-system` at 27.0.0, and `node_modules` resolves that published package, not the workspace copy.
`PromptRequestFacts` has since gained `matchedSpelling` and `decidingPath` (the latter first published in 40.3.0), so the test fixture's `PromptPayload` literal would fail `tsc` on the bump, but `pnpm run check` cannot see it against 27.0.0.
The issue frames the fix as "add both fields, with or after the bump".

Running the real bump showed it breaks three things, not one:

1. `test/fixtures/permission-details.ts`: TS2739, missing `matchedSpelling` and `decidingPath` (the issue's prediction).
2. `test/extension.test.ts:89` `makeService()`: TS2322; `PermissionsService` gained `isToolFullyDenied`, `getToolAccessExtractor`, and `getToolInputFormatter`.
   The issue's "the fixture is the only such code in this repo" does not hold at 40.3.0.
3. `test/extension.test.ts` fails to load at runtime: `Cannot find module '#src/service/permission-events'`.
   The published `src/service.ts` value-re-exports through its own `#src/...` subpath imports, and the judge's `vitest.config.ts` global `resolve.alias` maps every `#src` (a dependency's included) into the judge's own `src/`.

## Goals

- `pnpm --filter @gotgenes/pi-permission-model-judge run check` is clean against `@gotgenes/pi-permission-system` 40.3.0 and `@earendil-works/pi-ai`/`pi-coding-agent` 1.0.0.
- The suite stays at 69 passing tests, and `pnpm peers check` reports no issues.
- The judge's tests resolve `#src`/`#test` through its `package.json` `imports` field, not a global Vite alias.
- `minimumReleaseAgeExclude` carries no version the lockfile no longer contains.
- Not breaking: `src/` and `peerDependencies` are unchanged; only dev pins and `test/` tooling move.

## Non-Goals

- Raising the `peerDependencies` floors (`pi-permission-system >=27.0.0`, `pi-ai`/`pi-coding-agent >=0.84.3`).
  `src/` compiles unchanged against 40.3.0 and 1.0.0, and the floor is a runtime contract this change does not touch.
- Removing the `#src`/`#test` alias from the other eight packages' `vitest.config.ts` — filed as [#1078].
  `pi-nocd` and `pi-session-tools` lack a `package.json` `imports` field, so their alias is load-bearing.
- Dropping the judge's tsconfig `paths` for `#src`/`#test`.
  `tsc` reads the dependency's bundled `dist/public.d.ts`, never its `src/`, so `paths` cannot capture its imports (the assessor's reading, consistent with the spike's clean `check`).
- Hardening `makeService()` against future `PermissionsService` growth (a `Proxy`, a cast, a `Partial` base).
  The TS2322 on the next bump is the signal that the interface changed; hiding it trades a one-line fix for a silent gap.

## Background

- `test/fixtures/permission-details.ts` builds `EXTERNAL_DIRECTORY_PAYLOAD`, a full `PromptPayload` with an explicit `request: PromptRequestFacts` literal.
  The docstring records that the payload is inert: `createTypoReviewer` reads an ask through `accessIntent`/`surface`/`path`/`value`.
- `test/extension.test.ts` `makeService()` (lines 84–95) returns a `PermissionsService & {…}` literal; its two callers (lines 125, 201) pick the new stubs up for free.
  The judge's `src/` calls only `getPermissionsService` and `registerAuthorizer` on the service.
- `vitest.config.ts`'s `resolve.alias` dates from #157, when `#src/*`/`#test/*` existed only as tsconfig `paths`, which Vite does not read.
  The judge's `package.json` now declares `"imports": { "#src/*": "./src/*", "#test/*": "./test/*" }`, which Vite resolves natively, scoped to the importer's own package.
  That reason governed tsconfig-only aliases, so it does not apply to this package any more.
- Precedent: 5ea06517 bumped the same pin 20.10.0 → 27.0.0 with fixture repairs in one commit.
  Its retro records that `pnpm add` added the version-pinned `minimumReleaseAgeExclude` entry automatically.
- #1005 typed the tool-call fixture arguments so the `@earendil-works/*` 1.0.0 bump would compile, and deferred that bump ("done separately"); this plan takes it.
- AGENTS.md constraints: pnpm only; `pnpm --filter` from the repo root; `trustLockfile: true` (see the `releasing` skill) lets CI's frozen install accept a same-day sibling.

## Design Overview

### How the evidence was produced

All of it was measured in this worktree at planning time against the real published packages, then reverted (`git checkout` plus `pnpm install --frozen-lockfile`; the judge resolves 27.0.0 again):

| Configuration                                            | `check`          | `vitest run`                                            |
| -------------------------------------------------------- | ---------------- | ------------------------------------------------------- |
| 27.0.0 / Pi 0.84.4, alias removed                        | not run          | 69 passed                                               |
| 40.3.0 / Pi 0.84.4, alias kept                           | TS2322 + TS2739  | `extension.test.ts` fails to load; 55 passed in 6 files |
| 40.3.0 / Pi 0.84.4, alias removed                        | (same TS errors) | 69 passed                                               |
| 40.3.0 / Pi 1.0.0, alias removed                         | TS2322 + TS2739  | 69 passed                                               |
| 40.3.0 / Pi 1.0.0, alias removed, both fixtures repaired | clean            | 69 passed; `lint` clean                                 |

With Pi left at 0.84.4, `pnpm peers check` reports `unmet peer @earendil-works/pi-coding-agent` (40.3.0 wants `>=1.0.0`); with Pi at 1.0.0 it reports none.
`src/` produced no `tsc` error in any configuration.
Runs are deterministic (`tsc`, a module-resolution failure), so n = 1 per row.

### Decisions (operator-confirmed)

- Bump `@earendil-works/pi-ai` and `pi-coding-agent` to 1.0.0 with the permission-system pin, which clears the unmet peer.
- Remove the alias in the judge only, and file the repo-wide sweep as [#1078].
- Prune `minimumReleaseAgeExclude` alternates the bump orphans.

### Fixture shapes

```typescript
// test/fixtures/permission-details.ts — EXTERNAL_DIRECTORY_PAYLOAD.request gains:
    matchedSpelling: null,
    decidingPath: null,

// test/extension.test.ts — makeService() gains (non-disposer returns, so bare stubs):
    isToolFullyDenied: vi.fn(),
    getToolAccessExtractor: vi.fn(),
    getToolInputFormatter: vi.fn(),
```

### Exclude-list end state

`pnpm add` rewrites the pin entry to `'@gotgenes/pi-permission-system@27.0.0 || 40.3.0'` (measured).
After the bump, the lockfile contains no `0.84.4` and no `27.0.0` (measured: `grep -n '0\.84\.4\|27\.0\.0' pnpm-lock.yaml` printed nothing).
The pruned entries read:

```yaml
  - '@gotgenes/pi-permission-system@40.3.0'
  - '@earendil-works/pi-agent-core@1.0.0'
  - '@earendil-works/pi-ai@1.0.0'
  - '@earendil-works/pi-coding-agent@1.0.0'
  - '@earendil-works/pi-telemetry@1.0.0'
  - '@earendil-works/pi-tui@1.0.0'
```

`'@earendil-works/pi-client@0.84.4'` and `'@earendil-works/pi-protocol@0.84.4'` are deleted outright.
Re-run the grep at implementation time before pruning; prune only a version it confirms absent.
The `40.3.0` entry stays: it is what lets a fresh resolution pass the 24-hour gate until 2026-10-18T02:29Z, and it is harmless after that.

## Module-Level Changes

- `packages/pi-permission-model-judge/vitest.config.ts` — delete the `resolve.alias` block and the `node:path` import; keep `test.include` and `test.coverage`.
- `packages/pi-permission-model-judge/package.json` — `devDependencies`: `@gotgenes/pi-permission-system` 27.0.0 → 40.3.0, `@earendil-works/pi-ai` and `pi-coding-agent` 0.84.4 → 1.0.0.
- `pnpm-lock.yaml` — regenerated by `pnpm add`.
- `pnpm-workspace.yaml` — `minimumReleaseAgeExclude` as in the end state above.
- `packages/pi-permission-model-judge/test/fixtures/permission-details.ts` — two `null` fields.
- `packages/pi-permission-model-judge/test/extension.test.ts` — three `makeService()` stubs.

Predicted unchanged:

- `packages/pi-permission-model-judge/src/**` — no `tsc` error at 40.3.0/1.0.0 (measured).
- `packages/pi-permission-model-judge/src/extension.ts:121`'s "27.0.0 or later" warning and `README.md:61`/`:64` floors — the peer floors do not move.
- `packages/pi-permission-model-judge/tsconfig.json` — `paths` stays (see Non-Goals).
- `.pi/skills/package-pi-permission-model-judge/SKILL.md` — names no alias or pin; its `pi-ai/compat` row still holds, since `@earendil-works/pi-ai@1.0.0` still exports `./compat`.

## Test Impact Analysis

No tests are added or removed.
The testable surface is `tsc` and module loading against the new pins, which the pinned 27.0.0 and 0.84.4 cannot exercise.
`test/extension.test.ts` is the test that pins the alias removal: at 40.3.0 it is the only file that loads `@gotgenes/pi-permission-system`'s runtime module.

## Invariants at risk

- The suite count (69) and `src/` behavior: no `src/` file changes, so the guarantee is that the count is unchanged across both commits.
- The judge's own `#src`/`#test` resolution under Vitest now rests on `package.json` `imports`.
  Every test file imports through `#src`/`#test`, so a broken mapping fails the whole suite, not one test.

## TDD Order

1. `test(pi-permission-model-judge): resolve #src and #test through package.json imports under Vitest`
   - Change: drop `vitest.config.ts`'s `resolve.alias` block and `node:path` import.
   - Verify at 27.0.0: `pnpm --filter @gotgenes/pi-permission-model-judge exec vitest run` reports 69 passed; `run check` and `run lint` clean.
   - Killing mutation: change the judge's `package.json` `imports` `"#src/*"` target to `"./lib/*"`; every test file must fail to load (the alias no longer masks it).
   - Prepares step 2's runtime failure (row 2 of the evidence table).
2. `build(pi-permission-model-judge): bump dev pins to pi-permission-system 40.3.0 and Pi 1.0.0`
   - Run: `pnpm --filter @gotgenes/pi-permission-model-judge add -D -E @gotgenes/pi-permission-system@40.3.0 @earendil-works/pi-ai@1.0.0 @earendil-works/pi-coding-agent@1.0.0`.
   - Red: `run check` reports TS2322 at `test/extension.test.ts(89,…)` and TS2739 at `test/fixtures/permission-details.ts(28,…)`.
   - Green: add the two fixture fields and the three `makeService()` stubs; prune `pnpm-workspace.yaml` per the end state after re-running the lockfile grep.
   - Verify: `run check` clean, `vitest run` 69 passed, `run lint` clean, `pnpm peers check` reports no issues, `pnpm install --frozen-lockfile` succeeds, `pnpm --silent fallow dead-code` clean.
   - Killing mutations, one per break:
     - Delete `decidingPath: null` from the fixture: `check` reports TS2741 in `permission-details.ts`.
     - Delete `isToolFullyDenied: vi.fn(),` from `makeService()`: `check` reports TS2322 at `extension.test.ts`.
     - Restore step 1's `resolve.alias` block: `extension.test.ts` fails to load with `Cannot find module '#src/service/permission-events'`.
   - One commit: the fixture fields are excess-property errors against 27.0.0, and the bump fails `tsc` without them.
   - Confirm `./scripts/release/next-version.sh pi-permission-model-judge` prints nothing afterwards.

## Risks and Mitigations

- **`minimumReleaseAge` blocks the install.**
  40.3.0 was published at 2026-10-17T02:29Z; the planning spike's `pnpm add` added the exclude entry itself and succeeded.
  If a later pnpm refuses instead, add `'@gotgenes/pi-permission-system@40.3.0'` to `minimumReleaseAgeExclude` by hand and re-run.
- **Pruning an exclude entry a fresh resolution still needs.**
  The prune is limited to versions the lockfile no longer contains, gated on the grep, and checked by `pnpm install --frozen-lockfile`.
- **The Pi 1.0.0 bump surfaces a `src/` break the spike missed.**
  The spike ran `check` and the full suite at 1.0.0 with no `src/` error; #1005's plan measured the same at 1.0.0.
- **A newer pi-permission-system lands before implementation.**
  Pin 40.3.0, the version planned and measured; a later bump is its own change.

## Open Questions

None.

[#1078]: https://github.com/gotgenes/pi-packages/issues/1078
