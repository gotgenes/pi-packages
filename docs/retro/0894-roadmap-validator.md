---
issue: 894
issue_title: "Derive the improvement-roadmap working sequence from each step's priority and dependencies"
---

# Retro: #894 — Derive the improvement-roadmap working sequence from each step's priority and dependencies

## Stage: Planning (2026-09-08T04:42:37Z)

### Session summary

Planned the roadmap tooling as a **validator** rather than the sequence derivation the issue proposed, after measuring that the derivation contradicts the operator's own curation while the validation finds real defects on its first run.
The plan lands in `docs/plans/0894-roadmap-validator.md` as seven steps: a root `vitest` harness, three pure modules (`scripts/roadmap/step-references.mjs`, `parse-roadmap.mjs`, `validate-roadmap.mjs`), the `scripts/roadmap-check.mjs` CLI, a remediation of the live pi-subagents roadmap, and the `/plan-improvements` + `/finish-phase` wiring.
Filed [#902] for the dashed-edge vocabulary the plan defers.

### Observations

The issue's premise split cleanly in two under measurement, and the halves point in opposite directions.
The **inputs are wrong today**: `Priority = Impact × (6 − Risk)` fails on two committed pi-subagents steps ([#857] publishes 9 for 8, [#858] publishes 7 for 6), and the `Release batches` subsection omits [#878] and [#885] from its independently-releasable list though both step blocks declare `Release: independent`.
The **output is not derivable**: pi-permission-system Phase 15 was re-sequenced two days earlier to land [#802] first, and its `Priority` of 12 is the joint-lowest in the phase — a priority-descending topological sort puts it fifth or third depending on whether dashed edges count.
On pi-subagents Phase 22 the derived order splits every named track apart.
So the ordering call carries judgment the published scores do not encode, and the derivation was dropped by operator decision.

Four gates, and each changed the direction rather than confirming it.
The first settled scope (validate only), format authority (the Mermaid diagram over the prose bullet), and host.
The **host recommendation was wrong and the operator caught it**: bash was proposed on the strength of `scripts/` convention, and the honest comparison — bash scripts here are linted by nothing, have no test harness, and have no data structures for graph work — flipped it to a tested `.mjs`.
The operator then asked why not vitest, which is already a catalog entry, and chose vitest at the root over `node --test`.
That single question turned this from a `/build-plan` issue into a `/tdd-plan` one.
The lesson is narrow and worth keeping: "matches the existing convention" is not a reason when the convention was never chosen for this kind of work.

Every parse rule in the plan was spiked against the real documents before it was written down, and the spiking is what justified the tested implementation.
The first draft of the leading-run tokenizer returned `[]` for six of the ten real `**Hard dependency:**` bullets — `after Step 6, which decides…` failed because the token `6,` carries its comma — while looking entirely plausible and while the diagram parse beside it was already correct.
The first draft of the lenient mention check produced eight false positives, because Phase 22's `Steps 1 → 2, 3, 4` lists three of its four members as bare integers that a `Step <n>` literal never matches.
Neither defect is visible from a dry run against the live documents; both are what a fixture test pins.
The final spike produces 2 errors and 5 warnings across 26 steps with zero false positives, and that output is recorded in the plan as the predicted result.

Four false-positive sources were measured rather than imagined, and they are what the parser design is shaped around: the `#### Open-issue sweep dispositions` and `#### Deferred tidyings swept` headings sit inside the roadmap section above `### Steps`; [#890]'s dependency bullet references [#890] itself, so a naive `[#N]` extraction reports a cycle; one bullet names two steps with different force (`after Step 8 … and informed by Step 10`) where the diagram draws one solid and one dashed; and track and batch prose mentions steps that are not members.
The `none`-prefix rule disarms the self-loop, and both live "none" bullets begin with the word — measured, not assumed.

The strict-versus-lenient split fell out of a measurement rather than a preference.
The leading-run rule gives a clean partition on Phase 22's tracks (all 19 steps, exactly once) and breaks on Phase 15's Track D, whose first line has no parenthetical and whose prose tail puts [#881] in a second track.
Widening or narrowing the rule breaks the other document, so the plan keeps the checks strict where the format is strict (per-step tags, the diagram) and lenient and one-directional where it is prose — which still catches the [#878]/[#885] omission at zero false-positive cost.

The Tidy-First assessment was skipped per the skill's applicability gate.
The change creates new `scripts/` and root `test/` files but modifies no pre-existing `src/` or `test/` file, so the assessor's input list is empty by construction.

The `roadmap-fit` skill exited at its first step for [#902]: it is `scope:repo` with no `pkg:*` label and no resolvable package, so there is no open phase to disposition it against — the same outcome [#900] had under [#893].

## Stage: Implementation — TDD (2026-09-08T16:49:20Z)

### Session summary

Executed all seven TDD steps plus a reviewer-driven eighth, landing the roadmap validator as `scripts/roadmap-check.mjs` over three pure modules, with a new root `vitest` harness the repo did not have before.
The root suite went from nothing to 66 tests in four files; no package suite changed.
The validator's first run on the live roadmaps found the three defects the plan predicted, and step 6 corrected them, so `./scripts/roadmap-check.mjs` now exits 0 with only the three dependency-bullet warnings the plan deliberately leaves.
Pre-completion reviewer: PASS, then WARN on the re-review of the follow-up commit, with no blocking findings.

### Observations

Every number the plan predicted reproduced exactly: 19 steps / 19 nodes / 14 edges / 10 hard / 4 soft for pi-subagents and 7 / 7 / 5 / 1 / 4 for pi-permission-system, and the finding set was the same 2 errors and 5 warnings the planning spike produced.
All five of the plan's Test Impact Analysis verification runs reproduced too, including both exit-2 cases.

The mutation step earned its place three times, and twice it was the **plan** that was wrong rather than the code.
The plan's step 1 mutation (`break` → `continue` in the leading-run tokenizer) survived, because the parenthetical split ahead of it was doing the work for that fixture; a second mutation then showed the parenthetical split itself was dead, since `(` always attaches to a following word and the `break` already stops there.
The `none` guard turned out to be dead for the same reason — `none` is not a list token.
Both were removed, leaving one mechanism that a single mutation now kills across all four equivalence classes.
The plan's step 2 mutation (taking step blocks from the whole roadmap section) also survived, because the heading regex — not the `### Steps` slice — is what rejects `#### Open-issue sweep dispositions`.
A fenced step-heading example in the Findings prose was added to the fixture to make the slice load-bearing, which is a realistic hazard since this repo's docs do embed markdown examples.
The general lesson: a mutation that survives is a finding about which mechanism is actually carrying the behavior, and answering it shrank the code twice.

The pre-completion reviewer mutated the shipped code itself and found three branches no fixture reached, which the plan's own mutation list had not anticipated.
The consequential one was `checkBatchTails`' ordinal arm: both live roadmaps spell their tail `tail = Step 3`, so the branch runs on real input today while every fixture used issue-identity steps.
That is the shape to watch for — a dual-shape parser whose fixtures all pick one shape.
The reviewer's re-review then flagged one of the added fixtures as redundant with an existing test rather than new coverage, and it was removed; the real proof of the malformed-heading path lives at the parser layer.

One deviation from the plan, all else being as written: the CLI reports a nonexistent package and a package with no roadmap through the same message rather than two, since both are the same answer — the question could not be answered.

The `docs(pi-subagents)` remediation revised published `Priority` values on two landed steps.
That is a transcription correction rather than a revision of judgement — `Impact` and `Risk` are the recorded judgement and were untouched — but it is worth naming, because the same reasoning does **not** extend to the three dependency-bullet warnings, which are left standing for exactly that reason.

The `→` token was dropped from the dependency-bullet vocabulary: no bullet in either live roadmap uses one, and the arrow belongs to the tracks prose, which a separate and separately-tested vocabulary reads.

## Stage: Sync (worktree) (2026-09-08T21:57:16Z)

### Session summary

Pre-push checks (`pnpm run lint`, `pnpm fallow dead-code`) both pass clean with no fixes needed.
This is repo-root tooling (`scripts/`, root `test/`, `.pi/`) plus one `docs/architecture/` correction under `packages/pi-subagents/`, which `scripts/release/lib.sh` excludes from release scope — the plan's `**Release:** ship independently` marker is moot, since nothing releases regardless.
The operator pre-authorized resolving conflicts in architecture documents during this session's rebase, anticipating overlap with concurrent work on `packages/pi-subagents/docs/architecture/architecture.md`.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-894--/2026-09-08T03-06-16-072Z_01a07efb-0887-765d-9969-b242822808e9.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

No follow-up work is deferred to root beyond the standard ff-merge and issue close.
Both follow-ups from planning are already filed and dispositioned: [#902] (dashed-edge vocabulary standardization, independent of this change) and the roadmap-fit skill's exit-at-first-step outcome recorded in the Planning stage note.

[#802]: https://github.com/gotgenes/pi-packages/issues/802
[#857]: https://github.com/gotgenes/pi-packages/issues/857
[#858]: https://github.com/gotgenes/pi-packages/issues/858
[#878]: https://github.com/gotgenes/pi-packages/issues/878
[#881]: https://github.com/gotgenes/pi-packages/issues/881
[#885]: https://github.com/gotgenes/pi-packages/issues/885
[#890]: https://github.com/gotgenes/pi-packages/issues/890
[#893]: https://github.com/gotgenes/pi-packages/issues/893
[#900]: https://github.com/gotgenes/pi-packages/issues/900
[#902]: https://github.com/gotgenes/pi-packages/issues/902
