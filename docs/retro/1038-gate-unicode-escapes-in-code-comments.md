---
issue: 1038
issue_title: "unicode-escapes gate misses a literal escape in a TypeScript comment"
---

# Retro: #1038 — unicode-escapes gate misses a literal escape in a TypeScript comment

## Stage: Planning (2026-10-08T06:11:05Z)

### Session summary

Planned extending `scripts/lint/unicode-escapes.mjs` to comments in tracked `.ts`/`.mts`/`.cts`/`.js`/`.mjs`/`.cjs` files, keeping one scan pipeline and choosing a prose mask per file type.
A prototype (`/tmp/p1038/proto2.mjs`) using the `typescript-eslint` parser's comment ranges parsed all 730 tracked code files and found 7 escapes on 2 lines in `pi-subagents`, with 0 false positives.
The plan has 7 steps, with no preparatory tidyings, and was committed as `docs/plans/1038-gate-unicode-escapes-in-code-comments.md`.

### Observations

- Operator gate:
  - The `typescript-eslint` parser (an existing root devDependency) was chosen over a hand-written lexer, which has regex/template ambiguity, and over a local ESLint rule, which `eslint packages/` would never run on `scripts/`, `test/`, or `.pi/extensions/`.
  - The 2 existing lines (`widget-renderer.ts:238`, `widget-renderer.test.ts:339`) are to be decoded with `--fix`, committed as `style:`.
- #967 had made comments a Non-Goal on the grounds that they "need a JavaScript tokenizer"; the parser supplies one at no new-dependency cost.
- Inside comments the plan reuses `maskCodeSpans`, so a backtick-quoted escape stays exempt, the same escape hatch as markdown.
- A file that does not parse reports a fixed-text line and exits 1 in the scan pass, and is skipped in the fix pass.
- The parser is loaded lazily, so markdown-only runs (0.11 s baseline) do not pay its ~0.5 s module load.
- Sequencing: the no-path listing is widened only in step 5, after step 4 repairs the 2 lines, so `pnpm run lint` stays green at every commit.
- `typescript-eslint` exposes `parser.parseForESLint`, not `parse`; the first prototype failed on this.
- Sibling #974 (code-span list boundaries) touches `closingRunEnd`, which this plan reuses unchanged; it was left independent.
- Predicted whole-tree lint cost is ~3.3 s (estimated), measured at step 5.

## Stage: Implementation — TDD (2026-10-08T06:25:56Z)

### Session summary

All 7 plan steps were completed, each as its own commit: two `refactor(scripts):` steps, then `feat(scripts):`, `style(pi-subagents):`, two `build:` steps, and `docs:`.
Root script tests went from 267 to 286 (+19); `check`, `lint`, `test`, and `fallow dead-code` are green.

### Observations

- Every named killing mutation reddened the tests it predicted.
  The plan's "omit `filePath`" mutation survived, as the plan predicted.
- Deviation: parse failures surface as a module-owned `UnparseableSourceError`, which `parseSource` translates from the parser's `TSError` (matched by `error.name`).
  `run` catches only that error, so a real bug in the scan is not misreported as "does not parse".
