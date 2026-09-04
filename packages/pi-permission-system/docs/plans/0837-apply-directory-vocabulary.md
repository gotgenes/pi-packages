---
issue: 837
issue_title: "pi-permission-system: 42% of src files sit at the package root, in a package that already has the directories for them"
---

# Apply the package's directory vocabulary to the `src/` root

## Release Recommendation

**Release:** ship independently

Phase 14 Step 13 carries `Release: independent`, and it is the phase's last unmarked step.
Every commit here is `refactor:`, `test:`, `ci:`, or `docs:` — all skipped changelog types — so this plan cuts no release on its own.
`./scripts/release/next-version.sh pi-permission-system` prints nothing today, and it will still print nothing when this lands; the work auto-batches into whatever `fix:`/`feat:` commit releases next.

## Problem Statement

The package has an organizing vocabulary and stopped applying it.
Sixty-four `.ts` files sit directly at `src/` — 42% of the 152 in the package — while `access-intent/`, `authority/`, `handlers/`, `path/`, and `presentation/` already exist, and several root files have an unambiguous home among them.

The cause is not the reorganization cadence.
It is the absence of a written target layout: each phase re-derived the structure from scratch, so consistency depended on who was planning, and the recorded convention that emerged from that — grow a domain directory only in the phase that rewrites its files — guarantees the lapse by construction, because issue-by-issue work only ever moves files that issues happen to touch and leaves cold files behind.

## Goals

- Move all but five root `src/` files into a domain directory, and mirror the same partition in `test/`.
- Record the resulting layout in `docs/architecture/architecture.md` as a written convention with a stated root allowlist, so later work conforms rather than re-derives.
- Bring the package into conformance with the repo's recorded import-specifier convention, and machine-guard the half of it that is currently unguarded.
- Leave behavior, the public surface, and the test suite unchanged.

This is **not** a breaking change.
`package.json` declares exactly one export (`"." → ./src/service.ts`), a repo-wide grep for `@gotgenes/pi-permission-system/<path>` finds only doc prose and test string fixtures, and `service.ts` stays at the root so the `exports` map and the rollup input are untouched.
Commits are `refactor:`, not `refactor!:`.

## Non-Goals

- **Any behavior change.**
  No production logic is edited.
  A file's contents change only where an import specifier's path changes.
- **Re-partitioning the existing directories.**
  `access-intent/`, `authority/`, `handlers/`, `handlers/gates/`, `path/`, and `presentation/` keep their current members; they only gain the root files assigned to them.
- **Splitting or merging any module.**
  Every file moves intact.
  A file whose placement is arguable moves once to the home this plan names, rather than being restructured to make the placement obvious.
