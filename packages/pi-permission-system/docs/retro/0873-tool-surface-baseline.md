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

## Stage: Sync (worktree) (2026-09-04T18:11:33Z)

### Session summary

Pre-push checks (`pnpm run lint`, `pnpm fallow dead-code`) both passed clean with no fixes needed.
No `**Release:**` marker action is needed at land time — the plan records `ship independently`, so `/ship-worktree 873` should dispatch a release for `pi-permission-system` after landing.
No deferred work or open follow-ups from this branch.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-873--/2026-09-04T17-17-33-366Z_01a06d6c-f935-76eb-b570-32126342aa54.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

Nothing new beyond the Planning and Implementation stage notes above; this is a clean handoff to the root session.

## Stage: Final Retrospective (2026-09-04T18:24:50Z)

### Session summary

Landed the peer worktree branch on `main` by fast-forward, verified CI, closed [#873] with a curated summary, and released `pi-permission-system-v31.1.0`.
The issue ran the full four-stage worktree lifecycle — planning, TDD, sync, ship — with no rework, no rebase conflict, and no reviewer-blocking finding.
The most consequential moment of the whole issue arrived *after* implementation, when the operator asked whether the defect even had a reachable trigger.

### Observations

#### What went well

- **The killing-mutation discipline caught a wrong plan prediction, which is what it exists for.**
  Step 4's plan claimed that applying the `registered` conjunct to every baseline entry would empty the surface under a degenerate `getAll()`.
  Applying that mutation left every test green — the adoption loop re-appends observed-active names unconditionally, so the conjunct's placement is semantically equivalent for active tools.
  The implementing session did not record a pass; it hunted for the mutation that *does* discriminate (extending the registry check into the adoption loop), confirmed the existing test kills it, and corrected the source comment in `tool-surface-baseline.ts`.
  A green mutation is a finding, and treating it as one converted a plan error into a corrected doc comment rather than a false pin.
- **The Tidy-First assessor prevented the fix from re-creating the bug it fixed.**
  The planning agent's design summary claimed `skillEntries` is cleared in two places and proposed following that precedent.
  It is cleared in three, including `reload()` — and `reload()` is precisely where a relaxed policy can arrive, so following the precedent would have reseeded the baseline from the already-filtered set at the worst possible moment.
  This is the assessor catching a *factual* error in the design summary it was handed, not proposing a tidying: the value came from it reading the real file against a claim.
- **A gate option was retracted after the operator had already answered it.**
  The planning agent offered re-sourcing the prompt via `ctx.getSystemPrompt()` to eliminate the one-turn `Available tools:` lag, then verified `emitBeforeAgentStart` in the pinned 0.79.1 bundle and found `getSystemPrompt` is **shadowed** to return the chained `currentSystemPrompt` — the option does not work at all.
  It reported the correction unprompted rather than letting the rejected option stand as merely "riskier".
  The operator's answer was unaffected, so this cost nothing, but the retraction is the behavior worth keeping.

#### What caused friction (agent side)

- `missing-context` — **the plan asserted a trigger mechanism it never verified, and named the wrong one.**
  Plan line 152 states that `reload()` "is the config-reload path … which is exactly the moment a relaxed policy arrives."
  The post-implementation trace showed that is not the reporter's path and not the main one: `isToolFullyDenied` calls `resolvePermissions` fresh on every invocation, cached against a stamp built from the **mtimes** of the four policy files (`src/policy-loader.ts` `getFileStamp`), so editing `config.json` and starting any turn is sufficient — no reload, no restart.
  A second trigger (an agent switch, which re-resolves per `agentName` with no file edit at all) was named in the issue body's closing note and never appeared in the plan.
  Impact: no rework — the design consequence (do not reset on `reload()`) was correct, and in fact *more* correct than the reasoning supporting it.
  But the plan's Problem Statement documented the defect's mechanism in depth while leaving its precondition unexamined, and the operator had to ask whether the fix was reachable at all.
- `missing-context` — **a seam was offered as a gate option before its implementation was read.**
  `AGENTS.md` already carries this rule (Refs #696): existence in the `.d.ts` is not enough for a seam you design *around*, because a callback's position in the call order and the data live by then are visible only in the compiled `.js`.
  The planning agent verified the `agent-session.js` half (`setActiveToolsByName` rebuilds the base prompt) and offered the option on that basis, then found the `runner.js` half invalidated it.
  Impact: added friction but no rework — the correction landed before the plan was written, and the operator's answer did not change.
  Self-identified.
- `instruction-violation` — **the ship session spent a tool call on `git rev-parse HEAD | wc -c`.**
  `AGENTS.md` names this exact command as the anti-pattern (Refs #839): a deterministic command's output shape tests git, not your work; re-resolve the identifiers you *typed* instead.
  Impact: one wasted tool call, no rework.
  Self-identified (at retro time, not mid-session) — the rule is present and specific, so this is a salience miss rather than a missing rule.
- `other` — **the TDD session's own helper default broke five passing tests.**
  The `seen(active, registered = REGISTERED_TOOLS)` fixture helper was first written with `registered` defaulting to `active`, which silently broke five restore tests, since pi keeps a tool *registered* when it deactivates it.
  Impact: one debug cycle inside a step; caught immediately by the file-scoped test run.
  The defaulting choice encoded a domain claim ("deactivated implies unregistered") that the package's own contract contradicts.

#### What caused friction (user side)

- **The trigger question arrived after implementation rather than at the planning gate.**
  The operator's own framing — "I'm embarrassed to ask this question so late" — undersells it: it is the question that determines whether the fix has a reachable trigger at all, and therefore whether the code is live or dead.
  It was cheap to answer at sync time (8 tool calls) and would have been just as cheap at the planning gate, where it would additionally have corrected the plan's `reload()` claim before it was written down.
  The opportunity is symmetric rather than a criticism: the planning gate presented the *fix shape* and the *prompt-lag residual* as its substance and never presented the trigger, so there was nothing in the gate message to prompt the question earlier.

### Diagnostic details

- **Model-performance correlation** — the peer session ran planning and TDD on `anthropic/claude-opus-5`, then switched to `anthropic/claude-sonnet-5` for `/sync-worktree` (mechanical: two gates, a stage note, a rebase) and back to `claude-opus-5` for the operator's trigger question.
  The root session ran `/ship-worktree` on `claude-sonnet-5` and this retro on `claude-opus-5`.
  Both subagent dispatches (`tidy-first-assessor` at planning, `pre-completion-reviewer` after the last TDD step) ran on their configured models and each returned a substantive finding.
  No mismatch: the judgment-heavy stages held opus, and the two mechanical stages that ran on sonnet produced the session's only instruction-violation, which is consistent rather than alarming at one occurrence.
- **Feedback-loop gap analysis** — no gap.
  The TDD session ran `pnpm run check` plus a file-scoped `vitest run` inside every step before committing, ran the killing mutation for all six steps, and ran the four end-of-cycle gates (`test`, `check`, root `lint`, `fallow dead-code`) before the docs commit.
  The green baseline was established with all four gates *before* step 1, which is what made the end-of-cycle `fallow` result interpretable.
- **Escalation-delay tracking** — no `rabbit-hole` friction points; longest same-target run was the six consecutive mutation-verification calls in TDD step 3, which is the protocol executing, not thrash.

### Changes made

1. `.pi/prompts/plan-issue.md` — extended Gather-context step 6 (already the bug-report step) to require tracing and citing what **triggers** a defect, not only what it does.
   Attached to step 6 rather than inserted as a new numbered step, because the prompt cross-references "Gather context step 8" for the release recommendation and renumbering would break that reference.
2. `.pi/prompts/ship-worktree.md` — added a clause to step 4.1 forbidding shape-measurement of the piped `git rev-parse HEAD` output, the session's one instruction-violation.
   Step 5's re-resolution mandate stays as-is: those SHAs are typed into the close comment, which is where invention actually happens.

[#385]: https://github.com/gotgenes/pi-packages/issues/385
[#437]: https://github.com/gotgenes/pi-packages/issues/437
[#873]: https://github.com/gotgenes/pi-packages/issues/873
