---
issue: 287
issue_title: "Thin runGateCheck via a SessionApproval value object and SessionRules.record"
---

# Retro: #287 — Thin `runGateCheck` via a `SessionApproval` value object and `SessionRules.record`

## Stage: Planning (2026-05-31T00:00:00Z)

### Session summary

Planned the decomposition of `runGateCheck` in `src/handlers/gates/runner.ts`.
The plan rejects the issue's original "extract three phase helpers" approach as procedure-splitting and instead targets the real design smells: a behaviorless `sessionApproval` union, the runner doing the session store's bookkeeping scalar-by-scalar, and duplicated decision-event construction.
The committed plan introduces a `SessionApproval` value object, a `SessionRules.record(approval)` tell that absorbs the per-pattern loop, and a pure `buildDecisionEvent` helper; `runGateCheck` thins as a consequence.
Issue #287 was amended (title + body) to match this framing.

### Observations

- The user drove a Socratic redesign across several rounds, rejecting in turn: (1) the three free helpers (`emitSessionHit`/`recordSessionApprovals` are side-effect-only relocations), (2) exported helpers + unit tests (mock-call assertions duplicate the integration suite), and (3) a `GateEvaluation` command object ("two methods and one is a constructor — a function in a class trenchcoat"; the per-call evaluation is transient, not stateful).
- The converged insight: the genuinely stateful object is `SessionRules` (lives for the session, queried + mutated), and the missing value object is `SessionApproval` (the `{ pattern } | { patterns }` union interrogated in both phase 3 and phase 6).
  Tell-Don't-Ask = tell the store to `record(approval)`; let the value object own the union.
- Key scope decision: this reshapes internal seams (`GateRunnerDeps.approveSessionRule` → `recordSessionApproval`, `GateDescriptor.sessionApproval` → `SessionApproval`, `PermissionSession`, `SessionRules`) and all five gate producers + ~8 deps-mock test files.
  Wider than the issue's original "internal decomposition," so the issue was amended rather than silently exceeded.
- `applyPermissionGate` / `permission-gate.ts` deliberately kept unchanged — it retains its single `{ surface; pattern }` seam and the runner adapts via `SessionApproval.toGateApproval()`.
  This contains the blast radius.
- Lift-and-shift chosen for the test churn: keep `SessionRules.approve(surface, pattern)` as the internal primitive so `session-rules.test.ts` is not rewritten; the type-forced cutover (descriptor type + deps reshape) is one mechanical commit because TypeScript breaks every producer, the runner, and every deps-mock simultaneously.
- The original first draft of the plan (the rejected three-helper version) was overwritten in place before commit, so only the converged plan is in history.
- Deferred to Open Questions: lifting phase-1 check resolution onto the descriptor — revisit only if `fallow` still flags `runner.ts` after step 3.

## Stage: Implementation — TDD (2026-05-31T02:00:00Z)

### Session summary

Completed all four TDD steps: (1) added `SessionApproval` value object and `SessionRules.record`; (2) executed the type-forced cutover reshaping `GateDescriptor.sessionApproval`, `GateRunnerDeps.recordSessionApproval`, `PermissionSession`, five gate producers, and ~10 test files; (3) added `buildDecisionEvent` to `helpers.ts` and routed both `runner.ts` emit sites through it; (4) updated `architecture.md`.
Test count went from 1553 → 1571 (+18 new tests across `session-approval.test.ts`, `session-rules.test.ts`, and `helpers.test.ts`).
Pre-completion reviewer: PASS.

### Observations

- The plan's blast-radius estimate was accurate: the type-forced cutover (step 2) touched 5 producers + ~10 test files but was fully mechanical — no logic changes, just rename and constructor swap.
- Three producer tests (`external-directory.test.ts`, `path.test.ts`, `tool.test.ts`) had assertions using the old `toHaveProperty("pattern")` shape on `sessionApproval`; updated to `?.surface` / `?.representativePattern` access which is clearer.
- Four `bash-external-directory.test.ts` sites cast `desc.sessionApproval as { patterns: string[] }` — the Biome/ESLint `noNonNullAssertion` / `non-nullable-type-assertion-style` conflict forced an explicit `if (!desc.sessionApproval) return` guard (per AGENTS.md resolution).
- The `eslint-disable` comment on `matchedPattern ?? null` was correctly omitted in `buildDecisionEvent` — with the narrowed `Pick` parameter type, ESLint no longer fires `no-unnecessary-condition` on that line.
- Post-review cleanup: the phase-6 guard `gateResult.action === "allow" && hasSessionApproval` had a redundant term since `hasSessionApproval` already implies the action check; simplified to `if (hasSessionApproval && descriptor.sessionApproval)`.
- `fallow health --targets` confirms `runner.ts` is no longer in the refactoring targets list; 4 → 3 targets remaining.

