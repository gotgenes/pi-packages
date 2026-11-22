---
issue: 960
issue_title: "Reject stray control characters in tracked files before they reach a commit"
---

# Reject stray invisible characters in tracked files

## Release Recommendation

**Release:** ship independently

Repo-level tooling (`scope:repo`), not a step in any package's improvement roadmap — a grep for `#960` across every `packages/*/docs/architecture/architecture.md` returns nothing.
No file under `packages/*/src/` changes, so no package release is triggered at all: the only files this plan touches inside `packages/` are two under `docs/`, which AGENTS.md places outside release scope.

## Problem Statement

During [#863] a model emitted an em-dash as an invisible `\x0c` form feed followed by the literal ASCII text `erence2`, and an ellipsis as `\x0c` plus `erence6`.
Eight such bytes reached a commit in `packages/pi-permission-system/src/access-intent/bash/token-collection.ts` and were found days later, by accident, when an unrelated `grep -oE` tripped over bytes that were neither hex nor visible.

Every gate the repository runs was green on the corrupt tree.
Re-measured against the installed toolchain rather than taken from the retro:

| Probe                                       | Result                                                      |
| ------------------------------------------- | ----------------------------------------------------------- |
| Form feed in code position (`const y ␌= 2`) | Biome 2.5.11 errors `lint/suspicious/noIrregularWhitespace` |
| Form feed inside a `/** */` comment         | Biome clean                                                 |
| Form feed inside a string literal           | Biome clean                                                 |
| Form feed in markdown prose                 | `rumdl` clean                                               |

Biome cannot be configured to close the gap.
Its `NoIrregularWhitespaceOptions` schema definition is `{"type": "object", "additionalProperties": false}` — the rule takes no options, so there is no setting that extends it to comments or string literals.
The blind spot is exactly comment and prose text, which is the only place authored em-dashes appear.

The repair is where the defect bites hardest: replacing the visible `erence2` text leaves the form-feed byte behind, so the confirming grep passes on a still-corrupt file.

## Goals

- Detect stray invisible characters in tracked text files and fail before they reach a commit.
- Cover CI as well as the local pre-commit stage, so a contributor PR and a `--no-verify` commit are both caught.
- Repair what has a unique correct repair, and refuse to guess at what does not.
- Repair at the earliest point a repo-side mechanism can reach: between turns, via the `pi-autoformat` chain this repo already configures.
- Clear the two live occurrences already in the tree.

Not a breaking change.
Nothing published changes behavior, output shape, or a default; this is repository tooling only.

## Non-Goals

- **Preventing the corruption.**
  It originates upstream of every mechanism this repository controls (see Background), so detection is the whole available surface.
- **Restoring a mangled character automatically.**
  `--fix` never rewrites a form feed into an em-dash.
  It prints the suggested replacement and exits non-zero, leaving the edit to a human or an agent that can read the surrounding sentence.
- **Non-breaking spaces.**
  Two U+00A0 occurrences sit in `packages/pi-autoformat/docs/configuration.md:312`, both after `e.g.`, and read as deliberate typography.
  U+00A0 is neither detected nor repaired.
- **Line-ending normalization.**
  CR is excluded from the detected set.
  Mixed line endings are a separate concern with an existing `prek` builtin (`mixed-line-ending`) that this plan does not enable.
- **Extending the `pi-autoformat` chains to new file extensions.**
  The scrub is prepended to the three chains that exist today (`.ts`, `.json`, `.md`).
  `.mjs`, `.toml`, and `.yaml` have no chain now and do not gain one here; see Open Questions.
- **Consolidating the four sibling `parseArgs` definitions** in `scripts/**/*.mjs`.
  The Tidy-First assessor confirmed the duplication and declined it as scope creep — none of the four is on this change's path.

## Background

### Where the corruption actually happens

The retro attributes the bytes to "the `Edit` tool mangling an em-dash."
Measured across all 1764 session transcripts in `~/.pi/agent/sessions` (299 candidate files, 86,025 JSONL records parsed, 0 unparseable), that attribution is wrong in a way the design depends on.
122 decoded U+000C occurrences appear in 7 session files, distributed over these JSON field paths:

| Field path                                    | Count | What it is                                       |
| --------------------------------------------- | ----- | ------------------------------------------------ |
| `message.content[].text`                      | 62    | the model's own prose, no tool involved          |
| `message.content[].arguments.edits[].newText` | 21    | what the model handed to `Edit`                  |
| `message.details.diff`                        | 15    | `Edit`'s result echoing what it wrote            |
| `message.details.patch`                       | 15    | same                                             |
| `message.content[].arguments.edits[].oldText` | 9     | the model matching text it had already corrupted |

The 62 hits in `message.content[].text` are plain assistant prose with no tool call involved, and the same corrupted string appears in `text` and in `newText` within one turn.
So the UTF-8 em-dash is never encoded and then damaged: the model's output already contains `0C 65 72 65 6E 63 65 32` where `E2 80 94` belonged, and `Edit` writes it faithfully.
The nine `oldText` hits explain why the repair was sticky — the model reproduced the corrupt bytes when trying to match the region again.

Two consequences shape the design:

1. **No repo-side mechanism can prevent it.**
   The gate detects; it cannot stop the emission.
2. **A signature grep would miss 42% of it.**
   Residue frequencies across the corpus: `erence2` 65, `erence6` 4, and 51 with no signature at all (43 bare form feeds, plus 8 followed by an ordinary word such as `package`, `src`, `CHANGELOG`, `finition`).
   The check must match the character, not the visible text.

The occurrences are bursty rather than a steady drip: 111 of the 122 fall in the [#863] worktree session and its subagent, with stray hits in unrelated projects (`pi-anthropic-auth`, `farm-sheets`) confirming the fault is model-side and not repo-specific.

### What the tree carries today

Measured over 2003 tracked files:

| Class                                  | Occurrences | Where                                                                                                                                                                          |
| -------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C0 except tab/LF/CR, plus U+007F       | 0           | —                                                                                                                                                                              |
| U+200B zero-width space                | 2           | `packages/pi-permission-system/docs/plans/0571-unify-subagent-containment-pathflavor.md:143`, `packages/pi-subagents/docs/retro/0709-child-session-shutdown-on-dispose.md:115` |
| U+200C, U+200D, U+2060, U+FEFF, U+00AD | 0           | —                                                                                                                                                                              |
| U+00A0 non-breaking space              | 2           | `packages/pi-autoformat/docs/configuration.md:312`, deliberately out of scope                                                                                                  |

Both U+200B sites are the same defect class as [#863]: one sits immediately after the ellipsis in `….catch`, the other after the slash in `posix/win32`.
Neither is quoted literally here, and neither can be: a document introducing this gate cannot contain the character the gate rejects.
This plan's own first draft carried both, copied from the corrupted files, and the scan caught it before the commit.

### Existing repo surfaces

`scripts/**/*.mjs` is the established shape for a repo-level checker: pure functions exported at the top, a CLI body guarded by `if (process.argv[1] === fileURLToPath(import.meta.url))`.
`scripts/permission-config/tripwire-rules.mjs` writes one problem per line to stdout and sets `process.exitCode`.
`scripts/agent-docs/doc-growth.mjs` injects its subprocess runner as a trailing positional parameter (`measure(sha, run)`), which is how its test drives it without shelling out.
No sibling test spawns a script's CLI as a subprocess.

The root `vitest.config.mjs` uses `include: ["test/**/*.test.mjs"]`, so a new `test/lint/` directory is picked up with no config change.
Baseline: 8 root test files, 130 tests.

`pnpm run test` runs `pnpm -r run test && vitest run`, and `pnpm run lint` is the `Lint` step in `.github/workflows/ci.yml`.
So anything appended to the `lint` script reaches CI with no workflow edit.

### Constraints from AGENTS.md

- Principle 5, *mechanism is forever; docs are reversible* — the `pi-autoformat` wiring is a config block against an already-configured extension, not a new runtime mechanism.
- Principle 1, *verify against the real surface* — every number in this plan was produced by a command, including the Biome schema claim and the wall-clock costs.
- `packages/*/docs/` is outside release scope, so the two repairs trigger no publish.

## Design Overview

### Three classes, not two

The character set splits by *what the correct repair is*, which is not the same as what is forbidden.

```javascript
// Detected and always a hard failure; never rewritten.
// C0 controls except tab (09), LF (0A), CR (0D), plus DEL.
const REPORT_ONLY = [0x00…0x08, 0x0b, 0x0c, 0x0e…0x1f, 0x7f,
                     0x200c, 0x200d, 0x2060];

// Detected and deleted by `--fix`; deletion is the unique correct repair.
const REPAIRABLE = [0x200b, 0xfeff];
```

U+200C (ZWNJ) and U+200D (ZWJ) are detected but **not** repairable, because deletion is not universally correct for them: ZWJ is load-bearing inside an emoji sequence and ZWNJ is semantically required in Persian and several Indic scripts.
Measured: zero occurrences of either in the tree today, and zero U+200D anywhere despite one test file containing emoji.
U+2060 (word joiner) joins them for the same reason — presentational, but not provably inert.

U+200B and U+FEFF have no semantic role in this repository's prose, so `--fix` deletes them.
That covers the only class actually observed (the two U+200B sites).

### No regex literal

The classifier is a `Set` of code points scanned per code point, **not** a regex literal.
Measured reason: Biome's `lint/suspicious/noControlCharactersInRegex` is in the `recommended` preset and rejects `/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/` with one error per escape.
Building the set programmatically avoids both the lint suppression and any literal control character in the source.

It also makes the column natural to report as a **code-point** offset rather than a UTF-16 index, so an astral character earlier on the line does not skew the position.

### Exported surface

```javascript
/** @returns {{line: number, column: number, codePoint: number, repairable: boolean}[]} */
export function findInvisibleCharacters(text)

/** @returns {{text: string, removed: number}} — deletes REPAIRABLE only */
export function repairInvisibleCharacters(text)

/** @returns {boolean} — true when a NUL byte is present */
export function isBinary(buffer)

/** @returns {string} — `path:line:col: U+000C` plus a suggestion when one is known */
export function formatFinding(path, finding)

/** @returns {{findings: …, repaired: string[]}} — `readFile` injected, per doc-growth.mjs */
export function scanFiles(paths, readFile)
```

`scanFiles` taking its reader as a trailing parameter follows `measure(sha, run)`, and lets the test drive the multi-file path with a fake reader instead of a third `mkdtempSync` workspace — which is the optional tidying the assessor flagged and this design sidesteps.

### The suggestion table

A separate, data-only concern: the residue-to-intent mapping.

| Residue after the form feed | Suggested character | Corpus frequency |
| --------------------------- | ------------------- | ---------------- |
| `erence2`                   | `—` U+2014 em dash  | 65               |
| `erence6`                   | `…` U+2026 ellipsis | 4                |

Verified mechanically rather than taken from prose — the transcript against the repaired file:

```text
transcript: ue-awk like `awk` [FF]erence2 but `gawk`
committed : ue-awk like `awk` —  but `gawk`
```

The table only ever produces a printed suggestion.
It never edits, so a wrong row costs a misleading hint, not silently plausible prose.
A form feed with no matching residue still fails, with no suggestion.

### CLI and the four wiring points

`node scripts/lint/invisible-characters.mjs [--fix] [paths…]`.
With no positional paths it enumerates `git ls-files -z` itself; the `isBinary` guard is what keeps `packages/pi-subagents/media/demo.mp4` (which contains `0x0c` bytes) out of the findings in that mode.

| Surface                                    | Invocation                                      | Mirrors                 |
| ------------------------------------------ | ----------------------------------------------- | ----------------------- |
| `prek.toml` local hook                     | `--fix`, `types = ["text"]`, first in the block | `biome check --write`   |
| `pnpm run lint`                            | read-only, whole tree                           | `biome check .`         |
| `pnpm run lint:fix`                        | `--fix`, whole tree                             | `biome check --write .` |
| `.pi/extensions/pi-autoformat/config.json` | `--fix`, prepended to the three chains          | —                       |

The hook mutates, matching the repository's existing convention that hooks fix and `lint` checks.
Placing it first in the `local` block means it runs before Biome reflows around a bad byte.
Prepending it in each `pi-autoformat` chain means the file is clean before `biome`/`rumdl` see it.

Measured: prek 0.5.3 honors `types = ["text"]` and excludes a binary file on its own, verified in a scratch repo where a `bin.png` containing `0x0c` was not reported.
`pi-autoformat` appends touched paths as trailing arguments (`packages/pi-autoformat/docs/configuration.md:277`), so the command needs no placeholder token, and its published non-goal — "formatting reports; it does not gate" — means an unrepairable finding surfaces without blocking the edit.

### Cost

| Measurement                         | Value               |
| ----------------------------------- | ------------------- |
| Whole-tree scan, 2003 tracked files | 0.43 s wall, exit 0 |
| `pnpm run lint` today               | 29.0 s wall         |
| Predicted `pnpm run lint` after     | ~29.4 s (+1.5%)     |

## Module-Level Changes

| File                                                                                     | Change                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/lint/invisible-characters.mjs`                                                  | New. `findInvisibleCharacters`, `repairInvisibleCharacters`, `isBinary`, `formatFinding`, `scanFiles`, the suggestion table, and the CLI body.                                                                                                                  |
| `test/lint/invisible-characters.test.mjs`                                                | New. Pure-function tables per the sibling-test convention; a fake `readFile` for the multi-file path.                                                                                                                                                           |
| `prek.toml`                                                                              | Add the `invisible-characters` hook first in the `local` repo block.                                                                                                                                                                                            |
| `package.json`                                                                           | Append the read-only invocation to `lint` and the `--fix` invocation to `lint:fix`.                                                                                                                                                                             |
| `.pi/extensions/pi-autoformat/config.json`                                               | Add the formatter; prepend it to the `.ts`, `.json`, and `.md` chains.                                                                                                                                                                                          |
| `packages/pi-permission-system/docs/plans/0571-unify-subagent-containment-pathflavor.md` | Remove the U+200B at line 143.                                                                                                                                                                                                                                  |
| `packages/pi-subagents/docs/retro/0709-child-session-shutdown-on-dispose.md`             | Remove the U+200B at line 115.                                                                                                                                                                                                                                  |
| `README.md`                                                                              | The hook-stage list (~line 68) names "Biome, ESLint, rumdl"; the Commands block comments `lint` as "biome + rumdl". Both go stale.                                                                                                                              |
| `AGENTS.md`                                                                              | Line 50: "pre-commit hooks run Biome, ESLint, and `rumdl fmt`" goes stale.                                                                                                                                                                                      |
| `.pi/skills/markdown-conventions/SKILL.md`                                               | Lines 43–46 prescribe `git grep -lI $'\x0c'` as the detection recipe and assert no gate catches this. Replace the recipe with the gate; keep the repair trap and the placeholder workaround, which stay load-bearing. Line 14 names the enforcers for markdown. |
| `.pi/skills/edit-tool/SKILL.md`                                                          | Line 26 states the class "carries past `tsc`, Biome, and the suite" — true of the toolchain, now false of the repo.                                                                                                                                             |

### Predicted unchanged

- `.github/workflows/ci.yml` — the existing `Lint` step runs `pnpm run lint`, so appending to that script reaches CI with no workflow edit.
  Falsifiable: if CI does not fail on a planted form feed, this claim is wrong.
- `vitest.config.mjs` — `include: ["test/**/*.test.mjs"]` already matches `test/lint/`.
- `biome.json` — the code-point-`Set` design means no `noControlCharactersInRegex` override is needed.
- `CONTRIBUTING.md` — its "Green checks" row names `pnpm run lint` without enumerating its parts.
- Every `packages/*/src/` file — nothing publishable changes, so no release is triggered.

### Grep basis

- Removed or renamed exports: none; both new files are additions.
- Mechanism-name grep for the reworded prose (`rumdl fmt`, `pre-commit hooks`, `Biome, ESLint`) across `AGENTS.md` and `.pi/skills/*/SKILL.md` produced the three skill/AGENTS rows above.
- Non-ASCII sweep for each character in the detected set, per code point, produced the Background table.

## Test Impact Analysis

New coverage, none of it previously possible — there is no existing invisible-character check to test.

| Surface                     | Cases                                                                                                                                                                                                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `findInvisibleCharacters`   | form feed reported with line, column, code point; tab/LF/CR reported as nothing; DEL reported; U+200B flagged `repairable: true`; U+200D flagged `repairable: false`; two findings on one line; findings across lines; column unaffected by an astral character earlier on the line |
| `repairInvisibleCharacters` | deletes U+200B and U+FEFF; leaves a form feed in place; leaves U+200D in place; reports the removal count                                                                                                                                                                           |
| `isBinary`                  | true for a buffer containing NUL; false for UTF-8 text including multi-byte characters                                                                                                                                                                                              |
| `formatFinding`             | `path:line:col: U+000C` shape; suggestion appended for `erence2` and `erence6`; no suggestion for a bare form feed                                                                                                                                                                  |
| `scanFiles`                 | skips a binary buffer via the injected reader; aggregates findings across paths; separates repaired paths from failed ones                                                                                                                                                          |

No existing test becomes redundant.
No existing test exercises this layer, so none must be preserved for it.

Every fixture is built from escapes (`"\u200b"`, `String.fromCodePoint(0x0c)`), never a literal byte — otherwise the whole-tree scan flags its own test file.
This is a verification criterion, not only a style rule: see Invariants at risk.

The shell commands this plan's docs prescribe were dry-run at planning time and their outputs are recorded above, so `/tdd-plan` can re-run them: the whole-tree scan (exit 0, 0.43 s), `pnpm run lint` (29.0 s, exit 0), `pnpm run test:scripts` (8 files, 130 tests), and the prek scratch-repo spike.

## Invariants at risk

| Invariant                                      | Constituency                       | How it is pinned                                                                                                                 |
| ---------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| The gate does not flag its own source or tests | this change                        | `node scripts/lint/invisible-characters.mjs` exits 0 over the whole tree, verified at steps 1 and 5 with the new files committed |
| The two U+00A0 sites stay legal                | `pi-autoformat` docs               | whole-tree exit 0 with `configuration.md:312` unchanged; a test asserting U+00A0 produces no finding                             |
| U+200D survives `--fix`                        | any future emoji sequence          | a `repairInvisibleCharacters` case asserting a ZWJ is left in place                                                              |
| `pi-autoformat` does not gate an edit          | the extension's published non-goal | the chain entry is a formatter like any other; a non-zero exit reports via `formatterOutput` and does not block                  |
| `pnpm run lint` stays fast                     | every session and CI               | measured baseline 29.0 s, scan 0.43 s, predicted ~29.4 s; re-measure at step 5                                                   |
| Tab, LF, and CR are never findings             | every file in the repo             | explicit negative cases; whole-tree exit 0 is otherwise impossible                                                               |

The quantitative invariant is the lint wall-clock, measured rather than argued: 29.0 s today, 0.43 s for the scan, so ~29.4 s predicted.

No prior phase step refactored this surface — there is no existing checker — so there are no earlier documented outcomes to regress.

## TDD Order

The Tidy-First assessor found **no** preparatory refactoring warranted; the two optional items it named are recorded in the retro as deferred.
The mechanism half (the classifier) and the data half (the suggestion table) are separate steps, per the plan conventions for a walker plus its lookup table.

1. **`feat(scripts): report stray invisible characters in tracked files`**

   `test/lint/invisible-characters.test.mjs` first, red because the module does not exist.
   Then `scripts/lint/invisible-characters.mjs` with `findInvisibleCharacters`, `isBinary`, `formatFinding` (no suggestions yet), `scanFiles`, and the CLI in report-only mode.
   Covers the whole `Surface` table above except the `repairInvisibleCharacters` and suggestion rows.

   Killing mutations, one per equivalence class:
   - Remove `0x0c` from the report-only set → every form-feed case reddens.
   - Add `0x09`, `0x0a`, `0x0d` to the report-only set → the tab/LF/CR negative cases redden.
   - Return the UTF-16 index instead of the code-point offset for `column` → only the astral-character case reddens.
   - Make `isBinary` return `false` unconditionally → the NUL-buffer case and `scanFiles`' binary-skip case redden.

   Verify: `node scripts/lint/invisible-characters.mjs` exits 1 and names the two U+200B sites; `pnpm run test:scripts` reports 8→9 files.

2. **`feat(scripts): suggest the intended character for a known residue`**

   Write the row-verifying assertion before the rows: one test that `formatFinding` on a form feed followed by `erence2` appends a suggestion naming U+2014, then the table.
   Then the `erence6`→U+2026 row and the no-residue case.

   Killing mutations:
   - Swap the table's two values → the `erence2` and `erence6` cases both redden, and neither reddens if only one row is wrong, which is the point of asserting per row.
   - Return a suggestion unconditionally → the bare-form-feed case reddens.

3. **`feat(scripts): repair stray zero-width characters with --fix`**

   `repairInvisibleCharacters` plus the CLI's `--fix` branch.
   The whole lifecycle of the repair is specified in this one step: which characters are deleted, that a report-only finding still exits non-zero under `--fix`, and that a file with no findings is not rewritten.

   Killing mutations:
   - Include `0x0c` in the repairable set → the "form feed is left in place" case reddens.
   - Include `0x200d` in the repairable set → the ZWJ case reddens.
   - Make `--fix` exit 0 whenever it repaired something → the "report-only finding still fails under `--fix`" case reddens.

4. **`fix: remove stray zero-width spaces from two package docs`**

   Run `node scripts/lint/invisible-characters.mjs --fix` over the two files and commit the result.
   This is the step that exercises `--fix` against organic data rather than fixtures.

   Verify: the whole-tree scan exits 0; `git diff` shows exactly two deleted code points and no other change; `pnpm exec rumdl check` clean on both files.

5. **`build: gate commits on stray invisible characters`**

   The `prek.toml` hook, the `lint` append, and the `lint:fix` append in one commit — the hook and the lint script are one rule with two spellings and should not disagree across commits.

   Killing mutation: delete the hook entry from `prek.toml`; a planted form feed then reaches a commit.
   The relocated-registration hazard applies here, so also verify by planting a form feed in a scratch file and confirming both `prek run --all-files invisible-characters` and `pnpm run lint` fail on it, then removing it.

   Verify: `pnpm run lint` exits 0 and its wall-clock is within ~1 s of the 29.0 s baseline.

6. **`build: scrub invisible characters between turns`**

   The `.pi/extensions/pi-autoformat/config.json` formatter entry, prepended to the three chains.

   Killing mutation: remove the entry from the `.md` chain; a `.md` file written with a U+200B is then still corrupt after the turn.
   Note for the implementing session: the running Pi process loaded this config at session start, so the chain change does not take effect until a restart — verify the JSON against the schema and the formatter command by hand rather than by observing a live edit.

7. **`docs: document the invisible-character gate`**

   `README.md` (hook-stage list and the Commands comment), `AGENTS.md` line 50, `.pi/skills/markdown-conventions/SKILL.md` (replace the stale detection recipe; keep the repair trap and the placeholder workaround), `.pi/skills/edit-tool/SKILL.md` line 26.
   State the corrected provenance in the skills: the corruption is model-side and `Edit` writes it faithfully, so the rule is about detection and repair, not about avoiding a tool.

   Verify: `pnpm exec rumdl check .` clean; `node scripts/agent-docs/always-loaded.mjs` records the `AGENTS.md` word delta in the commit body.

## Risks and Mitigations

| Risk                                                                                           | Mitigation                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A future legitimate U+200D (emoji ZWJ sequence, Indic text) fails the gate with no way through | U+200D is report-only, so `--fix` never breaks such a sequence silently. The escape hatch is prek's per-hook `exclude` plus a path argument; measured zero occurrences today, and one test file already contains emoji without any ZWJ |
| `--fix` deletes a U+FEFF that was a meaningful BOM                                             | Measured zero U+FEFF in the tree. A BOM in a UTF-8 file is already undesirable here, and prek ships `fix-byte-order-marker` if the repo ever wants the opposite policy                                                                 |
| The test fixtures themselves trip the whole-tree scan                                          | Fixtures are built from escapes only, and steps 1 and 5 verify whole-tree exit 0 **with the new test file committed** — the falsifying condition, not a happy path                                                                     |
| The suggestion table's rows are wrong                                                          | The table only prints. Verified mechanically for `erence2` against the repaired file; `erence6` rests on 4 corpus samples and is labeled as such                                                                                       |
| The `prek` hook and the `lint` script drift apart                                              | Both invoke the same script with the same set; step 5 lands them in one commit                                                                                                                                                         |
| `git grep -P` portability                                                                      | Not relied on. The runtime check is Node; `git grep -P` appears only in this plan's planning-time measurements, on a host where it was verified to work                                                                                |
| `isBinary` misses a NUL-free binary file                                                       | prek's `types = ["text"]` filter independently excludes binaries at the hook, so the two mechanisms are belt and braces; the whole-tree mode is the one relying on `isBinary`, and it was measured to exclude `demo.mp4` correctly     |
| The gate cannot stop the emission, only report it                                              | Stated as a Non-Goal. The `pi-autoformat` wiring narrows the window from "days until someone greps" to "the turn that wrote it"                                                                                                        |

## Open Questions

- Should the `pi-autoformat` chains gain `.mjs`, `.toml`, and `.yaml` entries so the scrub reaches files that have no chain today?
  Deferred — adding chains changes what `pi-autoformat` formats, which is a larger decision than this gate.
- Should the suggestion table grow from a second corpus?
  The 1764-session sweep is reproducible, so a later session can re-run it; 69 samples from one bursty window is enough for a printed hint.
- Is a `mixed-line-ending` builtin hook worth enabling alongside this one?
  Adjacent but separate; not filed, because nothing has gone wrong there.

[#863]: https://github.com/gotgenes/pi-packages/issues/863
