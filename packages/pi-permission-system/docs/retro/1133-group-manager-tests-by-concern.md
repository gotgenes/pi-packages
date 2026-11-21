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

## Stage: Final Retrospective (2026-11-21T04:09:46Z)

### Session summary

One session ran planning, TDD, ship, and retro for #1133.
The 4,174-line `permission-manager-unified.test.ts` and its two sibling files became one `permission-manager.test.ts` grouped by concern under `describe("PermissionManager")`, in 12 commits with no `src/` change and no release.
Every measured prediction landed (0 flat tests, 36 `try` blocks, 229 tests, health 77.6), and the issue closed on green CI.

### Observations

#### What went well

- A routing-log spike made the plan's numbers exact before any code moved.
  A throwaway copy of the test file logged every factory call with its test name and the config's schema verdict; that predicted the in-memory conversion green (232/232), found the one schema-rejected config, and predicted the `try` count of 36 that landed.
- Two cheap instruments made each of 8 move commits verifiable without reading 4,000 lines of diff: a `vitest list --json` leaf-title census diffed per step, and a trimmed-line multiset diff that separates content changes from Biome reflow.
  Neither caught a defect here (the test run and a grep did); they confirmed each move changed only what the step named.
- Converting and deduplicating in place before any move (the Tidy-First assessor's recommendation) turned every later commit into a pure relocation, which kept the census diffs down to the step's own retitles.

#### What caused friction (agent side)

- `premature-convergence` — every layout option I put to the operator (six files, five files, a subdirectory, flat names) shared the issue's premise that the fix is more files.
  The clarification-gates rule on shared premises and the testing skill's "nest by the unit, then the scenario" were both loaded; neither fired.
  User-caught over three exchanges ("the prefix indicates a subdirectory or none", "are these tests of a class called `PermissionManager`?", "one class is a sign for `describe` blocks").
  Impact: three extra gate rounds, the first gate's answer reversed, and the operator had to ask whether the earlier decision was being undone.
- `instruction-violation` — the plan commit used `docs(pi-permission-system): plan …` where `/plan-issue` prescribes `docs: plan …`.
  `/ship`'s derivation grep then matched #1101's plan commit, and the `PLAN` anchor resolved empty at step 8.
  Self-identified at ship time.
  Impact: no wrong action (the issue number came from context), but an argument-less `/ship` would have targeted the wrong issue.
  Four of 616 plan commits in history carry a scope.
- `other` — the throwaway block-mover re-indented lines inside multi-line template literals, which shifted the agent-frontmatter YAML and broke 11 tests.
  Caught by the step's test run; the engine was made template-literal aware and the step re-run (about 3 tool calls).
  A blank line also separated a `// ── Deny-with-reason ──` section comment from its first test, so it stayed behind; the line-multiset diff did not flag it, and a grep did.
- `other` — the first layout `ask_user` was rejected for having no visible text, though a briefing had been written; re-sent with the substance in full.
  Impact: one extra call.

#### What caused friction (user side)

- The operator's redirect arrived as a series of questions, which surfaced my confusion clearly but took three rounds.
  Stating the conclusion ("one class: use `describe` blocks in one file") in the first reply would have saved two; the questions were the right move when the premise itself was in doubt.

### Diagnostic details

- **Model-performance correlation** — planning and TDD ran on `anthropic/claude-opus-5-5` (168 turns); the last two TDD turns and the whole ship ran on `anthropic/claude-sonnet-5-5` (10 turns), appropriate for mechanical work.
  Both subagents ran on `anthropic/claude-opus-5-5`, matching their definitions.
  The pre-completion reviewer took 2,889 s and 268.7k tokens, because the dispatch asked it to re-derive title-level parity across 240 tests by AST; the cost bought an independent check of the issue's only acceptance criterion.
- **Feedback-loop gap analysis** — every TDD step ran the file, `pnpm run check`, Biome, and ESLint before commit, and the full package suite ran after the one shared-helper change (step 2); no gap.

### Changes made

1. `.pi/prompts/ship.md`: the four plan-commit greps accept an optional scope (`docs\(([^)]*)\)\?: \(re-\)\?plan`), so a scoped `docs(<pkg>): plan` commit no longer makes an argument-less `/ship` derive another issue or anchor on an empty `PLAN`.
   Measured: the pattern matches all 616 plan commits and resolves both #1133's scoped and #1101's unscoped commit.
2. `.pi/skills/clarification-gates/SKILL.md`: the shared-premise rule gains one example naming an issue's prescribed shape (a file split) as a premise.

The edit-tool sentence on re-indenting inside template literals was proposed and declined.
