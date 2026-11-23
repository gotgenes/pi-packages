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

## Stage: Final Retrospective (2026-11-22T23:58:51Z)

### Session summary

One session ran planning, the seven-step build, ship, and this retro.
The first push failed CI: ESLint ran out of memory on Node 22 after typescript-eslint 8.73.0, which the local Node 26 runs had hidden.
The ship fixed it forward by running ESLint once per package (`6a149d82`), then closed the issue with no release, since every package-touching commit was `build:` or `style:`.

### Observations

#### What went well

- **A cumulative probe worktree priced every bump before the plan was written.**
  Planning applied the bumps in order in `/tmp/probe-1137` and ran the real gates.
  That surfaced Biome 2.6's default Markdown/YAML formatting, the unused `eslint-disable`, the four `.fallowrc.json` findings, and the fallow-before-TypeScript-7 ordering constraint.
  Every build step then landed on its first gate run.
- **The OOM bisect isolated one package version in five runs.**
  The bisect capped Node 22's heap at 4 GB to reproduce CI, then stepped through `7afdd7de` → `af404005` → `c128faf2` → one dependency at a time.
  That pinned typescript-eslint 8.73.0, matched typescript-eslint/typescript-eslint#13109, and measured the per-package alternative (1.56 GB peak, same 710 files, a probe `any` still fails) before any commit.
- **`rumdl fmt --diff` replaced scratch copies.**
  It previews the reflow against the working tree, uncommitted repairs included, which `git archive HEAD` cannot.

#### What caused friction

- `fact` — local `node` is 26.13.1 while CI runs Node 22, whose default heap is about 4 GB.
  Every local gate run in planning and build ran under Node 26's larger heap, so the typescript-eslint 8.73.0 OOM passed locally on all eight gate runs and failed only on `main`'s CI.
  The plan named the Node gap as a risk for Vitest only.
  The repo-wide ESLint run was already at 4.29 GB resident before the bump.
  Impact: one red CI run on `main`, about 12 tool calls of diagnosis, and a fix-forward commit (`6a149d82`) during ship.
  Caught by CI.
- `slip` — three planning-stage `ask_user` calls carried their briefing in a second `thinking` block, with no `text` part.
  The session transcript shows each of those assistant messages as `thinking,thinking,toolCall`, while the accepted gate earlier was `thinking,text,toolCall`.
  The guard (`.pi/extensions/ask-user-text-first.ts`) blocked correctly.
  The planning stage note and the plan misattributed the rejections to the guard ("although visible substance preceded each call"), and the plan then recorded the fused rumdl commit as unconfirmed.
  Impact: three rejected calls, and the fused-commit decision went unconfirmed until the operator's "You can proceed."
  Self-identified only in this retro.
  The same shape is recorded in `packages/pi-permission-system/docs/retro/0609-redirect-target-by-role.md` ("two `thinking` parts and a `toolCall` and no `text` part") and in the `1061`, `1086`, and `0799` retros.
- `judgment` — the planning-time `#N`-join count anchored on a sentence end before the `#N` line, which missed every join after a bold lead-in.
  The plan listed 8 files; the build found 26 lines in 21 files by asking instead whether each original `#N`-opening line still opened a line after the reflow.
  Impact: extra repairs in step 6, recorded in `231c85e4`; no rework.
  Self-identified.
- `judgment` — step 6 built a scratch copy of the working tree with `git ls-files | tar` instead of checking `rumdl fmt --help` for a dry-run mode.
  Impact: one denied call; the `--diff` replacement was simpler.
  Operator-caught.
- `other` — the plan's reworded-mechanism grep (`/plan-issue` names `.pi/skills/package-*/SKILL.md`, the package `docs/` tree, and `test/` comments) did not reach `.pi/agents/`.
  `tidy-first-assessor.md` and `pre-completion-reviewer.md` restated the `--symbol-impact` and `beforeEach`-reset rules the build changed.
  Impact: one WARN round, one docs commit (`74dd4664`), one delta review.
  Caught by the pre-completion reviewer.
- `slip` — two `JSON.stringify` rewrites of the root `package.json` decoded its `\u2014` escape in the `prepare` script to a literal em-dash.
  Impact: none; both caught in the diff and restored before staging.
  Self-identified.
- `slip` — `cd packages/pi-nocd` for a `-t` probe was denied by the `cd packages/*` policy; the `testing` skill already says to use `pnpm --filter`.
  Impact: one call.
  Tool-caught.

#### What the operator steered

- `steer:choice`: "Adopt default" (MD076), after the agent recommended disabling it to keep list spacing at the status quo.
  The operator's words left its reach unstated; no earlier retro records a `steer:choice` on list spacing.
- `steer:choice`: "What's going on here?
  Why are we having to tar files?", after the agent tried a `git ls-files | tar` scratch copy for the rumdl dry run.
  The operator's words left its reach unstated; no earlier retro records the same choice.

### Diagnostic details

- **Model-performance correlation** — every main-session turn ran on `anthropic/claude-opus-5-5`, as did both `pre-completion-reviewer` dispatches.
  Their transcripts are under this session's `tasks/` directory.
  Opus fits the reviewer's judgment-heavy work: its reflow spot-check sampled 481 hunks and found the unpunctuated-bold-label join the plan missed.
- **Feedback-loop gap analysis** — the full gate set ran after every build step, but always under the local Node 26.
  The one gate that diverged in CI is the one that depends on the runtime's heap.

### Changes made

1. `.pi/extensions/ask-user-text-first.ts`: when the blocked message held thinking blocks but no text, the block reason now says the briefing stayed in thinking and asks for reply text in the same response.
   A stub-API probe confirmed three cases: a thinking-only message and a bare call are blocked with their respective reasons, and a message with a text block passes.

Proposed and declined: a `code-design` § Tooling bullet to re-run `pnpm run lint` under Node 22 before pushing a dependency bump.

[#1138]: https://github.com/gotgenes/pi-packages/issues/1138
[#1139]: https://github.com/gotgenes/pi-packages/issues/1139
