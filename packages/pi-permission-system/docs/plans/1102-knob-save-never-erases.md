---
issue: 1102
issue_title: "pi-permission-system: a /permission-system modal save erases the global policy when the config file is invalid"
---

# A knob save never erases what it did not set

## Release Recommendation

**Release:** ship independently

The Phase 16 roadmap tags this step `Release: independent`, and its `Release batches` subsection says there is no batch: every step releases on its own.
This is a `fix:` release; the preparatory `test:`/`refactor:` steps cut none.

## Problem Statement

The `/permission-system` modal is the one shipped path by which the extension writes a config file, and it has no contract about the bytes it does not own.
`ConfigStore.save()` loads the global `config.json` through `loadUnifiedConfig`, spreads the *validated* result, overwrites three knobs, and re-serializes the whole object with `JSON.stringify`.
A file the strict schema rejects validates to `{}`, so one toggle erases every rule the user wrote.
A valid JSONC file keeps its rules but loses every comment.
A fourth toggle, `doublePressToConfirm`, is never written at all, so it reverts at the next prompt.

ADR 0016 §4 (`docs/decisions/0016-policy-channels.md`) states the write-integrity contract every extension write must meet, and this issue is where that contract first exists in code.

## Goals

- A save over a global config file that fails to read, parse, or validate is refused with a notice naming the file and its issues, and writes nothing.
- A save over a valid file changes only the four knob values: comments, formatting, key order, and unrelated keys survive.
- All four modal toggles survive the next `refresh()`, `doublePressToConfirm` included.
- The result is checked before it is written: it must pass the schema and parse to exactly the original object with the knob values applied.
- The write is atomic and owner-only: a unique exclusive temp file, mode `0600`, `fsync`, rename.
- `/permission-system reset` reports success only when the save landed, and `/permission-system show` lists all four knobs.
- The write path's tests run against a real temporary directory, not a mocked `node:fs` (roadmap metric 1 → 0).

Classification: **not breaking** (`fix:`).
A valid config keeps every rule and gains only the knob keys it already gained; the observable changes are a refused save where the old one destroyed the file, a `0600` file mode where the old save left the umask default, and one more knob in `show`.

## Non-Goals

