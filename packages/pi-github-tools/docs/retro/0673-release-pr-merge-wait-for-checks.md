---
issue: 673
issue_title: "release_pr_merge fails on a still-running check instead of waiting for it"
---

# Retro: #673 — release_pr_merge fails on a still-running check instead of waiting for it

## Stage: Planning (2026-08-04T20:26:58Z)

### Session summary

Planned `packages/pi-github-tools/docs/plans/0673-release-pr-merge-wait-for-checks.md`: turn `mergeReleasePR`'s single-shot merge-state read into a bounded poll loop that waits out in-progress checks, backed by a new pure `src/lib/merge-state.ts` classification module.
Measured the real check timings on the last six release PRs before framing the design, then used a four-question `ask_user` gate to settle mechanism, empty-rollup behavior, `UNKNOWN` handling, and doc-cleanup scope.
Four TDD steps, no follow-up issues filed.

### Observations

- **Measurement overturned a premise.**
  Every ship prompt in the repo asserts that release-please PRs get no CI runs because the default `GITHUB_TOKEN` does not trigger workflows.
  Measured against PRs 685, 682, 679, 677, 672, and 668: all six had a real `check` run, starting 5–11 s after PR creation and taking 1 m 49 s – 2 m 29 s.
  The "no checks" case is now the exception, not the norm — which is exactly why the `UNSTABLE` friction keeps recurring.
- **The `SKIPPED` trap.**
  The `release-please` and `publish` jobs conclude `SKIPPED` on every release PR.
  A naive "conclusion is not `SUCCESS` implies failure" classification would have hard-failed every merge the tool exists to perform.
  This was only visible because the rollup was read from live PRs rather than reasoned about abstractly.
- **The issue's follow-on-cleanup claim does not survive the operator's choice.**
  The issue predicted the `gh pr merge --rebase` fallback "can go away entirely".
  The operator chose to keep erroring on an empty rollup (with a new `reason:` line) rather than auto-merging, so the fallback stays; only the manual `gh pr checks --watch` wait runbook is removed.
  The plan states this divergence explicitly so the doc step is not written against the issue's prediction.
- **Rejected `gh pr checks --watch`** (the issue floated it as a one-subprocess shortcut): `runCommand` buffers stdout until exit, so nothing would stream to `onProgress`; there is no timeout flag; and exit code `1` conflates "a check failed" with "no checks reported" — the exact distinction the issue exists to draw.
- **`UNKNOWN` was added to scope** on the operator's call, conditioned on the timeout bound.
  `release_pr_find` returns the instant a PR appears, so `mergeable: UNKNOWN` is the same race as the check race, from the same cause.
