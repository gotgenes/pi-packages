---
package: pi-permission-system
phase: 16
---

# Retro: pi-permission-system — Phase 16 Planning (policy-channels)

## Stage: Improvement Planning (2026-11-19T06:24:07Z)

### Session summary

The cause hypothesis, written from ADR 0016 and the architecture doc before any tool ran, was that **a channel is spelled, not modelled**: the record decides everything about a policy source per channel, and the code enumerates four scopes by hand at every site that needs them.
Reading `permission-manager.ts`, `scope-merge.ts`, and the three config loaders confirmed it, and fallow's complexity flags and the craftsmanship scout's clusters landed in the same files.
The phase shape is full and over the ceiling by operator decision: twenty steps in six tracks, made of ADR 0016's fourteen implementation issues, the already-filed [#1028], two forwarding-tree fold-ins ([#1115], [#1067]), one docs step ([#780]), and two preparatory steps filed by this session ([#1133], [#1134]).

### Observations

- **The declared candidate had moved, and the newest carrier was not one the template names.**
  Phase 15's history says Phase 16 is the sandbox record, and two issue retros carry `#### Phase handoff` notes for other causes.
  The 2026-11-19 backlog triage, committed hours before this session, records the operator's decision that ADR 0016's implementation goes first.
  A triage document under `docs/triage/` is a declared-candidate carrier of the same standing as a history file's Findings; read the newest one before trusting the history file's phase assignment.
- **The architecture doc described the target as the baseline.**
  Its `## Composed ruleset` section says config scopes are concatenated in scope order, which is what [#1108] will make true and not what ships: scopes are merged as raw objects and the scope is recovered through a parallel origin map.
  The hypothesis survived because the source was read before the doc was believed.
  The section is corrected in the roadmap commit.
- **The doc had no reference-link definitions at all.**
  Archiving Phase 15 moved every `[#N]:` definition to the history file and left the body's references dangling, which `rumdl` does not report.
  The roadmap commit adds definitions for all 121 references in the file, each resolved to an issue or a pull request through the API and not guessed.
- **The ceiling was put to the operator as a real choice and overridden with a recorded reason.**
  Seventeen candidates became twenty once the fold-ins were chosen.
  The reason one phase holds: the scope is a decided record's implementation list and not discovery output, every step releases on its own, and a split by layer would have made the two demand clusters ([#1118]; [#1122] with [#1123]) wait for a second sweep.
  The cost is the precedent: Phase 15 opened at six steps and closed at twenty-four.
- **The scout found the concentrated debt where fallow was silent, and refuted fallow where it was loud.**
  All fourteen large-function flags on test files were refuted.
  The oversized file that matters, `permission-manager-unified.test.ts`, drew no flag, because its debt is 50 flat top-level tests and five scattered homes for one concern, not one large function.
- **Reading the write path's tests exposed a probable live defect.**
  `ConfigStore.save()` writes three knobs and never `doublePressToConfirm`, and the modal test saves through a hand-written fake that keeps the whole config, so nothing notices.
  It was traced in source and not run; it rides [#1102], with a comment on that issue.
  A test double that is more capable than the object it replaces hides exactly the gap the test exists to find.
- **One number from the scout did not survive re-derivation, and one of mine did not either.**
  The scout reported the unified test file as 214 tests where vitest runs 232, and I told the operator the scout refuted thirteen flags when the prompt had handed it fourteen.
  Both were corrected before the roadmap was written; every count in the roadmap was re-run from its own command.
- **Feasibility probes that shaped a step:** `registerFlag` and `getFlag` exist at the pinned Pi 1.0.0, and the loader fills a flag's value after the extension factory runs, so [#1118] must read its flag at `session_start`; no sibling package registers a flag, so there is no in-repo precedent to copy.
  `pi-tui` exports `Input` for [#1123]'s editable pattern, and `jsonc-parser` 3.3.1 is published for the comment-preserving write.
- **Deferral gate and trajectory:** cause-level findings existed (Category A and C), so the gate did not fire; the maximum step priority is 20 for the fifth consecutive phase, so there was no cadence question.
  Repeat deferrals went to the operator explicitly: [#620] at its 5th sweep (deferred, with the rationale that ADR 0016 changes its charter), the wrapper group around [#926] (decided outside the phase), and [#780] with [#868] at their 3rd (both scheduled).
- **The push carried more than the roadmap.**
  `git pull --ff-only` reported the branch up to date because `main` was four commits ahead of the remote (the triage run's own commits), so the roadmap's `git push` published those as well.
  An "already up to date" pull says nothing about unpushed local commits; `git status -sb` before the first push would have shown them.

[#620]: https://github.com/gotgenes/pi-packages/issues/620
[#780]: https://github.com/gotgenes/pi-packages/issues/780
[#868]: https://github.com/gotgenes/pi-packages/issues/868
[#926]: https://github.com/gotgenes/pi-packages/issues/926
[#1028]: https://github.com/gotgenes/pi-packages/issues/1028
[#1067]: https://github.com/gotgenes/pi-packages/issues/1067
[#1102]: https://github.com/gotgenes/pi-packages/issues/1102
[#1108]: https://github.com/gotgenes/pi-packages/issues/1108
[#1115]: https://github.com/gotgenes/pi-packages/issues/1115
[#1118]: https://github.com/gotgenes/pi-packages/issues/1118
[#1122]: https://github.com/gotgenes/pi-packages/issues/1122
[#1123]: https://github.com/gotgenes/pi-packages/issues/1123
[#1133]: https://github.com/gotgenes/pi-packages/issues/1133
[#1134]: https://github.com/gotgenes/pi-packages/issues/1134
