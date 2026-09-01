#!/usr/bin/env bash
# Diff a package's working tree against its most recent release tag, scoped to
# that package's directory, using hunk.
#
# Usage: hunk-pkg-diff.sh <package-name> [hunk-options...]
#   e.g. hunk-pkg-diff.sh pi-subagents
#        hunk-pkg-diff.sh pi-permission-system --mode split
#
# Tags are <component>-v<version>. The glob is "<pkg>-v*" so a package like
# pi-subagents does not also match the sibling pi-subagents-worktrees tags.
set -euo pipefail

usage() {
  printf 'Usage: %s <package-name> [hunk-options...]\n' "$(basename "$0")" >&2
  printf '  e.g. %s pi-subagents\n' "$(basename "$0")" >&2
  printf '       %s pi-permission-system --mode split\n' "$(basename "$0")" >&2
  exit "${1:-1}"
}

[[ $# -ge 1 ]] || usage 1
case "$1" in
  -h | --help) usage 0 ;;
esac

PKG="$1"
shift

PKG_DIR="packages/$PKG"
[[ -d "$PKG_DIR" ]] || {
  printf 'No such package directory: %s\n' "$PKG_DIR" >&2
  exit 1
}

TAG_GLOB="${PKG}-v*"
LATEST_TAG=$(git tag --list "$TAG_GLOB" --sort=-version:refname | head -1)
[[ -n "$LATEST_TAG" ]] || {
  printf 'No release tag found matching %s\n' "$TAG_GLOB" >&2
  exit 1
}

printf 'Diffing %s against %s (scoped to %s)\n' "$PKG" "$LATEST_TAG" "$PKG_DIR" >&2
exec hunk diff "$@" "$LATEST_TAG" -- "$PKG_DIR"
