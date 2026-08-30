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

## Stage: User Note (2026-08-30T18:09:50Z)

Here's a new pattern for the permission model judge to watch for, coming from a worktree — which is new context it does not yet consider: `~/development/pi/pi-permission-system/src/handlers/tool-call-boundary.ts`.

Context from this session: the read was denied on `external_directory_read` with the model judge's reason "wrong path".
The intended target was `packages/pi-permission-system/src/handlers/tool-call-boundary.ts` **inside the worktree** (`~/development/pi/pi-packages-worktrees/issue-844`), and the path reached for was the standalone upstream fork checkout at `~/development/pi/pi-permission-system/` — a real directory that is not this monorepo's copy of the package.
The distinguishing signal is that a worktree CWD (`pi-packages-worktrees/issue-<N>`) makes `~/development/pi/<pkg>/…` a *sibling-checkout* read of the same package name, which is a different class from an ordinary outside-CWD read: the file exists, the content looks right, and a stale copy would be silently wrong rather than absent.

## Stage: Implementation — TDD (2026-08-30T19:22:06Z)

### Session summary

Seven commits over the plan's six steps: the rule-clause parameterization, the ADR 0011 §10 amendment, the deny-reason carry, the two render arms, the doc updates, and a seventh `test:` commit closing the pre-completion reviewer's single WARN finding.
The package suite went from 3787 to 3803 passing (+16 tests, no new files; 152 files throughout).
Pre-completion reviewer: WARN on the first round, PASS on the scoped re-review of the follow-up commit.

### Observations

- **A mutation that under-delivered its predicted reds was the finding, and I read past it.**
  Step 5's plan predicted its first killing mutation would turn the new dispatch case **and** a `runner.test.ts` assertion red.
  It turned exactly one red, because I had never written the runner assertion — and I recorded the single red as success.
  The reviewer caught it.
  Generalizable: a killing mutation's predicted red *count* is part of the prediction, so a mutation that kills fewer tests than the plan named is a finding even when the tree is green — it means either the test is missing or the plan's claim was wrong, and both need resolving before the commit.
- **A scripted multi-line mutation silently no-opped and read as a passing mutation.**
  The first attempt at step 4's M1 used `perl -0pi -e` with a `\Q…\E` block spanning newlines; it matched nothing, the suite stayed green, and that green looked exactly like "the mutation failed to kill anything".
  Caught it only by `diff`-ing against the saved green copy.
  The AGENTS rule against scripted multi-line substitution applies to *mutations*, not just edits — and a mutation run needs a positive check that the file actually changed before its result means anything.
