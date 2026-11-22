---
issue: 599
issue_title: "pi-permission-system: registerAuthorizer seam, authorizerChain config, and enforcement checkpoint"
---

# Retro: #599 — registerAuthorizer seam, authorizerChain config, and enforcement checkpoint

## Stage: Planning (2026-07-16T00:00:00Z)

### Session summary

Planned Phase 12 Step 5 (Track B, the Authorizer chain) — the batch tail of "authorizer-chain".
Step 4 ([#598]) has landed, so the chain infrastructure (`Authorizer`/`TerminalAuthorizer`/`composeAuthorizerChain([], terminal)`) is in place; Step 5 exposes the registration seam, the `authorizerChain` config, the injected `PermissionQuery`, and a conservative enforcement checkpoint.
Wrote a six-step TDD plan and committed it.

### Observations

- **Two design forks surfaced to the operator, both resolved.**
  (1) `PermissionQuery` injection — ADR 0007 §3 and Step 4's Open Questions said Step 5 widens `authorize(details, query)`, but the issue body was silent and the only day-one consumer ([#600], deny-first) never queries.
  Operator chose **inject now** (seam born final-shaped). (2) "Secret-shaped path" exclusion — no formal secrets model exists in the codebase, so a hard-coded denylist was declined; operator chose the **conservative whole-`path` exclusion** now.
- **Both refinements deferred to a filed slice-2 issue.**
  Filed [#620] (allow-capable opaque-bash adjudicator) to own consuming the injected query, refining the checkpoint to secret-shaped, and the `origin:"authorizer:model"` audit shape — so both open items have a concrete home rather than floating under [#472].
- **Name-collision catch.**
  `AuthorizerSelectionDeps` already carries `registry?: SubagentSessionRegistry`, so the new authorizer-registry dep is named `authorizerRegistry` to avoid shadowing.
  The three new selection deps go on `AuthorizerSelection`'s own constructor intersection, **not** `AuthorizerSelectionDeps`, so `selectAuthorizer` (terminal selection) is not widened.
- **Reused `LocalPermissionsService` as the injected `PermissionQuery`** (narrowed) rather than rebuilding a query object — it already routes bash/path at gate parity against the live session cwd, so parity is by construction.
- **Behavior-neutral tail.**
  `authorizerChain` defaults to empty and no first-party link registers until [#600], so `composeAuthorizerChain` still returns the terminal identity — the change is non-breaking despite being the release-cutting batch tail.
- **Riskiest step is Step 1** (widening the exported `Authorizer` type + `composeAuthorizerChain`): atomic, since it breaks every caller at compile time; re-read affected files after (the `tsc`-passes-on-dropped-`import type` trap).
- **`dist/public.d.ts` is untracked** (built at prepack), so new public types need only the `service.ts` re-export plus a `verify-public-types.sh` symbol-list update — no committed artifact to regenerate.

## Stage: Implementation — TDD (2026-07-16T13:10:00Z)

### Session summary

Implemented Step 5 across 8 commits: 2 preparatory `refactor:` commits (extract `PermissionQuery`, fold the config array-merge into a key loop) from the tidy-first assessment, then 5 `feat:` cycles (inject `PermissionQuery`, `registerAuthorizer` seam, `authorizerChain` config, delegation envelope, config-driven chain resolution) and 1 `docs:` commit. pi-permission-system test count went 2506 → 2534 (+28), test files 124 → 126 (two new: `authorizer-registry.test.ts`, `delegation-envelope.test.ts`).
All gates green (`check`, root `lint`, `test`, `fallow dead-code`, `verify:public-types`); pre-completion reviewer returned PASS.

### Observations

- **One deliberate deviation from the plan sketch.**
  The plan composed the chain at `activate`; I moved resolution into `escalate` (per ask) so a link registered in a `permissions:ready` handler that fires *after* activation is still honored before the session's first ask — ADR 0007 §4 says "before the session's first ask", not "before activate".
  Noted in the Step 5 commit body; the composition-root test registers the link *after* `session_start` to pin this.
- **Both tidy-first Recommended refactors paid off.**
  Extracting `PermissionQuery` first shrank the plan's admittedly-atomic Step 1; the array-merge key loop made the `authorizerChain` merge a one-token append.
- **Mock-construction cascade, as the plan's mock-grep rule anticipated.**
  Adding `registerAuthorizer` to `PermissionsService` broke three test mock sites (`permissions-service.test.ts` helper, `service.test.ts`, `service-lifecycle.test.ts`) plus the `LocalPermissionsService` 5th-arg call sites — all folded into the Step 2 commit.
- **`index.ts` forward-reference works.**
  `getPermissionQuery: () => permissionsService` closes over a `const` declared later; TS allows the closure (runs at `session_start`), no forward-decl `let` needed.
- **Checkpoint is dormant this batch** (deny-first links never `allow`), so the whole-`path` exclusion ships correct-but-unexercised-by-allow; #620 owns the secret-shaped refinement + the allow-capable adjudicator that first exercises it.
- **Reviewer verdict: PASS** — no WARN findings.

## Stage: Final Retrospective (2026-07-19T22:25:00Z)

### Session summary

Phase 12 Step 5 shipped end to end in one continuous session (plan → TDD → ship) and released as `pi-permission-system-v20.9.0`, the tail of the "authorizer-chain" batch.
The session was notably clean: an exemplary plan-time ambiguity gate, two tidy-first prep refactors that paid off, five green TDD cycles, and one self-caught design correction (per-ask vs. activate-time chain resolution).
Friction was minor and mechanical — two path-transcription slips and one truncated CI SHA, all self-corrected with zero rework.

### Observations

#### What went well

1. **The plan-time ambiguity gate was exemplary.**
   Two genuine forks (inject `PermissionQuery` now vs. defer; whole-`path` vs. secret-shaped exclusion) were surfaced with grounded context.
   When the operator asked clarifying questions back, the answer synthesized a unifying fact — *both forks are slice-2 (allow-capable) machinery, and slice-2 was unfiled* — which resolved both at once and produced a concrete follow-up ([#620]) instead of leaving the deferrals floating under [#472].
2. **A self-caught design correction during TDD.**
   The plan sketched resolving the chain at `activate`, but mid-Step-5 I traced that a link registered in a `permissions:ready` handler can fire *after* activation, so ADR 0007 §4 ("before the session's first ask") requires per-ask resolution.
   Moved resolution into `escalate` and pinned it with a composition-root test that registers the link *after* `session_start`.
   Caught before any wrong code landed — zero rework.
3. **Both tidy-first prep refactors genuinely shrank the change.**
   Extracting `PermissionQuery` first removed one axis from the plan's admittedly-atomic Step 1; the `mergeUnifiedConfigs` array-merge key loop made the `authorizerChain` merge a one-token append.
4. **Incremental verification throughout.**
   `pnpm run check` ran after every shared-interface change (not just at the end), affected test files ran per cycle, and the full gate (`test` / root `lint` / `fallow` / `verify:public-types`) ran once before the docs commit.

#### What caused friction (agent side)

1. `other` (mechanical path typo) — twice I addressed an `Edit`/`Read` at a **doubled** absolute path (`/…/pi-permission-system/packages/pi-permission-system/…`, the `pi-packages` root segment dropped), which the permission gate denied.
   Impact: 2 wasted tool calls, both self-corrected on the next call; no rework.
   Ironically the exact typo-path shape ADR 0007's use case 1 is built to auto-deny.
2. `instruction-violation` (self-identified) — the first `ci_find` was passed a 39-char SHA (dropped the trailing `b` while transcribing `git rev-parse` output), which the ship prompt explicitly warns against ("pass that exact value … never hand-expand").
   Impact: one 125 s `ci_find` timeout, then re-ran `git rev-parse` and retried with the full SHA; no rework.
3. `instruction-violation` (self-identified, harmless) — one `Edit` call carried a stray `newText2: ""` key (the `oldText2`/`newText2` trap AGENTS.md names); it was silently ignored and the single `newText` was already complete, so nothing was dropped.
   Impact: none, but re-read the region to confirm.

#### What caused friction (user side)

1. None.
   The operator's plan-time clarifying questions were a strength — pushing back with "when *will* we inject it?" and "is there a refining issue?
   is this hard-coded?" forced the slice-2/`#620` framing that made the plan sharper.
   No mechanical-oversight friction.

### Diagnostic details

- **Model-performance correlation** — two subagent dispatches, both appropriate: `tidy-first-assessor` (preparatory-refactor judgment) and `pre-completion-reviewer` (deterministic gates + judgment checklist).
  No reasoning-weak-model-on-judgment or high-cost-model-on-mechanical mismatch.
- **Escalation-delay tracking** — no `rabbit-hole` friction; the longest same-error streak was 1 retry (path typos, SHA truncation).
- **Unused-tool detection** — no `missing-context`/`rabbit-hole` points; exploration at plan time was thorough (read the ADR, Step 4 plan, all touched source, and the registry precedent before writing).
- **Feedback-loop gap analysis** — no gap; verification was incremental (`check` after each interface change, per-file tests per cycle), not end-loaded.

### Changes made

1. Wrote this Final Retrospective stage entry in `packages/pi-permission-system/docs/retro/0599-register-authorizer-seam.md`.
2. No `AGENTS.md` or `.pi/prompts/` changes — operator chose record-only.
   The three friction points were mechanical and zero-rework: the CI-SHA case is already covered by an existing `/ship-issue` rule, the path typos self-corrected, and the `activate`-vs-`escalate` timing lesson is already documented concretely in the package `SKILL.md`.

[#472]: https://github.com/gotgenes/pi-packages/issues/472
[#598]: https://github.com/gotgenes/pi-packages/issues/598
[#600]: https://github.com/gotgenes/pi-packages/issues/600
[#620]: https://github.com/gotgenes/pi-packages/issues/620
