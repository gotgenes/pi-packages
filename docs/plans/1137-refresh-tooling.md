---
issue: 1137
issue_title: "chore: refresh tooling — pnpm 12, rumdl 0.3, fallow 3.46, TypeScript 7 (side-by-side), vitest 5"
---

# Refresh the repo tooling: pnpm 12, rumdl 0.3, fallow 3.46, TypeScript 7 beside 6, Vitest 5

## Release Recommendation

**Release:** ship independently

The issue carries `scope:repo` and belongs to no improvement roadmap.
Every commit here is typed `build:` or `style:`, both skipped changelog types, so no package should have a release pending from this work; `/ship` confirms with `./scripts/release/next-version.sh <pkg>` rather than assuming.
The `build:` typing matters because seven commits touch `packages/**` (nine `package.json` files, two nested `biome.json` files, one `src/` line, and three release-scope markdown files), and a `chore:` commit there would cut a patch release per package (`releasing` skill).
The precedent is `build(pi-nocd): develop against Pi 1.0.0`.

## Problem Statement

The shared dev toolchain has drifted behind the registry again, and three of the drifted tools were held back by decisions that no longer stand.
The rumdl pin at 0.2.24 cites a reflow defect that upstream fixed; [#1066] proposed re-measuring before lifting it.
TypeScript 7 was recorded as blocked in [#867], but the TypeScript 7.0 announcement documents a side-by-side setup that keeps TypeScript 6's compiler API for the tools that need it.
The other bumps (pnpm 12, fallow 3.46, Vitest 5, and the minor releases) are routine but each can surface findings on code nobody touched.

## Goals

- Move every tool in the issue's drift table to the version the registry's `latest` dist-tag names at implementation time, one revertible commit per tool (or per small group).
- Run TypeScript 7 for `tsc` while TypeScript 6 stays installed, under the name `typescript`, for typescript-eslint and rollup-plugin-dts, declared explicitly at the root.
- Lift the rumdl pin to 0.3.x and adopt the new MD076 list-spacing rule at its default, with the reflow applied in the same commit as the pin.
- Keep every commit green on the full gate set (defined under Build Order).
- Correct the agent docs whose claims the upgrades invalidate: the `fallow`, `testing`, `markdown-conventions`, and `code-design` skills, and `CONTRIBUTING.md`.

The change is not breaking: no published package's runtime code, exports, or defaults change.

## Non-Goals

- Adopting fallow functionality new since 3.22: `fallow mutation`, `audit --staged`, boundary `publicFiles`, raising `package-cycle`, V8 coverage input, and the review brief's `test_reach`.
  Filed as [#1138].
- Moving CI's boundary reporting from `fallow dead-code` to `fallow architecture`; 3.46 deprecates the former's architecture options but keeps reporting them until the next major.
- Regenerating `packages/pi-subagents/docs/fallow-snapshot.json` and `packages/pi-permission-system/docs/fallow-snapshot.json` (both record `"version": "3.22.0"`); they are phase-close artifacts that are never hand-edited.
- `@types/node` (stays on 22: Pi requires Node `>=22.19.0` and CI runs Node 22) and runtime/product dependencies (`zod`, `typebox`, `web-tree-sitter`, the `@earendil-works/pi-*` SDK), as the issue excludes them.
- Pruning `minimumReleaseAgeExclude` entries other than the ones a bumped tool retires (the fallow `@3.22.0` set and `globals@17.12.0`).
- Approving the agent skills pnpm 12 offers from the `fallow` package (`Agent skills awaiting approval: fallow.`); this repo maintains its own `fallow` skill.
  `pnpm approve '!fallow'` would also deny fallow's build script, so leave it awaiting.
- Leaving side-by-side TypeScript: the exit is typescript-eslint's `projectService.EXPERIMENTAL_backend` targeting TypeScript 7.1 (typescript-eslint/typescript-eslint#10940), not yet stable.
- Fixing rumdl's cache staleness ([#879]); measurements here use `--no-cache` because of it.

## Background

The versions live in four places that this plan treats as one surface:

- `package.json` `packageManager` (pnpm), which CI reads through `pnpm/action-setup@v6`.
- The `pnpm-workspace.yaml` catalog, which every package's `devDependencies` reference as `catalog:`, plus its `minimumReleaseAgeExclude` list.
- `prek.toml` hook revs for `rumdl-pre-commit` (in lockstep with the rumdl catalog pin) and `committed`.
- Tool configs each major bump forces: `biome.json` (plus `packages/pi-subagents/biome.json` and `packages/pi-permission-model-judge/biome.json`), `.fallowrc.json`, `.rumdl.toml`.

The `pi-autoformat` extension runs `pnpm exec rumdl fmt` on every `.md` an agent writes and `pnpm exec biome check --write` on `.ts`/`.json` (`.pi/extensions/pi-autoformat/config.json`), so the rumdl and Biome versions also decide how every agent-written file is reflowed.

AGENTS.md constraints that apply: pnpm only; a dependency change commits its `pnpm-lock.yaml` in the same commit; versions are read from the registry, never authored (Principle 4).
The `code-design` skill's tooling rule says to move a touched tool to the latest published version and to stage any `minimumReleaseAgeExclude` entry pnpm adds for a release younger than 24 h.

Prior rounds: [#866] did the last refresh (four `chore:` commits touching only root files), and its retro records `biome migrate` writing `"root": false` into the root `biome.json`, which had to be rejected.
[#1037] held the rumdl pin with the comments the current `pnpm-workspace.yaml` and `prek.toml` carry.

## Design Overview

### How the evidence was produced

All probes ran at planning time in a throwaway worktree of `7afdd7de` (`/tmp/probe-1137`), applying the bumps cumulatively in the issue's order; rumdl ran on a `git archive HEAD` copy with `--no-cache` and the repo's `.rumdl.toml`.
Every tool involved is deterministic, so n = 1 per step.
Local Node is 26.13.1; CI runs Node 22, so the test results are measured on a newer runtime than CI's.

| Step           | Probe                                          | Result (measured)                                                                                                        |
| -------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| pnpm 12.21.0   | `pnpm install --frozen-lockfile`               | no `ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS`; lockfile gains a 167-line `packageManagerDependencies` document header    |
| TS alias shape | `pnpm -r run check`                            | 9 of 9 pass on `tsc` 7.0.2 (2.4 s wall)                                                                                  |
| TS alias shape | `eslint packages/`                             | exit 0; typescript-eslint resolves `typescript` to `@typescript/typescript6@6.0.2` (a wrapper over `typescript@6.0.3`)   |
| TS alias shape | both `verify:public-types`                     | pass                                                                                                                     |
| TS alias shape | `pnpm run test`                                | pass, counts unchanged                                                                                                   |
| TS alias shape | fallow 3.22 `dead-code`                        | fails: `@typescript/native` unused in all 9 packages                                                                     |
| TS alias shape | fallow 3.46 `dead-code`                        | does not flag `@typescript/native` or root `typescript`                                                                  |
| Vitest 5.1.1   | `pnpm run test`, acceptance, Istanbul coverage | pass, counts identical to Vitest 4, no code changes                                                                      |
| Minor bumps    | `pnpm run lint`                                | Biome 2.6.8 reports 962 `.md` and 3 YAML files unformatted; typescript-eslint 8.73.0 reports one unused `eslint-disable` |
| fallow 3.46.0  | `fallow dead-code`                             | exit 1, detailed below                                                                                                   |

Test-count baseline (Vitest 4 and 5 identical): root 297; pi-nocd 7, pi-github-tools 119, pi-colgrep 119, pi-autoformat 321, pi-permission-model-judge 90, pi-session-tools 251, pi-subagents-worktrees 74, pi-subagents 2189, pi-permission-system 6527; pi-autoformat acceptance 2.

### Order and dependencies

The issue's order holds, with one dependency it did not name: fallow must land before TypeScript 7.
Fallow 3.22 does not map the `tsc` binary to the `@typescript/native` alias and reports it as an unused devDependency (an `error` rule here); 3.46 maps it.

1. Minor bumps (Biome, ESLint, typescript-eslint, globals, rollup, committed).
2. fallow 3.46 with the type-aware companion.
3. pnpm 12.
4. Vitest 5.
5. TypeScript 7 beside TypeScript 6.
6. rumdl: hand repairs, then the pin and the reflow in one commit.

### Biome 2.6: turn off its new Markdown and YAML formatters

Biome 2.6 formats Markdown and YAML by default.
Markdown belongs to rumdl (the `pi-autoformat` `.md` chain runs only rumdl), and Biome's YAML formatter rewrites `pnpm-workspace.yaml`'s single-quoted `minimumReleaseAgeExclude` entries to double quotes, which pnpm writes back single-quoted on its next exclusion.
Both formatters were inert under 2.5, so disabling them preserves current behavior:

```jsonc
// biome.json (added)
"markdown": { "formatter": { "enabled": false } },
"yaml": { "formatter": { "enabled": false } }
```

`biome migrate --write` moves the `$schema` URL in all three `biome.json` files; in the probe it changed nothing else, but [#866]'s retro saw it write `"root": false` into the root file, so diff the root file before staging.
With those two changes, Biome 2.6.8 checks 2241 files clean (measured).

typescript-eslint 8.73.0 no longer reports `no-unnecessary-condition` at `packages/pi-permission-system/src/config/config-modal.ts:62`, so the directive there is unused and fails lint; delete it in the same commit.

### fallow 3.46: four config changes return `dead-code` to zero findings

Measured on 3.46.0 against the unchanged tree:

- **`dev-dependency-in-production` (error):** `scripts/lint/unicode-escapes.mjs` imports `typescript-eslint`, and `scripts/**/*.mjs` is declared under `entry`, which 3.46 treats as a runtime root.
  Move the glob to `supportEntry`, the config key fallow's own message and schema prescribe for dev scripts.
- **`unlisted-binaries` (warn):** `prek` in the root `prepare` script; prek is a system install, so add `"ignoreBinaries": ["prek"]`.
- **`boundary-violation` (warn) ×2:** `exposure/skill-prompt-sanitizer.ts:4` and `service/permissions-service.ts:20` reach `config/config-schema.ts` through `types.ts`'s re-export (3.31.0 follows re-export chains).
  Both are `import type`, so add `"pi-permission-system/config"` to the `allowTypeOnly` of the `pi-permission-system/exposure` and `pi-permission-system/service` rules, keeping the zero-violation baseline the `fallow` skill describes.
- **Zone-glob warning:** `packages/<pkg>/src/*.ts` now matches one folder level only, which is the `<pkg>/core` zones' intent.
  `fallow list --boundaries` reports identical file counts for all 22 zones on 3.22 and 3.46, so set `"minimumVersion": "3.46.0"`, which the warning names as the way to acknowledge the one-level match.

With all four applied, `fallow dead-code` exits 0 with no findings, `fallow audit --base 7afdd7de` exits 0 (two `weakened-tests` warnings on the `.fallowrc.json` edits themselves), and the full `fallow` run exits 1 as before; CI runs it with `continue-on-error` (all measured).

`fallow-type-aware` is no longer a dependency of `fallow` 3.46 (its `dependencies` are `detect-libc` plus the eight `@fallow-cli/*` binaries), so add it as a root devDependency in a catalog entry beside `fallow`.
Installed, `fallow type-aware status` reports `available (3.46.0, protocol 9, TypeScript 7.0.2)`, and fallow does not flag it as unused (measured).
The `--symbol-impact` false negative the `fallow` skill records is fixed: `buildAgentPrompt` now lists `src/index.ts` (measured).

### pnpm 12

Set `packageManager` to the `latest` dist-tag at implementation time.
`latest` read `12.21.0` at planning; `12.22.0` exists but sits on `next-12`, so do not take the newest version number blindly.
`--frozen-lockfile` installs succeed and rewrite the lockfile with the `packageManagerDependencies` header; commit that churn with the bump.
`globalShims` keys off `devEngines.runtime`/`engines.runtime`; this repo declares only `engines.node`, so no shim activates.

### TypeScript 7 beside TypeScript 6: the documented alias pair

The catalog maps both names; every package that runs `tsc` lists `@typescript/native`, and the root lists `typescript` so typescript-eslint's TS 6 copy is declared rather than auto-installed as a peer:

```yaml
# pnpm-workspace.yaml catalog
"typescript": "npm:@typescript/typescript6@^6.0.2"   # compiler API: typescript-eslint, rollup-plugin-dts
"@typescript/native": "npm:typescript@^7.0.2"         # provides `tsc` (TypeScript 7)
```

```jsonc
// each of the 9 packages' devDependencies: keep "typescript": "catalog:", add
"@typescript/native": "catalog:"
// root package.json devDependencies: add
"typescript": "catalog:"
```

The bins do not collide: `@typescript/typescript6` ships `tsc6`, and `typescript@7` ships `tsc`, so `pnpm exec tsc --version` prints `Version 7.0.2` in every package (measured). rollup-plugin-dts 6.5.1 calls `require("typescript")` first and falls back to `@typescript/typescript6` only when the first lacks `createProgram`; under the alias the first succeeds.
The accepted residual is the one the issue names: type-aware lint sees TypeScript 6's type semantics while `tsc` checks with TypeScript 7's.

### rumdl 0.3.x: adopt MD076, repair first, reflow with the pin

Measured on 0.3.5 with the current `.rumdl.toml` (0.2.24 reports 0 findings in 1439 files):

| Measure                      | Value                                                    |
| ---------------------------- | -------------------------------------------------------- |
| `rumdl check`                | 960 findings in 413 files: 553 MD013, 404 MD076, 3 MD034 |
| `rumdl fmt` diff             | 413 files, +1215 / −951                                  |
| MD013 hunks (MD076 disabled) | 518 in 365 files: 298 joins, 215 splits, 5 equal         |

The operator chose to bump and to adopt MD076 at its default `consistent` style: a list becomes loose (a blank line between every item) when any item holds a blank-separated block, which is how CommonMark already renders such a list.

The class breakdown of the MD013 hunks is a line-prefix heuristic over the measured diff, so these are estimates:

- About 280 joins are repairs: about 150 rejoin a sentence split after a quoted `?`, about 45 rejoin an em-dash split, and about 85 reflow hard-wrapped legacy prose.
- About 138 splits are genuine two-sentence lines 0.2.24 missed, mostly a sentence opening with a code span or a digit.
- 76 splits put a `**Bold lead-in.**` on its own line; rendering is unchanged, and 0.2.24's `fmt` already splits a bold lead-in on any line it touches (measured on a scratch file), so new prose was already written this way.

About 15 sites reflow destructively and are repaired by hand first, in a commit that stays green under 0.2.24:

- **A sentence opening with a bare `#N`** is joined onto the previous line, 10 joined lines across 8 files (the quirk `markdown-conventions` already documents; the fix it prescribes is to lead with a word such as `Issue #N`): `docs/retro/triage-2026-11-01-backlog.md`, `docs/triage/2026-08-05-backlog.md`, `docs/triage/2026-08-22-backlog.md`, `packages/pi-autoformat/docs/retro/0618-acceptance-rpc-harness-timeout.md`, `packages/pi-permission-model-judge/docs/retro/0625-authenticate-model-judge-review-call.md`, `packages/pi-permission-system/docs/plans/0726-decision-provenance.md`, `packages/pi-permission-system/docs/plans/archive/0022-relax-on-disk-identity-rule.md`, `packages/pi-subagents/docs/decisions/0002-extensions-on-a-minimal-core.md`.
- **A code span holding a backslash-escaped backtick** ends early (CommonMark has no escapes inside code spans), so the unbalanced backticks collapse up to six lines into one, in 6 files: `docs/plans/0778-drop-redundant-tool-name-prefix-from-prompt-snippets.md`, `packages/pi-permission-system/docs/retro/0082-delete-deprecated-defaults-stub.md`, `packages/pi-permission-system/docs/retro/0597-serving-resolves-forwarded-intent.md`, `packages/pi-subagents-worktrees/docs/retro/0704-preserve-worktree-on-cleanup-failure.md`, `packages/pi-subagents/docs/plans/0876-session-viewer-editor-chrome.md`, `packages/pi-subagents/docs/retro/0594-complete-exclude-disabled-agents-tool-description.md`.
  Rewrite each with a double-backtick span (``` `` `x` `` ```) so the backtick is literal.
- **Link-reference definitions directly after a list item** are lazy paragraph continuation, so they render as text today (the 3 MD034 findings) and reflow into the item: `packages/pi-permission-system/docs/retro/0321-continue-shared-test-fixture-extraction.md`.
  Insert a blank line before them.
- **A parent-level sentence directly after a nested list** is lazy continuation of the nested item, and reflow joins it there (e.g. `docs/plans/0174-add-eslint.md`, `packages/pi-permission-system/docs/plans/0282-extract-tool-preview-formatter.md`).
  Insert a blank line before the sentence; find the full set in the `fmt` diff (Build Order step 6).

The pin and the reflow cannot each be green alone: after the 0.3.5 reflow, 0.2.24 reports 268 MD013 findings in 217 files (measured), and before it, 0.3.5 reports the 960 above.
So the pin, the `prek.toml` rev, and the `fmt` pass land as one commit.
The issue asked for the reflow as its own commit; the planning session chose the fused form because the issue also requires every commit to pass the gates, and its Approach allows "one commit (or small group) per tool".
The operator was not able to confirm this choice (the `ask_user` gate rejected the call three times), so the implementing session should surface it before step 7 if a split is still wanted.

The pin stays exact, because formatter output changes between releases, and both comments are rewritten to say that instead of citing rvben/rumdl#933.

### Reflow quirks the `markdown-conventions` skill documents, re-measured

One scratch file per quirk, `rumdl fmt --no-cache --config .rumdl.toml` (measured):

| Quirk                                                      | 0.2.24 | 0.3.5  |
| ---------------------------------------------------------- | ------ | ------ |
| Joins the line after a trailing `:`                        | joins  | joins  |
| Joins a sentence opening lowercase (`git-cliff reads ...`) | joins  | keeps  |
| Joins a sentence opening with `(`                          | joins  | keeps  |
| Joins a list continuation opening `#695 ...`               | keeps  | joins  |
| Splits `§ *7. Verify CI*`                                  | splits | keeps  |
| Rewrites `(~:211)`                                         | keeps  | keeps  |
| Trims a space at a code-span edge (MD038)                  | trims  | trims  |
| Splits `**Bold lead-in.** Text`                            | splits | splits |

The `~` row did not reproduce under either version, so its bullet stays as written.

## Module-Level Changes

- `package.json`: `packageManager` to pnpm 12.x; root `devDependencies` gain `fallow-type-aware` and `typescript` (both `catalog:`).
- `pnpm-workspace.yaml`: catalog bumps for every tool; `fallow-type-aware` and `@typescript/native` entries; `typescript` becomes the `npm:@typescript/typescript6` alias with a comment naming why; rumdl pin to 0.3.x with a rewritten comment; the `@vitest/coverage-istanbul` comment drops "needs Istanbul format (not v8/c8 native)" (stale since fallow 3.29.0) and points at [#1138]; `minimumReleaseAgeExclude` loses the ten `@3.22.0` fallow entries and `globals@17.12.0`.
- `pnpm-lock.yaml`: regenerated in each step that changes a specifier.
- `prek.toml`: `committed` rev to v1.1.12 (or the latest release at implementation); `rumdl-pre-commit` rev to the rumdl pin with a rewritten comment.
- `biome.json`: schema URL; `markdown` and `yaml` formatters disabled.
- `packages/pi-subagents/biome.json`, `packages/pi-permission-model-judge/biome.json`: schema URL only.
- `.fallowrc.json`: `minimumVersion`, `supportEntry`, `ignoreBinaries`, two `allowTypeOnly` additions.
- `packages/*/package.json` (all 9): `@typescript/native: catalog:` in `devDependencies`.
- `packages/pi-permission-system/src/config/config-modal.ts`: delete the unused `eslint-disable-next-line` at line 62.
- About 413 markdown files: the hand repairs (about 17 files) and the reflow; three of the reflowed files are in a release scope (`packages/pi-autoformat/docs/configuration.md`, `packages/pi-permission-model-judge/README.md`, `packages/pi-subagents-worktrees/README.md`), which is why the reflow commit is `build:`.
- `.pi/skills/fallow/SKILL.md`: replace the `--symbol-impact` false-negative paragraph with the fixed status; drop the "Istanbul format is required" claim (both formats accepted, the repo still uses Istanbul, [#1138] evaluates switching); re-measure the "16 s against 2 s" type-aware timing cold and write the new numbers; re-verify the `coverage-gaps` "inert even at `warn`" sentence on 3.46 and rewrite or drop it; re-verify the `--type-coupling` sentence.
- `.pi/skills/testing/SKILL.md`: the `vi.mock` reset bullet (Vitest 5 clears mock history before each test by default, so a `.mockClear()` in `beforeEach` is redundant while `.mockReset()` still drops a per-test implementation); the `-t` bullet notes that a nested name joins with `>`.
- `.pi/skills/markdown-conventions/SKILL.md`: the `pi-autoformat` reflow bullets per the re-measured table (drop the lowercase, `(`, and `§` bullets; keep `:`, `#N`, `~`, MD038); a Lists bullet for MD076.
- `.pi/skills/code-design/SKILL.md`: "pnpm 11 reads them there" becomes version-free.
- `CONTRIBUTING.md`: "pnpm 11" to "pnpm 12".

Predicted unchanged, with the claim each rests on:

- `.rumdl.toml`: MD076 is adopted at its default, so no key is needed.
- `.github/workflows/ci.yml`, `release.yml`: both pass the bare `--frozen-lockfile` that pnpm 12 still accepts, and `pnpm/action-setup@v6` reads `packageManager`.
- `eslint.config.js`: the probe linted clean with no config change under typescript-eslint 8.73.0 and the alias.
- `vitest.config.mjs` and the nine `packages/*/vitest.config.ts`: Vitest 5 ran every suite with identical counts.
- `.pi/extensions/pi-autoformat/config.json`: its `.md` chain runs only rumdl, so Biome's new Markdown support never reaches it.
- `.pi/skills/package-pi-permission-system/SKILL.md`: its zone sentence names example type-only edges; the two new ones do not contradict it.
- `packages/*/docs/fallow-snapshot.json`: phase-close artifacts (see Non-Goals).

## Test Impact Analysis

No test file changes; the verification surface is the gate set plus per-step commands whose expected output was recorded at planning time:

- `pnpm --filter @gotgenes/pi-nocd exec tsc --version` → `Version 7.0.2` (after step 5).
- `node -e 'console.log(require.resolve("typescript",{paths:["node_modules/typescript-eslint"]}))'` → a path under `@typescript+typescript6@` (after step 5).
- `pnpm --silent fallow dead-code --quiet` → no output, exit 0 (after step 2 and every later step).
- `pnpm --silent fallow list --boundaries --format json --quiet` → the 22 zone file counts unchanged: pi-subagents config 5, handlers 4, lifecycle 15, observation 4, service 2, session 15, tools 11, ui 11, core 7; pi-permission-system access-intent 34, authority 33, config 15, exposure 4, handlers 21, logging 9, path 10, policy 11, presentation 13, service 5, session 7, tool-input 6, core 5.
- `pnpm exec fallow type-aware status` → `available (3.46.0, ...)`.
- `pnpm --silent fallow dead-code --type-aware --symbol-impact packages/pi-subagents/src/session/prompts.ts:buildAgentPrompt --quiet` → `src/index.ts` among the direct consumers.
- Test counts per package equal the baseline in Design Overview after every step.
- The re-measured quirk table reproduces on the scratch file before the `markdown-conventions` edit (step 7).
- After step 7, `` git show HEAD -U0 | grep -E '^\+[^+]' | grep -cE '[.!?]["”)`]* #[0-9]' `` → `0` (measured 10 on the un-repaired reflow).

## Invariants at risk

- **Every commit passes the gate set**, for bisect and per-tool revert; the rumdl fusion exists for this (constituency: whoever bisects or reverts one tool).
- **Zero boundary violations on `main`**: 3.46 adds two type-only violations; the `allowTypeOnly` edits restore zero, pinned by `fallow dead-code`'s empty output.
- **Zone membership**: pinned by the `list --boundaries` count table above.
- **Type-aware lint keeps all 47 rules**: pinned by `eslint packages/` loading `parserOptions.projectService` on the TypeScript 6 API; the `require.resolve` check shows which TypeScript it loads.
- **The published packages' public types still build**: both `verify:public-types` runs, which compile the bundled `.d.ts` with rollup-plugin-dts (TypeScript 6 API) and type-check an external consumer with `tsc` (TypeScript 7).

## Build Order

The **gate set**, run at the end of every step before committing: `pnpm install` (stage `pnpm-lock.yaml` and any `pnpm-workspace.yaml` change), `pnpm -r run check`, `pnpm run lint`, `pnpm run test`, `pnpm --filter @gotgenes/pi-subagents run verify:public-types`, `pnpm --filter @gotgenes/pi-permission-system run verify:public-types`, `pnpm --filter @gotgenes/pi-autoformat run test:acceptance`, `pnpm fallow dead-code`.
Read each target version from `pnpm view <pkg> dist-tags.latest` when the step starts.
A target younger than 24 h trips pnpm's `minimumReleaseAge`; either wait or let pnpm add the exclusion and stage it (`code-design` tooling rule).
At planning time `fallow@3.46.0` (published 2026-11-21T22:10Z) and `rollup@4.68.8` (2026-11-21T06:57Z) were inside that window.

1. **Minor bumps.**
   Catalog: `@biomejs/biome`, `eslint`, `typescript-eslint`, `globals`, `rollup`; drop `globals@17.12.0` from `minimumReleaseAgeExclude`; `prek.toml` `committed` rev. Run `pnpm exec biome migrate --write`, diff all three `biome.json` files, and keep only the `$schema` change (reject a `"root": false` in the root file); add the `markdown`/`yaml` formatter blocks; delete the unused directive in `config-modal.ts`.
   Verify: the gate set; `pnpm exec biome check .` reports no `.md`/`.yaml` file; `prek run committed --hook-stage commit-msg` is exercised by the commit itself.
   Commit: `build: upgrade Biome, ESLint, typescript-eslint, globals, rollup, and committed`.
2. **fallow 3.46.**
   Catalog `fallow` and a new `fallow-type-aware` entry; root devDependency `fallow-type-aware`; drop the ten `@3.22.0` exclusions; apply the four `.fallowrc.json` changes.
   Re-verify the `fallow` skill's claims (symbol-impact, coverage format, cold type-aware timing, `coverage-gaps`, `--type-coupling`) and edit the skill in this step.
   Verify: the gate set; the `dead-code`, `list --boundaries`, `type-aware status`, and `--symbol-impact` commands above.
   Commit: `build: upgrade fallow to 3.46 and install its type-aware companion`.
3. **pnpm 12.**
   `packageManager` to the `latest` dist-tag; `pnpm install`; commit the lockfile header churn.
   Edit `CONTRIBUTING.md` and the `code-design` skill line.
   Verify: the gate set; `pnpm --version` prints the pinned version; `pnpm install --frozen-lockfile` leaves `git status` clean on a second run.
   Commit: `build: upgrade pnpm to 12`.
4. **Vitest 5.**
   Catalog `vitest` and `@vitest/coverage-istanbul`.
   Edit the `testing` skill's two bullets; confirm the `-t` separator on one nested test (`pnpm --filter @gotgenes/pi-nocd exec vitest run -t "<describe> > <test>"`) and that `--reporter=verbose` still exists before writing them.
   Verify: the gate set with counts equal to the baseline; the `fallow` skill's Istanbul coverage command writes `coverage-final.json`.
   Commit: `build: upgrade Vitest to 5`.
5. **TypeScript 7 beside TypeScript 6.**
   Catalog alias pair with its comment; `@typescript/native: catalog:` in all nine packages; root `typescript: catalog:`.
   Verify: the gate set; the `tsc --version` and `require.resolve` commands above; `fallow dead-code` still empty.
   Commit: `build: type-check with TypeScript 7, keeping TypeScript 6 for the compiler API`.
6. **rumdl hand repairs.**
   Run `pnpm dlx rumdl@<target> fmt --no-cache .` in a scratch `git archive HEAD` copy and read its diff for the four destructive classes in Design Overview; the planning-time file lists are the expected set, but re-derive them from the target version.
   Repair each site in the real tree so that it reads correctly under both versions.
   Verify: the gate set (still rumdl 0.2.24); re-running the scratch `fmt` on the repaired tree shows none of the four classes.
   Commit: `style: repair markdown that rumdl 0.3 reflows destructively`.
7. **rumdl 0.3 pin and reflow, one commit.**
   Catalog pin (exact) and `prek.toml` rev in lockstep, both comments rewritten; `pnpm install`; `pnpm exec rumdl fmt --no-cache .`; update `markdown-conventions` per the re-measured quirk table and add the MD076 bullet (author that skill edit after the reflow so the new formatter shapes it).
   Verify: the gate set; `pnpm exec rumdl --version` prints the pin; `pnpm exec rumdl check --no-cache .` reports no issues; the `#N`-join grep returns `0`.
   Commit: `build: upgrade rumdl to 0.3 and reflow markdown to its output`.
8. **Pre-completion review** per the `pre-completion` skill.

## Risks and Mitigations

- **CI's Node 22 differs from the probe's Node 26.**
  Vitest 5 requires `^22.12.0`, and `actions/setup-node` with `node-version: 22` resolves the newest 22.x; watch the first CI run after step 4.
- **`pnpm/action-setup@v6` with pnpm 12** was not exercised locally.
  CI runs on the push after step 3; if it fails, revert that one commit.
- **A newer release than the planning-time one surfaces new findings** (fallow and rumdl change fastest).
  Each step re-reads `latest` and re-runs its gate set; a new finding is resolved in that step's commit, as the probe's findings were.
- **The reflow touches about 413 files**, conflicting with any open worktree branch that edits markdown.
  Land step 7 when no peer worktree is mid-flight, or tell peers to rebase with `/sync-worktree` afterwards.
- **fallow snapshot trends mix versions:** the next `health --trend` compares a 3.22.0 snapshot with 3.46 numbers.
  The next phase close regenerates the snapshot; read that trend's deltas with this in mind.
- **The fused rumdl commit departs from the issue's wording** and was not confirmed by the operator (see Design Overview).

## Open Questions

- When typescript-eslint's TypeScript 7 backend leaves experimental, drop the alias pair and take `typescript@7` directly.
- Whether CI should move its boundary reporting to `fallow architecture` before fallow's next major (not in [#1138]'s list).

[#866]: https://github.com/gotgenes/pi-packages/issues/866
[#867]: https://github.com/gotgenes/pi-packages/issues/867
[#879]: https://github.com/gotgenes/pi-packages/issues/879
[#1037]: https://github.com/gotgenes/pi-packages/issues/1037
[#1066]: https://github.com/gotgenes/pi-packages/issues/1066
[#1138]: https://github.com/gotgenes/pi-packages/issues/1138
