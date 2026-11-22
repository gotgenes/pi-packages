---
issue: 319
issue_title: "Introduce PermissionResolver and remove the session-rule relay from the permission gates"
---

# Retro: #319 — Introduce PermissionResolver and remove the session-rule relay

## Stage: Planning (2026-06-02T00:00:00Z)

### Session summary

Planned issue #319, but first reframed it.
The original issue proposed replacing the `GateRunnerDeps` bag with one narrow `GateRunnerContext` interface; investigation showed that a single interface the session implements wholesale would just re-expose the session ("glomming state"), and that the bag is really a relay plus four genuine roles.
Decomposed the architecture rework into three sequential issues, created the two follow-ups, reframed #319 to the foundational step, then wrote and committed the plan.

### Observations

- The decisive evidence: `getSessionRuleset()` has no independent use — at all five call sites (the runner and every `describe*` gate plus `resolveBashCommandCheck`) its result feeds straight into the next `checkPermission(...)` call.
  So `checkPermission` + `getSessionRuleset` are one operation split into a primitive plus a relay; the fix is a single `PermissionResolver.resolve(surface, input, agentName)`.
- The genuinely missing object is a `DecisionReporter` owning `writeReviewLog` (currently a Law-of-Demeter reach-through to `session.logger.review`) + `emitDecision` (event bus).
  This is where the "does the session own the event bus?" question resolves: the reporter owns it, the session never does.
- Issue decomposition (user-directed): #319 = `PermissionResolver` + full relay removal across all gates; #322 = `DecisionReporter` extraction (depends on #319); #323 = `GateRunner` class replacing `GateRunnerDeps`, adding the `GatePrompter` role (depends on #319 and #322).
  User chose a flat sequence with cross-links over an umbrella epic.
- Key behavior-preservation note for implementation: `SessionRules.getRuleset()` returns a fresh array copy per call, so folding it into `resolve()` re-snapshots per call instead of once per gate.
  Safe because no `recordSessionApproval` runs during descriptor construction — every snapshot within a gate is equal.
- Migration sequencing: the handler carries both the resolver and the legacy `checkPermission`/`getSessionRuleset` closures through the per-gate steps, so the repo stays green between commits; the final runner step deletes the last closures.
- `docs/architecture/architecture.md` still describes the old single-`GateRunnerContext` framing (Phase 3 Track C, Step 6, the Mermaid roadmap node, and the smell table) — the plan's final step reframes it into the three-issue decomposition.
- The package `SKILL.md` does not reference `getSessionRuleset` or `GateRunnerDeps`, so no skill update is needed.

## Stage: Implementation — TDD (2026-06-02T20:00:00Z)

### Session summary

Executed all 7 TDD cycles: introduced `PermissionResolver` + `PermissionSession.resolve` (4 new unit tests), migrated the four gate descriptor factories and `resolveBashCommandCheck` off the `(checkPermission, getSessionRuleset)` pair, collapsed the runner bag's two members into `resolve` (`GateRunnerDeps extends PermissionResolver`), and reframed the architecture doc's Phase 3 Track C roadmap.
Test count went 1759 → 1763 (+4, all from the new `resolve` unit tests); the relay is gone from every gate.
Pre-completion reviewer returned WARN with two non-blocking findings, both addressed.

### Observations

