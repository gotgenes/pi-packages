---
issue: 818
issue_title: "Auto-labeler knows 4 of 9 packages, and its list drifts from the workspace"
---

# Derive issue package labels from the workspace manifest

## Release Recommendation

**Release:** ship independently

Every path this plan touches is repo-root — `.github/workflows/`, `.github/ISSUE_TEMPLATE/`, `scripts/`, `AGENTS.md`.
None of them sits under a component path in `release-please-config.json`, so release-please attributes no commit here to any package and this change cuts no release on its own.
Issue 818 appears in no package's architecture roadmap, so there is no batch to join.

## Problem Statement

`.github/workflows/label-issues.yml` hardcodes a four-package list and matches each name against the whole issue body with `body.includes(pkg)`.
The workspace has nine packages and all nine `pkg:*` labels exist, so five packages are unreachable.

The hardcoded list is not the only drifting copy, and the substring match is a second defect that the issue's proposed fix would make worse.
Measured on `main` at planning time:

| location                                                | knows | missing                                                                   |
| ------------------------------------------------------- | ----- | ------------------------------------------------------------------------- |
| `.github/workflows/label-issues.yml`                    | 4     | colgrep, nocd, permission-model-judge, session-tools, subagents-worktrees |
| `.github/ISSUE_TEMPLATE/bug_report.yml` (dropdown)      | 5     | colgrep, nocd, session-tools, subagents-worktrees                         |
| `.github/ISSUE_TEMPLATE/feature_request.yml` (dropdown) | 5     | colgrep, nocd, session-tools, subagents-worktrees                         |
| `.release-please-manifest.json`                         | 9     | —                                                                         |
| `gh label list` (`pkg:*`)                               | 9     | —                                                                         |

Both issue-form dropdowns declare `validations: required: true`, and `config.yml` sets `blank_issues_enabled: false`.
A third party reporting a `pi-colgrep` bug therefore cannot file it truthfully today: the form forces a package selection and does not offer theirs.
That is a sharper user-facing failure than the missing label, and the issue does not mention it.

The substring match is the second defect.
Replayed over the 60 most recent issues (measured, `node` over `gh issue list --json number,title,body,labels`):

