---
issue: 1137
issue_title: "chore: refresh tooling — pnpm 12, rumdl 0.3, fallow 3.46, TypeScript 7 (side-by-side), vitest 5"
---

# Retro: #1137 — chore: refresh tooling — pnpm 12, rumdl 0.3, fallow 3.46, TypeScript 7 (side-by-side), vitest 5

## Stage: Planning (2026-11-22T05:12:32Z)

### Session summary

Probed every bump cumulatively in a throwaway worktree of `7afdd7de` (`/tmp/probe-1137`) and rumdl on a `git archive` copy, then wrote a seven-step build plan (`docs/plans/1137-refresh-tooling.md`).
The documented TypeScript alias pair, Vitest 5, and pnpm 12 pass every gate with no code changes; fallow 3.46, Biome 2.6, and rumdl 0.3.5 each need config or content changes, all identified and measured.
Filed [#1138] for the fallow features the issue defers.

### Observations

- **Operator decisions:** bump rumdl to 0.3.x (not hold) and adopt MD076 at its default `consistent` style (+404 blank lines between list items).
- **Unconfirmed decision:** the rumdl pin and the reflow land as one commit, because 0.2.24 reports 268 MD013 findings on the 0.3.5-reflowed tree and 0.3.5 reports 960 on the current one, so neither order keeps every commit green.
  The `ask_user` guard rejected the gate three times as "no visible text" although visible substance preceded each call; the plan flags the choice for the implementing session to surface before step 7.
- **Ordering constraint the issue missed:** fallow must land before TypeScript 7, because fallow 3.22 reports the `@typescript/native` alias as an unused devDependency in all nine packages (an `error` rule) and 3.46 does not.
- **Biome 2.6 formats Markdown and YAML by default** (962 `.md`, 3 YAML files flagged); the plan disables both to preserve current behavior, since rumdl owns Markdown and pnpm writes `pnpm-workspace.yaml` single-quoted.
- **Commit typing:** `build:`/`style:` throughout, because seven commits touch `packages/**` and `chore:` cuts a patch release per package.
- **pnpm `latest` is not the newest version:** `12.22.0` was published but on the `next-12` dist-tag; `latest` read `12.21.0`.
  The plan reads `dist-tags.latest`.
- **`markdown-conventions` quirks re-measured** on a scratch file: under 0.3.5 the lowercase, `(`, and `§` quirks are gone, the `#N` list-continuation join appears, and the bold lead-in split happens under both versions.
- **Tidy First skipped:** the only `src/` edit deletes one `eslint-disable` directive typescript-eslint 8.73 reports unused; there is nothing to prepare.
- **Roadmap fit:** [#1138] is `scope:repo` with no package, so `roadmap-fit` exits at step 1.

## Stage: Implementation — Build (2026-11-22T05:47:42Z)

### Session summary

Landed all seven build steps as separate commits, each green on the full gate set (`check`, `lint`, `test`, both `verify:public-types`, the pi-autoformat acceptance tests, and `fallow dead-code`), with test counts identical to the planning baseline throughout.
The tool versions are now pnpm 12.21.0, fallow 3.46.0 (with the type-aware companion), Vitest 5.1.1, TypeScript 7.0.2 for `tsc` beside TypeScript 6 for the compiler API, rumdl 0.3.5, and the minor bumps.
A follow-up docs commit resolved the pre-completion review's warnings.

### Observations

- **The `#N`-join repair set was three times the plan's estimate:** 26 lines in 21 files, not 8 files.
  The planning heuristic only looked for a sentence end before the `#N` line and missed joins after a `**bold lead-in.**`.
  A whole-file comparison (does each original `#N`-opening line still open a line after the reflow?) found the full set.
  Two pre-existing mid-line `#508` sentences were also split out.
- **`rumdl fmt --diff` replaces scratch copies.**
  The operator questioned a `git ls-files | tar` copy of the working tree.
  `rumdl fmt --diff --no-cache .` shows the would-be reflow without writing, and it sees uncommitted repairs, which `git archive HEAD` cannot.
- **Repairs found only by the second dry run:** the pi-subagents-worktrees README had a seventh escaped-backtick span.
  A repair to retro 0082 ended a code span in `...`, which rumdl 0.2.24's autoformat split, so the ellipsis was dropped.
- **Young releases were staged, not waited out:** `rollup@4.68.8` and `fallow@3.46.0` were under 24 h old.
  pnpm added 26 `@rollup/*` exclusions and swapped the 10 fallow `@3.22.0` entries for `@3.46.0` ones (`code-design` tooling rule).
- **fallow 3.46 findings beyond the plan:**
  - `--type-aware` adds a `private-type-leak` warning class (48 here), commented onto [#1138].
  - `--type-coupling` now refuses to run without `--type-aware`.
  - Type-aware `dead-code` costs about the same as the syntactic run (about 1 s each, `--no-cache`), because refinement only runs over candidate findings.
  - The `coverage-gaps` rule now has an effect at `warn`.
- **The fused rumdl commit landed as planned.**
  The operator said "proceed" after the step-6 interruption and did not ask for a split.
- **Release scope held:** `next-version.sh` prints nothing for eight packages.
  pi-subagents shows a release that was already pending from `d376574e` (`docs/fallow-snapshot.json`), not from this work.
- **Pre-completion reviewer:** WARN, then PASS on the delta.
  The WARN named stale agent-doc sentences (`tidy-first-assessor` on `--symbol-impact`, `pre-completion-reviewer` on the `beforeEach` reset), a missing note on unpunctuated bold labels (28 joins in old plans, rendering unchanged), an ambiguous rumdl pin comment, and the unfiled `fallow architecture` follow-up, now [#1139].
  All were fixed in `74dd4664`.
- **CI has not yet run on pnpm 12 or Node 22 with Vitest 5;** watch the first run at `/ship`.

[#1138]: https://github.com/gotgenes/pi-packages/issues/1138
[#1139]: https://github.com/gotgenes/pi-packages/issues/1139