- Deviation from the plan (Step 5): the plan listed only `gate-fixtures.ts` plus the five gate test files, but switching the inline tool-gate resolution in `handleToolCall` to `session.resolve` broke the handler integration tests whose session mocks lacked a `resolve` method.
  Fixed by giving three session mocks (shared `makeSession` in `handler-fixtures.ts` plus the two local mocks in `external-directory-integration.test.ts` and `external-directory-session-dedup.test.ts`) a delegating `resolve()` that mirrors production (`checkPermission` applying `getSessionRuleset()`).
  This kept the many integration tests that drive gate outcomes via `checkPermission` working without rewriting them.
  The reviewer independently confirmed the delegation is sound and behavior-preserving (the dedup test's rule-doubling is insensitive to `findLast`, and that doubling also existed pre-migration).
- The delegation guard `if (!Object.hasOwn(overrides, "resolve"))` lets a test override `resolve` directly when needed while defaulting to the production-mirroring delegation.
- `SessionRules.getRuleset()` returns a fresh array copy per call, so folding it into `resolve()` re-snapshots per call; confirmed behavior-preserving since no `recordSessionApproval` runs during descriptor construction.
- Reviewer WARN findings (both fixed before stopping): (1) the package `SKILL.md` gate-fixtures listing omitted the new `makeResolver` factory; (2) `permission-gate-handler.ts` had two independent references to `session.resolve` (the `resolver` local and the bag's `resolve` lambda) — the lambda now reuses `resolver`.
- Final state: `pnpm check` / `lint` / `test` (1763) / `fallow dead-code` all green; `GateRunnerDeps` is down to 6 members, with the `DecisionReporter` ([#322]) and `GateRunner` ([#323]) extractions deferred as planned.

## Stage: Final Retrospective (2026-06-02T21:30:00Z)

### Session summary

A single continuous session carried #319 through all four stages: planning (which reframed the issue and spawned #322/#323), seven TDD cycles, shipping (CI green, release batched), and this retro.
The headline outcome was a design that started as the issue's prescribed "one narrow `GateRunnerContext` interface" and, after a user redirect, became a principled three-issue decomposition (relay collapse + `DecisionReporter` + `GateRunner`).
Execution was clean: 10 commits, +4 tests, zero rework of committed code, two reviewer WARNs fixed before stopping.

### Observations

#### What went well

- Incremental verification was exemplary and load-bearing: running the affected test file after each Red/Green, `pnpm run check` after every interface-touching step, and — critically — a *proactive* handler-integration-test run after the Step 5 inline tool-gate switch caught a plan gap before it reached commit or CI.
- The delegating-mock pattern (novel): giving the mock `session.resolve` a body that calls the mock's own `checkPermission` + `getSessionRuleset` mirrored production and migrated dozens of integration tests with zero per-test expectation rewrites.
- Pre-completion reviewer earned its keep: independently confirmed the delegating-mock was behavior-preserving (the dedup test's rule-doubling is `findLast`-insensitive and pre-existed the migration) and surfaced two real WARNs.

#### What caused friction (agent side)

1. `premature-convergence` (planning) — the first `ask_user` offered two variants of the prescribed `GateRunnerContext` approach (emit-in-session vs. separate event bus) before validating whether a single session-implemented interface was the right abstraction at all.
   The user redirected with a question — "Maybe `GateRunnerContext` isn't even helping, if it's just glomming state together" — which catalyzed the relay-collapse + `DecisionReporter` + role-decomposition design.
   Impact: one extra analysis round; net-positive because the redirect produced a materially better design, but the agent should have questioned the prescribed abstraction before asking about its implementation details.
2. `missing-context` (planning, surfaced in TDD Step 5) — the plan's Module-Level Changes listed `gate-fixtures.ts` for test changes but never grepped for the hand-rolled `PermissionSession` mocks (`handler-fixtures.ts` `makeSession` plus local copies in `external-directory-integration.test.ts` and `external-directory-session-dedup.test.ts`).
   The `testing` skill's mock-grep rule is framed around "adding a field to a shared interface," but `PermissionSession` is a class mocked via `as unknown as`, so the rule did not obviously apply.
   Impact: self-identified during TDD via the proactive handler-test run; no rework of committed code, but added three unplanned files to Step 5.
3. `other` (tooling) — one invalid `Edit` call used `oldText2`/`newText2` keys (not supported); single retry, trivial.

#### What caused friction (user side)

- None material.
  The user's three interventions — the design redirect, the "rework the architecture and add more issues… make it so" directive, and the batch-release choice — were all strategic-level and well-timed.
  The only latent nudge toward friction was the issue body's prescriptive "Define a narrow `GateRunnerContext` interface," which framed a hypothesis as a spec; that is an authoring nuance, not a session fault.

#### Design follow-up surfaced in the retro

Digging into the Step 5 friction (#missing-context, hand-rolled session mocks) exposed a deeper root cause than "the plan forgot to grep for mocks."
The mocks are `as unknown as PermissionSession` because `PermissionGateHandler`'s constructor depends on the **concrete** `PermissionSession` class (using 12 of its 36 members), and a concrete class with private fields cannot be satisfied structurally without the cast.
That cast is the antipattern: it disables TypeScript's structural check, which is the only reason the missing `resolve` surfaced at runtime instead of at `pnpm run check`.
The `code-design` skill already names the fix — "use a narrow interface type, not the concrete class."
The 12 members decompose by role, and most are already being extracted: `resolve`/`checkPermission` → `PermissionResolver` (#319), `recordSessionApproval` → `SessionApprovalRecorder` (#323), `canPrompt`/`prompt` → `GatePrompter` (#323), `logger.review` → `DecisionReporter` (#322); the residual cluster (`activate`, `resolveAgentName`, `config`, `getInfrastructureDirs`, `getInfrastructureReadPaths`, `getActiveSkillEntries`, `createPermissionRequestId`) has no role yet and is the open design question.
A "narrow interface" is therefore not one 12-member facade — it is the handler depending on the small roles, with the residual cluster resolved during planning.
Captured as #325 (depends on #322/#323, to be planned); the `as unknown as` de-cast falls out as a consequence, restoring compile-time mock-completeness checking.

### Diagnostic details

- **Model-performance correlation** — one subagent dispatched (`pre-completion-reviewer`) on `anthropic/claude-sonnet-4-6`; appropriate for judgment-heavy review (code-design audit, delegation-soundness proof).
  No mismatch.
- **Escalation-delay tracking** — no rabbit-holes.
  The Step 5 mock breakage resolved in ~3 tool calls (diagnose missing `resolve` → fix shared `makeSession` → fix two local mocks).
  No 5+ consecutive-call sequences on one error.
- **Unused-tool detection** — the Step 5 gap was greppable at plan time (`as unknown as PermissionSession`, local `makeSession`); a single grep during planning would have caught it.
  No subagent was needed.
- **Feedback-loop gap analysis** — verification ran incrementally after every change, not just at the end; the proactive Step 5 handler-test run is the concrete payoff.

### Changes made

1. Created #325 — "Depend on session role interfaces in `PermissionGateHandler`, not the concrete `PermissionSession` class" (label `enhancement`, `pkg:pi-permission-system`; depends on #322/#323; needs `/plan-issue`).
   This is the real fix for the `as unknown as PermissionSession` casts surfaced by the Step 5 friction.
2. Rejected two candidate `testing` skill edits after picking them apart with the user:
   - Proposal A (a rule to grep for `as unknown as` mocks) — rejected because it would bless the bandaid rather than remove it; the cast is a symptom of consumers depending on the concrete class, addressed by #325.
   - Proposal B (codify the delegating-mock tactic) — rejected because delegation only works on broad hand-rolled mocks, which are themselves a decoupling smell that #325 removes; not a pattern to hold up as desired.
3. No edits to `.pi/skills/testing/SKILL.md` or `AGENTS.md`; the retro file carries the rationale, and #325 carries the design work.