- **The operator caught a comment I made wrong while widening its scope.**
  Removing `gate_error` from the fall-through group left a comment claiming "the remaining kinds never refuse: they only ever allow" above a group still headed by `user` — which is precisely the kind that *does* refuse, and whose render this arm is.
  Three unrelated reasons had collapsed into one sentence (`user`: the render's true subject; `session_approval`/`infrastructure_read`/`yolo`: unreachable, listed for exhaustiveness; `forwarded`: decider-less, fail-soft).
  Editing a shared comment's *membership* changes what the comment asserts even when its words are untouched.
- **The plan's expected-string transcription was wrong once, in the same way #772's retro recorded.**
  The bash-context case expected `inside a command substitution`; the renderer produces `inside command substitution` (no article).
  Hand-writing a render's expected output from memory rather than copying an existing assertion is the recurring defect here — second occurrence across two issues on this same test file.
- **The tidy-first refactor paid for itself immediately and was verified the cheap way.**
  Parameterizing `identification`'s rule clause landed with a byte-identical suite and no test diff, which is the whole verification; both new arms then differed from the existing four by one argument.
  The plan's correction to the assessor's rejection also held up: keeping `commandContext` on the payload side preserved `inside command substitution` in the new render, which the assessor's one-line literal would have dropped.
- **The deny-reason carry, folded in at the planning gate, turned out to be load-bearing.**
  Without it the new `rule` arm's reason clause had no producer at all, so the render would have shipped a permanently empty branch and its test would have pinned nothing.
- **No deviations from the plan's Module-Level Changes.**
  Every listed file was touched and nothing outside the list was, verified with `git diff --name-only <plan-commit>^..HEAD`.
  The Step 15 `Outcome:` metric replacement predicted at planning time (`renderEscalatedPolicyDenial` count 0 → 2) landed exactly.

## Stage: Sync (worktree) (2026-08-30T19:28:37Z)

### Session summary

Pre-push checks both passed clean on the first run — root `pnpm run lint` (1067 files, no findings) and `pnpm fallow dead-code` (325 entry points, no issues) — so this stage made no code changes.
The plan's `**Release:** ship independently` marker holds; no deferred work or new follow-ups to carry to the root.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-844--/2026-08-30T14-40-33-948Z_01a0531d-729c-75f2-ae36-1791eefb79b0.jsonl` — read with `read_session_file({ path: "..." })` for message-level verification at land/retro time.

### Observations

Nothing further to flag; the branch was already green from the TDD stage's own checks moments earlier.

## Stage: Final Retrospective (2026-08-30T19:56:07Z)

### Session summary

Landed #844 through the two-session worktree convergence: the peer's `/sync-worktree` left the branch green and already linear on `origin/main`, and the root's `/ship-worktree` fast-forwarded eight commits onto `main`, watched CI green, closed the issue, merged the component-scoped release PR, and tagged `pi-permission-system-v28.0.1`.
The ship half ran without a retry, a correction, or a fallback path — every prompt step executed exactly once.
The retrospective's material therefore comes almost entirely from the planning and TDD stages, where three of the four friction points cluster around one mechanism: the killing-mutation run.

### Observations

#### What went well

- **Both operator interventions during TDD were questions, not corrections, and the cheap one was wrong while the cheap one was right.**
  `return decidedElsewhere ? "" : "";` can be simplified, no?
  was a live mutant misread as production code and cost a single tool call to resolve.
  Is this comment still accurate?
  found a genuine defect the agent had just introduced.
  An interrogative intervention prices its own false positives at roughly one tool call, which is what makes asking on a hunch worth it; a corrective one would have had the agent "fixing" a mutant.
- **The close-comment anchor added for #817 worked on its first component-scoped release.**
  `git log --grep="docs: plan .*(#844)"` resolved the plan commit on the first try, and `1b21f914^..HEAD` bounded the range to this issue's eight commits.
  Anchoring on the package's last tag instead would have swept in every sibling issue landed since `pi-permission-system-v28.0.0`.
- **`separate-pull-requests` behaved exactly as its `AGENTS.md` entry describes.**
  `release_pr_find` with `component: pi-permission-system` returned PR #847 on the component branch, and the full body bumped that package and nothing else — the by-component selection rule was load-bearing rather than ceremonial.
- **The tidy-first refactor was verified by the cheapest possible evidence.**
  Parameterizing `identification`'s rule clause landed with a byte-identical suite and no test diff, and both new render arms then differed from the existing four by one argument.

#### What caused friction (agent side)

- `premature-convergence` — step 5's killing mutation produced **one** red where the plan predicted two (the unit dispatch test and a `runner.test.ts` block-path assertion), and the single red was read as success.
  The shortfall was the signal that the runner assertion had never been written.
  Impact: a missing integration assertion shipped inside `8f703800`, was caught by the `pre-completion-reviewer`, and cost a seventh follow-up commit (`702955da`) plus a second scoped reviewer round.
- `other` — a scripted multi-line mutation (`perl -0pi` with a `\Q…\E` block spanning newlines) matched nothing and silently no-opped, and the resulting green suite read exactly like a mutation that killed nothing.
  Caught only by an unprompted `diff` against the saved green copy.
  Impact: no rework, but the mutation's result was meaningless until re-run — the failure mode is invisible because a no-op mutation and an undiscriminating test produce the same output.
  This is the under-match twin of the existing `AGENTS.md` rule about scripted multi-line substitution, which warns only about over-matching a neighbor.
- `other` (user-caught) — removing `gate_error` from the fall-through group left the group's comment asserting that "the remaining kinds never refuse" above a list still headed by `user`, the one kind that does.
  Editing a shared comment's **membership** changes what it claims even when its words are untouched.
  Impact: a wrong comment would have shipped; corrected in place and folded into `8f703800`'s message, no extra commit.
- `missing-context` — the plan's expected-string transcription was wrong: it wrote `inside a command substitution` where the renderer produces `inside command substitution`.
  Second occurrence on this same test file across two issues, after #772.
  Impact: one red-step correction, no rework — but the recurrence is the finding, not the cost.

#### What caused friction (user side)

- The operator read the working tree during a killing-mutation window and flagged a deliberate mutant as simplifiable production code.
  Framed as opportunity rather than criticism: the in-place mutation loop makes the working tree transiently untrustworthy to any observer, and the announcement that preceded it ("Now step 5's two killing mutations") lived in the message stream, not in the file being read.
  There is no cheap fix — leaving mutants out of the tree defeats the technique — so the durable mitigation is the agent's, not the operator's: verify and revert the mutation in the same turn that applies it.

### Diagnostic details

- **Model-performance correlation** — Planning and TDD ran on `anthropic/claude-opus-5`, matching genuinely judgment-heavy work (the ADR 0011 §10 disclosure boundary, the render dispatch design, the mutation set).
  The peer's Sync stage deliberately downshifted to `anthropic/claude-sonnet-5` for two gate runs, a breadcrumb, and a rebase — an appropriate match worth repeating.
  The root's Ship stage ran on `anthropic/claude-opus-5` for a sequence that is almost entirely prompt-scripted (ff-merge, push, `ci_watch`, `issue_close`, `release_pr_merge`, teardown); its only judgment calls are composing the close comment and reading the release PR body.
  Recorded as data rather than a recommendation: the close comment synthesized three commit messages into user-visible behavior, which is not obviously sonnet-grade work.
  Subagents: `tidy-first-assessor` once at planning, `pre-completion-reviewer` twice during TDD (the second a scoped re-review); both lock their model in frontmatter and neither showed a capability mismatch.
- **Escalation-delay tracking** — no sequence exceeded five consecutive tool calls on a single error.
  The longest same-target run was step 5's mutation cycle at roughly six calls, but each call advanced the cycle rather than retrying a stuck approach.
- **Feedback-loop gap analysis** — no gap.
  `pnpm run check` ran inside each TDD cycle rather than at the end, full `pnpm run test` and `pnpm run lint` ran before the docs commit and again before the follow-up commit, and the peer ran root-level `lint` plus `pnpm fallow dead-code` before handoff.
  CI on `main` passed on the first attempt, which is the confirmation those local gates were sufficient.
- **Unused-tool detection** — nothing notable; no friction point had an undispatched subagent or unused search tool that would have helped.

### Changes made

1. `.pi/prompts/tdd-plan.md` step 1 (Red) — added a sentence requiring a string the code under test **produces** to be copied from the producer or an existing assertion rather than transcribed from the plan (Refs #772, #844).
2. `.pi/prompts/tdd-plan.md` step 3 (Verify the pins) — added two sentences: confirm the mutation actually changed the file before reading the suite, and count the observed reds against the step's predicted count, treating a shortfall as a finding rather than a pass.
3. `packages/pi-permission-system/docs/retro/0844-forwarded-refusal-attribution.md` — this Final Retrospective stage entry.

The operator declined a third proposal (a `claude-sonnet-5` downshift note for `/ship-worktree`); the supporting data stays in the diagnostic details above, with no prompt edit.