- Related open issue [#564] (repeated run/job status derivation across the `ci` modules) is deliberately not folded in: this change adds a site with GitHub's upper-case GraphQL enum vocabulary, while [#564] covers six lower-case REST-vocabulary sites.
  Noted for [#564] to absorb later.
- The change gives `formatProgress`'s `prefix` parameter its first production caller; today only a test exercises it.

[#564]: https://github.com/gotgenes/pi-packages/issues/564

## Stage: Implementation — TDD (2026-08-04T20:50:16Z)

### Session summary

Implemented the plan in 4 TDD cycles plus a docs commit, preceded by 2 Tidy-First preparatory `refactor:` commits (`performMerge`/`blockedResult` extraction) recommended by the `tidy-first-assessor`.
`mergeReleasePR` is now a bounded 10 s-interval poll loop dispatching on a new pure `classifyMergeState` (in `src/lib/merge-state.ts`) that normalizes GitHub's `statusCheckRollup` into the existing `CIJob` vocabulary and reuses `formatProgress`.
Test count in `pi-github-tools` went from 82 to 112 (+30: 24 in the new `merge-state.test.ts`, 6 net new in `release.test.ts`); full monorepo suite stayed green throughout (2672 + 1135 + others, no regressions).

### Observations

- **Tidy-First paid off exactly as predicted.**
  The assessor's two recommended extractions (`performMerge`, `blockedResult`) landed as pure no-behavior-change moves verified by the *existing* tests, before the loop rewrite.
  The subsequent feature commit (`feat: wait out in-progress checks`) was then a clean diff: wrap in a loop, classify, switch — no subprocess-call relocation mixed in.
  This also retired the plan's own named risk (signal relay dropping during the `performMerge` move) *before* the riskier rewrite landed on top.
- **The `FAILING_STATUS_CONTEXT_STATES` false start.**
  First draft of `classifyMergeState` declared a separate `FAILING_STATUS_CONTEXT_STATES` set for `StatusContext`'s `FAILURE`/`ERROR` states, then discovered `toCIJob` already normalizes `StatusContext`'s `state` into the same lowercase `conclusion` vocabulary as `CheckRun` — so the separate set was dead weight requiring a `void` no-op to silence the unused-variable lint.
  Caught it before committing (the `void FAILING_STATUS_CONTEXT_STATES;` line was a smell in its own right) and merged "error" into the single `FAILING_CONCLUSIONS` set instead — five lines simpler, same coverage, no lint workaround needed.
  Worth naming: a hand-rolled unused-variable suppression during implementation is a signal to re-derive the normalization, not to silence the linter.
- **Pre-completion reviewer caught a real gap.**
  The plan's "Invariants at Risk" section explicitly committed to a test asserting `sleep` receives the `signal` during the new wait path.
  That assertion was never actually written — the abort test asserted the *aborted result*, not that `sleep` was called with the real signal.
  Reviewer returned WARN with this single finding; fixed by adding `expect(mockSleep).toHaveBeenCalledWith(10000, controller.signal)`, folded into the original feature commit via `git commit --fixup` + `git rebase -i --autosquash` (unpushed, so no history-cleanliness cost) rather than a `test:` commit.
  The gap was real but non-blocking: production code already threaded the signal correctly, so this was a coverage hole, not a behavior bug.
- **Docs step touched both passages in all three prompts as the plan anticipated.**
  `ship-issue.md`, `land-worktree.md`, and `ship-no-issue.md` each state their `UNSTABLE` handling twice (a numbered step + a Constraints bullet); both were updated together in each file, verified by grep afterward — no stale `UNSTABLE` references remain in any living doc (historical retro entries in other packages that describe the old manual runbook were left alone, correctly, as session logs).
- No deviations from the plan's TDD Order or Module-Level Changes list; every planned file was touched, nothing extra.
- Pre-completion reviewer: WARN → fixed → all deterministic checks (`pnpm run check`, `pnpm run lint`, `pnpm run test`, `pnpm fallow dead-code`) pass after the fix.

## Stage: Final Retrospective (2026-08-04T21:25:27Z)

### Session summary

Planned, implemented, and shipped this issue end to end in a single session: `release_pr_merge` now waits out an in-progress check or an undecided `UNKNOWN` mergeability state instead of failing immediately, released as `pi-github-tools-v4.2.0`.
The work spanned 4 TDD cycles, 2 Tidy-First preparatory refactors, and a docs commit that removed the manual `gh pr checks --watch` runbook from three workflow prompts and `AGENTS.md`.
The defining irony of the session: the ship step could not use the fix it had just shipped, because Pi had loaded `release_pr_merge` at session start.

### Observations

#### What went well

1. **Measurement overturned a documented premise — twice.**
   At planning time, reading `statusCheckRollup` off the last six release PRs disproved the "release-please PRs get no CI runs" note that every ship prompt carried, and surfaced the `SKIPPED`-conclusion trap that would have hard-failed every merge.
   The same instinct fired again during this retro: before proposing a factual correction to `AGENTS.md`'s claim that "`rumdl fmt` does not re-pad tables for you," I built two fixture tables and ran the formatter — which **confirmed the existing rule** and killed the proposal.
   Verifying before proposing is now the pattern that has paid off at both ends of this issue.
2. **Tidy-First retired the plan's own named risk before the risky change landed.**
   The `tidy-first-assessor` recommended extracting `performMerge` and `blockedResult` as pure moves first.
   Because both landed against the *existing* signal-threading test, the plan's named risk ("moving the merge calls into `performMerge` could drop the `signal` relay from [#5]") was retired before the loop rewrite was written on top of it.
   The subsequent feature diff was genuinely small: wrap in a loop, classify, switch.
3. **The stale-prompt-expansion rule fired on a self-edited prompt.**
   `/ship-issue`'s pasted body still contained the `UNSTABLE`/`gh pr checks --watch` runbook this very session had just replaced.
   Reading the on-disk file first (per `AGENTS.md`) caught it immediately — the first observed instance of that rule mattering because *this session* was the one that made the prompt stale.
4. **`pre-completion-reviewer` caught a plan-to-code gap all four deterministic gates missed.**
   The plan's "Invariants at Risk" section committed to a test asserting `sleep` receives the `signal`; that assertion was never written.
   `check`, `lint`, `test`, and `fallow dead-code` were all green over the gap — only a reviewer reading the plan against the diff could find it.
5. **Verification ran incrementally, not just at the end.**
   `pnpm run check` plus the package suite ran after every TDD step, and root-level `pnpm run lint` ran after each of the two Tidy-First commits and each feature commit — not only at the cycle end.

#### What caused friction (agent side)

1. `missing-context` — **Dismissed the user's correct prediction that a reload was needed.**
   The user asked, before the release step, "Do we need to pause and reload to use this tool now?"
   I answered "No — nothing here requires a pause or reload" and continued.
   Pi loads each extension once at session start, so `release_pr_merge` was still running the pre-change single-shot code — the exact code this issue replaced.
   The call returned the old bare "not mergeable" error while a `check` was genuinely `IN_PROGRESS`.
   User-caught, and in fact user-*predicted* one turn earlier.
   Impact: one wasted `release_pr_merge` call, one wrong `ci_find` call, a full session reload, and two user interventions.
   Had I said yes, the reloaded tool would have waited out the check automatically — demonstrating the fix instead of working around it.
2. `other` — **Passed a CI run ID to `ci_find` as `expected_sha`.**
   Reaching for the check's `detailsUrl` number (`30950299939`) instead of the PR head SHA, which was one `gh pr view 700 --json headRefOid` away.
   Burned the full 125 s exponential backoff before timing out.
   Self-identified.
   Impact: 125 s wasted, one tool call; no rework.
   Largely designed out going forward — the shipped tool removes the need to hand-watch a release PR's checks at all.
3. `instruction-violation` — **Retyped a width-padded markdown table into `oldText` instead of anchoring around it.**
   `AGENTS.md` explicitly warns against exactly this for "a width-padded table row."
   Two `Edit` calls failed before I read exact bytes with `python3 repr()`.
   Self-identified.
   Impact: 7 consecutive tool calls on one edit (2 failed edits, 4 inspections, 1 success); no rework.
4. `instruction-violation` — **Emitted an extra `newText2` key in an `Edit` call.**
   `AGENTS.md` names this precisely ("never as `oldText2`/`newText2` … silently ignored while the tool still reports `Successfully replaced N block(s)`", Refs #605).
   Self-identified immediately and verified with `git diff`.
   Impact: one extra verification call; no rework — the stray value was empty.
5. `instruction-violation` — **Made both Tidy-First extractions in one edit before splitting them.**
   The `tidy-first` skill says to land each recommended tidying as its own commit.
   Caught before committing and redone one at a time via `git checkout`.
   Self-identified.
   Impact: ~5 wasted tool calls; final history is clean.

#### What caused friction (user side)

1. **The redirecting question was right and I overrode it — the failure was mine, not the intervention's.**
   "Do we need to pause and reload to use this tool now?" is precisely the strategic-judgment intervention style that works best: a question, not a correction, at the exact moment it mattered.
   The only opportunity here is that a follow-up ("are you sure?
   the tool you just changed is the one you're about to call") would have forced the reasoning I skipped — but the first question should have been enough.

### Diagnostic details

- **Model-performance correlation** — clean split with no mismatches.
  Planning and this retrospective ran on `anthropic/claude-opus-5` (judgment-heavy: measurement design, the four-question `ask_user` gate, proposal synthesis); TDD and ship ran on `anthropic/claude-sonnet-5` (execution against a written plan).
  Both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) are pinned to `anthropic/claude-sonnet-5`, appropriate for their design-judgment scope — and the reviewer's single WARN was a real finding, not noise.
- **Escalation-delay tracking** — one sequence exceeded the 5-call threshold: the README table edit ran 7 consecutive calls on the same failing `oldText` match.
  No subagent was warranted; the fix was to stop retyping and read exact bytes, which `AGENTS.md` already prescribes.
  The stale-tool friction was *not* an escalation-delay case — it was resolved in 2 calls once the symptom appeared; the delay was in the reasoning one turn earlier.
- **Unused-tool detection** — no available tool or subagent would have caught the stale-extension issue; it required reasoning about Pi's extension-loading lifecycle, which no gate inspects.
  This is precisely why it belongs in `AGENTS.md` rather than in a checklist.
- **Feedback-loop gap analysis** — no gap found.
  Verification was incremental throughout; `pnpm fallow dead-code` ran both at cycle end and again as a pre-push gate.

### Changes made

1. `AGENTS.md` — added a `### Stale in-process extension code` section after `### Stale prompt-template expansion`, recording that Pi loads each package's extension once at session start, so a session editing `packages/<pkg>/src/` keeps running the pre-edit tool and must restart before a workflow step that calls it.

### Considered and rejected

1. **Correcting the `rumdl fmt` table-padding claim in `AGENTS.md`.**
   I hypothesized the existing sentence ("`rumdl fmt` does not re-pad tables for you") was wrong, since a README table appeared to change padding after an edit.
   Tested with two fixture tables — one compact, one padded with inconsistent widths — and `rumdl fmt` left both untouched.
   The existing rule is correct; proposal withdrawn on evidence.
2. **A `/ship-issue` step 6.4 pointer duplicating the stale-extension rule.**
   Rejected as duplication — `AGENTS.md` is always in context.
3. **Rules for the `ci_find` run-ID slip, the `newText2` key, and the padded-table `oldText` retype.**
   The latter two already have crisp `AGENTS.md` rules; a repeat violation is not fixed by more prose.
   The first is designed out by the shipped tool, which removes the need to hand-watch a release PR's checks.

[#5]: https://github.com/gotgenes/pi-packages/issues/5
