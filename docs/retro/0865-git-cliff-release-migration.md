---
issue: 865
issue_title: "release-please walk depth grows without bound while the oldest component is dormant"
---

# Retro: #865 — release-please walk depth grows without bound while the oldest component is dormant

## Stage: Planning (2026-09-01T16:42:15Z)

### Session summary

The issue was filed as a walk-depth bug with three candidate fixes; four clarification rounds turned it into a full migration off release-please onto git-cliff.
The operator rejected the first option set on the premise ("why do we make GraphQL calls at all?"), which surfaced release-please's unused `LocalGitHub` backend, and then pointed at a sibling repo (`~/tinyigsoftware/repone`) whose git-cliff toolchain proved to be the better fit once release **latency** — not walk depth — was named as the real pain.
Produced `docs/plans/0865-git-cliff-release-migration.md`: eight build steps covering `cliff.toml`, four release scripts, a dispatched `release.yml`, changelog regeneration, a breaking `pi-github-tools` deletion, and the prompt/skill/`AGENTS.md` ripple.

### Observations

- **The issue's own framing was wrong in a load-bearing way, and measuring caught it.**
  The depth does not grow without bound — it self-caps at `commit-search-depth` 500.
  But 500 ÷ `commit-batch-size` 10 = 50 GraphQL requests, which is exactly the burst at which [#468] failed.
  So the ceiling is real and close (44 requests at planning time), just not a ramp.
  Correcting this in the plan mattered, because "unbounded growth" implies a different class of fix than "a ceiling that is also the failure point".

- **#816's floor rule is sufficient but not necessary, proven from source.**
  `commitsAfterSha` in release-please 17.6.0 returns the *whole* path-split window when a component's release SHA is absent (`findIndex` → `-1`), and the only other consequence is an unused `latestReleasePullRequest` plus a warn.
  So the necessary invariant is "floor at or before every component's oldest **unreleased** commit", not "at the oldest **release** commit".
  Measured, that was 113 commits versus 436 — a viable 4× fix that was offered and declined, correctly, because it addresses 2.3 min of a 14–24 min cycle.
  Worth keeping: this is the record of *why* the cheaper fix was not taken.

- **Reading the dependency's `src/` directory listing was the highest-value single tool call.**
  `src/local-github.ts` was not something any search would have suggested; it appeared only from listing the package's source tree.
  It reframed "are we at release-please's limits?"
  from yes to "no, there is an unused code path" — which then made the *real* answer visible, namely that the unused code path fixes the wrong problem.

- **The operator's pain and the issue's pain were different, and only the operator knew.**
  Everything I measured pointed at the 135 s `release-please` job.
  The actual cost is 14–24 min work-to-published, of which publishing is 30 s and the rest is the two-CI-cycle release-PR round trip with a human merge in the middle.
  `--local` would have cut the visible number and left the felt one.
  Measuring the *end-to-end* latency, not the job I was staring at, is what made the comparison honest.

- **Running the candidate tool against the real repo beat every doc claim.**
  git-cliff reproduced all nine components' versions exactly, in 9.4 s, zero network — including the subtle case (`pi-subagents-worktrees` staying at `0.3.1` because its only commit is `test:`, matching release-please's `changelogEmpty`).
  Unskipping `test` bumped it to `0.3.2`, proving the check was discriminating rather than vacuously green.
  Two dry runs also produced findings that changed the design: `--prepend` writes to byte 0 above the file's own header (so step 4 regenerates with `-o`), and `--bumped-version` prints the prefixed tag rather than a bare SemVer.

- **The `exclude-paths` convention was verified against every package, not sampled.**
  `docs/{plans,retro,architecture,decisions,assets}` reproduces the current 25-entry list exactly — including that `pi-permission-system/docs/guides` and `docs/migration` stay included as shipped user docs.
  This turns a hand-maintained array that AGENTS.md requires editing per new subdirectory into a convention, which is a genuine simplification rather than a like-for-like port.

- **A live check refuted the assessor's one correction.**
  The Tidy-First assessor confirmed both dead-code cascade claims exactly (`merge-state.ts` and `config.ts` each have exactly one non-test importer) and flagged `github.ts`'s `git()` as a possible fourth dead symbol.
  It is called by `detectRepo` at `github.ts:117`, so it survives.
  The assessor also verified that `findRun` matches purely on `headSha` with no `push`-trigger assumption, which is what makes `ci_find`/`ci_watch` usable against a `workflow_dispatch` run with no changes — and it surfaced the `-f sha` vs `--ref` race, which is now stated in the plan rather than papered over.

