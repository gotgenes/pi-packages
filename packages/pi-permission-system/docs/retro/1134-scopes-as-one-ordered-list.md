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
