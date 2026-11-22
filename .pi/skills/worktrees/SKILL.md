---
name: worktrees
description: |
  Load before `/worktree`, `/sync-worktree`, or a worktree-lane `/ship`:
  launcher properties, the two-session convergence, and the ordering hazards.
---

# Parallel peer sessions (git worktrees)

Run two agents in parallel by giving each its own git worktree and its own interactive Pi session.
Use `/worktree <issue>` (the project-local `.pi/extensions/worktree.ts` command) or `scripts/worktree-new.sh <issue> [initial-command]` directly.
The launcher creates branch `issue-<N>-<slug>` off `origin/main`, checks out a worktree at `~/development/pi/pi-packages-worktrees/issue-<N>`, runs `pnpm install`, and spawns a new WezTerm tab whose CWD is the worktree, launching `pi --approve "/plan-issue <N>"`.

## Key properties

- CWD is set at spawn (`wezterm cli spawn --cwd`), never via `cd` — the peer session is born in its worktree, so the `pi-permission-system` `external_directory` gate never fires for its own work.
- `--approve` is required: Pi keys project trust by directory path, so each fresh worktree is untrusted and would otherwise block on a startup trust prompt.
- The launcher also runs `mise trust` on the worktree: `mise` gates trust by config-file path too, so a fresh worktree's `mise.toml` `[env]` block (the `scripts/bin` `npm -> pnpm` PATH shims) is skipped until trusted — trusting before `pnpm install` keeps the shims on PATH for both the install and the peer session.
- The initial slash command is passed as Pi's first positional message, which interactive mode runs through `session.prompt()` — the same path as typed input — so the prompt template expands and runs on startup.
- Reopen a closed peer tab with `/worktree-open <issue>` (or `scripts/worktree-open.sh <issue>`).
  Creation refuses an existing worktree by design, so `/worktree` is not the command for this; its refusal names the reopen script.
  The reopened session runs `pi --approve --continue`, which resumes that peer's own conversation — Pi keys sessions by directory, so `--continue` inside the worktree needs no picker.
  It validates and spawns only: no branch creation, no `pnpm install`, and it aborts loudly if the directory is missing or is no longer a registered git worktree rather than silently re-creating it.
- Tear down with `scripts/worktree-rm.sh <issue> [--delete-branch]`.

## Convergence (the two-session ship flow)

`main` stays linear and a peer cannot push to it directly, so the convergence is split across the peer and root sessions.
The root half is the ordinary `/ship <N>`: it detects a **worktree lane** from the presence of an `issue-<N>-*` branch and fast-forward-merges it, where a trunk ship has nothing to merge.
The close and release steps are identical in both lanes — no branching at all — which is what keeps the two paths from drifting apart; only the CI-failure recovery rule and the teardown remain lane-specific after the push:

1. Peer session — `/sync-worktree <N>`: run pre-push checks, write a **sync** stage note (committed on the branch so it rides the land), then `git fetch origin` + `git rebase main` (local `main` — the ref the root will merge into).
   The peer never touches `main`, never pushes the branch, never force-pushes — worktrees share the same `.git`, so the root sees the branch ref directly.
   The peer writes only stage breadcrumbs (planning/TDD/sync); the deliberate, interactive final `/retro` does not run here.
2. Root session — `/ship <N>`: `git merge --ff-only <branch>` into `main`, run the pre-push checks on the merged tree, push, verify CI, `issue_close`, then release.
   If the ff-merge is not a fast-forward (another peer landed first), the peer re-runs `/sync-worktree <N>` to rebase onto the new `origin/main`.
   The checks run here as well as in `/sync-worktree` because the peer checks *before* it rebases, so the tip the root merges has not been checked on its own.
3. Release is the root's responsibility — peers never dispatch one, and the workflow's `release` concurrency group serializes runs regardless.
   It honors the plan's `**Release:**` marker: `mid-batch — defer` simply does not name that package.
4. `/ship` ends a worktree-lane run by executing `scripts/worktree-rm.sh <N> --delete-branch`, then names `/retro <N>` as the final step.
5. Root session — `/retro <N>`: the deliberate, interactive final retrospective, run at the root on `main` after the land (commits straight to `main`, no branch needed) — mirroring the trunk flow's terminal `/retro`.
   Run it on your preferred model; the stage breadcrumbs from the peer session are already on `main` for it to synthesize.

## Guardrails

- Partition work by package — one package per peer.
  Two peers touching `pnpm-lock.yaml` or the same package's source is the main parallel-work hazard.
- A worktree branch still needs both halves: `/sync-worktree` in the peer, then `/ship` at the root.
  `/ship` refuses to run anywhere but the root checkout on `main`, so it cannot be used as the peer's half.
- Whoever lands second rebases first: if `/ship`'s ff-merge fails, the peer re-runs `/sync-worktree` to rebase onto the new `origin/main` (a non-linear merge into `main` is rejected by design).
- Land a pending worktree branch before committing unrelated work to `main`.
  An intervening root commit to `main` stales the peer's completed `/sync-worktree` rebase, so the ff-merge is rejected and the peer must re-rebase.
  An **unpushed** root commit is the sharper form — the peer rebases onto `origin/main`, cannot see it, and its rebase is a no-op, so it cannot self-correct.
  `git pull --ff-only` hides this (`Already up to date.`, exit 0, when local is merely *ahead*): check `git rev-list --count origin/main..main`, and predict the ff-merge with `git merge-base --is-ancestor main <branch>`.
- A first launch in each worktree reinstalls `.pi/npm/` (gitignored, so it does not carry over) — a one-time cost Pi handles automatically.
