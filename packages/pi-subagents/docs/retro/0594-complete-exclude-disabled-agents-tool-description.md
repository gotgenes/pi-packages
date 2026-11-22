---
issue: 594
issue_title: "fix(pi-subagents): complete exclude disabled agents from the subagent tool description"
---

# Retro: #594 — complete exclude disabled agents from the subagent tool description

## Stage: PR Review (2026-07-15T18:31:08Z)

### Session summary

Third-party PR #594 (`@whaoa`) completes the incomplete fix from #448 (`9a43414b`): disabled built-in agents (`Explore`, `Plan`, `general-purpose`) still leaked into the subagent tool's **static guideline text** even after #448 removed them from the type list.
The PR gates those guideline lines on `registry.isValidType(...)` and also drops the bare `Default agents:` header when no default agents remain enabled.
Operator direction: **adopt the capability with our own simplified design** (plan via `/plan-issue #594`), and source per-agent guideline copy from the agent config rather than keeping it hardcoded.

### Evaluation

**Problem — real.**
`9a43414b` (#448) filtered disabled agents out of `buildTypeListText` (`packages/pi-subagents/src/tools/helpers.ts`) but left three hardcoded guideline lines in `AgentTool.toToolDefinition` (`packages/pi-subagents/src/tools/agent-tool.ts`):

- `- Use Explore for codebase searches and code understanding.`
- `- Use Plan for architecture and implementation planning.`
- `- Use general-purpose for complex tasks that need file editing.`

When those built-ins are disabled, the model still receives guidance referencing agents it cannot spawn.
Secondary gap: `buildTypeListText` emits the bare `Default agents:` header even when zero defaults are enabled.

**Approach — sound, close to idiomatic, two things to change.**

- `helpers.ts` change (omit empty `Default agents:` header) mirrors the sibling `customDescs.length > 0` conditional directly below it.
  Keep as-is.
- `agent-tool.ts` change builds an `agentSpecificGuidelines` array gated by `registry.isValidType("Explore")` etc., filtered by a type guard.
  Works, but hardcodes the three agent names as magic-string literals **parallel to the `default-agents` config** — a second source of truth.
  Operator chose to **source the guideline copy from the agent config** (e.g. a `toolGuideline` field on the built-in `AgentConfig`) so descriptions and guidelines share one home and the registry drives both.
- **Test defect to fix:** the new `agent-tool.test.ts` case asserts `` not.toContain(`- ${name} :`) `` — with a **space before the colon**.
  The real type-list format is `- Explore:` (no space, see `helpers.ts:82,87`), so that assertion passes vacuously regardless of the fix.
  The meaningful assertion (`` not.toContain(`- Use ${name} for `) ``) is fine; drop or correct the tautological one.
- Minor: double space after `&&` in the gated expressions (Biome would normalize).

**Behavior — non-breaking.**
The default (all-enabled) description is unchanged; the text only shrinks when built-ins are disabled.
Correct `fix:` (no `!`).

### Decision and attribution

**Direction: adopt with simplified design.**
Re-implement cleanly via `/plan-issue #594`:

1. Keep the registry-gated approach and the `helpers.ts` empty-header fix.
2. **Source per-agent guideline copy from the agent config** (single source of truth) rather than the PR's hardcoded parallel list.
3. Fix the tautological test assertion (`- ${name} :` space-before-colon) and keep parametrized `it.for` coverage for disabled built-ins.

Agreed non-goals: no change to the all-enabled default description; no broader refactor of `buildTypeListText` beyond the empty-header guard.

Attribution — the contributor gets durable credit:

- Every implementation/docs commit carries, at the end of the body after a blank line:

  ```text
  Co-authored-by: whaoa <whaoa.w@outlook.com>
  ```

- The ship-stage PR close comment thanks `@whaoa` by name and links the implementing SHA(s).

- Reference the PR as `Refs #594` / `(#594)` — never `Closes #594`.

## Stage: Planning (2026-07-15T18:52:00Z)

### Session summary

Produced the numbered implementation plan (`packages/pi-subagents/docs/plans/0594-complete-exclude-disabled-agents-tool-description.md`) around the recorded adopt-with-simplified-design decision.
The design adds an optional `toolGuideline` field to `AgentConfig`, populates the three embedded defaults, and adds a `buildAgentGuidelines(registry)` helper in `helpers.ts` so the tool description's `Guidelines:` block is sourced from the registry (single source of truth) instead of hardcoded lines.
Two `fix:` cycles: (1) source guidelines from config + wire into `AgentTool`, (2) omit the empty `Default agents:` header.

### Observations

- **Guideline ordering (operator-confirmed).**
  Sourcing from config in registry order emits guidelines as `general-purpose, Explore, Plan` — a cosmetic reorder from the current `Explore, Plan, general-purpose`, now consistent with the `Default agents:` type-list order.
  Operator chose registry order over an explicit order anchor; the all-enabled description text is byte-identical, only line order changes.
  This intentionally relaxes the PR-review "no change to default description" non-goal (line order only).
- **ISP.**
  `buildAgentGuidelines` reuses the existing `TypeListRegistry` interface (reads only `getDefaultAgentNames` + `resolveAgentConfig`) — no new or wider dependency.
- **No dead-code window.**
  The helper is introduced and wired into `AgentTool` in the same commit, so `fallow dead-code` sees no orphaned export mid-sequence.
- **Empty-list safety.**
  The `Guidelines:` block is composed from an array so an empty `agentGuidelines` spread collapses with no blank line / orphaned label (covered by an all-disabled test).
- **PR test not adopted.**
  PR #594's `agent-tool.test.ts` assertion `- ${name} :` (space before colon) is tautological against the real `- ${name}:` format; the plan writes correct assertions instead.
- **No doc updates.**
  The guideline strings live only in `src/tools/agent-tool.ts` — no architecture doc, package SKILL, or README references them.
- **Release:** ship independently (two `fix:` → patch release); not in any open batch (Phase 19 closed).
- **Attribution:** every impl commit carries `Co-authored-by: whaoa <whaoa.w@outlook.com>`.

## Stage: Implementation — TDD (2026-07-15T16:02:00Z)

### Session summary

Implemented both `fix:` cycles plus one tidy-first prep commit; test count 965 → 974 (+9).
The subagent tool description now sources per-agent guideline copy from each enabled default agent's `toolGuideline` field (registry order), and `buildTypeListText` omits the empty `Default agents:` header.
Pre-completion reviewer: PASS.

### Observations

- **Tidy-first prep landed.**
  The assessor recommended one change-scoped refactor — extract the duplicated `enabled !== false` predicate into `isEnabledAgent(registry, name)` in `helpers.ts` before the feat, so `buildAgentGuidelines` reuses it instead of copy-pasting.
  Landed as `c5bbbdbe` (`refactor:`).
- **Commit split mechanics.**
  The two `fix:` cycles both touch `helpers.ts`/`helpers.test.ts`.
  To keep one logical change per commit, I implemented both greens, then reverted the Cycle-2 header-guard hunk + its test, committed Cycle 1, and reapplied + committed Cycle 2 — cleaner than `git add -p` on interleaved hunks.
- **Guideline reorder pinned.**
  A new `agent-tool.test.ts` assertion pins the registry-order guideline lines (`general-purpose, Explore, Plan`) so the operator-confirmed cosmetic reorder is intentional and documented.
- **PR test not adopted.**
  PR #594's tautological `- ${name} :` (space-before-colon) assertion was replaced with correct `- ${name}:` / `- Use ${name} for` checks.
- **Reviewer warnings (WARN, non-blocking).**
  The reviewer flagged that the tidy-first prep commit `c5bbbdbe` carries no `Co-authored-by: whaoa` trailer, while the recorded rule says "every implementation/docs commit."
  Decision: the refactor is our own preparatory tidying (not present in whaoa's PR), so credit rides on the two `fix:` commits that implement the contributed logic; the prep commit is exempt.
  Flagged here for the operator to confirm at ship time.
- **Gates:** `check`, root `lint`, full `test`, and `fallow dead-code` all green; no lockfile changes; no architecture/README/SKILL updates needed.

## Stage: Final Retrospective (2026-07-15T20:24:05Z)

### Session summary

Shipped #594 end-to-end across four stages (PR review → planning → TDD → ship) with no rework: a third-party PR (`@whaoa`) adopted with a simplified design that sources per-agent guideline copy from the agent config instead of the PR's hardcoded parallel list.
Released `pi-subagents-v18.0.3` (two `fix:` commits) and closed #594 with contributor credit.
The pipeline carried the recorded decision cleanly — each stage's retro note satisfied the next stage's Decide gate without re-litigation.

### Observations

#### What went well

- **PR-review triage drove a genuinely better design.**
  The PR-review stage separated the real problem (disabled built-ins leaking into the `Guidelines:` block) from the PR's implementation, caught a tautological test assertion (`- ${name} :` with a space that never matches the real `- ${name}:` format), and identified the parallel-source-of-truth smell.
  That evaluation — not the PR diff — became the plan, producing the `toolGuideline`-on-`AgentConfig` design.
- **`tidy-first-assessor` held its scope boundary on a real change (first-live-use checkpoint).**
  It recommended exactly one change-scoped refactor (extract `isEnabledAgent` in `helpers.ts`, reused by the new `buildAgentGuidelines`) and explicitly *declined* to restructure the adjacent `defaultDescs`/`customDescs` duplication because the change did not touch it.
  This is the discipline the skill's checkpoint watches for — the Rejected-as-scope-creep list correctly excluded untouched code.
- **Ship-stage release-PR merge distinguished `IN_PROGRESS` from the empty-rollup case.**
  `release_pr_merge` returned `UNSTABLE`; `statusCheckRollup` showed an `IN_PROGRESS` `check`, so I waited three poll cycles for it to finish and retried `release_pr_merge` rather than falling back to `gh pr merge --rebase` (which the prompt reserves for the empty-rollup `GITHUB_TOKEN` case).
  Correct branch of the step-6.4 decision tree.

#### What caused friction (agent side)

- `other` — SHA over-verification in the ship stage.
  Ran `git rev-parse ... | wc -c` three times to re-confirm 40-char length on the HEAD SHA and both `fix:` commit SHAs before pasting them into `ci_find` / the close comment.
  Impact: a few redundant tool calls, no rework — the prompt's "never hand-type a SHA" rule was satisfied on the first `git rev-parse`; the length re-checks added nothing.

#### What caused friction (user side)

- None.
  The two `ask_user` gates (PR-review direction; planning guideline-order) each resolved a genuine decision in one exchange; no correction or redirect was needed.

### Diagnostic details

- **Model-performance correlation** — both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) ran on `anthropic/claude-sonnet-5`, appropriate for their judgment-heavy read-only work (design assessment, quality gate).
  No mismatch.
- **Feedback-loop gap analysis** — verification ran incrementally: `pnpm run check` immediately after Cycle 1's `AgentConfig` interface change, per-file `vitest run` on each red→green, and the full `check`/`lint`/`test`/`fallow` sweep after the last step.
  No end-only-verification gap.
- **Escalation-delay / unused-tool** — no `rabbit-hole` or `missing-context` friction; the release-PR `IN_PROGRESS` polling (3 cycles) was expected waiting, not a stuck loop.
  Nothing to flag.

### Changes made

1. Appended this Final Retrospective stage entry to `packages/pi-subagents/docs/retro/0594-complete-exclude-disabled-agents-tool-description.md`.
   No `AGENTS.md` or prompt changes — the session surfaced no actionable rule gaps (operator confirmed retro-file-only).
