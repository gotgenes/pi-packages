---
issue: 1038
issue_title: "unicode-escapes gate misses a literal escape in a TypeScript comment"
---

# Gate literal Unicode escapes in code comments

## Release Recommendation

**Release:** ship independently

The issue is repo-level tooling (`scope:repo`, no `pkg:*` label, no roadmap step), so it belongs to no release batch.
Nothing it touches should cut a release.
Every file is outside `packages/` except two comment lines in `pi-subagents`, which are committed as `style:`, and `cliff.toml` skips that type (`{ message = "^style", skip = true }`).
`./scripts/release/next-version.sh pi-subagents` printed `Nothing to release for 'pi-subagents' (at pi-subagents-v23.2.0).` at planning time; confirm it still prints that at ship time.

## Problem Statement

`scripts/lint/unicode-escapes.mjs` ([#967]) catches a literal escape (the six characters `\u2014` instead of an em-dash) in markdown prose, but it only enumerates `*.md` files.
During [#1033]'s TDD stage an `Edit` wrote `\u2014` into a comment in `packages/pi-permission-system/src/handlers/gates/runner.ts`, and the session caught it only by reading the region back.
`pnpm run lint`, the prek hook, and `pi-autoformat` would all have passed it, because each surface is scoped to markdown.
String and template literals must stay exempt, since `"\u2014"` in code is a legitimate escape.

## Goals

- Reject a literal `\uXXXX` or `\u{…}` escape, and a bare `uXXXX` token, inside a `//` or `/* */` comment in any tracked `.ts`/`.mts`/`.cts`/`.js`/`.mjs`/`.cjs` file.
  It is rejected at pre-commit, in `pnpm run lint` (and so in CI), and between turns through `pi-autoformat`'s `.ts` chain.
- Exempt everything outside comments: string, template, and regex literals, identifiers, and code.
- Inside a comment, exempt a backtick-quoted escape, the same escape hatch markdown prose has.
- Under `--fix`, decode an unambiguous escape in a comment to the character it spells, with the same visibility rules as markdown.
- Repair the two corrupt comment lines that exist today, both in `pi-subagents`.
- Not breaking: no published package's behavior, output, or default changes.

## Non-Goals

- **[#974]** (a code span crossing a list-item boundary).
  It changes `closingRunEnd`, which this plan reuses unchanged.
  The two issues are independent; whichever lands second rebases trivially.
- **A hand-written JavaScript lexer, or a local ESLint rule.**
  The operator chose the `typescript-eslint` parser (see Design Overview).
  An ESLint rule would miss `scripts/`, `test/`, and `.pi/extensions/`, because `pnpm run lint` runs `eslint packages/`.
- **`.tsx`/`.jsx`.**
  None are tracked (measured: `git ls-files` lists 694 `.ts`, 35 `.mjs`, 1 `.js`), and the parser needs `jsx: true` for them.
  Adding one later is one extension-table row plus that option.
- **Comments in other languages** (shell, YAML, TOML, JSONC).
  The incident was TypeScript; no other language has reported a hit.
- **An `.mjs`/`.js` `pi-autoformat` chain.**
  None exists today, so no `invisible-characters` pass runs on those edits either.
  Pre-commit and `pnpm run lint` cover them.
- **Extracting a shared `scripts/lint/` CLI module, or splitting the mask helpers into their own module.**
  The Tidy-First assessor rejected both as scope creep.

## Background

### Measurements

All of these were taken at planning time on `main` with a disposable prototype, `/tmp/p1038/proto2.mjs` (not committed).
The prototype blanks everything outside the comment ranges that `typescript-eslint`'s `parser.parseForESLint(text, { comment: true, range: true, filePath })` returns, then runs the committed `findUnicodeEscapes` over the result.

| Check                                                                                                  | Result                                                                    |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Tracked code files parsed                                                                              | 730, 0 parse errors                                                       |
| Findings                                                                                               | 7, on 2 lines (below)                                                     |
| Bare `uXXXX` false positives                                                                           | 0                                                                         |
| Hits in `scripts/lint/*.mjs` and `test/lint/*.mjs` (which quote escapes in string literals on purpose) | 0                                                                         |
| Whole-tree code pass wall-clock                                                                        | 2.5 s (measured; about 0.5 s of that is `require("typescript-eslint")`)   |
| Today's whole-tree markdown pass                                                                       | 0.78 s (measured, `time node scripts/lint/unicode-escapes.mjs`)           |
| Today's single-file markdown run                                                                       | 0.11 s (measured, `time node scripts/lint/unicode-escapes.mjs README.md`) |
| Root script tests                                                                                      | 12 files, 267 tests (measured, `pnpm run test:scripts`)                   |

The two lines:

- `packages/pi-subagents/src/ui/widget-renderer.ts:238`: `// Fix last connector: swap \u251C\u2500 \u2192 \u2514\u2500.`.
  It sits above string literals that spell the same escapes.
  The JSDoc at line 230 already writes `├─ → └─` as glyphs.
- `packages/pi-subagents/test/widget-renderer.test.ts:339`: `// queued line (last item, uses \u2514\u2500)`.

A scratch file (`/tmp/p1038/sample.ts`) holding a comment escape, a string literal, a regex literal, a template literal with `${}`, a backtick-quoted escape in a comment, a block comment, and a bare token produced exactly three findings: the line comment, the block comment, and the bare token.

A file that does not parse (`const x = (;`) makes `parseForESLint` throw a `TSError`.

### Existing surfaces

- `scripts/lint/unicode-escapes.mjs`: `escapeMatches(text)` calls `maskCode(text)` and then matches `ESCAPE` and `BARE_TOKEN` on what is left.
  `findUnicodeEscapes` and `repairUnicodeEscapes` both call `escapeMatches`.
  `run({ paths, fix }, io)` makes a fix pass and then a scan pass.
  `trackedMarkdown()` lists `git ls-files -z -- '*.md'` for the no-path CLI.
- `test/lint/unicode-escapes.test.mjs` drives `run` through `memoryIo(tree)` (`test/lint/memory-io.mjs`), which is path-keyed and extension-agnostic.
- `typescript-eslint` is a root `devDependency` (`catalog:`, `^8.69.0`), and `node_modules/typescript-eslint` exists at the root.
  It exports `parser.parseForESLint`; there is no top-level `parse` (verified with `Object.keys`).
- Wiring, as [#967] left it:
  - `prek.toml` `unicode-escapes` hook with `types = ["markdown"]`.
    `prek util identify` reports `ts` for `.ts` and `javascript` for `.mjs`.
  - `package.json` `lint` and `lint:fix` invoke the script with no paths.
  - `.pi/extensions/pi-autoformat/config.json` defines the `unicode-escapes` formatter, but only the `.md` chain uses it.
    The `.ts` chain is `["invisible-characters", "biome"]`.

### Constraints from AGENTS.md

- Principle 1: every number above was produced by a command.
- Principle 5: no new mechanism.
  The change reuses an existing script, an existing devDependency, and existing config surfaces.
- Stale in-process extension code: `pi-autoformat` loaded its config when this session started, so step 6 verifies by running the chain's commands by hand.

## Design Overview

### One pipeline, a mask per file type

The scan already reads "mask what is not prose, then match escapes".
The change keeps it and makes the mask depend on the file type:

```javascript
/** Prose is the comment text; everything else, and code spans inside comments, blanks to spaces. */
export function maskAllButComments(text, path)

export function findUnicodeEscapes(text, maskProse = maskCode)
export function repairUnicodeEscapes(text, maskProse = maskCode)
function escapeMatches(text, maskProse)  // was: always maskCode(text)

/** maskAllButComments for a code extension, maskCode otherwise. */
function proseMaskFor(path)
```

The default parameter keeps every existing caller and test on the markdown path.
The Tidy-First assessor confirmed this is the right seam: `escapeMatches` has two callers, and both keep the default.
A path with any other extension keeps today's markdown behavior, so explicit `.md` paths behave exactly as they do now.

`run`'s consumer sketch:

```javascript
for (const path of paths) {
  const text = io.readFile(path).toString("utf8");
  const findings = findUnicodeEscapes(text, proseMaskFor(path)); // may throw on unparseable code
  ...
}
```

### Masking everything but comments

- Parse with `parser.parseForESLint(text, { comment: true, range: true, filePath: path })`.
  `filePath` lets the parser pick JS or TS from the extension.
- Start from `blankOut(text)`, the whole text blanked with line feeds kept, then copy each comment's `range` back from `text`.
  The delimiters (`//`, `/*`, `*/`, a JSDoc ` * `) stay, and none of them can match `ESCAPE` or `BARE_TOKEN`.
- Apply the existing `maskCodeSpans` to the result, so a backtick-quoted escape in a comment stays a deliberate quote.
  A span may continue onto the next `//` line, as a markdown paragraph does, but blanked code lines read as blank lines, so a span never leaks across code.
- Offsets and line feeds are preserved, so `position` and `repairUnicodeEscapes`' splicing stay correct.
- Load the parser lazily through `createRequire(import.meta.url)("typescript-eslint")`, memoized, so a markdown-only run (the `pi-autoformat` `.md` chain, after every markdown edit) does not pay the ~0.5 s load.

### Code extensions

`.ts`, `.mts`, `.cts`, `.js`, `.mjs`, `.cjs`.
This covers what prek's `ts` and `javascript` tags can hand the hook, so a `.cjs` file never falls through to the markdown mask.

### A file that does not parse

`run` catches the parse failure per file:

- **Scan pass:** it emits `<path>: does not parse as JavaScript or TypeScript; comments not scanned` and counts the file as a failure (exit 1).
  A gate does not certify text it could not read.
  The line is fixed text with no parser message, so tests can assert it whole and Biome stays the place that explains the syntax error.
- **Fix pass:** it skips the file without rewriting it, so the scan pass reports it once.

The Tidy-First assessor rejected merging the two passes into one per-file helper.
Each pass wants different failure behavior, and the fix pass rewrites the file between them.

### Wiring

| Surface                          | Change                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| CLI no-path listing              | `trackedMarkdown()` → `trackedFiles()`: `git ls-files -z -- '*.md' '*.ts' '*.mts' '*.cts' '*.js' '*.mjs' '*.cjs'` |
| `prek.toml` hook                 | `types = ["markdown"]` → `types_or = ["markdown", "ts", "javascript"]`                                            |
| `package.json` `lint`/`lint:fix` | unchanged (no-path invocation picks up the widened listing)                                                       |
| `pi-autoformat` `.ts` chain      | `["invisible-characters", "unicode-escapes", "biome"]`                                                            |

The new chain order decodes before Biome, the same as it decodes before `rumdl` in the `.md` chain.
`invisible-characters` stays first in both.

### Predicted cost

The whole-tree `pnpm run lint` step goes from 0.78 s to about 3.3 s (estimated: the two measured passes added, one module load).
A single markdown file stays at about 0.11 s, because the lazy require never fires.
A single `.ts` file costs about 0.5–0.6 s (estimated: module load plus one parse).

## Module-Level Changes

| File                                                 | Change                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/lint/unicode-escapes.mjs`                   | `maskProse` parameter on `escapeMatches`, `findUnicodeEscapes`, and `repairUnicodeEscapes`; new `maskAllButComments`, `proseMaskFor`, and lazy parser loader; parse-failure handling in `run`; `trackedMarkdown` → `trackedFiles`; header comment and `Usage` text name code comments |
| `test/lint/unicode-escapes.test.mjs`                 | New `describe("maskAllButComments")` beside `maskCode`; `findUnicodeEscapes` mask-parameter case; new `describe("code files")` inside `run`, with its own `with fix` cases                                                                                                            |
| `packages/pi-subagents/src/ui/widget-renderer.ts`    | Line 238 comment decoded by `--fix`                                                                                                                                                                                                                                                   |
| `packages/pi-subagents/test/widget-renderer.test.ts` | Line 339 comment decoded by `--fix`                                                                                                                                                                                                                                                   |
| `prek.toml`                                          | `unicode-escapes` hook `types_or`; its comment names code comments                                                                                                                                                                                                                    |
| `.pi/extensions/pi-autoformat/config.json`           | `unicode-escapes` inserted into the `.ts` chain                                                                                                                                                                                                                                       |
| `README.md`                                          | Line 68 hook list ("a markdown Unicode-escape check" → covers code comments); lines 74–76, the paragraph describing the check, including what "no paths" scans; line 83 is unchanged in wording but re-read                                                                           |
| `AGENTS.md`                                          | Line 44: "decode literal Unicode escapes in markdown prose" → "… in markdown prose and code comments"                                                                                                                                                                                 |
| `.pi/skills/markdown-conventions/SKILL.md`           | Lines 57–59: the gate also covers `.ts`/`.js`/`.mjs` comments, and the backtick quote is the escape hatch there too                                                                                                                                                                   |

### Predicted unchanged

- `test/lint/memory-io.mjs`: path-keyed and extension-agnostic (Tidy-First assessor, confirmed by reading it).
- `package.json`: `lint` and `lint:fix` already call the script with no paths.
- `.github/workflows/ci.yml`: CI runs `pnpm run lint`.
- `vitest.config.mjs`: its include glob already covers `test/lint/*.test.mjs`.
- `scripts/lint/invisible-characters.mjs`: a sibling script, not touched.
- `packages/pi-permission-system/src/handlers/gates/runner.ts`: the [#1033] escape was already replaced before commit, and the prototype reports 0 findings there.
- `docs/plans/0967-gate-literal-unicode-escapes.md`: its comment Non-Goal is history and is not rewritten.

### Grep basis

- No export is removed or renamed.
  `trackedMarkdown` is private (the CLI body is its only caller).
- The mechanism-name grep (`unicode-escapes`, `Unicode-escape`, `Unicode escape`) across `.pi/`, `docs/*.md`, `README.md`, `AGENTS.md`, and `CONTRIBUTING.md` returned only `README.md`, `AGENTS.md`, `markdown-conventions`, and the `pi-autoformat` config, all listed above.

## Test Impact Analysis

All new coverage sits beside the existing tests.
No existing test changes, because the default parameter keeps them on `maskCode`.

| Surface                             | Cases                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `findUnicodeEscapes` mask parameter | an identity mask finds an escape inside backticks that the default mask hides                                                                                                                                                                                                                                                                                             |
| `maskAllButComments`                | line comment kept; block comment kept; JSDoc kept; double-quoted string blanked; template literal with `${}` blanked; regex literal blanked; TypeScript-only syntax (a type annotation) parses under a `.ts` path; an `.mjs` path parses; a backtick-quoted escape in a comment blanked; output length and line-feed positions equal the input's; unparseable text throws |
| `run`, code files                   | comment escape reported with `path:line:column`; string-literal escape not reported; a `.md` and a `.ts` in one run each get their own mask; an unparseable `.ts` reports the fixed line and exits 1                                                                                                                                                                      |
| `run`, code files, with fix         | decodes the comment escape and leaves the string literal byte-identical; an unparseable `.ts` is not rewritten and still exits 1                                                                                                                                                                                                                                          |

The real-corpus check is the parser's input domain.
After step 3, `node scripts/lint/unicode-escapes.mjs` over the explicit list of tracked code files must report exactly the 7 findings on the 2 lines above.
After step 4 it must report 0.

## Invariants at risk

| Invariant                                                        | Constituency                                                                | Pinned by                                                                                                                                                   |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The markdown pass is unchanged                                   | every markdown commit and the `.md` autoformat chain                        | the existing `maskCode`, `findUnicodeEscapes`, `repairUnicodeEscapes`, and `run` tests, which import the real module and stay unchanged on the default mask |
| String, template, and regex literals stay exempt                 | the scripts' own sources and tests, and every legitimate `"\u2014"` in code | the `maskAllButComments` literal cases and the `run` string-literal cases; whole-tree 0 findings in `scripts/lint/` and `test/lint/`                        |
| Decoding never plants an invisible byte                          | the `invisible-characters` gate                                             | the existing `\u000c`/`\u200b`/`\u00a0` cases; the comment path reuses the same `visible()` check                                                           |
| `invisible-characters` stays first in every chain and hook block | the #960 ordering rationale                                                 | steps 5 and 6 insert after it; read the diff                                                                                                                |
| A markdown-only run does not load the parser                     | `pi-autoformat` latency after every markdown edit                           | step 3 re-measures `time node scripts/lint/unicode-escapes.mjs README.md` against the 0.11 s baseline                                                       |
| `pnpm run lint` stays usable                                     | every session and CI                                                        | step 5 measures the script's whole-tree wall-clock against the ~3.3 s prediction                                                                            |

## TDD Order

The Tidy-First assessor recommended no preparatory commits.
It confirmed that a default parameter is the right seam and that `run`'s two loops should not be merged.

1. **`refactor(scripts): thread a prose mask through the escape scan`**

   Add `maskProse` to `escapeMatches`, `findUnicodeEscapes`, and `repairUnicodeEscapes`, defaulting to `maskCode`.
   Test: ``findUnicodeEscapes("`\\u2014`", (text) => text)`` returns one finding, while the default returns none.
   `refactor:` because nothing passes a non-default mask yet.

   Killing mutation: make `escapeMatches` call `maskCode(text)` and ignore `maskProse`.
   The identity-mask case should go red.

2. **`refactor(scripts): mask everything but comments in JavaScript and TypeScript`**

   `maskAllButComments(text, path)` with the lazy, memoized parser loader, and its `Test Impact Analysis` cases, red first.
   `refactor:` because no consumer calls it until step 3.
   Re-read the reused `blankOut`/`maskCodeSpans` calls against `code-design` before committing.

   Killing mutations:
   - Return `text` without blanking non-comment ranges.
     The string, template, and regex cases should go red.
   - Drop the `maskCodeSpans` call.
     The backtick-quoted case should go red.
   - Blank line feeds along with everything else.
     The length-and-line-feed invariant case should go red.
   - Omit `filePath` from the parser options.
     Nothing should go red, because TS parsing accepts JS.
     That is expected, and the option stays for correctness on `.mjs`.

3. **`feat(scripts): report and decode literal Unicode escapes in code comments`**

   `proseMaskFor`, the code-extension table, `run`'s per-file parse-failure handling, and the header and `Usage` comment.
   The whole parse-failure lifecycle lands in this step: the scan pass reports it and exits 1, and the fix pass skips the file without rewriting it.
   The `run` code-file cases, with and without fix, come red first.
   The no-path listing stays markdown-only here, so `pnpm run lint` stays green until the two corrupt lines are repaired.

   Killing mutations:
   - Make `proseMaskFor` return `maskCode` unconditionally.
     The string-literal-not-reported case should go red.
   - Make the scan pass's catch `continue` without counting a failure.
     The unparseable-exits-1 case should go red.
   - Remove the fix pass's catch.
     `run` should throw, and the unparseable-with-fix case should go red.

   Verify:
   - `git ls-files -z -- '*.ts' '*.mts' '*.cts' '*.js' '*.mjs' '*.cjs' | xargs -0 node scripts/lint/unicode-escapes.mjs` exits 1, naming exactly the 7 findings on `widget-renderer.ts:238` and `widget-renderer.test.ts:339`.
   - `time node scripts/lint/unicode-escapes.mjs README.md` stays near the 0.11 s baseline.

4. **`style(pi-subagents): write box-drawing glyphs in widget-renderer comments`**

   Run `node scripts/lint/unicode-escapes.mjs --fix packages/pi-subagents/src/ui/widget-renderer.ts packages/pi-subagents/test/widget-renderer.test.ts`.
   This exercises `--fix` on organic data.

   Verify:
   - `git diff` shows only lines 238 and 339 changing, and the string literals around them are untouched.
   - Step 3's whole-code-tree command exits 0.
   - `pnpm --filter @gotgenes/pi-subagents exec vitest run test/widget-renderer.test.ts` passes.
   - `./scripts/release/next-version.sh pi-subagents` prints the same result before and after the commit.

5. **`build: gate commits on literal Unicode escapes in code comments`**

   `trackedMarkdown` → `trackedFiles` with the code extensions, plus the `prek.toml` `types_or` change, in one commit so the hook and the listing never disagree.

   Killing mutation: with the old `types = ["markdown"]`, stage a scratch `.ts` file holding `// a \u2014 b`; it commits.
   With the hook restored, confirm the commit decodes it.
   Then confirm `pnpm run lint` fails on a planted `// u2014` (a report-only finding), and remove the scratch file.

   Verify: `pnpm run lint` exits 0.
   Record `time node scripts/lint/unicode-escapes.mjs` against the ~3.3 s prediction.

6. **`build: decode Unicode escapes in TypeScript comments between turns`**

   Insert `unicode-escapes` into the `pi-autoformat` `.ts` chain, between `invisible-characters` and `biome`.
   The running Pi loaded this config at start, so verify by running the chain's commands by hand on a scratch `.ts` file.
   Without the new entry, `biome check --write` leaves `// \u2014` in place; with it, the comment holds `—` and a sibling `"\u2014"` string literal is unchanged.

7. **`docs: document the Unicode-escape gate's code-comment coverage`**

   `README.md` (lines 68 and 74–76), `AGENTS.md` (line 44), and `markdown-conventions` (lines 57–59).

   Verify:
   - `pnpm exec rumdl check .` passes.
   - `node scripts/lint/unicode-escapes.mjs` exits 0.
   - `node scripts/agent-docs/always-loaded.mjs` produces the `AGENTS.md` word delta, recorded in the commit body.

## Risks and Mitigations

| Risk                                                                      | Mitigation                                                                                                                                   |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| A `typescript-eslint` upgrade changes `parseForESLint`'s `comments` shape | the `maskAllButComments` tests import the real parser, so a shape change fails them, not the gate silently                                   |
| A half-written `.ts` fails the gate between turns in `pi-autoformat`      | an ordinary formatter failure is recorded and the chain continues to Biome, which also rejects the file; the fixed-text line names the cause |
| `--fix` decodes a deliberate escape in a comment                          | the backtick quote is the escape hatch, and the docs say so after step 7; the 2 current lines were decoded on the operator's call            |
| Whole-tree lint slows down                                                | ~3.3 s estimated, measured at step 5; the lazy require keeps markdown-only runs unchanged                                                    |
| The `style:` commit cuts a `pi-subagents` release                         | `cliff.toml` skips `^style`; step 4 checks `next-version.sh` before and after                                                                |

## Open Questions

- Should the `pi-autoformat` config grow `.mjs`/`.js` chains, giving them both `invisible-characters` and `unicode-escapes`?
  Deferred until an `.mjs` edit slips one past pre-commit; not filed.

[#967]: https://github.com/gotgenes/pi-packages/issues/967
[#974]: https://github.com/gotgenes/pi-packages/issues/974
[#1033]: https://github.com/gotgenes/pi-packages/issues/1033
