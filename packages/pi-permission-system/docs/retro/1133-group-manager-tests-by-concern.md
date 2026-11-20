---
issue: 1133
issue_title: "pi-permission-system: split permission-manager-unified.test.ts by concern"
---

# Retro: #1133 — pi-permission-system: split permission-manager-unified.test.ts by concern

## Stage: Planning (2026-11-19T17:28:19Z)

### Session summary

Planned the reorganization of `test/policy/permission-manager-unified.test.ts` (232 tests) into one file, `permission-manager.test.ts`, with one `describe("PermissionManager")` and a `describe` per concern.
The two sibling files `permission-manager-fail-closed.test.ts` and `permission-manager-yolo.test.ts` fold in as well.
The plan is 12 commits: rename, in-place conversion to `createInMemoryManager`, in-place duplicate removal, then one commit per concern block or folded file, then docs.

### Observations

- The design reversed mid-gate.
  The issue proposed one file per concern; the first gate settled six files.
  The operator then pointed out that the `permission-manager-` prefix on every file signalled a missing grouping, and that "split by behavior of one class" means `describe` blocks, not files.
  Every option I had offered (six files, five, a subdirectory, flat names) shared the issue's premise that the fix is more files; the clarification-gates skill's shared-premise rule would have surfaced the describe option at the first gate.
- Spike evidence (measured, spikes deleted):
  - All 232 tests pass when every permission-map-only factory is backed by the in-memory loader.
  - Exactly one test's config fails the schema on disk (`non-string reason falls through to the default (malformed config)`), so it stays on the file harness.
  - Inline literals type-check against `FlatPermissionConfig`, but a separately declared config needs an annotation.
  - Wrapping the file in a root `describe` adds a fallow `large_functions` entry, but the health score stays 77.6 with `unit_size` at 10.0.
- Duplicate criterion, settled with the operator ("all exact duplicates"): a test is removed only when another runs the same composed ruleset and call and asserts a superset.
  That yields 23 removals; the flat project-agent precedence test is the issue's named exception.
- The `checkPathPolicy` describe was five exact copies of `check — path-values intent` plus one test pinning an adapter default; that one is rewritten, not dropped.
- `createManagerWithScopes` has callers only in this file and is deleted with its last conversion (fallow `unused-exports` is `error`).
- The roadmap step's `Target:`/`Constraint:` text says "one file per concern"; the plan's docs step rewrites it and renames the heading and Mermaid node.

#### Deferred tidyings

- `test/policy/permission-manager.test.ts`: `checkPath`'s six positional parameters (68 call sites).
- `test/helpers/manager-harness.ts`: `createMissingConfigManager` duplicates `createInMemoryManager()` in effect.
- `test/exposure/skill-prompt-sanitizer.test.ts`: `asChecker` adapts the manager to `SkillPermissionChecker` beside the check adapters.

## Stage: Implementation — TDD (2026-11-20T04:38:12Z)

### Session summary

All 12 plan steps landed as separate commits: rename, in-memory conversion, duplicate removal, two folds, five concern groupings, and docs.
`test/policy/permission-manager.test.ts` now holds every `PermissionManager` test under one `describe("PermissionManager")`.
The package suite went from 6550 to 6527 tests (the 23 planned removals); the three files' 252 tests are 229 in one.

### Observations

- Measured outcomes matched the plan's predictions: flat top-level tests 50 → 0, `try` blocks in `test/policy/` 152 → 36, and fallow health unchanged at 77.6 with `unit_size` 10.0.
- The file is 3,957 lines against the plan's estimate of about 3,700: Biome rewraps more lines at the deeper indentation.
- The moves ran through a throwaway Python block-mover keyed on exact titles (each asserted unique), with `biome format` after each step.
  Verification at each step was the leaf-title census diff plus a trimmed-line multiset diff against the previous step, which separates content changes from reflow.
- Two engine bugs surfaced and were caught before commit.
  First, indenting a moved block also indented YAML inside multi-line template literals, which broke 11 agent-frontmatter tests; the engine became template-literal aware.
  Second, a `// ── Deny-with-reason ──` section comment was separated from its first test by a blank line, so it stayed behind and was removed by hand.
- Killing mutations: the in-memory `loadGlobalConfig` returning `{}` killed 134 tests; `loadProjectConfig` returning `{}` killed 4, including both named; forcing the path-values surface killed the rewritten test; disabling the fail-closed clamp killed 5; ignoring `isYoloEnabled` killed 3.
- Small deviations from the plan:
  - `documentedConfig` in the MCP example also needed a `FlatPermissionConfig` annotation.
  - The three MCP `it.each` tables got typed rows.
  - Two Pi MCP sub-describes were retitled so they no longer repeat their parent's "Pi MCP tools" prefix (describe titles only; no leaf title changed).
- Pre-completion reviewer: WARN.
  The finding: the removed flat test `Project-agent config overrides system-agent tool rules` is not a strict superset match for its kept counterpart.
  The plan documented that, and the issue asks for the removal; frontmatter precedence stays pinned by `Full precedence chain…` and `Project-agent applies even without a matching system-agent file`.
