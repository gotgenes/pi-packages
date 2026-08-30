---
issue: 844
issue_title: "pi-permission-system: a forwarded denial decided by the parent's rule or a gate error is rendered to the child's agent as the user's denial"
---

# Retro: #844 — a forwarded denial decided by the parent's rule or a gate error is rendered to the child's agent as the user's denial

## Stage: Planning (2026-08-30T18:09:02Z)

### Session summary

Traced the forwarded decision end to end before designing, put the ADR 0011 §6 disclosure question and the render's locality wording to the operator, discovered mid-gate that the new render's reason clause had no producer and gated that scope question too, ran the Tidy-First assessor, and wrote a six-step plan.
The plan adds two arms to `renderRefusal` (`rule`, `gate_error`), carries the serving node's deny-with-reason text across the hop, and records the disclosure boundary as a numbered ADR 0011 section.

### Observations

- **The information the design needed was already at the call site.**
  The operator's follow-up on "derive it from the forwarding frame" — *do we send enough information to do this?*
  — was the right question and the answer was yes.
  `renderRefusal`'s second argument **is** the outer `{ kind: "forwarded", … }` frame; `effectiveDecider` discards it on the function's first line.
  Traced all seven hops (`resolveDecision` → response file → `readForwardedPermissionResponse` → `relayDecision` → `authorizer-selection` → `applyPermissionGate` → `runner.ts:194`) and confirmed nothing between rewrites `decidedBy`.
  Worth generalizing: before planning to plumb a fact, check whether the consumer already receives it and throws it away.
- **The disclosure question was smaller than [#772] framed it.**
  The parent's rule facts already cross the hop and are already persisted in the **child's own** review log (`permission-prompter.ts` writes `decidedBy` on the denied entry).
  So the decision was never "may these facts cross a node boundary" but "may they reach the agent's context", which `renderPolicyDenial` already answers affirmatively for a local deny.
  Operator chose to name the serving rule's pattern and withhold its `origin` scope and the responder session id.
- **A gate on the render exposed a gap at the producer.**
  Writing the worked example revealed that `resolveDecision` never copies `check.reason`, so the new arm's reason clause had no producer and would have shipped permanently empty.
  Operator folded the one-line carry into this plan rather than a follow-up.
  The lesson is the cheap one: render the sentence with real values at planning time, and any clause that cannot be filled names a missing producer.
- **The roadmap's own Outcome metric does not discriminate.**
  Step 15 predicts `grep -c 'case "rule"' agent-renderer.ts` goes 0 → ≥ 1; measured baseline is **1**, because [#772]'s fall-through group already lists `case "rule":`.
  Replaced in the plan with `grep -c 'renderEscalatedPolicyDenial'` (measured 0, predicted 2).
  Confirms the AGENTS rule about running a roadmap's recompute command at planning time rather than trusting the prose.
- **The Tidy-First assessor's rejection was half right, and reading the reasoning paid.**
  It recommended hoisting `ruleClause(payload)` out of `identification()` and appending it at the four call sites — correct about the friction, but the append-at-call-site form has a double-space hazard where `renderUnavailableDenial` embeds `identification` mid-sentence, so the plan passes the clause as a parameter instead.
  It separately **rejected** generalizing `ruleClause` to take a pattern, on the grounds that the `rule` decider carries no `commandContext`.
  That holds for the pattern (from the decider) but not for the context (from the payload either way), so the generalization is the shared shape rather than an invented discriminator, and dropping it would have silently lost `inside a command substitution` from the new render.
- **Scope held to two `src/` files.**
  `decision-source.ts` needs no change: `effectiveDecider` already returns what the dispatch wants, and no new `DecisionSource` variant is introduced.
  The local fail-closed boundary (`tool-call-boundary.ts`) renders its own message and never routes through `renderRefusal`, so it stayed out.
- **Sequencing choice:** the ADR amendment is step 2, ahead of the code, so the disclosure boundary is written down before it is implemented and the render steps are reviewable against it.
  The three behavior steps are `fix:`, so the merge cuts a release; Phase 14 Step 15 is `Release: independent`.

#### Deferred tidyings

- `test/presentation/agent-renderer.test.ts` — restructuring the flat per-function `describe` blocks into a nested unit/scenario tree.
  Assessor rejected as scope creep: the flat-by-function shape is exactly what two new sibling `describe`s fit into, and there is no repeated-prefix smell to fix.
- `test/handlers/gates/runner.test.ts` — migrating the file's inline `kind: "forwarded"` `DecisionSource` literals to named fixtures in `decision-fixtures.ts`.
  Assessor rejected: the file already mixes named fixtures with one-off inline literals for forwarded cases, and the new assertions follow the established convention rather than justifying a shared constant.
