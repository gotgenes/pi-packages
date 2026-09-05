---
package: pi-permission-system
phase: 15
---

# Retro: pi-permission-system — Phase 15 Planning (token-roles-declared-effects-sandbox-seam)

## Stage: Improvement Planning (2026-09-05T16:10:59Z)

### Session summary

The cause hypothesis read ADR 0013 §10's recursive verdict fold against the two flat projections `BashProgram.parse` runs and predicted a "walker fusion" phase; the craftsmanship scout refuted the fusion reading (the generic and pattern-first walkers, and `readCommandWords` versus `commandArgumentWords`, differ in filter and output), and the corrected cause is narrower: a token's role is established at collection and discarded before projection, which is [#609] and [#863] seen from opposite sides.
A second cause surfaced from measurement rather than reading — the gates' blame facts ride a `logContext` the ask path never writes, so zero review-log entries carry an `effect` key and 134 bash `external_directory` asks record `path: null`.
The phase shape is full: six steps over three tracks, adopting ADR 0013 staging slices 4–6 and filing the unfiled remainder of slice 2 ([#880]) plus the blame defect ([#881]); [#804] and the three ADR deliberations defer to Phase 16.

### Observations

- **The operator's mid-analysis worry reshaped the phase, and measuring it was what made that safe.**
  "The false-positive asks frustrate me but I don't know how to fix them" could have produced a classifier-rewrite phase.
  Scanning the local review log instead showed non-path tokens at 4.5% of `external_directory` asks and trending to zero, revision ranges at zero, and 95% of the friction being real paths where direction is the question — which put [#863] and [#859] in as two small `fix:` steps and made `commandEffects` the priority-20 spine.
  The scan script is committed (`scripts/measure-path-false-positives.mjs`, wired as `measure:path-false-positives`) so the number can be re-run rather than argued with.
- **Measurement found a defect the doc, the skill, and an ADR all describe as working.**
  The package skill says each bash gate stamps `effect`/`effectSource` on its `logContext` "so `{ effect: "unproven", effectSource: "retracted" }` reads as …"; the mechanism is real and the sentence is false for every ask, because `PermissionPrompter` renders from `PromptPermissionDetails`.
  A claim about what a log carries is verifiable by `grep -c` on the log; do that before citing it.
- **The declared candidate lived in four places, and one of them was unfiled.**
  Phase 14's history named slices 4–7; ADR 0013's Staging section named them too; the Phase-handoff sweep hit [#837]'s retro; and `commandEffects` — half of slice 2 — was in none of the trackers, only in a `docs/configuration.md` sentence describing it as shipped.
  A staging list in an ADR is a declared-candidate carrier of the same standing as a history file's Findings; sweep its `landed` markers, not just its numbering.
- **[#800] closed as completed without a code change.**
  Its ask was delivered by [#806]/[#807] under a different mechanism (a `_read` surface rather than a whitelist bypass); the close comment states where the body's constraints hold and where the shipped design differs (the read-path source).
  An issue filed before a phase can be satisfied by that phase's design without any step naming it — check the delivered mechanism against the ask, not the ask's proposed mechanism.
- **Feasibility probes that mattered:** `nono run --read/--write/--allow -- <cmd>` exists (Landlock/Seatbelt), so Step 6's outcome is deliverable, with the root-derivation design question recorded on the step; `getComposedConfigRules` is reachable from `index.ts`, so the service can derive the scope; the `script` role in `PATTERN_FIRST_COMMANDS` already exists, so [#863] needs table entries rather than a new mechanism; `shellTools`'s shallow merge is the precedent [#880] copies.
- **Deferral-gate and trajectory:** cause-level findings existed (Category A and C), so the gate did not fire; max priority 20 for the fourth consecutive phase, so no cadence question.
  Repeat deferrals were put to the operator explicitly — [#620] at its 4th sweep, [#751] at its 3rd, [#822] behind the sandbox seam — and each carries its ordinal in the dispositions.
- **Fallow's duplication figure moved from 0.1% to 1.3% with no production change**: five `scripts/measure-*.mjs` instruments clone one review-log prelude.
  The metric row now counts `src/` clone groups only; the prelude extraction rides whichever step next adds an instrument (this planning added a sixth without extracting, deliberately keeping the planning commit to the roadmap).

[#609]: https://github.com/gotgenes/pi-packages/issues/609
[#620]: https://github.com/gotgenes/pi-packages/issues/620
[#751]: https://github.com/gotgenes/pi-packages/issues/751
[#800]: https://github.com/gotgenes/pi-packages/issues/800
[#804]: https://github.com/gotgenes/pi-packages/issues/804
[#806]: https://github.com/gotgenes/pi-packages/issues/806
[#807]: https://github.com/gotgenes/pi-packages/issues/807
[#822]: https://github.com/gotgenes/pi-packages/issues/822
[#837]: https://github.com/gotgenes/pi-packages/issues/837
[#859]: https://github.com/gotgenes/pi-packages/issues/859
[#863]: https://github.com/gotgenes/pi-packages/issues/863
[#880]: https://github.com/gotgenes/pi-packages/issues/880
[#881]: https://github.com/gotgenes/pi-packages/issues/881
