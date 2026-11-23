---
issue: 1102
issue_title: "pi-permission-system: a /permission-system modal save erases the global policy when the config file is invalid"
---

# Retro: #1102 — pi-permission-system: a /permission-system modal save erases the global policy when the config file is invalid

## Stage: Planning (2026-11-23T17:01:33Z)

### Session summary

Measured all three defects through the real `ConfigStore` over a temp agent dir: the invalid-file erase, the lost JSONC comment, and the `doublePressToConfirm` revert, which the issue comment had only traced.
Spiked `jsonc-parser` 3.3.1 (the `latest` tag) and settled ADR 0016 §4's scope with the operator.
Committed an 11-step plan: four preparatory `test:`/`refactor:` steps from the roadmap ride-alongs and the Tidy-First assessor, then five `fix:` steps and a `docs:` step.

### Observations

- Operator decisions: §4 points 1–4 land here (refuse invalid, JSONC edit, validate result, atomic `0600` + `fsync` write); points 5–7 (symlink refusal, restore, replacement display) wait for #1123.
  `jsonc-parser` is used only for editing; validity stays the loader's `stripJsonComments` + `JSON.parse` + schema.
  The operator asked for the latest `jsonc-parser`; `pnpm view` shows `latest: 3.3.1` (`next` is a 4.0 prerelease).

- Spike finding that shapes the design: `modify` that appends at the end of the object reflows the preceding sibling and moves a trailing line comment, while `getInsertionIndex: () => 0` left every original line byte-identical.
  A duplicate key makes `modify` edit the first occurrence while `JSON.parse` reads the last, so the candidate is checked with `isDeepStrictEqual` against the intended object; that guard has a real input to test against.

- The Tidy-First assessor found four things the draft design had missed:
  - `parseUnifiedConfigText` must take the path, because the loader's invalid-JSON test asserts the path in the issue.
  - The knob table must use the modal's order, or the settings list reorders.
  - Two modal fakes are cast and would hide the new `save` contract.
  - `save()` with `cloneDefaultConfig()` dropped non-knob fields from memory.

  As a result, `save()` now takes `RuntimeKnobValues` and merges them into the config instead of rebuilding it.

- The mechanism (the `jsonc-parser` edit API, an exclusive `0600` temp file with `fsync`) matches PR #692's `atomicReplace`, so steps 9 and 10 carry `Co-authored-by: Adam Spiers <ai@adamspiers.org>`.

- The roadmap's sweep line says #856's "parser half is served by #1102".
  Under the writer-only decision it is not, so #856 stays fully open on the read side.

- No follow-up issues filed: the deferred §4 points are already #1123's scope, per its roadmap target.

#### Deferred tidyings

- `src/config/config-loader.ts` `mergeUnifiedConfigs`: its boolean-scalar loop is a fifth hand-written copy of the knob list.
  Using the table there would add a runtime import from `config-loader.ts` into `extension-config.ts`, which already imports types the other way.
  Leave it to #1126, which rewrites the function.
- `src/config/config-store.ts` `refresh`'s `config.loaded` debug payload lists three knobs.

## Stage: Implementation — TDD (2026-11-23T17:30:39Z)

### Session summary

All eleven plan steps landed on `main` across fifteen commits, with the plan's step order kept except that the two `jsonc-parser` and atomic-write commits followed a rejected-file commit as planned.
The `config/` tests went from 446 to 464 passing, `ConfigStore` no longer mocks `node:fs`, and the full suite, root lint, type check, and `fallow dead-code` are green.

### Observations

- Deviations from the plan:
  - Plan steps 5 to 7 landed as three `fix:` commits in the planned order, but step 7's `save()` signature change also narrowed `runtimeKnobValues` to accept `RuntimeKnobValues`, so the store can pass the knobs straight through.
  - Step 8 landed the writer with a plain temp-plus-rename write and a re-serialized candidate; steps 9 and 10 then replaced each half, which kept every commit green.
  - A refused save returns before any write, so the old "tmp cleanup" test became "refuses a config path that is a directory, leaving nothing beside it".
- One mutation run backed up a source file in the same call as the mutation edit, so the backup held the mutated text; `git checkout` restored it because the file was unchanged at `HEAD`.
  The scripted mutation runner in `/tmp` (assert one occurrence, run, restore in memory) avoided the problem afterwards.
- Killing mutations all discriminated: step 8's three mutations killed five, two, and two tests; step 9's three killed four, two, and two; step 10's two killed one test each.
- Pre-completion reviewer: WARN twice, no FAIL.
  Round 1 found that the user docs and the architecture entry promised formatting survives every save; the spike had tried a handful of shapes, one trial each.
  The reviewer measured four that change bytes the save did not set, all only when a knob key is inserted:
  - an entry on the `{` line is re-indented;
  - a comment on the `{` line ends up trailing the last inserted knob;
  - a single-line file is fully re-indented;
  - invalid UTF-8 bytes inside a comment or string are rewritten as U+FFFD.
- The docs, the writer's doc comment, and the roadmap's `Landed:` note now name the first three; the invalid-UTF-8 case is accepted and unfiled.
  A reviewer-found defect that predates this change is filed as #1142: a toggle writes the other three knobs from the merged `current()`, so a trusted project's values are copied into the global file.
  Planning's Evidence Provenance claim, "inserting at index 0 left every original line byte-identical", was true for the shapes tried and false for the `{`-line shapes.
