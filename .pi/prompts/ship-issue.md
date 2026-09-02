---
description: Push, close a GitHub issue with a summary, and dispatch the release
---

# Ship the implementation

Argument: `$1` is the issue number that was just implemented.

## 0. Confirm you are on trunk

Run `git branch --show-current`.
If it is not `main`, stop and report — use `/sync-worktree $1` (peer session) then `/ship-worktree $1` (root session) instead.
Do this before anything else, so a mis-invocation costs nothing.

Then fetch the issue title via `gh issue view $1 --json title -q .title`, and call `set_session_name` with name `#$1 Ship — <issue title>` to identify this session in the session selector.

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
3. Use `ci_watch` with the returned `run_id`, workflow `ci`, and `timeout: 600` to wait for it to complete.
4. If the run conclusion is `failure`, stop and report.
   Do not close the issue or merge anything.
5. If it lands `success`, continue.

## 4b. Check for a stacked release

Ask what would actually release, rather than reasoning about commit types:

```bash
./scripts/release/next-version.sh <pkg>
```

Where `<pkg>` is the shipped package from the issue's plan path.
The script is read-only and offline, and it applies the same path scoping and commit-type rules the release itself will.
It prints the tag that would be cut, or nothing at all when the package has no releasable commits.

Trust its answer over any reasoning about which commit types are hidden.
Empty output means the work auto-batches until a releasing commit lands: `refactor:`/`style:`/`test:`/`build:`/`ci:` are skipped types, while `feat:`/`fix:`/`perf:`/`revert:`/`docs:`/`chore:` all release.
A `docs:` or `chore:` commit counts only when it touches a file under `packages/<pkg>/` that is not an internal docs directory (`docs/plans`, `docs/retro`, `docs/architecture`, `docs/decisions`, `docs/assets`).
Files outside the package tree (`.pi/skills/`, root `AGENTS.md`/`README.md`) belong to no package and release nothing.

For a repo-root tooling change (plan under `docs/plans/`, no `<pkg>`), skip the command — every commit is outside the package tree, so nothing releases now.
Say so in the final report and skip the batch-vs-release question.

Then apply the decision recorded in the early "Release coordination" section.
The issue **always** closes in step 5, regardless of this decision — closing records that the work is on `main`; releasing is a separate, batched concern (matches the decoupled close/release contract of the worktree flow's root half, `/ship-worktree`).
If the decision was to defer/batch: continue to step 5, then skip step 6 (the release lands later with the batch tail).
A release names its packages explicitly, so deferring one holds only that package — siblings keep releasing on their own ships.
Note the deferral in the final report.

## 5. Close the issue

Build the close comment from this issue's own commits, anchored on the plan commit — not on the package's last tag.
Each package releases on its own cadence, so a tag range spans every sibling issue that landed since: measured at 165 commits across 32 issues for a 13-commit change (Refs #817).

```bash
PLAN=$(git log --format='%H' --grep="docs: plan .*(#$1)" -1)
git log --oneline "$PLAN"^..HEAD
```

If no plan commit matches, anchor on the parent of the issue's first commit.

The comment should include:

- The commit hash that lands the change ("Implemented in <sha> …") — the commit carrying the behavior, not the range's last commit.
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

Then check whether this push shipped work for **other** issues in the `"$PLAN"^..HEAD` range.
A co-shipped issue shows as a stacked refactor/enabler, a subject-trailing `(#M)` commit ref, or a sibling `docs/plans/`/`docs/retro/` file added in range — a body-line `Refs #M` is a citation, not a ship (Refs #793).
A mid-batch sibling that shipped on its own `/ship-issue` is already closed by that ship — this scan is for stacked work that never had a ship of its own.
Close each with its own short summary — `refactor:` commits are omitted from the changelog, so a stacked refactor issue leaves no reminder.

## 6. Dispatch the release

Skip this step entirely if step 4b recorded a defer/batch decision — the release lands later with the batch tail.

1. Derive candidate packages from the paths the range touched, not from commit types:

   ```bash
   PLAN=$(git log --format='%H' --grep="docs: plan .*(#$1)" -1)
   git diff --name-only "$PLAN"^..HEAD | sed -n 's#^packages/\([^/]*\)/.*#\1#p' | sort -u
   ```

   Do not filter by commit type: `docs:` and `chore:` are visible changelog groups that cut a patch on their own, so a `feat|fix` scope grep silently drops a sibling bumped by a docs-only commit (Refs #857).
   Step 2's `next-version.sh` is the authority on which candidates actually release.
   A plan under `docs/plans/` is cross-package as often as it is repo tooling — release every package the range bumps (Refs #792).
   On an empty list (repo tooling only), nothing releases: skip to step 7.
2. Confirm each candidate against `./scripts/release/next-version.sh <pkg>`.
   A package that prints nothing has no releasable commits and must not be named — the release refuses a package with nothing to release, and would fail the whole run.
   A package the shipped range did **not** bump is a sibling and is not yours to release.
3. Dispatch the release, naming every package to release and pinning the commit:

   ```bash
   gh workflow run release.yml -f packages="<pkg> <pkg2>" -f sha="$(git rev-parse HEAD)"
   ```

   The package list is explicit by design: several packages can be releasable at once, and only the named ones go.
   The `sha` is a guard — the run aborts if `main` moved after you derived it.

## 6b. Verify the release run

Skip this step if step 6 was skipped (deferred/batch release, or nothing to release) — there is nothing to verify.

1. Use `ci_find` with workflow `release` and the SHA you passed as `-f sha`, then `ci_watch` the returned `run_id` with `timeout: 600`.
   A dispatched run's `head_sha` is `main`'s tip at dispatch time, so it matches the SHA you pinned.
   If `ci_find` times out, the dispatch's SHA guard most likely failed because `main` moved — check the run list before re-dispatching.
2. If the `prepare`, `publish`, or `github-release` job failed, stop — do not proceed to step 7.
   `prepare` failing means nothing was tagged and the release can simply be re-dispatched.
   `publish` or `github-release` failing means the tags are already pushed: fix the cause and re-run those jobs rather than re-dispatching, which would refuse on the existing tag.
3. After the run succeeds, `git pull --ff-only` to bring the release commit and tags down.

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
- Never name a package in the release dispatch that `next-version.sh` reports nothing for — the run refuses it and no package releases (step 6.2).
- Never re-dispatch a release after `prepare` succeeded; the tags exist, and the run would refuse on them (step 6b.2).
- If CI fails, the issue stays open.
- If the release run (step 6b) fails, do not proceed to step 7 until resolved.
