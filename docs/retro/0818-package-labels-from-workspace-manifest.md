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

## Stage: Final Retrospective (2026-08-27T22:19:23Z)

### Session summary

Planned, built, and shipped #818 in one continuous session covering all four stages.
Eight commits landed on `main`: the two `scripts/` files, the workflow rewrite, both issue-form dropdowns, the `AGENTS.md` checklist, and two post-review parser fixes.
Three `pre-completion-reviewer` rounds ran (WARN, WARN, PASS), and the shipped labeler was verified against 11 real issue numbers plus 12 synthetic parser cases.

### Observations

#### What went well

- **Measuring the issue's own proposal before adopting it.**
  Replaying four candidate heuristics over 60 real issue bodies took one tool call and refuted the issue's literal fix: widening the hardcoded list to nine names while keeping `body.includes(pkg)` would have turned [#775], [#816], and #818 from four-label issues into nine-label ones.
  The planning prompt's "treat the Proposed change as a hypothesis" is what prompted it, and a quantified refutation reshaped the whole design rather than merely qualifying it.
- **A `gh` shim to exercise the committed script end to end.**
  Planning tested a *copy* of the `awk` pipeline pasted into the shell; the build stage put a fake `gh` on `PATH` returning synthetic `{title, body}` JSON, so every later case ran through `scripts/issue-package-labels.sh` itself.
  That closed the gap where a verified copy and a shipped script can drift, and it is reusable for any repo-root script that shells out to `gh`.
- **Two subagent claims refuted on evidence.**
  Round 1 asserted `scripts/advance-release-baseline.sh` uses `ALLOW_LOCAL_PUSH` as a second factor against an ambient `CI=1`; reading line 32 showed `CI` alone authorizes both scripts.
  Round 2 rated the nested-fence leak unreachable; `.pi/skills/markdown-conventions/SKILL.md` mandates the four-backtick outer fence that triggers it, making it this repo's house style rather than an exotic input.
  Both catches came from `AGENTS.md`'s rule to verify a subagent's universal claims.

#### What caused friction (agent side)

- `missing-context` — the plan's Test Impact Analysis enumerated the parser's input domain from imagined renderings, never from what an issue body can actually contain.
  It listed five synthetic cases; the shipped parser needed twelve, including fenced blocks, tilde fences, info strings, mismatched markers, and bulleted multi-selects.
  The decisive fact was already in hand — `markdown-conventions` was read during planning, for *writing* the plan, and never applied to *what the parser would read*.
  Impact: two unplanned `fix(ci):` commits (`78f2c7d2`, `d49d74b7`) and two extra reviewer rounds, roughly nine minutes of subagent time.
- `instruction-violation` (self-identified in retro) — the first `ask_user` gate offered four matching-signal options that all shared the premise that the labeler's job is to name a package.
  `AGENTS.md` § Clarification gates already says to name a premise every option shares and offer the option that removes it.
  The operator removed it instead, by asking what happens to issues that belong to no package.
  Impact: one extra gate round; the outcome improved, but the reopening should have been mine to offer.
- `instruction-violation` (self-identified) — `gh issue edit "$n" --add-label scope:repo ${old:+--remove-label "$old"}` collapsed to a single word under zsh.
  `AGENTS.md` already documents zsh's lack of word-splitting for `$FILES`; this is the same behavior on a conditional expansion.
  Impact: one wasted tool call, and it failed before mutating anything.
- `missing-context` — announced "Tidy First skipped per its applicability gate" while citing only the injected prompt's paraphrase, without having opened `.pi/skills/tidy-first/SKILL.md`.
  The operator's heads-up prompted an actual read, which confirmed the same outcome by a different route (the skill had moved to `/plan-issue` entirely).
  Impact: none on the result; the reasoning was unsupported at the moment it was stated.
- `other` — an `rm -rf "$SHIM"` cleanup tripped the permission policy and rejected the whole command block, including the six test cases ahead of it.
  Impact: one wasted tool call; temp dirs left behind.

#### What caused friction (user side)

- The meta-issue observation ("we're labeling meta-issues with many or all packages") arrived after the first gate had already settled the matching signal, which forced a second gate.
  The root cause sits on the agent side — the gate never asked what the *absence* of a package signal should produce — so the opportunity is for the gate to invite that context, not for the operator to have volunteered it.
- The heads-up that a peer session had changed the Tidy-First flow was well-timed and prevented running a step that no longer exists.
  A concurrent session editing `.pi/` while another works is now common enough that its commit landing mid-issue (`abfeabc9`) also polluted the reviewer's diff range.

### Diagnostic details

- **Model-performance correlation** — planning, build, and retro ran on `anthropic/claude-opus-5`; the ship stage ran on `anthropic/claude-sonnet-5`.
  Ship is procedural (push, watch CI, resolve SHAs, close) and the lighter model was a good fit — no defects, and it caught its own SHA-length check unprompted.
  All three `pre-completion-reviewer` dispatches ran on `anthropic/claude-sonnet-5` per the agent's frontmatter.
  Round 1 misread a two-clause shell guard, which is a reading error on judgment-heavy work; rounds 2 and 3 were strong, with round 3 running twelve self-devised adversarial fence inputs.
  One error across three rounds is not enough to justify changing the reviewer's model, but it is the second retro-visible instance of a reviewer asserting a sibling-file fact it had not read.
- **Escalation-delay tracking** — no `rabbit-hole` friction points.
  The longest same-obstacle run was four calls verifying the dropdown YAML (`python3` had no `yaml` module, then `yq` was absent, then the workspace's own `yaml` package worked), below the five-call threshold.
- **Unused-tool detection** — none applicable.
  `colgrep` went unused, correctly: the session touched YAML, shell, and markdown rather than TypeScript, and every file it needed was found by name.
  No `Explore` dispatch was warranted; the measurement work had to run inline because its output drove the design.
- **Feedback-loop gap analysis** — no gap.
  `pnpm run lint` ran after each of the five build steps, `shellcheck` immediately after each script was written, `actionlint` right after the workflow rewrite, and the 11-real-issue regression harness after *every* edit to the parser — including both post-review fixes.

### Changes made

1. `.pi/prompts/plan-issue.md` — added two sentences to the **Test Impact Analysis** bullet: a parser's testable surface is its input domain rather than imagined inputs, so run the candidate over every real sample available and include this repo's own authoring conventions (the four-backtick fence) among the shapes it must survive.

Proposals declined by the operator, recorded here so they are not re-proposed without new evidence:

1. Extending `AGENTS.md`'s zsh word-splitting rule to conditional expansions (`${old:+--flag "$old"}` arriving as one argument).
   Cost this session was one wasted tool call that failed safe.
2. Recording the `gh`-shim technique in `AGENTS.md` — putting a fake `gh` on `PATH` to drive a repo-root script end to end instead of a copy of its pipeline.
   The technique is described in this file's Build stage and Final Retrospective if it is wanted later.

[#733]: https://github.com/gotgenes/pi-packages/issues/733
[#735]: https://github.com/gotgenes/pi-packages/issues/735
[#775]: https://github.com/gotgenes/pi-packages/issues/775
[#779]: https://github.com/gotgenes/pi-packages/issues/779
[#780]: https://github.com/gotgenes/pi-packages/issues/780
[#785]: https://github.com/gotgenes/pi-packages/issues/785
[#816]: https://github.com/gotgenes/pi-packages/issues/816
[#817]: https://github.com/gotgenes/pi-packages/issues/817
[#819]: https://github.com/gotgenes/pi-packages/issues/819