| issue  | today, 4 names | manifest list, 9 names | form `Package` field   | `pi-<pkg>:` title prefix |
| ------ | -------------- | ---------------------- | ---------------------- | ------------------------ |
| [#816] | 4 labels       | **all 9**              | n/a                    | none                     |
| [#817] | 3 labels       | 5 labels               | n/a                    | none                     |
| [#775] | 4 labels       | **all 9**              | n/a                    | none                     |
| [#804] | none           | none                   | n/a                    | `pi-permission-system`   |
| [#786] | 2 labels       | 2 labels               | `pi-permission-system` | n/a                      |
| [#762] | 2 labels       | 2 labels               | `pi-autoformat`        | n/a                      |

Widening the list from four names to nine while keeping the whole-body substring match turns three repo-root issues into nine-label issues.
Substring matching also has a containment collision: `pi-subagents` is a prefix of `pi-subagents-worktrees`, so any worktrees issue also draws `pkg:pi-subagents`.

There is a third gap the issue does not name.
Sixteen of those 60 issues are CLI-filed with neither a form field nor a title prefix, and eleven of them are genuinely repo-level — [#767], [#775], [#776], [#777], [#781], [#782], [#783], [#816], [#817], [#819], and this one.
Four of the eleven currently carry bogus `pkg:*` labels; the other seven carry none and are indistinguishable from an untriaged issue.
Repo-level work is ~18% of recent issues and has no label of its own.

## Goals

- Track the workspace rather than a hand-maintained copy of it: derive the package list from `.release-please-manifest.json` at run time.
- Stop labeling an issue for a package it merely mentions in passing.
- Let a third party file a repo-level issue through the form, and give that class its own `scope:repo` label.
- Move the last inline workflow script into `scripts/`, per the `AGENTS.md` convention, so it is runnable and inspectable outside CI.
- Reduce the number of hand-maintained package lists in the repo from three to two, and record the remaining two in the `AGENTS.md` new-package checklist.

This change is **not** breaking.
It alters no package's observable behavior, output shape, or default; every touched file is repo infrastructure.

## Non-Goals

- **A CI drift guard comparing the issue-form dropdowns to the manifest.**
  Raised at the clarification gate and declined in favor of the `AGENTS.md` checklist.
  A dropdown is static YAML that GitHub reads from the default branch, so it cannot read the manifest at run time; only a CI check could enforce agreement, and this plan does not add one.
- **Wiring `actionlint` into lint or CI.**
  That is [#819], which covers the same `.github/workflows/` tree.
  This plan changes workflow YAML that [#819] would validate, but it does not depend on it and does not pre-empt it.
- **Inferring a repo-level scope from the absence of a package.**
  Measured to be wrong for 5 of the 16 no-signal issues ([#733], [#735], [#779], [#780], [#785]) — all package bugs whose titles happen to omit the prefix.
  The `scope:repo` label is asserted, never inferred.
- **Retro-labeling the whole backlog.**
  The four currently mislabeled repo-level issues are corrected by hand as a final step; nothing else is swept.
- **An automated test harness for repo-root shell scripts.**
  There is none today, per `docs/plans/0816-release-baseline-oldest-component-floor.md`.
  Verification here is by direct execution against real issue numbers, specified per step below.
- **Changing which labels the issue forms apply by default.**
  `labels: ["bug"]` and `labels: ["enhancement"]` stay as they are.

## Background

`.github/workflows/label-issues.yml` runs on `issues: [opened]` with `permissions: issues: write` and a single `actions/github-script@v9` step.
It has no `actions/checkout`, so no repo file is on disk — which is why the package list had to be inlined in the first place.

Two `AGENTS.md` constraints govern the shape of the fix, both established by [#816]:

- "A multi-line `run:` block in `.github/workflows/` belongs in `scripts/`, with the workflow keeping a one-line invocation."
- "Split a script that pushes from the read-only derivation it calls, and refuse the pushing half outside CI — `scripts/advance-release-baseline.sh` guards on `CI`, `scripts/release-baseline-sha.sh` only prints."

`scripts/release-baseline-sha.sh` is the model: `set -euo pipefail`, a header comment carrying the rationale, diagnostics to stderr, and a single value on stdout.

A GitHub issue form renders each answered field as a `### <label>` section in the issue body.
Confirmed against real issues: [#797] and [#812] both open with `### Package`, followed by a blank line, then the selection.
Both dropdowns are `multiple: true`; no issue in the sampled window selected more than one, so the multi-select rendering is not directly observed here and the parser tolerates both comma-separated and one-per-line forms.

A third `AGENTS.md` constraint applies to the checklist edit: the "When adding a new package, wire it into all of" list currently names four files and does not mention the labeler, the issue forms, or the `pkg:` label.
The issue calls the labeler "a fifth that nobody remembers"; after this change the labeler needs no edit, but the two dropdowns and the label do.

## Design Overview

### Source of truth

`.release-please-manifest.json` keys are `packages/<name>`, so the package set is one `jq` expression:

```bash
jq -r 'keys[] | sub("^packages/"; "")' .release-please-manifest.json
```

`keys` sorts, so the output is deterministic.
Reading it requires the job to gain an `actions/checkout`, which is also what makes the `scripts/` extraction possible — the two halves of the change pay for the checkout together, exactly as the issue anticipates.

The manifest is the workspace's truth, but the *label* set is what `gh issue edit` can actually apply.
A package added to the manifest before its `pkg:<name>` label exists would make the workflow fail red.
That gap is closed by the `AGENTS.md` checklist rather than by run-time filtering, so the failure is loud and the checklist is the fix.

### The matching signal

The labeler resolves a selection list, then maps it to labels:

1. If the body contains a `### Package` section, its values are the selection list, **exclusively**.
   A body scan is not consulted, so a form-filed issue that discusses a sibling package in prose does not draw that package's label.
2. Otherwise, fall back to this repo's `pi-<package>:` title convention.
   The pattern is anchored at the colon, so `pi-subagents-worktrees: …` resolves to the worktrees package and not to `pi-subagents` — the containment collision that a substring match cannot avoid.
3. Otherwise, emit nothing.

Measured over the 60-issue window, this combination produces zero false positives: exact on all 14 form-filed issues, correct on 38 of 46 CLI-filed ones, and empty for every repo-root issue.

### Repo-level issues

Both dropdowns gain a tenth option, `repo-wide (not a specific package)`, which the script maps to a new `scope:repo` label.
The name is namespaced like the existing `pkg:*` and `autorelease:*` families, and reads as the sibling of `pkg:<name>` that it is — the scope is the repo, not a package.

An all-packages issue such as [#775] gets `scope:repo`, not nine `pkg:` labels: it is planned and shipped as one cross-cutting change with one plan in `docs/plans/`, and nine labels reproduce exactly the per-package query noise this plan removes.

The option string is a literal shared between the two YAML files and the script — a fourth hand-maintained coupling, smaller than the three it replaces.
The script warns to stderr on any `### Package` value it does not recognize, so a mismatch surfaces in the workflow log rather than silently dropping a label.

### Separation of concerns

Two scripts, following the [#816] split:

- `scripts/issue-package-labels.sh <issue-number>` — read-only.
  Resolves the selection list, prints one label per line to stdout, mutates nothing.
  Safe to run against any issue in a working checkout.
- `scripts/label-issues.sh <issue-number>` — the mutating half.
  Refuses to run outside CI, calls the derivation, and applies the result with `gh issue edit --add-label`.
  Exits quietly when the derivation prints nothing.

The workflow keeps a one-line invocation.
The call site is three lines:

```bash
labels=$(./scripts/issue-package-labels.sh "$ISSUE_NUMBER")
[[ -z $labels ]] && exit 0
gh issue edit "$ISSUE_NUMBER" --add-label "$(paste -sd, - <<<"$labels")"
```

### Workflow permissions

The workflow declares `permissions:`, so every scope it does not name defaults to `none`.
Adding `actions/checkout` therefore requires adding `contents: read` alongside the existing `issues: write`; without it the checkout fails.
`gh` reads its credential from `GH_TOKEN`, set to `${{ secrets.GITHUB_TOKEN }}`.

The issue number is passed through an `env:` binding rather than interpolated into the `run:` body, so no `${{ }}` expansion lands inside a shell string.

## Module-Level Changes

| file                                         | change                                                                                                                                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/issue-package-labels.sh`            | **new** — read-only derivation; header comment, `set -euo pipefail`, manifest read, form-field parse, title-prefix fallback, label mapping, stderr warning on an unrecognized value |
| `scripts/label-issues.sh`                    | **new** — CI-guarded applier; calls the derivation and applies via `gh issue edit --add-label`                                                                                      |
| `.github/workflows/label-issues.yml`         | `permissions:` gains `contents: read`; `actions/github-script@v9` step replaced by `actions/checkout@v7` plus a one-line `run:` with `GH_TOKEN` and `ISSUE_NUMBER` env bindings     |
| `.github/ISSUE_TEMPLATE/bug_report.yml`      | `Package` dropdown 5 → 9 options plus `repo-wide (not a specific package)`; description mentions the repo-wide choice; `Package version` relaxed to `required: false`               |
| `.github/ISSUE_TEMPLATE/feature_request.yml` | `Package` dropdown 5 → 9 options plus `repo-wide (not a specific package)`; description mentions the repo-wide choice                                                               |
| `AGENTS.md`                                  | new-package checklist gains the two issue-form dropdowns and `gh label create pkg:<pkg>`; a note that the labeler derives its list from the manifest and needs no edit              |

`Package version` is relaxed because it is `required: true` today and a repo-wide bug has no package version to give — the new dropdown option would otherwise be unusable in `bug_report.yml`.

Greps run at planning time to bound the file list:

- `grep -rn "pi-colgrep\|pi-nocd\|pi-session-tools\|pi-subagents-worktrees\|pi-permission-model-judge" .github/` returns only the two `ISSUE_TEMPLATE` dropdowns.
- `grep -n "label" AGENTS.md CONTRIBUTING.md README.md` returns no reference to the auto-labeler or to `pkg:*` labels, so no other doc describes the mechanism being reworked.
- `CONTRIBUTING.md` says "The templates ask for the package, the version, and a reproduction" — still true after the dropdown edit, so it needs no change.

No package source, test, README, skill, or architecture doc references any symbol this plan touches.

## Test Impact Analysis

There is no unit-test harness for repo-root shell scripts, and this plan does not add one (see Non-Goals).
The read-only derivation is the testable surface, and it is genuinely testable because it takes an issue number and mutates nothing — the current inline script can only be exercised by opening an issue.

Expected output of `./scripts/issue-package-labels.sh <N>`, **measured** at planning time with a prototype of the design:

| issue  | signal       | expected output                                                               |
| ------ | ------------ | ----------------------------------------------------------------------------- |
| [#797] | form field   | `pkg:pi-permission-system`                                                    |
| [#812] | form field   | `pkg:pi-subagents`                                                            |
| [#786] | form field   | `pkg:pi-permission-system` (not `pkg:pi-subagents`, which the body scan adds) |
| [#762] | form field   | `pkg:pi-autoformat` (not `pkg:pi-permission-system`)                          |
| [#804] | title prefix | `pkg:pi-permission-system`                                                    |
| [#788] | title prefix | `pkg:pi-permission-model-judge`                                               |
| [#791] | title prefix | `pkg:pi-subagents`                                                            |
| [#816] | none         | empty                                                                         |
| [#817] | none         | empty                                                                         |
| [#819] | none         | empty                                                                         |
| [#775] | none         | empty                                                                         |

Parser cases with no live issue to exercise them, verified against synthetic bodies at planning time:

| input                                                   | expected                 |
| ------------------------------------------------------- | ------------------------ |
| `### Package` then `pi-subagents, pi-colgrep`           | both labels              |
| `### Package` then the two names on separate lines      | both labels              |
| `### Package` then `repo-wide (not a specific package)` | `scope:repo`             |
| `### Package` then `pi-bogus`                           | empty, warning on stderr |
| a body with `### Package version` but no `### Package`  | empty                    |

The last case matters: `bug_report.yml` has both headings, and a loose match on `### Package` would capture the version field.
The section pattern anchors the end of the heading line, so it does not.

## Invariants at risk

This change touches `.github/workflows/` and `scripts/`, the surface [#816] reworked.
Two of its documented outcomes must survive:

- **No multi-line `run:`/`script:` block in a workflow.**
  [#816] left `label-issues.yml` as the only violation; this plan removes it rather than adding a second.
  Pinned by inspection, not by a test — there is no `actionlint` or workflow lint in CI ([#819]).
- **The mutating half of a script pair refuses to run outside CI.**
  `scripts/label-issues.sh` guards on `CI` exactly as `scripts/advance-release-baseline.sh` does.
  Verified by executing it locally and expecting a refusal.

Neither invariant has a test pinning it, in this plan or before it.
Both are verified by direct execution in the steps below, and `AGENTS.md` carries the prose.

One quantitative invariant: the workflow's run time grows by an `actions/checkout` on a job that previously ran a single API call.
This is a labeling workflow on `issues: [opened]` with no downstream dependency, so the added seconds gate nothing.

## Implementation Order

Verification is by direct execution; there is no test harness for these files.

1. **Create the `scope:repo` label** (operator action, no commit).

   ```bash
   gh label create scope:repo --description "Repo-level work: build, CI, tooling, or cross-package docs" --color ededed
   ```

   Must precede step 4, or a repo-wide form selection produces a `gh issue edit` failure.
   Verify: `gh label list --json name --jq '.[].name' | grep -Fx scope:repo`.

2. **Add the read-only derivation.**
   New `scripts/issue-package-labels.sh`, called by nothing yet.
   Verify by running it against every issue in the Test Impact Analysis table and diffing against the measured expectations, then against the synthetic parser cases.
   Commit: `refactor(ci): add a read-only issue package-label derivation`.

3. **Rewrite the workflow to use it.**
   New `scripts/label-issues.sh`; `label-issues.yml` gains `contents: read`, `actions/checkout@v7`, and the one-line `run:`; the `actions/github-script` step is removed.
   Verify: `./scripts/label-issues.sh 797` refuses outside CI; `CI=1` is not simulated locally, since that would mutate a real issue.
   Commit: `fix(ci): label issues from the workspace manifest, not a stale list`.

4. **Sync the issue forms.**
   Both dropdowns go to nine packages plus `repo-wide (not a specific package)`; `bug_report.yml`'s `Package version` becomes `required: false`.
   Verify: `yq`/`jq` the option list out of each file and diff it against `jq -r 'keys[] | sub("^packages/"; "")' .release-please-manifest.json`, expecting only the repo-wide extra.
   Commit: `fix(ci): offer every workspace package in the issue forms`.

5. **Record the remaining hand-maintained lists.**
   `AGENTS.md` new-package checklist gains the two dropdowns and `gh label create pkg:<pkg>`, and a note that the labeler needs no edit.
   Verify: `pnpm exec rumdl check AGENTS.md`.
   Commit: `docs: record the label steps for adding a package`.

6. **Correct the mislabeled repo-level issues** (operator action, no commit).
   Strip the bogus `pkg:*` labels from [#775], [#816], [#817], and this issue, and apply `scope:repo` to each.
   Verify: `gh issue view <N> --json labels`.

## Risks and Mitigations

| risk                                                                                                                                                 | mitigation                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The `repo-wide (not a specific package)` literal drifts between the two YAML files and the script                                                    | The script warns to stderr on an unrecognized `### Package` value, so a mismatch appears in the workflow log instead of silently dropping the label                             |
| A future package lands in the manifest before its `pkg:` label exists, failing the workflow                                                          | `AGENTS.md` checklist gains `gh label create pkg:<pkg>`; the failure is loud rather than silent, which is the intended trade                                                    |
| The multi-select rendering is unobserved in this repo, so the comma-split is designed against GitHub's documented behavior rather than a live sample | The parser accepts both comma-separated and one-per-line forms, and intersects against the manifest, so an unexpected separator degrades to a warning rather than a wrong label |
| CLI-filed issues without a title prefix now get no label where the body scan sometimes guessed right                                                 | Measured: the scan's guesses were wrong at least as often as they were right on that set; the operator asserts the label with `gh issue create --label`                         |
| The reworked workflow YAML is not validated by anything before it runs                                                                               | Out of scope here; [#819] wires in `actionlint`. Until then a syntax error surfaces on the next opened issue, which fails no release path                                       |

## Open Questions

- Whether the `pi-<package>:` title convention should be documented in `CONTRIBUTING.md` now that the labeler depends on it.
  It is an operator habit today, not a contributor-facing rule, and third parties reach the form rather than the CLI.
  Deferred until a contributor files by CLI and is surprised.
- Whether `scope:repo` should also be offered as a `--label` default in `scripts/issue-context.sh` or the issue-filing prompts.
  Not filed; revisit if repo-level issues keep arriving unlabeled.

[#733]: https://github.com/gotgenes/pi-packages/issues/733
[#735]: https://github.com/gotgenes/pi-packages/issues/735
[#762]: https://github.com/gotgenes/pi-packages/issues/762
[#767]: https://github.com/gotgenes/pi-packages/issues/767
[#775]: https://github.com/gotgenes/pi-packages/issues/775
[#776]: https://github.com/gotgenes/pi-packages/issues/776
[#777]: https://github.com/gotgenes/pi-packages/issues/777
[#779]: https://github.com/gotgenes/pi-packages/issues/779
[#780]: https://github.com/gotgenes/pi-packages/issues/780
[#781]: https://github.com/gotgenes/pi-packages/issues/781
[#782]: https://github.com/gotgenes/pi-packages/issues/782
[#783]: https://github.com/gotgenes/pi-packages/issues/783
[#785]: https://github.com/gotgenes/pi-packages/issues/785
[#786]: https://github.com/gotgenes/pi-packages/issues/786
[#788]: https://github.com/gotgenes/pi-packages/issues/788
[#791]: https://github.com/gotgenes/pi-packages/issues/791
[#797]: https://github.com/gotgenes/pi-packages/issues/797
[#804]: https://github.com/gotgenes/pi-packages/issues/804
[#812]: https://github.com/gotgenes/pi-packages/issues/812
[#816]: https://github.com/gotgenes/pi-packages/issues/816
[#817]: https://github.com/gotgenes/pi-packages/issues/817
[#819]: https://github.com/gotgenes/pi-packages/issues/819
