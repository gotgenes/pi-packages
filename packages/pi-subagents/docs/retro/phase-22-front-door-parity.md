---
package: pi-subagents
phase: 22
---

# Retro: pi-subagents — Phase 22 Planning (front-door-parity)

## Stage: Improvement Planning (2026-08-29T16:11:49Z)

### Session summary

The initial cause hypothesis (metrics projection written back onto the record) was refuted by the architecture doc's own history — Phase 18 resolved that tier — and the declared candidate from [#724]'s planning retro survived discovery intact: the two front doors (`subagent` tool and `SubagentsService.spawn`) were never held to the same contract.
The phase shape chosen is full (8 steps): a four-step spine adopting the pre-filed front-door cluster ([#724], [#830], [#829], [#828]), three delivery-boundary bug tracks ([#801], [#827], [#798]), and the operator-scheduled ask-back feature ([#465]).
Every step adopts an existing issue number, so no issues were filed and the roadmap linked back in a single commit (`3954ffa5`).

### Observations

- The cause the phase dissolves traces to the architecture doc's "Reactive versus discrete (not internal versus external)" first-principles section, which rules the service a first-class door but was never audited against the code — [#724]'s six-divergence audit is the evidence.
- Deferral gate did not fire: the spine is cause-level Category A/C work, and the craftsmanship scout found no concentrated debt (the fallow flag on `test/settings.test.ts:312` was refuted as a healthy 17-`describe` tree; all four Phase 21 boy-scout items persist unchanged and stay on the `tidy-first` path — notable that none were picked up incidentally in six weeks).
- Repeat-deferral decisions were surfaced explicitly: [#451] (3rd sweep) was relabeled `scope:repo` and its `pkg:pi-subagents` label dropped (executed during planning); [#465] (2nd sweep) was scheduled into the phase now that [#466] landed; [#608] and [#519] were deferred with recorded rationale.
- Trajectory check fired (max priority 15→16→16, hotspots cooling); the operator chose to keep the regular rotation.
  This phase is nonetheless trigger-driven in substance — it exists because a bug cluster arrived, which is `improvement-discovery`'s named trigger working as designed.
- Release coordination the [#724] retro requested is settled in the roadmap: [#829] + [#828] (+ conditionally [#830]) batch as "front-door-majors" for one semver-major bump; [#724] ships independently per its committed plan.
- Feasibility notes: [#827]'s SDK facts are pre-verified in the issue against `@earendil-works/pi-coding-agent@0.79.1` but must be re-verified at plan time; the `agentConfig?.` metric row counts the mechanism Step 3 replaces, and two metric rows grep for predicted names (`Agent ID`, `available_skills`) — the implementing steps must use those spellings or update the rows.
- Doc/tracker drift found and fixed in the roadmap commit: the history prose claimed [#482], [#600], and [#610] "remain open"; all three are closed.
- Session note: a mid-session disconnection made the craftsmanship scout appear incomplete, but `get_subagent_result` confirmed the stored result was complete (`status: completed`) — verify before re-dispatching.

[#451]: https://github.com/gotgenes/pi-packages/issues/451
[#465]: https://github.com/gotgenes/pi-packages/issues/465
[#466]: https://github.com/gotgenes/pi-packages/issues/466
[#482]: https://github.com/gotgenes/pi-packages/issues/482
[#519]: https://github.com/gotgenes/pi-packages/issues/519
[#600]: https://github.com/gotgenes/pi-packages/issues/600
[#608]: https://github.com/gotgenes/pi-packages/issues/608
[#610]: https://github.com/gotgenes/pi-packages/issues/610
[#724]: https://github.com/gotgenes/pi-packages/issues/724
[#798]: https://github.com/gotgenes/pi-packages/issues/798
[#801]: https://github.com/gotgenes/pi-packages/issues/801
[#827]: https://github.com/gotgenes/pi-packages/issues/827
[#828]: https://github.com/gotgenes/pi-packages/issues/828
[#829]: https://github.com/gotgenes/pi-packages/issues/829
[#830]: https://github.com/gotgenes/pi-packages/issues/830
