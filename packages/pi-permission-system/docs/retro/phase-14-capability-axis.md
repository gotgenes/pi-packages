---
package: pi-permission-system
phase: 14
---

# Retro: pi-permission-system — Phase 14 Planning (capability-axis)

## Stage: Improvement Planning (2026-08-24T16:36:28Z)

### Session summary

The cause hypothesis, formed from `architecture.md`'s design principle 6 and ADR 0013 before any tool ran, was a **missing axis in the policy vocabulary**: a surface names what is touched and never what is done to it, so the deterministic layer cannot distinguish a read from a write and the human oracle absorbs every access whose effect is unknown.
Discovery corroborated it without amendment — ADR 0013 §1 names the same gap as the single defect behind eight open issues, and the craftsmanship scout found the only concentrated production debt sitting inside the very files the axis rewrites.
The phase shape is **full**: eight steps across four tracks, spine = ADR 0013 staging slices 1–3 (`path_read`/`path_write` and their boundary twins → syntax proofs and the pure-reader core → wrapper transparency), with slices 4–7 explicitly reserved as Phase 15's spine.

### Observations

**The cause the phase dissolves.**
The axis is the first phase spine here that is a *vocabulary* addition rather than a boundary extraction, and that changed how the steps decompose.
Steps 1 and 2 relieve nothing a user can observe on their own — Step 1 gives direction somewhere to be written and Step 2 gives it facts to speak about — while Step 3 relieves ~13% of prompt volume unconditionally.
That asymmetry, not file overlap, is what put all three in one release batch with Step 3 as the tail and the release vehicle.

**Splitting ADR 0013's staging slice 2 was the one departure from the record.**
The ADR stages "effect leaf rules" as a single slice covering syntax proofs, the built-in pure-reader core, and `commandEffects`.
Reading [#803] against it showed wrapper transparency needs only the core — and explicitly *must not* honor user declarations, since an argument-independence claim fails open behind a wrapper.
Splitting 2a (syntax + core) from 2b (`commandEffects`) lets the phase reach its highest-priority step without carrying the user-declaration machinery, which is the larger and riskier half.
Filed as [#807] with the split stated in the issue body so the deferral is visible from the tracker, not only from the roadmap.

**A same-commit ordering constraint became a step-level note rather than a step.**
ADR 0013 §4 records that the bounded-delegation envelope's `DELEGATION_EXCLUDED_SURFACES` is enforced by exact string membership, so a directional key reaching an authorizer before the family-membership conversion is a silent widening of the envelope.
That is a security regression with no test that would catch it, so it is written on Step 1 as an ordering constraint on the commit rather than left for `/plan-issue` to rediscover.

**Alternatives and deferrals considered.**
Four spine sizes went to the operator (slices 1–2, 1–3, 1–4, and a reorder putting wrapper transparency first); slices 1–3 was chosen, leaving [#609]'s breaking redirect projection out — which is right on its own merits, since the axis must be non-breaking by construction and does not belong in the same release as a breaking change.
Track C ([#799], the policy-channel ADR) was offered and declined: it is the strongest non-code candidate for Phase 15, and ADR 0013 §9 has already written its input constraints, so nothing decays by waiting — but three third-party PRs stay blocked, which the sweep list records.
[#620], [#519], [#751], and [#797] each got a recorded disposition rather than a step, per the operator's answer.
[#620] is the third consecutive deferral and is explicitly *not* a silent re-defer: ADR 0013 §7 narrows its charter, so the chain is no longer the only path to read relief.

**The deferral gate did not fire, and the craftsmanship split is why it did not need to.**
The scout refuted all five fallow large-function flags on test files — every one a nested tree of small behavior-named tests — which is the fourth consecutive phase those same flags have been refuted.
Its one concentrated cluster (`bash-path.ts`'s missing `selectUncoveredPathCandidates` extraction, `runDescriptor`'s six numbered phases, `rule.ts:143`'s stale duplicate doc comment) sits inside the spine's own rewrite scope, so it rides Steps 1 and 2 as tidy-first prep commits instead of earning a step.
The scout also actively cleared `src/index.ts` — the package's top hotspot at 17.1 and a 292-line factory — on the grounds that its two forward-declared `let`s exist to satisfy a circular closure.
That is a useful precedent: the top hotspot is not automatically the target, and a self-justifying architecture-doc note ("kept inline per the anti-procedure-splitting rule") held up when checked against the code.

**The fallow health score moved 88 → 78 and should not be chased.**
The entire drop is a new `hotspots -10.0` deduction; no other deduction worsened and coupling improved.
Roughly 40 commits landed on the package in the six days between Phase 13's archive and this planning pass ([#699], [#786], [#787], [#789], [#794], [#639]), which mechanically raises churn density inside the 6-month window the deduction reads.
Verified that the score is genuinely package-scoped (pi-subagents 88, pi-colgrep 90 on the same run) and that the fallow version is unchanged, so it is a real recomputation rather than a tooling artifact — but it measures a burst of issue-driven work, not new structural debt.
The metric is carried as a floor (`≥ 78`), with the reasoning recorded in the roadmap so `/finish-phase` does not read the flat line as a failure.

**Feasibility probes.**
None of the eight steps depends on an SDK type or behavior, so no probe was required.
The one surface check that mattered was internal: `DELEGATION_EXCLUDED_SURFACES` and `PATH_SURFACES` were read directly to confirm the family conversion touches one file each, and every one of the eleven metric recompute commands was run before commit and reproduces its stated baseline.
Seven of them grep for names the phase has not created yet, so each is annotated with the step that owns the name.

[#519]: https://github.com/gotgenes/pi-packages/issues/519
[#609]: https://github.com/gotgenes/pi-packages/issues/609
[#620]: https://github.com/gotgenes/pi-packages/issues/620
[#639]: https://github.com/gotgenes/pi-packages/issues/639
[#699]: https://github.com/gotgenes/pi-packages/issues/699
[#751]: https://github.com/gotgenes/pi-packages/issues/751
[#786]: https://github.com/gotgenes/pi-packages/issues/786
[#787]: https://github.com/gotgenes/pi-packages/issues/787
[#789]: https://github.com/gotgenes/pi-packages/issues/789
[#794]: https://github.com/gotgenes/pi-packages/issues/794
[#797]: https://github.com/gotgenes/pi-packages/issues/797
[#799]: https://github.com/gotgenes/pi-packages/issues/799
[#803]: https://github.com/gotgenes/pi-packages/issues/803
[#807]: https://github.com/gotgenes/pi-packages/issues/807