- **ADR 0016 §4 points 5–7** — refusing a symlinked destination, restoring the original on a failed post-write reload, and showing a rule replacement as `deny → allow`.
  Operator decision: they land with the writer that needs them, [#1123] (its roadmap target names "the write contract's remaining points").
  Today `renameSync` replaces a symlinked `config.json` with a regular file, and that stays true after this change.
- **Moving knob writes to `config.local.json`** — [#1122].
  The writer here takes its path as a parameter, so that step changes one argument.
- **Switching the loader's parser to `jsonc-parser`** — operator decision: the editor uses `jsonc-parser`, and what counts as invalid stays the loader's `stripJsonComments` + `JSON.parse` + schema, so read and write agree.
  Issue [#856] asks for both a library parser and a `config.jsonc` filename; this change adds the library for editing only and serves neither half on the read side.
- **Detecting the file's indentation.**
  Inserted keys use two spaces; a measured spike showed that with insertion at the top of the object, a mismatched indent touches only the inserted lines.
- **Re-reading knobs at the next tool call** — [#1125].
- **The loader's own fifth hand-written knob list** in `mergeUnifiedConfigs` — [#1126] rewrites that function; using the knob table there would add a runtime import from `config-loader.ts` into `extension-config.ts`, which already imports types the other way.

## Background

- `src/config/config-store.ts` — `ConfigStore` owns the runtime config (`current()`), `refresh(cwd, projectTrusted)` reloads it through `loadAndMergeConfigs`, and `save(next, ctx)` writes knobs to `getGlobalConfigPath(agentDir)`.
  `save()` sets `this.config = normalizePermissionSystemConfig(next)`; the modal's `reset` passes `cloneDefaultConfig()`, which carries only the four knobs, so a reset also drops `shellTools`, `authorizerChain`, timeouts, and the rest from memory until the next refresh.
- `src/config/config-loader.ts` — `loadUnifiedConfig(path)` returns `{config: {}, issues: []}` for an absent file, `{config: {}, issues: ["Failed to read config at '<path>': …"]}` for a read or parse failure, and `validateUnifiedConfig(parsed)` otherwise.
  The schema is a `strictObject` with no `.default()`, `.transform()`, or `preprocess` (grep-verified), so a validated config deep-equals the raw parse.
- `src/config/config-modal.ts` — the knob list is hand-written in `cloneDefaultConfig`, `summarizeConfig` (three knobs, missing `doublePressToConfirm`), `buildSettingItems`, `applySetting`, and `syncSettingValues`, in the order `yoloMode`, `permissionReviewLog`, `debugLog`, `doublePressToConfirm`.
  `openSettingsModal`'s `onChange` already re-reads `current()` after `save` and re-syncs the list, so a refused save reverts the toggle on screen without a code change there.
- `src/config/extension-config.ts` — `PermissionSystemExtensionConfig`, `DEFAULT_EXTENSION_CONFIG`, `normalizePermissionSystemConfig`.
- Tests: `test/config/config-store.test.ts` mocks `node:fs` whole and replaces `config-loader`; `test/config/config-modal.test.ts` saves through hand-written store fakes, one of which writes files itself, and never drives the `SettingsList` `onChange` path because its `custom` stub never calls the renderer.
  `test/config/config-pipeline.test.ts` is the real-temp-dir model; `test/helpers/tmp-fixture.ts` (`createTmpFixture`) is the shared fixture.
- AGENTS.md constraints: pnpm only; a `package.json` dependency change commits `pnpm-lock.yaml` in the same commit.
  The package skill: tool-input artifacts get a mode; the review log is unaffected here.

## Design Overview

### How the evidence was produced

Every behavior below was measured, not traced.

- A disposable Vitest test (since deleted) drove the real `ConfigStore` over a temp agent dir.
  A file `{"permission": {"bash": {"rm *": "deny"}}, "typoKey": true}` became `{"debugLog": false, "permissionReviewLog": true, "yoloMode": true}` after `save({...DEFAULT_EXTENSION_CONFIG, yoloMode: true})`.
  A save with `doublePressToConfirm: false` held `false` in memory, wrote no such key, and read back `true` after `refresh()`; the same save dropped a `// keep me` comment.
- A Node spike against the `jsonc-parser` 3.3.1 tarball (`pnpm view jsonc-parser dist-tags` → `latest: 3.3.1`; `next` is the `4.0.0-next.2` prerelease) measured `modify` + `applyEdits`:
  - replacing an existing key edits the value only, comments and layout intact;
  - inserting a key at the **end** of the object reflows the preceding sibling (`"permission": { "*": "ask" }` expanded to three lines) and moves a trailing `// rows` comment onto the inserted line;
  - inserting at index **0** (`getInsertionIndex: () => 0`) left every original line byte-identical, for a two-space file, a tab-indented file, and a file with an inline sibling plus a trailing comment;
  - a single-line compact file is expanded either way (content intact);
  - a file with a duplicate key (`{"debugLog": true, "debugLog": true}`) edits the first occurrence, so `JSON.parse` of the result still reads `true`.
  - Named ESM imports (`import { modify, applyEdits } from "jsonc-parser"`) resolve under Node.

### The knob table

The four boolean knobs become one ordered list, in the modal's current order so the settings list does not reorder.
The modal's presentation lives beside it as a `Record` keyed by the knob, so adding a knob without a label is a compile error.

```typescript
// src/config/extension-config.ts
export const RUNTIME_KNOB_KEYS = [
  "yoloMode",
  "permissionReviewLog",
  "debugLog",
  "doublePressToConfirm",
] as const;
export type RuntimeKnob = (typeof RUNTIME_KNOB_KEYS)[number];
export type RuntimeKnobValues = Pick<PermissionSystemExtensionConfig, RuntimeKnob>;
export function isRuntimeKnob(id: string): id is RuntimeKnob;
export function runtimeKnobValues(config: PermissionSystemExtensionConfig): RuntimeKnobValues;

// src/config/config-modal.ts
const KNOB_PRESENTATION: Record<RuntimeKnob, { label: string; description: string }>;
```

### `save()` takes the knobs, writes the knobs, and reports whether it did

```typescript
export interface CommandConfigStore extends ConfigReader {
  /** Persist the runtime knobs; `true` when the file was written. */
  save(knobs: RuntimeKnobValues, ctx: ExtensionCommandContext): boolean;
}
```

On a write, `this.config = { ...this.config, ...knobs }`: the store updates only what it wrote, which removes the reset's in-memory loss of the non-knob fields.
The `commandEffects` declarations stay beside the config as today.
The modal's `reset` branch notifies "reset to defaults" only when `save` returns `true`; the save itself notifies on refusal or failure.

### The writer: `src/config/config-file-writer.ts`

A function, not a class: no participant owns state, and every input is a value.

```typescript
export type ConfigWriteResult =
  | { kind: "written" }
  | { kind: "refused"; issues: readonly string[] }
  | { kind: "failed"; message: string };

export function writeConfigValues(
  path: string,
  values: Readonly<Record<string, unknown>>,
): ConfigWriteResult;
```

1. **Read.**
   An absent file is the empty text `""` with an empty config.
   A read failure (`EISDIR`, `EACCES`) is `refused` with `Failed to read config at '<path>': …`.
2. **Refuse an invalid file** (§4.1).
   `parseUnifiedConfigText(raw, path)` — extracted from `loadUnifiedConfig` so the writer and the loader share one definition of invalid — returning issues means `refused`, nothing written.
3. **Edit, preserving JSONC** (§4.2).
   For each entry, in reverse table order, `applyEdits(text, modify(text, [key], value, { getInsertionIndex: () => 0, formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" } }))`, so new keys land at the top in table order and existing keys change in place.
4. **Validate the candidate** (§4.3).
   `parseUnifiedConfigText(candidate, path)` must report no issues, and `isDeepStrictEqual(candidateConfig, { ...existingConfig, ...values })` (order-insensitive) must hold; otherwise `refused` with an issue saying the edit would have changed content it did not set.
   The equality guard is what catches the duplicate-key file.
5. **Write atomically** (§4.4).
   `mkdirSync(dirname(path), { recursive: true, mode: OWNER_ONLY_DIRECTORY_MODE })`, `openSync(<path>.<randomUUID()>.tmp, "wx", OWNER_ONLY_FILE_MODE)`, write, `fsyncSync`, close, `renameSync`; on any error close and unlink the temp file and return `failed`.

The store's call site:

```typescript
const result = writeConfigValues(globalPath, knobs);
if (result.kind === "refused") { ctx.ui.notify(refusalNotice(globalPath, result.issues), "error"); return false; }
if (result.kind === "failed") { ctx.ui.notify(`Failed to save permission-system config at '${globalPath}': ${result.message}`, "error"); return false; }
this.config = { ...this.config, ...knobs };
```

The refusal notice names the file, lists each issue on its own line, and says the file must be fixed by hand before the setting can be saved.

### Edge cases (each has a test; the step is named)

| Input                                                              | Behavior                                          | Step          |
| ------------------------------------------------------------------ | ------------------------------------------------- | ------------- |
| No global file yet                                                 | Created with the four knobs                       | 9             |
| File with an unknown key                                           | Refused, file byte-identical                      | 8             |
| File that is not JSON                                              | Refused with the parse issue                      | 8             |
| `config.json` is a directory                                       | Refused with the read issue                       | 8             |
| Empty (0-byte) file                                                | Refused (the loader rejects it too)               | 8             |
| Candidate fails the schema (`debugLog: "on"` passed to the writer) | Refused, nothing written                          | 8             |
| Valid JSONC with comments and an inline sibling                    | Every original line survives; new keys at the top | 9             |
| Knob already present                                               | Value replaced in place                           | 9             |
| Duplicate knob key                                                 | Refused by the equality guard                     | 9             |
| Parent directory cannot be created                                 | `failed`, error notice, `current()` unchanged     | 1 (pinned), 8 |
| Written file                                                       | Mode `0600` (POSIX)                               | 10            |

### Import edges

All new edges are in the `config/` zone or into zones it already reaches: `config-store.ts` → `config-file-writer.ts` (same zone), `config-file-writer.ts` → `config-loader.ts` (same zone; `config-loader.ts` imports neither), `config-file-writer.ts` → `#src/logging/log-file-permissions` (allowed: `pnpm --silent fallow guard src/config/config-store.ts` lists `logging`, and `extension-config.ts` already imports that module).

## Module-Level Changes

- `packages/pi-permission-system/package.json` — add `"jsonc-parser": "^3.3.1"` to `dependencies`; `pnpm-lock.yaml` in the same commit.
- `src/config/extension-config.ts` — add `RUNTIME_KNOB_KEYS`, `RuntimeKnob`, `RuntimeKnobValues`, `isRuntimeKnob`, `runtimeKnobValues`.
- `src/config/config-modal.ts` — `KNOB_PRESENTATION`; `cloneDefaultConfig`, `buildSettingItems`, `applySetting`, `syncSettingValues`, `summarizeConfig` iterate the table; the modal holds `RuntimeKnobValues` and passes them to `save`; `reset` notifies success only on `true`.
- `src/config/config-store.ts` — `CommandConfigStore.save(knobs, ctx): boolean`; `save()` delegates to `writeConfigValues`, merges knobs into `this.config`, notifies on refusal; the `config.saved` debug payload lists the table's keys; the comment on `declared` ("`save()` rebuilds the config through `normalizePermissionSystemConfig`") is reworded, since `save()` no longer rebuilds it.
  `refresh`'s `config.loaded` payload is left as is (predicted unchanged; nothing in this change reads it).
- `src/config/config-loader.ts` — extract `parseUnifiedConfigText(raw, path)`; `loadUnifiedConfig` keeps its read-error catch and delegates.
  `stripJsonComments` unchanged.
- `src/config/config-file-writer.ts` — **new**: `writeConfigValues`, `ConfigWriteResult`.
- `src/index.ts` — predicted **unchanged**: it passes `configStore` to `registerPermissionSystemCommand`, and `ConfigStore` still satisfies `CommandConfigStore`.
- `test/config/config-store.test.ts` — no `vi.mock("node:fs")`; `config-loader` mock partial; save and `logResolvedPaths` tests on `createTmpFixture` directories.
- `test/config/config-modal.test.ts` — split by behavior; one `captureCommand` helper; one `makeConfigStore` fake; an `onChange` path test.
- `test/config/config-file-writer.test.ts` — **new**.
- `test/config/config-loader.test.ts` — predicted unchanged: the extraction keeps `loadUnifiedConfig`'s messages, including the path in the parse issue its invalid-JSON test asserts.
- `docs/configuration.md` — under `## Runtime Knobs`, a paragraph on what `/permission-system` writes: the four knobs to the global `config.json`, edited in place, comments and other keys kept, and a file that fails to parse or validate refused with a notice.
- `docs/architecture/architecture.md`:
  - module tree: the `config-store.ts` entry's `save()` wording and its `commandEffects` constraint rationale; a new `config-file-writer.ts` entry (the §4 points 1–4 it implements, and that points 5–7 are not yet implemented);
  - roadmap: `✅` on the `#### [#1102]` heading and the `S1102` Mermaid node, plus a `Landed:` note under its `Outcome:`.
- `.pi/skills/package-pi-permission-system/SKILL.md` — predicted unchanged: grep for `save()` / `ConfigStore` finds only the `commandEffects` sentence ("`ConfigStore` holds it beside the runtime config, where `save()` cannot drop it"), which stays true.
- `README.md` — predicted unchanged: grep for `/permission-system` finds no section describing the modal's write.

## Test Impact Analysis

1. **Enabled.**
   The writer is a function over a path and values, so every row of the edge-case table is a real-filesystem unit test with no `ConfigStore`, context, or mock.
   The modal's `onChange` path becomes testable once the `custom` stub invokes the renderer and the `SettingsList` mock records its callback.
2. **Redundant.**
   The fused modal test's `persisted` assertion tests its own fake's file write, not `ConfigStore`; it is dropped in the split (step 2), and real persistence is asserted in `config-store.test.ts`.
   The `config-store.test.ts` tests that assert `writeFileSync` was called with a string containing a key become read-back assertions on the real file.
3. **Kept.**
   `config-store.test.ts`'s `refresh()` / `getConfigIssues()` / `declaredCommandEffects()` tests still mock `loadAndMergeConfigs`, which this change does not touch; the `buildResolvedConfigLogEntry` mock stays.

## Invariants at risk

- **`commandEffects` declarations survive a save** (the `declared` field's reason to exist; serves the review log's provenance).
  Pinned by `config-store.test.ts` › `declaredCommandEffects()` › "survives a save", which step 1 moves onto a real temp dir so `save()` takes its write path rather than the failure path.
- **Phase 16 step [#1133]** touched only `test/policy/`; nothing here overlaps.

## TDD Order

Steps 1–4 are the roadmap's ride-along tidying plus the Tidy-First assessor's recommendations; each leaves the suite green.
Commits that adopt PR [#692]'s mechanism (the `jsonc-parser` edit API, the exclusive `0600` temp file with `fsync`) carry:

```text
Co-authored-by: Adam Spiers <ai@adamspiers.org>
```

1. **`test(pi-permission-system): run the ConfigStore write and path-logging tests on a real temp directory`**
   - Prepares: every later `save()` test belongs in this file, and today's whole-module `node:fs` mock and wholesale `config-loader` replacement make none of them writable.
   - Drop `vi.mock("node:fs")`; make the `config-loader` mock partial (`importActual` spread, override `loadAndMergeConfigs` only); stage files with `createTmpFixture`; assert by reading the file back.
   - Use a temp `agentDir` for every test that calls `save()`, including `declaredCommandEffects()` › "survives a save"; update the `refresh()` tests' literal `"/test/agent"` to the fixture's directory.
   - Write failure: `agentDir` under a regular file (`mkdir` fails `ENOTDIR`); assert the error notice, `current()` unchanged, no `config.saved`.
   - The tmp-cleanup test: make `config.json` a directory so `renameSync` fails; assert the parent directory lists only `config.json`, never the literal `.tmp` name step 10 changes.
   - `logResolvedPaths`: put a real `pi-permissions.jsonc` in `agentDir` and assert `legacyGlobalPolicyDetected: true`; replace the `mockExistsSync.mock.calls` inspection with `legacyProjectPolicyDetected: false` on the mocked `buildResolvedConfigLogEntry` when no cwd is passed.
   - Assert file contents by parsed value, not `JSON.stringify` layout, so step 9 does not rewrite them.
   - Killing mutation: make `save()` skip `renameSync` (write the temp file only) — the read-back tests go red.
   - Verify: `grep -c 'vi.mock("node:fs"' test/config/config-store.test.ts` prints `0`.
2. **`test(pi-permission-system): split the command test by behavior over one command capture and one store fake`**
   - Prepares: step 7 changes `save`'s signature and return type; two fakes are annotated `CommandConfigStore` and two are cast, so a shared `makeConfigStore` makes that a one-line edit and keeps the casts from hiding the new contract.
   - One `captureCommand(controller)` helper replaces the four `registerCommand` captures (reuse `test/helpers/make-fake-pi.ts`'s `commands` map only if it needs no cast).
   - Split the fused 130-line test into `describe` blocks per behavior (`show`, `path`, `help`, `reset`, unknown argument, headless, modal routing); drop the fake's inline `expect` and the `persisted` read-back of the fake's own write.
   - Killing mutation: make `handleArgs` return `false` for `"reset"` — the reset test goes red.
3. **`test(pi-permission-system): pin the settings list's toggle path`**
   - Prepares: step 8's "a refused save reverts the toggle" is a delta on this test.
   - The `custom` stub invokes the renderer; the `SettingsList` mock records its items and `onChange`.
   - Assert the item ids in order (`yoloMode`, `permissionReviewLog`, `debugLog`, `doublePressToConfirm`) with their current values.
   - Assert that toggling `debugLog` to `off` calls `save` with the toggled value and re-syncs the list from `current()`.
   - Killing mutations: delete `syncSettingValues(settingsList, current)` in `openSettingsModal` (the re-sync assertion goes red); swap the first two entries of `buildSettingItems` (the item-order assertion goes red).
4. **`refactor(pi-permission-system): drive the settings modal from one knob table`**
   - Prepares: step 5's "save writes exactly the table's keys" needs the table.
   - Add `RUNTIME_KNOB_KEYS` and friends; `KNOB_PRESENTATION`; `cloneDefaultConfig`, `buildSettingItems`, `applySetting` (guarded by `isRuntimeKnob`), `syncSettingValues` iterate the table in the modal's current order.
   - `summarizeConfig` and `save()` are untouched here: both change behavior.
   - Re-read the moved label/description strings against `code-design` before committing.
   - No new tests; steps 2–3 pin the behavior.
     The table order is pinned by step 3's item-order assertion.
5. **`fix(pi-permission-system): the double-press setting survives the next prompt`**
   - `save()` writes every key in `RUNTIME_KNOB_KEYS`; the `config.saved` payload lists them.
   - Test (`config-store.test.ts`): save with `doublePressToConfirm: false`, then `refresh()`, then `current().doublePressToConfirm` is `false`.
   - Killing mutation: drop `doublePressToConfirm` from the keys `save()` writes — the test goes red.
6. **`fix(pi-permission-system): /permission-system show lists the double-press setting`**
   - `summarizeConfig` iterates the table.
   - Test (`config-modal.test.ts` › `show`): the whole knob line equals `yoloMode=…, permissionReviewLog=…, debugLog=…, doublePressToConfirm=…`.
   - Killing mutation: slice the table to its first three keys in `summarizeConfig`.
7. **`fix(pi-permission-system): /permission-system reset reports success only when the settings were saved`**
   - `CommandConfigStore.save(knobs: RuntimeKnobValues, ctx): boolean`; `ConfigStore.save` returns `false` on the existing I/O failure and merges knobs into `this.config` on success; the modal passes `RuntimeKnobValues`; `reset` notifies success only on `true`.
   - Update `makeConfigStore` (step 2) to the new signature with a configurable result.
   - Tests:
     - `config-modal.test.ts` › `reset`: a store whose save returns `false` produces no "reset to defaults" notice; `true` produces it.
     - `config-store.test.ts`: after a refresh that loads `shellTools`, a save of the default knobs keeps `current().shellTools`.
   - Killing mutations: make `reset` notify unconditionally (first test); restore `this.config = normalizePermissionSystemConfig(knobs)` (second).
   - Run `pnpm --filter @gotgenes/pi-permission-system run check` right after: the interface changed.
8. **`fix(pi-permission-system): a /permission-system save refuses a config file that fails to parse or validate`**
   - Extract `parseUnifiedConfigText(raw, path)` (exported now that the writer imports it); add `config-file-writer.ts` with read, refuse, candidate-schema check, and the existing temp-plus-rename write, its candidate still `JSON.stringify({...existingConfig, ...values}, null, 2)`; `ConfigStore.save` delegates and notifies on `refused`.
   - Tests (`config-file-writer.test.ts`):
     - unknown key, non-JSON text, a directory, and an empty file are each `refused`, with the file byte-identical;
     - `debugLog: "on"` is `refused` with nothing written.
   - Tests (`config-store.test.ts`): the issue's reproduction — a file with a `bash` `rm *` deny and a `typoKey` — is unchanged after `save({..., yoloMode: true})`, the error notice names the path and `typoKey`, `save` returns `false`, `current()` is unchanged.
     The tmp-cleanup test from step 1 now expects `refused` (the read fails before any write).
   - Test (`config-modal.test.ts`, delta on step 3): a store whose save leaves `current()` unchanged reverts the list to the stored value.
   - Killing mutations:
     - remove the existing-file issue check — the unknown-key, non-JSON, empty-file, and reproduction tests go red;
     - remove the candidate schema check — the `debugLog: "on"` test goes red;
     - remove the read-error branch so a read failure falls through as an empty file — the directory test goes red.
9. **`fix(pi-permission-system): a /permission-system save keeps the config file's comments and formatting`**
   - Add `jsonc-parser` `^3.3.1` (lockfile in the same commit); the candidate is built with `modify` + `applyEdits`, inserting at index 0 in reverse table order; add the `isDeepStrictEqual` guard.
   - Tests (`config-file-writer.test.ts`):
     - the input `{\n  // c\n  "permission": { "*": "ask" },\n  "promptMaxRows": 10 // rows\n}\n` yields exactly the four knob lines followed by every original line unchanged (assert the whole text with `toBe`);
     - an existing knob is replaced in place;
     - an absent file is created with the four knobs;
     - `{"debugLog": true, "debugLog": true}` is `refused` and unchanged.
   - Killing mutations:
     - return to `JSON.stringify` — the comment test goes red;
     - drop `getInsertionIndex` — the same test goes red on the moved `// rows`;
     - drop the equality guard — the duplicate-key test goes red.
   - Carries the `Co-authored-by` trailer above.
10. **`fix(pi-permission-system): a /permission-system save writes the config file owner-only and atomically`**
    - Unique temp name (`randomUUID()`), `openSync(…, "wx", OWNER_ONLY_FILE_MODE)`, `fsyncSync`, `closeSync`, rename; parent created with `OWNER_ONLY_DIRECTORY_MODE`.
    - Tests (`config-file-writer.test.ts`, skipped on `win32`):
      - the written file's `mode & 0o777` is `0o600`, including when it replaced a `0644` file;
      - a stale `config.json.tmp` beside the target does not block the save.
    - Killing mutation: drop the mode argument — the mode test goes red.
      `fsyncSync` is not observable in a unit test; it is reviewed, not pinned.
    - Carries the `Co-authored-by` trailer above.
11. **`docs(pi-permission-system): document what a /permission-system save writes and refuses`**
    - The `docs/configuration.md` paragraph; the architecture module-tree entries; the roadmap `✅` heading, `S1102` node, and `Landed:` note.
    - Verify: `pnpm exec rumdl check` on both files.

## Risks and Mitigations

- **`jsonc-parser` mis-edits a shape the spike did not cover.**
  The equality guard re-parses the candidate with the loader's own parser and refuses any result that differs from the intended object, so a mis-edit becomes a refusal, never a lost rule; the duplicate-key test proves the guard fires on a real input.
- **A user with a deliberately unusual but valid file is refused.**
  Only when the edit cannot be made exactly (duplicate keys); the notice names the issue.
- **The `0600` mode surprises someone who shares the global config through group permissions.**
  The ADR sets it; the docs paragraph states it.
- **Temp-file cleanup on a failed rename is hard to reach through the real filesystem** once step 8 refuses unreadable targets.
  The cleanup code is unchanged in shape from today's; step 1 pins it before step 8 moves it, and the reviewer reads it in step 10.
- **The `0600` and stale-temp tests depend on POSIX permissions.**
  Skipped on `win32`; no test uses `chmod` to induce failure, so a CI runner as root cannot false-green one.

## Open Questions

- Whether [#1123]'s rule writer reuses `writeConfigValues` directly or needs a nested-path variant (`["permission", surface, pattern]`); the result type and the guard carry over either way.

[#692]: https://github.com/gotgenes/pi-packages/pull/692
[#856]: https://github.com/gotgenes/pi-packages/issues/856
[#1122]: https://github.com/gotgenes/pi-packages/issues/1122
[#1123]: https://github.com/gotgenes/pi-packages/issues/1123
[#1125]: https://github.com/gotgenes/pi-packages/issues/1125
[#1126]: https://github.com/gotgenes/pi-packages/issues/1126
[#1133]: https://github.com/gotgenes/pi-packages/issues/1133
