---
issue: 238
issue_title: "Remove extensions filtering from pi-subagents (Phase 14, Step 2)"
---

# Retro: #238 — Remove extensions filtering from pi-subagents

## Stage: Planning (2026-05-27T01:31:01Z)

### Session summary

Produced a 6-step TDD plan for narrowing `extensions` from `true | string[] | false` to `boolean` across `AgentConfig`, `ToolFilterConfig`, `filterActiveTools`, custom agent frontmatter parsing, UI serialization, and tests.
The plan mirrors the structure of the completed #237 plan (Step 1 of Phase 14) and explicitly defers `filterActiveTools` collapse to #239.

### Observations

- The `pkg:pi-permission-system` label on this issue is intentional context (pi-permission-system becomes the sole tool-policy authority) but all code changes are in pi-subagents.
- The `inheritField()` helper is shared between `extensions` and `skills` parsing — it cannot be simplified since `skills` still supports `string[]`.
  The plan coerces at the call site instead.
- After removing the `Array.isArray(extensions)` branch, the `builtinToolNameSet.has(t)` check in `filterActiveTools` becomes logically redundant (both branches return `true`), but simplifying further is #239's scope.
- Only 2 tests are removed and 3 updated; the boolean paths (`true`/`false`) are well-covered and unchanged.

## Stage: Implementation — TDD (2026-05-27T01:39:43Z)

### Session summary

All 6 TDD steps completed across 6 commits.
Test count went from 978 to 977 (net −1: 2 removed, 1 added for the deprecation warning).
Full suite: 62 files, 977 tests, all passing; type check and lint clean.

### Observations

- **Plan deviation — step consolidation**: The type narrowing in step 1 caused immediate `tsc` errors in test files that the plan assigned to steps 2–4 (the `string[]`-specific tests in `agent-runner-extension-tools.test.ts`, `session-config.test.ts`, and `agent-config-editor.test.ts`).
  All test fixes were folded into the step 1 commit to keep the build green at every commit.
  Steps 2–4 became purely production-code changes.
- **Plan deviation — deprecation warning**: The plan said to use `debugLog` for the deprecation warning, but `debugLog` is debug-only (requires `PI_SUBAGENTS_DEBUG=1`) and its signature requires an error object as the second argument.
  `console.warn` was used instead, which is user-visible without special env vars and testable with `vi.spyOn`.
- **ESLint auto-fix in step 2**: ESLint rewrote `extensions === false` to `!extensions` and `cfg.toolFilter.extensions === false` to `!cfg.toolFilter.extensions` after the type narrowed to `boolean`.
  Both are semantically identical; the changes were staged and included in the same commit.
- The `resolveBoolExtensions` helper in `custom-agents.ts` is a clean seam — if `skills` is ever also simplified to `boolean`, the same pattern applies.

## Stage: Final Retrospective (2026-05-27T01:48:04Z)

### Session summary

All three stages (planning, TDD, shipping) completed in a single continuous session.
Six implementation commits landed as `pi-subagents-v9.0.0` (major bump from `feat!:`).
Issue #238 closed; unblocks #239 (collapse `filterActiveTools`).

### Observations

#### What went well

- The plan’s structure closely followed the successful #237 pattern, making execution predictable.
- The implementer caught the type-narrowing cascade on the first `pnpm run check` and adapted immediately — no user intervention needed.
- The `resolveBoolExtensions` helper extraction was a clean design choice that keeps `inheritField` reusable for `skills`.
- ESLint auto-fix of `=== false` → `!` after the type narrowed to `boolean` was handled smoothly within the same commit.

#### What caused friction (agent side)

- `instruction-violation` (self-identified) — The planner did not apply the testing skill’s existing rule: “When a TDD plan lists separate steps that share a type definition, changing that type in step N breaks steps N+1…N+k.”
  The plan assigned test-fixture fixes (removing `extensions: string[]` values) to steps 2–4, but the type change in step 1 broke them all immediately.
  Impact: no rework — the implementer folded fixes into step 1 — but the plan’s step boundaries were misleading.
- `missing-context` — The plan recommended `debugLog` for the deprecation warning without checking its function signature (`(context: string, err: unknown)`) or its debug-only behavior.
  Impact: minor — switched to `console.warn` during implementation with no rework, but the plan was wrong.

#### What caused friction (user side)

- Nothing notable — no user corrections were needed across all three stages.

### Changes made

1. `.pi/skills/testing/SKILL.md` — Added type-narrowing-specific TDD planning rule: when a step narrows a union type, grep test files for fixtures using the removed variant and fold those fixes into the same step.
