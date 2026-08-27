#!/usr/bin/env bash
# Print the commit SHA to use as release-please's `last-release-sha` baseline.
#
# `last-release-sha` is a single repo-global floor on release-please's commit
# walk, pinned to cap the walk in this high-volume monorepo (Refs #468). It must
# sit at or before *every* component's last release commit: release-please stops
# its walk at the floor, so a component whose last release is older than the
# floor never has the intervening commits collected, and they cannot reach its
# changelog or drive its version bump (Refs #816).
#
# The floor is therefore the oldest of all components' last-release commits.
# It is derived from .release-please-manifest.json rather than from the release
# action's outputs, because those report only the components that just released
# — which is exactly the set that cannot reveal a lagging component.
#
# This costs nothing against the #468 bound: release-please already ends its own
# walk once it has seen every component's release commit, which is the same
# commit this script prints.
#
# Reads only. Prints a SHA to stdout, diagnostics to stderr, and mutates
# nothing, so it is safe to run against a working checkout during a manual
# recovery (Refs #646). Tags must already be present locally.
#
# Usage:
#   git fetch --tags
#   ./scripts/release-baseline-sha.sh

set -euo pipefail

CONFIG=release-please-config.json
MANIFEST=.release-please-manifest.json

for file in "$CONFIG" "$MANIFEST"; do
  if [ ! -f "$file" ]; then
    echo "Error: $file not found; run from the repository root" >&2
    exit 1
  fi
done

# Tag shape follows the config: `include-component-in-tag` and `include-v-in-tag`
# are both true and `tag-separator` is the default, giving `<component>-v<version>`.
# The component name comes from the config rather than the path basename because
# that is the key release-please itself builds the tag from; the two happen to
# coincide today.
mapfile -t entries < <(jq -r --slurpfile cfg "$CONFIG" '
  to_entries[]
  | .key as $path
  | ($cfg[0].packages[$path].component // ($path | sub(".*/"; ""))) as $component
  | "\($path)\t\($component)-v\(.value)"
' "$MANIFEST")

if [ ${#entries[@]} -eq 0 ]; then
  echo "Error: no components found in $MANIFEST" >&2
  exit 1
fi

release_shas=()
for entry in "${entries[@]}"; do
  path=${entry%%$'\t'*}
  tag=${entry#*$'\t'}

  sha=$(git rev-list -1 "refs/tags/$tag" 2>/dev/null || true)

  if [ -z "$sha" ]; then
    # A manifest component with no tag has never released: AGENTS.md's
    # new-package flow registers it at 0.0.0 before its first publish. Its walk
    # has to reach its very first commit, so floor at the one that added it.
    sha=$(git log --diff-filter=A --format=%H -1 -- "$path/package.json")
    if [ -z "$sha" ]; then
      echo "Error: '$path' has neither a tag '$tag' nor a commit adding $path/package.json" >&2
      exit 1
    fi
    echo "Note: '$path' is untagged ($tag); flooring at its package.json-adding commit $sha." >&2
  fi

  release_shas+=("$sha")
done

floor=$(git merge-base --octopus "${release_shas[@]}")

# A common ancestor is at or before every input by construction, so it is always
# a safe floor. On linear history it *is* the oldest input; if it is not, the
# history has branched and the walk widens — report that rather than widen
# silently.
if ! printf '%s\n' "${release_shas[@]}" | grep -qx "$floor"; then
  echo "Note: floor $floor is a common ancestor rather than a release commit; the walk widens." >&2
fi

printf '%s\n' "$floor"
