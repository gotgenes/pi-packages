#!/usr/bin/env bash
# Apply the package/scope labels for a GitHub issue.
#
# The mutating half of a pair: scripts/issue-package-labels.sh derives the
# labels and prints them, this script applies them. It refuses to run outside CI
# so a local invocation cannot edit a real issue by accident, matching the split
# scripts/advance-release-baseline.sh and scripts/release-baseline-sha.sh use
# (Refs #816, #818).
#
# Requires GH_TOKEN with `issues: write`.
#
# Usage (from .github/workflows/label-issues.yml):
#   ./scripts/label-issues.sh <issue-number>

set -euo pipefail

issue_number=${1:?usage: label-issues.sh <issue-number>}

if [[ -z ${CI:-} ]]; then
  echo "refusing to label issue #${issue_number} outside CI" >&2
  echo "run ./scripts/issue-package-labels.sh ${issue_number} to see what it would apply" >&2
  exit 1
fi

labels=$(./scripts/issue-package-labels.sh "$issue_number")

if [[ -z $labels ]]; then
  echo "no package or scope signal on issue #${issue_number}; leaving it unlabeled"
  exit 0
fi

echo "labeling issue #${issue_number}: $(paste -sd, - <<<"$labels")"
gh issue edit "$issue_number" --add-label "$(paste -sd, - <<<"$labels")"
