---
issue: 1090
issue_title: "upgrade zod dependency - versions below 4.6.6 are affected by CVE-2023-54404"
---

# Raise the zod floor and bound every config array

## Release Recommendation

**Release:** ship independently

The issue sits in no roadmap: neither `pi-permission-system` nor `pi-permission-model-judge` has an open improvement phase.
The release names both packages, and each takes a major because each package's bound step is `fix(<pkg>)!:`.

## Problem Statement

A third-party report (`@robertpeteuil`) asks us to require zod 4.6.6 or later, because CVE-2023-54404 covers zod through 4.6.5.
Their scanner flags the published `@gotgenes/pi-permission-system@41.0.0` manifest, which declares `zod: ^4.4.3`; `@gotgenes/pi-permission-model-judge` declares the same range.
A follow-up comment notes that 4.6.6 "may not be completely fixed".

That comment is right.
The CVE is unbounded memory growth: zod's `$ZodArray` records one issue per failing element with no cap, so a large invalid array exhausts the heap.
The upstream fix ([colinhacks/zod#6652], closing [colinhacks/zod#6643]) does not cap issue accumulation.
It makes `.max()` / `.length()` / `.size()` reject an oversized array, set, or map **before** any element is walked.
An unbounded `z.array` still validates every element; the maintainer's close comment says to "put a `.max()` on anything that takes untrusted input".
None of our six config arrays has a bound, so raising the floor alone changes the version a scanner sees but not the memory a malicious config file can force.

## Goals

- Require the latest published zod, `^4.6.7`, in both packages, and drop every zod below 4.6.6 from the repo lockfile.
- Bound every config array in both packages at 1,000 entries, so an oversized array is rejected with one issue before zod walks its elements.
- **Breaking:** a config file whose array field holds more than 1,000 entries loads today and is rejected after the upgrade.
  In `pi-permission-system` the rejected scope fails closed (its rules drop to the universal `ask`; a non-global scope also floors `allow` to `ask`).
  In `pi-permission-model-judge` the config does not load and the judge registers nothing.
  Each bound step therefore lands as `fix(<pkg>)!:` with a `BREAKING CHANGE:` footer.
  The operator chose this classification over "non-breaking hardening".
  The largest array in the five configs on disk is 2 entries (measured), so no known config is near the cap.

## Non-Goals

- **Capping `z.record` maps** (`permission`, `commandEffects`, `subcommands`, `shellTools`, `permissionDialogKeys`). zod 4.6.7 offers no pre-walk cap for a record: `capSize` is wired only into `$ZodArray`, `$ZodMap`, and `$ZodSet` (verified in the compiled `v4/core/schemas.js`).
  This is an accepted residual.
  `pi-permission-system`'s records are read only from the operator's global config or a trusted project's, and `pi-permission-model-judge`'s schema has no record.
- **Gating `pi-permission-model-judge`'s project config on `ctx.isProjectTrusted()`.**
  The judge reads an untrusted project's config today, which is the one path where an attacker controls the zod input.
  Fixing that is a trust-boundary change, tracked in [#1092]; this plan's bound only caps the memory that file can force.
- **Wire ingestion of forwarded permission requests** ([#1069]).
  It proposes adding zod there; if it does, its arrays need the same bound, and that belongs to that issue.
- **Per-field caps** (an enum array bounded at its enum size).
  The operator chose one shared cap; a tighter cap would also reject duplicate entries such as `["bell", "bell"]` that load today.
- **A shared helper such as `boundedArray(schema)`.**
  It would hide `.max` from the `z.array(...)` call that each `.meta()` chain hangs off; a module-private constant is enough (Tidy-First assessor, rejected).
- `config/config.example.json` in both packages: predicted **unchanged**, because no example array approaches 1,000 entries; the example-validates tests pin it.

## Background

- **Where zod runs.**
  Each package calls zod exactly once, on config files only:
  - `pi-permission-system`: `validateUnifiedConfig` (`src/config/config-loader.ts`) runs `unifiedConfigSchema.safeParse`.
    It reads the global file, plus the project and legacy-project files only when `includeProjectScope` (the project-trust flag) is set.
    `FilePolicyLoader` reads the same files through `loadUnifiedConfig`.
  - `pi-permission-model-judge`: `loadModelJudgeConfig` (`src/config-loader.ts`) runs `modelJudgeConfigSchema.safeParse` over the shallow merge of the global and project layers, with no trust check ([#1092]).
- **Where the arrays are.**
  The schemas have six array sites (grep for `z.array` / `.array(`; confirmed by the Tidy-First assessor):

  | Package                     | Site                                | Line | Reached through                                                                                   |
  | --------------------------- | ----------------------------------- | ---- | ------------------------------------------------------------------------------------------------- |
  | `pi-permission-system`      | `declaredEffectsSchema`'s array arm | 337  | `commandEffects.<cmd>.effects`, a subcommand entry's `effects`, and the bare subcommand shorthand |
  | `pi-permission-system`      | `unlessOption`                      | 376  | `commandEffects.<cmd>.unlessOption`                                                               |
  | `pi-permission-system`      | `promptNotifications`               | 462  | top level                                                                                         |
  | `pi-permission-system`      | `piInfrastructureReadPaths`         | 519  | top level                                                                                         |
  | `pi-permission-system`      | `authorizerChain`                   | 526  | top level                                                                                         |
  | `pi-permission-model-judge` | `typoPatterns`                      | 33   | top level                                                                                         |

- **Fail-closed rejection.**
  The `pi-permission-system` skill's Configuration section governs this: a schema-invalid file rejects its whole scope, and a rejected non-global scope floors `allow` to `ask`.
  An oversized array takes that existing path; no new rejection mechanism is added.
- **Generated schemas.**
  Both `schemas/*.json` are generated from `config-schema.ts` (`pnpm run gen:schema`) and pinned by parity tests, so a `.max()` edit needs a regeneration in the same commit.
- **Precedent.** `config-schema.ts` already bounds a string: `reason: z.string().max(500)`.
- **Release-age gate.** zod 4.6.7 was published 2026-10-12 (`pnpm view zod time`), well past pnpm's 24-hour `minimumReleaseAge`.

## Design Overview

### The bound

Each package's `config-schema.ts` gains one module-private constant beside its other top-of-file constants.
Every array site chains `.max()` on it:

```typescript
/** The most entries any config array accepts; zod rejects a longer one before walking it. */
const MAX_CONFIG_ARRAY_ITEMS = 1000;

piInfrastructureReadPaths: z
  .array(z.string().min(1))
  .max(MAX_CONFIG_ARRAY_ITEMS)
  .optional()
  .meta({ ... }),
```

The constant is not exported, since tests pin the literal 1,000 as the documented contract, and it is not shared across packages.
`declaredEffectsSchema` is one definition reused at three places, so its one `.max()` covers all three.

### What the bound does under each zod version

I measured this with the published tarballs, running a probe schema through each version's own `safeParse`:

| Input                     | zod 4.4.3        | zod 4.6.7 with `.max(1000)` | zod 4.6.7, no bound      |
| ------------------------- | ---------------- | --------------------------- | ------------------------ |
| 1,000 valid entries       | accepted         | accepted                    | accepted                 |
| 1,001 invalid entries     | 1,002 issues     | **1 issue** (`too_big`)     | 1,001 issues             |
| 1,000,000 invalid entries | 1,000,001 issues | **1 issue**, under 1 ms     | 1,000,000 issues, 672 ms |

The 4.6.7 issue reads `Too big: expected array to have <=1000 items`, at the array field's path, so `formatConfigIssues` renders `Invalid config value at 'piInfrastructureReadPaths': Too big: expected array to have <=1000 items`.

A union site behaves differently.
`declaredEffectsSchema` is `z.union([enum, z.array(enum).max(N)])`, so a failed parse always reports a single top-level `invalid_union` issue, and each arm's issues sit nested in its `errors`.
The top-level count is therefore 1 under every version and discriminates nothing.
Measured on the leaf issues, flattened recursively through every `invalid_union`'s `errors`:

| Union site, 1,001 invalid entries                              | zod 4.4.3    | zod 4.6.7                                                    |
| -------------------------------------------------------------- | ------------ | ------------------------------------------------------------ |
| `effects`                                                      | 1,003 leaves | 2 leaves: `invalid_value` (enum arm) + `too_big` (array arm) |
| subcommand shorthand (a union nesting `declaredEffectsSchema`) | 1,004 leaves | 3 leaves                                                     |

So the tests assert two things over the flattened leaves:

- exactly one leaf is `too_big`;
- no leaf's path ends in an element index (a number).

This holds for plain and union sites alike, and it is red under 4.4.3 (1,001 element-indexed leaves) and red with the bound removed (no `too_big`).

### Edge cases (each pinned in a named step)

- Exactly 1,000 entries are accepted: Steps 3 and 4.
- 1,001 all-invalid entries yield one `too_big` and no element issue: Steps 3 and 4.
- An oversized array rejects the whole scope through the loader with one rendered message: Step 3 (`loadUnifiedConfig`) and Step 4 (`loadModelJudgeConfig`).
- Duplicate entries stay accepted up to the cap: covered by the 1,000-entry acceptance rows, which fill with one repeated value.

## Module-Level Changes

- `packages/pi-permission-system/package.json`: `zod` `^4.4.3` → `^4.6.7` (Step 1).
- `packages/pi-permission-model-judge/package.json`: `zod` `^4.4.3` → `^4.6.7` (Step 2).
- `pnpm-lock.yaml`: both importers resolve `zod@4.6.7`, and the dev-only `zod@4.4.3` reached through `pi-session-tools`' Pi 0.79.1 devDependencies is gone (Steps 1–2).
  The spike measured a 110-line lockfile diff and zero `zod@4.4.3` entries after `pnpm update -r zod`.
- `packages/pi-permission-system/src/config/config-schema.ts`: `MAX_CONFIG_ARRAY_ITEMS`, plus `.max()` on the five array sites (Step 3).
- `packages/pi-permission-system/schemas/permissions.schema.json`: regenerated; gains `maxItems: 1000` wherever an array is inlined (Step 3).
- `packages/pi-permission-system/test/config/config-schema.test.ts`: a new top-level `describe("array size bounds")` (Step 3).
- `packages/pi-permission-system/test/config/config-loader.test.ts`: one test under `describe("loadUnifiedConfig")` for the rendered rejection (Step 3).
- `packages/pi-permission-system/docs/configuration.md`: one sentence under the `## Runtime Knobs` table, and one in the `commandEffects` field section, stating the 1,000-entry cap and that a longer list rejects the file (Step 3).
- `.pi/skills/package-pi-permission-system/SKILL.md`: Configuration's "When adding a field" bullet gains "chain `.max(MAX_CONFIG_ARRAY_ITEMS)` on a new array" (Step 3).
- `packages/pi-permission-model-judge/src/config-schema.ts`: `MAX_CONFIG_ARRAY_ITEMS` and `typoPatterns: z.array(z.string().min(1)).max(MAX_CONFIG_ARRAY_ITEMS).default([])` (Step 4).
- `packages/pi-permission-model-judge/schemas/model-judge.schema.json`: regenerated (Step 4).
- `packages/pi-permission-model-judge/test/config-schema.test.ts`: a new `describe("array size bounds")` (Step 4).
- `packages/pi-permission-model-judge/test/config-loader.test.ts`: one loader-level test (Step 4).
- `packages/pi-permission-model-judge/docs/configuration.md` (field table, `typoPatterns` row) and `README.md` (the config table's `typoPatterns` row): state the cap (Step 4).

Predicted unchanged:

- `src/config/config-loader.ts` in both packages: the oversized array takes the existing invalid-file path.
- `packages/pi-permission-system/docs/architecture/architecture.md`: it describes no config-array shape (grep `piInfrastructureReadPaths|authorizerChain|promptNotifications` before committing Step 3 to confirm).

## Test Impact Analysis

1. **New tests enabled.**
   - A per-site bound test that discriminates the zod version itself: under 4.4.3 the rejection case yields 1,001 element-indexed leaves.
   - The bound row therefore pins the dependency floor as well as the `.max()`.
2. **Redundant tests.**
   None; the existing `rejects a non-string entry in piInfrastructureReadPaths` and `rejects an empty typoPatterns entry` pin element validation, a different claim.
3. **Unchanged tests that matter.**
   - Both schema-parity tests (`buildPermissionsJsonSchema` / `buildModelJudgeJsonSchema` vs the committed JSON) fail until the regeneration lands in the same commit.
   - Both `config.example.json` validation tests must stay green.
   - Steps 1–2 change no source.
     In the spike with zod 4.6.7, every package's test suite passed (`pi-permission-system` 6413 tests, `pi-permission-model-judge` 69, all others green), `pnpm -r run check` was clean, and `gen:schema` produced no diff in either package (all measured).

## Invariants at risk

- **Fail-closed rejection of an invalid scope** (the `pi-permission-system` skill's Configuration section): pinned today by the `loadAndMergeConfigs` / `FilePolicyLoader` invalid-file tests; Step 3's loader test adds an oversized-array case on the same path.
  It serves operators: a malformed file must never loosen policy.
- **Generated-schema parity**: the two parity tests pin it, and the regeneration rides with each `.max()` commit.
- **Example configs validate**: the example-validates tests in both packages.
- **Real configs still load**: measured against the five configs on disk (global and project `pi-permission-system`, global `model-judge`, both example files); the largest array is 2 entries.

## TDD Order

Steps 1–2 bump the dependency; steps 3–4 add the bound.
No Tidy-First preparatory step: the assessor found none needed, and its one optional item (the leaf-flattening helper) is folded into Step 3.

1. **`fix(pi-permission-system): require zod 4.6.7, which patches CVE-2023-54404`**
   - Set `zod` to `^4.6.7` in `packages/pi-permission-system/package.json`, then `pnpm install`.
   - No new tests: the step changes no source, and Step 3's rejection rows are the tests that discriminate the zod version.
   - Verify:
     - the lockfile importer for `packages/pi-permission-system` shows `specifier: ^4.6.7`, `version: 4.6.7`;
     - `pnpm --filter @gotgenes/pi-permission-system exec vitest run && pnpm --filter @gotgenes/pi-permission-system run check` is green;
     - `pnpm --filter @gotgenes/pi-permission-system run gen:schema` leaves `git status` clean.
   - Commit body: `Refs #1090`, then the final paragraph `Co-authored-by: Robert Peteuil <1554603+robertpeteuil@users.noreply.github.com>` (verify with `git interpret-trailers --parse`).
2. **`fix(pi-permission-model-judge): require zod 4.6.7, which patches CVE-2023-54404`**
   - Set `zod` to `^4.6.7` in `packages/pi-permission-model-judge/package.json`, then `pnpm install`, then `pnpm update -r zod` to lift the dev-only transitive copy.
   - Confirm with `git diff` that no `package.json` other than the lockfile changed in that last command.
   - Verify:
     - `grep -c 'zod@4.4.3' pnpm-lock.yaml` prints `0` (measured in the spike);
     - `pnpm -r run check` and `pnpm -r run test` are green;
     - `gen:schema` for model-judge leaves `git status` clean.
   - Same `Refs #1090` and `Co-authored-by:` trailer as Step 1.
3. **`fix(pi-permission-system)!: reject a config array longer than 1,000 entries before walking it`**
   - Red: in `test/config/config-schema.test.ts`, add a top-level `describe("array size bounds")` holding a local `leafIssues(issues)` helper.
     The helper recurses through each `invalid_union` issue's `errors` arms and returns the leaf issues.
     Add an `it.each` table of `[label, build(n, fill), expectedPath]` rows:
     - `piInfrastructureReadPaths`, `authorizerChain`, `promptNotifications` through `unifiedConfigSchema` (valid fills `"/p"`, `"x"`, `"bell"`; invalid fill `""` for the first two, `"beep"` for the third);
     - through `commandEffectsSchema`: `{ t: { effects } }`, `{ t: { unlessOption } }`, `{ t: { subcommands: { s: <array> } } }`, `{ t: { subcommands: { s: { effects } } } }` (valid fills `"read"` / `"--output"`, invalid fill `"x"`).
   - Each row gets two tests:
     - **accepts 1,000 valid entries:** `success === true`;
     - **rejects 1,001 invalid entries with only a size issue:** `success === false`, `leafIssues` has exactly one `too_big` whose path is `expectedPath`, and no leaf path ends in a number.
   - In `test/config/config-loader.test.ts` under `describe("loadUnifiedConfig")`, add one test: a file with 1,001 `piInfrastructureReadPaths` entries yields `config: {}` and exactly the issue list `["Invalid config value at 'piInfrastructureReadPaths': Too big: expected array to have <=1000 items"]`.
   - Green:
     - add `MAX_CONFIG_ARRAY_ITEMS` and chain `.max()` on the five sites;
     - `pnpm --filter @gotgenes/pi-permission-system run gen:schema`;
     - add the docs sentences and the skill bullet listed in Module-Level Changes.
   - Killing mutations:
     - delete one site's `.max(MAX_CONFIG_ARRAY_ITEMS)` (e.g. `authorizerChain`'s): that row's rejection test turns red (no `too_big`, 1,001 indexed leaves);
     - deleting `declaredEffectsSchema`'s turns all three effects rows red;
     - set `MAX_CONFIG_ARRAY_ITEMS = 999`: every acceptance row turns red;
     - pin zod back to `4.4.3` in the lockfile: every rejection row turns red (a `too_big` plus 1,001 indexed leaves) while the acceptance rows stay green.
   - Footer: `BREAKING CHANGE: a config.json array (piInfrastructureReadPaths, authorizerChain, promptNotifications, or a commandEffects effects / unlessOption list) longer than 1,000 entries is now rejected, and its scope fails closed.`
4. **`fix(pi-permission-model-judge)!: reject a typoPatterns list longer than 1,000 entries before walking it`**
   - Red: in `test/config-schema.test.ts`, add `describe("array size bounds")`:
     - `modelJudgeConfigSchema` accepts a valid config with 1,000 `typoPatterns`;
     - it rejects 1,001 `""` entries with exactly one issue, `{ code: "too_big", path: ["typoPatterns"] }`.
   - In `test/config-loader.test.ts`, add: a **project** file with 1,001 `typoPatterns` yields `config: undefined` and exactly one issue whose `path` is `typoPatterns`.
     This is the untrusted-reachable path [#1092] tracks.
   - Green:
     - add `MAX_CONFIG_ARRAY_ITEMS` and `.max()` on `typoPatterns`;
     - `pnpm --filter @gotgenes/pi-permission-model-judge run gen:schema`;
     - state the cap in `docs/configuration.md`'s field table and `README.md`'s config table.
   - Killing mutations:
     - delete the `.max()`: both rejection tests turn red (1,001 issues);
     - set the constant to 999: the acceptance test turns red.
   - Footer: `BREAKING CHANGE: a typoPatterns list longer than 1,000 entries is now rejected, so the config does not load and the judge registers nothing.`

## Risks and Mitigations

- **A real config exceeds 1,000 entries and starts failing closed.**
  Measured maximum on disk is 2.
  The failure is loud (the existing config-issue warning names the field and the cap), and the `BREAKING CHANGE:` footer reaches both changelogs.
- **The union assertion passes vacuously.**
  The Tidy-First assessor found that a top-level-issue count is 1 under every zod version at a union site.
  The leaf-flattening assertion was measured red under 4.4.3 (1,003 / 1,004 leaves) and green under 4.6.7 (2 / 3 leaves).
- **`pnpm update -r zod` rewrites more than intended.**
  In the spike it rewrote only the two zod specifiers, which Step 2 has already set to `^4.6.7`.
  Step 2 checks `git diff` before committing.
  `pnpm dedupe` was rejected: in the spike it churned 689 lockfile lines of unrelated packages.
- **Consumers keep a vulnerable zod through a stale lockfile.**
  The `^4.6.7` floor makes a range-respecting install resolve a patched zod; nothing on our side can update a consumer's lockfile.

## Open Questions

- Whether records should be capped later by a custom pre-check (for example a `z.record(z.string(), z.unknown())` key-count refine piped into the real record).
  Defer until a record is reachable from untrusted input; today none is.

[colinhacks/zod#6643]: https://github.com/colinhacks/zod/issues/6643
[colinhacks/zod#6652]: https://github.com/colinhacks/zod/pull/6652
[#1069]: https://github.com/gotgenes/pi-packages/issues/1069
[#1092]: https://github.com/gotgenes/pi-packages/issues/1092
