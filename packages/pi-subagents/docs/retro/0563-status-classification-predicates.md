---
issue: 563
issue_title: "Status classification predicates are re-derived outside SubagentState"
---

# Retro: #563 — Status classification predicates are re-derived outside SubagentState

## Stage: Planning (2026-07-18T00:00:00Z)

### Session summary

Planned the extraction of status classification predicates into `subagent-state.ts` as the single decision point, replacing ~11 re-derived multi-status groupings across 8 files.
The design pairs exported free functions (`isActiveStatus`, `isTerminalErrorStatus`, `isRunningStatus`) over `SubagentStatus` for methods-less DTO consumers with delegating instance methods (`isActive`, `isTerminalError`, `isRunning`, `canBeSteered`) on `SubagentState` and `Subagent` for record holders.
Committed the plan as `docs/plans/0563-status-classification-predicates.md`; four TDD cycles (`refactor:`-typed), ship independently.

### Observations

- The architecture roadmap (Phase 21, Step 1) had already settled most of the design — instance predicates plus exported status-level functions, delegating — so the plan mostly confirms and sequences it.
- Two genuine forks the roadmap left open were surfaced via `ask_user` and answered by the operator: (1) model the `=== "running"` sites as **both** `canBeSteered()` (steer) and `isRunning()` (abort + streaming), delegating to one `isRunningStatus`; (2) **tighten** the two `string`-typed presentation DTOs (`NotificationDetails.status`, `WidgetAgent.status`) to `SubagentStatus` and convert their groupings too — reaching **0** residual rather than the roadmap's ≤ 2.
- Key trap avoided: `ERROR_STATUSES` (display.ts) looks like the terminal-error grouping but includes `steered` and is a widget-linger presentation set — a different semantic; the plan explicitly does **not** unify it with `isTerminalError()`.
- `resolveStatusPresentation` and `getStatusLabel` stay as presentation dispatch; only the `isError` _classification_ inside `resolveStatusPresentation` routes through a predicate.
- DTO tightening is producer-safe: both loose fields come straight from `record.status`; `AgentDetails.status`'s extra `"background"` variant never reaches them, so it is untouched.
- The `resolveStatusPresentation("unknown")` test becomes a type error once the parameter tightens — planned for removal (out-of-domain fallback is unreachable under the tightened type).
- Skill references to the grouping (`improvement-discovery`, `code-design`) are generic teaching exemplars, not this package's code — no skill edits needed.

## Stage: Implementation — TDD (2026-07-18T23:05:00Z)

### Session summary

Implemented all four planned cycles: added the predicate surface (three exported `is*Status` functions + four delegating instance methods on `SubagentState`/`Subagent`), converted the record-holding consumers, tightened the two presentation DTOs and converted their groupings, and landed the architecture-doc step-mark.
Test count went 1036 → 1063 net (+28 new table-driven predicate tests in `subagent-state.test.ts`, −1 for the removed `resolveStatusPresentation("unknown")` case).
Full suite green, `tsc` clean, root lint clean, `fallow dead-code` clean; pre-completion reviewer returned PASS.

### Observations

- The Tidy-First assessor found no preparatory work warranted — every site was already a one-line boolean and `Subagent` already had a getter-delegation convention the new methods slotted into.
- One quantitative deviation surfaced and was reconciled via `ask_user`: the plan's prose claimed "reaching 0" residual groupings, but the roadmap's authoritative metric target is `≤ 2`, and the health-metric grep lands at exactly 2.
  Both residuals are deliberately out-of-scope per the plan's own Non-Goals — `result-renderer.ts`'s `completed || steered` presentation renderer arm and `get-result-tool.ts`'s `=== "running"` wait guard (a single-status guard the coarse grep false-matches via `&& record.promise`).
  The plan was internally inconsistent (Non-Goals kept 2 sites while the metric claim said 0); recorded the honest value 2 rather than forcing 0 by converting excluded presentation code.
