---
issue: 873
issue_title: "denied tools remain removed after policy is relaxed in the same session"
---

# Retro: #873 — denied tools remain removed after policy is relaxed in the same session

## Stage: Planning (2026-09-04T17:46:45Z)

### Session summary

Confirmed the reporter's diagnosis in `src/handlers/before-agent-start.ts` — `getActive()` → filter → `setActive()` makes each turn's output the next turn's input, so the effective tool surface can only shrink.
Settled on a per-session `ToolSurfaceBaseline` that recomputes `Effective = Baseline ∩ Policy` each turn, owned by `PermissionSession` and reset on session start/shutdown but deliberately **not** on config reload.
Wrote `packages/pi-permission-system/docs/plans/0873-tool-surface-baseline.md` with six TDD steps, two of them Tidy-First preparations to the test fixtures.

### Observations

- The issue is third-party (`Jak-o`), so the `ask_user` gate covered direction as well as design.
  The operator chose the in-package baseline fix, accepting the one-turn prompt lag, with debug-stream logging only.
- **A gate option I offered turned out to be non-viable.**
  I proposed re-sourcing the prompt from `ctx.getSystemPrompt()` after `setActive` to eliminate the one-turn `Available tools:` lag.
  Checking `dist/core/extensions/runner.js:749-752` in the pinned 0.79.1 bundle afterwards showed `getSystemPrompt` is **shadowed** inside `emitBeforeAgentStart` to return the chained `currentSystemPrompt` — i.e. exactly `event.systemPrompt`.
  I had verified the `agent-session.js` half (`setActiveToolsByName` rebuilds the base prompt) but not the runner half that actually serves the accessor.
  Lesson: verifying that a seam *exists* and that its *implementation* does what you want are two reads, and the second one is where the option died.
  The correction was reported before the plan was written; the operator's answer was unaffected.
- The operator asked whether there is precedent for modifying the prompt and what it costs packages like `pi-anthropic-auth`.
  There is: [#437] made the returned override byte-stable across turns precisely for the provider prompt cache, and `docs/configuration.md:1170` records it.
  A policy relax is an intentional cache transition of the same class plan `0437` already enumerates for a mid-session agent switch — but the one-turn lag makes it **two** prefix invalidations instead of one (tools block on the relax turn, system prompt on the next).
  Recorded in the plan's Invariants section rather than treated as a blocker.
- **The Tidy-First assessor caught a real design error.**
  My design summary claimed `skillEntries` is cleared in two places and proposed following that precedent; it is cleared in three, including `reload()`.
  Following the precedent there would have reseeded the baseline from the already-filtered set on every config reload — reintroducing [#873] at exactly the moment it matters.
  The plan now carves `reload()` out explicitly and pins it with a killing mutation.
- The assessor also found that neither `makeToolRegistry` double models the `setActive` → `getActive` feedback loop, so the regression test could not have been written faithfully.
  That became TDD steps 1-2.
- Added one hardening clause not in the issue: a withheld tool that Pi unregisters is forgotten, so it cannot be resurrected if it is later re-registered inactive ([#385]'s contract).
  The conjunct is restricted to *withheld* entries so a degenerate `getAll()` can never drop a currently-active tool.
- No follow-up issues filed.
  The upstream "intended vs effective tool set" accessor was offered as a gate option and not chosen, so filing it would be speculative.

## Stage: Implementation — TDD (2026-09-04T18:09:53Z)

### Session summary

Executed all six plan steps as separate commits: two Tidy-First test preparations, the baseline fix, the unregistered-tool hardening, the debug-log entry, and the doc updates.
`pi-permission-system` went from 4086 to 4117 tests (+31); `check`, root `lint`, full `test`, and `fallow dead-code` are green.
Every killing mutation the plan named was applied and reverted, and each killed the class the plan predicted — except one, noted below.

### Observations

- **One plan prediction was wrong, and the mutation check is what caught it.**
  Step 4's plan claimed that applying the `registered` conjunct to *every* baseline entry, rather than to withheld entries only, would empty the surface when `getAll()` reports nothing.
  Applying that mutation left every test green: the adoption loop re-appends every observed-active name unconditionally, so the conjunct's placement is semantically equivalent for active tools.
  The real safety property is the adoption loop, not the conjunct's scope.
  I corrected the source doc comment in `tool-surface-baseline.ts` to say so, and found the mutation that *does* discriminate — extending the registry check into the adoption loop — which the `keeps every active tool even when the registry reports nothing` test kills.
  The plan's `Risks and Mitigations` bullet still attributes the guarantee to the narrower mechanism; the plan is a point-in-time artifact, so it is recorded here rather than edited.
- The Tidy-First assessor's `reload()` correction paid off immediately.
  `PermissionSession.reload()` deliberately does **not** reset the baseline, and the mutation that adds a reset there re-creates [#873] exactly — that mutation is now pinned by a named test.
- The stateful `ToolRegistry` double was load-bearing, as the assessor predicted.
  Both existing doubles are static, and none of the pre-existing two-turn tests would have caught this bug.
  Modeling `setActiveToolsByName`'s silent drop of unregistered names in the double is what let step 4's tests be written at the handler level rather than only as unit tests.
- The plan's `registered` field started as a step-4 addition to `ToolSurfaceObservation`, which meant updating every observation literal in the unit tests.
  A `seen(active, registered = REGISTERED_TOOLS)` helper absorbed it; the first attempt defaulted `registered` to `active`, which silently broke five restore tests because pi keeps a tool registered when it deactivates it.
- Pre-completion reviewer: **WARN** (1 non-blocking finding).

#### Reviewer warnings

- The plan's `Risks and Mitigations` bullet on a degenerate `getAll()` states a true outcome but attributes it to the same incomplete causal story that the step-4 killing-mutation claim did.
  Recorded above; no code or doc change needed — the source comment and `docs/architecture/architecture.md` already carry the corrected reasoning.

[#385]: https://github.com/gotgenes/pi-packages/issues/385
[#437]: https://github.com/gotgenes/pi-packages/issues/437
[#873]: https://github.com/gotgenes/pi-packages/issues/873
