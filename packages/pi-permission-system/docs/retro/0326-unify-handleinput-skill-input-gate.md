---
issue: 326
issue_title: "Unify handleInput's skill-input gate with the GateRunner pipeline"
---

# Retro: #326 — Unify `handleInput`'s skill-input gate with the `GateRunner` pipeline

## Stage: Planning (2026-06-02T00:00:00Z)

### Session summary

This session began as planning for #325 but pivoted.
Investigating #325's "residual cluster" decomposition (with the user steering toward Tell-Don't-Ask and "make the change that makes the change easy") surfaced that #325 is awkward only because `PermissionGateHandler` carries a wide, anemic dependency on the concrete `PermissionSession`.
Two preparatory refactors were identified and filed — #326 (unify `handleInput` with `GateRunner`) and #327 (extract a `ToolCallGatePipeline`) — and sequenced ahead of #325 in `docs/architecture/architecture.md` (Phase 3 Steps 9–11; downstream steps renumbered, diagram + tracks updated).
This planning session then produced the numbered plan for #326, the first pivot target.

### Observations

- **`handleInput` fully reduces to the runner.**
  The bespoke `applyPermissionGate` block, the eslint-disabled nested resolution ternary, and the manual `emitDecision` all map onto `GateRunner.runDescriptor` + `deriveResolution`.
  Confirmed the six resolution values (`policy_allow`, `policy_deny`, `auto_approved`, `user_approved`, `user_denied`, `confirmation_unavailable`) are reproduced exactly, so `input-events.test.ts` should pass unchanged.
- **`preCheck` preserves raw semantics.**
  `handleInput` resolves via `checkPermission` (no session ruleset), so `preCheck.source` is never `"session"` and the runner's session-hit branch is unreachable — the unification stays behavior-preserving on resolution.
  Whether skill input *should* honor session rules is left as a tracked open question, not changed here.
- **One deliberate behavior change.**
  Block-reason messages move from ad-hoc tag-less strings to runner-formatted ones (a new `skill_input` `DenialContext` kind), gaining the `[pi-permission-system]` tag like every other surface.
  Not asserted by any input test; surfaced only in the review log.
  Flagged in the issue and the plan.
- **Scope boundaries held.**
  Issue #326 does **not** change the handler constructor or drop the `as unknown as PermissionSession` casts (that is #325), and does **not** tighten the `PermissionSession` API or touch `handleToolCall` (that is #327).
  The concrete-session mocks stay.
- **TDD shape.**
  Two commits: (1) additive `skill_input` denial context + formatter tests; (2) factory + `handleInput` rewrite + consumer-test updates folded together so the new `describeSkillInputGate` has a `src` consumer immediately (no dead-code window for fallow).
- **Known test edit.** `input.test.ts`'s "passes agentName…" assertion uses `expect.anything()` for the prompt's first arg; prompting now flows through the context-bound `promptPermission(details)`, so that one assertion must retarget `session.promptPermission`.
- **Process note.**
  Per the user's direction, this is a recursive "discover → note in architecture.md → file issues → backtrack" loop; expect further smells (e.g. the `ToolCallGatePipeline` shape in #327, and the `index.ts` composition root in #320) to be refined as those issues are planned.

## Stage: Implementation — TDD (2026-06-02T23:20:00Z)

### Session summary

Completed two TDD cycles in order.
Step 1 added the `skill_input` variant to `DenialContext` and its three switch cases in `buildDenyBody`, `buildUnavailableBody`, and `buildUserDeniedBody`, with 5 new tests in `test/denial-messages.test.ts`.
Step 2 created `src/handlers/gates/skill-input.ts` (`describeSkillInputGate` pure factory, 10 unit tests), rewrote `handleInput` to delegate to `this.runner.run(...)`, removed the inline `applyPermissionGate` block and the nested resolution ternary, and updated the one `input.test.ts` prompt assertion to target `session.promptPermission`.
Test count went from 1781 to 1796 (+15).

### Observations

