---
description: Push, close a GitHub issue with a summary, and merge the release-please PR
---

# Ship the implementation

Argument: `$1` is the issue number that was just implemented.

Fetch the issue title via `gh issue view $1 --json title -q .title`, then call `set_session_name` with name `#$1 Ship — <issue title>` to identify this session in the session selector.

## Release coordination (decide before step 1)

Gather the release decision up front, from a deterministic source, **before** any irreversible work (`git pull`/push/CI).
A decision presented early from the plan is far less likely to be reversed than one inferred from prose at the cancel point.

1. Locate the plan for this issue: `grep -rl "^issue: $1$" docs/plans packages/*/docs/plans`.
2. If a plan is found, read its `**Release:**` marker (written by `/plan-issue`) with `grep -F '**Release:**' <plan-file>` (fixed-string — a leading `*` is an invalid regex/BRE operator):
   - A marker containing `mid-batch — defer` → ask the operator **now**: defer the release (batch until the sequence completes), or release anyway?
     Record the decision.
   - Any other `**Release:**` value (`ship independently` or `ship now — batch "<name>" tail`) → record "release now"; note the recommendation in the final report; do **not** ask.
   - No `**Release:**` marker → record "release now" (default); do **not** ask.
3. If no plan file is found → record "release now" (default); do **not** ask.

This section only reads the plan and (conditionally) asks — it performs no git, push, or CI action.
Step 4b applies the recorded decision.

## 1. Sync with remote

Before pushing, make sure local `HEAD` is current with the remote:

1. Run `git pull --ff-only`.
2. If it fails for **any** reason — uncommitted changes, divergent history, merge conflict, network error, detached HEAD — stop immediately and report the failure to the user.
   Do not attempt to stash, rebase, force, or otherwise resolve.
3. Only proceed once the pull reports a clean fast-forward (or `Already up to date.`).

## 2. Pre-push checks

Run from the **repo root** (not a package subdirectory):

1. `pnpm run lint` — catches cross-package lint violations CI runs at root level; package-level `pnpm run lint` may miss sibling-package issues.
2. `pnpm fallow dead-code` — CI runs this gate on every `main` push (not on PRs), so a pre-existing failure blocks your push regardless of whether this issue introduced it.

If either fails, fix the issues and commit before pushing.

## 3. Push

- Determine the current branch (`git branch --show-current`).
- `git push`.
- If the push is rejected as non-fast-forward, stop and report — do not force-push.

## 4. Verify CI on the pushed commit

1. Run `git rev-parse HEAD` to capture the full 40-char SHA.
   Pass that exact value to `ci_find` — never hand-expand the short SHA from the `git push` output, and never type a SHA from memory.
