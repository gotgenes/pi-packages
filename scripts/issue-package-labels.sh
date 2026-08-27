#!/usr/bin/env bash
# Print the `pkg:*` / `scope:repo` labels that belong on a GitHub issue.
#
# The package list is derived from .release-please-manifest.json rather than
# hardcoded here, so it tracks the workspace instead of drifting from it. A
# hardcoded copy in the workflow is what let five of nine packages go unlabeled
# (Refs #818).
#
# Two signals, in order, never combined:
#
#   1. The issue forms render their required `Package` dropdown into the body as
#      a `### Package` section. When it is present it is authoritative, and the
#      body is not scanned further -- a form-filed issue that discusses a
#      sibling package in prose must not draw that package's label.
#   2. Otherwise this repo's `pi-<package>: ` title convention. The pattern is
#      anchored at the colon, so `pi-subagents-worktrees: ...` resolves to the
#      worktrees package and not to `pi-subagents`, which a substring match
#      cannot distinguish.
#
# An issue with neither signal gets no label. Repo-level scope is asserted --
# via the forms' repo-wide option or `gh issue create --label scope:repo` --
# never inferred from the absence of a package, which is wrong often enough to
# mislabel genuine package bugs (Refs #818).
#
# Reads only. Prints zero or more labels to stdout, one per line, diagnostics to
# stderr, and mutates nothing, so it is safe to run against any issue from a
# working checkout.
#
# Usage:
#   ./scripts/issue-package-labels.sh <issue-number>

set -euo pipefail

MANIFEST=.release-please-manifest.json

# Must match the dropdown option string in both .github/ISSUE_TEMPLATE forms.
# An unrecognized selection warns to stderr below, so a drift between them
# surfaces in the workflow log rather than silently dropping a label.
REPO_WIDE_OPTION="repo-wide (not a specific package)"
REPO_WIDE_LABEL="scope:repo"

issue_number=${1:?usage: issue-package-labels.sh <issue-number>}

packages=$(jq -r 'keys[] | sub("^packages/"; "")' "$MANIFEST")

payload=$(gh issue view "$issue_number" --json title,body)
title=$(jq -r '.title // ""' <<<"$payload")
body=$(jq -r '.body // ""' <<<"$payload")

# Collect the `### Package` section. GitHub renders a multi-select
# comma-separated, but consume to the blank line so a one-per-line rendering
# works too. The heading pattern anchors its end so `### Package version`, which
# bug_report.yml also emits, is not mistaken for it.
selections=$(
  awk '
    /^###[[:space:]]+Package[[:space:]]*$/ { inside = 1; next }
    inside && /^###/ { exit }
    inside && /^[[:space:]]*$/ { if (seen) exit; next }
    inside { seen = 1; print }
  ' <<<"$body" | tr ',' '\n' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$' || true
)

if [[ -z $selections ]]; then
  selections=$(sed -n 's/^\(pi-[a-z0-9-]*\):.*/\1/p' <<<"$title")
fi

labels=()
while IFS= read -r selection; do
  [[ -z $selection ]] && continue
  if [[ $selection == "$REPO_WIDE_OPTION" ]]; then
    labels+=("$REPO_WIDE_LABEL")
  elif grep -Fxq "$selection" <<<"$packages"; then
    labels+=("pkg:$selection")
  else
    echo "warning: unrecognized package selection '$selection'" >&2
  fi
done <<<"$selections"

# `${labels[*]:-}` rather than `${#labels[@]}`: the latter errors under `set -u`
# on an empty array in bash 3.2, which is still stock on macOS.
[[ -z ${labels[*]:-} ]] && exit 0

printf '%s\n' "${labels[@]}" | sort -u
