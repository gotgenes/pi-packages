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
