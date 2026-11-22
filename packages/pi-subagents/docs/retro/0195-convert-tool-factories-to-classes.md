---
issue: 195
issue_title: "Convert tool factories to classes"
---

# Retro: #195 — Convert tool factories to classes

## Stage: Planning (2026-05-24T12:00:00Z)

### Session summary

Produced a 5-step TDD plan converting `createAgentTool`, `createGetResultTool`, and `createSteerTool` to classes with constructor-injected dependencies.
Verified both prerequisites (#193, #194) are closed and their effects visible in the current source.
Designed narrow interfaces (`AgentToolRuntime`, `GetResultToolManager`, `SteerToolManager`, `SteerToolEvents`, etc.) that `SubagentRuntime`, `AgentManager`, and `NotificationManager` satisfy structurally.

### Observations

- The conversion is mechanical — no behavioral changes, just structural.
  Existing tests cover all paths; only test helpers need updating.
- `steerAgent` and `getAgentConversation` are pure functions that can be imported directly by the classes rather than injected — simplifies the constructor signature.
- `agentDir` doesn't fit neatly on any existing collaborator, so it remains a constructor param for `AgentTool`.
- The `AgentToolWidget` interface may become redundant once `AgentToolRuntime` replaces it as the type passed to `spawnBackground`/`runForeground`, but this is deferred to implementation.
- Ordered TDD steps from smallest (SteerTool) to largest (AgentTool) to build confidence incrementally.

## Stage: Implementation — TDD (2026-05-24T21:26:00Z)

### Session summary

Completed all 5 planned TDD cycles (SteerTool → GetResultTool → AgentTool → `index.ts` wiring → architecture doc).
All 854 tests pass; type check and lint clean.
Total: 5 commits across source + test files, plus 1 cleanup fix commit.

### Observations

- `steerAgent` was inlined as `session.steer(message)` directly in `SteerTool.execute()` rather than imported as a module function.
  This eliminated the dep entirely — the mock session's `steer` vi.fn() handles it in tests without `vi.mock`.
- The `verbose` test in `get-result-tool.test.ts` was upgraded to drive the real `getAgentConversation` function via `createMockSession({ messages: [...] })` overrides, making it a stronger integration test.
- `AgentToolWidget` was eliminated: `AgentToolRuntime` (a superset) replaced it, and `background-spawner` and `foreground-runner` already define their own narrow `BackgroundWidgetDeps`/`ForegroundWidgetDeps` interfaces.
- `createToolDeps()` changed shape from `AgentToolDeps` bag to `AgentToolFixture` (`{ manager, runtime, settings, registry, agentDir }`).
  This required updating `background-spawner.test.ts` and `foreground-runner.test.ts` (not listed in the plan) to destructure `{ manager, runtime }` instead of `{ manager, widget, agentActivity }`.
- Biome flagged an unused `import type { AgentSession }` in `get-result-tool.ts` (left by ESLint's cast removal in step 2) — caught by `pnpm run lint` and fixed in a separate commit.
- The `ReturnType<typeof vi.fn>` annotation on `makeNotifications()` in the get-result-tool test triggered a TypeScript error; fixed by removing the return type annotation entirely (per testing skill guidance).

## Stage: Final Retrospective (2026-05-25T14:06:00Z)

### Session summary

Shipped #195 (three tool factory-to-class conversions), then discovered and fixed a process gap: the fallow dead-code gate was advisory (`continue-on-error: true`) and the `/tdd-plan` and `/ship-issue` prompts didn't run `pnpm fallow dead-code` at all.
Resulting follow-up work promoted all dead-code rule categories to `error` severity, split the CI fallow step into a hard gate plus advisory full report, and removed the genuinely dead `steerAgent` export and unused `@eslint/js` devDependency.

### Observations

#### What went well

- The user reading CI output carefully and asking "why did fallow check fail yet we proceeded to release?" surfaced a real process gap that would have silently accumulated dead code over time.
- Incremental severity promotion was effective: checking each category's violation count before promoting let us ratchet from 3 error-level rules to 9 in three commits with zero cleanup work (all categories were already clean except the `steerAgent` export we'd just created).

#### What caused friction (agent side)

- `missing-context` — During the TDD session, I didn't run `pnpm fallow dead-code` after removing all callers of `steerAgent`, so the dead export shipped.
  The existing `/tdd-plan` prompt's "after last step" checks didn't include fallow.
  Impact: dead code shipped to a release, required a follow-up fix commit and re-release (`v7.2.2` → `v7.2.3`).
- `missing-context` — Used `// fallow-ignore-next-line unused-class-member -- reason text` but fallow parses every space-separated token after the rule name as additional rule names.
  The existing codebase uses bare comments with no trailing text.
  Impact: 12 stale-suppression warnings until the comment was fixed; no rework but added noise.
- `missing-context` — During planning, the Module-Level Changes section didn't list `background-spawner.test.ts` or `foreground-runner.test.ts`, even though both destructure `{ widget, agentActivity }` from `createToolDeps()`.
  The testing skill already has guidance ("grep for ALL test files that construct a compatible mock") but I didn't apply it during planning.
  Impact: caught immediately by running the full test suite; added friction but no rework.

#### What caused friction (user side)

- The fallow dead-code gap could have been caught earlier if the CI workflow had been configured to block on fallow findings from the start.
  The `continue-on-error: true` was a reasonable initial setting during adoption but had outlived its usefulness.

### Follow-up ideas

- **Pre-completion reviewer subagent** — a `.pi/agents/pre-completion-reviewer.md` dispatched before `/ship-issue` that runs deterministic checks (`pnpm fallow dead-code`, `pnpm run check`, `pnpm run lint`, `pnpm vitest run`) and judgment checks (conventional commits, architecture doc staleness) in a fresh read-only context.
  Modeled after RepOne's `pre-completion-reviewer` but scoped to this monorepo's needs.
  This would be a separate issue.

### Changes made

1. `.pi/prompts/tdd-plan.md` — added `pnpm fallow dead-code` as step 4 in "After the last TDD step" (renumbered steps 4–7 → 5–8).
