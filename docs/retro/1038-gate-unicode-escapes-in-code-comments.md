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