- **The npm Trusted Publishing move is the plan's most likely production failure**, and it is not a code change.
  The publisher is configured against workflow `ci.yml`; moving publish to `release.yml` 403s until the operator updates it on npmjs.org for all nine packages.
  Called out explicitly in step 3 and in Invariants at risk.

- **Scope grew by operator decision at every gate, never by drift.**
  Round 1 offered five mechanisms within release-please; round 2 was rejected on premise; round 3 introduced `--local`; round 4 introduced git-cliff after the operator supplied `repone`.
  The final scope (re-scope #865 to the migration, plan end to end) was the operator's explicit choice over filing a separate ADR issue.
  Recorded because a plan spanning workflows, scripts, a breaking package change, three prompts, three skills, and `AGENTS.md` otherwise reads like uncontrolled growth.

- **The implementing session will be shipping with tools it is deleting.**
  Both AGENTS.md staleness rules bite at once here: step 6 rewrites `/ship-issue` while step 5 removes the tools `/ship-issue` calls.
  The plan's risk table says to restart Pi before shipping and treat the on-disk prompt as authoritative.

#### Deferred tidyings

- `packages/pi-github-tools/src/tools/ci-find.ts` — its `promptSnippet` says "Wait for a CI run matching a **pushed** SHA", which becomes inaccurate once the tool is routinely used against `workflow_dispatch` runs.
  The assessor rejected it as scope creep for the deletion; it is a natural fold-in for whoever next touches that file.

### Next stage

`/build-plan` — there is no vitest surface anywhere in this change, and every step carries explicit verification commands rather than a red→green cycle.

## Stage: Implementation — Build (2026-09-01T18:26:16Z)

### Session summary

Executed all eight planned steps, plus three unplanned fix commits, for twelve commits total.
Release automation now runs on git-cliff from a `workflow_dispatch` workflow: `cliff.toml` plus six scripts under `scripts/release/`, with `release-please-config.json`, `.release-please-manifest.json`, both baseline scripts, the `release-please` and `publish` jobs in `ci.yml`, and `pi-github-tools`' three release tools all removed.
Pre-completion reviewer: **FAIL** on round 1 (one blocking defect), **WARN** on round 2; both findings were real and both are fixed.

### Observations

- **The plan's step 4 was wrong, and its own verification criterion caught it.**
  The plan said to regenerate all nine `CHANGELOG.md` files, and I had sold that to the operator as a reformat.
  The step's heading-vs-tag check showed it deletes 101 of 220 entries for `pi-permission-system`.
  Two causes, neither fixable by configuration: 153 entries predate this repository (the packages were consolidated from separate repos and only the changelog *text* came across, as `MIGRATION.md` records), and ~45 tagged releases were cut entirely from `docs:` commits under paths added to `exclude-paths` later.
  Stopping to re-ask was correct; the operator chose the seam.
  The general lesson is that the cost I quoted at the gate was an inference, and the gate's decision rested on it.

- **The reviewer's blocking finding was a fact I had already read and then contradicted.**
  I printed `release-please-config.json`'s `changelog-sections` during planning, where `chore` is plainly `hidden=false`, then wrote "the visible five … the hidden six" into `cliff.toml` and repeated it in three more places.
  A package whose only unreleased commits were `chore:` would have been unreleasable forever.
  `verify-cliff-parity.sh` could not catch it, because it compares current tip versions and no package has a chore-only interval pending.
  This is the same failure mode `AGENTS.md` records for #816 — citing a source for a property without re-checking that it has it.

- **Round 2's WARN corrected my explanation, not my code.**
  I justified the `chore(release)` skip as defence against a coincidence, claiming path scoping already handled it.
  The reviewer showed the skip is load-bearing for a case I had not considered: `create-github-releases.sh` runs `git-cliff --latest` *after* the commit and tag exist, so without the rule a release's own GitHub notes list `* **release:** <pkg> <version>`.
  Verified by rendering both ways before rewriting the comment.
  Worth remembering that a correct change with a wrong rationale still ships a wrong rationale.

- **The zsh word-splitting trap in `AGENTS.md` cost a real defect.**
  `CLIFF_EXCLUDED_DOC_DIRS` was a space-separated string expanded unquoted; bash splits it, zsh does not.
  The executed scripts were fine under their bash shebang, so `verify-cliff-parity.sh` stayed green; it surfaced only when I regenerated changelogs by sourcing `lib.sh` inline from the Bash tool, which is zsh here, and `docs/retro` commits leaked in.
  An array fixes it under both shells.

- **Two facts were only discoverable by running the tool.**
  `link_parsers` belongs to `[git]`, not `[changelog]`; git-cliff silently ignores the misplaced key, so `closes [#N]` links just never appeared.
  And `--prepend` inserts at byte 0, above the file's own `# Changelog` header, which is what made the splice a hand-written function rather than a flag.

- **Backticks in a `git commit -m` double-quoted string ran as command substitution**, silently eating three spans from the step 3 message.
  `AGENTS.md` records this for `gh issue comment` bodies; it applies to commit messages just as much.
  Every later commit used `--file=-` with a quoted heredoc.

- **A planned killing mutation turned out to be invalid.**
  The plan said deleting `detectRepo`'s call to `git()` should make `fallow dead-code` report `git()`.
  It does not: `github.test.ts` imports `git()`, so it is not dead.
  Probed the gate with a genuinely unreferenced export instead, which it reported immediately.
  A mutation is only a check if you run it.

- **The migration's own first release exercises the new pipeline.**
  `next-version.sh` reports `pi-github-tools-v5.0.0` — the breaking removal correctly majoring from 4.4.0 on real history.

#### Operator action required before shipping

npm Trusted Publishing is configured against `ci.yml`, and the publish step now lives in `release.yml`.
The publisher must be repointed on npmjs.org for all nine packages, or the first dispatched release 403s.
This cannot be done from the repository.

#### Deviations from the plan

1. **Step 4 replaced**: splice each release below the header instead of regenerating, with an HTML era marker (operator-approved after the measurement above).
2. **`prepare-release.sh` gained a `sha` output**, and `publish`/`github-release` check out that commit rather than `main` — a push landing between jobs would otherwise move `main` past the release commit and `git tag --points-at HEAD` would find nothing.
3. **Three unplanned fix commits**: the zsh array fix, the `chore` mapping fix, and the `chore(release)` rationale correction.
4. **Extra files touched**, all found by grep rather than named in the plan: `.github/workflows/label-issues.yml`, `.pi/prompts/triage-backlog.md` (its fork-approval audit named the retired `release-please` job as the secret-bearing one), and `scripts/label-issues.sh`.

### Next stage

`/ship-issue 865` — but restart Pi first.
This session removed the very tools `/ship-issue` calls and rewrote the prompt itself, so a same-process invocation would run the pre-edit template against tools that no longer exist.

## Stage: Final Retrospective (2026-09-01T19:40:48Z)

### Session summary

Planning, build, and ship all ran in one session, landing 17 commits that migrate the repo's release automation from release-please to git-cliff driven by a dispatched workflow.
Four clarification rounds reshaped the issue from a walk-depth bug into a full toolchain migration; the operator rejected the first option set on its premise and supplied a working reference implementation.
The migration's own first release, `pi-github-tools-v5.0.0`, was cut by the new pipeline end to end — after a first dispatch failed on a defect no local verification had caught.

### Observations

#### What went well

- **The plan's own verification criterion overturned a decision the operator had already approved.**
  Step 4 said to regenerate all nine changelogs, and its verify step was "headings match `git tag --list` one for one."
  That check failed immediately, and chasing why produced the finding that regeneration deletes 153 entries carried over from the packages' pre-consolidation repositories.
  A plan step whose verification can *refute the step itself* is worth more than one that merely confirms the work happened.

- **Stopping mid-implementation to re-ask was correct and cheap.**
  The `regenerate` choice had been made at a gate on a cost I supplied.
  When the cost turned out to be wrong, re-opening the gate cost one message and changed the design; pressing on would have deleted over half of `pi-permission-system`'s published changelog.

- **The pre-completion reviewer caught a defect with real production consequence that no gate could.**
  `chore` was mapped as a skipped type when release-please had it visible.
  A package whose only unreleased commits were `chore:` would have been permanently unreleasable, and `verify-cliff-parity.sh` cannot see it — it compares current tip versions, and no package has a chore-only interval pending.
  Round 2 then corrected my *explanation* of a rule while leaving the rule intact, which is a distinct and easy-to-miss category of finding.

- **Listing a dependency's source directory found what no search would have.**
  `gh api .../contents/src` surfaced `local-github.ts` — release-please's unused local-git backend.
  It reframed "are we at the tool's limits?"
  from yes to "there is an unused code path," which in turn exposed that the unused path fixes the wrong problem.

- **The migration self-validated.**
  `pi-github-tools-v5.0.0` — a breaking removal correctly majoring from 4.4.0 — was tagged, published, and released by the very pipeline the change introduced.

#### What caused friction (agent side)

- `missing-context` — **the executable bit was never set on three release scripts.**
  `prepare-release.sh`, `publish-released.sh`, and `create-github-releases.sh` were written with the `Write` tool, which creates mode 644, and committed that way.
  Every verification I ran executed *copies* in a `mktemp` directory that the harness itself `chmod +x`'d, so eleven green harness assertions said nothing about the committed files.
  `lib.sh`, `next-version.sh`, and `verify-cliff-parity.sh` escaped only because a standalone `chmod scripts/release/*.sh` ran before the other three existed.
  Impact: the **production release dispatch failed** with `Permission denied` (exit 126); one fix commit (`3b6af3e4`), one extra CI cycle, one re-dispatch.
  This is the session's only user-visible failure and the only one no reviewer or gate caught.

- `instruction-violation` (reviewer-caught) — **`chore` mapped as a skipped changelog type.**
  I printed `release-please-config.json`'s `changelog-sections` during planning, where `chore` is plainly `hidden=false`, then wrote "the visible five … the hidden six" into `cliff.toml` and repeated the claim in `AGENTS.md`, `/ship-issue`, and the plan.
  `AGENTS.md` already records this exact failure mode from #816 — citing a source for a property without re-checking that it has it.
  Impact: one fix commit (`9d071ac8`), one extra review round.

- `missing-context` — **a qualitative cost claim at a clarification gate was an inference.**
  I offered changelog regeneration as "rewrites past entries' formatting," and the operator's decision rested on that.
  The real cost was measurable in well under a minute (`git-cliff -o` on one package, count headings), and it was 153 deleted entries.
  Impact: a gate decision had to be re-opened mid-implementation; the plan's step 4 was replaced.

- `instruction-violation` (self-identified) — **passed a short SHA to `ci_find`.**
  `/ship-issue` step 4 says, in its own words, to capture the full 40-char SHA and "never hand-expand the short SHA."
  I passed `3b6af3e4`.
  Impact: a 125 s timeout and one wasted tool call; no rework.
  The rule is already explicit and prominent, so this is a compliance failure rather than a documentation gap.

- `other` — **zsh word-splitting silently disabled the changelog path filters.**
  `CLIFF_EXCLUDED_DOC_DIRS` was a space-separated string expanded unquoted; bash splits it, zsh does not.
  The executed scripts were fine under their bash shebang, so `verify-cliff-parity.sh` stayed green; the defect surfaced only when I sourced `lib.sh` inline from the Bash tool (zsh) and `docs/retro` commits leaked into a regenerated changelog.
  Impact: one fix commit (`1aba788f`) and roughly four tool calls chasing a wrong hypothesis (I first suspected the glob syntax, and tested three glob forms that were all correct).

- `other` — **backticks in a `git commit -m` double-quoted string ran as command substitution**, silently deleting three spans from the step 3 message.
  `AGENTS.md` documents this hazard for `gh issue comment` bodies but not for commit messages.
  Impact: one `--amend`; self-caught by reading the committed message back.

- `other` — **a planned killing mutation was invalid.**
  The plan said deleting `detectRepo`'s call to `git()` should make `fallow dead-code` report `git()`; it does not, because `github.test.ts` imports it.
  Impact: one wasted probe before substituting a valid one (a deliberately unreferenced export, which the gate reported immediately).
  A mutation specified at planning time is a hypothesis, not a check.

#### What caused friction (user side)

- **The operator's premise-rejection was the highest-leverage moment in the session, and it arrived at round 2 of four.**
  "I don't understand why we have to make GraphQL network calls as part of the release process" invalidated an option set I had built from five grounded, measured mechanisms.
  Everything in round 1 was correct and none of it mattered.

- **The real pain was named at round 4.**
  "The latency for releases has grown painful" is what selected git-cliff over every release-please-internal fix.
  Rounds 1 and 3 optimized the 135 s job I could see rather than the 14–24 min cycle the operator felt.
  Opportunity: a gate that asks "what is the cost you are actually feeling?"
  before offering mechanisms would have skipped two rounds — though the discarded rounds did produce the measurements that justified the final choice.

- **Pointing at `~/tinyigsoftware/repone` supplied a working reference implementation** that no web search would have matched for fidelity — a real `cliff.toml`, a real dispatch workflow, and a real script split, already proven in another repo.

### Diagnostic details

- **Model-performance correlation** — three subagent dispatches, all on `anthropic/claude-sonnet-5` per their frontmatter (`tidy-first-assessor` once, `pre-completion-reviewer` twice).
  Appropriate: every one was judgment-heavy (a dead-code cascade trace, then two rounds of reasoning about release semantics), and the two reviewer rounds each returned a finding I had missed.
  Turn-level attribution from unfiltered `read_session` labels confirms the ship stage ran on `claude-sonnet-5` and this retrospective on `claude-opus-5`.
  Planning and build turns were not sampled individually, so no attribution is claimed for them.
  The `types: ["model_change"]` filter was tried first and returned three switches with no turns attached — the phantom-switch artifact #737 documents.

- **Escalation-delay tracking** — no sequence exceeded the five-call threshold.
  The longest was the zsh word-splitting hunt at roughly four consecutive calls, three of which tested glob forms that turned out to be correct; the actual cause was visible the moment I printed `CLIFF_ARGS` rather than testing its inputs.
  Printing the constructed argument list before testing its components would have cut that to one call.

- **Unused-tool detection** — `Explore` was never dispatched, correctly: the release-please source work was targeted reads of named files, which `AGENTS.md` says to keep inline.
  `colgrep` had no semantic surface (the only `src/` change was a deletion).

- **Feedback-loop gap analysis** — verification was incremental throughout: `pnpm run lint` after every step, `actionlint` after every workflow edit, and a synthetic-repo harness after every script change.
  The gap is not *when* the loop ran but *what it ran against*: the harnesses copied the scripts to `mktemp` and `chmod +x`'d the copies, so the committed artifacts were never executed as committed.
  A green loop testing the wrong artifact is worse than no loop, because it converts an open question into false confidence.

### Changes made

1. `.pi/prompts/plan-issue.md` — extended the clarification-gate measurement rule to cover qualitative cost claims, not only numbers.
   The existing rule labels *numbers* as measured or estimated, so it did not reach "regeneration only rewrites formatting" — the claim the operator's changelog decision rested on, and which one command would have refuted.

### Declined during the retro gate

Three proposals were put to the operator and not adopted.
Recorded here so the reasoning is not re-derived from scratch next time.

1. **An `AGENTS.md` rule that a workflow-invoked script must be committed executable** (`100755`, not `100644`), noting that the `Write` tool creates mode 644 and that a harness `chmod +x`-ing a copy verifies nothing.
   This was the session's only user-visible failure.
2. **Correcting `/ship-issue` step 6b's `ci_find` timeout diagnosis.**
   The step currently says a timeout most likely means the dispatch's SHA guard failed because `main` moved.
   A short SHA times out identically, which is what actually happened in this session.
   This one is a factual error in a prompt written during this issue rather than a proposed new rule, so it remains a live defect.
3. **Extending the backtick rule to `git commit -m`.**
   `AGENTS.md` documents the hazard for `gh issue comment` bodies; a double-quoted commit message has the identical command-substitution failure, hit once here and self-caught.

### Follow-up not filed

A test harness over `scripts/release/` — the open question [#816] left, now with six scripts behind it.
The executable-bit failure is precisely what a harness executing the **committed** scripts (rather than `chmod +x`-ed copies in a temp directory) would have caught before the release dispatch.
Recorded here by operator preference rather than filed as an issue.

[#468]: https://github.com/gotgenes/pi-packages/issues/468
[#816]: https://github.com/gotgenes/pi-packages/issues/816
