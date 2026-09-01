#!/usr/bin/env bash
# Assert that git-cliff's view of every package's version agrees with the tags
# and the package.json files, and report what each package would release.
#
# This is the migration's correctness gate (Refs #865). At migration time it
# also compares against `.release-please-manifest.json`, so the claim "git-cliff
# reproduces exactly what release-please arrived at" is checked rather than
# asserted. That arm disappears on its own once the manifest is deleted; the
# rest of the check is durable and stays useful afterwards.
#
# Read-only and offline. Requires tags to be present locally.
#
# Usage:
#   git fetch --tags
#   ./scripts/release/verify-cliff-parity.sh

set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=scripts/release/lib.sh
. scripts/release/lib.sh

MANIFEST=.release-please-manifest.json
failures=0
checked=0

if [ -f "$MANIFEST" ]; then
  echo "Comparing against $MANIFEST as well (migration-time check)."
else
  echo "No $MANIFEST; checking tags and package.json only."
fi
echo

while IFS= read -r pkg; do
  checked=$((checked + 1))
  pkgver=$(package_json_version "$pkg")
  tag=$(latest_tag "$pkg")

  if [ -z "$tag" ]; then
    printf '%-28s FAIL  no %s-v* tag\n' "$pkg" "$pkg"
    failures=$((failures + 1))
    continue
  fi

  # The tag and the package.json must name the same version, or the next bump
  # starts from the wrong base.
  if [ "$tag" != "${pkg}-v${pkgver}" ]; then
    printf '%-28s FAIL  tag %s but package.json %s\n' "$pkg" "$tag" "$pkgver"
    failures=$((failures + 1))
    continue
  fi

  if [ -f "$MANIFEST" ]; then
    manver=$(jq -r --arg p "packages/$pkg" '.[$p] // ""' "$MANIFEST")
    if [ "$manver" != "$pkgver" ]; then
      printf '%-28s FAIL  package.json %s but manifest %s\n' "$pkg" "$pkgver" "$manver"
      failures=$((failures + 1))
      continue
    fi
  fi

  cliff_args "$pkg"
  if ! next=$(git-cliff "${CLIFF_ARGS[@]}" --bumped-version 2>/dev/null); then
    printf '%-28s FAIL  git-cliff could not derive a version\n' "$pkg"
    failures=$((failures + 1))
    continue
  fi

  if [ "$next" = "$tag" ]; then
    printf '%-28s ok    %s (nothing to release)\n' "$pkg" "$pkgver"
  else
    printf '%-28s ok    %s -> would release %s\n' "$pkg" "$pkgver" "${next#"${pkg}-v"}"
  fi
done < <(release_packages)

echo
if [ "$failures" -ne 0 ]; then
  echo "$failures of $checked package(s) FAILED parity." >&2
  exit 1
fi
echo "All $checked package(s) consistent."