- **`input-events.test.ts` passed unchanged**, confirming the runner reproduces all six resolutions (`policy_allow`, `policy_deny`, `user_approved`, `user_denied`, `auto_approved`, `confirmation_unavailable`) identically.
- **Single prompt-assertion fix in `input.test.ts`** was exactly as anticipated: the `expect.anything()` first argument was replaced by `session.promptPermission(details)` with no second argument.
- **No dead-code window**: `describeSkillInputGate` was introduced in the same commit as the `handleInput` rewrite, satisfying the fallow constraint.
- **`applyPermissionGate` and `formatSkillAskPrompt` cleanly removed** from `permission-gate-handler.ts`; lint passed on first run.
- **Pre-completion reviewer: PASS** — one WARN note that `architecture.md` step 9 lacks the ✅ prefix; reviewer confirmed this is intentional (the project pattern defers ✅ updates to post-ship).

## Stage: Final Retrospective (2026-06-02T23:45:00Z)

### Session summary

The TDD implementation landed both planned cycles cleanly — three commits (`feat: add skill_input denial context`, `refactor: route handleInput skill-input gate through GateRunner`, `docs(retro): add TDD stage notes`), +15 tests (1781 → 1796), pre-completion reviewer PASS, zero deviations from the plan.
The only friction was behavioral, not technical: the agent repeatedly ended its turn after `Edit`/`Write` calls, requiring three user nudges to keep the cycle moving.

### Observations

#### What went well

- **Plan-prediction discipline paid off end to end.**
  The plan's single "Known test edit" note (retarget `input.test.ts`'s `expect.anything()` assertion to `session.promptPermission`) materialized exactly as written, and `input-events.test.ts` passed unchanged — confirming behavior preservation with no surprises across either cycle.
  A notably clean plan→execution match: every red→green→commit step worked first try.

#### What caused friction (agent side)

- `other` — premature turn termination after `Edit`/`Write` tool calls.
  Turns 19, 23, and 32 were empty assistant turns where the agent stopped instead of continuing the Red→Green→Commit cycle.
  Root cause: the active `pi-autoformat` extension injects a `[pi-permission-system]`-style `[pi-autoformat] Formatted N file(s)` user-role message after each `Edit`/`Write`; the agent (running `anthropic/claude-sonnet-4-6`) interpreted that injected message as a turn boundary and yielded.
  Impact: the user intervened three times — `Continue.` (turn 20), `Continue.` (turn 24), and the diagnostic `I would like you to continue until we've met the expectations of the plan. I'm not sure why we keep ending work at edits or writes.` (turn 33).
  Added friction, no rework — the work itself was clean.
  User-caught, not self-identified.

#### What caused friction (user side)

- The first two nudges (`Continue.`) were minimal; the third (turn 33) added the diagnostic framing that surfaced the real question.
  Opportunity, not criticism: leading with `why are you stopping after edits?` after the first stall would have surfaced the `pi-autoformat`-injection root cause two turns earlier.

### Diagnostic details

- **Model-performance correlation** — TDD turns ran on `anthropic/claude-sonnet-4-6` (appropriate for mechanical TDD); the `pre-completion-reviewer` subagent ran judgment-heavy review (323.6s, 45 tool uses) under its own frontmatter model; this retro runs on `anthropic/claude-opus-4-8` (appropriate for synthesis).
  A transient `model_change → opencode-go/deepseek-v4-flash` after the TDD summary had no assistant turn under it — it never ran and is not counted.
  No mismatches.
- **Feedback-loop gap analysis** — exemplary, no gap.
  Tests ran after every Red and Green phase; the full `check` / `lint` / `test` / `fallow dead-code` gate ran after the last step.
  Verification was incremental, not end-loaded.
- Escalation-delay and unused-tool lenses found nothing notable (no rabbit-holes; all file reads front-loaded at turns 11–15 before editing).

### Changes made

1. `AGENTS.md` — added a `### Tool-injected messages` subsection under `## Workflow`: the `pi-autoformat` `Formatted N file(s)` message is informational, not a turn boundary, so the agent continues the current step instead of yielding.
2. `packages/pi-permission-system/docs/retro/0326-unify-handleinput-skill-input-gate.md` — this Final Retrospective stage entry.
