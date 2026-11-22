---
issue: 334
issue_title: "Inject a single PermissionManager into PermissionSession (configure once at session_start)"
---

# Retro: #334 — Inject a single PermissionManager into PermissionSession

## Stage: Planning (2026-06-04T00:00:00Z)

### Session summary

Produced the numbered implementation plan `docs/plans/0334-inject-single-permission-manager.md` for Phase 4 Step 1.
The plan injects one `PermissionManager` into `PermissionSession`, adds `PermissionManager.configureForCwd(cwd)` plus an `agentDir` constructor option, moves the cwd→paths derivation onto a pure `derivePolicyLoaderOptions` helper in `permission-manager.ts`, and deletes the now-dead `createPermissionManagerForCwd` / `derivePiProjectPaths` factory functions.
Structured as three commits: additive `configureForCwd` (`feat:`), the coupled session-injection + `index.ts` + test change (`refactor:`), and the factory removal (`refactor:`).

### Observations

- The package has two separate `PermissionManager` instances today (`runtime.permissionManager` vs. the session's).
  The plan deliberately **preserves** this split-brain — unifying is Step 4 (#337).
  Called out in Non-Goals and Risks so the implementer/reviewer does not treat it as a regression.
- Decided to inject a **narrow `ScopedPermissionManager` interface** (five methods) rather than the concrete class, which is what lets `permission-session.test.ts` drop the `as unknown as PermissionManager` cast — the issue's stated outcome.
  `getComposedConfigRules` / `getResolvedPolicyPaths` are excluded (ISP) since only the `runtime.permissionManager` path uses them.
- The cwd→paths helper had to move out of `runtime.ts` into `permission-manager.ts` to avoid an import cycle (`runtime.ts` imports `permission-manager.ts`).
  `config-paths.ts` is cycle-free, so the helper imports `getGlobalConfigPath` / `getProjectConfigPath` from there.
- Intentional tightening: `derivePolicyLoaderOptions` sets `agentsDir = join(agentDir, "agents")` explicitly.
  Today `createPermissionManagerForCwd` leaves it unset, so `FilePolicyLoader` falls back to a hidden `getAgentDir()` env read.
  In production `agentDir === getAgentDir()`, so this is observably identical while removing the env dependency and making the new unit test deterministic.
- Did not invoke `ask_user`: the issue's "Proposed change" plus the architecture roadmap resolved every design choice (no genuinely ambiguous breaking-vs-non-breaking or result-shape decision remained).
- The pre-existing `0334-phase-4-roadmap.md` retro is from the roadmap meta-session, not a prior attempt at this implementation; used a distinct slug (`0334-inject-single-permission-manager`) for both plan and retro.

## Stage: Implementation — TDD (2026-06-04T16:50:00Z)

### Session summary

Completed all three TDD cycles from the plan.
Step 1 (`feat:`) added `PermissionManager.configureForCwd`, the `agentDir` option, `derivePolicyLoaderOptions`, and the `ScopedPermissionManager` interface with 5 new filesystem-backed unit tests.
Step 2 (`refactor:`) injected the manager into `PermissionSession` and updated `index.ts`; `vi.mock("../src/runtime")` and `as unknown as PermissionManager` were removed from `permission-session.test.ts`.
Step 3 (`refactor:`) deleted `createPermissionManagerForCwd` and `derivePiProjectPaths` from `runtime.ts` and their 8 test blocks from `runtime.test.ts`.
Test count: 1834 → 1831 (−3 net: +5 new `configureForCwd` tests, −8 deleted factory tests).

### Observations

- Pre-completion reviewer returned **PASS** with two WARNs fixed before committing: (1) unused `getGlobalConfigPath` import left in `test/runtime.test.ts` after deleting the factory describe blocks, and (2) `derivePolicyLoaderOptions` placed above its caller in `permission-manager.ts` (stepdown rule violation); both were fixed by amending the Step 3 commit.
- A botched intermediate edit accidentally split `PermissionManager` into two class declarations while repositioning `derivePolicyLoaderOptions`.
  Fixed by removing the spurious early `}` and re-inserting the helper after the class's real closing brace.
  The lesson: when moving a helper below its caller in a class file, use two separate focused edits (remove from old location, insert at new location) rather than one large combined replace.
- The plan's `makePermissionManager` overrides parameter was dropped entirely in favour of the per-field `??` pattern (testing skill convention); callers that needed custom return values use `vi.mocked(pm.method).mockReturnValue(...)` after construction instead.
- The `ScopedPermissionManager` interface (5 methods) was introduced in Step 1 and consumed in Step 2 with no intermediate dead-code flag from fallow, confirming same-plan cross-step exports are acceptable.

## Stage: Final Retrospective (2026-06-05T00:45:38Z)

### Session summary

Shipped Phase 4 Step 1 end-to-end across Planning, TDD, and Ship stages in a single session: injected one `PermissionManager` into `PermissionSession`, added `configureForCwd` + the `agentDir` option, and deleted the `createPermissionManagerForCwd` / `derivePiProjectPaths` factories.
Released as `pi-permission-system-v10.2.0` after CI passed; the issue was closed and the release-please PR (#343) merged.
The run was clean overall — the only agent-side rework was a self-inflicted editing slip during a reviewer-flagged cleanup, caught immediately by `biome`.

### Observations

#### What went well

- The prior `0334-phase-4-roadmap.md` retro's changes paid off: that meta-session flagged `premature-convergence` and `instruction-violation` (not reading tests / not loading `design-review` before planning).
  This session's Planning stage loaded `design-review`, read the test files alongside production code, and produced a plan that needed no `ask_user` round — the exact behavior those retro changes were meant to induce.
- The `ScopedPermissionManager` narrow-interface seam delivered the constructibility goal precisely: `vi.mock("../src/runtime")` and the `as unknown as PermissionManager` cast both left `permission-session.test.ts`, and the same-plan cross-step export (interface in Step 1, consumer in Step 2) passed `fallow` with no intermediate dead-code flag.
- The pre-completion reviewer (`claude-sonnet-4-6`) caught two genuine WARNs that would otherwise have shipped — a fresh-context read returning real value on a refactor whose whole point was structural cleanliness.
- Ship-stage `ask_user` release-timing gate fired correctly for a multi-issue sequence (Phase 4 is #334–#342); the user chose to release Step 1 individually and the release landed cleanly.

#### What caused friction (agent side)

- `instruction-violation` (reviewer-caught) — `derivePolicyLoaderOptions` was placed *above* `class PermissionManager`, violating the stepdown rule that `code-design` states explicitly ("place it below the function that calls it, not above").
  The violation originated in the Planning-stage code sketch (the plan showed the helper above the class) and was followed faithfully during TDD.
  Impact: one reviewer WARN; the fix was a ~15-line reposition.
- `other` (mechanical edit slip) — repositioning `derivePolicyLoaderOptions` below the class was attempted as one large combined `Edit` that closed the class early and reopened it as `_PermissionManagerMethods`, producing a duplicate `PermissionManager` declaration.
  Impact: ~5 extra tool calls to recover; caught immediately by the `biome` `noRedeclare` / `noUnusedPrivateClassMembers` autoformat feedback (the feedback loop working as designed), so no rework escaped the session.

#### What caused friction (user side)

- None.
  User involvement was limited to the one strategic decision the workflow is designed to surface (release now vs. batch the sequence); no corrections or redirects were needed.

### Diagnostic details

- **Model-performance correlation** — one subagent dispatched (pre-completion-reviewer) on `anthropic/claude-sonnet-4-6`, appropriate for judgment-heavy review; no mismatch.
  A transient `model_change` to `opencode-go/deepseek-v4-flash` appears in the session log with no attributable assistant turn — a selection that did not run; not over-interpreted.
- **Escalation-delay tracking** — the class-split slip spanned ~5 tool calls (botched edit → `biome` error → read → rename → `noRedeclare` error → read → corrective edits → green), but each step made forward progress against a concrete compiler/linter message rather than looping on the same error; no subagent escalation was warranted.
- **Feedback-loop gap analysis** — no gap.
  `pnpm run check` ran after every TDD step, the full suite after each step, and `pnpm fallow dead-code` from the repo root before push; verification was incremental, not end-loaded.

### Changes made

1. Appended this Final Retrospective stage entry to `packages/pi-permission-system/docs/retro/0334-inject-single-permission-manager.md`.
   No prompt or `AGENTS.md` changes were made: the user chose retro-only, since the preventing rules (the `code-design` stepdown rule) already exist and `biome` plus the pre-completion reviewer caught both friction points in-session.
