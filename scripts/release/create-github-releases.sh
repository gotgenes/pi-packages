#!/usr/bin/env bash
# Create one GitHub Release per tag at HEAD, with notes rendered by git-cliff.
#
# release-please created these as a side effect of tagging. With git-cliff the
# tag and the release are separate acts, so this runs after the publish job and
# is the last step of a release (Refs #865).
#
# Required environment variables:
#   GH_TOKEN   GitHub token with contents:write.
#
# Usage:
#   ./scripts/release/create-github-releases.sh

set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=scripts/release/lib.sh
. scripts/release/lib.sh

: "${GH_TOKEN:?Required: set GH_TOKEN}"

git fetch --tags --force origin

created=0

while IFS= read -r tag; do
  [ -n "$tag" ] || continue

  pkg=""
  while IFS= read -r candidate; do
    case "$tag" in
      "${candidate}-v"*)
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

  if gh release view "$tag" >/dev/null 2>&1; then
    echo "Release $tag already exists; skipping."
    continue
  fi

  notes=$(mktemp)
  cliff_args "$pkg"
  # `--latest` is the newest tagged release for this package, which is `$tag`
  # because prepare-release.sh has already pushed it.
  git-cliff "${CLIFF_ARGS[@]}" --latest --strip header > "$notes"

  echo "Creating GitHub Release $tag"
  gh release create "$tag" --title "$tag" --notes-file "$notes"
  created=$((created + 1))
done < <(git tag --points-at HEAD)

if [ "$created" -eq 0 ]; then
  echo "No GitHub Releases to create."
fi
