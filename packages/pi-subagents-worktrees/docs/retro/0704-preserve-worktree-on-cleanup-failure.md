---
issue: 704
issue_title: "`cleanupWorktree` silently discards work when the fallback commit fails"
pr: 705
---

# Retro: #704 — `cleanupWorktree` silently discards work when the fallback commit fails

## Stage: PR Review (2026-08-10T17:30:07Z)

### Session summary

PR [#705] from @AndersBennedsgaard fixes a confirmed data-loss defect: `cleanupWorktree`'s `catch` block force-removes the worktree and returns `{ hasChanges: false }` whenever the safety-net commit throws, so an agent's work vanishes and the caller is told nothing changed.
The PR is small, idiomatic, fully green, and ships tests that genuinely fail without the fix — but it stops at "preserve on failure" and leaves the motivating case (a mutating formatter pre-commit hook) still failing on every run.
Operator direction: **adopt the capability with our own simplified design** via `/plan-issue #704`, adding a `--no-verify` retry and a discriminated-union result, using [#705] as reference rather than the merge target.

### Evaluation

Defect verification (against current `main`, base `4482a5db`):

- Reproduced with a scratch Vitest exercising `#src/worktree` directly.
  With a pre-commit hook that mutates a file and exits non-zero, `cleanupWorktree` returned `{"hasChanges":false}`, the worktree directory was force-removed, and no branch was created.
- Not already fixed.
  `git log --oneline -S "removeWorktree on cleanup error"` shows the destructive `catch` present since the package was scaffolded (`9a7dcfc5`) and inherited from the pi-subagents core before that (`049f4891`).
  The reporter is on `0.2.3`, which is the current version — there is no upgrade answer here.
- Real boundary confirmed: `src/worktree.ts` (the outer `catch` in `cleanupWorktree`) plus `src/workspace-provider.ts` (`WorktreeWorkspace.dispose` returning `undefined`, which is what makes the loss *silent*).
  The PR touches exactly this path.
- One correction to the report.
  The issue and the PR's plan both assert "no dangling commit, no dangling blob, `git fsck` finds nothing."
  That is inaccurate for the motivating case: our own `git add -A` succeeds and writes the tree and blobs into the shared object database before `git commit` fails, so `git fsck --lost-found` surfaces a dangling tree from which the agent's file is fully recoverable (verified by `git cat-file -p`).
  The work is forensically recoverable by an expert until the next `git gc --prune`.
  The user-visible symptom is identical, so the defect stands, but the severity framing in the issue is overstated.

Checks run in a scratch worktree (torn down afterwards): `pnpm run check` passed, `pnpm run lint` passed (biome, eslint, and `rumdl` all clean), and `pi-subagents-worktrees` passed 28/28.
Reverting only `src/` to `main` and re-running the PR's tests produced 2 failed / 26 passed, confirming the tests fail without the fix.

What is valuable:

- The diagnosis and the boundary choice are correct, and the fix is genuinely right-sized at roughly nine lines of source across two files.
- `error?: string` on `WorktreeCleanupResult` is actually consumed at its single call site in `src/workspace-provider.ts`, so it is not speculative generality, and `WorktreeCleanupResult` has exactly one consumer, so nothing is threaded over-wide.
- Convention fit is good: it reuses the existing result envelope, `debugLog`, and result-addendum shape instead of inventing a divergent one, and checks `error` before `hasChanges` so precedence is explicit.
- The contributor plainly ran our own `/plan-issue` and `/tdd-plan` templates; commit grammar and `Refs #704` usage match our standards.

What we would change:

- The motivating case is still broken, and this is the substantive finding.
  The PR's plan declares `--no-verify` an explicit non-goal, but with a mutating formatter hook cleanup now fails on *every* subagent run that produced changes, leaking both a `tmpdir` worktree and a registered `git worktree list` entry each time.
  `pruneWorktrees` (called from `src/index.ts` at startup) reclaims none of them — verified: `git worktree prune` only drops administrative entries whose directory is already gone.
  So the PR as written converts "silent loss, once" into "unbounded worktree accumulation, forever, plus an error addendum on every run."
  A `git commit --no-verify` retry was verified to succeed cleanly in exactly this scenario.
- `path` becomes triple-purposed: on the success path it names a worktree that was just removed (a pre-existing oddity on `main`), and on the failure path one that still exists.
  `{ hasChanges, branch?, path?, error? }` is drifting toward a shape better expressed as a discriminated union — `{ outcome: "clean" } | { outcome: "committed", branch } | { outcome: "failed", path, error }` — which is cheap to adopt given the single consumer.
- The new tests assert `existsSync(wt.path)` rather than the property that actually matters, namely that the agent's file content survived in the preserved worktree.
  Both also hand-roll the same failing-hook setup and place teardown inline in the `it` body, so a failed assertion leaks a worktree into the next test.
  A shared hook-installer helper plus `afterEach` teardown would fix both.

### Decision and attribution

Direction: **adopt the capability, plan a simplified design**.
[#705] is reference material, not the merge target; the work is planned fresh via `/plan-issue #704`.

Agreed scope:

- Preserve the worktree instead of force-removing it when the changes-exist path throws, and surface the failure through `dispose` so the agent sees it.
- Retry the safety-net commit with `--no-verify` after a hook rejection, and preserve the worktree only if that retry also fails.
  This makes the motivating formatter-hook case land the work on a branch and avoids the worktree-accumulation regression, while keeping preservation as the backstop for genuine errors.
- Model the result as a discriminated union rather than adding a fourth optional field to `WorktreeCleanupResult`.
- Tests must assert content survival in the preserved worktree, not merely directory existence, and should share a hook-installer helper with `afterEach` teardown.

Non-goals:

- No retry logic beyond the single `--no-verify` attempt.
- No change to `createWorktree` or `pruneWorktrees`.
- No automatic reclamation of preserved worktrees; recovery stays manual.
- We are not importing the contributor's `docs/plans/0704-*.md` or `docs/retro/0704-*.md`; our own `/plan-issue` run authors those, partly because the contributor's plan repeats the incorrect `git fsck` claim corrected above.

Attribution — required on every implementation and docs commit for this issue, as the last line of the body after a blank line:

```text
Co-authored-by: Anders Bjørnkjær Bennedsgaard <abbennedsgaard@gmail.com>
```

The ship-stage close comment on [#705] must thank @AndersBennedsgaard by name, link the implementing SHA(s), and note that the `--no-verify` retry was added on top of their diagnosis.
Reference the PR as `Refs #705`, never `Closes #705`.

## Stage: Planning (2026-08-10T17:59:13Z)

### Session summary

Produced `docs/plans/0704-preserve-worktree-on-cleanup-failure.md`, planning the fix in five steps: two preparatory tidying commits (extract git helpers and drop an output-argument mutation, then convert `WorktreeCleanupResult` to a discriminated union), then the preserve-on-failure fix, then the `--no-verify` retry with re-staging, then the README update.
The direction was already settled in the PR Review stage above, so this session resolved only the three design questions that surfaced while working out the mechanics.
Filed [#714] for the one deferral the plan concretely names.

### Observations

- **This repository is itself affected.**
  The `committed` `commit-msg` hook rejects the rescue commit's `pi-agent: <description>` subject — `` Disallowed type `pi-agent` `` — so every subagent that runs in a worktree here and produces changes currently loses that work.
  This turned out to be a stronger motivating example than the reporter's formatter-hook scenario, and it also confirms the retry must use `--no-verify` rather than something narrower, since `--no-verify` is what skips `commit-msg` as well as `pre-commit`.
- **Not breaking, and this was worth verifying rather than assuming.**
  `WorktreeCleanupResult` looked like a public type, but the package's `exports` map is `{ ".": "./src/index.ts" }`, `index.ts` exports only the default extension function, and no file outside the package references `cleanupWorktree`, `WorktreeCleanupResult`, or `WorktreeInfo`.
  Deep imports are blocked by the `exports` map, so the union is an internal change and the commits are `fix:`, not `fix!:`.
- **A cross-step trap was caught at planning time.**
  The obvious way to test preservation is a failing pre-commit hook, but step 4's `--no-verify` retry makes that exact scenario *succeed* — step 3's test would have silently inverted meaning while staying green.
  The plan instead triggers step 3's failure by pre-creating the worktree's `index.lock`, which no later step bypasses.
  Verified: `git status --porcelain` still reports the change, `git add -A` fails with `fatal: Unable to create '<gitdir>/index.lock': File exists`, the file survives on disk, and nothing reaches the object database.
- **Re-staging before the retry was the non-obvious design detail.**
  A formatter hook rewrites files and then exits non-zero; without a second `git add -A`, the retry would commit the pre-formatting snapshot and the hook's corrections would be destroyed along with the worktree.
  The operator confirmed re-staging.
- **Preparatory tidying found an existing output-argument smell.**
  `cleanupWorktree` assigns `worktree.branch = branchName`, mutating the `WorktreeInfo` it was handed, but nothing reads the mutated field — `dispose` reads `result.branch`.
  Having `createBranch` return the name removes the mutation and makes the union conversion in step 2 mechanical.
- **Hook-bypass safety was the one genuine judgment call.**
  A `gitleaks`-style hook exists to block content, and bypassing it commits that content to a local branch.
  Rejected a config key in favor of an unconditional bypass plus an explicit addendum notice, on the reasoning that the alternative leaves the same content sitting in `tmpdir` with less visibility, not more safety.
- Sibling issue [#707] (wildcards in `worktreeAgents`) touches `src/config.ts` only and does not overlap this change.

## Stage: Implementation — TDD (2026-08-10T18:18:25Z)

### Session summary

Landed the plan's five steps plus three preparatory tidying commits recommended by the `tidy-first-assessor`, for seven implementation commits in all.
`cleanupWorktree` now retries a rejected rescue commit once with `--no-verify` (re-staging first), preserves the worktree whenever cleanup fails, and reports both through a discriminated-union result that `dispose` surfaces in the agent's addendum.
Package test count went from 26 to 31; the pre-completion reviewer returned **PASS**.

### Observations

- **The tidy-first assessment paid for itself.**
  It caught that the plan deferred `commitStaged`'s *existence* to step 4, which would have made that commit both introduce the helper and add its retry body.
  Extracting a bare non-retrying `commitStaged` in step 1 meant step 4 edited exactly one function's internals and never touched `cleanupWorktree`'s call site.
  It also spotted that `initGitRepo` was duplicated verbatim across both suites right before both were about to gain failure-path cases.
- **The planned cross-step trap was real and the mitigation held.**
  Step 3's preservation test uses `lockGitIndex`, which fails at `git add -A` before any hook runs.
  The reviewer independently confirmed step 4's `--no-verify` retry cannot reach it, since the retry only fires from inside `commitStaged`, downstream of a successful `stageAll`.
  Had step 3 used a failing hook instead, step 4 would have silently inverted its meaning while leaving it green.
- **A planned test helper improved during implementation.**
  The plan called for exposing `worktreeGitDir` so tests could construct the lock path themselves.
  Encapsulating the whole operation as `lockGitIndex(worktreePath)` reads better at the call site and keeps the git-dir lookup out of the test bodies.
- **`git worktree remove --force` tolerates a stale `index.lock`.**
  Verified before writing the sweep, since the preservation test deliberately leaves one behind.
  The `afterEach` sweep needed no special handling.
- **Dropping the per-test `git branch -D` blocks was pure subtraction.**
  The outer `afterEach` already deletes the whole repository, so those cleanups had never done anything.
  Removing them took roughly 30 lines out of the tests that step 2 had to migrate anyway.
- **The autoformatter joined two sentences in the README.**
  Writing an explanatory sentence after a line ending in a code span produced a two-sentence line, violating one-sentence-per-line while still passing `rumdl`.
  Restructuring the bullet so each sentence stands alone fixed it; worth re-reading any README bullet the formatter touches.
- **Deviations from the plan.**
  Three preparatory commits were added ahead of the five planned steps.
  `test/support/git-fixture.ts` is a new file the plan's Module-Level Changes did not list; the reviewer confirmed it is a pure extraction rather than scope creep.
  Stale JSDoc on `cleanupWorktree` and the module header was updated and amended into the `docs:` commit.
  A `hooksBypassed: false` assertion was added to the existing happy-path test so both sides of the flag are pinned.
- Pre-completion reviewer: **PASS**, no WARN findings.
  It independently re-verified the attribution trailer on all seven implementation commits, the non-breaking `fix:` classification against the `exports` map, and that [#714] is filed and open.

## Stage: Final Retrospective (2026-08-10T18:38:38Z)

### Session summary

All five stages — PR review, planning, TDD, ship, and this retrospective — ran in a single session, taking third-party PR [#705] from triage through to a released `pi-subagents-worktrees` v0.2.4.
The shipped fix preserves the worktree when cleanup fails and retries the rescue commit past rejecting hooks, going beyond what the contributed PR proposed.
One self-caught instruction violation (fabricated commit SHAs in the PR close comment) is the session's main actionable finding.

### Observations

#### What went well

- **Disproving the report's severity claim changed the artifacts.**
  The issue and the contributor's plan both asserted "no dangling commit, no dangling blob, `git fsck` finds nothing."
  Recovering the file via `git cat-file -p` on the dangling tree showed that is false for the hook case, because our own `git add -A` writes blobs before the commit fails.
  Had this gone unchecked, the false claim would have been copied into our own plan — the contributor's plan had already copied it.
  Verifying a third-party report's *mechanism*, not just its conclusion, is what made the difference.
- **Finding that this repository triggers the bug reframed the whole fix.**
  `committed` rejects the rescue commit's `pi-agent:` subject (`Disallowed type`), so every worktree subagent here that produced changes was losing that work.
  This turned an abstract third-party report into a locally reproducible, self-affecting bug, and it is what justified `--no-verify` (which skips `commit-msg`) over any narrower remedy.
  It also exposed that PR [#705] as written would have left this repo leaking a worktree per run rather than fixing it.
- **The `tidy-first-assessor` found a real flaw in a plan written minutes earlier in the same session.**
  It caught that the plan deferred `commitStaged`'s *existence* to step 4, which would have forced that commit to both introduce the helper and add its retry body.
  A fresh-context reviewer beating the author on a plan that recent is a strong argument for the bracket being mandatory rather than discretionary.
- **The cross-step invariant trap was predicted, mitigated, and independently confirmed.**
  Planning identified that step 3's preservation test would be silently inverted by step 4's `--no-verify` retry, and chose a locked-index failure mode that no later step can bypass.
  The `pre-completion-reviewer` verified that reasoning independently rather than taking the plan's word for it.
- **Measuring test mechanisms at planning time paid off twice.**
  `user.useConfigOnly` was assumed to force a commit failure and did not — global config still supplied the identity.
  Probing it at planning time rather than during TDD meant the plan shipped with a mechanism (`index.lock`) that was already known to work, and the same habit confirmed `git worktree remove --force` tolerates a stale lock before the sweep was written.

#### What caused friction (agent side)

1. `instruction-violation` (self-identified) — **Fabricated two commit SHAs in the PR [#705] close comment.**
   `AGENTS.md` and `.pi/prompts/ship-issue.md` both require running `git rev-parse` and pasting the result exactly, never hand-extending a short hash.
   That rule was followed correctly for the issue close comment, then broken minutes later in the PR close comment, where five SHAs were listed and two (`7411088c…`, `e1baca45…`) were hand-extended into hashes that do not exist.
   Impact: the wrong SHAs were live on a public PR until a `git rev-parse` check caught them; recovery took one verification call plus a `gh api … PATCH` edit.
   Root cause is placement, not salience: the SHA rule lives under the *issue* close comment's bullet list, and the third-party-PR close path is a separate branch of the prompt that does not restate it.
   Multi-SHA credit lists are exactly where the shortcut is tempting, and that is the one place the prompt goes quiet.
2. `other` — **The `/ship-issue` prompt does not describe this session's actual shape.**
   Its third-party branch handles the case where the shipped argument *is* the PR.
   Here the argument was the issue (`704`) and the adopted PR ([#705]) was a second, separate close target.
   Nothing in the prompt says to close it; that only happened because the PR Review stage of this retro had recorded the obligation.
   Impact: no rework, but the correct behavior depended on a breadcrumb rather than the prompt, which will not hold when the retro is longer or the stages are split across sessions.
3. `other` — **A README line was joined with the sentence after it, breaking one-sentence-per-line while still passing `rumdl`.**
   `AGENTS.md` documents the autoformatter joining a line that ends in `:`; the affected line ended in a code span.
   Attempting to attribute the mechanism afterwards, neither `rumdl fmt` nor `prettier --write` reproduced the join in isolation, so the trigger remains unidentified.
   Impact: one restructuring edit, no rework.
   Deliberately proposing no `AGENTS.md` change for this — documenting an unverified mechanism would repeat the assert-instead-of-measure failure the rest of the session avoided.

#### What caused friction (user side)

- Nothing blocking.
  The operator answered four decision gates (PR direction, then three planning design questions) and made no corrections across five stages.
- The handoff contract written by `/review-third-party-pr` — "the direction is already decided here, so its Decide gate is satisfied" — worked exactly as intended: planning honored the recorded decision instead of re-litigating it, while still surfacing the genuinely *new* ambiguities that only became visible after reading the code.
  This is worth preserving; the temptation when splitting a decision across two gates is to either re-ask everything or ask nothing.
- One opportunity: the hook-bypass safety question (a `gitleaks`-style hook being skipped) is a security-posture decision that surfaced only at planning.
  Surfacing it during PR review, where the security implications of the adopted design were already being weighed, would have consolidated it with the direction decision.

### Diagnostic details

- **Model-performance correlation** — both subagents ran `anthropic/claude-sonnet-5` per their frontmatter: `tidy-first-assessor` on preparatory-refactor design and `pre-completion-reviewer` on the quality gate.
  Both are judgment-heavy, so the assignment is appropriate and no mismatch was found.
  The parent session switched models several times across stages; the ship stage, where the SHA fabrication occurred, ran on `claude-sonnet-5`, and this retrospective on `claude-opus-5`.
  SHA fabrication is a model-independent failure mode, so the correlation carries no signal beyond the prompt-placement gap already recorded above.
- **Escalation-delay tracking** — no `rabbit-hole` friction points.
  The longest same-approach probe sequence was three tool calls (`user.useConfigOnly` → `index.lock`), and the approach was abandoned after the second, well inside the five-call threshold.
- **Feedback-loop gap analysis** — no gap.
  `pnpm run check` and the package suite ran after each of the seven implementation commits, root `pnpm run lint` before each commit, and the full suite plus `pnpm fallow dead-code` at the end.
  The green baseline was verified before the tidy-first dispatch, per the skill.

### Changes made

1. `.pi/prompts/ship-issue.md` — extended the third-party-PR close block with two sentences.
   The first makes an adopted PR and the issue it addresses mutually-implied close targets, so shipping either one closes the other; the operator raised this during the retro, noting the direction the session actually exercised (shipping the issue, closing the PR) is only half the case, since a `/review-third-party-pr` PR may itself carry an associated issue.
   The second carries the existing `git rev-parse` full-SHA rule into that branch, which is where this session fabricated two hashes.

Proposed and deliberately rejected: an `AGENTS.md` note about the autoformatter joining a line ending in a code span.
The join could not be reproduced with `rumdl fmt` or `prettier --write` standalone, so the mechanism is unattributed and documenting it would assert rather than measure.

[#705]: https://github.com/gotgenes/pi-packages/pull/705
[#707]: https://github.com/gotgenes/pi-packages/issues/707
[#714]: https://github.com/gotgenes/pi-packages/issues/714
