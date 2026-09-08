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
