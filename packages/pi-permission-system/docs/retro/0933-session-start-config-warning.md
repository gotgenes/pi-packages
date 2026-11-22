---
issue: 933
issue_title: "pi-permission-system: a config warning present at session start is never shown"
---

# Retro: #933 — pi-permission-system: a config warning present at session start is never shown

## Stage: Planning (2026-09-20T04:45:02Z)

### Session summary

Reproduced the swallowed config warning through the real composition root before designing: a global config of `{"permission": {"*": "allow"}}` with a `hasUI: true` ctx produced **0** `ui.notify` calls across `session_start` + `before_agent_start`.
The operator's first gate answer was a question about ownership rather than a selection, which redirected the design from a three-line dedupe patch to a seam move: `ConfigStore` answers its issues, a new `ConfigIssueReporter` owns the latch and delivers through `logger.warn`, driven at both `session_start` and every `before_agent_start`.
Plan committed as `packages/pi-permission-system/docs/plans/0933-session-start-config-warning.md` — five TDD steps, lift-and-shift ordered so no commit leaves a config warning without a delivery path.

### Observations

- **The first gate was premature.**
  It offered three fix shapes without establishing who owns operator-facing warnings in this package.
  Answering the ownership question produced the finding the option set lacked: `ConfigStore.refresh:122` is the *only* session-lifecycle warning that reaches `ctx.ui.notify` directly — measured against 10 `ui.notify` hits in `src/`, the other nine being a command ctx, a gate ctx, or `PermissionSession.notify` itself.
  That direct reach made a ctx *parameter* the delivery channel, which is the defect's enabling condition, not an implementation detail.
- **Rejected: the minimal delivery-gated dedupe.**
  Spiked and measured — exactly 1 notify, full suite green with zero test edits (166 files / 4523 tests).
  It works, and it leaves the notification lifecycle inside a config holder.
  Rejected on ownership, not correctness.
- **Rejected: driving the reporter from `ConfigStore.refresh` itself.**
  Needs no handler changes and reintroduces the bug: `refresh` runs at factory time and again at `handleSessionStart` *before* `resetForNewSession`, so `session.context` is null at both and `logger.warn` has nowhere to go.
  Verified `resetForNewSession` → `activate` → `this.context` is what makes the adjacent policy-issue loop work.
- **Rejected: driving from turn prep alone.**
  `before_agent_start` fires after the user message is pushed (`../../pi/packages/coding-agent/src/core/agent-session.ts:1390-1406`), so a startup warning would wait for the operator's first prompt.
- **Rejected: wiring the reporter through `PermissionSession`.**
  It would spare the handlers a new dep at the cost of a fourth pure config relay on a seven-dep aggregate.
- **Mid-session re-warn is load-bearing per the operator:** "given that we refresh mid-session, we must therefore keep the user informed if they create an issue with the config mid-session."
  That fixed the latch's home (a collaborator both drivers share) rather than letting it dissolve into a once-per-session report.
- **Latch semantics chosen: latch while present.**
  Replacing `reported` with the current set each report — not accumulating into it — preserves today's clearing behavior at per-issue granularity, so an issue that disappears and returns warns again.
- Measured the notification ceiling at **3** (one per cross-cutting detector) so the per-issue split replacing the `\n`-joined blob could be priced rather than asserted.
- No existing test pins the swallow — the minimal-fix spike went green with zero edits.
  Every candidate design therefore needs a new end-to-end pin; the plan's counts notifications across two `before_agent_start` fires so the latch's absence is caught too.

#### Deferred tidyings

The Tidy-First assessor recommended no preparatory commits and declined four candidates:

- `src/handlers/lifecycle.ts`, `src/handlers/session-turn-prep.ts` — converting positional constructors to a deps-object; positional is the `src/handlers/` convention across all four classes, and the design-review five-field trigger is about a shared dependency interface, not per-class arity.
- `test/handlers/lifecycle.test.ts`, `test/handlers/session-turn-prep.test.ts` — reshaping `makeSetup` / `makeTurnPrep` into options-bags; one call site each, so no repeated-edit pain to prepare for.
- `src/config/config-store.ts` — decomposing `refresh`'s five jobs (load, normalize, status sync, issue capture, debug log); at 33 lines with a surgical edit ahead of it, and no caller needs the steps split.
- `src/config/config-issue-reporter.ts` vs `src/authority/authorizer-chain-audit.ts` — merging the two warn-once latches into a shared base; same shape, different semantics (the audit never re-arms, the reporter re-warns after an issue returns).