- Deviation: Biome's `noTemplateCurlyInString` warning on step 2's template-literal fixture was silenced with a `biome-ignore` comment in the step 3 commit (noted in that commit's body).
- Red-phase pins: "throws on text that does not parse" and "reports an escape in a comment" were green during Red (the first because the function did not exist yet; the second because the markdown mask also finds it).
  Mutations later confirmed both discriminate.
- Measured: the whole-code-tree scan before step 4 reported exactly the 7 predicted findings; the whole-tree no-path scan takes 3.1 s (the plan estimated about 3.3 s); a single markdown file still takes 0.105 s, so the lazy parser load holds.
- Verified the prek hook with `prek run -c <old config>` against the new config on a staged scratch `.ts`: the old config skipped the file and the new one decoded the comment while leaving the string literal unchanged.
- `AGENTS.md` always-loaded words went from 1793 to 1796.
- Pre-completion reviewer: PASS (with independent probes: hashbang, a comment inside a template substitution, and a mixed `--fix` run with one unparseable file).

## Stage: Final Retrospective (2026-10-08T06:33:53Z)

### Session summary

One trunk session took #1038 from planning through TDD, ship, and retro.
It extended `scripts/lint/unicode-escapes.mjs` to code comments using the `typescript-eslint` parser and decoded the two existing hits in `pi-subagents`.
It also wired the gate into `pnpm run lint`, the prek hook, and the `pi-autoformat` `.ts` chain; CI passed, the issue is closed, and nothing released.

### Observations

#### What went well

- The planning prototype ran the committed `findUnicodeEscapes` over comment-only text rather than a reimplementation.
  Its count (7 findings on 2 lines) is the number the real script reported at TDD step 3, so the plan's corpus prediction was a measurement, not an estimate.
- `prek run -c <old config> <hook> --files <scratch>` A/B-tested the hook change against the previous `prek.toml` without making a commit.
  This is a cheaper killing mutation for a hook-scope change than the commit-and-revert the plan described.
- Every killing mutation in the plan reddened exactly the tests it named, including the one predicted survivor (omitting `filePath`).

#### What caused friction (agent side)

- `missing-context`: during planning, `grep -rn "unicode-escapes" . --include=...` walked `.rumdl_cache/`, which is git-ignored but not ignored by `grep -r`.
  Its single-line JSON entries embed whole markdown tables, and the call truncated at the 50KB output limit.
  Impact: about 50KB of context spent on cache noise; the useful lines arrived only in the truncated tail.
- `missing-context`: the first prototype called `tseslint.parser.parse`, which does not exist (the export is `parseForESLint`), and ran over all 730 files at once.
  It printed one error line per file, about 50KB again.
  Impact: one wasted call and a second output blowout; probing one file (or `Object.keys`) first would have cost a few lines.
- `instruction-violation` (self-identified): TDD step 2 ran `biome check --write ... >/dev/null`, which hid a `noTemplateCurlyInString` warning, and the step was committed with it.
  `git-workflow` already says the redirect hides warning-level findings.
  Impact: the fix rode into the step 3 commit with a note in its body.
- `other`: the step 1 commit was rejected because the Biome hook reformatted the file, and `git log -1` in the same call showed the previous commit, which was the tell.
  Impact: one extra commit call.
  Running `biome check --write` before `git add` (as later steps did) avoids it.
- `other`: one killing mutation (wrapping the parse in `try`) was syntactically broken and produced "no tests" rather than a discrimination signal.
  Impact: one re-run with a whole-function wrapper.
- `other`: the TDD stage-note `Edit` was submitted truncated mid-sentence and needed a second `Edit` to finish.
  Impact: one extra call.

#### What caused friction (user side)

- None.
  The design gate's two questions were answered as recommended in one round.

### Diagnostic details

- **Model-performance correlation**: planning, TDD, and retro ran on `claude-opus-5-5`; `/ship` ran on `claude-sonnet-5-5`, which suits a mechanical stage.
  Both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) ran on `claude-sonnet-5-5` per their transcripts.
  The reviewer's independent probes (hashbang, a comment inside a template substitution, a mixed `--fix` run) added coverage the tests lacked, so the model was adequate for the judgment involved.
- **Feedback-loop gap analysis**: tests ran per step and `pnpm run lint` ran at step 5 and at the end.
  The Biome warning slipped through because the per-step `biome check` output was discarded, not because lint ran late.
- **Observation**: an `Edit` `newText` written with a JSON `\u2014` escape decoded to a real em-dash, because JSON escapes are decoded in transit.
  The corruption this issue gates is a model emitting the escape as literal text, which is a different path.

### Changes made

1. `.pi/skills/shell-traps/SKILL.md`: added a rule under `## Command flags and state` to search with `rg` or `git grep` rather than `grep -r .`, which walks the git-ignored `.rumdl_cache/`.
