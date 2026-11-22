---
issue: 523
issue_title: "Trim non-runtime dev files from published packages"
---

# Trim non-runtime dev files from published packages

## Release Recommendation

**Release:** ship independently

This is not part of any architecture roadmap batch — it is the packaging follow-up [#484] deferred.
Every change is a `build(<pkg>):` commit (packaging config), which is a `hidden: true` changelog type: it does not cut a release on its own.
The work lands on `main` and auto-batches into the next `feat:`/`fix:` release for the affected packages.
So "ship independently" here means "land it now, do not hold it in a batch" — not "it will cut its own release."

## Problem Statement

Follow-up from [#484], which fixed user-facing-docs publishing but deliberately left a separate over-publishing concern untouched: several packages ship non-runtime dev files to npm.

Two distinct causes:

1. Packages **without** a `files` allowlist publish everything-minus-defaults, so `test/`, `tsconfig.json`, `vitest.config.ts`, `AGENTS.md`, and `.pi/` land in the tarball.
   Affected: `pi-autoformat`, `pi-nocd`, `pi-session-tools`, `pi-subagents-worktrees`.
2. Two packages with a `files` allowlist list dev files explicitly: `pi-permission-system` lists `test` (its ~115-file suite ships), and `pi-subagents` lists `vitest.config.ts`, `AGENTS.md`, and `.prettierignore`.

None of this affects runtime — it is pure tarball bloat.
Scope is deliberately packaging-only: no runtime or API change.

## Goals

- Every published tarball ships runtime code (`src/`, plus `dist/` type bundles where applicable) and user-facing docs only.
- Standardize **all 8 packages** on a single mechanism: an explicit `files` allowlist in `package.json`.
- Remove the now-redundant `.npmignore` denylists so exactly one mechanism governs distribution repo-wide.
- Drop `test/`, `tsconfig.json`, `vitest.config.ts`, `AGENTS.md`, `.pi/`, and `.prettierignore` from every tarball.
- Update the AGENTS.md docs-in-distribution convention to describe the single allowlist mechanism.
- Verify each package with `pnpm pack` so no runtime file is dropped.

This is **not** a breaking change: it alters only what npm packs, not any observable runtime behavior, output shape, config default, or API of the installed extension.
No consumer imports a published `test/`, `tsconfig.json`, or dev-config file (verified below).

## Non-Goals

- No change to `pi-colgrep` or `pi-github-tools` — both already have clean `files` allowlists with no dev files and no `.npmignore`.
- No change to which **docs** ship (that was [#484]).
  `pi-subagents` keeps `docs/architecture` and `docs/decisions` in its allowlist; re-evaluating whether those internal docs belong in the tarball is out of scope.
- No runtime, API, `exports`-map, or `pi`-field change.
- No new automated tarball-contents test — packaging is verified by `pnpm pack` inspection, consistent with [#484].

## Background

Relevant AGENTS.md constraint — the current docs-in-distribution convention codifies a **per-package split**:

- A package with a `files` allowlist excludes internal docs by narrowing the `files` entry itself; an `.npmignore` denylist does **not** prune files inside a directory the allowlist already includes.
- A package with no `files` allowlist excludes internal docs via an `.npmignore` denylist (`docs/plans`, `docs/retro`).

This plan supersedes that split by giving all packages a `files` allowlist, then removing every `.npmignore`.
The AGENTS.md section must be rewritten to match (see Module-Level Changes).

How npm's `files` allowlist behaves (the reason this is low-maintenance):

- A bare directory entry (`"src"`) is **recursive** — new files and new subdirectories under `src/` ship automatically; the allowlist never needs editing when runtime code grows.
- npm **always** auto-includes `package.json`, `README*`, `LICENSE*`, and the `main`/`exports`/`bin` entry point regardless of the allowlist.
- Only *additional* top-level ship targets must be listed explicitly (e.g. `schemas/`, or user-doc paths).
  For docs the pattern is `"docs/*.md"` (a glob matching only top-level docs files) plus explicit user-doc subdirs — which is exactly what keeps `docs/plans/` and `docs/retro/` from ever leaking.

Current per-package facts (from `pnpm pack` inspection and `package.json`):

| Package                | Runtime entry                           | User docs to ship                                           | Extra top-level                                                 | Current mechanism                                            |
| ---------------------- | --------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------ |
| pi-autoformat          | `pi.extensions: src/extension.ts`       | `docs/configuration.md`, `docs/testing.md`, `docs/assets/`  | `schemas/pi-autoformat.schema.json`                             | `.npmignore` (docs/plans, docs/retro)                        |
| pi-nocd                | `pi.extensions: src/index.ts`           | none (README links no docs)                                 | none                                                            | `.npmignore`                                                 |
| pi-session-tools       | `pi.extensions: src/index.ts`           | none                                                        | none                                                            | `.npmignore`                                                 |
| pi-subagents-worktrees | `pi.extensions`/`exports: src/index.ts` | none                                                        | none                                                            | `.npmignore`                                                 |
| pi-permission-system   | `exports: src/service.ts`               | `docs/*.md`, `docs/guides`, `docs/migration`, `docs/assets` | `config/config.example.json`, `schemas/permissions.schema.json` | `files` allowlist (lists `test`) + redundant `.npmignore`    |
| pi-subagents           | `exports: dist/*.d.ts` → `src/*`        | `docs/*.md`, `docs/architecture`, `docs/decisions`          | `dist/` type bundles                                            | `files` allowlist (lists dev files) + redundant `.npmignore` |

Cross-package consumption check (issue's safety note): the only inter-package dependency is `pi-subagents-worktrees` → `pi-subagents`, which resolves through the published `exports` (`dist`/`src`), never `test/`.
The `#test/*` entries in each `package.json` are **self-referencing** internal subpath imports used only within a package's own test suite — not a consumer of another package's published `test/`.
So dropping `test/` from every tarball is safe.

## Design Overview

Single mechanism after this change: every package has a `files` allowlist; no package has an `.npmignore`.

Target `files` allowlist per package (README + LICENSE are auto-included by npm and need not be listed, but the existing packages list them explicitly for clarity; new allowlists follow the same style for consistency):

```jsonc
// pi-autoformat
"files": ["src", "schemas", "docs/*.md", "docs/assets", "README.md", "CHANGELOG.md", "LICENSE"]

// pi-nocd, pi-session-tools, pi-subagents-worktrees (identical)
"files": ["src", "README.md", "CHANGELOG.md", "LICENSE"]

// pi-permission-system — remove "test" from the existing allowlist
"files": [
  "src", "config/config.example.json", "schemas/permissions.schema.json",
  "docs/*.md", "docs/guides", "docs/migration", "docs/assets",
  "README.md", "CHANGELOG.md", "LICENSE"
]

// pi-subagents — remove "vitest.config.ts", "AGENTS.md", ".prettierignore"
"files": ["src", "dist", "docs/*.md", "docs/architecture", "docs/decisions", "CHANGELOG.md"]
```

Redundancy of the surviving `.npmignore` files (why they are safe to delete, not just ignored):

- Once a package has a `files` allowlist, only listed paths (plus npm's auto-includes) ship.
  A denylist cannot *add* exclusions that matter — anything not in the allowlist already does not ship, and per npm semantics the denylist cannot prune inside an allowlisted directory.
- `pi-permission-system`'s `.npmignore` (`node_modules`, `config.json`, `*.log`, `.git`, `.gitignore`, `.npmignore`, `tsconfig.json`) and `pi-subagents`'s `.npmignore` (`test/`, `tsconfig.json`, `.pi`, `biome.json`, etc.) target only paths outside their allowlists → deleting them produces an identical tarball.
- The four denylist packages' `.npmignore` files (`docs/plans`, `docs/retro`) become unnecessary because the new `files` globs (`docs/*.md` + explicit subdirs, or no docs at all) already exclude `docs/plans/` and `docs/retro/`.

Edge cases:

- `pi-autoformat` `docs/*.md` matches `configuration.md` and `testing.md` (top-level) but **not** `docs/plans/*.md` or `docs/retro/*.md` (subdirectories) — internal docs stay out.
  `docs/assets` ships the logo referenced by the README.
- `pi-nocd`/`pi-session-tools`/`pi-subagents-worktrees` have no user-facing docs, so their allowlists omit any `docs` entry entirely — `docs/retro/` and `docs/plans/` never ship.
- `pi-subagents` keeps `dist` (gitignored, regenerated at `prepack`, carries the public `.d.ts` bundles per ADR-0003) and its `docs/architecture`/`docs/decisions` entries unchanged — only the three dev-file entries are removed.
- Per-package `AGENTS.md` files (present in all four denylist packages and `pi-subagents`) stop shipping because they are simply absent from every allowlist — no explicit exclusion needed.

## Module-Level Changes

Packaging config:

- `packages/pi-autoformat/package.json` — add `files` allowlist (above).
- `packages/pi-autoformat/.npmignore` — delete.
- `packages/pi-nocd/package.json` — add `files` allowlist.
- `packages/pi-nocd/.npmignore` — delete.
- `packages/pi-session-tools/package.json` — add `files` allowlist.
- `packages/pi-session-tools/.npmignore` — delete.
- `packages/pi-subagents-worktrees/package.json` — add `files` allowlist.
- `packages/pi-subagents-worktrees/.npmignore` — delete.
- `packages/pi-permission-system/package.json` — remove `"test"` from `files`.
- `packages/pi-permission-system/.npmignore` — delete (redundant).
- `packages/pi-subagents/package.json` — remove `"vitest.config.ts"`, `"AGENTS.md"`, `".prettierignore"` from `files`.
- `packages/pi-subagents/.npmignore` — delete (redundant).

Documentation:

- `AGENTS.md` — rewrite the `### Docs-in-distribution convention` section (lines ~25–33).
  Replace the per-package split (allowlist-vs-denylist) with: all packages use a `files` allowlist; internal docs are excluded by narrowing the allowlist (`docs/*.md` + explicit user-doc subdirs, never `docs/plans`/`docs/retro`); packages with no user-facing docs omit any `docs` entry; no package uses `.npmignore`.
  Keep the `pnpm pack` verification sentence and the `pnpm fallow dead-code` sentence.
  Update the `(Refs #484)` note to also cite `#523`.

Grep confirmation that no other doc/skill references need updating:

- `.pi/skills/package-*/SKILL.md` — the only "allowlist" hits are about the removed `extensions: string[]` subagent allowlist (unrelated); `package-pi-subagents/SKILL.md` line 108 ("shipped via the `package.json` `files` allowlist") stays accurate because `dist` remains in the allowlist.
  No skill edits.
- `README.md` (root) — the Packages table and no-dedicated-skill note are unaffected; packaging does not change the package list.
- No architecture roadmap references `#523` (only `docs/plans/0484-*` and `docs/retro/0484-*` mention it, as the deferred follow-up).

## Test Impact Analysis

This is a packaging-config change with no runtime surface, so there are no red→green unit-test cycles.

- **New tests enabled:** none — packaging is not unit-testable in this repo's convention.
- **Redundant tests:** none.
- **Tests that must stay as-is:** all existing suites are unaffected; `test/` still exists on disk and runs in CI (`pnpm -r run test`) — it is merely excluded from the npm tarball, not from the repo.

Verification is by tarball inspection per package:

```bash
pnpm --filter @gotgenes/<pkg> exec pnpm pack --pack-destination /tmp
tar tzf /tmp/gotgenes-<pkg>-*.tgz | sort
```

Assert the listing contains `src/**` (and `dist/**`, `schemas/**`, user docs where applicable) and does **not** contain `test/`, `tsconfig.json`, `vitest.config.ts`, `AGENTS.md`, `.pi/`, `.prettierignore`, `docs/plans/`, or `docs/retro/`.

## Invariants at risk

- **[#484] docs-in-distribution invariant** — user-facing docs still ship; `docs/plans`/`docs/retro` still never ship.
  At risk for `pi-autoformat` (new allowlist must retain `docs/configuration.md`, `docs/testing.md`, `docs/assets`) and `pi-permission-system` (trimming `test` must not disturb the `docs/*.md`/`guides`/`migration`/`assets` entries added by [#484]).
  Pinned by the per-package `pnpm pack` verification in each build step.
- **[ADR-0003] type-bundle publishing** — `pi-subagents` must keep shipping `dist/public.d.ts` and `dist/settings.d.ts`.
  At risk when editing its `files` array.
  Pinned by asserting `dist/` is present in its tarball, and by `pnpm run verify:public-types` (existing CI step) still passing.

## Build Order

Each step is one commit; verify with `pnpm pack` before committing.
All are `build(<pkg>):` (hidden changelog type) except the final docs commit.

1. **pi-autoformat** — add the `files` allowlist to `package.json`; delete `.npmignore`.
   Verify tarball ships `src/**`, `schemas/pi-autoformat.schema.json`, `docs/configuration.md`, `docs/testing.md`, `docs/assets/**`, and excludes `test/`, `tsconfig.json`, `vitest.config.ts`, `AGENTS.md`, `.pi/`, `docs/plans/`, `docs/retro/`.
   Commit: `build(pi-autoformat): ship runtime and user docs only (#523)`.
2. **pi-nocd** — add the `files` allowlist; delete `.npmignore`.
   Verify tarball ships `src/**`, README, CHANGELOG, LICENSE only.
   Commit: `build(pi-nocd): ship runtime files only (#523)`.
3. **pi-session-tools** — add the `files` allowlist; delete `.npmignore`.
   Verify as pi-nocd.
   Commit: `build(pi-session-tools): ship runtime files only (#523)`.
4. **pi-subagents-worktrees** — add the `files` allowlist; delete `.npmignore`.
   Verify as pi-nocd.
   Commit: `build(pi-subagents-worktrees): ship runtime files only (#523)`.
5. **pi-permission-system** — remove `"test"` from `files`; delete the redundant `.npmignore`.
   Verify tarball no longer contains any `test/` path and still ships `src/**`, `config/config.example.json`, `schemas/permissions.schema.json`, and all `docs` entries from [#484].
   Commit: `build(pi-permission-system): drop test suite from published tarball (#523)`.
6. **pi-subagents** — remove `"vitest.config.ts"`, `"AGENTS.md"`, `".prettierignore"` from `files`; delete the redundant `.npmignore`.
   Verify tarball still ships `src/**`, `dist/public.d.ts`, `dist/settings.d.ts`, and `docs` entries, and no longer contains `vitest.config.ts`, `AGENTS.md`, or `.prettierignore`.
   Commit: `build(pi-subagents): drop dev config from published tarball (#523)`.
7. **AGENTS.md** — rewrite the docs-in-distribution convention for the single allowlist mechanism; cite `#523`.
   Commit: `docs: standardize distribution on files allowlists (#523)`.

Ordering: packages first (independent of each other), docs-convention update last so it describes the achieved end state.

## Risks and Mitigations

- **Risk: a runtime file is accidentally excluded by a too-narrow allowlist.**
  Mitigation: `src` is a recursive directory entry, so all runtime modules ship by construction; each step verifies the tarball with `pnpm pack` before committing.
- **Risk: deleting a redundant `.npmignore` silently changes the tarball.**
  Mitigation: the allowlist fully supersedes each denylist (paths targeted are outside the allowlist); the per-step `pnpm pack` diff confirms an identical file set for pi-permission-system and pi-subagents apart from the intended dev-file removals.
- **Risk: `pi-subagents` type bundles or docs regress.**
  Mitigation: assert `dist/` and the `docs` entries remain in its tarball; existing `verify:public-types` CI step guards the public type surface.
- **Risk: a consumer relied on a published `test/` helper.**
  Mitigation: verified none do — `#test/*` is a self-referencing internal subpath alias, and the only cross-package dependency resolves through `exports`, not `test/`.

## Open Questions

- None.
  The one design fork (allowlist vs. denylist mechanism) was resolved with the operator: standardize all 8 packages on `files` allowlists and remove every `.npmignore`.

[#484]: https://github.com/gotgenes/pi-packages/issues/484
