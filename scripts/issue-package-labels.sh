#!/usr/bin/env bash
# Print the `pkg:*` / `scope:repo` labels that belong on a GitHub issue.
#
# The package list is derived from the workspace on disk rather than hardcoded
# here, so it tracks the packages instead of drifting from them. A hardcoded copy
# in the workflow is what let five of nine packages go unlabeled (Refs #818).
# It read .release-please-manifest.json until that file was retired with
# release-please itself (Refs #865).
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


# Must match the dropdown option string in both .github/ISSUE_TEMPLATE forms.
# An unrecognized selection warns to stderr below, so a drift between them
# surfaces in the workflow log rather than silently dropping a label.
REPO_WIDE_OPTION="repo-wide (not a specific package)"
REPO_WIDE_LABEL="scope:repo"

issue_number=${1:?usage: issue-package-labels.sh <issue-number>}

packages=$(for dir in packages/*/; do
  [ -f "${dir}package.json" ] && basename "$dir"
done)

payload=$(gh issue view "$issue_number" --json title,body)
title=$(jq -r '.title // ""' <<<"$payload")
body=$(jq -r '.body // ""' <<<"$payload")

# Collect the `### Package` section. The heading pattern anchors its end so
# `### Package version`, which bug_report.yml also emits, is not mistaken for
# it, and fenced blocks are skipped entirely so an issue that quotes a rendered
# form in a code block does not draw that package's label.
#
# The value is split on commas and on newlines, and a leading list bullet is
# stripped: GitHub renders a multi-select comma-separated, but this repo has no
# multi-select issue on record to confirm that, so accept the plausible
# renderings rather than silently dropping every label if it is a list.
selections=$(
  awk '
    # Track fences the way CommonMark does: a closer must use the opening
    # marker character and be at least as long. A plain toggle would let the
    # inner ``` of a 4-backtick block -- the convention this repo uses to embed
    # markdown that itself contains fences -- close the outer one and leak the
    # example back in as real content.
    /^[[:space:]]*(```|~~~)/ {
      line = $0
      sub(/^[[:space:]]*/, "", line)
      match(line, /^(`+|~+)/)
      if (!fence) {
        fence = 1
        open_char = substr(line, 1, 1)
        open_len = RLENGTH
      } else if (substr(line, 1, 1) == open_char && RLENGTH >= open_len) {
        fence = 0
      }
      next
    }
    fence { next }
    /^###[[:space:]]+Package[[:space:]]*$/ { inside = 1; next }
    inside && /^###/ { exit }
    inside && /^[[:space:]]*$/ { if (seen) exit; next }
    inside { seen = 1; print }
  ' <<<"$body" | tr ',' '\n' | sed 's/^[[:space:]]*[-*][[:space:]]*//; s/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$' || true
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
