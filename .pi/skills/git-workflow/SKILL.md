---
name: git-workflow
description: |
  Load before `git commit`, `--amend`, `rebase`, `reset`, or a `gh` command that mutates state;
  before writing a commit body, a `Co-authored-by:` trailer, or a `BREAKING CHANGE:` note;
  and before pricing a rename as breaking.
---

# Git workflow

## Conventional Commits

Use Conventional Commits.
Type a commit by what a user can observe once it lands, not by what it adds to the tree.
A module no code imports yet is `refactor:` however new it is; the commit that wires it up carries the `feat:`/`fix:`.
For a breaking change, place the `!` **after** the scope: `fix(pkg)!:` / `feat(pkg)!:` — never `fix!(pkg):`, which the grammar rejects, so the commit is dropped and the major bump skipped.
The `!` carries the major bump even on a type that is otherwise skipped from the changelog, such as `refactor(pkg)!:` — `protect_breaking_commits` in `cliff.toml` is what preserves that; do not remove it.
A `commit-msg` hook runs [`committed`](https://github.com/crate-ci/committed) (wired via `prek`, installed by `pnpm install`) and enforces this deterministically: a malformed header fails locally before it can mis-version a release.
When a `prek` hook fails to **install** (a network error building the hook env — e.g. `uv` fetching `setuptools`, not a lint/grammar failure), it blocks the commit without having run any check.
Run the equivalent gate manually (`pnpm exec rumdl check`, `pnpm run lint`) and, once clean, commit with `--no-verify`.
This applies only to a hook *install* failure — a hook that runs and *reports* a violation is a real gate; fix it, never `--no-verify` past it.
When a commit-lint or format gate fires a false positive, disable the single offending check (the specific `committed.toml` field), not the whole gate.
Commit at meaningful checkpoints without waiting for an explicit reminder.
Prefer small, reviewable commits that leave the repository in a valid state.

## Gating a commit on a check

Do not gate a commit (or any `&&` step) on a check piped through `tail`/`head` — a pipeline's exit status is the filter's, so a failed `pnpm run lint`/`check` is masked and the commit still runs.
Run the check unpiped, or test `${PIPESTATUS[0]}`.
`git commit … | tail -3` likewise hides a hook rejection behind the hook's own PASS lines — confirm the commit landed with `git log -1`.
To keep the output short without losing the gate, redirect rather than pipe: `pnpm run check >/tmp/check.log 2>&1 || tail -30 /tmp/check.log`.
Do not append `; echo $?` to that recipe — on the failing branch `$?` is `tail`'s, so a failed gate prints `0`; capture the gate's own status first (`cmd >log 2>&1; rc=$?`).
That redirect hides Biome findings at **warning** level, which exit 0 — `pnpm run lint` reports PASS while new warnings accumulate.
After adding or heavily editing files, count them: `pnpm run lint >/tmp/l.log 2>&1; grep -cE 'lint/[A-Za-z]+/' /tmp/l.log || true` — `grep -c` exits 1 on a zero count, and a bare `lint/` also matches the echoed `scripts/lint/…` command.
`biome check --write` reports `No fixes applied` for a warning, whose fix is unsafe-classified — hand-edit it, or `--write --unsafe` the one file.
`rumdl` caches per markdown file keyed on that file's own content, but `MD057` (relative-link existence) depends on the filesystem around it — so moving or renaming a linked-to file leaves every unchanged doc that links to it cached as clean.
After a commit that moves or renames files, clear the cache before trusting the gate: `find .rumdl_cache -type f -delete`.
Clearing it otherwise is waste, not caution — a cold `rumdl check .` costs ~1.9 s against ~0.1 s warm, and a content edit already invalidates its own entry.

## Numbers a command produces

Do not edit `CHANGELOG.md` — `scripts/release/prepare-release.sh` owns it, splicing each release in below the header.
Do not name an unreleased version in docs — git-cliff assigns it at release time, so a number written during implementation is a guess. (`./scripts/release/next-version.sh <pkg>` will tell you what it would be, but that answer moves with every commit until the release runs.) Describe the condition instead: "a version that predates the heartbeat", not "older than 25.2.0".
The same applies to an unfiled issue number: file the follow-up first, then write back the number the API returned — a guessed `#N` is off by however many issues landed since.
The same applies to a commit SHA: resolve every one you publish with `git rev-parse` — including the second and third hash cited mid-draft, which is where the invention happens.

## Pricing a breaking change

Before pricing a rename of this repo's own export as breaking, check whether it has shipped.
Read the file at the published tag: `pnpm view @gotgenes/<pkg> version`, then `git show <pkg>-v<version>:<path>`.
Never `.pi/npm/node_modules/` — it is only as fresh as the last `pi update --extensions`, so a stale copy hides an export that already shipped.
An export that exists only on unreleased `main` renames for free.
A type reachable from the published declaration bundle is as breaking as a named export — a third-party consumer receives it through a field of a type that is exported.
Before naming a remediation in a breaking-change migration note (CLI flag, config key, API call), verify it exists in the real surface (SDK types, `--help`, schema) — do not infer a config key by analogy.
The note ships to the `BREAKING CHANGE:` footer, the generated CHANGELOG, and the issue close comment.

## Issue references and credit

Do not put `Closes #N` / `Fixes #N` / `Resolves #N` in commit messages.
`/ship` posts a curated close comment (implemented-in SHA, behavior summary) via `issue_close`; a commit keyword auto-closes the issue on push and pre-empts that comment, leaving the issue with no summary.
GitHub matches the keyword anywhere in the message, not only as a footer: "the fix #1004 proposed" closes #1004, so write "#1004's fix" instead.
Reference issues as `(#N)` in the subject or `Refs #N` in the body instead.
Still separate footer tokens (`Refs #N`, `BREAKING CHANGE:`) from the body with a blank line for readability; it is not enforced — `committed` validates only the header grammar.
Credit a contributor with `Co-authored-by:` whenever their **accepted design** ships, whether or not their patch was taken and whether or not they opened a PR — a constraint or mechanism adopted from an issue, a PR review, or a comment thread all qualify.
A measured bug report with no design contribution is not this case — name the reporter in the issue body and the close comment instead.
Put `Co-authored-by:` in the **final** paragraph, below `Refs #N` — git reads only the last paragraph as trailers, and `Refs #N` (no colon) is not trailer-shaped, so a co-author line above it is invisible to GitHub attribution.
Verify with `git interpret-trailers --parse`.

## Rebase, reset, amend, and revert

Tidy local commits before pushing, and leave a pushed commit alone.
Skip a tidy that would mean rewriting many SHA citations.

Avoid `git rebase -i` in this environment — `$EDITOR` opens an interactive editor that aborts non-interactively.
Reorder or fix unpushed commits with `git reset` + re-commit, or set `GIT_SEQUENCE_EDITOR`/`EDITOR=true`.
`git rebase --continue` opens the *commit-message* editor through `GIT_EDITOR`, which `GIT_SEQUENCE_EDITOR` does not cover — set `GIT_EDITOR=true` for it.
In a worktree `.git` is a file, so rebase state lives at `$(git rev-parse --git-dir)/rebase-merge`; a bare `.git/rebase-merge` test reports a live rebase as absent.
A scripted rebase reports `Successfully rebased` even when the sequence editor matched nothing and every line replayed as `pick` — this git writes its todo as `pick <sha> # <subject>`.
Verify by diffing the subjects, and confirm the content is untouched with `git diff <backup-tag> HEAD`.
After `git reset --soft HEAD~N`, all N commits' changes are staged together — to re-split into separate commits, run `git reset` (mixed) first, then `git add` per commit.
A commit a pre-commit hook rejected never moved `HEAD`, so a following `git reset --soft HEAD~1` undoes the *previous* commit — confirm with `git log -1` first.
`git checkout <ref> -- <path>` to revert any probe — an A/B swap, a killing mutation, a type-check spike — destroys uncommitted work: the restore half (`git checkout HEAD -- <path>`) restores HEAD, which is the *previous* commit while the current step is still uncommitted.
Back both sides up as files first — `cp` the working state aside, `git show <ref>:<path> >` the baseline — and swap with `cp` in both directions; never lead the restore with `rm -rf <path>`, which the permission gate denies mid-command and leaves a partial tree.
Staged deletions from `git rm` ride along with the next `git commit` even when you `git add` only unrelated paths — commit with an explicit pathspec (`git commit -- <paths>`) or check `git status` first.
Before `git commit --amend`, confirm HEAD is your own commit (`git log -1`) — a concurrent session may have committed since yours, and amend rewrites whatever HEAD points at.

## `gh` commands that mutate state

- To check a GitHub issue/PR's state (including upstream repos), use `gh issue view N --repo owner/repo`, not web search.
- Never run a state-mutating command (`gh issue close`, `gh pr merge`, `git push`) to discover what it does — it executes.
  Probe with a read-only query (`gh api .../issues/N --jq .state`) or `--help`.
  When such a command fails with a transient error (HTTP 5xx), verify whether it applied before retrying — `gh pr merge` can 503 after the merge lands.
  Probe with REST (`gh api repos/OWNER/REPO/pulls/N --jq .merged`), which stays up when the GraphQL endpoint behind `gh pr view --json` and `gh pr merge` is degraded.
