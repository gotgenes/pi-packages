---
issue: 598
issue_title: "pi-permission-system: Authorizer chain infrastructure (allow/deny/defer verdicts)"
---

# Retro: #598 — Authorizer chain infrastructure (allow/deny/defer verdicts)

## Stage: Planning (2026-07-18T00:00:00Z)

### Session summary

Planned Phase 12 Step 4 (Track B, batch "authorizer-chain" head): reshape the live-authority layer into a Chain of Responsibility per ADR 0007, with zero registered links so behavior is identical to today.
Produced `docs/plans/0598-authorizer-chain-infrastructure.md` with three commits — an atomic interface reshape + `composeAuthorizerChain`, a wiring step routing `AuthorizerSelection.activate` through the empty chain, and a doc-completion step.

### Observations

- **Terminal return type is the key reconciliation.**
  ADR 0007 sketches a minimal `TerminalVerdict` (`allow | deny` kind union), but the real terminals return the rich `PermissionPromptDecision` (session-scope states, `confirmationUnavailable`, `denialReason`).
  The "behavior identical" constraint forces keeping `PermissionPromptDecision` as the terminal's return; the ADR sketch is illustrative ("the essentials follow").
  Recorded as a Non-Goal so Step 5 doesn't re-litigate it.
- **Naming decision surfaced via `ask_user`.**
  The ADR reassigns the name `Authorizer` to the non-terminal link and introduces `TerminalAuthorizer` for the terminal, but today `Authorizer` **is** the terminal interface (3 concrete classes implement it).
  Operator chose the ADR-faithful rename over an additive `AuthorizerLink`, so Steps 5/6 inherit ADR vocabulary directly.
- **Empty-links identity is a behavioral invariant, not an optimization.**
  `composeAuthorizerChain([], terminal)` must return the terminal **instance** so `authorizer-selection.test.ts`'s `expect.any(LocalUserAuthorizer)` still holds.
  Called out in Design Overview + Invariants at risk.
- **`PermissionQuery` deferred to Step 5.**
  ADR 0007 §3 ties the injected query to the registration seam; a Step-4 link signature takes only `PromptPermissionDetails`.
  Step 5 will widen the link `authorize` signature — noted as an Open Question so it's not read as an oversight.
