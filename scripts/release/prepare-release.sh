#!/usr/bin/env bash
# Version, changelog, commit, tag, and push a release for the named packages.
#
# Run by the `release.yml` workflow. Commits and pushes to main, so it refuses to
# run outside CI unless told otherwise — the read-only half of this pair is
# `scripts/release/next-version.sh`, which is the one to run in a working
# checkout (Refs #865, and the same split as the release-please baseline scripts
# it replaces).
#
# Packages are named explicitly. Several packages can be releasable at once —
# parallel worktrees make that normal — and releasing one must never drag a
# sibling along.
#
# All versions are derived before anything is written. A package the caller named
# that has nothing to release is an error, and it is reported before the first
# mutation rather than after some packages have already been tagged.
#
# Required environment variables:
#   PACKAGES       Space- or comma-separated package directory names.
#
# Optional environment variables:
#   EXPECTED_SHA   If set, asserts HEAD matches before proceeding. Guards against
#                  main moving between the caller deriving a SHA and this run.
#   ALLOW_LOCAL_PUSH  Set to 1 to run outside CI deliberately.
#
# Outputs (via $GITHUB_OUTPUT when available):
#   tags  Space-separated tags created, e.g. "pi-subagents-v21.3.0"
#   sha   The release commit. Downstream jobs check this out rather than `main`,
#         which another push could move past between jobs.
#
# Usage:
#   PACKAGES="pi-subagents pi-colgrep" ./scripts/release/prepare-release.sh

set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=scripts/release/lib.sh
. scripts/release/lib.sh

: "${PACKAGES:?Required: set PACKAGES to the package directory names to release}"

if [ -z "${CI:-}" ] && [ -z "${ALLOW_LOCAL_PUSH:-}" ]; then
  echo "Error: this script commits and pushes to main, and CI is not set." >&2
  echo "       To see what would release without changing anything, run:" >&2
  echo "         ./scripts/release/next-version.sh <package>" >&2
  echo "       To push from here anyway, re-run with ALLOW_LOCAL_PUSH=1." >&2
  exit 1
fi

if [ -n "${EXPECTED_SHA:-}" ]; then
  actual=$(git rev-parse HEAD)
  if [ "$actual" != "$EXPECTED_SHA" ]; then
    echo "Error: HEAD ($actual) does not match expected SHA ($EXPECTED_SHA)." >&2
    echo "       main moved since the release was requested. Aborting." >&2
    exit 1
  fi
  echo "SHA guard passed: HEAD is $EXPECTED_SHA"
fi

# Splice a rendered release section into a CHANGELOG below its header.
#
# The insertion point is the first line that opens a release section or the
# era marker, so the newest release always lands directly under the header and
# the marker stays put at the release-please boundary. Header shape varies
# across these files (two lines in most, seven in pi-subagents and
# pi-permission-system), so it is found rather than assumed.
insert_release_section() {
  local file=$1 section=$2 pkg=$3 tmp line
  tmp=$(mktemp)

  if [ ! -f "$file" ]; then
    # A package releasing for the first time has no changelog to splice into,
    # so render one complete with the configured header.
    cliff_args "$pkg"
    git-cliff "${CLIFF_ARGS[@]}" --tag "$tag" --unreleased -o "$file"
    rm -f "$tmp"
    return
  fi

  line=$(grep -n -m1 -E '^(## |<!-- )' "$file" | cut -d: -f1)
  if [ -z "$line" ]; then
    line=$(($(wc -l < "$file") + 1))
  fi

  head -n "$((line - 1))" "$file" > "$tmp"
  # Drop the section's leading blank lines and guarantee exactly one trailing
  # blank, so the spacing matches the entries already in the file.
  sed '/./,$!d' "$section" >> "$tmp"
  printf '\n' >> "$tmp"
  tail -n +"$line" "$file" >> "$tmp"

  mv "$tmp" "$file"
}

# ── Phase 1: derive every version before writing anything ────────────────────

# Bash 3.2 ships on macOS and has no associative arrays, so the package/tag
# pairs travel as two index-aligned arrays.
pkgs=()
tags=()

for pkg in ${PACKAGES//,/ }; do
  require_package "$pkg"

  tag=$(./scripts/release/next-version.sh "$pkg")
  if [ -z "$tag" ]; then
    echo "Error: '$pkg' has nothing to release." >&2
    echo "       It was named explicitly, so this is treated as a mistake rather" >&2
    echo "       than skipped. Nothing has been changed." >&2
    exit 1
  fi

  if git rev-parse "$tag" >/dev/null 2>&1; then
    echo "Error: tag $tag already exists." >&2
    exit 1
  fi

  pkgs+=("$pkg")
  tags+=("$tag")
  echo "Will release $pkg as $tag"
done

if [ ${#pkgs[@]} -eq 0 ]; then
  echo "Error: PACKAGES named no packages." >&2
  exit 1
fi

# ── Phase 2: write versions and changelogs ───────────────────────────────────

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

subjects=()
i=0
while [ "$i" -lt ${#pkgs[@]} ]; do
  pkg=${pkgs[$i]}
  tag=${tags[$i]}
  version=${tag#"${pkg}-v"}

  # `--bumped-version` prints the prefixed tag; package.json needs the bare
  # SemVer. Getting this wrong writes "pi-nocd-v1.0.3" into the manifest.
  tmp=$(mktemp)
  jq --arg v "$version" '.version = $v' "packages/$pkg/package.json" > "$tmp"
  mv "$tmp" "packages/$pkg/package.json"

  # `--tag` pins the version phase 1 decided rather than letting git-cliff bump
  # again, so the changelog and the tag cannot disagree.
  #
  # Only the new section is rendered, and it is spliced in below the header.
  # Regenerating the whole file is not an option: these changelogs contain 153
  # entries carried over from the packages' pre-consolidation repositories,
  # which have no tag or commit here, plus tagged releases cut entirely from
  # paths that were added to the exclusion list later. A full regeneration
  # silently deletes both (Refs #865).
  cliff_args "$pkg"
  section=$(mktemp)
  git-cliff "${CLIFF_ARGS[@]}" --tag "$tag" --unreleased --strip header > "$section"
  insert_release_section "packages/$pkg/CHANGELOG.md" "$section" "$pkg"
  rm -f "$section"

  git add "packages/$pkg/package.json" "packages/$pkg/CHANGELOG.md"
  subjects+=("$pkg $version")
  i=$((i + 1))
done

# ── Commit, tag, push ────────────────────────────────────────────────────────

# One commit carrying every package in this release, tagged once per package, so
# `git tag --points-at HEAD` names exactly the released set for the publish step.
summary=$(
  IFS=,
  echo "${subjects[*]}"
)
git commit -m "chore(release): ${summary//,/, }"

for tag in "${tags[@]}"; do
  git tag -a "$tag" -m "Release $tag"
done

echo "Pushing release commit and ${#tags[@]} tag(s)..."
git push origin HEAD:main "${tags[@]}"

echo "Released: ${tags[*]}"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "tags=${tags[*]}"
    echo "sha=$(git rev-parse HEAD)"
  } >> "$GITHUB_OUTPUT"
fi
