---
issue: 1134
issue_title: "pi-permission-system: deliver the config scopes as one ordered list instead of four positional loaders"
---

# Retro: #1134 — pi-permission-system: deliver the config scopes as one ordered list instead of four positional loaders

## Stage: Planning (2026-11-24T17:58:11Z)

### Session summary

Planned the Phase 16 spine step: `PolicyLoader.loadScopes` returns an ordered list of `PolicyScope` (`origin`, `config`, `floorsWhenInvalid`), `FilePolicyLoader` reads through two private source kinds, and `resolvePermissions` iterates the list for the merge and the floor.
The plan has ten steps: four preparatory `test:`/`refactor:` steps from the Tidy-First assessor, a file-backed fail-closed table, two refactors, the list-input test fake, a `feat!:` for the log shape, and docs.

### Observations

- Operator gate, Q1: the `config.resolved` review/debug log entry reports `scopes: [{ scope, path, exists }]` in precedence order instead of the eight flat fields.
  This was chosen over a byte-identical projection, so the issue is no longer "no release": step 9 is `feat(pi-permission-system)!:`, and step 10 updates the roadmap's commit type and `Release batches` entry.
  The operator asked what the ordering buys.
  Answer: precedence becomes readable in the log (`.scopes[-1]` is the highest), a decision's `origin` locates its position, and #1122's local files appear at their slots.
  No explicit slot/index field (array position is the contract), and the agent scopes still report directories.
- Operator gate, Q2: the in-memory fake takes a list of scopes, not the keyed fixture.
  The assessor's count showed about 121 of the 141 call sites are `global`-only, so step 3 routes those through `createInMemoryGlobalManager` first.
  That cuts the list migration to about 18 sites plus `makeYoloManager`, and drops the transitional union/describe-per-commit sequence.
- The assessor flagged that once fixtures state `floorsWhenInvalid`, the in-memory "global invalid does not floor" test becomes tautological.
  It is reworded to pin the mechanism (floor by flag, not by origin), and the production fact moves to step 5's file-backed table.
- Behavior detail to watch: the unified config-file source makes the global scope mark `invalid` too (today it never does).
  `floorsWhenInvalid: false` keeps that unobservable; step 7's filter mutation pins it.
- `new PermissionManager()` with no arguments (the `PI_CODING_AGENT_DIR` test) keeps the `new FilePolicyLoader({})` fallback after the explicit-path mode moves into the harness.
- No follow-up issues filed.

#### Deferred tidyings

- `src/config/policy-loader.ts` / `src/policy/permission-manager.ts`: `defaultGlobalConfigPath`/`defaultAgentsDir` duplicate `derivePolicyLoaderOptions`' path derivation (the symmetry idea deferred in plan 0428); unrelated to the scope list.

## Stage: Implementation — TDD (2026-11-25T17:13:30Z)

### Session summary

All ten plan steps landed as ten commits: four preparatory `test:`/`refactor:` steps, the file-backed fail-closed table, two refactors that end in `PolicyLoader.loadScopes`, the list-input test fake, `feat(pi-permission-system)!: list the config scopes in precedence order in config.resolved`, and the docs.
The package suite went from 6553 to 6563 tests: +5 file-backed floor rows, +4 per-scope stamp rows, +2 `loadScopes` tests, −1 merged reporter test.

### Observations

- Every named killing mutation produced exactly the predicted reds, sometimes with extra overlapping reds.
  Step 8's "fake ignores `agentName`" mutation was already killed by an existing test ("trims the tool name and honors the agent scope"), so no new test was added; the plan allowed for that.
- Deviation, step 6: the plan had `getResolvedPolicyPaths` read the sources' fields while still flat.
  A source's path is `string | null` but the flat report needs `string` for global and agent, so that read would have needed a `?? ""` repair.
  The transitional step kept the loader's own path fields for the flat report instead; `resolvedPath()` arrived on the sources in step 9, when the report became the list.
- Deviation, step 9: `config-reporter.test.ts` was rewritten under nested `describe`s, and its "handles null project paths" test folded into the first test (a `project-agent` entry with `path: null`), so the file went from 4 tests to 3.
  The log round-trip now asserts the whole `scopes` array and that `globalConfigPath` is absent, and spreads the entry instead of casting it.
- Step 3's codemod (a balanced-bracket scanner, not a regex) rewrote 121 global-only sites; single-line imports needed a hand pass, since the script's import rewrite only matched multi-line import lists.
- Step 7's new "marks a rejected global file invalid" test was green on arrival (the unified source already did it from step 6), so it got its own mutation (`&& this.origin !== "global"`), which killed it.
- Measured after the change: scope-specific load methods 8 → 0, `project-agent` mentions in `src/` 28 → 7, `mergeScopesWithOrigins` in `permission-manager.ts` still 2 (that is #1108's), flat top-level tests in `test/policy/` 0, `try` blocks there 36.
- Pre-completion reviewer: WARN.
  Reviewer warnings: the same `ScopeOrigin` is named `scope` on `ResolvedScopePath` (the log contract the operator approved) and `origin` on `PolicyScope`; `scope()`/`resolvedPath()` are structurally duplicated across the two source classes, which it rated acceptable for two kinds.

## Stage: Sync (worktree) (2026-11-25T17:27:24Z)

### Session summary

Both reviewer warnings were settled with the operator before syncing; lint, `fallow dead-code`, `check`, and the full test suite pass after the resulting commits.
The plan's marker is `**Release:** ship independently`, and the issue now ships a `feat!:` (major) for `pi-permission-system`.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-1134--/2026-11-24T05-51-30-612Z_01a20c1b-fd33-777a-8288-ed8ff2e950d1.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

- Naming warning, resolved by ubiquitous language (operator: "a big help to cognitive debt").
  The value is a scope's *name* wherever it identifies a scope, and becomes an *origin* only when stamped on a rule.
  `ScopeOrigin` became `ScopeName` and `PolicyScope.origin` became `name` (`refactor(pi-permission-system): name a config scope by its name, not its origin`).
  The `config.resolved` entry's key became `name`, folded into the `feat!:` commit through an `amend!` commit so its `BREAKING CHANGE:` footer reads `{ name, path, exists }`.
  The glossary's Origin entry now says a scope has a name, not an origin.
- Duplication warning: the operator agreed the better organization is composition (one scope source = a locator for *which file* + a reader for *how it is read*), deferred to the step that first needs it.
  It is recorded as #1127's `Ride-along tidying` in the roadmap, with a note on #1028 to take it if planned first (`docs(pi-permission-system): plan the scope-source locator/reader split as #1127's ride-along`).
- The `amend!` commit is squashed into the `feat!:` commit by this sync's rebase (`--autosquash`), so `main` receives one `feat!:` commit with the corrected footer.