- **Release: mid-batch defer.**
  Step 4 is the batch "authorizer-chain" head (tail = Step 5, [#599]); the `docs:` step-completion commit lands in the pending release-please PR but must not be merged until Step 5 ships.
  `refactor:`/`test:` commits are `hidden:` and don't cut a release.
- **No follow-up issues filed** — Steps 5 (#599) and 6 (#600) already exist in the roadmap.

## Stage: Implementation — TDD (2026-07-19T10:05:00Z)

### Session summary

Implemented all three TDD cycles for Phase 12 Step 4: reshaped the live-authority layer into a Chain of Responsibility per ADR 0007 with zero registered links, so behavior is byte-identical.
Added `AuthorizerVerdict` + the non-terminal `Authorizer` / terminal `TerminalAuthorizer` split, the new `composeAuthorizerChain`, routed `AuthorizerSelection.activate` through the (empty) chain, and marked the roadmap step complete.
Test count 2499 → 2506 (+7 `composeAuthorizerChain` unit tests); full suite, `check`, root `lint`, and `fallow dead-code` all green.

### Observations

- **No preparatory tidying warranted.**
  The `tidy-first-assessor` found the interface split inherently atomic (repurposing the exported `Authorizer` type breaks every implementer/consumer at compile time simultaneously) with no length/coupling/duplication friction in the target files — proceeded directly to the cycle.
- **The plan held exactly.**
  All three commits landed as planned (`refactor:` / `refactor:` / `docs:`); every file in Module-Level Changes was touched and the two behavior pins (`authorizer.test.ts`, `authorizer-selection.test.ts`) stayed unchanged (zero-line diffs).
  No deviations.
- **Empty-links identity verified two ways.**
  `composeAuthorizerChain([], terminal)` returns the terminal instance, pinned both by the unchanged `authorizer-selection.test.ts` (`expect.any(LocalUserAuthorizer)`) and a dedicated `toBe(terminal)` unit test.
- **One tool-friction note:** an `Edit` to `architecture.md` was first denied by the `external_directory` gate because I used a wrong path (`.../pi-permission-system/docs/...` instead of `.../pi-packages/packages/pi-permission-system/docs/...`) — corrected on retry. (A live instance of exactly the typo-path class ADR 0007's future model judge targets.)
- **Pre-completion reviewer: PASS** — ready for `/ship-issue`.
  Reviewer reconfirmed the mid-batch defer: the `docs:` completion commit sits in the pending release-please PR unmerged until Step 5 (#599) ships.

## Stage: Final Retrospective (2026-07-19T15:17:13Z)

### Session summary

Shipped Phase 12 Step 4 across a single-process planning → TDD → ship sequence: the live-authority layer is now a Chain of Responsibility (ADR 0007) with zero registered links, so behavior is byte-identical.
Four commits landed exactly as planned, CI passed, #598 closed, and the release was correctly deferred (batch "authorizer-chain" head; tail = Step 5, [#599]).
An unusually clean run — the plan held with zero deviations and the pre-completion reviewer returned PASS on the first pass.

### Observations

#### What went well

- **The plan held with zero deviations.**
  Every file in Module-Level Changes was touched, the two behavior pins stayed at zero-line diffs, and the three TDD commits matched their planned messages and types.
  Front-loading the design reconciliation (terminal keeps `PermissionPromptDecision`; ADR-faithful rename via `ask_user`) into planning left nothing to re-decide during implementation.
- **`tidy-first-assessor` correctly declined (novel).**
  On this dispatch the assessor recommended *no* preparatory work — it recognized the interface split as inherently atomic (repurposing the exported `Authorizer` type breaks every implementer at compile time simultaneously) with no length/coupling/duplication friction, and its Rejected-as-scope-creep list stayed inside the change's own files.
  This is the skill's "first-live-use checkpoint" behaving as intended: a clean decline rather than manufactured busywork.
- **The empty-links identity was pinned two ways.**
  `composeAuthorizerChain([], terminal)` returning the terminal instance is guarded by both the unchanged `authorizer-selection.test.ts` (`expect.any(LocalUserAuthorizer)`) and a dedicated `toBe(terminal)` unit test — stronger than prose-only, and the pre-completion reviewer called this out.
- **Incremental verification cadence.**
  `pnpm run check` ran right after the shared-interface change (Step 1), affected-file tests ran per step, and the full suite + root `lint` + `fallow dead-code` ran once at the end — no end-of-session verification pile-up.

#### What caused friction (agent side)

- `other` (Edit-tool mechanics) — the first `Edit` to `denying-authorizer.test.ts` used an `oldText` (`const authorizer: Authorizer = new DenyingAuthorizer();`) that matched two occurrences and was rejected as non-unique.
  Impact: one extra retry with wider context; no rework, no wrong edit applied (the batch is atomic, so nothing landed on the miss).
- `other` (path typo, self-identified) — an `Edit` to `architecture.md` used a wrong absolute path (`.../pi-permission-system/docs/...`, dropping the `pi-packages/packages/` segment) and was denied by the `external_directory` gate.
  Impact: one retry with the corrected path; no rework.
  The gate fail-safe caught it immediately — and it is a live instance of exactly the typo-path class ADR 0007's future model judge is designed to auto-deny with a teaching reason.

#### What caused friction (user side)

- None.
  The single `ask_user` at planning (ADR-faithful rename vs. additive `AuthorizerLink`) and the ship-time release-defer confirmation were both well-scoped strategic decisions, answered once each with no back-and-forth.

### Diagnostic details

- **Model-performance correlation** — the main planning/TDD/ship work ran on `claude-opus-4-8` (appropriate for the ADR-reconciliation judgment), with a mid-session switch to `claude-sonnet-5` and back.
  Both read-only subagents (`tidy-first-assessor`, `pre-completion-reviewer`) ran on `claude-sonnet-5` per their frontmatter — fitting for assessment/review.
  No mismatch: judgment-heavy work stayed on the strong model, mechanical read-only sweeps on the cheaper one.
- **Escalation-delay tracking** — no `rabbit-hole` friction; both friction points resolved on the first retry (well under the 5-consecutive-call threshold).
- **Unused-tool detection** — not applicable; no `missing-context` or `rabbit-hole` friction.
  `colgrep`/`grep`/`Read` were used appropriately during planning exploration.
- **Feedback-loop gap analysis** — no gap; verification was incremental (see "Incremental verification cadence" above), matching the AGENTS.md rule to run `pnpm run check` immediately after a shared-interface change.

### Changes made

1. Wrote this Final Retrospective stage entry in `packages/pi-permission-system/docs/retro/0598-authorizer-chain-infrastructure.md`.
   No `AGENTS.md` or prompt changes — both friction points were one-off, self-corrected tool mechanics with zero rework, so no rule change was justified (operator confirmed "retro file only").

[#599]: https://github.com/gotgenes/pi-packages/issues/599
