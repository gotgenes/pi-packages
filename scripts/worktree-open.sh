#!/usr/bin/env bash
#
# Reopen a peer Pi session for an *existing* worktree.
#
# The companion to worktree-new.sh: that script refuses to touch a worktree that
# already exists, which is correct for creation and unhelpful when the peer's
# WezTerm tab was simply closed. This one does the reopen and nothing else — no
# branch creation, no `pnpm install`, no teardown.
#
# Usage:
#   scripts/worktree-open.sh <issue-number>
#
# The session resumes with `pi --continue`, so the peer picks up the
# conversation it was in rather than starting cold. Pi keys sessions by
# directory, so `--continue` inside the worktree resolves that peer's own
# session with no picker and no ambiguity. A worktree with no session yet is
# fine: `--continue` degrades to a fresh session rather than failing.
#
# Prerequisites: git, wezterm (run from inside WezTerm).

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

# Resolve repo root so the script works from any CWD.
repo_root="$(git rev-parse --show-toplevel)" || die "not inside a git repository"

worktree="${WORKTREE_PARENT}/issue-${issue}"

# Abort loudly rather than repairing. A missing directory or an unregistered
# path means the worktree was torn down (or never created), and quietly
# re-creating it here would hide that from the operator — the reopen would
# "succeed" into a tree with none of the peer's work.
[[ -d "$worktree" ]] \
  || die "no worktree directory at ${worktree} — create one with: scripts/worktree-new.sh ${issue}"

# `git worktree list --porcelain` emits one `worktree <absolute-path>` line per
# registered entry. Compare against both the literal and the symlink-resolved
# path: git records the path it was given, which may differ from `pwd -P` when a
# parent directory is a symlink.
resolved="$(cd "$worktree" && pwd -P)"
registered="$(git -C "$repo_root" worktree list --porcelain \
  | awk '/^worktree /{print substr($0, 10)}')"
if ! printf '%s\n' "$registered" | grep -qxF "$worktree" \
  && ! printf '%s\n' "$registered" | grep -qxF "$resolved"; then
  die "${worktree} exists but is not a registered git worktree — inspect it, then clean up with: scripts/worktree-rm.sh ${issue}"
fi

branch="$(git -C "$worktree" rev-parse --abbrev-ref HEAD)"

printf '\nworktree : %s\nbranch   : %s\n\n' "$worktree" "$branch"

# Launch the peer session born in the worktree. No `cd` — CWD is set at spawn,
# so the pi-permission-system external_directory gate never fires for the peer's
# own work.
#
# --approve is required on every open, not just the first: Pi keys project trust
# by directory path, and each worktree is a distinct path with no stored
# decision, so the session would otherwise block on a startup trust prompt.
if command -v wezterm >/dev/null && [[ -n "${WEZTERM_PANE:-}" ]]; then
  wezterm cli spawn --cwd "$worktree" -- pi --approve --continue
  printf '✓ peer Pi session reopened in a new WezTerm tab (cwd=%s)\n' "$worktree"
  printf '  continuing the most recent session for this worktree\n'
else
  printf '⚠ not inside WezTerm — reopen the peer session manually:\n'
  printf '    cd %q && pi --approve --continue\n' "$worktree"
fi