- The three targeted groupings (is-active, terminal-error, is-running/steer) are fully eliminated outside `subagent-state.ts`.
- DTO tightening (`NotificationDetails.status`, `WidgetAgent.status` → `SubagentStatus`) was producer-safe as predicted; `tsc` confirmed no stray non-`SubagentStatus` producer, and the `shouldShowFinished` `string` callback chain absorbed the tightened type with no change.
- All existing consumer tests stayed green through Cycles 2–3 with no fixture edits — behavior was genuinely unchanged, confirming the refactor's safety net.
- Pre-completion reviewer: PASS (no WARN findings).
  `mmdc` validated all 6 Mermaid blocks including the edited `S1` node.
- The plan touched no `background-spawner.ts` / `agent-widget.ts` despite the roadmap's Target-files listing them — correct, since their status checks are single-status presentation (Non-Goals).

## Stage: Final Retrospective (2026-07-22T18:39:54Z)

### Session summary

All three stages (plan, TDD, ship) executed cleanly for a pure refactor: predicates extracted to `subagent-state.ts`, all consumers converted, two presentation DTOs tightened, +27 net tests, reviewer PASS, shipped to `main` with no release (all-hidden/excluded commits auto-batch).
The one recurring friction was a planning-time quantitative claim ("reaching 0 residual groupings") that contradicted both the roadmap's authoritative `≤ 2` target and the plan's own Non-Goals — self-caught during TDD when the metric grep returned 2.

### Observations

#### What went well

- The `ERROR_STATUSES` trap catch at planning: recognizing it is a widget-linger presentation set (includes `steered`) with a different semantic from `isTerminalError()` (`error`/`stopped`/`aborted`) prevented a subtle behavior-changing over-unification in a "pure refactor."
- Incremental verification cadence: `pnpm run check` after each interface-changing cycle, per-file `vitest` at every Red/Green, full suite + root lint + `fallow dead-code` only at the end — every cycle left the tree green with zero fixture churn, confirming the refactor's safety net.
- Two well-scoped `ask_user` gates (planning forks; TDD metric reconciliation) kept the operator in the loop on the genuinely ambiguous decisions without ceremony on the mechanical ones.

#### What caused friction (agent side)

- `missing-context` (self-identified) — the plan claimed the DTO-tightening path "reaches 11 → 0" (in both the `ask_user` option text and the plan prose), but the roadmap's authoritative metric target was `≤ 2` and the plan's own Non-Goals explicitly kept 2 sites (`result-renderer.ts`'s `completed || steered` presentation arm; `get-result-tool.ts`'s `=== "running"` wait guard, which the coarse grep false-matches via `&& record.promise`).
  The roadmap supplied the exact recompute grep, but it was never run at planning time to ground the predicted number — the "0" was inferred from prose.
  Impact: one `ask_user` reconciliation round in TDD plus honest re-documentation of the metric row (`≤ 2 → 2 ✅`) and the Step-1 `Landed:` note.
  No rework, no bad commits.

#### What caused friction (user side)

- None.
  The operator's planning-stage answers were decisive and correct; the over-promised "0" originated in the agent's `ask_user` option framing ("Reaches 11 → 0"), not in any user input — nothing for the user to do differently.

### Diagnostic details

- **Model-performance correlation** — both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) ran on `claude-sonnet-5`, correctly matched to judgment-heavy read-only work; no reasoning-weak-on-judgment or high-cost-on-mechanical mismatch.
  Main-session model switches across stages were operator-driven.
- **Escalation-delay tracking** — no `rabbit-hole` friction; no error sequence exceeded a single tool call.
- **Unused-tool detection** — no `missing-context`/`rabbit-hole` gap a subagent or search tool would have closed; `colgrep`/`grep` were used appropriately in planning exploration.
  The one gap (running the roadmap's recompute grep at planning) is a habit, not a missing tool.
- **Feedback-loop gap analysis** — verification was incremental throughout, not end-loaded; no gap.

### Changes made

1. `.pi/prompts/plan-issue.md` — added a rule (adjacent to the existing static-analysis-finding rule in Module-Level Changes): run the roadmap's supplied recompute command at planning time to ground a metric's predicted value, and reconcile it against the sites the plan's Non-Goals deliberately keep, rather than inferring the number from prose (Refs #563).
