---
model: anthropic/claude-sonnet-5
description: Root-session ship — ff-merge a rebased worktree branch into main, verify CI, close the issue, release, and tear down
---

# Ship a worktree branch (root session)

Argument: `$1` is the issue number whose peer branch is ready to land.

This is the **root-session** half of the parallel-worktree ship flow.
Run it after the peer session finished `/sync-worktree $1` (checks passed, retro committed, branch rebased onto `origin/main`).
It lands the branch on linear `main`, verifies CI, closes the issue, optionally releases, and tears down the worktree.

## 0. Confirm you are at the root, not in a worktree

Run `git branch --show-current`.
If it is not `main`, stop and report — you are in a peer worktree and want `/sync-worktree $1` instead.
Do this before anything else, so a mis-invocation costs nothing.

Then fetch the issue title via `gh issue view $1 --json title -q .title`, and call `set_session_name` with name `#$1 Ship (worktree) — <issue title>`.

## Release coordination (decide before step 1)

Gather the release decision up front, from the plan, **before** any irreversible work (ff-merge/push/CI).
A decision presented early is far less likely to be reversed than one inferred at the cancel point.

1. Locate the plan **on the peer branch** — it does not reach `main` until step 2, so the working tree does not have it yet:

   ```bash
   BRANCH=$(git branch --list "issue-$1-*" | tr -d ' +*')
   git grep -l "^issue: $1$" "$BRANCH" -- 'docs/plans/*' 'packages/*/docs/plans/*'
   ```

   The output is `<branch>:<plan-path>` — feed that line straight to `git show`.
