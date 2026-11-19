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
