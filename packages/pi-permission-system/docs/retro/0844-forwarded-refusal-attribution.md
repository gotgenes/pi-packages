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