2. If a plan is found, read its marker with `git show "<branch>:<plan-path>" | grep -F '**Release:**'` (fixed-string — a leading `*` is an invalid regex/BRE operator):
   - A marker containing `mid-batch — defer` → ask the operator **now**: defer the release (leave that package's release-please PR open), or release anyway?
     Record the decision.
   - Any other `**Release:**` value, or no marker → record "release now"; do **not** ask.
   - No plan found on the branch → record "release now" and say so in the final report; do **not** let the absence pass silently.

This section only reads the plan and (conditionally) asks — it performs no git, push, or CI action.
Step 6 applies the recorded decision.

## 1. Confirm root + sync main

1. Run `git rev-parse --show-toplevel` and `git branch --show-current` — confirm you are in the **root** checkout on `main`.
   If not, stop and report.
2. `git fetch origin`.
3. `git pull --ff-only`.
   If it fails for any reason, stop and report — do not stash, rebase, or force.

## 2. Fast-forward merge the peer branch

The peer worktree shares this repo's `.git`, so the branch ref is visible locally — no fetch of the branch is needed.

1. Find the branch: `git branch --list "issue-$1-*"`.
   If zero or more than one match, stop and report.
2. `git merge --ff-only <branch>`.
3. If the merge is **not** a fast-forward, stop and report: `main` advanced since the peer rebased (another peer landed first).
   The peer must re-run `/sync-worktree $1` to rebase onto the new `origin/main`, then retry this step.

## 3. Push

- `git push`.
- If rejected as non-fast-forward, stop and report — do not force-push.

## 4. Verify CI on the pushed commit

1. `git rev-parse HEAD` to capture the full 40-char SHA; pass that exact value to `ci_find` (workflow `ci`).
2. `ci_watch` with the returned `run_id` (workflow `ci`) and `timeout: 600` — a `main` push runs `check` then `release-please`, which exceeds the 300 s default about half the time.
3. If the conclusion is `failure`, stop and report — do not close the issue, release, or tear down.
4. On `success`, continue.

## 5. Close the issue

Build the close comment from this issue's own commits, anchored on the plan commit — not on the package's last tag.
Each package releases on its own cadence, so a tag range spans every sibling issue that landed since (Refs #817).

```bash
PLAN=$(git log --format='%H' --grep="docs: plan .*(#$1)" -1)
git log --oneline "$PLAN"^..HEAD
```

If no plan commit matches, anchor on the parent of the issue's first commit.
From that range:

- "Implemented in <sha> …" — the commit carrying the behavior, not the range's last commit; SHA as plain text (no backticks) so GitHub auto-links it.
- A short bullet list of feature/breaking commits.
- One sentence on user-visible behavior change.
- A note flagging any breaking change (`feat!:`).

Then call `issue_close` with issue number `$1` and that summary.
Also close any **other** issues this push shipped (stacked refactors, other `(#M)` refs, sibling `docs/retro/` files in range) with their own short summaries.

## 6. Release (decoupled and serialized)

Releasing is the root's serialized responsibility — only the root merges release-please PRs, so peers never race on them.

1. Apply the decision recorded in Release coordination.
   On "defer": **skip releasing** — leave that package's release-please PR open, note the deferral, and continue to teardown.
   Deferring holds only this package; sibling packages keep releasing on their own lands.
   Otherwise release now.
2. Derive the package list from the shipped range, not the plan's directory (re-derive `PLAN` — a fresh shell does not carry step 5's):

   ```bash
   PLAN=$(git log --format='%H' --grep="docs: plan .*(#$1)" -1)
   git log --format='%s' "$PLAN"^..HEAD | grep -oE '^(feat|fix)\([^)]+\)' | sort -u
   ```

   A cross-package plan bumps more than one, and each gets its own release PR — release every one (Refs #792).
3. For each `<pkg>`: `release_pr_find` with `component: <pkg>` → confirm the **full** PR body bumps `<pkg>` and nothing else → `release_pr_merge` (rebase).
   - Print the body explicitly with `gh pr view <N> --json body -q .body` — a `--jq` that drops `body` skips the check silently and an unexpected bump slips through.
   - `release_pr_find`'s `component:` line says which check applies: a named component means one package, while `component: (none)` means a **combined** PR covering every package, which the tool falls back to legitimately (the rollback state in `AGENTS.md`).
   - For a component-scoped PR an unexpected bump means you have the wrong PR; for a combined one sibling bumps are expected.
     Either way, a package the shipped range did **not** bump is a sibling: its open PR is expected and is not yours to merge.
   - `release_pr_merge` waits out an in-progress check or an undecided (`UNKNOWN`) mergeability state on its own, and retries a transient 5xx — do not add a manual wait loop or a blind retry.
   - On a `failed to merge PR #N` result the merge call itself failed and the tool has already checked whether it landed: `merged: false` is safe to retry, `merged: unknown` is not — run the probe it prints first.
   - On a `reason: no checks reported (statusCheckRollup is empty)` refusal (the `GITHUB_TOKEN` case), fall back to `gh pr merge <N> --rebase`, then `git pull --ff-only`.
   - Never `--merge`; never merge a genuinely blocked PR (any other `reason:`, or a `timeout:` result).
4. `release_watch` with the same `component: <pkg>` for the tag, once per released package.

## 7. Tear down the worktree

Run `scripts/worktree-rm.sh $1 --delete-branch`.
The branch deletes cleanly because its commits are now in `main`; the worktree is not anyone's live CWD (the peer session can stay open or be closed — its work is landed).

## 8. Final report

Print:

- New HEAD on `main` (`git log --oneline -1`).
- Released version **per package** released, one line each (`git tag --points-at HEAD`), or that release was deferred and why.
  Name every package step 6's derivation listed — a listed package with no released version is a miss, not an omission from the report.
- Issue close confirmation(s).
- Worktree/branch teardown confirmation.
- Anything skipped and why.
- The next step: `/retro $1` — the deliberate, interactive final retrospective, run here at the root on `main` (commits straight to `main`).

Name `/retro $1` as the single next step.
Do **not** recommend the next issue to plan here — `/retro` surfaces the next roadmap issue at its end, after the retrospective is written.

## Constraints

- Never force-push.
- If the ff-merge is not a fast-forward, stop — the peer re-rebases; the root never merges non-linearly.
- If CI fails, the issue stays open and nothing is released or torn down.
- Never merge a genuinely blocked release-please PR; a `reason: no checks reported` refusal is the expected `GITHUB_TOKEN` case.
- Select the release PR by component, never by position — several are open at once, one per package with a pending release.
- Never retry `release_pr_merge` on a `merged: unknown` result — verify the PR's state by hand first.
