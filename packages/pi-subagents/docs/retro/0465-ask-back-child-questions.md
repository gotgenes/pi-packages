---
issue: 465
issue_title: "新增一个类似 “pi install npm:pi-intercom”的能力"
---

# Retro: #465 — Ask-back: let a child's question reach the parent

## Stage: Planning (2026-08-31T21:56:20Z)

### Session summary

Planned Phase 22 Step 8 — the ask-back capability from a third-party issue whose concrete slice ([#798]) had already shipped.
The design gate ran long and productively: what began as "add a question affordance" became a four-part plan after the operator pushed on why foreground and background subagents behave differently, which traced to a residual `isBackground` guard rather than a decision.
Committed `docs/plans/0465-ask-back-child-questions.md` (8 TDD steps), filed [#857] and [#858], and recorded both as new Phase 22 Steps 10 and 11 by operator decision.

### Observations

- **The issue is third-party and its literal ask was already narrowed twice by the operator's own comments.**
  The reporter's "the subagent asks a question, and then it just ends" turned out to describe a missing *handle* ([#798], shipped) plus a missing *affordance* (this plan).
  Reading the close comments rather than the issue body is what made the residual legible.
- **Session title was translated from Chinese at the operator's request.**
  The plan and retro keep the exact Chinese `issue_title` in frontmatter (it is the machine-matched field) while the H1, slug, and prose are English.
  Worth repeating for any future non-English issue.
- **Git archaeology settled a design question that reasoning alone would have gotten wrong.**
  `7bbd6064` showed the `isBackground` guard was originally the middle statement of a three-statement branch whose other two (`runningBackground--`, `drainQueue()`) moved into `ConcurrencyLimiter` in `d5f116eb`.
  The guard inherited its condition by adjacency and was never a decision about events.
  Classified `fix:` on that basis.
- **Three successive design proposals of mine were wrong, each corrected by an operator question.**
  I proposed a structural predicate plus a temporal gate (two gates); the operator asked "what if we made it safe to always tell the parent?", which revealed the parent *is* always told and there are four carriers of which exactly one fires.
  I then proposed collapsing to one gate by claiming at commitment; checking `get_subagent_result` found that would regress documented abandoned-wait behavior and shrink every ask-back child's answerable window from 720 to 10 minutes.
  The settled model — a revocable carrier claim separate from the `consumedAt` latch — came from the operator's "distinguish the desired behaviors rather than complect them" framing, not from my drafts.
- **The codebase already held the vocabulary the design needed.**
  `spawnAndWait`'s doc comment says "The caller holds the result, which is a delivery commitment: the agent must not be queued and must not be announced."
  Both consequences were named; only the first was implemented properly.
  Three `markConsumed()` sites are each annotated "delivery edge".
  Reading for existing vocabulary before inventing a name saved a `deliveryMode` field that would have duplicated the already-public `isBackground`.
- **The Tidy-First assessor's one Recommended item was adopted as TDD step 1**, and its structural finding reshaped the design: the four carriers are not one formatter duplicated four ways but three status vocabularies and three truncation policies.
  That produced a gate the plan would otherwise have papered over, and surfaced a real defect — `get_subagent_result` reports nothing for an aborted child.
- **The assessor also made one overstated universal claim**, predicting a spurious nudge "the instant this guard drops."
  My own earlier trace showed the #661 withhold-and-flush machinery suppresses the common path; the assessor's conclusion (do not ship the guard drop alone) was right for a different reason — the interrupt edge.
  The plan records the real mechanism.
  This is the AGENTS.md rule about verifying a subagent's universal claims, confirmed in practice.
- **Measurements were re-run rather than quoted.**
  The plan labels two numbers measured (`Agent ID` ×2 in `foreground-runner.ts`, `available_skills` ×3 in `prompts.ts`) and the domain count 63 → 65; all three were verified with the roadmap's own recompute commands at the planning commit.
- **Scope pressure was real and mostly resisted.**
  The operator chose the larger carrier-unification option, and two new roadmap steps were opened rather than folding the discovered defects into this plan.
  The mid-run capability the issue's `pi-intercom` reference actually describes stayed a Non-Goal.

#### Deferred tidyings

- `src/lifecycle/subagent-manager.ts` — the assessor flagged `buildObserver`'s `onRunFinished`/`onResumeFinished` as two near-identical try/catch bodies differing only by method name, extractable into a `notify(label, fn)` helper once the guards are gone.
  Rejected as boy-scout cleanup: the duplication predates this change and is not friction the change introduces.
- `test/lifecycle/subagent-state.test.ts` and `test/lifecycle/subagent.test.ts` — the assessor considered nesting the flat `describe("SubagentState — X")` siblings into a unit→scenario tree before adding claim tests, and declined: the flat feature-prefix pattern is this file's established convention across 18 top-level describes, and a new claim sibling fits it exactly.

## Stage: Implementation — TDD (2026-09-01T04:57:37Z)

### Session summary

Executed all 8 TDD steps from the plan, plus two review-remediation commits — 11 commits total.
The suite went from 72 files / 1362 tests to 74 files / 1438 tests (+76).
Three pre-completion review rounds: WARN (5 findings), WARN (2 findings), then PASS.

### Observations

#### Deviations from the plan

- **The plan contradicted itself on `resetForResume` and the carrier claim, and step 3 exposed it.**
  Step 2 said `resetForResume` clears the claim; step 3 said `AgentTool` claims before `manager.resume(...)`.
  Both cannot hold, because `runResume` calls `resetForResume` synchronously before `resume()` returns, so the claim is wiped the instant it is set.
  Resolved with the operator by making the claim caller-scoped: `consumedAt` is run-scoped and records a delivery that already happened, so a resume must clear it, while a claim records one that has not happened yet.
  The step-2 commit was amended rather than corrected in a later commit.
  The gate was decided on two concrete scenarios rather than principle — an interrupted mid-resume turn (which the alternative loses) and a future non-delivering resume caller (fails safe versus fails silent).
- **No release in `runForeground`**, against the plan's claim/release table.
  `run()` swallows its error and resolves, so `spawnAndWait` always returns and `markConsumed()` is always reached — there is no abandonment window to detect, unlike `waitUntilSettled`, which genuinely races a signal.
  The plan's Design Overview row was corrected in the remediation commit.
- **`pendingQuestion` was added to `SubagentStateInit` after all**, though the claim deliberately was not.
  The distinction that emerged: outcome facts (like `result`) are seedable; transient runtime ownership is not.
- `test/composition-root.test.ts` was listed as a touch point but needed no change; `test/helpers/make-subagent.ts` was changed but not listed.
  The reviewer confirmed neither is a real gap.

#### Mutation testing found three plan predictions wrong

Each is a case where the plan's predicted red count did not match reality, and the mismatch was informative rather than a defect:

- Step 2's `release()` no-op mutation was predicted to kill the `resetForResume` test too.
  It did not — `resetForResume` clears the field directly rather than routing through `release()`, so they are two equivalence classes needing two mutations.
- Step 4's claim-gate mutation was predicted to leave the non-interrupted foreground test green on the surviving race.
  It killed both nudge tests, because `spawnFg` calls `spawnAndWait` directly and bypasses `runForeground`'s `markConsumed()`, so neither test has consumption to fall back on.
- Step 8's prompt mutation was predicted to kill the `replace`-mode test while `append` stayed green.
  It killed both — which is the evidence that step 1's Tidy-First extraction worked: there is no longer a per-branch site that can drift.

One scripted mutation silently matched nothing and the suite read green; the `assert` in the mutation script caught it.
Without that guard it would have read exactly like a mutation that killed nothing.

#### The parser was the riskiest surface

Writing the round-trip test ("the protocol block must not parse as a question") caught a real self-inflicted defect before it shipped: the protocol's prose interpolated the bare opening tag outside the fence, where it paired with the fenced closing tag.
The fix — name the marker without angle brackets in prose — is now documented at the declaration.

The reviewer then found the same failure mode in a class the plan's input domain missed: an inline code span.
Fixing it exposed a second defect the reviewer had not named — quoting was applied *after* building the block list, so a quoted opening tag had already consumed the closing tag of a genuine question that followed.

#### Review rounds

- **Round 1 — WARN, 5 findings.**
  One stale source comment, one missing README feature bullet, one unreworded tool guideline the plan's own Background cited as evidence of the problem, one stale plan row, and the inline-code-span parser gap.
- **Round 2 — WARN, 2 findings.**
  A documented per-line limitation, and a measured O(n²) in `nextUnquoted`: 50k inline-quoted mentions parsed in 1.25 s because each skipped candidate searched every quoted range.
  The operator chose to fix it in this issue.
  Sorting once and advancing a cursor made the same input parse in 26 ms.
- **Round 3 — PASS.**
  The reviewer differential-tested the cursor implementation against a naive reimplementation over 3009 generated inputs with zero mismatches, and verified the monotonic-query and disjoint-range assumptions the cursor rests on.

The adversarial re-derivation mandate earned its keep in every round.
Asking the reviewer to enumerate its own inputs rather than check mine is what surfaced both parser findings and the quadratic behavior.

### Pre-completion reviewer

PASS (round 3, `c902c9aa`).
No outstanding warnings; the two round-2 findings were fixed rather than deferred, and the one remaining documented limitation — a single-backtick span crossing a line break is not treated as quoting — is deliberate and stated in the code.

## Stage: Sync (worktree) (2026-09-01T05:05:47Z)

### Session summary

`pnpm run lint` and `pnpm fallow dead-code` both pass clean from the worktree root.
Release per the plan's marker: **ship independently** — no batch, no deferral.
Two follow-up issues are already filed and dispositioned against Phase 22 ([#857] as Step 10, [#858] as Step 11); nothing further to hand off at land time.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-465--/2026-08-31T16-17-09-642Z_01a0589c-3e0a-7b13-910e-d951776fb62e.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

Clean gates, nothing deferred.
The TDD stage note already captures the substantive decisions (the `resetForResume`/claim contradiction, the parser's inline-quoting fix, the O(n²) fix) for the root's final `/retro 465` to draw on.

## Stage: Final Retrospective (2026-09-01T15:04:05Z)

### Session summary

Landed `issue-465-pi-install-npm-pi-intercom` on `main` by fast-forward, verified CI, closed #465, released `pi-subagents` v21.2.0, and tore down the worktree.
The ship required no operator decision: the plan's `**Release:** ship independently` marker was read off the branch before any irreversible work, so the release gate never had to fire.
This entry synthesizes all four stages — planning, TDD, sync, and ship — from the peer session transcript and this one.

### Observations

#### What went well

- **Reading the release marker before the ff-merge cost one `git show` and removed the only decision point.**
  `/ship-worktree`'s ordering — locate the plan on the branch, read `**Release:**`, and ask only on `mid-batch — defer` — meant a clean ship ran end to end with zero interruptions.
  The marker had to be read from the branch (`git show "<branch>:<plan-path>"`) because the plan does not reach `main` until the merge two steps later, which the prompt calls out and which was in fact necessary here.
- **Model assignment tracked cognitive load across all four stages, and every stage is attributable from transcript labels.**
  Planning and TDD ran on `claude-opus-5` (design gates, mutation testing, parser work); the sync and ship stages ran on `claude-sonnet-5` (lint, rebase, ff-merge, release PR); this retrospective ran on `claude-opus-5`.
  No stage was over- or under-powered.
- **Mutation testing falsified three plan predictions, and one falsification was positive evidence rather than a defect.**
  Step 8's prompt mutation was predicted to kill the `replace`-mode test alone; it killed both modes, which is exactly the observable consequence of step 1's Tidy-First extraction removing the per-branch site that could drift.
  A passing suite could not have shown that; only a mutation whose prediction was wrong in the favorable direction could.
- **Anchoring the close comment on the plan commit gave the correct range on the first try.**
  `git log --oneline "$(git log --format='%H' --grep="docs: plan .*(#465)" -1)"^..HEAD` returned exactly this issue's 15 commits, with no sibling-issue bleed — the failure mode the package-tag anchor produces on a package that releases often.

#### What caused friction (agent side)

- `other` — `ci_watch`'s 300 s default sits below this repo's typical `main` CI duration, so the ship stage's first watch timed out and needed a second call.
  The run finished at roughly 315 s: the `check` job took about 150 s and `release-please` ran after it.
  This is systemic rather than a one-off — 5 of the last 12 `main` runs exceeded 300 s (336, 362, 337, 337, and 336 s), so a default-timeout watch on a `main` push times out about 40 % of the time.
  Impact: one wasted tool call and about 15 s; no rework, but it recurs on nearly every ship.
- `premature-convergence` (retro stage, twice, both times corrected by the operator) — asked whether CI times were trending up, I reached a conclusion from measurement twice before reading the history that explained it.
  The trend is real: median `main` CI duration rose monotonically from 224 s (Aug 27) to 314 s (Sep 1), tracking the `release-please` job's climb from 78 s to 137 s.
  **First attempt** — I proposed filing an issue against the baseline itself, before reading [#816]'s plan.
  **Second attempt** — pushed back with "we've fixed this before", I read the plan, over-corrected to "documented, accepted cost, nothing to file", and told the operator no issue was warranted.
  Both were wrong, and the operator's second push (that the four packages pinning the floor are rarely updated) is what forced the measurement that settled it: the baseline's depth was **1 commit** on every advance through Aug 24, jumped to 169 the moment [#816] landed on Aug 27, and is 434 now.
  The pre-[#816] write-back advanced the floor to whichever component released *last* — too recent, so commits from a dormant component's true last release were collected by nobody.
  That is the bug [#816] fixed, so the fast CI was the defect's side effect and not a solution to restore.
  What is genuinely unpriced is [#816]'s risk table treating a stalled baseline as an anomaly; a stalled floor is the normal state whenever the oldest component is dormant, and none of the four has pending commits or an open release PR.
  Filed as [#865] with a `scope:repo` label.
  Impact: no rework, but two wrong conclusions delivered to the operator before the decisive measurement, and the issue would have gone unfiled on either of them.
  The pattern in both: I treated a plan's prose ("the bound is free", the risk table) as settling a quantity that only a measurement over time could settle, and I treated my own fresh measurement as settling a causal question that only the history could settle.
- `other` — I read `git rev-parse HEAD` output as 41 characters, doubted a well-formed SHA, and spent a `wc -c` call disproving my own miscount.
  Impact: one wasted tool call, no rework.
- `other` (TDD stage) — the plan specified the carrier claim's lifecycle across two separate steps that contradicted each other.
  Step 2 said `resetForResume` clears the claim; step 3 said `AgentTool` claims before `manager.resume(...)`; both cannot hold, because `runResume` calls `resetForResume` synchronously before `resume()` returns, wiping the claim the instant it is set.
  The contradiction was invisible while each step was read on its own and surfaced only when step 3 executed.
  Impact: step 2's commit was amended rather than corrected later, plus an unplanned design gate mid-implementation.

#### What caused friction (user side)

No friction — the operator's interventions were the highest-leverage contributions to the issue.
Three successive design proposals of mine were wrong, and each was corrected by a redirecting question rather than a directive: "what if we made it safe to always tell the parent?"
revealed that the parent *is* always told by exactly one of four carriers, and "distinguish the desired behaviors rather than complect them" produced the revocable-claim-versus-`consumedAt`-latch split that the final design rests on.
Those arrived at the design gate, which is where they belong.

One opportunity: the operator's own earlier comments on this third-party issue had already narrowed its literal ask twice, and planning recovered that only by reading [#798]'s close comments.
Surfacing that narrowing at dispatch time would have saved the rediscovery, though the rediscovery was cheap and produced a better-grounded plan.

### Diagnostic details

- **Model-performance correlation** — four stages, no mismatch.
  `claude-opus-5` ran planning, TDD, and this retrospective (judgment-heavy: design gates, mutation testing, the parser, cross-stage synthesis); `claude-sonnet-5` ran sync and ship (procedural: lint, `fallow`, rebase, ff-merge, release-PR verification).
  The three `pre-completion-reviewer` dispatches during TDD did judgment-heavy work — one of them differential-tested a cursor implementation against a naive reimplementation over 3,009 generated inputs — and were correctly not downshifted.
- **Escalation-delay tracking** — no `rabbit-hole` points; the longest same-target sequence in the ship stage was two consecutive `ci_watch` calls, well under the five-call threshold.
- **Unused-tool detection** — the CI-trend misdiagnosis above is a `missing-context` point with an obvious unused instrument: `grep -rln 'last-release-sha' docs/plans/ packages/*/docs/plans/` would have surfaced [#816]'s plan in one call, before the first proposal rather than after the first pushback.
  I ran four `gh`/`git` measurement commands first and the history search only when challenged.
  The instrument that finally settled it — replaying `last-release-sha` across its own commit history to get the depth per commit — was available from the start and is what should have run first, since the question was causal rather than quantitative.
- **Shell-trap recurrence** — two `AGENTS.md`-documented shell traps fired in this stage while I was chasing that measurement: an unquoted parameter not word-splitting under zsh (`for h in $SHAS` passing the whole list as one filename), and a `git show` inside a `while read` pipeline consuming the loop's stdin.
  Both are already written down; both cost a retry each.
  Reaching for Python on the third attempt is what worked, and is the cheaper first move for anything that loops over SHAs.
- **Feedback-loop gap analysis** — no gap.
  The TDD stage bundled `pnpm run check`, `test`, `lint`, and `fallow dead-code` into a single repeated command after each step rather than deferring them to the end, and the sync stage re-ran the two CI-gating checks before the branch left the worktree.

### Changes made

1. `.pi/prompts/ship-worktree.md` — step 4 now passes `timeout: 600` to `ci_watch`, with a one-clause note that `check` plus `release-please` exceeds the 300 s default about half the time.
2. `.pi/prompts/ship-issue.md` — same `timeout: 600` at both `ci_watch` sites (step 4's CI verification and step 6b's post-release verification).
3. `.pi/prompts/ship-no-issue.md` — same `timeout: 600` at its single `ci_watch` site.
4. `.pi/prompts/plan-issue.md` — added a TDD Order rule: a new mutable field's whole lifecycle (set, cleared, read) belongs in one step's description rather than one transition per step.
5. Filed [#865] (`scope:repo`) — the `release-please` walk depth grows without bound while the oldest component is dormant, carrying the depth-over-time table, the CI-duration trend, and three candidate directions.
   `roadmap-fit` exits at Step 1: the issue has no `pkg:*` label, and the roadmap's [#451] entry establishes that repo-level CI tooling takes `scope:repo` precisely to leave the per-phase sweep.

Considered and rejected: a package-skill note that documenting an in-band marker makes the document an input to its own parser (already documented at the declaration in `src/session/ask-back.ts`), and removing `/retro`'s legacy `## Stage: Ship (worktree)` compatibility note (seven retro files still use that spelling).

[#451]: https://github.com/gotgenes/pi-packages/issues/451
[#798]: https://github.com/gotgenes/pi-packages/issues/798
[#816]: https://github.com/gotgenes/pi-packages/issues/816
[#857]: https://github.com/gotgenes/pi-packages/issues/857
[#865]: https://github.com/gotgenes/pi-packages/issues/865
[#858]: https://github.com/gotgenes/pi-packages/issues/858
