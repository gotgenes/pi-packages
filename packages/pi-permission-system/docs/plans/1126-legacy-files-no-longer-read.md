---
issue: 1126
issue_title: "pi-permission-system: stop reading the legacy config files"
---

# The legacy config files are no longer read

## Release Recommendation

**Release:** ship independently

The Phase 16 roadmap step for this issue carries `Release: independent`, and the roadmap's `Release batches` subsection says there is no batch.
The change is breaking (`feat!:`), and the README commits each breaking change to its own release, so it cuts its own major.

## Problem Statement

ADR 0016 §3 (`docs/decisions/0016-policy-channels.md`) decided that the three legacy config files are no longer read: their detection stays, and the warning becomes "`<path>` is no longer read; move it to `<new path>`".
Today `loadAndMergeConfigs` (`src/config/config-loader.ts`) still loads `~/.pi/agent/pi-permissions.jsonc`, the install directory's `config.json`, and (trust-gated) `<cwd>/.pi/agent/pi-permissions.jsonc`, merges each into the runtime knobs, and folds each one's `commandEffects` into `declaredCommandEffects`.
Their validation issues are suppressed, so a legacy-format file (`defaultPolicy`, `tools`, …) fails strict validation and contributes `{}` without a word, while a flat-format one silently changes behavior through a channel the docs call migrated away.
The notice it raises also prints an `mv <legacy> <new>` command, which overwrites an existing new-layout `config.json` and, for a legacy-format file, turns a working global scope into a rejected one that falls to the universal `ask`.

Planning found that the third file has not been looked for at its real location for 70 releases.
`EXTENSION_ROOT` is `join(dirname(<extension-config.ts>), "..")`, and commit `367f4e34` (2026-09-04) moved that module into `src/config/`, so the root resolves to `<install dir>/src` and the lookup is `<install dir>/src/config.json`.
Measured with a disposable Vitest spike printing `EXTENSION_ROOT` and `getLegacyExtensionConfigPath(EXTENSION_ROOT)`: `…/packages/pi-permission-system/src` and `…/packages/pi-permission-system/src/config.json`.
`git log 367f4e34..HEAD --grep='chore(release): pi-permission-system'` counts 70 releases, 31.1.1 through 45.1.0.

## Goals

- Neither `pi-permissions.jsonc` file is read: no runtime knob, `commandEffects` declaration, or `permission` map from either reaches `MergedConfigResult`.
- Each, when present, raises exactly one notice: `'<path>' is no longer read; move its settings to '<new path>' — see <legacy-to-flat.md#legacy-file-locations URL>` (operator decision: ADR wording plus a guide link, no `mv` line).
- The project file's notice stays trust-gated, as today: an untrusted project raises none.
- The install-directory `config.json` is dropped from detection entirely (operator decision), with `EXTENSION_ROOT`, `getLegacyExtensionConfigPath`, `loadAndMergeConfigs`' `extensionRoot` parameter, and the `config.resolved` entry's `legacyExtensionConfigDetected` flag; ADR 0016 §3 gets a dated amendment saying so.
- `docs/migration/legacy-to-flat.md` gains a section naming the three locations and what stops applying, and the README's `## Upgrading` gains a subsection for this major.
- Ride-along (roadmap): `mergeUnifiedConfigs`' five hand-written override picks become one helper, and its JSDoc is reattached.
- **Breaking.**
  Whatever a stale legacy file set stops applying: `feat(pi-permission-system)!:` with a `BREAKING CHANGE:` footer, on two commits (the install-directory file, then the two `pi-permissions.jsonc` files).

## Non-Goals

