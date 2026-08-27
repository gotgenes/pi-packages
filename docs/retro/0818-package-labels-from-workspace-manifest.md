---
issue: 818
issue_title: "Auto-labeler knows 4 of 9 packages, and its list drifts from the workspace"
---

# Retro: #818 — Auto-labeler knows 4 of 9 packages, and its list drifts from the workspace

## Stage: Planning (2026-08-27T21:04:13Z)

### Session summary

Planned the auto-labeler fix as `docs/plans/0818-package-labels-from-workspace-manifest.md`.
Investigation found two defects the issue does not name: the two `.github/ISSUE_TEMPLATE/` dropdowns are a second and third drifting copy of the package list (and are `required: true` with `blank_issues_enabled: false`, so a `pi-colgrep` bug is unfileable today), and repo-level issues — ~18% of the recent window — have no label of their own.
Two clarification gates settled the matching signal, the scope, the placement, and a new `scope:repo` label.

### Observations

- **The issue's literal fix makes a second defect worse.**
  Replaying the heuristics over the 60 most recent issues showed that widening the hardcoded list from four names to nine while keeping `body.includes(pkg)` turns [#775], [#816], and this issue from 4-label issues into 9-label issues.
  Measuring before designing is what surfaced this; the issue frames the list as the whole problem and the false positives as an aside.
- **Adopted signal: form `Package` field, else `pi-<pkg>:` title prefix, else nothing.**
  Measured zero false positives across all 60 sampled issues — exact on all 14 form-filed, correct on 38 of 46 CLI-filed, empty for every repo-root issue.
  A prototype of the derivation was run against 11 real issue numbers and 5 synthetic parser cases, and those measured outputs are written into the plan's Test Impact Analysis so `/build-plan` can re-run them as verification.
- **Rejected: inferring `scope:repo` from the absence of a package.**
  Measured wrong for 5 of the 16 no-signal issues ([#733], [#735], [#779], [#780], [#785]) — package bugs whose titles omit the prefix.
  Absence of evidence is not evidence of repo scope, so the label is asserted via a new dropdown option and `gh issue create --label`.
- **Declined: a CI guard comparing the dropdowns to the manifest.**
  The operator chose the `AGENTS.md` checklist instead.
  Worth knowing at implementation time that this leaves the dropdowns as the only remaining hand-maintained lists, plus the `repo-wide (not a specific package)` literal shared between two YAML files and the script — mitigated by a stderr warning on an unrecognized value, not by a gate.
- **Scope consequence to watch.**
  Adding the repo-wide dropdown option forces `bug_report.yml`'s `Package version` to `required: false`, since a repo-wide bug has no package version.
  That edit is in the plan but is a second-order effect, not something the issue asks for.
- **Adjacent, deliberately deferred:** [#819] wires `actionlint` into lint and CI.
  This plan rewrites workflow YAML that nothing validates; the two do not depend on each other, and [#819] should land at some point after.
- **No follow-up issues filed.**
  Everything identified either landed in the plan or already had an issue.

## Stage: Implementation — Build (2026-08-27T21:48:31Z)

### Session summary

Executed all six steps of the plan across six commits: the two new `scripts/` files, the workflow rewrite, both issue-form dropdowns, and the `AGENTS.md` checklist, plus two post-review parser fixes.
The `scope:repo` label was created and the four mislabeled repo-level issues ([#775], [#816], [#817], and this one) were relabeled.
Three pre-completion review rounds ran: WARN, WARN, then PASS.

### Observations

- **Two commits beyond the plan, both from review findings.**
  `78f2c7d2` made the `### Package` scan skip fenced blocks and accept a bulleted multi-select; `d49d74b7` replaced the fence boolean toggle with CommonMark marker/length matching.
  The plan's Test Impact Analysis table therefore under-describes what is now verified — the committed script also passes nested-fence, tilde-fence, info-string, mismatched-marker, and bullet-list cases that the plan never listed.
- **Round 2's "unreachable" judgment was wrong for this repo.**
  It rated the nested-fence leak non-blocking because both issue forms put `Package` first.
  But `.pi/skills/markdown-conventions/SKILL.md` mandates a four-backtick outer fence when embedding markdown containing fences, so a plan or issue quoting a rendered form is the repo's own house style and hits the leak directly.
  Fixed rather than documented as a limitation.
- **Round 1 asserted a sibling-script fact that did not survive checking.**
  It claimed `scripts/advance-release-baseline.sh` requires a distinct `ALLOW_LOCAL_PUSH=1` so an ambient `CI=1` cannot authorize a mutation, and that `scripts/label-issues.sh` deviated.
  Line 32 is `[ -z "${CI:-}" ] && [ -z "${ALLOW_LOCAL_PUSH:-}" ]` — `CI` alone authorizes both, and `ALLOW_LOCAL_PUSH` is an escape hatch *to* run locally.
  Rounds 2 and 3 confirmed the dismissal.
  A resumed reviewer session would likely have carried the error forward; the fresh-context spawn is what caught it.
- **Stale prompt-template expansion, caught by the operator.**
  The injected `/build-plan` body still carried a "Tidy First (code-touching plans only)" section that `abfeabc9` had removed the same afternoon, moving the assessor into `/plan-issue`.
  Followed the on-disk file per `AGENTS.md`.
  Outcome was unaffected either way: the applicability gate is `src/`/`test/` files, and this plan touches none.
- **`abfeabc9` interleaved into the commit range.**
  A concurrent peer session committed to `main` between the planning and build commits, so `git diff <plan-commit>^..HEAD` over-scoped to `.pi/` files.
  Scoped the reviewer to this issue's own eight commits instead, and told it explicitly to exclude that SHA.
- **zsh quoting bit the relabel loop.**
  `gh issue edit "$n" --add-label scope:repo ${old:+--remove-label "$old"}` expands to a single word under zsh, so `gh` rejected `--remove-label pkg:a,pkg:b` as an unknown flag.
  It failed before mutating anything, so no partial state; a plain quoted argument worked.
- **Verification tooling gaps.**
  `python3` has no `yaml` module here, so the dropdown checks used `awk` plus the workspace's own `yaml` package under `NODE_PATH`.
  `shellcheck` and `actionlint` are both installed locally and clean on all three files — worth remembering that `actionlint` already exists on this machine while [#819] wires it into CI.

[#733]: https://github.com/gotgenes/pi-packages/issues/733
[#735]: https://github.com/gotgenes/pi-packages/issues/735
[#775]: https://github.com/gotgenes/pi-packages/issues/775
[#779]: https://github.com/gotgenes/pi-packages/issues/779
[#780]: https://github.com/gotgenes/pi-packages/issues/780
[#785]: https://github.com/gotgenes/pi-packages/issues/785
[#816]: https://github.com/gotgenes/pi-packages/issues/816
[#817]: https://github.com/gotgenes/pi-packages/issues/817
[#819]: https://github.com/gotgenes/pi-packages/issues/819
