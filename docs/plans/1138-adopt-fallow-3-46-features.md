---
issue: 1138
issue_title: "Evaluate fallow 3.46 features: mutation, audit --staged, publicFiles, package-cycle, V8 coverage, test_reach"
---

# Adopt the fallow 3.46 features that earn their place

## Release Recommendation

**Release:** ship independently

The issue is `scope:repo` and sits in no package roadmap.
Every commit is `build:` or `docs:`, so no package release is cut; the only files under `packages/` are the nine `vitest.config.ts` files, and `build:` is a skipped changelog type.

## Problem Statement

[#1137] upgraded fallow from 3.22.0 to 3.46.0 and deliberately adopted none of its new functionality.
This issue evaluates six of those features (`fallow mutation`, `fallow audit --staged`, boundary `publicFiles`, the `package-cycle` rule, V8 coverage input, and the review brief's `test_reach`), plus the `private-type-leak` warning class the type-aware run added, which an issue comment raised after the upgrade landed.
The deliverable is a decision per feature, plus the config and doc changes that put each decision into effect.

## Goals

The operator's decisions, each resting on a measurement taken in this planning session:

- **`fallow mutation`:** adopt it as an on-demand recipe.
  Make it runnable from the repo root by setting `root: import.meta.dirname` in each package's Vitest config, and document the recipe in the `fallow` skill.
  No workflow step runs it.
- **`fallow audit --staged`:** add it to `prek.toml` as a pre-commit hook.
- **`package-cycle`:** raise it from `warn` (the default) to `error`.
- **`private-type-leaks`:** set it to `off`; re-enabling it is part of [#1140].
- **Coverage:** swap the root devDependency `@vitest/coverage-istanbul` for `@vitest/coverage-v8`, and drop `--coverage.provider istanbul` from the skill recipes.
- **`publicFiles`:** decline it for now; the barrel work it needs is [#1140].
- **`test_reach`:** decline; the `pre-completion-reviewer` does not read it.
- Not breaking: no published package's behavior, output, or defaults change.

## Non-Goals

- **`index.ts` barrels and `publicFiles`.**
  These are deferred to [#1140], which also re-enables `private-type-leaks`.
  pi-permission-system's Phase 16 records it as deferred to a later phase (`b6c8a833`).
- **Wiring mutation testing into the `pre-completion-reviewer` or CI.**
  The operator chose the on-demand recipe.
  A per-review run costs minutes (5 m 14 s measured on a 6-commit pi-permission-system range), and a whole-package pi-permission-system run would take hours (estimated: 12,540 mutants).
- **Wiring `test_reach` into the `pre-completion-reviewer`.**
  `.pi/agents/pre-completion-reviewer.md` stays unchanged (see Module-Level Changes).
- **The `fallow architecture` command.**
  It is [#1139].
  This plan only changes the `package-cycle` severity, and the rule key carries over to whichever command reports it.
- **CI's `audit` step.**
  It stays `pull_request`-only; the pre-commit hook covers main-lane commits instead.
- **The two `workspace_diagnostics` 3.46 prints** (`rule-packs-not-configured` and `entry-pattern-redundant` for `packages/*/src/index.ts`).
  Both are unrelated to the features under evaluation.

## Background

- `.fallowrc.json` sets `rules` severities and the boundary zones; fallow 3.46.0 is pinned via the `catalog:` entry in `pnpm-workspace.yaml`.
- `prek.toml` runs `invisible-characters`, `unicode-escapes`, `biome`, `eslint`, and `rumdl-fmt` at the pre-commit stage, and `committed` at commit-msg.
  `README.md` § Setup and `AGENTS.md` § Tooling both list those hooks in prose.
- `.github/workflows/ci.yml` runs `fallow audit --base` only `if: github.event_name == 'pull_request'`.
  Main-lane work fast-forwards straight onto `main`, where only `fallow dead-code` gates, so audit's complexity and duplication checks never run on an operator commit today.
- Each package's `vitest.config.ts` sets `include: ["test/**/*.test.ts"]` with no `root`, so Vitest resolves it against the current directory.
  `pnpm -r run test` runs from each package directory, so that works; `fallow mutation` runs Vitest from the repo root, so it does not.
- The `fallow` skill (§ Coverage) and the `improvement-discovery` skill (§ discovery reads) carry the coverage recipe with `--coverage.provider istanbul`.
- AGENTS.md constraint: pnpm only; an edited `.pi/skills/` body is a snapshot for sessions that already read it.

## Design Overview

### How each finding was produced

Every number below was measured in this session against fallow 3.46.0 on the real tree, unless it is labeled estimated.
Probes that edited files ran either on a scratch file reverted afterwards (`git status` clean) or in a throwaway worktree, `/tmp/wt-1138`, of `d193e6f1`, with `pnpm install --frozen-lockfile --offline`.

| Feature                  | Probe                                                                                                         | Result                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mutation`, root run     | `fallow mutation packages/pi-nocd/src` (with and without `--runner-config packages/pi-nocd/vitest.config.ts`) | `partial (test-files-not-discovered)`, 0 killed                                                                                                                                |
| `mutation`, with `root`  | A copy of the config with `root: import.meta.dirname`                                                         | pi-nocd: 8/8 killed in 3 s. pi-autoformat (`--runner-project unit`, `--max-mutants 20`): 18 killed, 2 survived, in 12.6 s; its unit suite still passes 321 tests with the edit |
| `mutation`, cost         | Whole pi-github-tools                                                                                         | 441 mutants, 44 s, score 69.1%                                                                                                                                                 |
| `mutation`, cost         | `--base 59f1b42f~1` (a pi-permission-system range whose plans named a killing mutation per step)              | 254 mutants, 5 m 14 s, score 92.3%, 15 survivors; 60 "no coverage" from an unrelated changed `scripts/` file                                                                   |
| `mutation`, scope        | `--workspace`, and a path plus `--base`                                                                       | Both rejected: changed-code scope cannot be narrowed to one package                                                                                                            |
| `audit --staged`, replay | `audit --base <sha>~1` at each of the last 60 commits touching `packages/*/src`                               | 50 pass, 8 warn, 2 fail (`cd6afbf5`: complexity; `7307caed`: 2 unused class members under the 3.46 binary); about 2 s each                                                     |
| `audit --staged`, hook   | The planned `prek.toml` entry in the worktree                                                                 | A staged unused export: `Failed`, exit 1. A docs-only staging: `(no files to check)Skipped`. A new module whose only consumer is its new test: passes                          |
| `publicFiles`            | `publicFiles: ["index.ts"]` on both `autoDiscover` zones                                                      | 462 `boundary-violation` findings; 2 of 20 zone directories have an `index.ts`                                                                                                 |
| `package-cycle`          | Baseline `dead-code`, plus a seeded `pi-permission-system` → `pi-permission-model-judge` re-export            | 0 findings today; the seed is also caught by `circular-dependencies` and `unlisted-dependencies` (both `error`)                                                                |
| V8, raw dumps            | `NODE_V8_COVERAGE=<dir>` with Vitest's default pool and with `--pool forks`                                   | Dumps contain 0 `src` scripts (workers write nothing)                                                                                                                          |
| V8 provider              | `@vitest/coverage-v8@5.1.1` vs Istanbul on pi-github-tools and pi-subagents, fed to `health --coverage`       | Identical complexity findings and per-file `crap_max` across 82 `src` files; wall time 0.8 s vs 1.5 s and 4.5 s vs 4.6 s (one run each)                                        |
| V8 default               | `vitest run --coverage` with no provider flag, today                                                          | `MISSING DEPENDENCY  Cannot find dependency '@vitest/coverage-v8'`                                                                                                             |
| `test_reach`             | `review --brief --base <sha>~1` at the same 60 commits                                                        | 78 changed exports, 2 `none` (both `COMMAND_BEARING_LOG_KEYS`, a false lead), 0 `mocked-only`                                                                                  |
| `private-type-leak`      | `dead-code --type-aware` with the rule at its 3.46 behavior, then `off`                                       | 48 → 0; exit 0 either way                                                                                                                                                      |

### `fallow mutation`: why `root`, and the recipe

`--runner-config` hands fallow the package's config, but Vitest still resolves `include` against the repo root.
Setting `root: import.meta.dirname` makes each config self-locating; `pnpm -r run test` already runs from the package directory, so its result is unchanged.
The recipe the `fallow` skill gains:

```bash
# A package, a directory, or one file under it
pnpm --silent fallow mutation packages/<PKG>/src --runner-config packages/<PKG>/vitest.config.ts
# The code changed since a ref, against one package's tests
pnpm --silent fallow mutation --base <ref> --runner-config packages/<PKG>/vitest.config.ts
# Count first, run nothing
pnpm --silent fallow mutation packages/<PKG>/src --runner-config packages/<PKG>/vitest.config.ts --plan
```

pi-autoformat adds `--runner-project unit`, matching the coverage recipe's `--project unit`.
The skill states that a survivor is a lead, not a verdict: equivalent mutants survive (for example `grants.length > 0` → `!= 0`), and so do mutants hidden by `toEqual`'s tolerance of `undefined` properties.
It also states that under `--base`, mutants in a different package's changed files report as "no coverage".

### `audit --staged`: the hook entry

```toml
{ id = "fallow-audit", name = "fallow audit", entry = "pnpm --silent fallow audit --staged --quiet", language = "system", pass_filenames = false, types_or = ["ts", "javascript", "json"] },
```

It goes last in the `local` repo block, after `biome` and `eslint`: those rewrite files, and the audit should judge the staged result.
`pass_filenames = false` is required because `--staged` reads the index itself.
`types_or` keeps a markdown-only commit from paying for the run; `json` covers `.fallowrc.json` and `package.json`, which change what the audit sees.
The audit fails only on findings the staged change **introduces** (`--gate new-only` is the default), so an inherited finding never blocks a commit.

### Coverage swap

`@vitest/coverage-v8` writes the same Istanbul-format `coverage-final.json` that `fallow health --coverage` already reads.
V8 is Vitest's default provider, so the recipe drops `--coverage.provider istanbul`, and a bare `vitest run --coverage` starts working.
That includes pi-autoformat's config, which sets `coverage.reporter` without naming a provider.
`@vitest/coverage-v8@5.1.1` was published 2026-11-18T07:35:10Z, outside `minimumReleaseAge`.

### Config rules

```jsonc
"package-cycle": "error",
"private-type-leaks": "off",
```

Both keys come from `fallow config-schema` (`package-cycle` and `private-type-leaks`, whose finding type is the singular `private-type-leak`).
`package-cycle` at `error` adds coverage only for a cycle between packages that list each other as dependencies with no file-level loop; today every seeded cycle is already caught by two other `error` rules.

## Module-Level Changes

| File                                        | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/*/vitest.config.ts` (9 files)     | Add `root: import.meta.dirname`                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `package.json`                              | `@vitest/coverage-istanbul` → `@vitest/coverage-v8` in `devDependencies`                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `pnpm-workspace.yaml`                       | Catalog entry renamed, and its comment rewritten (V8 provider, Istanbul-format output, root-only)                                                                                                                                                                                                                                                                                                                                                                                           |
| `pnpm-lock.yaml`                            | Regenerated by `pnpm install`                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `.fallowrc.json`                            | `package-cycle: error`, `private-type-leaks: off`                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `prek.toml`                                 | New `fallow-audit` hook                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `.pi/skills/fallow/SKILL.md`                | § Coverage: recipe without the provider flag, and the V8 finding replaces "whether to switch is #1138". New § Mutation testing. § The type-aware companion: the "48 of them, untriaged" sentence becomes "off; see [#1140]". § Architecture boundaries: `publicFiles` declined pending [#1140], plus `package-cycle` at `error`. § Change review: `test_reach` measured and not read, plus the audit hook. Quick reference: `fallow:audit` described as the PR gate and the pre-commit hook |
| `.pi/skills/improvement-discovery/SKILL.md` | Coverage recipe without `--coverage.provider istanbul`                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `README.md` § Setup                         | Hook list gains fallow audit                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `AGENTS.md` § Tooling                       | Hook sentence gains fallow audit                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Predicted unchanged, and the claims each rests on:

- `.pi/agents/pre-completion-reviewer.md`: neither mutation nor `test_reach` is wired into it (operator decisions).
  Its `pnpm run lint` line ("Biome, ESLint, and rumdl linters") describes `lint`, not the hooks.
- `.github/workflows/ci.yml`: the audit step stays PR-only; `dead-code` exit status is unchanged because `package-cycle` has 0 findings.
- `packages/pi-permission-system/docs/architecture/architecture.md:1150` ("real Istanbul coverage"): it records a past measurement, and the V8 provider's output is still Istanbul-format.
- `packages/*/package.json`: no package manifest names a coverage provider.
- `.pi/skills/code-design/SKILL.md`: the `index.ts` rule stays as written; [#1140] is the work that makes it enforceable.

## Test Impact Analysis

This is a config and docs change, so its testable surface is the commands the new config and text prescribe.
`/build-plan` re-runs each one as a step's verification:

| Command                                                                                                                                                                    | Expected (measured at planning, except where noted)                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm --silent fallow mutation packages/pi-nocd/src --runner-config packages/pi-nocd/vitest.config.ts`                                                                     | `Score 100.0%  killed 8`, `complete`                                                                  |
| `pnpm --silent fallow mutation packages/pi-autoformat/src/config-loader.ts --runner-config packages/pi-autoformat/vitest.config.ts --runner-project unit --max-mutants 20` | `killed 18  survived 2`, `partial (mutant-limit)`                                                     |
| `pnpm --filter @gotgenes/pi-nocd exec vitest run --coverage --coverage.reporter json --coverage.reportsDirectory /tmp/cov-pi-nocd`                                         | Exit 0 and a `coverage-final.json` (today: `MISSING DEPENDENCY`)                                      |
| `pnpm --silent fallow health --coverage /tmp/cov-pi-github-tools/coverage-final.json --workspace @gotgenes/pi-github-tools --format json --quiet`                          | 2 complexity findings (`findRun`, `watchRun`), as with Istanbul                                       |
| `pnpm --silent fallow dead-code --type-aware --format json --quiet`                                                                                                        | `private_type_leaks` absent or empty (today 48)                                                       |
| `pnpm fallow dead-code`                                                                                                                                                    | Exit 0                                                                                                |
| `prek run fallow-audit` with a staged unused export                                                                                                                        | `Failed`, and the output names the export                                                             |
| `prek run fallow-audit` with only a markdown file staged                                                                                                                   | `(no files to check)Skipped`                                                                          |
| `pnpm run test`                                                                                                                                                            | The same per-package test counts as the pre-change baseline (record it at the start of `/build-plan`) |

## Invariants at risk

- **CI's `main` gate stays green.**
  `fallow dead-code` exits 0 today (measured), and the `package-cycle: error` change adds 0 findings (measured).
  Pinned by the `pnpm fallow dead-code` verification in step 3, and by CI's `Fallow dead-code gate` on push.
- **Every package's test suite runs the same tests.**
  `root` is the directory `pnpm -r run test` already runs from.
  Measured on pi-autoformat's unit project (321 tests pass with the edit); step 1 re-measures all nine against the recorded baseline.
- **The pi-autoformat acceptance project stays separate** ([#678]).
  The `root` edit leaves `projects` untouched; step 1 runs `pnpm --filter @gotgenes/pi-autoformat run test:acceptance`.

## Build Order

Each step is one commit; run `pnpm run check`, `pnpm run lint`, and `pnpm fallow dead-code` before each commit.

1. `build: let fallow mutation run each package's tests from the repo root`.
   Add `root: import.meta.dirname` to the nine `packages/*/vitest.config.ts` files.
   Verify: the per-package counts from `pnpm run test` match the baseline; pi-autoformat `test:acceptance` passes; the two `fallow mutation` rows in Test Impact Analysis reproduce.
2. `build: swap Istanbul for Vitest's default V8 coverage provider`.
   `pnpm remove -w @vitest/coverage-istanbul` and `pnpm add -D -w @vitest/coverage-v8@catalog:`, after renaming the catalog entry in `pnpm-workspace.yaml` and rewriting its comment.
   Drop `--coverage.provider istanbul` from the `fallow` and `improvement-discovery` skill recipes, in the same commit so no commit carries a broken recipe.
   Verify: the coverage and `health --coverage` rows in Test Impact Analysis, and `grep -rn coverage-istanbul --include=*.json --include=*.yaml . --exclude-dir=node_modules` prints nothing.
3. `build: gate package cycles and silence private-type leaks in fallow`.
   `.fallowrc.json` rules.
   Verify: the `dead-code` and `--type-aware` rows.
4. `build: audit staged changes with fallow before each commit`.
   Add the `prek.toml` hook, and update `README.md` § Setup and the `AGENTS.md` § Tooling hook sentence.
   Verify: the two `prek run fallow-audit` rows, then revert the probe.
   Back up any probe file with `cp` first, per `git-workflow`.
5. `docs: record the fallow 3.46 feature decisions in the fallow skill`.
   Add the new § Mutation testing, and make the § The type-aware companion, § Architecture boundaries, § Change review, and quick-reference edits listed in Module-Level Changes.
   Verify: `pnpm exec rumdl check .pi/skills/fallow/SKILL.md`; dry-run each new command block once.

## Risks and Mitigations

- **The hook blocks a TDD commit mid-plan.**
  2 of 60 replayed commits would have failed (measured).
  A new module whose only consumer is its own test passes (measured), so a `refactor:` step that ships its tests does not trip it.
  A module with neither a test nor a consumer fails, as `fallow dead-code` would at the next push.
  Mitigation: the hook fails only on findings the change introduces; the remedy is the finding's fix or a `fallow-ignore` with rationale, never `--no-verify`.
- **The hook slows every code commit.**
  About 2 to 3.6 s per staged code change (measured); markdown-only commits skip it (measured).
- **A `root` edit changes test discovery.**
  Mitigation: step 1 compares per-package counts against a baseline recorded before the edit.
- **`pnpm add` of `@vitest/coverage-v8` trips `minimumReleaseAge`.**
  5.1.1 was published 2026-11-18; if a newer patch resolves under `^5.1.1` and is too young, pin the catalog to the version `pnpm view` reports as old enough.
- **Sessions running when this lands keep the old skill text.**
  An edited skill body is a snapshot for a session that already read it (AGENTS.md § Stale skill bodies); nothing to do beyond the normal `git pull`.

## Open Questions

- Should the review brief consume a saved mutation report (`review --brief --mutation-report .fallow/mutation/last-report.json`) when one exists?
  Defer until the recipe has been used enough to know whether reports exist at review time.

[#678]: https://github.com/gotgenes/pi-packages/issues/678
[#1137]: https://github.com/gotgenes/pi-packages/issues/1137
[#1139]: https://github.com/gotgenes/pi-packages/issues/1139
[#1140]: https://github.com/gotgenes/pi-packages/issues/1140