- Removing the detection of the two `pi-permissions.jsonc` files or their `config.resolved` flags; ADR 0016 §3 keeps detection.
- Reading a legacy file to tell the user which of its settings are lost: the ADR says the files are not read, and the notice plus the migration section carry the list.
- One read per config file ([#1028]): this step leaves `loadUnifiedConfig` with two callers in `config-loader.ts`, which is the shape [#1028] needs, but merges no loaders.
- Sharing the new pick helper with `normalizePermissionSystemConfig`'s `!== undefined` copies in `extension-config.ts`: that function applies defaults to one source, a different operation (Tidy-First assessor, rejected).
- The duplicate `EXTENSION_ID` constants in `config-paths.ts` and `extension-config.ts` (unrelated to this change).
- `detectMisplacedPermissionKeys` (`extension-config.ts`): it names legacy *format* keys, not legacy files, and is untouched.

## Background

- `loadAndMergeConfigs(agentDir, cwd, extensionRoot, { includeProjectScope })` merges five layers today: legacy global, legacy install-dir, new global, legacy project, new project.
  Its one `src/` caller is `ConfigStore.refresh` (`src/config/config-store.ts`), which passes `EXTENSION_ROOT`.
- `ConfigStore.logResolvedPaths` detects the same three files again with `existsSync` (the install-dir one behind a `normalize(...) !== normalize(newGlobalPath)` guard duplicated from the loader) and hands booleans to `buildResolvedConfigLogEntry` (`src/config/config-reporter.ts`) for the `config.resolved` review/debug entry.
  Its project detection is cwd-gated, not trust-gated.
- A legacy file's `permission` map never reached the enforced policy: `FilePolicyLoader` (`src/config/policy-loader.ts`) reads only the new-layout files (`rg -i legacy src/config/policy-loader.ts` finds nothing).
  In `MergedConfigResult.merged.permission` it fed only `detectPermissiveBashFallback`, the bash-ungated warning.
- Not every lost knob is harmless; grepped and traced, `UnifiedPermissionConfig`'s non-`permission` keys reach the runtime through `normalizePermissionSystemConfig`:
  - `shellTools` routes an aliased tool (`exec_command`) through the bash gate (`resolveShellInvocation`, `src/access-intent/tool-kind.ts`); losing a legacy entry gates that tool under its own name, so under `"*": "allow"` a bash `deny` stops reaching it.
  - `authorizerChain` names live links; losing a deny-first link means its asks reach the human, or under auto-approve, are approved.
  - The rest (`debugLog`, `permissionReviewLog`, prompt and log bounds, `piInfrastructureReadPaths`, `permissionDialogKeys`, `promptNotifications`, `commandEffects`) lose only a preference, a relief, or a log; none loosens a gate.
  So "no permission rule lives in these files" holds, and "no deny is lost" holds for rules but not for those two knobs; the migration section and the `BREAKING CHANGE:` footer say so.
- The original layout move (`docs/plans/archive/0010-consolidate-config-layout.md`) planned legacy tolerance "for one release" with "dropping legacy-path support entirely" as a follow-up, so removing the merge finishes a planned deprecation rather than undoing a convention.
- `ConfigIssueReporter` warns each issue string at session start, latched per string (#933), so a notice whose text depends only on the path warns once per session per file.
- Package skill constraints that apply: keep config files the source of truth; treat a declared config field not read at runtime as a maintenance trap (the `legacyExtensionConfigDetected` flag is one once the lookup is gone).

## Design Overview

### How the evidence was produced

- `EXTENSION_ROOT`: a disposable Vitest file under `test/` imported `EXTENSION_ROOT` and `getLegacyExtensionConfigPath` through `#src/…` and appended both to `/tmp/er.txt`; run once through `pnpm --filter @gotgenes/pi-permission-system exec vitest run`, then deleted.
- The pick helper's typing: a disposable `src/config/` module with a generic `copyOverrideWins<K extends keyof UnifiedPermissionConfig>` over a mixed `as const` key list (boolean, number, array, `permissionDialogKeys`, `promptNotifications`) type-checked clean under `tsc --noEmit`, with no cast; deleted.
- The npm-upgrade claim (a hand-placed file in the install directory does not survive a version upgrade) is **estimated**, not measured: the project's tooling blocks `npm`, and the decision does not rest on it, since the 70-release wrong-path lookup already shows no install has been warned.

### Behavior, before and after

| A user has…                                                           | Before                                                | After                                                             |
| --------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| `~/.pi/agent/pi-permissions.jsonc` with `debugLog: true`              | debug log on; notice with `mv` line                   | debug log off; one notice, no `mv`                                |
| the same file in legacy format (`defaultPolicy`, …)                   | contributes `{}` silently; notice with `mv` line      | one notice, no `mv`                                               |
| `<cwd>/.pi/agent/pi-permissions.jsonc` with `commandEffects`, trusted | declarations folded as `project`; notice              | no declarations; one notice                                       |
| the same, untrusted                                                   | nothing read, no notice                               | nothing read, no notice                                           |
| `<install dir>/config.json`                                           | not found (lookup is `<install dir>/src/config.json`) | not looked for                                                    |
| `<install dir>/src/config.json`                                       | merged as global; notice                              | not looked for                                                    |
| a `config.resolved` log entry                                         | three `legacy…Detected` flags                         | two (`legacyGlobalPolicyDetected`, `legacyProjectPolicyDetected`) |

### Detection as one function

`loadAndMergeConfigs` and `ConfigStore.logResolvedPaths` both ask which legacy files exist; after this change neither reads them, so the question gets one home in `config-loader.ts` (already doing I/O and already imported by `config-store.ts`; `config-paths.ts` stays pure path derivation):

```typescript
/** The legacy policy files present on disk; each is detected, never read. */
export interface LegacyPolicyFiles {
  global?: string;
  project?: string;
}

export function findLegacyPolicyFiles(
  agentDir: string,
  cwd: string | undefined,
): LegacyPolicyFiles;
```

It returns paths, not booleans: the loader turns each into a notice and the store into a flag.
Gating stays with the callers, which already own it:

```typescript
// loadAndMergeConfigs
const legacy = findLegacyPolicyFiles(agentDir, includeProjectScope ? cwd : undefined);
if (legacy.global) issues.push(legacyFileNotice(legacy.global, newGlobalPath));
if (legacy.project) issues.push(legacyFileNotice(legacy.project, newProjectPath));

// ConfigStore.logResolvedPaths
const legacy = findLegacyPolicyFiles(agentDir, cwd);
buildResolvedConfigLogEntry({ policyPaths, legacyGlobalPolicyDetected: legacy.global !== undefined, … });
```

A falsy `cwd` (`undefined` or `""`) skips the project file.
Today the loader, given `cwd === ""` and a trusted scope, probes `.pi/agent/pi-permissions.jsonc` relative to the process cwd; the only production call with no cwd is the factory's priming `configStore.refresh(undefined, false)` (`src/index.ts`), which is untrusted, so the difference is unreachable in production.

### The notice

```typescript
const LEGACY_FILES_GUIDE =
  "https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/migration/legacy-to-flat.md#legacy-file-locations";

function legacyFileNotice(path: string, replacement: string): string {
  return `'${path}' is no longer read; move its settings to '${replacement}' — see ${LEGACY_FILES_GUIDE}`;
}
```

The URL form follows the `#1001` notice (`docs/migration/1001-pi-mcp-tools-on-mcp-surface.md`); the quoting follows the loader's other notices (`'…'`).
The anchor is the new `## Legacy file locations` heading in `legacy-to-flat.md`, which lands in the same commit as the notice.

### Two layers

With the legacy layers gone, `loadAndMergeConfigs` merges `mergeUnifiedConfigs(globalConfig, projectConfig)` directly, and the `foldDeclared` closure becomes two direct `foldDeclaredCommandEffects` calls.
`merge(merge({}, g), p)` equals `merge(g, p)` because `mergeUnifiedConfigs` reads only its picked keys, `shellTools`, and `permission`; the test "keeps declarations out of the merged config, which holds no scope" pins that `commandEffects` stays out either way.

### The pick helper (ride-along)

```typescript
const OVERRIDE_WINS_KEYS = [
  "debugLog", "permissionReviewLog", "yoloMode", "doublePressToConfirm",
  "forwardingTimeoutMs", "promptTimeoutMs", "promptMaxRows", "promptFieldMaxWidth",
  "reviewLogFieldMaxWidth", "toolInputPreviewMaxLength", "toolTextSummaryMaxLength",
  "piInfrastructureReadPaths", "authorizerChain", "permissionDialogKeys", "promptNotifications",
] as const;

function copyOverrideWins<K extends keyof UnifiedPermissionConfig>(
  merged: UnifiedPermissionConfig,
  base: UnifiedPermissionConfig,
  override: UnifiedPermissionConfig,
  key: K,
): void {
  const value = override[key] ?? base[key];
  if (value !== undefined) merged[key] = value;
}
```

`merged` is the caller's own local, built and returned by `mergeUnifiedConfigs`, so the write is not into a received collaborator.
The rationale comments the current loops carry (why `permissionDialogKeys` is replaced whole, why `shellTools` merges by name) move into the JSDoc, which is reattached above the function; `shellTools` and `permission` keep their own blocks.

### Edge cases and where each is tested

- A legacy-format legacy file raises only the notice: step 5.
- A flat-format legacy file's knobs, `commandEffects`, and `permission` contribute nothing: step 5.
- An untrusted project's legacy file raises no notice: step 5.
- A legacy file beside a new-layout file: the new one applies, the legacy one only notices: step 5.
- A falsy `cwd` skips the project file in both callers: step 4 (the `undefined` case; `""` shares the check).
- An absent override key stays absent from the merge (the `!== undefined` guard): step 1.

## Module-Level Changes

- `src/config/config-loader.ts`:
  - `mergeUnifiedConfigs` gains one key list and `copyOverrideWins` (step 2).
  - `findLegacyPolicyFiles` and `LegacyPolicyFiles` are added (step 4).
  - `loadAndMergeConfigs` drops the `extensionRoot` parameter, the install-dir block, and the `normalize` import (step 3), then stops loading the two remaining files, raises `legacyFileNotice`, and merges two layers (step 5).
  - The JSDoc's five-item merge-order list and its "parsed with the flat-format parser" paragraph are rewritten (step 5).
- `src/config/config-store.ts`: `refresh` stops passing `EXTENSION_ROOT`, and `logResolvedPaths` drops the install-dir detection, its `normalize` guard, and the `normalize` import (step 3); `logResolvedPaths` calls `findLegacyPolicyFiles`, and the `getLegacy*Path` and `existsSync` imports go (step 4).
- `src/config/config-reporter.ts`: `legacyExtensionConfigDetected` leaves `ResolvedConfigLogEntry`, `BuildResolvedConfigLogEntryOptions`, and `buildResolvedConfigLogEntry` (step 3).
- `src/config/config-paths.ts`: `getLegacyExtensionConfigPath` is removed (step 3); the two `pi-permissions.jsonc` path functions stay.
- `src/config/extension-config.ts`: `EXTENSION_ROOT` and `resolveExtensionRoot` are removed, along with the `dirname`, `join`, and `fileURLToPath` imports if nothing else in the file uses them (step 3; the assessor reports nothing else does, re-check at the step).
- `test/config/config-loader.test.ts`:
  - The `mergeUnifiedConfigs` characterization table is added (step 1).
  - `extensionRoot`, `writeLegacyExtensionConfig`, and the two install-dir tests go, and every `loadAndMergeConfigs(` call drops its third argument (step 3; grep the bare callee, which appears 25 times).
  - `findLegacyPolicyFiles` tests are added (step 4).
  - The legacy tests are rewritten under one `describe("legacy config files")`: "detects legacy global policy…", "detects legacy project policy…", "new-layout config takes precedence over legacy config…", "omits the legacy project policy when includeProjectScope is false", and "counts the legacy files toward their own scopes" (step 5).
- `test/config/config-pipeline.test.ts`: `extensionRoot` and the third argument go from its seven `loadAndMergeConfigs(` calls (step 3).
- `test/config/config-paths.test.ts`: the `getLegacyExtensionConfigPath` import and test go (step 3).
- `test/config/config-reporter.test.ts`: the `legacyExtensionConfigDetected` fixture and assertion lines (31, 39, 44, 102) go (step 3).
- `test/config/config-store.test.ts`:
  - The three `refresh` tests asserting `toHaveBeenCalledWith(agentDir, cwd, expect.any(String), {…})` drop the `expect.any(String)` argument (step 3).
  - The comment above "reports a legacy global policy file found in the agent dir" about the install-dir path goes (step 3).
  - Its `logResolvedPaths` assertions are tightened from `expect.objectContaining` to the full options object (step 4).
- `docs/troubleshooting.md`: the `"legacyExtensionConfigDetected": false` line leaves the `config.resolved` sample (step 3).
- `docs/migration/legacy-to-flat.md`: a new `## Legacy file locations` section (step 5) names the three locations, says none is read and where each moves, lists what stops applying (with the `shellTools` and `authorizerChain` cases called out), and notes that a legacy-format file needs the translation above rather than a move.
- `README.md` (step 6):
  - `## Upgrading` gains `### The major after 45.x — the legacy config files are no longer read`.
    Re-read `package.json`'s version at the step: if another major has shipped, use the line the release follows.
  - The `legacy-to-flat.md` row in the docs table names the file-locations section.
- `docs/decisions/0016-policy-channels.md` (step 6): frontmatter `amended:`, a status-line sentence, and an `#### Amendment (<date>, [#1126])` under §3 saying the install-directory file is not detected (it had been looked for at `<install dir>/src/config.json` since 31.1.1, and every upgrade replaces the install directory).
  The §Context channel table stays as the historical trace it is.
- `docs/architecture/architecture.md` (step 6):
  - The `config-loader.ts` module-tree entry stops describing legacy layers folding into `global`/`project`.
  - The `config-reporter.ts` entry is predicted unchanged: "the legacy-file detection flags" stays true with two flags.
  - The roadmap step heading gains `✅`, and the Mermaid node `S1126` gains `✅ `.
  - A `Landed:` note is added.
  - The health-metrics rows are recomputed.
- Predicted unchanged:
  - `src/config/policy-loader.ts`, since it never read a legacy file (grep above).
  - `src/index.ts`, since it never names `EXTENSION_ROOT` (`rg EXTENSION_ROOT src` lists only `extension-config.ts` and `config-store.ts`).
  - `docs/configuration.md` and `docs/glossary.md`, since neither names a legacy file location (`rg 'pi-permissions\.jsonc|install dir'` finds only an unrelated Pi-install-directory line).
  - `schemas/permissions.schema.json`, since no schema field changes.

## Test Impact Analysis

1. New tests the change enables: `findLegacyPolicyFiles` is unit-testable on a temp directory without driving the whole loader, and the characterization table pins all fifteen override keys in three cases each, which no test did for `forwardingTimeoutMs` at all (assessor finding, verified: `forwardingTimeoutMs` appears 0 times in the `mergeUnifiedConfigs` describe block).
2. Tests made redundant: the two install-dir tests and the `getLegacyExtensionConfigPath` path test are deleted with their subject; "new-layout config takes precedence over legacy config at same scope" no longer has a precedence to test and is rewritten as "a legacy file beside a new-layout file only notices".
3. Tests that stay as they are: the new-layout merge, trust-gating, `commandEffects` stamping, retired-`yoloMode`, and bash-fallback tests in `loadAndMergeConfigs`, and `config-pipeline.test.ts`'s seam tests (only the argument changes).

## Invariants at risk

- Project trust gating ([#644]): an untrusted project contributes nothing and now also raises no legacy notice.
  Pinned by "omits the new project config when includeProjectScope is false" (unchanged) and the rewritten "omits the legacy project policy…" (step 5), which runs the real loader over temp files.
- `commandEffects` scope stamping ([#880]): "merges global and project declarations by command, stamping each scope" stays and runs the real loader.
- The retired `yoloMode` warning ([#1118]) reads `merged`; a legacy file's `yoloMode` no longer warns, by design, because the file is not read; the "the retired yoloMode" tests cover the new-layout files and stay green.
- Per-issue latching (#933): each notice's text depends only on the two paths, so the same file yields the same string every refresh; `ConfigIssueReporter`'s own tests are unaffected.
- Health metrics, recomputed at planning time from the roadmap's commands:
  - Legacy-file merges in `config-loader.ts`: measured 3, predicted 0.
  - Lines naming `loadUnifiedConfig(` in `src/`: measured 7 (the roadmap baseline reads 9, and earlier steps moved it), predicted 4: `policy-loader.ts` 1, plus `config-loader.ts`'s two calls and its definition.

## TDD Order

1. **Pin every `mergeUnifiedConfigs` override pick.**

   Surface: `test/config/config-loader.test.ts`, a new nested `describe("override-wins keys")` under `mergeUnifiedConfigs` with one `it.each` over the fifteen keys of the helper's list × three cases: override wins, base carries when the override omits it, absent from both stays absent (`not.toHaveProperty`, since `toEqual` ignores an `undefined`-valued key).
   Values are literals per key, typed to the key (a boolean, a positive integer, a string array, a dialog-key map, a notification list).
   These pass at Red by design (characterization).
   Killing mutations:
   - Delete `"forwardingTimeoutMs"` from the number loop: the `forwardingTimeoutMs` override and base rows go red.
   - Replace the boolean loop's `if (value !== undefined)` guard with an unconditional assignment: the absent rows for the four booleans go red.

   Commit: `test(pi-permission-system): pin every mergeUnifiedConfigs override pick`.

2. **One helper picks the override-wins keys.**

   Collapse the boolean, number, array, `permissionDialogKeys`, and `promptNotifications` picks into `OVERRIDE_WINS_KEYS` plus `copyOverrideWins`.
   Reattach the JSDoc above the function, folding in the rationale the `// Scalar knobs…` and per-block comments carry.
   Step 1's table and the existing `mergeUnifiedConfigs` tests pin it, and no new tests are added.
   Re-read the moved comments against the `code-design` skill before committing.
   Commit: `refactor(pi-permission-system): pick mergeUnifiedConfigs' override-wins keys with one helper`.

3. **Stop looking for a `config.json` in the install directory.**

   Remove the install-dir block from `loadAndMergeConfigs` and its `extensionRoot` parameter, `EXTENSION_ROOT` / `resolveExtensionRoot`, `getLegacyExtensionConfigPath`, the store's install-dir detection, and `legacyExtensionConfigDetected` from the reporter.
   In the same commit, update every consumer and test listed under Module-Level Changes for step 3, plus the `docs/troubleshooting.md` sample.
   Removed exports break their importers at the type level, so all of it lands together.
   Tests: `config-reporter.test.ts`'s entry assertions become `toStrictEqual` on the two-flag shape.
   Killing mutation: re-add `legacyExtensionConfigDetected: false` to `buildResolvedConfigLogEntry`'s return; the strict-equality assertions go red.
   Run `pnpm --filter @gotgenes/pi-permission-system run check` right after, since a shared signature changed.
   Commit: `feat(pi-permission-system)!: stop looking for a config.json in the install directory`, with footer:

   ```text
   BREAKING CHANGE: the extension no longer looks for a legacy config.json in its install directory, and the config.resolved log entry drops legacyExtensionConfigDetected. Since 31.1.1 that lookup resolved to <install dir>/src/config.json, so no install has been read from or warned about the file since.
   ```

4. **Find the legacy policy files in one place.**

   Add `findLegacyPolicyFiles(agentDir, cwd)` to `config-loader.ts`.
   `loadAndMergeConfigs` calls it with `includeProjectScope ? cwd : undefined` and, for now, still loads and merges each path it returns, with the old notice text; `ConfigStore.logResolvedPaths` calls it with its own `cwd`.
   Tests in `config-loader.test.ts`, `describe("findLegacyPolicyFiles")`, each asserting the full result with `toStrictEqual`:
   - neither file exists → `{}`;
   - the global file only → `{ global: <path> }`;
   - both files → both paths;
   - `cwd` `undefined` → `{ global: <path> }` with no `project` key.
     The `""` case shares the same truthiness check and is not tested separately: `""` resolves against the process cwd, so a test of it cannot discriminate without a `process.chdir`.

   `config-store.test.ts`'s two `logResolvedPaths` legacy tests assert the full options object.
   Killing mutations:
   - Make `findLegacyPolicyFiles` return `{}`: the global and both-files tests, and the store's "reports a legacy global policy file" test, go red.
   - Drop the `cwd` truthiness check: the `undefined` test goes red (`join(undefined, …)` throws).

   Commit: `refactor(pi-permission-system): find the legacy policy files in one place`.

5. **Stop reading the legacy config files.**

   `loadAndMergeConfigs` raises `legacyFileNotice` for each path `findLegacyPolicyFiles` returns and loads neither; it merges `mergeUnifiedConfigs(globalConfig, projectConfig)` and folds the two scopes' `commandEffects` directly.
   Rewrite the JSDoc.
   Add `## Legacy file locations` to `docs/migration/legacy-to-flat.md` in the same commit, so the notice's anchor resolves.
   Tests, in a new `describe("legacy config files")` under `loadAndMergeConfigs`, replacing the five legacy tests named under Module-Level Changes; each asserts `issues` with `toEqual([<exact notice>])` built from the expected paths and the guide URL literal:
   - A flat-format global legacy file holding `debugLog: true`, `commandEffects`, and a `permission` map: `merged` `toStrictEqual({})` and `declaredCommandEffects` `toStrictEqual({})`.
   - The same with a trusted project legacy file.
   - An untrusted project legacy file: `issues` `toEqual([])`.
   - A legacy-format global file (`defaultPolicy`, `tools`): only the notice.
   - A legacy global file with `debugLog: true` beside a new global file with `debugLog: false`: `merged.debugLog` is `false`, plus the notice.

   Killing mutations:
   - Restore `merged = mergeUnifiedConfigs(merged, loadUnifiedConfig(legacy.global).config)`: the global knob test goes red.
   - Restore the project file's `foldDeclaredCommandEffects(…, "project")`: the project test's `declaredCommandEffects` goes red.
   - Pass `cwd` instead of `includeProjectScope ? cwd : undefined`: the untrusted test goes red.
   - Append `:\n  mv …` to the notice: every exact-notice assertion goes red.

   Commit: `feat(pi-permission-system)!: stop reading the legacy config files`, with footer:

   ```text
   BREAKING CHANGE: ~/.pi/agent/pi-permissions.jsonc and <cwd>/.pi/agent/pi-permissions.jsonc are no longer read. A runtime knob or commandEffects declaration set only there stops applying, and each file, when present, raises a notice naming where to move its settings. No permission rule was ever read from these files, but two knobs can loosen when lost: a shellTools entry stops routing its tool through your bash rules, and an authorizerChain link stops running. See docs/migration/legacy-to-flat.md#legacy-file-locations.
   ```

6. **Document the major.**

   Make the README `## Upgrading` subsection and docs-table row, the ADR 0016 §3 amendment, and the architecture-doc updates listed under Module-Level Changes.
   Get the amendment date from `date -u +%Y-%m-%d`.
   In the `Landed:` note, name `findLegacyPolicyFiles` and the install-dir drop (an operator decision), and give the recomputed metrics (legacy-file merges 3 → 0, `loadUnifiedConfig(` lines 7 → 4), each re-run, not copied from this plan.
   Commit: `docs(pi-permission-system): document the legacy config files no longer read`.

## Risks and Mitigations

- **A user loses a `shellTools` or `authorizerChain` entry that lived only in a legacy file, and a gate loosens.**
  The notice fires at every session start while the file exists; the migration section and the `BREAKING CHANGE:` footer name both cases.
  Reading the file to detect them is declined by ADR 0016 §3.
- **Dropping the install-dir lookup hides a real file.**
  The lookup has been at the wrong path since 31.1.1, so dropping it changes no install's behavior except one holding `<install dir>/src/config.json`; an upgrade that replaces the install directory removes that file anyway (estimated).
- **The notice's anchor drifts from the heading.**
  Both land in step 5; the step-5 tests assert the URL literal, and the pre-completion review checks that `legacy-to-flat.md` has a `## Legacy file locations` heading.
- **The `""`-cwd behavior change surfaces somewhere.**
  The only production no-cwd call is untrusted (`src/index.ts`, `configStore.refresh(undefined, false)`), and step 4 pins the new behavior.
- **The pick helper silently changes a merge.**
  Step 1 pins all fifteen keys in three cases before step 2 touches the code.

## Open Questions

- None blocking.
  Whether the two `pi-permissions.jsonc` detections should eventually go too is a later decision; ADR 0016 §3 keeps them for now.

[#644]: https://github.com/gotgenes/pi-packages/issues/644
[#880]: https://github.com/gotgenes/pi-packages/issues/880
[#1028]: https://github.com/gotgenes/pi-packages/issues/1028
[#1118]: https://github.com/gotgenes/pi-packages/issues/1118
