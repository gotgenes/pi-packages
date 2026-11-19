---
issue: 1133
issue_title: "pi-permission-system: split permission-manager-unified.test.ts by concern"
---

# Group the `PermissionManager` tests by concern in one file

## Release Recommendation

**Release:** ship independently

The roadmap tags this step `Release: independent`, and Phase 16 has no release batch.
Every commit is `test:` or `docs:`, both hidden changelog types, so the step cuts no release on its own.

## Problem Statement

`test/policy/permission-manager-unified.test.ts` is 4,174 lines and runs 232 tests (measured: `vitest list --json`).
It is not one tree.
It has a nested `describe` tree, then 50 top-level `test(...)` blocks under "moved from catch-all (#342)" banners, then a second tree.
Scope merge and precedence, session rules, surface and MCP resolution, path surfaces, and config sources are interleaved.
Session-rule tests sit in five places.
It also pays for a filesystem it does not need: 145 `try { … } finally { cleanup() }` blocks, most around managers whose config is only a permission map.

Phase 16's next steps land their tests here: [#1134] (the scope list), [#1108] (cross-scope order), [#1120] (a config deny against the session layer), and [#1122] (two more config scopes).
Each would add its cases to whichever of the scattered places already holds something similar.

The issue proposed one file per concern.
Planning settled on one file instead: every test here exercises one class, `PermissionManager` (`src/policy/permission-manager.ts`), so the concerns are behaviors of one unit, and the testing skill's rule is to nest by the unit, then by the scenario.
The concerns become `describe` blocks under one `describe("PermissionManager")`, in a file named after its module.

## Goals

- Rename the file to `test/policy/permission-manager.test.ts`, matching `src/policy/permission-manager.ts` the way `scope-merge.test.ts` matches `scope-merge.ts`.
- One root `describe("PermissionManager")`, holding one `describe` per concern: scope composition, yolo, session rules, surfaces, MCP, paths, and config sources.
- No flat top-level `test(...)` remains; the "Step 5 / Step 6" and "moved from catch-all" banners are gone.
- No `describe` is titled after a removed method (`checkPermission`, `checkPathPolicy`), and no title carries an issue number.
- A test whose manager takes only a permission map runs on `createInMemoryManager`, with no `try`/`finally`.
- A test is removed only when another test runs the same composed ruleset and the same call and asserts everything it asserts; each removal is named below.
- `permission-manager-fail-closed.test.ts` and `permission-manager-yolo.test.ts` fold into the same tree, because they test the same class.
- The suite passes and no file under `src/` changes.

The change is not breaking: it touches only tests and docs.

## Non-Goals

- Moving the 17 tests that write agent frontmatter onto the in-memory loader, even where the frontmatter is incidental (operator decision).
  They stay on the file harness.
- Unifying `createMissingConfigManager` with `createInMemoryManager()`, or reshaping `checkPath`'s positional parameters (68 call sites); both are recorded as deferred tidyings.
- Removing near-duplicates outside the criterion in Goals.
  For example, the two `external_directory` default-match tests use different inputs, and `extension tools use 'default' source` composes an explicit `"*": "ask"` rule its sibling does not.
