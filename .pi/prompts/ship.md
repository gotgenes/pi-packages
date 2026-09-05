---
model: anthropic/claude-sonnet-5, opencode-go/deepseek-v4-flash
description: Land the work (trunk or worktree branch), verify CI, close the issue, dispatch the release, and tear down
---

# Ship the implementation

Argument: `$1` is the issue number that was just implemented, or the number of an adopted third-party PR.
When it is empty, derive the number from the newest plan commit (`git log --format='%s' --grep='^docs: plan ' -1` → the trailing `(#N)`), name the issue you derived, and confirm it before step 3.

`/ship` runs at the **root** checkout on `main` in both of its lanes:

- **Trunk lane** — this session committed the work directly on `main`.
- **Worktree lane** — a peer session implemented the work on an `issue-$1-*` branch and finished `/sync-worktree $1` (checks passed, sync stage note committed, branch rebased onto local `main`).

The lane is detected in step 1 and changes only five things: where the plan is read from (step 2), whether a branch is fast-forward-merged (step 4), the CI-failure recovery rule (step 7), whether a worktree is torn down (step 12), and the session name.
Every other step is identical.

## 0. Confirm you are at the root on `main`

Run `git rev-parse --show-toplevel` and `git branch --show-current`.

1. If the branch is not `main`, stop and report.
   On an `issue-<N>-*` branch you are in a peer worktree: run `/sync-worktree $1` here, then `/ship $1` from the root session.
2. If the toplevel is not the root checkout, stop and report — the same applies.

Do this before anything else, so a mis-invocation costs nothing.

## 1. Detect the lane and name the session

1. Run `git branch --list "issue-$1-*"`.
   - Exactly one match → **worktree lane**.
     Record the branch: `BRANCH=$(git branch --list "issue-$1-*" | tr -d ' +*')`.
   - Zero matches → **trunk lane**.
   - More than one match → stop and report; the ambiguity is a branch-naming collision the operator must resolve.
2. Fetch the issue title: `gh issue view $1 --json title -q .title`.
3. Call `set_session_name` — trunk lane: `#$1 Ship — <issue title>`; worktree lane: `#$1 Ship (worktree) — <issue title>`.

## 2. Release coordination and close targets (decide before step 3)

Gather the release decision and the ship-time close targets up front, from deterministic sources, **before** any irreversible work (pull, ff-merge, push, CI).
A decision presented early from the plan is far less likely to be reversed than one inferred from prose at the cancel point.

1. Locate the plan.

   Trunk lane — it is already on `main`:

   ```bash
   grep -rl "^issue: $1$" docs/plans packages/*/docs/plans
   ```

   Worktree lane — it does not reach `main` until step 4, so read it off the branch:

   ```bash
   git grep -l "^issue: $1$" "$BRANCH" -- 'docs/plans/*' 'packages/*/docs/plans/*'
   ```

   The output is `<branch>:<plan-path>` — feed that line straight to `git show`.
2. If a plan is found, read its `**Release:**` marker (written by `/plan-issue`) with a fixed-string grep — a leading `*` is an invalid regex/BRE operator.
   Trunk lane: `grep -F '**Release:**' <plan-file>`.
   Worktree lane: `git show "<branch>:<plan-path>" | grep -F '**Release:**'`.
   The grep can match prose mentions as well as the canonical line; the marker is the one matching exactly one of the three forms `/plan-issue` writes.
   - A marker containing `mid-batch — defer` → ask the operator **now**: defer the release (simply do not name that package), or release anyway?
     Record the decision.
   - Any other `**Release:**` value (`ship independently` or `ship now — batch "<name>" tail`) → record "release now"; note the recommendation in the final report; do **not** ask.
   - No `**Release:**` marker, or no plan found → record "release now" (default); do **not** ask, and say so in the final report rather than letting the absence pass silently.
