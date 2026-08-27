#!/usr/bin/env bash
# Write release-please's `last-release-sha` baseline back to the repository.
#
# Run by the `release-please` CI job after a release is cut. Commits and pushes
# to main, so it is meant for CI rather than a working checkout; the derivation
# it delegates to, scripts/release-baseline-sha.sh, is the read-only half and is
# the one to run by hand during a manual recovery (Refs #646).
#
# `[skip ci]` on the commit stops the write-back re-triggering the workflow.
#
# The tag fetch belongs here rather than in a step of its own. The release action
# creates this run's tags through the API after the job's checkout, so they are
# absent locally until fetched — and if that fetch fails, the just-released
# components look untagged to the derivation, which floors them at their
# package.json-adding commits and blows the walk far past the depth at which it
# fails on this monorepo (Refs #468). Sharing one step means `pipefail` stops
# before the derivation runs, and the caller's `continue-on-error` absorbs the
# whole thing as a baseline that simply did not advance.
#
# Usage (from the repository root):
#   ./scripts/advance-release-baseline.sh

set -euo pipefail

CONFIG=release-please-config.json

git fetch --tags --force origin

BASELINE_SHA=$(./scripts/release-baseline-sha.sh)

tmp=$(mktemp)
jq --arg sha "$BASELINE_SHA" '.["last-release-sha"] = $sha' "$CONFIG" > "$tmp"
mv "$tmp" "$CONFIG"

if git diff --quiet -- "$CONFIG"; then
  echo "last-release-sha already at $BASELINE_SHA."
  exit 0
fi

echo "Advancing last-release-sha to $BASELINE_SHA."
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add "$CONFIG"
git commit -m "chore: advance release-please last-release-sha baseline [skip ci]"
git push origin HEAD:main
