---
package: pi-permission-system
phase: 13
---

# Retro: pi-permission-system — Phase 13 Planning (prompt-presentation-seam)

## Stage: Improvement Planning (2026-08-15T04:49:40Z)

### Session summary

The cause hypothesis formed from the architecture doc's `Prompt presentation` section and [ADR 0011] was structural fusion of presentation with decision-making: five sites assemble a flat prompt `message` at the point of decision, so elision is a property of the payload rather than of a render — which is why the bash branch has no cap, nothing bounds height ([#710]), a forwarded ask is assembled twice under two configs, and every denial echoes unbounded input into the agent's context.
The trace through `formatAskPrompt` → `PromptPermissionDetails.message` → dialog / broadcast / review log / forwarded wire confirmed the hypothesis without refinement, and ADR 0011's Staging section had already assigned this decomposition to this planning pass.
The phase shape chosen is **full**: a four-step spine implementing the payload and renderer seam, plus four parallel steps (forwarding liveness, decision provenance, and two small fixes) selected by the user from the candidate tracks.

### Observations

- **The declared candidate was an ADR, not a history-file line.**
  Phase 12's history file recorded no leading Phase 13 candidate and no ⚠️ metric miss (every target met), so the usual carrier was empty.
  The candidate lived in `architecture.md`'s `Prompt presentation` section and in ADR 0011 — accepted the day after Phase 12 archived, with an explicit "the concrete issues are filed by the next `/plan-improvements` pass" assignment.
  Worth noting for future passes: an ADR accepted between phases is a first-class declared-candidate carrier alongside the history file.

- **The cause was decided before discovery ran, which made discovery cheap.**
  ADR 0011 had already measured the blast radius (`pi-permission-model-judge` reads `accessIntent.surface`/`surface`/`path`/`value`, never `message`), verified the host's rendering behavior against the sibling Pi checkout, and surveyed prior art in Codex and Claude Code.
  Discovery's job reduced to corroboration and step decomposition rather than re-deriving the cause — the settled-in-writing-directions payoff the `improvement-discovery` skill predicts.

- **Fallow corroborated without setting the agenda.**
  Health 88 (A), dead code 0, duplication 0.2%; the discriminator sweep found no new family.
  None of the spine's four steps trace to a fallow signal — fallow's only novel finding was a 16-line internal clone in `token-collection.ts`, which did not earn a step.
  The `value-guards.ts` refactoring target was rejected for the fourth consecutive phase (healthy high-fan-in leaf); it may be worth suppressing rather than re-adjudicating each pass.

- **The scout's concentrated finding landed inside the spine rather than beside it.**
  Six duplicated local test factories (`PermissionCheckResult` builders, `ToolPreviewFormatter` options) sit in exactly the three presentation test files Step 1 rewrites.
  Rather than a separate step, it became Step 1's tidy-first prep commit — make the change easy, then make the easy change.
  All three fallow giant-test flags were re-refuted, matching Phase 12; the flags recur every phase because fallow counts a whole top-level `describe` as one function.

- **A metric name collided with existing prose.**
  The first draft of Step 5's metric grepped for `liveness` in `src/authority/`, which already returns 1 from a comment in `authorizer-selection.ts`.
  Switched to a predicted module path (`authority/forwarding-liveness.ts`) and recorded the predicted-name warning on the roadmap, so a rename during implementation must update the metric row in the same commit.
  Running every recompute command before committing caught this; it would otherwise have silently broken `/finish-phase`'s delivered-vs-predicted check.

- **An inherited dangling reference surfaced during link verification.**
  `[#645]` was referenced in the authority-model section with no `[#645]:` definition — `rumdl`'s MD053 flags unused definitions but not missing ones, so it had passed lint silently since it was introduced.
  Added the definition while in the file.

- **Deferral dispositions, all user-decided rather than self-made.**
  [#620] deferred with rationale (one phase old, non-gating, the `registerAuthorizer` seam it consumes exists; [#698] and [#706] fold into it when scheduled).
  [#519] kept open with rationale (genuinely blocked on Pi SDK `UIContext` evolution; a repeat deferral, so it got an explicit decision rather than a silent re-defer).
  [#639] deferred (first sweep since filing; its policy-model design budget does not fit alongside the presentation spine).
  [#742] swept out by composition decision and flagged in the roadmap as a strong next-phase candidate — it is the last member of the #306/#741 nested-command bypass family, and leaving it unflagged would have made it easy to lose.

- **Six of the eight steps adopted existing issues.**
  Only Steps 1, 3, and 4 needed new issues ([#744], [#745], [#746]); Steps 2, 5, 6, 7, 8 adopted [#710], [#721], [#726], [#732], [#655] under their existing numbers.
  [#710] in particular is the symptom whose cause ADR 0011 names, so adopting it as the renderer step keeps the bug report and its structural fix on one number.

- **A cross-step file collision was caught at planning time.**
  Step 3 and Step 5 both edit `src/authority/approval-escalator.ts`.
  Recorded on both the parallel-tracks section and Step 3's issue body as a sequencing note, so whichever lands second rebases rather than discovering the conflict mid-implementation.

- **Feasibility probes.**
  Step 2's row-budget config field follows the established `config-schema.ts` → `extension-config.ts` → `mergeUnifiedConfigs()` path (the #332/#347 drop class) — no new SDK surface required.
  ADR 0011 had already verified the host-rendering claims against the sibling Pi checkout at `../pi` (`9d2ec7ffa`), so no re-probe was needed for the renderer step.

- **Trajectory.**
  Phase 12's maximum step priority was 20; Phase 13's is also 20 (Step 1).
  No decline and no cooling of the relevant area, so the regular improvement rotation continues rather than moving to trigger-driven planning.

[ADR 0011]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/decisions/0011-prompt-presentation-contract.md
[#519]: https://github.com/gotgenes/pi-packages/issues/519
[#620]: https://github.com/gotgenes/pi-packages/issues/620
[#639]: https://github.com/gotgenes/pi-packages/issues/639
[#655]: https://github.com/gotgenes/pi-packages/issues/655
[#698]: https://github.com/gotgenes/pi-packages/issues/698
[#706]: https://github.com/gotgenes/pi-packages/issues/706
[#710]: https://github.com/gotgenes/pi-packages/issues/710
[#721]: https://github.com/gotgenes/pi-packages/issues/721
[#726]: https://github.com/gotgenes/pi-packages/issues/726
[#732]: https://github.com/gotgenes/pi-packages/issues/732
[#742]: https://github.com/gotgenes/pi-packages/issues/742
[#744]: https://github.com/gotgenes/pi-packages/issues/744
[#745]: https://github.com/gotgenes/pi-packages/issues/745
[#746]: https://github.com/gotgenes/pi-packages/issues/746