- **Rolling the new lint rule out repo-wide.**
  `pi-subagents` has 76 own-directory alias imports and is held by a peer worktree ([#870]).
  Filed as [#877]; this plan scopes the rule to `packages/pi-permission-system/**` via a `files:` block, matching the two package-scoped blocks already in `eslint.config.js`.
- **Reorganizing `test/helpers/`.**
  Its six files gain `./` conformance fixes (a precondition for the rule) but stay where they are.
- **Rewriting historical documents.**
  Plans, retros, and `docs/architecture/history/` name the old paths as the record of what was true when they were written.
  Only `docs/architecture/architecture.md`, the shipped `docs/*.md` pages, and the package skill are updated.

## Background

Relevant structure and constraints:

- `package.json` `imports` maps `#src/*` → `./src/*` and `#test/*` → `./test/*`; `tsconfig.json` mirrors both, and `vitest.config.ts` aliases them again.
  None of the three enumerates a subdirectory, so a new directory needs no configuration edit.
- `files: ["src", …]` is a bare recursive directory entry, so the published tarball follows the new layout with no allowlist change.
- `eslint.config.js` carries a hand-written `noParentRelativeImports` rule with `fixable: "code"`, whose header comment states the repo convention: parent-relative imports are banned in favour of the alias, and *same-directory `./` imports are intentionally allowed*.
  Only the parent-relative half is enforced.
- Two package-scoped ESLint blocks pin literal paths: the `process.platform` ban at `eslint.config.js:169` (which ignores `src/index.ts`, unaffected) and the ADR-0002 `AccessPath` import ban at `:192`, which names `src/permission-manager.ts` — a file this plan moves.
- `biome.json:59-62` pins `src/expand-home.ts` and `test/expand-home.test.ts` for a `noTemplateCurlyInString` exemption; both move.
- `scripts/generate-permissions-schema.ts:10` imports `../src/config-schema.ts` by relative path.
  It sits outside `tsconfig.json`'s `include` (`["src", "test"]`) and is not invoked by any workflow, so neither `pnpm run check` nor CI would catch a broken specifier there.

Constraints from `AGENTS.md` that apply:

- Architecture module-tree entries describe current behavior, and cite an issue only when the ref encodes an active constraint.
  The tree is re-grouped here, not re-narrated: each entry's prose moves verbatim under its new directory heading.
- A step that renames or relocates a symbol must sweep `.pi/skills/package-*/SKILL.md` and the whole `packages/<PKG>/docs/` tree, not just `src/`.
- Scripted bulk edits across test files cannot tell a mock producer from an assertion, so verification rests on the suite, and on re-reading `toMatchObject`/`objectContaining` sites by hand.

## Design Overview

### The partition

Ten destinations absorb 59 of the 64 root files.
Five stay.

| Destination                    | Count | Members (all currently at `src/` root)                                                                                                                                                    |
| ------------------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config/`                      | 11    | `config-loader`, `config-modal`, `config-paths`, `config-reporter`, `config-schema`, `config-store`, `extension-config`, `extension-paths`, `policy-loader`, `status`, `yaml-frontmatter` |
| `policy/`                      | 10    | `normalize`, `permission-gate`, `permission-manager`, `permission-merge`, `permission-resolver`, `restrictiveness`, `rule`, `scope-merge`, `synthesize`, `wildcard-matcher`               |
| `logging/`                     | 8     | `decision-audit`, `decision-reporter`, `json-safe-stringify`, `log-field-cap`, `log-file-permissions`, `log-redaction`, `logging`, `session-logger`                                       |
| `session/`                     | 7     | `active-agent`, `approval-grant`, `permission-session`, `session-approval`, `session-approval-recorder`, `session-identity`, `session-rules`                                              |
| `tool-input/`                  | 6     | `builtin-tool-input-formatters`, `tool-access-extractor-registry`, `tool-input-formatter-registry`, `tool-input-preview`, `tool-input-prompt-formatters`, `tool-preview-formatter`        |
| `service/`                     | 5     | `bash-advisory-check`, `permission-events`, `permission-ui-prompt`, `permissions-service`, `service-lifecycle`                                                                            |
| `exposure/`                    | 4     | `skill-prompt-sanitizer`, `system-prompt-sanitizer`, `tool-registry`, `tool-surface-baseline`                                                                                             |
| `path/` (exists)               | 4     | `expand-home`, `node-modules-discovery`, `path-normalizer`, `safe-system-paths`                                                                                                           |
| `presentation/` (exists)       | 2     | `pattern-suggest`, `permission-prompts`                                                                                                                                                   |
| `access-intent/bash/` (exists) | 2     | `async-cache`, `bash-arity`                                                                                                                                                               |

The five that stay: `index.ts` (the `pi.extensions` entry), `service.ts` (the `exports` and rollup-input entry), and three package-wide leaves belonging to no domain — `types.ts` (38 consumers spanning every directory), `value-guards.ts` (14 consumers spanning every directory), and `permission-request-id.ts` (the request-id mint, read by `authority/` and `handlers/`).
`pi-subagents` documents six root files the same way, so a small named allowlist is the sibling precedent rather than an exception.

Placements worth stating, because each was contested:

- `status.ts` → `config/`, not `presentation/`.
  It imports only `extension-config` and reflects the yolo flag into Pi's footer; its two consumers are `config-store.ts` (also `config/`) and `handlers/lifecycle.ts`.
  `presentation/` is scoped by ADR 0011 to the ask payload and the renders over it, and a footer status write is not one.
- `policy-loader.ts` → `config/`, not `policy/`.
  `config/` is the layer that reads, validates, and holds configuration; `policy/` is the engine that turns rules into decisions.
  `policy-loader` is file I/O with mtime caching, and its sibling `config-loader` and consumer `config-store` are both in `config/`.
  `yaml-frontmatter.ts` follows it — `policy-loader` is its only consumer.
- `bash-advisory-check.ts` → `service/`.
  The module tree records it as deliberately kept out of `access-intent/` to avoid a domain→handler import; it imports `handlers/gates/bash-command` and its sole consumer is `permissions-service`.
  `service/` is the home that fact was always describing.
- `tool-access-extractor-registry.ts` → `tool-input/` alongside the formatter registry.
  Both read tool input, and the package skill already pairs them as the fact-shaping registries.
- `exposure/` gathers the `before_agent_start` tool-filtering pass the architecture doc calls Phase 1 — the registry, the baseline, and the two prompt sanitizers that narrow what the agent is shown.
- `async-cache.ts` → `access-intent/bash/`.
  Its only consumer in the package is `access-intent/bash/parser.ts`.
  Placing it there rather than inventing a `util/` avoids a bag directory that would re-accumulate exactly what this issue is clearing.

### The written convention

The issue's diagnosis is that no target layout was ever recorded, so `docs/architecture/architecture.md` gains a `### Directory vocabulary` subsection under `## Module structure` stating, per directory, what belongs in it and what does not, plus the five-file root allowlist and the rule for adding to it.

It also supersedes the standing convention at `architecture.md:1012` — *"grow a domain directory in the phase that rewrites its files, never as a big-bang move"* — which originated as a Phase 8 non-goal and was re-applied in Phase 13.
The supersession is written down rather than left implicit, because that convention is a live rule two phase histories cite, and this plan is its counter-example.
The replacement rule is: a new module goes to the directory the vocabulary names, immediately; the root allowlist grows only by an explicit edit to that subsection.

### The import convention and its guard

The repo's recorded convention is `./` for a same-directory target and `#src/`/`#test/` for a cross-directory one.
The package violates it in one direction only — measured on the working tree:

| Scope                 | Own-directory alias imports | Distinct files             |
| --------------------- | --------------------------- | -------------------------- |
| `src/` subdirectories | 92                          | 43                         |
| `src/` root           | 9                           | 5                          |
| `test/`               | 14                          | 6 (all in `test/helpers/`) |
| **total**             | **115**                     | **54**                     |

Nine files spell same-directory neighbours both ways, all in `src/authority/`.
`src/authority/approval-escalator.ts` imports six neighbours as `#src/authority/…` (lines 11-37) and two as `./…` (lines 43-44).

Only 9 of the 115 are in files this move touches, so the conformance pass is **not** justified as move-shrinking.
It is justified as the precondition for the guard: the extended rule reports all 115 as errors, so they must be clear before it can be enabled.
The plan and its commit messages say that, so a later reader does not go looking for a move that never happens to `authority/`.

The guard is a small extension to the rule that already exists.
`noParentRelativeImports` already resolves the package root and already declares `fixable: "code"`; it gains a second report for an `ImportDeclaration` whose `#src/`/`#test/` specifier resolves to the importer's own directory, auto-fixed to `./`.
It is registered through a `files: ["packages/pi-permission-system/**"]` block, alongside the `process.platform` block at `:169` and the ADR-0002 block at `:192`.

One class the rule structurally cannot reach: a specifier passed to `vi.mock()` is a `CallExpression` argument, not an `ImportDeclaration`.
Eight such calls across six test files name a moving module by relative path rather than by alias:

```text
test/permission-session.test.ts:13     vi.mock("../src/active-agent", …)
test/tool-input-preview.test.ts:4      vi.mock("../src/json-safe-stringify.js", …)
test/tool-preview-formatter.test.ts:8  vi.mock("../src/json-safe-stringify.js", …)
test/extension-paths.test.ts:8         vi.mock("../src/node-modules-discovery", …)
test/config-store.test.ts:27,32,36     vi.mock("../src/config-loader" | "../src/status" | "../src/config-reporter", …)
test/handlers/lifecycle.test.ts:17     vi.mock("../../src/status", …)
```

Every `vi.mock`/`vi.doMock` specifier in the package is a string literal — none is computed — so a mechanical sweep is sound once these eight are normalized to `#src/`.
A move sweep that greps only `#src/` would silently break these six files, which is why their normalization is its own preparatory commit ahead of the first move.

### How a move commit works

Each move commit is: `git mv` the files, rewrite every `#src/<old>` specifier to `#src/<new>` across `src/` and `test/`, and convert the `./` edges the move splits.
A `./x` import survives as `./x` when both files land in the same directory and becomes `#src/<new>/x` when they separate.
`tsc` verifies the result exhaustively — every import in the package is either an alias specifier or a same-directory relative one, and both forms are resolved by `tsconfig.json`.

`src/index.ts` and `test/composition-root.test.ts` are touched by nearly every move commit: `index.ts`'s 41 `./` imports include 17 pointing at redistributed root files spanning six of the seven new directories, and `composition-root.test.ts` imports `#src/config-paths`, `#src/extension-config`, and `#src/permission-events`.
Neither mocks anything, so each touch is a mechanical specifier edit.
This is expected, not scope creep.

## Module-Level Changes

### `src/` — 59 files move, contents otherwise unchanged

Per the partition table above.
No file is split, merged, renamed, or edited beyond its import specifiers.

### `test/` — 65 of 71 root files move

Sixty-one map one-to-one onto their `src/` sibling's destination.
Ten have no same-named root module; their homes:

| Test file                                 | Destination            | Reason                                                                               |
| ----------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------ |
| `config-pipeline.test.ts`                 | `test/config/`         | drives `config-loader` + `extension-config`                                          |
| `detect-permissive-bash-fallback.test.ts` | `test/config/`         | tests a `#src/config-loader` export                                                  |
| `permission-manager-unified.test.ts`      | `test/policy/`         | sibling of `permission-manager`                                                      |
| `permission-manager-yolo.test.ts`         | `test/policy/`         | sibling of `permission-manager`                                                      |
| `permission-manager-fail-closed.test.ts`  | `test/policy/`         | sibling of `permission-manager`                                                      |
| `bash-external-directory.test.ts`         | `test/handlers/gates/` | drives `handlers/gates/bash-path-extractor`                                          |
| `bash-effect-invariants.test.ts`          | `test/handlers/gates/` | drives `handlers/gates/bash-external-directory` and `bash-path`                      |
| `path-normalization.test.ts`              | `test/access-intent/`  | closes an existing mirror gap — its subject is `access-intent/path-normalization.ts` |
| `composition-root.test.ts`                | `test/` root           | drives `#src/index`                                                                  |
| `session-start.test.ts`                   | `test/` root           | drives `#src/index`                                                                  |

`test/` root retains six files: the four whose `src/` sibling stays (`permission-request-id`, `service`, `types`, `value-guards`) plus the two composition-root drivers.
`test/helpers/` is unchanged except for its 14 own-directory alias conformance fixes.

### Repo configuration

- `eslint.config.js` — extend `noParentRelativeImports` with the own-directory alias report and auto-fix; add the `files: ["packages/pi-permission-system/**"]` registration block; update `:192`'s path to `packages/pi-permission-system/src/policy/permission-manager.ts`.
- `biome.json:59-62` — update `src/expand-home.ts` → `src/path/expand-home.ts` and `test/expand-home.test.ts` → `test/path/expand-home.test.ts`.

### Package files outside `src/`/`test/`

- `scripts/generate-permissions-schema.ts:10` — `../src/config-schema.ts` → `../src/config/config-schema.ts`, in the `config/` move commit.
  Nothing else catches this: the file is outside `tsconfig.json`'s `include` and `pnpm run gen:schema` runs in no workflow.

### Documentation

- `docs/architecture/architecture.md` — re-group the `## Module structure` tree under the new directory headings, entries carried over verbatim; add the `### Directory vocabulary` subsection with the root allowlist; record the supersession of the `:1012` grow-in-place convention; mark Step 13 `✅` on its heading and its `S13` Mermaid node, with a `Landed:` note.
- `docs/configuration.md:1237` — `src/config-schema.ts` → `src/config/config-schema.ts`.
- `docs/cross-extension-api.md:283` — `src/builtin-tool-input-formatters.ts` → `src/tool-input/builtin-tool-input-formatters.ts`.
- `docs/session-approvals.md:65,79` — `src/bash-arity.ts` → `src/access-intent/bash/bash-arity.ts` (two occurrences).
- `.pi/skills/package-pi-permission-system/SKILL.md` — 42 `src/` path references to re-point.
  This is a repo-root file, not a package file, so it rides the final documentation commit.

A whole-tree sweep (`rg -n 'src/[a-z0-9./-]*\.ts' packages/pi-permission-system/docs .pi/skills`) runs before the documentation commit, with `docs/plans/`, `docs/retro/`, and `docs/architecture/history/` excluded as historical record.

## Test Impact Analysis

This change enables no new unit tests and makes none redundant: every test moves intact and asserts on exactly what it asserted before.

The testable surface is the tooling, not the modules:

1. **The suite itself is the primary instrument.**
   `vitest.config.ts` includes `test/**/*.test.ts`, so a moved test is still collected.
   The collected-test count must be identical before and after every commit — a file moved to a path the glob does not reach would be silently skipped rather than failed.
   Record the baseline count at Step 1 and assert it at each move commit.
2. **The extended ESLint rule** has a real input domain.
   The repo has no `RuleTester` harness, so the rule is verified by running it: `pnpm exec eslint packages/pi-permission-system` must report exactly 115 own-directory violations before the conformance fix and 0 after, and `--fix` must resolve all of them without a second pass reporting new ones.
   Its shapes must include a multi-line `import type { … } from "#src/<own-dir>/x"`, since that form spans lines and five files import the same own-directory module twice (once as `type`, once as value).
3. **The two package-scoped lint guards** are the highest-value check, because a `files:` glob that no longer matches fails silently in the permissive direction.
   Both are probed by hand after the move (see Invariants at risk).
4. **`pnpm run gen:schema`** — run it after the `config/` commit and confirm `git diff --exit-code schemas/permissions.schema.json` is clean.
   Nothing else exercises `scripts/generate-permissions-schema.ts`.
5. **`pnpm pack`** — inspect `tar tzf` once at the end and confirm the tarball carries the new `src/` tree and still excludes `test/` and dev config.

## Invariants at risk

Two lint guards encode security-relevant boundaries by literal file path, and a stale `files:` glob disables them without any gate firing — `tsc` passes, the suite passes, and `eslint` reports success because the rule simply matches nothing.

| Invariant                                                                                                                                    | Where it lives                                                                | Pinned by             | Probe after the move                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `permission-manager.ts` stays string-based and must not import `AccessPath` (ADR-0002, `docs/decisions/0002-path-values-string-boundary.md`) | `eslint.config.js:192`, `files:` naming `src/permission-manager.ts`           | nothing but the glob  | add `import { AccessPath } from "#src/access-intent/access-path";` to `src/policy/permission-manager.ts`, confirm `eslint` errors, revert |
| No `src/` module outside `index.ts` reads `process.platform` (#510)                                                                          | `eslint.config.js:169-170`, `files: src/**/*.ts` with `ignores: src/index.ts` | nothing but the globs | add `const p = process.platform;` to `src/policy/rule.ts`, confirm `eslint` errors, revert                                                |

The `process.platform` glob is `src/**/*.ts`, which is depth-agnostic and survives the move; its `ignores` names `src/index.ts`, which does not move.
It is probed anyway, because the two rules are verified by the same mechanism and confirming one without the other proves nothing about the pair.
Verified at planning time: `src/index.ts:76` is the only real read in the package — the three other matches are doc comments describing the absence of a read.

A third invariant is quantitative: the collected-test count.
Measure it at Step 1 (`pnpm --filter @gotgenes/pi-permission-system test` reports the total) and assert the same number at every subsequent commit.

## TDD Order

Each step ends with `pnpm run check`, `pnpm run lint`, and the full package suite green, and is its own commit.
Steps 1-3 are the Tidy-First preparation; steps 4-13 are the move; step 14 is documentation.

1. **`refactor(pi-permission-system): conform intra-package imports to the same-directory convention`** Rewrite all 115 own-directory alias imports (`#src/<own-dir>/x` → `./x`, `#test/helpers/x` → `./x`) across 54 files.
   Prepares: the guard in step 2, which reports every one of them as an error.
   Say so in the commit body — only 9 of the 115 are in files a later step moves, so this is not move-shrinking and must not be described as such.
   Record the baseline collected-test count in the commit body.
   Verify: `pnpm exec eslint packages/pi-permission-system` clean, and re-read the nine `src/authority/` files that carried both spellings to confirm no import was dropped rather than rewritten.

2. **`ci: flag alias imports that resolve to the importer's own directory`** Extend `noParentRelativeImports` with the own-directory report and its auto-fix; register it via `files: ["packages/pi-permission-system/**"]`.
   Prepares: nothing downstream — it holds step 1's result so the layout convention and the import convention are both guarded rather than both prose.
   Killing mutation: revert one import in `src/authority/approval-escalator.ts` from `./authorizer` to `#src/authority/authorizer` and confirm `pnpm run lint` fails, and that `eslint --fix` restores it.
   A second mutation for the multi-line class: do the same to an `import type { … } from` statement that spans lines, and confirm the fix rewrites only the specifier.
   The rule must stay silent on `packages/pi-subagents` — confirm `pnpm run lint` still passes for the whole workspace, which is the check that the `files:` scoping actually holds.

3. **`test(pi-permission-system): name mocked modules by alias, not relative path`** Rewrite the eight `vi.mock`/`vi.doMock` specifiers listed in Design Overview from `../src/…`/`../../src/…` to `#src/…`.
   Prepares: steps 4-13, whose specifier sweep greps `#src/`.
   A `CallExpression` argument is invisible to both the existing rule and step 2's extension, so without this the `config/`, `logging/`, `path/`, `session/`, and `service/` moves each silently break a test file.
   Killing mutation: point one rewritten `vi.mock` at a module that does not exist and confirm the owning test file fails — a `vi.mock` on an unresolvable specifier must not pass silently.
   Verify by running each of the six touched files individually, not only the full suite.

4. **`refactor(pi-permission-system): move path modules into path/`** `expand-home`, `node-modules-discovery`, `path-normalizer`, `safe-system-paths` and their four tests.
   Update `biome.json:59-62` in this commit — `expand-home` is one of the four, and the exemption is silently voided otherwise.

5. **`refactor(pi-permission-system): move bash leaves into access-intent/bash/`**
   `async-cache`, `bash-arity` and their two tests.

6. **`refactor(pi-permission-system): group logging modules under logging/`**
   The eight modules and their eight tests.

7. **`refactor(pi-permission-system): group configuration modules under config/`** The eleven modules; thirteen tests (the eleven siblings plus `config-pipeline` and `detect-permissive-bash-fallback`).
   Also update `scripts/generate-permissions-schema.ts:10`, and verify with `pnpm run gen:schema && git diff --exit-code schemas/permissions.schema.json` — nothing else exercises that import.

8. **`refactor(pi-permission-system): group the rule engine under policy/`** The ten modules; twelve tests (nine siblings plus the three `permission-manager-*` files).
   Also update `eslint.config.js:192` to `src/policy/permission-manager.ts`.
   Killing mutation for the guard: add an `AccessPath` import to the moved `permission-manager.ts` and confirm `eslint` errors, then revert.
   Do the same for the `process.platform` ban on `src/policy/rule.ts`.
   A relocated `files:` glob is as unpinned at its new path as at its old one, and both rules fail permissively.

9. **`refactor(pi-permission-system): group tool-input shaping under tool-input/`**
   The six modules and their six tests.

10. **`refactor(pi-permission-system): group the tool-exposure pass under exposure/`**
    The four modules and their four tests.

11. **`refactor(pi-permission-system): group session-scoped modules under session/`**
    The seven modules; six tests (`session-approval-recorder` has none).

12. **`refactor(pi-permission-system): group the cross-extension surface under service/`**
    The five modules and their five tests.
    `service.ts` stays at the root — confirm `package.json` `exports`, `rollup.dts.config.mjs`, and `pnpm run verify:public-types` are untouched and passing.

13. **`refactor(pi-permission-system): move the remaining root modules to presentation/ and mirror the test tree`** `pattern-suggest`, `permission-prompts` and their tests into `presentation/`; `bash-external-directory` and `bash-effect-invariants` into `test/handlers/gates/`; `path-normalization` into `test/access-intent/`.
    Confirm `ls src/*.ts` lists exactly five files and `ls test/*.ts` exactly six.
    Confirm the collected-test count still matches step 1's baseline.

14. **`docs(pi-permission-system): record the directory vocabulary and mark Phase 14 Step 13`** Re-group the `## Module structure` tree; add `### Directory vocabulary` with the root allowlist; record the supersession of the `:1012` grow-in-place convention; mark Step 13 `✅` on the heading and the `S13` Mermaid node with a `Landed:` note.
    Update the four shipped-doc path references and the 42 in `.pi/skills/package-pi-permission-system/SKILL.md`.
    Run the whole-tree sweep for stale `src/` paths, excluding `docs/plans/`, `docs/retro/`, and `docs/architecture/history/`.
    Verify: `pnpm exec rumdl check`, and `pnpm pack --pack-destination /tmp` with `tar tzf` confirming the new `src/` tree ships and `test/` does not.

## Risks and Mitigations

| Risk                                                                                                                                               | Mitigation                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `files:`-scoped lint guard silently stops matching after its target moves, disabling a security boundary with every gate green                   | Step 8 probes both guards by hand with a real forbidden import, rather than asserting the glob looks right. The `permission-manager` glob names a literal file path and definitely breaks; the `process.platform` glob is depth-agnostic and should survive, and is probed anyway |
| A moved test file lands outside `test/**/*.test.ts` and is skipped rather than failed                                                              | Step 1 records the collected-test count; every later step asserts it. A skipped file shows as a count drop, which a green run alone would not reveal                                                                                                                              |
| The eight relative-path `vi.mock` specifiers break under a `#src/`-only sweep                                                                      | Step 3 normalizes them before any move. Verified at planning time that all `vi.mock` specifiers in the package are string literals, so no computed form escapes the sweep                                                                                                         |
| `scripts/generate-permissions-schema.ts` breaks undetected — it is outside `tsconfig` `include` and runs in no workflow                            | Step 7 updates it and verifies with `pnpm run gen:schema && git diff --exit-code`. A CI gate for this script is out of scope here                                                                                                                                                 |
| A scripted specifier rewrite corrupts a neighbouring line, or a `toMatchObject`/`objectContaining` assertion absorbs a wrong path and still passes | Rewrites are single-line per-specifier substitutions, never multi-line regexes. Each step runs the full package suite, not only the files its own grep matched                                                                                                                    |
| A peer worktree lands a conflicting `src/` change mid-flight                                                                                       | Only `issue-870` is open and it is scoped to `pi-subagents`. `/sync-worktree` rebases before the land; if another `pi-permission-system` branch appears, this one rebases first because a file move conflicts irreconcilably                                                      |
| `git log --follow` and blame get noisier for 124 files                                                                                             | Accepted, and named in the issue. `--follow` handles a pure rename; the cost falls on multi-file history queries, against a layout that stops being re-derived every phase                                                                                                        |
| The re-grouped module tree drifts from the real layout                                                                                             | Step 14's sweep is mechanical, and the `### Directory vocabulary` subsection gives the next planner something to conform to — which is the issue's actual deliverable                                                                                                             |

## Open Questions

- **Repo-wide rollout of the own-directory rule** — filed as [#877], covering `pi-subagents`' 76 sites and promoting the rule out of the package-scoped block.
  Deferred to a later `pi-subagents` phase by operator decision; the roadmap bullet is written after [#870] lands, to avoid two branches appending to one sweep list.
- **A CI gate for `pnpm run gen:schema`** — the parity test in `test/config-schema.test.ts` catches schema drift, but nothing catches a broken import in the generator itself.
  Not filed; noted here in case a second such script appears.
- **Whether `test/helpers/` should mirror the new directories** — its fixtures are cross-cutting by design, and splitting them is a separate question from this move.

[#870]: https://github.com/gotgenes/pi-packages/issues/870
[#877]: https://github.com/gotgenes/pi-packages/issues/877
