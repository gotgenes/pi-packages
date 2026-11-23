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
