#!/usr/bin/env bash
# Publish to npm every package tagged at HEAD.
#
# Replaces the release-please variant, which parsed a JSON-encoded `paths_released`
# action output. `prepare-release.sh` tags every released package at the single
# release commit, so git itself names the set — no action output to plumb, and
# nothing to parse (Refs #865).
#
# There is no hardcoded package list, so a newly added package publishes
# automatically once it is released.
#
# Usage:
#   ./scripts/release/publish-released.sh

set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=scripts/release/lib.sh
. scripts/release/lib.sh

# The tags were created by a previous job on a different runner, so they are not
# in this checkout until fetched.
git fetch --tags --force origin

published=0

while IFS= read -r tag; do
  [ -n "$tag" ] || continue

  # Map `<pkg>-v<version>` back to a package directory by matching the known
  # package names, rather than by splitting on "-v" — a package name is free to
  # contain that sequence.
  pkg=""
  while IFS= read -r candidate; do
    case "$tag" in
      "${candidate}-v"*)
        # Prefer the longest match, so `pi-subagents-worktrees-v1` never
        # resolves to `pi-subagents`.
        if [ ${#candidate} -gt ${#pkg} ]; then
          pkg=$candidate
        fi
        ;;
    esac
  done < <(release_packages)

  if [ -z "$pkg" ]; then
    echo "Note: tag '$tag' matches no package; skipping." >&2
    continue
  fi

  name=$(jq -r '.name' "packages/$pkg/package.json")

  echo "::group::Publishing $name ($pkg) from $tag"
  pnpm --filter "$name" publish --access public --no-git-checks --provenance
  echo "::endgroup::"
  published=$((published + 1))
done < <(git tag --points-at HEAD)

if [ "$published" -eq 0 ]; then
  echo "No released packages to publish."
fi