Two corrections it returned that the plan absorbed: `docs/architecture/architecture.md:934`'s `lifecycle.ts` entry already omits `logger`, the existing fourth dep, independent of this issue (folded into step 3); and `ConfigStore.getConfigIssues()` will share a name with `PermissionResolver.getConfigIssues(agentName?)`, recorded as an Open Question rather than a rename in scope.

## Stage: Planning — amendment (2026-09-20T15:36:25Z)

### Session summary

After the plan was committed, the operator asked what disagreements I had with my own design and whether it complected the system.
Answering that honestly surfaced five smells the first pass left behind; running them through Tidy First's four bins turned two into preparatory `refactor:` steps, one into a filed follow-up ([#953]), one into a delivery-shape correction, and one into a deliberate "tidy never".
The plan was rewritten from five steps to seven and recommitted; the roadmap disposition for [#953] was recorded against Phase 15 as out of scope.

### Observations

- **The Tidy-First assessor answers the question it is asked.**
  Its "no preparatory tidying" verdict was correct for the question — friction in the edit — and the edit was already easy.
  The smells that mattered were *design residue* the fix would leave behind, which only became visible once I was asked to disagree with the settled design.
  Asking the assessor a second question ("what does the change leave half-done?") may be worth adding to its prompt.
- **Tidying 1 — activate before refresh.**
  `handleSessionStart`'s `refreshConfig` → `resetForNewSession` order was pinned by a characterization test with no recorded rationale (traced through #331, #341, #644 — the last says only "preserved").
  Spiked the swap: 4522 green, one red (the pin).
  Every side effect of `resetForNewSession` was read before adopting; `configureForCwd` reads no extension config and the authorizer chain is read per ask.
  Adopted; the pin is inverted with its reason.
  This removed the ordering constraint and killing mutation the first plan carried, and left both drivers with the same `refresh → report` shape.
- **Tidying 2 — status sync leaves the load.**
  `ctx` on `ConfigStore.refresh` gated two UI side-effects, not one; the first plan removed the notify and left the status sync, keeping the smell's shape.
  Moved to `PermissionSession.refreshConfig`, the point both drivers already call, rather than duplicated into two handlers (#746's rule).
  Sequenced so `ctx` stays on `refresh` until the removal step — deleting it earlier would take the old notify with it and open a delivery gap.
- **The Non-Goal I wrote was inconsistent with the operator's own principle.**
  "Don't unify the policy-issue loop" was justified by "it would newly re-warn policy issues mid-session" — which is exactly what the operator had just said must happen for config issues.
  Tidy First's answer: it changes behavior, so it is not a tidying and cannot ride the fix; file it.
  Filed as [#953] with the agent-name question and the `getPolicyIssues` rename attached.
- **Per-issue notification was a UX change hiding in a `fix:`.**
  Corrected to latch per issue, deliver one joined message per report — today's one-notification UX with a finer latch.
  Pure structure.
- **Tidy never:** a `warnOnce` primitive on `SessionLogger`.
  Fourth hand-rolled latch, but the logger is untouched by this change, so tidying it makes nothing easier.
  The fifth instance pays for it.
- **Ownership question at the first gate.**
  The operator answered the fix-shape gate with "who really wants to own this behavior?" — a question, not a selection, which the `clarification-gates` skill reads as a premature gate.
  It was: the option set assumed the store owned notification.
  The grep that answered it (10 `ui.notify` sites; one session-lifecycle outlier) should have preceded the gate.

#### Deferred tidyings

- `src/logging/session-logger.ts` — no tell-once affordance on `SessionLogger.warn`; four consumers hand-roll a latch (`PermissionSessionLogger.reported`, `AuthorizerChainAudit`, `ChildNodeAudit`, `ConfigIssueReporter`).
  Not touched by this change; revisit at the fifth.

## Stage: Implementation — TDD (2026-09-20T16:22:25Z)

### Session summary

Executed all seven steps of the amended plan as eight commits (the last step split a doc fix from a skill fix).
The two Tidy First preparations landed first: `handleSessionStart` now activates before refreshing, and the status-bar sync moved from `ConfigStore.refresh` to `PermissionSession.refreshConfig`.
`ConfigStore` now loads and answers `getConfigIssues()`; `ConfigIssueReporter` owns the latch and delivers through `logger.warn`, driven at `session_start` and every `before_agent_start`.
Test count 4523 to 4540 (+17); `refresh`'s first parameter is now a `cwd` string, so the swallowing notify is unrepresentable in that method.

### Observations

- **The tidyings paid off exactly as predicted.**
  Tidying 1 deleted a constraint the first plan had to pin with a comment and a killing mutation: once activation precedes the refresh, there is no ordering for `report()` to get wrong.
  Tidying 2 left `ctx` with a single reader in `refresh`, so step 6's parameter removal was mechanical and `tsc` found every site.
- **The parameter removal is the real guard.**
  Verified by mutation: adding `ctx?.ui.notify("reintroduced", "warning")` back inside `refresh` now fails with `TS2304: Cannot find name 'ctx'`.
  The defect is structurally unrepresentable rather than merely absent.
- **A predicted mutation did not fire.**
  The plan said deleting the `session_start` drive would redden the end-to-end pin; it did not, because that pin fires both moments and turn prep alone satisfies it.
  Only the #927 retarget caught it, incidentally.
  Added a `session_start`-only pin so the drive is covered directly.
  This is the "count the reds against the prediction" rule earning its place — the coverage existed, but not where the plan claimed.
- **Two tests stayed green during their Red step** (the `hasUI: false` status case and the mid-session notification).
  Both were mutated explicitly rather than assumed sound; mutation A on the `hasUI` guard and the store-side restore each killed the right one.
- **The mid-session exactly-once pin had to move a step later.**
  Between steps 5 and 6 both the reporter and the store's surviving notify deliver, so the count is two — the transient duplication the lift-and-shift sequencing accepted.
  The plan placed the pin in step 5, where it cannot hold.
  Sequencing was right; the pin's placement was not.
- **Deviation the plan under-listed:** the #644 trust-gating assertions in `lifecycle.test.ts`, `session-turn-prep.test.ts`, and `permission-session.test.ts` assert `refresh`'s arguments, so all six moved from `ctx` to `ctx.cwd`.
  The plan listed only the `session-fixtures` stub for that cascade.
  Each still pins the trust flag, and mutating the cwd away reddens all six.
- **Deviation:** step 7's verify criterion (`grep "933"` in `src`/`test` returns nothing) was over-broad.
  It targeted the stale defect description, which is gone; the surviving `(#933)` citations are provenance for live constraints (the ordering, the ctx-free load, the latch), which the convention keeps.
- **The plan's predicted-unchanged table was wrong about the package skill.**
  It enumerates `handler-fixtures`' exports, so adding `makeConfigIssueReporter` left it incomplete — caught in the post-step cross-check, not by any gate.
- Two Biome **warnings** (exit 0) appeared from orphans the change created: `composition-root`'s `readDebugLog` lost its last caller when the #927 test was retargeted, and `session-fixtures` lost its `ExtensionContext` import.
  Counting `lint/` occurrences rather than trusting the exit code is what surfaced them.
- Health score unchanged at 78 B; no clone group under `config/`, so the new module added none.

### Reviewer verdict

Pre-completion reviewer: **PASS** — ready for `/ship`.
It independently re-derived all four mandated invariants, confirmed `save()` and `handleResourcesDiscover` never delivered these issues (so nothing lost a notification), and confirmed the reporter is factory-scoped so its latch cannot leak across same-cwd session switches.
No warnings.

[#953]: https://github.com/gotgenes/pi-packages/issues/953

## Stage: Sync (worktree) (2026-09-20T16:29:16Z)

### Session summary

Pre-push checks (`pnpm run lint`, `pnpm fallow dead-code`) both passed clean with no changes needed.
The plan's `**Release:** ship independently` marker holds — not part of any batch, no dependency on a sibling package.
A follow-up ([#953], the sibling policy-file-issue accumulation) is filed and dispositioned against Phase 15 as out of scope; nothing else was deferred.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-933--/2026-09-20T01-16-10-377Z_01a0bc62-8d09-7608-8a3e-0a7e57cf11bd.jsonl` — read with `read_session_file({ path: "..." })` for message-level verification at land/retro time.

### Observations

Rebase onto local `main` is the next step; no conflicts anticipated — this branch's commits touch only `packages/pi-permission-system/` and `.pi/skills/package-pi-permission-system/SKILL.md`.

## Stage: Final Retrospective (2026-09-20T16:50:49Z)

### Session summary

Issue #933 ran the full worktree lane across four stages: planning plus a Tidy First amendment and TDD in the peer session, then sync, then ship and this retrospective at the root.
It landed as eight commits and released `pi-permission-system` v33.0.4, with CI and the release run green on the first attempt and no rework at any stage boundary.
The retrospective's two findings are a measured non-ASCII dropout in authored prose that cost four repair rounds, and evidence that the `tidy-first-assessor` returns an empty verdict because of the question it is asked rather than the code it reads.

### Observations

#### What went well

- **The Tidy First amendment is the strongest result in the issue, and it is measured rather than asserted.**
  The amendment turned a five-step plan into seven by adding two preparatory `refactor:` commits.
  The TDD stage then confirmed both predictions: tidying 1 deleted an ordering constraint the first plan had to pin with a comment and a killing mutation, and tidying 2 left `ctx` with a single reader so step 6's parameter removal was mechanical and `tsc` found every site.
  A preparatory refactoring that is verified to have paid off after the fact is rare; this one is worth citing as the reference example.
- **Mutation discipline caught a coverage claim the plan got wrong.**
  The plan predicted that deleting the `session_start` drive would redden the end-to-end pin.
  It did not, because that pin fires both moments and turn prep alone satisfies it.
  Counting reds against the prediction, rather than accepting a green suite, is what surfaced the gap, and a `session_start`-only pin was added to cover the drive directly.
- **The worktree convergence ran without a single retry.**
  The ff-merge was predicted with `git merge-base --is-ancestor` before it was run, the one rebase conflict on `architecture.md` fell squarely under the add-only `[#N]:` exception and was resolved ascending, and the post-rebase `check` plus `test` confirmed the tree the root would actually merge.
  The `/ship` lane then ran all thirteen steps with no correction.

#### What caused friction (agent side)

- `other`: **em-dash dropout in authored prose, at the tool-call boundary rather than in the `Edit` tool.**
  Across the peer session's 24 markdown `newText`/`content` blocks, only 7 carried a literal em-dash, and 11 mid-sentence occurrences of a bare space-newline-space appear where one was intended.
  Inspecting the raw session payload settles the mechanism: the heading arrived as `'## Stage: Implementation \n TDD'`, so the character was already gone when the model emitted the call, and the `Edit` tool applied faithfully what it was given.
  The damage is silent, because the result is valid markdown that `rumdl` accepts: `"holds ot part of any batch"`, `"**PASS** ready for /ship"`, and a stage heading split across two paragraphs all passed lint.
  Impact: four separate `python3` repair rounds across the TDD and sync stages, each preceded by a `sed`-based re-read to find the damage, for roughly 15 tool calls that produced no forward progress.
  Both `claude-opus-5` and `claude-sonnet-5` hit it in the same session, so it is not model-specific.
  This retrospective's own first append attempt failed the same way, in `oldText` this time, which is how the `edit-tool` half of the proposal below was found.
  A related incident is already on file from #814 (stray CJK characters appearing in a test comment, caught only by re-reading), which makes this a recurrence class rather than a one-off.
- `missing-context`: **the `tidy-first-assessor` asked only half the question.**
  Dispatched during planning, it returned no preparatory commits and declined four candidates, each with defensible reasoning for the question its prompt poses.
  Step 1 of its definition says it is looking for friction the change will hit, and the edit genuinely was easy at three lines.
  The two tidyings that mattered were invisible to that question because they were design residue the fix would leave behind, not friction in the edit.
  They surfaced only when the operator asked the main agent what disagreements it had with its own design.
  Impact: no rework, but the plan was written, committed, and then rewritten from five steps to seven, and the second pass is where the issue's best work came from.
- `other`: **an `Edit` mismatch rate of 12 rejections across 75 calls (16%) in the peer session.**
  Only one of the twelve traces to the em-dash dropout above, an `architecture.md` tree line whose `oldText` carried the same corruption; the other eleven are ordinary stale-anchor mismatches.
  Impact: added friction with no rework, since each retry succeeded after a `Read`.
  Recorded as a measurement rather than a proposal, because there is no baseline for this repo to say whether 16% is anomalous.
- `other`: **a self-inflicted status-reporting trap in the ship lane.**
  I ran `pnpm run lint >/tmp/lint.log 2>&1 || tail -30 /tmp/lint.log; echo "lint exit: $?"`, where `$?` reports the status of the `||` compound and is therefore always zero.
  Self-identified: I did not trust it and followed with `grep -c 'lint/'`, which is the check that actually held.
  Impact: one wasted tool call and no rework, but the printed `lint exit: 0` would have been a false reassurance had I stopped there.

#### What caused friction (user side)

Both operator interventions in this issue were high-leverage, and neither was a correction.

- At the planning gate, the operator answered a three-option fix-shape menu with a question about ownership rather than a selection.
  That redirected the design from a three-line dedupe patch to the seam move that shipped.
  The `clarification-gates` skill already reads a question-in-place-of-a-selection as a premature gate, and this instance confirms it: the grep that answered the question, 10 `ui.notify` sites with one session-lifecycle outlier, should have preceded the menu.
- After the plan was committed, the operator asked what disagreements the agent had with its own design and whether it complected the system.
  This produced the amendment and the two tidyings that the TDD stage then measured as paying off.
  The opportunity is not that the operator should have said this earlier; it is that this question is generalizable and currently has no owner in the workflow.
  The `tidy-first-assessor` is the natural home for it, which is the proposal below.

### Diagnostic details

- **Model-performance correlation**, attributed from the session transcripts rather than from the agent definitions.
  Peer session: planning, the amendment, and all seven TDD steps ran on `anthropic/claude-opus-5`, which suits judgment-heavy design and mutation work; the sync stage ran on `anthropic/claude-sonnet-5` and handled a non-trivial rebase conflict correctly.
  Root session: `/ship` on `claude-sonnet-5`, which is mechanical and appropriate, and this retrospective on `claude-opus-5`.
  Both subagents ran on `claude-sonnet-5` per their definitions.
  The `pre-completion-reviewer` (54 turns) independently re-derived all four mandated invariants and returned a clean PASS, which is strong work for the model.
  The `tidy-first-assessor` (25 turns) returned an empty verdict whose cause the friction entry above attributes to its prompt rather than its model.
  One session is not enough to separate those two explanations, so no model change is proposed.
- **Escalation-delay tracking**: two sequences exceeded five consecutive calls on the same problem, both in the em-dash class.
  Repairing the `architecture.md` module tree took roughly eight calls: a rejected `Edit`, a successful one that inserted stray blank lines, two `sed` reads, a `python3` repair, then re-verification.
  Repairing the retro file's TDD stage notes took a similar run across three `python3` rounds, because each round fixed only the damage the previous re-read had revealed.
  Neither warranted a subagent; the correct escalation was to stop retrying `Edit` and verify the written region once, comprehensively, which is what the proposal below encodes.
- **Feedback-loop gap analysis**: no gap, and this is the counter-example worth recording.
  Every TDD step ran `pnpm run check` plus the package suite before its commit, each step's mutations were executed and their reds counted against the plan's predictions, and `lint` warnings were counted with `grep -c 'lint/'` rather than trusted to the exit code, which surfaced two orphans that an exit code of zero would have hidden.
  The `lint` and `fallow dead-code` gates then ran again at `/sync-worktree` and a third time at `/ship` on the post-merge tree.
- **Unused-tool detection**: nothing notable.
  No friction point in this issue would have been resolved by a subagent or search tool that was available and not dispatched.

### Changes made

1. `.pi/skills/markdown-conventions/SKILL.md`: added a `### Non-ASCII in authored prose` subsection stating that an em-dash in a `newText`/`content` body can arrive as a bare newline, that the result passes `rumdl`, and that the region should be scanned after writing with `rg -n --multiline ' \n [a-z]' <file>`.
2. `.pi/skills/edit-tool/SKILL.md`: extended the anchoring guidance so an `oldText` spanning any non-ASCII character must be copied from a fresh `Read` rather than retyped.
3. `.pi/agents/tidy-first-assessor.md`: added `## Step 2b: Ask what the change leaves behind`, which asks what the change leaves half-done alongside Step 2's question about what makes it easier, and routes the answer to a preparatory tidying or a filed follow-up.

Both skill edits were themselves damaged on their first write, which is the finding reproducing under its own rule.
The `edit-tool` sentence landed with literal `\u2502` and `\u2026` escapes instead of characters, and the `markdown-conventions` scan command landed with a backtick inside a single-backtick code span.
The detection command was verified against a synthetic fixture before being written into the rule, and all four touched files were then scanned clean and pass `pnpm run lint` with zero warnings.