## Stage: Final Retrospective (2026-05-31T03:00:00Z)

### Session summary

Shipped #287 end-to-end across planning, TDD, and ship stages: a `SessionApproval` value object, `SessionRules.record(approval)`, and a `buildDecisionEvent` helper that together thinned `runGateCheck` and dropped `runner.ts` from the refactoring-target list (4 → 3).
Released as `pi-permission-system-v8.2.0`; +18 tests (1553 → 1571); pre-completion reviewer PASS.
The defining event was a planning-stage design correction: the agent first planned the issue's literal "extract three helpers" before the user's four Socratic questions surfaced that it was procedure-splitting.

### Observations

#### What went well

- The type-forced cutover (TDD step 2) touched ~17 files in a single commit and compiled/passed essentially first try, because the planning stage had mapped every call site (`grep` for `approveSessionRule` / `sessionApproval` / `SessionRules.approve` across `src` and `test`) before writing the plan.
  Thorough call-site mapping during planning is what made a 17-file reshape mechanical rather than iterative.
- The lift-and-shift decision to keep `SessionRules.approve(surface, pattern)` as an internal primitive (adding `record(approval)` alongside) meant `session-rules.test.ts` was never rewritten — only extended.
- The Biome/ESLint `!`-vs-`as` conflict on the four `bash-external-directory.test.ts` cast sites was recognized as the documented `AGENTS.md` conflict and fixed with the prescribed `if (!x) return` guard — the rule worked without user intervention.
- Verification ran incrementally (`check` / `lint` / `test` after each TDD step, plus a scoped `grep "error TS"` to bound the cutover), not just at the end.

#### What caused friction (agent side)

- `instruction-violation` (user-caught) — the planning stage did not load `code-design` or `design-review` before evaluating the issue's proposed approach, despite the plan-issue prompt's "Load skills" section listing both.
  It planned the issue's literal "extract three helpers," wrote the full plan to disk, and only the user's four Socratic interventions ("they have side effects?" → "pushing dirt around, what's the missing collaborator?" → "where's the stateful object?" → "a function in a class trenchcoat") surfaced that the decomposition was procedure-splitting.
  Impact: first plan draft discarded and rewritten; issue #287 amended (title + body); four rounds of planning-conversation rework — but entirely pre-code, so zero implementation churn.
- `wrong-abstraction` — within the wrong frame, the first `ask_user` (entry 10) asked about helper *visibility* (export vs. private) before establishing whether the helpers should exist at all.
  Impact: one wasted decision-gate round; folded into the larger redesign above.
- The `design-review` skill's load trigger ("if the plan adds fields to shared interfaces or touches wiring between layers") is chicken-and-egg: the *first* (wrong) plan touched no wiring, so the condition could not fire; only the *correct* design reshaped `GateRunnerDeps` / `PermissionSession` / `SessionRules`.
  The trigger gates on a plan property that only becomes true after the design judgment that needs the skill.

#### What caused friction (user side)

- The user carried the entire design correction through four rounds of Socratic questioning.
  This worked well and the converged design is genuinely better, but it was the user doing the design thinking the planning stage is meant to do.
  Opportunity: the same outcome is reachable agent-side by loading `code-design` and testing the issue's proposed decomposition against its Law-of-Demeter / Tell-Don't-Ask heuristics before writing the plan.

### Diagnostic details

- **Model-performance correlation** — Planning ran on `claude-opus-4-8` (appropriate for the judgment-heavy redesign); TDD on `claude-sonnet-4-6` (appropriate); Ship on `opencode-go/deepseek-v4-flash` (mechanical git/CI/release steps — appropriate low-cost match, executed cleanly).
  No quality mismatch: the design judgment that faltered was on the high-capability model, so the miss was a skill-loading gap, not a model-capability gap.
- **Feedback-loop gap analysis** — No gaps; `check`/`lint`/`test` ran after each step, and a scoped `grep "error TS"` (entries 68–69) bounded the cutover before editing.
  No `rabbit-hole` sequences (longest same-file run was reading large test files in chunks, not error-thrashing).

### Changes made

1. `.pi/prompts/plan-issue.md` ("Decide" section) — added a "treat the issue's Proposed change as a hypothesis, not a spec" rule that names the procedure-splitting anti-pattern and requires verifying each prescribed extraction returns a value, owns state, or gives behavior to data (against `code-design`) before planning around it.
2. `.pi/prompts/plan-issue.md` ("Load skills" section) — reworded the `design-review` load trigger to fire for any refactor/extraction/shared-interface/layer-wiring change judged from the issue, not from a plan that already shows wiring changes (fixes the chicken-and-egg trigger).
