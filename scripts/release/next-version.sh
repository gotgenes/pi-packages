#!/usr/bin/env bash
# Print the tag a package would release right now, or nothing if it would not.
#
# Read-only and offline. This is the question release-please could never answer
# locally: it derived versions over the GitHub API, so "what would release?"
# required a CI run. git-cliff reads tags and local history, so the answer is
# available in a working checkout in under a second (Refs #865).
#
# Prints `<pkg>-v<version>` to stdout when there is something to release, and
# nothing at all when there is not. Diagnostics go to stderr.
#
# Usage:
#   ./scripts/release/next-version.sh pi-subagents
#
# Exit status is 0 whether or not a release is pending; test the output, not the
# status. A nonzero status means the question could not be answered.

set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=scripts/release/lib.sh
. scripts/release/lib.sh

pkg=${1:-}
if [ -z "$pkg" ]; then
  echo "Usage: $0 <package-directory-name>" >&2
  exit 1
fi
require_package "$pkg"

current=$(latest_tag "$pkg")
if [ -z "$current" ]; then
  # A package with no tag has never released. git-cliff cannot derive a first
  # version here — it falls back to `0.1.0` and then rejects it for not matching
  # the tag pattern — and there is no convention to infer one from: this repo's
  # packages opened at 1.0.0, 0.2.0, and 0.1.0. The first release is a manual,
  # operator-chosen step anyway (AGENTS.md: npm Trusted Publishing cannot create
  # a package that does not exist), so refuse rather than invent a version.
  echo "Error: '$pkg' has no ${pkg}-v* tag, so it has never released." >&2
  echo "       Publish and tag the first version by hand (see AGENTS.md), then" >&2
  echo "       this script takes over." >&2
  exit 1
fi

cliff_args "$pkg"

# git-cliff prints the *current* version, plus a "nothing to bump" warning on
# stderr, when no releasable commit has landed since the last tag.
next=$(git-cliff "${CLIFF_ARGS[@]}" --bumped-version 2>/dev/null)

if [ -z "$next" ]; then
  echo "Error: git-cliff produced no version for '$pkg'." >&2
  exit 1
fi

if [ "$next" = "$current" ]; then
  echo "Nothing to release for '$pkg' (at $current)." >&2
  exit 0
fi

printf '%s\n' "$next"
