#!/usr/bin/env bash
#
# Create an isolated git worktree for a peer Pi session.
#
# Spawns a new WezTerm tab whose CWD is the worktree, so the peer agent is
# *born* in its own working directory — no `cd` is ever required, and the
# pi-permission-system external_directory gate never fires (the worktree is
# the session's CWD, not an outside-CWD path).
#
# Usage:
#   scripts/worktree-new.sh <issue-number> [initial-slash-command]
#
# This script only *creates*. To reopen a peer session for a worktree that
# already exists (e.g. its WezTerm tab was closed), use scripts/worktree-open.sh.
#
# The peer Pi session launches with an initial prompt already submitted —
# `/plan-issue <N>` by default — so it starts working immediately. Pass a
# different command (without the leading slash is fine) as the second arg,
# e.g. `scripts/worktree-new.sh 42 build-plan`. Pass "" to open a bare session.
#
# Layout:
#   worktree dir : ~/development/pi/pi-packages-worktrees/issue-<N>
#   branch       : issue-<N>-<slug-from-gh-title>   (based on origin/main)
#
# Prerequisites: git, gh, pnpm, wezterm (run from inside WezTerm).

set -euo pipefail

WORKTREE_PARENT="${WORKTREE_PARENT:-$HOME/development/pi/pi-packages-worktrees}"

die() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

if [[ $# -lt 1 ]]; then
  printf 'Usage: %s <issue-number>\n' "$(basename "$0")" >&2
  exit 1
fi

issue="$1"
[[ "$issue" =~ ^[0-9]+$ ]] || die "issue number must be numeric, got: $issue"

# Initial slash command for the peer session (default: /plan-issue <N>).
# An empty second arg opens a bare interactive session.
if [[ $# -ge 2 ]]; then
  raw_cmd="$2"
else
  raw_cmd="plan-issue $issue"
fi
if [[ -n "$raw_cmd" ]]; then
  initial_prompt="/${raw_cmd#/}"
else
  initial_prompt=""
fi

command -v gh >/dev/null || die "gh not found on PATH"
command -v pnpm >/dev/null || die "pnpm not found on PATH"

# Resolve repo root so the script works from any CWD.
repo_root="$(git rev-parse --show-toplevel)" || die "not inside a git repository"

# Derive a slug from the issue title (lowercase, non-alnum -> '-', trimmed, capped).
title="$(gh issue view "$issue" --json title -q .title 2>/dev/null)" \
  || die "could not fetch issue #$issue via gh (is it a valid issue?)"
slug="$(printf '%s' "$title" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' \
  | cut -c1-40 \
  | sed -E 's/-+$//')"
[[ -n "$slug" ]] || slug="work"

branch="issue-${issue}-${slug}"
worktree="${WORKTREE_PARENT}/issue-${issue}"

# Creation never touches an existing worktree. Reopening a closed peer tab is a
# different job with a different script, so name it here rather than leaving the
# operator to reconstruct the wezterm/pi invocation by hand.
[[ -e "$worktree" ]] \
  && die "worktree path already exists: ${worktree} — reopen its session with: scripts/worktree-open.sh ${issue}"

mkdir -p "$WORKTREE_PARENT"

# Base the worktree on the latest origin/main (best-effort fetch).
git -C "$repo_root" fetch --quiet origin main 2>/dev/null || true
if git -C "$repo_root" rev-parse --verify --quiet origin/main >/dev/null; then
  base="origin/main"
else
  base="main"
fi

# Reuse an existing branch if present; otherwise create it from the base ref.
if git -C "$repo_root" show-ref --verify --quiet "refs/heads/${branch}"; then
  printf 'branch %s already exists — checking it out into the worktree\n' "$branch"
  git -C "$repo_root" worktree add "$worktree" "$branch"
else
  git -C "$repo_root" worktree add -b "$branch" "$worktree" "$base"
fi

printf '\nworktree : %s\nbranch   : %s (from %s)\n\n' "$worktree" "$branch" "$base"

# Trust the worktree's mise config. mise gates trust by config-file path, so a
# fresh worktree is untrusted and mise would skip its [env] block — dropping the
# scripts/bin PATH shims (e.g. npm -> pnpm) for both the install below and the
# peer session. Trusting before install ensures the shims are on PATH.
if command -v mise >/dev/null && [[ -f "$worktree/mise.toml" ]]; then
  mise trust "$worktree/mise.toml" >/dev/null && printf 'mise: trusted %s/mise.toml\n' "$worktree"
fi

# Each worktree needs its own node_modules (pnpm's global store keeps this fast).
printf 'installing dependencies (pnpm install)...\n'
(cd "$worktree" && pnpm install)

# Launch a peer Pi session born in the worktree. No `cd` — CWD is set at spawn.
# The initial slash command is passed as pi's first positional message, which
# interactive mode submits via session.prompt() — the same path as typed input,
# so the prompt template (e.g. /plan-issue) is expanded and run on startup.
#
# --approve trusts the project-local .pi/ files for this run. Each worktree is a
# distinct path, so Pi's trust store (keyed by directory) has no decision for it
# and would otherwise block on a trust prompt at startup. The worktree is our
# own checkout of this repo, so auto-approving the spawned session is intended.
if command -v wezterm >/dev/null && [[ -n "${WEZTERM_PANE:-}" ]]; then
  if [[ -n "$initial_prompt" ]]; then
    wezterm cli spawn --cwd "$worktree" -- pi --approve "$initial_prompt"
  else
    wezterm cli spawn --cwd "$worktree" -- pi --approve
  fi
  printf '\n✓ peer Pi session launched in a new WezTerm tab (cwd=%s)\n' "$worktree"
  [[ -n "$initial_prompt" ]] && printf '  initial prompt: %s\n' "$initial_prompt"
else
  printf '\n⚠ not inside WezTerm — start the peer session manually:\n'
  if [[ -n "$initial_prompt" ]]; then
    printf '    cd %q && pi --approve %q\n' "$worktree" "$initial_prompt"
  else
    printf '    cd %q && pi --approve\n' "$worktree"
  fi
fi

printf '\nwhen done, tear it down with:\n    scripts/worktree-rm.sh %s\n' "$issue"