- Migrating `createManagerWithConfig` callers in other files (`serving-policy.test.ts`, `bash-external-directory.test.ts`, `bash-effect-invariants.test.ts`).
- The fail-closed table test across every non-global scope; that is [#1134]'s ride-along.
- Editing the roadmap's phase-open discovery paragraph that describes the file (`architecture.md`, Phase 16 discovery), which is a dated snapshot, or the `history/` phase docs.
- The fallow health score sitting at 77.6 against the roadmap's 78 baseline (measured today); it predates this change, which does not move it (see Invariants at risk).

## Background

- `test/helpers/manager-harness.ts` builds managers two ways.
  The file harness (`createManager`, `createManagerWithConfig`, `createManagerWithProject`, `createManagerWithScopes`, `createAgentDirHarness`) writes real files and uses `FilePolicyLoader`.
  The in-memory harness (`createInMemoryPolicyLoader`, `createInMemoryManager`) hands the manager `ScopeConfig` objects directly.
- `FilePolicyLoader` runs a config file through `loadUnifiedConfig`, which validates it against the strict `unifiedConfigSchema`.
  A rejected global file loads as `{}`; a rejected project file is also marked `invalid`, which fails closed.
  Agent frontmatter goes through `parseSimpleYamlMap` and the tolerant `normalizeFlatPermissionValue`.
  The in-memory loader skips all of that.
- `configureForCwd` rebuilds the loader only when the manager was built with `agentDir`; otherwise it only clears the cache, so the in-memory harness behaves the same as the explicit-path file harness there.
- The file's three adapters, `checkTool`, `checkPathValues`, and `checkPath`, build an `AccessIntent` and call `check`.
  `checkPath` defaults to `path_read`, because a query below the resolver's family fold must name a directional surface (package skill).
  With one file, the adapters stay where they are.
- `ScopeConfig.permission` is `FlatPermissionConfig` (`#src/types`), a zod-inferred type.
- This issue's roadmap step in `docs/architecture/architecture.md` names the outcome this plan must meet: no flat top-level `test(` in `test/policy/`, and `try` blocks there falling from 152 to at most 80.
- AGENTS.md: run Vitest bare from the root with `pnpm --filter`; `pi-autoformat` reflows a file after every edit, so re-read a moved block before matching against it again.

## Design Overview

### How the evidence was produced

Three measurements, each from a disposable spike that has since been deleted:

1. A copy of the file in which every factory that takes only a permission map built an in-memory manager.
   That covered `createManagerWithConfig`, `createManagerWithScopes`, and `createManager`/`createManagerWithProject` called without agent files.
   All 232 tests passed (measured).
   Each conversion was logged with the test's name and the result of validating its config against the schema.
2. That log showed exactly one config the schema rejects: `non-string reason falls through to the default (malformed config)` (`Invalid config value at 'permission.bash'`).
   On disk the whole file is rejected and the result is the universal `ask`; in memory the normalizer drops one entry and the result is also `ask`.
   The test passes both ways for different reasons, so it stays on the file harness.
3. A type spike: inline permission literals passed to `createInMemoryManager` type-check, including computed keys and `{ action, reason }` objects.
   A separately declared `const config = { … }` does not (`TS2322`: `string` is not assignable to the permission union), so it needs a `FlatPermissionConfig` annotation.

### The tree

Each concern block lists where its tests come from today.
"Flat" means the top-level `test(...)` block; letters name today's top-level `describe`s.

```text
describe("PermissionManager")
├── scope composition
│   ├── universal fallback            ← "in-memory PolicyLoader > universal fallback" (3)
│   ├── precedence between scopes     ← "… > multi-scope merge" (5); flat "Project-level config overrides base bash patterns"
│   ├── rule origin                   ← "rule origin provenance" survivors (4); "… > origin tracking > universal fallback from project…"
│   ├── agent frontmatter             ← 11 flat tests that write agent files (file harness)
│   ├── an invalid non-global scope fails closed   ← permission-manager-fail-closed.test.ts (9)
│   ├── composed config rules         ← "… > getComposedConfigRules" (1)
│   └── policy issues                 ← flat getPolicyIssues (2); fail-closed file's "over a rejected config file" (2, file harness)
├── yolo
│   ├── rewrites asks                 ← permission-manager-yolo.test.ts "yolo rewrite" (7)
│   └── under a fail-closed scope     ← "fail-closed clamp under yolo" (2)
├── session rules
│   ├── over the default
│   ├── over a config rule            ← where #1120 lands
│   ├── surface isolation
│   └── attribution
├── surfaces
│   ├── source and matchedPattern     ← "source derivation and matchedPattern" minus its session and sugar tests; "extension tools use 'default' source…"
│   ├── built-in and extension tools  ← 4 flat tests
│   ├── bash                          ← 2 flat tests; "a bash command evaluated with its spellings"
│   ├── skill                         ← flat "Skill permission matching"
│   ├── deny reasons                  ← the 4 deny-with-reason tests of "cross-cutting path surface"
│   ├── tool exposure                 ← "… > getToolPermission" (3), "… > isToolFullyDenied" (6), 2 flat getToolPermission tests
│   └── a tool intent                 ← "check — tool intent" (4)
├── mcp
│   ├── target resolution             ← 6 flat MCP tests (3 on the file harness)
│   ├── last-match-wins across candidates
│   ├── Pi MCP tools                  ← the three mcp__ describes, kept as sub-describes
│   └── a forwarded request
├── paths
│   ├── injected path flavor          ← "PermissionManager — injected platform (#510)" (4)
│   ├── directional sugar             ← the 2 sugar tests from "source derivation…"
│   ├── per-tool path patterns        ← "per-tool path patterns" minus its session test
│   ├── path surface                  ← "cross-cutting path surface" minus deny reasons and its session test
│   ├── home expansion                ← "in path values" (6) and "in external_directory rules" (4)
│   ├── external_directory config     ← 3 flat tests
│   ├── cwd-aware path values         ← (4)
│   └── a path-values intent          ← "check — path-values intent" (5) and the rewritten sixth checkPathPolicy test
└── config sources
    ├── agentDir and configureForCwd  ← "configureForCwd and agentDir option" (7)
    ├── MCP server names              ← its mcp.json sub-describe (2); flat "MCP server names in settings.json…"
    ├── PI_CODING_AGENT_DIR           ← flat (1)
    └── resolved policy paths         ← flat getResolvedPolicyPaths (2)
```

The session-rules block collects every test whose subject is the session layer, from all five places:

- **over the default:** the eight tests of today's `checkPermission — session rules`, plus the flat bash-wildcard, bash-exact, and MCP-target tests.
- **over a config rule:** the in-memory `session rule wins over config`, the six flat tests that put session rules beside a config rule (external_directory cover, no cover, config deny, bash no-match, empty session rules), `session rule for specific path overrides config deny` from per-tool path patterns, and `session approval on path surface overrides config deny` from the path surface.
- **surface isolation:** the in-memory `session rule does not bleed across surfaces` and the two flat bleed tests.
- **attribution:** `matchedPattern … (bash)` and `session rule: origin is 'session'`.

Tests whose subject is a surface's own matching stay with that surface, even though they pass session rules: MCP's `session grants`, the bash spellings' `matches a session grant…`, and `applies session rules via the path-values intent`.

A file-level `describe("PermissionManager")` matches the sibling convention (`describe("PermissionResolver")`, `describe("SessionRules")`, `describe("mergeScopesWithOrigins")`).

### Factory conversion

| Today                                                                     | After                                                                              |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `createManagerWithConfig(p, servers)`                                     | `createInMemoryManager({ global: { permission: p } }, servers)`                    |
| `createManagerWithScopes(g, p)`                                           | `createInMemoryManager({ global: { permission: g }, project: { permission: p } })` |
| `createManager(config)`, no agent files                                   | `createInMemoryManager({ global: config }, servers)`                               |
| `createManagerWithProject(config, {}, { projectConfig })`, no agent files | `createInMemoryManager({ global: config, project: projectConfig })`                |

The `try { … } finally { cleanup(); }` around each converted manager goes away.
Four describe-scoped helpers (`resolveWith`, the two `withManager`s, `serve`) exist only to own `cleanup`; each shrinks to building the manager and returning the call.
Their `permission: Record<string, unknown>` parameters, the forwarded-request `config` constant, and the `it.each` rows that spread into an `mcp` map become `FlatPermissionConfig` (from `#src/types`), because the in-memory loader's type is checked where the file harness's `Record<string, unknown>` was not.

Kept on the file harness (measured routing from the spike):

- every test that writes agent frontmatter (17, one of which is removed as a duplicate);
- every `createAgentDirHarness` test;
- `MCP server names in settings.json are not used`, `PI_CODING_AGENT_DIR`, and both `getResolvedPolicyPaths` tests;
- the malformed-reason test;
- the folded fail-closed file's two rejected-config-file tests.

`createManagerWithScopes` loses its last caller (all 9 are in this file, measured by grep) and is deleted in the same commit, since fallow's `unused-exports` rule is an error.

### Removed as duplicates

Each row names the test that already asserts everything the removed one does, over the same composed ruleset and call.
`{ permission: {} }` and an absent config compose the same empty ruleset.

| Removed                                                                                   | Kept                                                                                                          |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| origin: `project overrides global: winning rule has origin 'project'`                     | in-memory `project overrides global`                                                                          |
| origin: `both-object merge: patterns retain their own origins`                            | in-memory `deep-shallow merge preserves patterns from different scopes`                                       |
| origin: `string replaces object: all patterns from replacing scope get origin 'project'`  | in-memory `string replaces object in override scope`                                                          |
| origin: `universal fallback (*) set in global config carries origin 'global'`             | in-memory `respects permission['*'] = 'allow' from global config`                                             |
| origin: `universal fallback (*) overridden by project carries origin 'project'`           | in-memory `universal fallback from project carries origin 'project'`                                          |
| origin: `no config match: origin is 'builtin' (default layer)`                            | in-memory `defaults to ask when no config is provided`                                                        |
| origin: `built-in fallback (no * in any config): origin is 'builtin'`                     | in-memory `defaults to ask when no config is provided`                                                        |
| in-memory `session origin is 'session'`                                                   | origin: `session rule: origin is 'session'`                                                                   |
| in-memory `bash surface routes correctly`                                                 | `source is 'bash' and command is included in result`                                                          |
| in-memory `skill surface routes correctly`                                                | `source is 'skill' for a config-matched skill name`                                                           |
| in-memory `mcp surface routes correctly`                                                  | `source is 'mcp' for a config-matched target`                                                                 |
| in-memory `external_directory surface routes correctly`                                   | `source is 'special' for a config-matched path`                                                               |
| in-memory `tool surface routes correctly for built-in tools`                              | flat `PermissionManager canonical built-in permission checking`                                               |
| `matchedPattern is the session rule pattern for a session match (skill)`                  | `session rule wins over the universal default (skill)`                                                        |
| flat `checkPermission returns source 'session' for skill when session rules match`        | `session rule wins over the universal default (skill)`                                                        |
| flat `checkPermission returns source 'session' for tool surface when session rules match` | `session rule wins over the universal default (tool — read)`                                                  |
| `checkPathPolicy > evaluates precomputed policy values against the path surface`          | `check — path-values intent >` same title                                                                     |
| `checkPathPolicy > preserves last-match-wins across the provided aliases`                 | `… > last-match-wins across the provided aliases`                                                             |
| `checkPathPolicy > applies session rules over config`                                     | `… > applies session rules via the path-values intent`                                                        |
| `checkPathPolicy > falls back to the catch-all for an empty value list`                   | `… >` same title                                                                                              |
| `checkPathPolicy > evaluates against the external_directory surface when one is provided` | `… > evaluates against the external_directory surface`                                                        |
| flat `external_directory permission is not affected by unrelated surface keys`            | flat `external_directory permission can be explicitly allowed` (same config; the "unrelated keys" are absent) |
| flat `Project-agent config overrides system-agent tool rules`                             | in-memory `project-agent overrides agent`; the issue names this one                                           |

That is 23 whole tests: 232 → 209.
The last row is not exact by the criterion (its global scope differs); the issue asks for it, and frontmatter parsing at both agent directories stays pinned by `Full precedence chain…` and `Project-agent applies even without a matching system-agent file`.
One partial removal: the flat `getToolPermission returns tool-level policy for canonical and extension tools` builds a second manager (`"*": "deny", bash: "allow"`) inside a nested `try`; that block repeats the in-memory `returns tool-level state for bash surface` and is cut, leaving the test's agent-frontmatter assertions.

The sixth `checkPathPolicy` test, `defaults to the path surface when no surface is provided`, mostly pins the adapter's default parameter, but it also asserts a real property.
It is rewritten as `does not apply an external_directory rule on the path surface`, calling `check` with an explicit `path_read` intent, and kept under `a path-values intent`.

### Retitles

Seven `describe`s are titled `checkPermission …`/`checkPathPolicy`: today's lines 197, 312, 584, 669, 1175, 3281, and 3346.
Each is renamed to the concern title in the tree, or dissolved into it.
Leaf titles change only where they name a removed method, repeat the root, or carry an issue number:

| Old leaf title                                                                           | New leaf title                                                  |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `PermissionManager canonical built-in permission checking`                               | `resolves a canonical built-in tool on its tool surface`        |
| `PermissionManager reads config from PI_CODING_AGENT_DIR when set`                       | `reads config from PI_CODING_AGENT_DIR when set`                |
| `PermissionManager.getPolicyIssues returns empty array for clean config`                 | `is empty for a clean config`                                   |
| `PermissionManager.getPolicyIssues returns empty array for empty config`                 | `is empty for an empty config`                                  |
| `checkPermission returns source 'session' …` (4 surviving)                               | the same title without `checkPermission`                        |
| `checkPermission falls back to config …` (2)                                             | the same title without `checkPermission`                        |
| `checkPermission with empty session rules is identical to call without sessionRules arg` | `treats an empty session ruleset like none`                     |
| `… (regression: #428)` (2), `… (#58)`, `… (#533)`, `… (#653)`                            | the same title without the parenthetical                        |
| `defaults to the path surface when no surface is provided`                               | `does not apply an external_directory rule on the path surface` |

The folded files' describe titles drop their `PermissionManager` prefix and `(#646)`; their explanatory header comments move onto their `describe` without the issue numbers.

### Folding the two sibling files

`permission-manager-fail-closed.test.ts`'s `makeManager(scopes)` constructs `new PermissionManager({ policyLoader: createInMemoryPolicyLoader(scopes) })`, which is exactly `createInMemoryManager(scopes)`; its calls switch to the harness factory and the local function goes away.
Its `bashCheck` constant becomes describe-scoped.
`permission-manager-yolo.test.ts`'s `makeManager(global, isYoloEnabled, project?)` passes `isYoloEnabled`, which `createInMemoryManager` cannot, so it moves inside the `yolo` block as a describe-scoped `makeYoloManager`.
`createInMemoryPolicyLoader` joins the merged file's harness import.

### Title census

The verification instrument for every move step lists the file's leaf titles (dry-run at planning time: 232 entries, 230 distinct, because two titles appear twice):

```bash
pnpm --filter @gotgenes/pi-permission-system exec vitest list test/policy/permission-manager.test.ts --json 2>/dev/null \
  | python3 -c 'import json,sys; [print(n["name"].split(" > ")[-1]) for n in json.load(sys.stdin)]' \
  | sort > /tmp/1133-leaves-<step>.txt
```

A move step's `diff` against the previous step's census shows only the retitles that step names; every other leaf is unchanged.
The census is a review aid, not a gate, so the pipe's exit status is not load-bearing.

## Module-Level Changes

- `test/policy/permission-manager-unified.test.ts` → `test/policy/permission-manager.test.ts`: renamed and restructured as above.
  Predicted size about 3,700 lines including the folded files (estimated: about 450 lines saved by removing `try`/`finally`, about 250 by removing duplicates, and about 290 added by the folded files).
- `test/policy/permission-manager-fail-closed.test.ts`: deleted after its tests fold in.
- `test/policy/permission-manager-yolo.test.ts`: deleted after its tests fold in.
- `test/helpers/manager-harness.ts`: `createManagerWithScopes` removed.
- `.pi/skills/package-pi-permission-system/SKILL.md`:
  - the `manager-harness.ts` bullet drops `createManagerWithScopes`;
  - its "extracted from `permission-manager-unified.test.ts` in #525" sentence drops that provenance;
  - its "pass the loader directly when overriding `platform`" becomes `flavor`, the option's real name;
  - the `checkPath` sentence names `permission-manager.test.ts`;
  - one sentence says where a new `PermissionManager` test goes: under its concern's `describe` in that file, on `createInMemoryManager` when its config is only a permission map.
- `docs/architecture/architecture.md`, this issue's roadmap step:
  - `✅` on the heading and the Mermaid node `S1133`, and both retitled from "Split the unified manager test" to "Group the manager test by concern";
  - `Target:` and `Constraint:` rewritten for one file and one commit per concern block;
  - a `Landed:` note naming the commits.

Predicted unchanged, with the claim each rests on:

- Everything under `src/`: the issue's acceptance check, and nothing here needs it.
- Every other importer of `manager-harness.ts`: only `createManagerWithScopes` is removed, and its 9 callers are all in this file (measured by grep).
- `test/policy/serving-policy.test.ts`: its 5 `try` blocks stay, and the prediction below counts them.
- The roadmap's health-metrics table: its dated baseline column is a phase-open snapshot.
- The roadmap's discovery paragraph and the `history/` docs: dated records.

## Test Impact Analysis

1. **New tests enabled:** none; this is a reorganization.
2. **Redundant tests removed:** the 23 in "Removed as duplicates", plus one partial block.
3. **Tests that must stay as they are:** the file-harness tests listed under "Factory conversion".
   They are the only tests left in this file that drive `FilePolicyLoader`: global and project file reads, agent and project-agent frontmatter, schema rejection, `agentDir` path derivation, and `mcp.json` discovery.

Predicted metric values after the last step:

- `grep -rhE '^test\(' packages/pi-permission-system/test/policy | wc -l`: 50 → 0.
- `grep -rhE '^\s+try \{' packages/pi-permission-system/test/policy | wc -l`: 152 → about 36 (estimated from the spike's per-test routing: 29 in the restructured unified tests, 2 from the folded fail-closed file, 5 in `serving-policy.test.ts`); the target is ≤ 80.
- Tests: 252 across the three files → 229 in one file (232 + 11 + 9 − 23, each count measured with `vitest list`).

## Invariants at risk

- **File-loader coverage survives the in-memory conversion.**
  This serves [#1134], which rewrites `FilePolicyLoader`'s scope methods, and [#1122], which adds file scopes.
  Pinned by the kept file-harness tests above; step 2's second mutation proves that a project-file read is still exercised.
- **The fail-closed floor** (package skill: a rejected non-global scope floors `allow` → `ask`, the global scope is excluded, `deny` survives, yolo re-permits).
  It serves [#1134]'s table test.
  Pinned by the folded fail-closed block and yolo's "under a fail-closed scope".
  The factory swap is identical construction (read in `manager-harness.ts`: `createInMemoryManager(scopes)` = `new PermissionManager({ policyLoader: createInMemoryPolicyLoader(scopes, []) })`).
  Step 5 names a mutation.
- **Same behaviors asserted** (the issue's acceptance check).
  Pinned by the title census at each move step and the duplicate table at step 3.
- **Shared fixtures come from the harness** (Phase 8 step 1, [#525]).
  Preserved: the one local factory that remains, `makeYoloManager`, exists because the harness does not inject `isYoloEnabled`.
- **Health score.**
  A root `describe` makes the file one large unit.
  Spiked at planning time (the file wrapped in a root `describe`, then restored): fallow reported a new 4,138-line `large_functions` entry, and the score stayed 77.6 with the `unit_size` penalty at 10.0 before and after (measured).

## TDD Order

No step adds a test, so no step has a red; each step is a structural change verified by the full file staying green, a test count, and the title census.
Where a step changes how a test builds its manager, a killing mutation shows the converted tests still read what they claim to.
Run `pnpm --filter @gotgenes/pi-permission-system exec vitest run test/policy/permission-manager.test.ts && pnpm --filter @gotgenes/pi-permission-system run check` after every step.
Review each move with `git diff --color-moved=dimmed-zebra --color-moved-ws=allow-indentation-change`.

1. Commit `test(pi-permission-system): name the manager test file after its module`.
   `git mv test/policy/permission-manager-unified.test.ts test/policy/permission-manager.test.ts`.
   Hoist the mid-file `import type { PermissionCheckResult, PermissionState, ScopeConfig }` into the top import block, and replace the stale "Step 5 / Step 6" header comment with a one-line description of the file.
   Capture the baseline census as `/tmp/1133-leaves-0.txt` (232 lines).
   Verify: 232 tests, census unchanged.
2. Commit `test(pi-permission-system): run permission-map-only manager tests in memory`.
   Apply the factory-conversion table everywhere it applies, drop each converted `try`/`finally`, shrink the four cleanup-owning helpers, and type their inputs as `FlatPermissionConfig`.
   Leave the malformed-reason test and every file-harness test from the list on disk.
   Delete `createManagerWithScopes` from `manager-harness.ts`.
   Verify: 232 tests, census unchanged, `try` count in the file about 31 (estimated), and `pnpm fallow dead-code` clean.
   Killing mutations, each applied to `src`/helper code and reverted after:
   - Make `createInMemoryPolicyLoader`'s `loadGlobalConfig` return `{}`.
     The converted tests that assert a config rule go red (dozens); a green run means the conversion did not take.
   - Make `FilePolicyLoader.loadProjectConfig` return `{}`.
     `configureForCwd(cwd) applies project config` and `System-agent config overrides project-level bash patterns` go red, proving the file harness still reads a project file.
3. Commit `test(pi-permission-system): drop manager tests another test already asserts`.
   Remove the 23 tests in the duplicate table and the nested second manager of the flat `getToolPermission` test.
   Rewrite `defaults to the path surface when no surface is provided` as `does not apply an external_directory rule on the path surface`, with an explicit `path_read` intent through `check`.
   Re-check the imports and the three adapters for orphans; `checkPathValues` keeps its caller, `checkPath`.
   Verify: 209 tests; the census diff against step 2 shows exactly the 23 removed leaves (two of them share a title with a kept test, so they show as a count drop) and the one retitle.
   Killing mutation for the rewritten test: make `check` evaluate a `path-values` intent on `external_directory_read` whatever its surface; the rewritten test goes red.
4. Commit `test(pi-permission-system): group the manager's scope-composition tests`.
   Open `describe("PermissionManager", …)` at the end of the file and create `scope composition` inside it with the sub-blocks in the tree, moving their tests in.
   This step moves 14 flat tests (the 46 surviving flat tests split 14 / 10 / 9 / 6 / 3 / 4 across scopes, session rules, surfaces, MCP, paths, and config sources); apply their retitles.
   Verify: 209 tests; census diff shows only this block's retitles.
5. Commit `test(pi-permission-system): fold the fail-closed tests into the manager tree`.
   Move both describes of `permission-manager-fail-closed.test.ts` into `scope composition` (`an invalid non-global scope fails closed`; `policy issues > over a rejected config file`), switch `makeManager` to `createInMemoryManager`, scope `bashCheck` to its block, and delete the file.
   Verify: 220 tests in the file, 11 leaves added and none changed.
   Killing mutation: make `resolvePermissions` report no fail-closed scopes; the block's flooring tests go red.
6. Commit `test(pi-permission-system): fold the yolo tests into the manager tree`.
   Move both describes of `permission-manager-yolo.test.ts` into `yolo`, with `makeYoloManager` describe-scoped, and delete the file.
   Verify: 229 tests; 9 leaves added.
   Killing mutation: make the manager ignore `isYoloEnabled`; the three tests asserting `origin: "yolo"` go red.
7. Commit `test(pi-permission-system): group the manager's session-rule tests`.
   Gather the 24 session-layer tests into `session rules` and its four sub-blocks, from all five places.
   Verify: 229 tests; census diff shows only the session retitles.
8. Commit `test(pi-permission-system): group the manager's surface tests`.
   Verify: 229 tests; census diff shows only `resolves a canonical built-in tool on its tool surface`.
9. Commit `test(pi-permission-system): group the manager's MCP tests`.
   Collapse the two now-identical `withManager` helpers into one block-level helper.
   Verify: 229 tests; census unchanged.
10. Commit `test(pi-permission-system): group the manager's path tests`.
    Verify: 229 tests; census diff shows only the `(#58)`, `(#533)`, and `(#653)` drops.
11. Commit `test(pi-permission-system): group the manager's config-source tests`.
    After this step nothing sits outside the root `describe` but imports, the three adapters, and no banner comment remains.
    Verify: 229 tests; census diff shows only this block's retitles; `grep -cE '^test\(' test/policy/permission-manager.test.ts` prints 0; the roadmap's `try` count prints about 36.
12. Commit `docs(pi-permission-system): record the manager test layout`.
    Make the SKILL.md and `architecture.md` edits from Module-Level Changes, writing `Landed:` from `git log --oneline` of steps 1–11.
    Verify: `pnpm exec rumdl check` on both files.

Steps 4–11 each leave the file green on their own; the order among 7–11 is free.

## Risks and Mitigations

- **A move silently drops or alters a test.**
  The census diff per step catches a missing leaf; the test count catches a lost `it.each` row.
- **A conversion changes which mechanism a test pins.**
  The spike found one such test, kept on disk; step 2's first mutation catches a conversion that leaves a test reading nothing.
- **Type errors from the in-memory loader's stricter type** (measured: `TS2322` on a separately declared config).
  Annotate with `FlatPermissionConfig`; `pnpm run check` runs at every step.
- **`pi-autoformat` reflows a moved block**, so the next `Edit`'s `oldText` misses.
  Re-read each moved region before editing it again.
- **Large diffs are hard to review.**
  Steps 2 and 3 run in place before any move, so steps 4–11 are relocations that `--color-moved` can verify.
  Step 2 may be split by section if it grows unwieldy.
- **Dead helper or import left behind.**
  `pnpm fallow dead-code` after step 2; Biome's `noUnusedImports` is warning-level, so re-read the import block after steps 3, 5, 6, and 11.

## Open Questions

None.

[#525]: https://github.com/gotgenes/pi-packages/issues/525
[#1108]: https://github.com/gotgenes/pi-packages/issues/1108
[#1120]: https://github.com/gotgenes/pi-packages/issues/1120
[#1122]: https://github.com/gotgenes/pi-packages/issues/1122
[#1134]: https://github.com/gotgenes/pi-packages/issues/1134
