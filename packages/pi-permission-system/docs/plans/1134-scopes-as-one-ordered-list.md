---
issue: 1134
issue_title: "pi-permission-system: deliver the config scopes as one ordered list instead of four positional loaders"
---

# The config scopes are one ordered list

## Release Recommendation

**Release:** ship independently

The roadmap step carries `Release: independent` and no batch.
It was planned as a `refactor:` with no release, but the operator chose at the planning gate to have the `config.resolved` log entry report the scopes as a list, so the final step is a `feat!:` and this issue cuts its own major release.

## Problem Statement

ADR 0016 decides everything about a policy source per channel (its slot, trust gate, strictness, attribution), and the code has no object to hang that on.
The four config scopes are spelled out, in order, at every site that needs them: four positional `PolicyLoader` methods, a four-entry tuple plus three separate `invalid` checks in `PermissionManager.resolvePermissions`, four hand-joined file stamps in `FilePolicyLoader.getCacheStamp`, eight fields on `ResolvedPolicyPaths`, and a test fake that grows a method per scope.
Three ADR 0016 issues change that list ([#1108] reorders it, [#1122] adds two entries, [#1127] changes how one kind is validated), and each would otherwise edit every one of those sites.
The `project-agent` branch of the fail-closed floor also has no manager-level test.

## Goals

- `PolicyLoader` returns the scopes for an agent as one list in precedence order (`loadScopes`), each entry carrying its origin, its `ScopeConfig`, and whether an invalid file there floors the composed policy.
- `resolvePermissions` iterates that list for the merge and for the fail-closed floor, naming no scope.
- `getCacheStamp` and `getResolvedPolicyPaths` are derived from the same ordered source list inside `FilePolicyLoader`.
- The in-memory test fake is built from a list of scope entries (operator decision: list input, not a keyed fixture).
- A manager-level table test over real files covers the floor for every non-global scope, `project-agent` included, and pins that global does not floor.
- **Breaking (operator decision):** the `config.resolved` review/debug log entry replaces its eight flat path fields with `scopes: [{ scope, path, exists }, …]`, listed lowest to highest precedence.
  Shipped as `feat(pi-permission-system)!:` with a `BREAKING CHANGE:` footer.
- The roadmap ride-along: the explicit-path `PermissionManager` constructor mode only tests use moves into the test harness.
- The architecture doc's authority model gains the subsection naming a channel as the unit recorded authority is composed from, with ADR 0016's slots as the resolved direction.

## Non-Goals

- Changing scope order, or composing per-scope rulesets instead of merging raw objects: that is [#1108], which deletes `mergeScopesWithOrigins` (its signature is untouched here).
- Adding the `config.local.json` scopes ([#1122]); this change makes each an entry in one list plus a `ScopeOrigin` literal.
- Strict validation of agent frontmatter ([#1127]); the agent-file source keeps `normalizeFlatPermissionValue`.
- Sharing one parse between `ConfigStore` and `FilePolicyLoader` ([#1028]).
- Folding `getConfiguredMcpServerNames` into the scope-source abstraction: MCP server names are not a policy scope and keep their own two-path cache.
- An explicit `slot`/index field in the log entry: array position is the precedence, and ADR slot labels (`1.5`) would shift as [#1122] inserts entries.
- Per-agent file paths in the log entry: `config.resolved` is written at `session_start`, before any agent is known, so the two agent scopes keep reporting their directory.

## Background

- `src/config/policy-loader.ts` — `PolicyLoader` (seven methods, four of them scope loaders), `FilePolicyLoader` (mtime-cached reads; `loadGlobalConfig` and `loadProjectConfig` are near-identical config-file reads except that only project sets `invalid`; `loadScopeConfigFrom(dir, cache, agentName)` is already the agent-file source, called with two `(dir, cache)` pairs), `ResolvedPolicyPaths` (eight flat fields), `PolicyLoaderOptions`.
- `src/policy/permission-manager.ts` — `PermissionManagerOptions extends PolicyLoaderOptions`; the constructor uses explicit loader paths when no `agentDir` is given, a mode only tests use (production `index.ts` passes `agentDir`, `flavor`, `isYoloEnabled`).
  `resolvePermissions` (lines 192–262) loads the four scopes, builds the tuple, and runs three `invalid` checks; `failClosedScopes` drives the floor and the `getPolicyIssues` notice text (`Invalid project, agent configuration detected …`).
- `src/policy/rule.ts` — `RuleOrigin` names the four scope origins among nine literals.
- `src/config/config-reporter.ts` — `buildResolvedConfigLogEntry` spreads `ResolvedPolicyPaths` into `ResolvedConfigLogEntry`; `ConfigStore.logResolvedPaths` writes it as `config.resolved` to both logs; `docs/troubleshooting.md` documents the eight fields.
- `test/helpers/manager-harness.ts` — `createInMemoryPolicyLoader` takes `{ global, project, agent: {name: cfg}, projectAgent: {…} }`; 141 call sites across 6 test files (measured), about 121 of them `global`-only (the Tidy-First assessor's scripted count; 19 sites pass a non-global key, measured).
- `fallow guard src/config/policy-loader.ts` (run at planning): the `config` zone may import `policy`, so `policy-loader.ts` importing `ScopeOrigin` from `#src/policy/rule` is allowed; `rule.ts` imports nothing from `config/`, so no cycle.
- AGENTS.md: pnpm only; package skill: the manager stays string-based (ADR 0002 lint guard), tests go under their concern's `describe` in `permission-manager.test.ts`.

## Design Overview

### Types

```typescript
// src/policy/rule.ts
export type ScopeOrigin = "global" | "project" | "agent" | "project-agent";
export type RuleOrigin =
  | ScopeOrigin
  | "builtin" | "baseline" | "session" | "yolo" | "fail-closed";

// src/config/policy-loader.ts
/** One config scope's contribution, in precedence order (lowest first). */
export interface PolicyScope {
  readonly origin: ScopeOrigin;
  readonly config: ScopeConfig;
  /** Whether an invalid file at this scope floors the composed policy allow→ask. */
  readonly floorsWhenInvalid: boolean;
}

/** Where one scope is read from (final step). */
export interface ResolvedScopePath {
  readonly scope: ScopeOrigin;
  readonly path: string | null;
  readonly exists: boolean;
}
export type ResolvedPolicyPaths = readonly ResolvedScopePath[];

export interface PolicyLoader {
  loadScopes(agentName?: string): readonly PolicyScope[];
  getConfiguredMcpServerNames(): readonly string[];
  getCacheStamp(agentName?: string): string;
  getResolvedPolicyPaths(): ResolvedPolicyPaths;
}
```

`ScopeConfig` is unchanged; `invalid` stays a fact about the file, and `floorsWhenInvalid` is the policy about what that fact does.

### Inside `FilePolicyLoader`

One ordered private array of scope sources, built in the constructor, of two private kinds:

- `ConfigFileScopeSource(origin, path | null, floorsWhenInvalid)` — today's `loadGlobalConfig`/`loadProjectConfig` body: a null path loads `{}` and stamps `"none"`; a rejected file (issues from `loadUnifiedConfig`) is marked `invalid`.
  The global source now marks `invalid` too (today `loadGlobalConfig` never sets it); `floorsWhenInvalid: false` keeps that unobservable, and nothing else reads global `invalid` (verified: `resolvePermissions` is the only `src/` reader of `.invalid`).
- `AgentFileScopeSource(origin, dir | null, floorsWhenInvalid)` — today's `loadScopeConfigFrom` with its per-agent `Map` cache.

Each answers `load(agentName)`, `stamp(agentName)`, `resolvedPath()`.
The source caches the `ScopeConfig` itself, so the mtime-cache identity test keeps asserting the same reference across calls (on `.config`).

```typescript
loadScopes(agentName?: string): readonly PolicyScope[] {
  return this.sources.map((source) => source.scopeFor(agentName));
}
getCacheStamp(agentName?: string): string {
  return this.sources.map((source) => source.stamp(agentName)).join("|");
}
getResolvedPolicyPaths(): ResolvedPolicyPaths {
  return this.sources.map((source) => source.resolvedPath());
}
```

The stamp string's format is not pinned by any test (assessor-verified; only "is a string", "changes on global mtime", and "differs with an agent file" are asserted), so its exact spelling is free to change.

### `resolvePermissions`

```typescript
const scopes = this.loader.loadScopes(agentName);
const { mergedPermission, origins } = mergeScopesWithOrigins(
  scopes.map((scope) => [scope.origin, scope.config] as const),
);
// …
const failClosedScopes = scopes
  .filter((scope) => scope.floorsWhenInvalid && scope.config.invalid === true)
  .map((scope) => scope.origin);
```

List order preserves the notice's scope order (`project, agent, project-agent`).
`ResolvedPermissions.failClosedScopes` narrows to `ScopeOrigin[]`.

### `config.resolved` (final, breaking step)

```jsonc
{
  "event": "config.resolved",
  "scopes": [
    { "scope": "global", "path": "/…/.pi/agent/extensions/pi-permission-system/config.json", "exists": true },
    { "scope": "project", "path": "/…/my-project/.pi/extensions/pi-permission-system/config.json", "exists": false },
    { "scope": "agent", "path": "/…/.pi/agent/agents", "exists": true },
    { "scope": "project-agent", "path": "/…/my-project/.pi/agents", "exists": false }
  ],
  "legacyGlobalPolicyDetected": false,
  "legacyProjectPolicyDetected": false,
  "legacyExtensionConfigDetected": false
}
```

The array order is the documented contract: lowest to highest precedence, so `.scopes[-1]` is the highest-precedence scope and a decision's `origin` locates its position.
The two agent scopes report their directory (no agent is known at `session_start`).

### Explicit-path constructor mode (ride-along)

`PermissionManagerOptions` becomes `{ policyLoader?, agentDir?, flavor?, isYoloEnabled? }`.
The constructor keeps `policyLoader ?? new FilePolicyLoader(agentDir !== undefined ? derivePolicyLoaderOptions(agentDir, undefined) : {})`, so the no-argument `new PermissionManager()` (the `PI_CODING_AGENT_DIR` test, reading `FilePolicyLoader`'s `getAgentDir()` defaults) behaves as before.
Tests that built a manager over explicit paths go through a harness helper, `createManagerFromPaths(paths: PolicyLoaderOptions, options: { flavor?: PathFlavor; isYoloEnabled?: () => boolean } = {})`, which passes `policyLoader: new FilePolicyLoader(paths)`.

### Test fake

```typescript
// test/helpers/manager-harness.ts
export type InMemoryScope = PolicyScope & { readonly agentName?: string };

export function createInMemoryPolicyLoader(
  scopes: readonly InMemoryScope[] = [],
  mcpServerNames: readonly string[] = [],
): PolicyLoader {
  return {
    loadScopes: (agentName) =>
      scopes
        .filter((s) => s.agentName === undefined || s.agentName === agentName)
        .map(({ agentName: _, ...scope }) => scope),
    // …
  };
}

/** The common case: one global scope holding a permission map. */
export function createInMemoryGlobalManager(
  config: ScopeConfig,
  mcpServerNames: readonly string[] = [],
): PermissionManager;
```

A fixture's list order is the precedence the manager sees, and its `floorsWhenInvalid` is stated literally, so the in-memory tests pin the manager's mechanism (iterate in given order, floor by flag) and the file-backed tests pin production's order and flags.
The fake's `getResolvedPolicyPaths` returns a fixed one-entry global list.

### Edge cases (each tested)

- An absent file is a plain empty scope, not invalid (existing loader tests, kept through step 4's migration).
- An agent scope with no agent name, or a null project path/dir, loads `{}` (existing loader tests).
- Global invalid does not floor; each non-global invalid floors and is named in the notice (step 5).
- Two invalid scopes are named in list order (step 5).
- A change to any one source's file changes the cache stamp (step 6).
- `loadScopes` returns the four origins in precedence order with floors `[false, true, true, true]` (step 7).
- The manager floors by `floorsWhenInvalid`, not by origin (step 8).

## Module-Level Changes

- `src/policy/rule.ts` — add `ScopeOrigin`; compose `RuleOrigin` from it (step 7).
- `src/config/policy-loader.ts` — two private source classes and the ordered `sources` array (step 6); `PolicyScope`, `loadScopes`, the four `load*Config` methods and `loadScopeConfigFrom` removed (step 7); `ResolvedScopePath`, list-shaped `ResolvedPolicyPaths`, `getResolvedPolicyPaths` mapped over sources, its stale "`/permission-system show`" docblock rewritten (step 9).
- `src/policy/permission-manager.ts` — `PermissionManagerOptions` stops extending `PolicyLoaderOptions`, `configureForCwd` docblock no longer mentions "test managers built with explicit paths" (step 2); `resolvePermissions` iterates `loadScopes` (step 7).
  The re-export of `PolicyLoader`/`ResolvedPolicyPaths` at the file's end stays.
- `src/config/config-reporter.ts` — `ResolvedConfigLogEntry` carries `scopes: ResolvedPolicyPaths` plus the three legacy flags; imports `ResolvedPolicyPaths` from `./policy-loader` instead of via `permission-manager.ts` (step 9).
- `src/config/config-store.ts` — predicted unchanged: `logResolvedPaths` passes the provider's value through to `buildResolvedConfigLogEntry` without reading its fields.
- `src/policy/scope-merge.ts` — predicted unchanged: the manager adapts the list to its tuple input; [#1108] deletes it.
- `src/index.ts` — predicted unchanged: it passes `agentDir`, `flavor`, `isYoloEnabled`, none of which move.
- `test/helpers/manager-harness.ts` — `createManagerFromPaths` (step 1); `createManager`, `createManagerWithProject`, `createMissingConfigManager` build through it (step 1); `createInMemoryGlobalManager` (step 3); `createInMemoryPolicyLoader` implements `loadScopes` (step 7, transitionally from the keyed input) and takes `InMemoryScope[]` (step 8); list-shaped `getResolvedPolicyPaths` (step 9).
- `test/policy/permission-manager.test.ts` — explicit-path sites (2812, 2829, 2855, 2885, 3625, 3837, 3908, 3936) to `createManagerFromPaths`, the four `flavor` sites gaining `mcpServerNames: []` (step 1); `global`-only in-memory sites to `createInMemoryGlobalManager` (step 3); file-backed fail-closed table under `scope composition > an invalid non-global scope fails closed` (step 5); remaining ~18 keyed sites and `makeYoloManager` to list fixtures, the global-invalid in-memory test reworded to the flag (step 8); `resolved policy paths` tests (3889–3955) and 3719 to the list shape (step 9).
- `test/handlers/gates/bash-chain-session-approval.test.ts`, `test/handlers/gates/bash-command.test.ts`, `test/policy/serving-policy.test.ts`, `test/service/bash-advisory-check.test.ts` — their in-memory sites move with step 3 (global-only) or step 8 (list).
- `test/config/policy-loader.test.ts` — onto `createTmpFixture` with an extended `makeLoader` and a `scopeConfig(loader, origin, agentName?)` accessor (step 4); stamp-per-source table (step 6); `loadScopes` order/floor/global-invalid tests, accessor body becomes a `find` (step 7); resolved-paths test (236–260) to the list (step 9).
- `test/config/config-reporter.test.ts` — `new PermissionManager({ globalConfigPath, agentsDir })` at line 106 to `createManagerFromPaths` (step 1); three unit tests and the log round-trip to `scopes` (step 9).
- `test/config/config-store.test.ts` — `makePolicyPathProvider`'s `ResolvedPolicyPaths` literal to the list (step 9).
- `test/composition-root.test.ts` — predicted unchanged: it never names `config.resolved` or a path field (assessor-verified).
- `docs/troubleshooting.md` — the `config.resolved` sample and its sentence ("listed lowest to highest precedence") (step 9).
- `docs/architecture/architecture.md` (step 10):
  - new `### Recorded authority is composed from channels` subsection under `## The authority model`, after `### Authority lives in three places`;
  - `### Fail-closed on an invalid non-global scope` prose and snippet (the floor reads each entry's `floorsWhenInvalid`);
  - module-tree entries for `policy-loader.ts`, `permission-manager.ts`, `config-reporter.ts`;
  - roadmap: `#### ✅ [#1134]` heading, the Mermaid node `S1134["✅ #1134<br/>…"]`, a `Landed:` note, the step's `Commit type` (`refactor:` steps plus a `feat!:`), and the `Release batches` entry (`[#1134] (no release)` → `[#1134] (feat!:)`).
  - The `## Architecture overview` Mermaid block is predicted unchanged: its `PolicyLoader` node is fed by the three file kinds and does not model the merge or the methods.
- `docs/glossary.md` — predicted unchanged: `### Scope` already defines the four in order.
- `.pi/skills/package-pi-permission-system/SKILL.md` — `manager-harness.ts` bullet (`createManagerFromPaths`, `createInMemoryGlobalManager`, list-input `createInMemoryPolicyLoader`); the Configuration paragraph's "the manager reads the flags in `resolvePermissions`" to "reads each list entry's `invalid` and `floorsWhenInvalid`" (step 10).

## Test Impact Analysis

1. Newly possible: a loader-level assertion of scope order and per-scope floor flags (`loadScopes`), and a per-source cache-stamp table, neither of which had a single place to ask before.
2. Redundant: the in-memory "does not floor when the invalid flag is on the global scope" test would only restate a fixture flag once fixtures carry `floorsWhenInvalid`; it is reworded in step 8 to pin the mechanism (an invalid entry with `floorsWhenInvalid: false` does not floor, one with `true` does), and the production fact moves to step 5's file-backed row.
3. Kept as-is: the in-memory `scope composition` precedence and origin tests (they pin the manager's iteration and attribution, now over list fixtures), and the file-backed `agent frontmatter`, `configureForCwd`, and `PI_CODING_AGENT_DIR` tests.

## Invariants at risk

- [#1133]'s outcome: no flat top-level `test(` in `test/policy/` (measured 0) and at most 80 `try` blocks there (measured 36).
  Step 5's table uses `createTmpFixture` with an `afterEach` cleanup and nested `describe`/`it`, so neither count rises; re-run both greps at step 5's commit.
- The fail-closed floor (#646): deny-preserving, global excluded, yolo re-permits.
  Pinned before the refactor by step 5 (real files) and the existing `yolo > under a fail-closed scope` tests.
- Rule origins and the composed ruleset: pinned by the existing `scope composition > rule origin` and `precedence between scopes` tests, run unchanged through steps 6–7.
- Cache invalidation: the manager's resolved-permissions cache is keyed by `getCacheStamp`; step 6's table pins that each source's file participates.

## TDD Order

1. **Build explicit-path managers through a harness helper.**
   Add `createManagerFromPaths(paths, options?)` to `manager-harness.ts`; route `createManager`, `createManagerWithProject`, `createMissingConfigManager`, the eight `permission-manager.test.ts` sites, and `config-reporter.test.ts:106` through it.
   The four `flavor` sites (2812–2885) pass `mcpServerNames: []`, which stops them reading the host's `mcp.json`.
   No new tests; the suite stays green.
   Commit: `test(pi-permission-system): build explicit-path managers through a harness helper`.
2. **`PermissionManagerOptions` stops extending `PolicyLoaderOptions`.**
   Keep the `new FilePolicyLoader({})` fallback for the no-argument constructor; update the `configureForCwd` docblock.
   Run `pnpm --filter @gotgenes/pi-permission-system run check`: any surviving explicit-path site fails here.
   Commit: `refactor(pi-permission-system): drop the explicit-path PermissionManager constructor mode`.
3. **Route global-only in-memory managers through `createInMemoryGlobalManager(config, mcpServerNames?)`.**
   A scripted codemod per the `edit-tool` skill rewrites `createInMemoryManager({ global: X })` (multi-line wrappers included) to `createInMemoryGlobalManager(X)`; `makeYoloManager` and every site with a non-global key wait for step 8.
   Verify the count of remaining keyed sites by grep before committing (expect roughly 18 plus `makeYoloManager`).
   Commit: `test(pi-permission-system): build global-only in-memory managers through one helper`.
4. **Move `policy-loader.test.ts` onto `createTmpFixture`.**
   Extend `makeLoader` to write a project config, agent files, and project agent files; add a `scopeConfig(loader, origin, agentName?)` accessor that switches over the four current methods; replace the 21 `try`/`finally` blocks (measured) with an `afterEach` cleanup.
   Same titles, same assertions.
   Commit: `test(pi-permission-system): run the policy-loader tests on a tmp fixture`.
5. **Pin the fail-closed floor for every scope over real files.**
   In `permission-manager.test.ts` under `scope composition > an invalid non-global scope fails closed`, a table over a `createManagerFromPaths` manager with a `createTmpFixture` tree, each row checking `read` for agent `coder` under a global `read: "allow"`: global malformed JSON → no floor, no notice; project malformed JSON → `ask`/`fail-closed` and notice `Invalid project configuration …`; agent `coder.md` as a directory (EISDIR) → floor, notice names `agent`; project-agent `coder.md` as a directory → floor, notice names `project-agent`; project and project-agent both invalid → notice `Invalid project, project-agent configuration …`.
   The rows are green on arrival (a characterization), so mutate before committing.
   Killing mutations: delete the `if (projectAgentConfig.invalid === true)` branch in `resolvePermissions` → the project-agent rows go red; reverse `failClosedScopes` before the join → the two-scope notice row goes red.
   Commit: `test(pi-permission-system): pin the fail-closed floor for every config scope`.
6. **Read the scopes through two private source kinds.**
   In `policy-loader.ts`, extract `ConfigFileScopeSource` (from `loadGlobalConfig`/`loadProjectConfig`) and `AgentFileScopeSource` (from `loadScopeConfigFrom`), build the ordered `sources` array in the constructor, make the four public methods one-line delegates, derive `getCacheStamp` from the array, and have `getResolvedPolicyPaths` (still flat) read the sources' fields.
   New test in `policy-loader.test.ts`: a table where touching each source's file (global, project, agent `coder`, project-agent `coder`) changes `getCacheStamp("coder")`.
   Killing mutation: omit the project-agent source from the `sources` array → its stamp row goes red.
   Re-read the moved code against the `code-design` skill before committing.
   Commit: `refactor(pi-permission-system): read each config scope through one source kind per file type`.
7. **`PolicyLoader.loadScopes` replaces the four scope loaders.**
   Add `ScopeOrigin` to `rule.ts` and `PolicyScope` to `policy-loader.ts`; `loadScopes` maps the sources; remove `loadGlobalConfig`, `loadProjectConfig`, `loadAgentConfig`, `loadProjectAgentConfig` from the interface and the class; `resolvePermissions` iterates the list as in the Design Overview; the in-memory fake implements `loadScopes` from its keyed input (transitional, replaced in step 8); the `scopeConfig` accessor's body becomes a `find`, and the mtime identity test asserts on `.config`.
   New loader tests: `loadScopes("coder")` returns origins `global, project, agent, project-agent` with floors `false, true, true, true`; a rejected global file yields `invalid: true` on the global entry.
   Killing mutations: swap the project and agent sources in the array → the order test goes red; set the project-agent source's `floorsWhenInvalid` to `false` → step 5's project-agent rows go red; drop `scope.floorsWhenInvalid &&` from the filter → step 5's global row goes red.
   Run `check` immediately after the commit (shared interface change).
   Commit: `refactor(pi-permission-system): deliver the config scopes as one ordered list`.
8. **The in-memory fake takes a list of scopes.**
   `createInMemoryPolicyLoader(scopes: readonly InMemoryScope[], mcpServerNames)`; `createInMemoryManager` and `createInMemoryGlobalManager` build on it; migrate the remaining keyed sites and `makeYoloManager` to list literals in precedence order with `floorsWhenInvalid` stated; reword the global-invalid test to the flag pair described in Test Impact Analysis.
   The fake no longer names the four scopes.
   Killing mutations: in the manager filter, replace `scope.floorsWhenInvalid` with `scope.origin !== "global"` → the reworded `floorsWhenInvalid: false` test goes red (its fixture marks a non-global entry); make the fake ignore `agentName` → a test where agent `coder`'s entry must not apply to an agent-less check goes red (add one under `precedence between scopes` if none does).
   Commit: `test(pi-permission-system): build the in-memory policy loader from a scope list`.
9. **`config.resolved` lists the scopes in precedence order.**
   `ResolvedScopePath` and list-shaped `ResolvedPolicyPaths`; `FilePolicyLoader.getResolvedPolicyPaths` maps the sources; `ResolvedConfigLogEntry` carries `scopes` plus the legacy flags and imports the type from `./policy-loader`; the fake, `config-store.test.ts`'s provider literal, `config-reporter.test.ts` (three unit tests and the log round-trip, which now asserts the whole `scopes` array with `toEqual`), `policy-loader.test.ts` 236–260, and `permission-manager.test.ts` 3719 and 3889–3955 move to the list; `docs/troubleshooting.md` sample and sentence.
   Killing mutations: reverse the array in `getResolvedPolicyPaths` → the order assertions go red; drop the agent source's `resolvedPath` (return the project path) → the directory assertions go red.
   Commit: `feat(pi-permission-system)!: list the config scopes in precedence order in config.resolved`, with the footer `BREAKING CHANGE: the config.resolved review and debug log entry replaces globalConfigPath, globalConfigExists, projectConfigPath, projectConfigExists, agentsDir, agentsDirExists, projectAgentsDir, and projectAgentsDirExists with a scopes array of { scope, path, exists }, ordered lowest to highest precedence.`
10. **Docs.**
    The architecture-doc and skill edits listed under Module-Level Changes, including the `### Recorded authority is composed from channels` subsection (a channel delivers rules one scope at a time; the config channels reach the manager as one ordered list of `PolicyScope`, each carrying its origin, content, and floor; ADR 0016's slot table — 1, 1.5, 2, 2.5, 3, 4, then the session layer — as the resolved direction, with 1.5 and 2.5 admitted and not shipped), and the roadmap ✅/`Landed:` marks, recording the measured post-change value of the `Scope-specific load methods in policy-loader.ts` row (baseline 8; target 0).
    Commit: `docs(pi-permission-system): record the config scopes as one ordered list`.

## Risks and Mitigations

- **A refactor silently changes which scope floors.**
  The floor rule moves from three `if`s in the manager to per-source flags in the loader; step 5 pins it over real files before the move, and step 7's mutations confirm the table sees it.
- **The global source starts marking `invalid`.**
  Unobservable while `floorsWhenInvalid` is `false`; step 5's global row and step 7's filter mutation pin that.
- **The fake and production drift on order or flags.**
  With list fixtures the fake carries no order or flags of its own; production's are pinned at the loader (step 7) and through real files at the manager (step 5).
- **The codemod in step 3 misses or mangles a multi-line wrapper.**
  Grep the remaining keyed sites and run the full package suite before committing; follow the `edit-tool` skill's scripted-substitution rules and confirm with `git diff --stat`.
- **A log consumer parses the flat fields.**
  The change is announced by the `!` and the `BREAKING CHANGE:` footer, and `docs/troubleshooting.md` documents the new shape; within this repo no code reads `config.resolved` (grep at planning: only `config-store.ts` writes it and `troubleshooting.md` documents it).

## Open Questions

- Whether [#1122]'s global `config.local.json` (slot 1.5) floors when invalid is that issue's decision; this change makes it one `floorsWhenInvalid` value on one source.

[#1028]: https://github.com/gotgenes/pi-packages/issues/1028
[#1108]: https://github.com/gotgenes/pi-packages/issues/1108
[#1122]: https://github.com/gotgenes/pi-packages/issues/1122
[#1127]: https://github.com/gotgenes/pi-packages/issues/1127
[#1133]: https://github.com/gotgenes/pi-packages/issues/1133