2. Use `ci_find` with that SHA and workflow `ci` to locate the CI run.
   If it times out, re-check the SHA you passed against `git rev-parse HEAD` before assuming a timing miss — a truncated or retyped SHA produces the same timeout (Refs #640).
3. Use `ci_watch` with the returned `run_id` and workflow `ci` to wait for it to complete.
4. If the run conclusion is `failure`, stop and report.
   Do not close the issue or merge anything.
5. If it lands `success`, continue.

## 4b. Check for a stacked release

First check the unreleased range for a releasing commit: `git log --oneline <last-tag>..HEAD -- packages/<pkg>/` (scope to the shipped package's path — a package tag many releases old otherwise dumps every package's commits and truncates the output).
For a repo-root tooling change (plan under `docs/plans/`, no `<pkg>`), skip that command — every commit is outside the package tree, so nothing releases now.
If every commit is a non-releasing type — the `hidden: true` changelog sections in `release-please-config.json` (`refactor:`/`style:`/`test:`/`build:`/`ci:`) — release-please will cut nothing now; the work auto-batches until a releasing commit lands.
A `docs:` commit cuts a patch only when it touches a file under `packages/<pkg>/` that is **not** in `exclude-paths`.
Files outside the package tree (`.pi/skills/`, root `AGENTS.md`/`README.md`) are attributed to no package; together with `exclude-paths` files (`docs/plans`, `docs/retro`, a package's `docs/architecture`) they cut nothing now and auto-batch (Refs #505).
Say so in the final report and skip the batch-vs-release question.

Then apply the decision recorded in the early "Release coordination" section.
The issue **always** closes in step 5, regardless of this decision — closing records that the work is on `main`; releasing is a separate, batched concern (matches `/land-worktree`'s decoupled close/release contract).
If the decision was to defer/batch: continue to step 5, then skip step 6 (the release lands later with the batch tail).
Note the deferral in the final report.
Otherwise continue to step 5 and step 6.

## 5. Close the issue

Build the close comment from the commits since the shipped package's previous release.
Derive the previous tag package-scoped (`git tag --list '<pkg>-v*' --sort=-creatordate | head -1`, where `<pkg>` is the shipped package from the issue's plan path), not `git tag --sort=-version:refname | head -1`, which sorts lexically across all package tags and returns an unrelated package.
For a repo-root tooling change (plan under `docs/plans/`, not `packages/<PKG>/docs/plans/`), there is no `<pkg>` and no package tag — anchor the range on the parent of the issue's first commit (`git log --oneline <parent>..HEAD`), or the most recent `chore: release main` commit.

```bash
git log --oneline <pkg-tag>..HEAD
```

The comment should include:

- The commit hash that lands the change ("Implemented in <sha> …").
  Run `git rev-parse` for **every** SHA the comment will contain — the landing commit and any follow-on commits — before you start drafting.
  Paste each exactly; never hand-type or extend a short SHA from memory, and never leave a placeholder to fill in later.
  A fabricated SHA does not auto-link (Refs #704, #777).
  Then verify the draft, not your intent to cite: extract every hex token from the finished comment body and re-resolve each (`git rev-parse <sha>^{commit}`).
  A pre-draft resolve cannot cover a hash drafting itself introduced (Refs #788).
  Write them as plain text — no backticks — so GitHub auto-links them to the commits.
- A short bullet list of feature/breaking commits.
- One sentence on user-visible behavior change.
- A note flagging any breaking change (matches `feat!:` commits).
- If the change unblocks or partially addresses other issues, mention them.
- If the release was deferred (mid-batch), note that the fix is on `main` and releases with the batch — do not cite a released version.

Then use `issue_close` with issue number `$1` and the summary as the comment.

When `$1` is a third-party **PR** adopted via `/review-third-party-pr` (we re-implemented rather than merged), the close target is a PR, not an issue.
Verify with `gh api repos/gotgenes/pi-packages/issues/$1 --jq '.pull_request != null'`.
Close it with `gh pr comment` then `gh pr close` — never merge — crediting the contributor by `@login`.
An adopted PR and the issue it addresses are both close targets: shipping either one closes the other too — read the retro's PR Review stage for the counterpart number.
The multi-SHA credit list here is where hand-extended short hashes slip in (Refs #704).

A shipped issue can also supersede open third-party PRs without either being the close target — this repo reimplements rather than merges.
Close each PR the plan names with `gh pr comment` then `gh pr close`, never merge, crediting the author by `@login` (Refs #670, #690).

Then check whether this push shipped work for **other** issues (a stacked refactor/enabler, other `(#M)` commit refs, or sibling `docs/plans/`/`docs/retro/` files in the `<pkg-tag>..HEAD` range).
A mid-batch sibling that shipped on its own `/ship-issue` is already closed by that ship — this scan is for stacked work that never had a ship of its own.
Close each with its own short summary — release-please omits `refactor:` commits from the changelog, so a stacked refactor issue leaves no reminder.

## 6. Merge release-please PR (if present)

Skip this step entirely if step 4b recorded a defer/batch decision — the release lands later with the batch tail.

1. Use `release_pr_find` to locate an open release-please PR.
2. If none is found (timeout), skip to step 7.
3. If one exists, check which packages/versions the PR bumps.
   Read the **full** PR body — release-please collapses each package in a separate `<details>` block, so a truncated view hides sibling bumps.
   If it bumps a package unrelated to the issue being shipped, diagnose before noting it — a bump from a `docs:`-only commit means that package is missing a `docs/<subdir>` entry in `exclude-paths` (Refs #655).
4. Use `release_pr_merge` with the PR number.
   The tool waits out an in-progress check or an undecided (`UNKNOWN`) mergeability state on its own, streaming progress — do not add a manual wait loop.
   It also retries a transient 5xx, so a single failure is already several attempts — do not retry it blindly.
   - If `release_pr_merge` returns `failed to merge PR #N`, the merge call itself failed and the tool has already checked whether it landed: `merged: false` is safe to retry, `merged: unknown` is not — run the probe it prints before doing anything else.
   - If `release_pr_merge` returns an error (not mergeable), read its `reason:` line.
     `reason: no checks reported (statusCheckRollup is empty)` is the expected case for a release-please PR created by the default `GITHUB_TOKEN` (no CI runs); merge with `gh pr merge <N> --rebase` (matches the `defaultMergeMethod: rebase` config so the release lands as a linear commit, not a merge bubble), then `git pull --ff-only`.
     Any other reason (`check failed: ...`, `mergeable is ...`, `merge state is ...`) or a `timeout:` result means the PR is genuinely blocked or still unsettled — stop and report; let the user decide.
5. Use `release_watch` to wait for the release tag to land on HEAD.

## 6b. Verify the release-triggered CI run

Skip this step if step 6 was skipped (deferred/batch release, or no release-please PR found) — there is nothing to verify.

1. Capture the merge commit SHA: `release_pr_merge`'s `head_sha`, or `git rev-parse HEAD` after `release_watch`.
2. Use `ci_find` with that SHA and workflow `ci`, then `ci_watch` the returned `run_id`.
3. If the `release-please` or `publish` job failed, or `publish` was skipped when a release was expected, stop — do not proceed to step 7.
   Resolve per the recovery runbook in `AGENTS.md` (a `release-please` job can fail after already tagging/releasing, silently skipping `publish`), then re-verify before continuing.

## 7. Final report

Print:

- The new HEAD on `main` (`git log --oneline -1`); confirm `git status -sb` shows no unpushed commits before naming it.
- The released version, if a release commit just landed (`git tag --points-at HEAD` or read `package.json`).
- Issue close confirmation.
- Anything that was skipped and why.
- If this issue completed the **last** step of a roadmap phase, flag it: the phase-close runs via `/finish-phase <PKG>` (after `/retro`), never as a filed issue.
- The next step: `/retro <N>` to capture this session's retrospective.

Name `/retro <N>` as the single next step.
Do **not** recommend the next issue to plan here — `/retro` surfaces the next roadmap issue at its end, after the retrospective is written.

## Constraints

- Never force-push.
- Never merge a release-please PR that is genuinely blocked (`CONFLICTING`/`DIRTY`/`BEHIND` or a failing check); a `reason: no checks reported` refusal is the expected `GITHUB_TOKEN` case (step 6.4).
- Never retry `release_pr_merge` on a `merged: unknown` result — verify the PR's state by hand first (step 6.4).
- If CI fails, the issue stays open.
- If the release-triggered CI run (step 6b) fails, do not proceed to step 7 until resolved — see the `AGENTS.md` recovery runbook.
- If multiple release-please PRs exist for the same component, stop and ask — that's a configuration issue, not a normal merge.