3. Read the issue's retro file in full — `docs/retro/NNNN-*.md` or `packages/*/docs/retro/NNNN-*.md`, matching the plan's `NNNN`.
   In the worktree lane it is on the branch (`git show "<branch>:<retro-path>"`), and its `## Stage: Sync (worktree)` entry is where the peer records release-relevant handoff — a sibling package bumped by a docs-only commit, work deferred to this ship, a PR to close.
   Do this in **both** lanes: a plan's risk table and the planning and TDD stage notes routinely record a ship-time close target — an adopted third-party PR — that no commit in the range mentions.
   A step that only greps the plan for `**Release:**` cannot see it, which is how PR #850 stayed open after its work shipped (Refs #849).
   Carry what you find into step 9 and step 10.

This section only reads and (conditionally) asks — it performs no git, push, or CI action.
Step 8 applies the recorded release decision.

## 3. Sync `main`

1. `git fetch origin`.
2. `git pull --ff-only`.
   If it fails for **any** reason — uncommitted changes, divergent history, merge conflict, network error, detached HEAD — stop immediately and report.
   Do not attempt to stash, rebase, force, or otherwise resolve.
3. Check for unpushed root commits: `git rev-list --count origin/main..main`.
   `git pull --ff-only` reports `Already up to date.` when local `main` is merely *ahead*, so a non-zero count is invisible above (Refs #815).
   Report the count before step 4 — it explains a rejected ff-merge but does not predict one; step 4 does that.

## 4. Land the work

Trunk lane: nothing to merge — the work is already committed on `main`.
Skip to step 5.

Worktree lane: the peer worktree shares this repo's `.git`, so the branch ref is visible locally — no fetch of the branch is needed.

1. Predict the merge before running it: `git merge-base --is-ancestor main "$BRANCH" && echo ff-ok`.
   If it fails, stop and send the peer back to `/sync-worktree $1` — do not push root commits to `origin` to make a stale rebase target agree (Refs #813).
2. `git merge --ff-only "$BRANCH"`.
3. If the merge is **not** a fast-forward, stop and report.
   Name the divergent commits with `git log --oneline "$BRANCH"..main` — run it without `wc -l`, and report those commits, not a cause inferred from `git log main`'s recent subjects (Refs #815).
   The peer must re-run `/sync-worktree $1`, rebasing onto the ref this merge will actually use, then retry this step.

## 5. Pre-push checks

Run from the **repo root** (not a package subdirectory), on the tree that is about to be pushed:

1. `pnpm run lint` — catches cross-package lint violations CI runs at root level; package-level `pnpm run lint` may miss sibling-package issues.
2. `pnpm fallow dead-code` — CI runs this gate on every `main` push (not on PRs), so a pre-existing failure blocks your push regardless of whether this issue introduced it.

If either fails, fix the issues and commit before pushing.

Run these in **both** lanes, here rather than earlier.
`/sync-worktree` runs the same two gates at its step 2 but rebases at its step 4, so the tip this ship fast-forward-merged has never been checked — a rebase onto a moved `main` can produce a tree neither side tested.
Running them after step 4 covers exactly that tree, at a measured cost of about 26 seconds.

## 6. Push

- `git push`.
- If the push is rejected as non-fast-forward, stop and report — do not force-push.

## 7. Verify CI on the pushed commit

1. Run `git rev-parse HEAD` to capture the full SHA.
   Pass that exact value to `ci_find` — never hand-expand the short SHA from the `git push` output, and never type a SHA from memory.
   Do not measure its shape (`| wc -c`) — it is command output, not a value you typed (Refs #839).
2. Use `ci_find` with that SHA and workflow `ci` to locate the CI run.
   If it times out, re-check the SHA you passed against `git rev-parse HEAD` before assuming a timing miss — a truncated or retyped SHA produces the same timeout (Refs #640).
3. Use `ci_watch` with the returned `run_id`, workflow `ci`, and `timeout: 600` to wait for it to complete.
4. If the run conclusion is `failure`, stop and report.
   Do not close the issue, release anything, or tear down a worktree.
   In the **worktree lane**, a failure the landed change caused (not flaky infra) is fixed forward on `main`: land the fix as its own commit, re-verify CI on the new HEAD, then resume at step 8.
   Never revert the ff-merge — the branch is already in `main`.
5. If it lands `success`, continue.

## 8. Check for a stacked release

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
Files outside the package tree (`.pi/skills/`, `.pi/prompts/`, root `AGENTS.md`/`README.md`) belong to no package and release nothing.

For a repo-root tooling change (plan under `docs/plans/`, no `<pkg>`), skip the command — every commit is outside the package tree, so nothing releases now.
Say so in the final report and skip the batch-vs-release question.

Then apply the decision recorded in step 2.
The issue **always** closes in step 9, regardless of this decision — closing records that the work is on `main`; releasing is a separate, batched concern.
If the decision was to defer/batch: continue to step 9, then skip steps 10 and 11 (the release lands later with the batch tail).
A release names its packages explicitly, so deferring one holds only that package — siblings keep releasing on their own ships.
Note the deferral in the final report.

## 9. Close the issue

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
  A SHA quoted from the plan or a stage note was written before a rebase, so `git rev-parse` resolves it while it is unreachable.
  Confirm each with `git merge-base --is-ancestor <sha> main` and substitute the landed SHA (Refs #814).
  Write them as plain text — no backticks — so GitHub auto-links them to the commits (Refs #733).
- A short bullet list of feature/breaking commits.
- One sentence on user-visible behavior change.
- A note flagging any breaking change (matches `feat!:` commits).
- If the change unblocks or partially addresses other issues, mention them.
- If the release was deferred (mid-batch), note that the fix is on `main` and releases with the batch — do not cite a released version.

Then use `issue_close` with issue number `$1` and the summary as the comment.

When `$1` is a third-party **PR** adopted via `/pr-review` (we re-implemented rather than merged), the close target is a PR, not an issue.
Verify with `gh api repos/gotgenes/pi-packages/issues/$1 --jq '.pull_request != null'`.
Close it with `gh pr comment` then `gh pr close` — never merge — crediting the contributor by `@login`.
An adopted PR and the issue it addresses are both close targets: shipping either one closes the other too — read the retro's PR Review stage for the counterpart number.
The multi-SHA credit list here is where hand-extended short hashes slip in (Refs #704).

A shipped issue can also supersede open third-party PRs without either being the close target — this repo reimplements rather than merges.
Close each PR that step 2's plan-and-retro read named, with `gh pr comment` then `gh pr close`, never merge, crediting the author by `@login` (Refs #670, #690).

Then check whether this push shipped work for **other** issues in the `"$PLAN"^..HEAD` range.
A co-shipped issue shows as a stacked refactor/enabler, a subject-trailing `(#M)` commit ref, or a sibling `docs/plans/`/`docs/retro/` file added in range — a body-line `Refs #M` is a citation, not a ship (Refs #793).
A mid-batch sibling that shipped on its own ship is already closed by it — this scan is for stacked work that never had a ship of its own.
Close each with its own short summary — `refactor:` commits are omitted from the changelog, so a stacked refactor issue leaves no reminder.

## 10. Dispatch the release

Releasing is the root's responsibility — peers never dispatch one.
The release workflow carries a `release` concurrency group, so two runs cannot overlap even if one is dispatched by hand.

Skip this step entirely if step 8 recorded a defer/batch decision — the release lands later with the batch tail.

1. Derive candidate packages from the paths the range touched, not from commit types (re-derive `PLAN` — a fresh shell does not carry step 9's):

   ```bash
   PLAN=$(git log --format='%H' --grep="docs: plan .*(#$1)" -1)
   git diff --name-only "$PLAN"^..HEAD | sed -n 's#^packages/\([^/]*\)/.*#\1#p' | sort -u
   ```

   Do not filter by commit type: `docs:` and `chore:` are visible changelog groups that cut a patch on their own, so a `feat|fix` scope grep silently drops a sibling bumped by a docs-only commit (Refs #857).
   Step 2 below is the authority on which candidates actually release.
   A plan under `docs/plans/` is cross-package as often as it is repo tooling — release every package the range bumps (Refs #792).
   On an empty list (repo tooling only), nothing releases: skip to step 12.
2. Confirm each candidate against `./scripts/release/next-version.sh <pkg>`.
   A package that prints nothing has no releasable commits and must not be named — the release refuses a package with nothing to release, and would fail the whole run.
   A package the shipped range did **not** bump is a sibling and is not yours to release.
3. Dispatch once, naming every package to release and pinning the commit:

   ```bash
   gh workflow run release.yml -f packages="<pkg> <pkg2>" -f sha="$(git rev-parse HEAD)"
   ```

   The package list is explicit by design: several packages can be releasable at once, and only the named ones go.
   The `sha` is a guard — the run aborts if `main` moved after you derived it.

## 11. Verify the release run

Skip this step if step 10 was skipped (deferred/batch release, or nothing to release) — there is nothing to verify.

1. Use `ci_find` with workflow `release` and the SHA you passed as `-f sha`, then `ci_watch` the returned `run_id` with `timeout: 600`.
   A dispatched run's `head_sha` is `main`'s tip at dispatch time, so it matches the SHA you pinned.
   If `ci_find` times out, the dispatch's SHA guard most likely failed because `main` moved — check the run list before re-dispatching.
2. If the `prepare`, `publish`, or `github-release` job failed, stop — do not proceed.
   `prepare` failing means nothing was tagged and the release can simply be re-dispatched.
   `publish` or `github-release` failing means the tags are already pushed: fix the cause and re-run those jobs rather than re-dispatching, which would refuse on the existing tag.
3. After the run succeeds, `git pull --ff-only` to bring the release commit and tags down.

## 12. Tear down the worktree

Trunk lane: nothing to tear down — skip.

Worktree lane: run `scripts/worktree-rm.sh $1 --delete-branch`.
The branch deletes cleanly because its commits are now in `main`; the worktree is not anyone's live CWD (the peer session can stay open or be closed — its work is landed).

## 13. Final report

Print:

- The new HEAD on `main` (`git log --oneline -1`); confirm `git status -sb` shows no unpushed commits before naming it.
- The released version **per package** released, one line each (`git tag --points-at HEAD` or read `package.json`), or that the release was deferred and why.
  Name every package step 10.1 listed — a listed package with no released version is a miss, not an omission from the report.
- Issue close confirmation(s), including any co-shipped issue and any third-party PR closed.
- Worktree/branch teardown confirmation (worktree lane).
- Anything that was skipped and why.
- If this issue completed the **last** step of a roadmap phase, flag it: the phase-close runs via `/finish-phase <PKG>` (after `/retro`), never as a filed issue.
- The next step: `/retro $1` — the deliberate, interactive final retrospective, run here at the root on `main` (commits straight to `main`).

Name `/retro $1` as the single next step.
Do **not** recommend the next issue to plan here — `/retro` surfaces the next roadmap issue at its end, after the retrospective is written.

## Constraints

- Never force-push.
- If the ff-merge is not a fast-forward, stop — the peer re-rebases; the root never merges non-linearly into `main`.
- If CI fails, the issue stays open and nothing is released or torn down.
- Never name a package in the release dispatch that `next-version.sh` reports nothing for — the run refuses it and no package releases (step 10.2).
- Never re-dispatch a release after `prepare` succeeded; the tags exist, and the run would refuse on them (step 11.2).
- If the release run (step 11) fails, do not proceed to step 12 until resolved.
- Peers never dispatch a release; only the root does.
