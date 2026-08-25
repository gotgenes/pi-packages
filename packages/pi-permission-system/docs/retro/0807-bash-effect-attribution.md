---
issue: 807
issue_title: "pi-permission-system: attribute bash path-token effects from syntax proofs and a pure-reader core"
---

# Retro: #807 — pi-permission-system: attribute bash path-token effects from syntax proofs and a pure-reader core

## Stage: Planning (2026-08-25T16:52:00Z)

### Session summary

Planned Phase 14 Step 2 — per-token effect attribution from redirect syntax proofs and a 22-word frozen pure-reader core — as `docs/plans/0807-bash-effect-attribution.md`, nine TDD cycles.
One clarification gate settled the core's breadth, its retraction guards, and how narrow a bash session approval becomes; the operator's note on the third answer produced [#810], filed and adopted as Phase 14 Step 10.
Two facts were measured rather than argued: the core's relief ceiling, from the local review log, and the parse-tree shapes the syntax proofs read.

### Observations

**The gate was grounded on a measurement, and the measurement is what chose the option.**
A marginal-contribution scan over 803 bash asks (229 recent) showed relief concentrated in three words — `echo`, `find`, `diff` take the recent figure from 5.7% to 27.5% — while the next ~40 audited coreutils add about one point.
Without that table the "broad audited core" option reads strictly better than the focused one; with it, the focused core is obviously right and the broad one is 40 extra audit liabilities for a rounding error.
The script ships as `scripts/measure-core-coverage.mjs` in the docs cycle, per ADR 0013's own rule that a durable number's instrument is committed beside it.

**The issue's single-module sketch splits in two, for a layering reason.**
Issue [#807] puts the `Effect` type in `src/access-intent/bash/command-effects.ts`.
But `path-surfaces.ts` needs the effect type to expose `capabilitySurfaceForEffect`, and a core-layer vocabulary module importing from the `bash/` subtree is the same violation that relocated `pickMostRestrictive` out of `handlers/gates/` in [#806].
So the vocabulary lands in `src/access-intent/effect.ts` and the bash-specific proofs (roster, guards, redirect table) stay in `command-effects.ts`.
The roadmap's metric row greps for the file name and still passes.

**`EffectSource` gained a fourth value the ADR implies but does not name.**
`"retracted"` is distinct from `"unproven"` because "nobody claimed anything about `pnpm`" and "`find` is core but `-delete` withdrew the claim" are different diagnoses, and ADR 0013 §7 explicitly wants the second as a blame line.
It costs one union member and makes the two new log fields self-explanatory.

**Dedup folds rather than splits, and the ADR is what makes that honest.**
Keying the dedup on `(path, effect)` would split `cat ~/a > ~/a` into two entries and show the path twice in the prompt.
Merging instead — two disagreeing proven effects fall to unproven — routes identically and keeps the entry count unchanged, and ADR 0013's 2026-08-25 amendment states outright that proven-both and unproven-at-all are one mechanism, not two.
So the fold is the ADR's own reading rather than a convenience.

**The roadmap's assigned tidy-first prep is dropped, for the second consecutive step.**
Phase 14 assigns the `runDescriptor` split to this step because "this change extends exactly that dispatch".
It does not: provenance rides in each gate's `logContext`, which the runner already spreads, so `runner.ts` has zero diff and Tidy First's own rule excludes it.
This is the identical call [#806] made about `selectUncoveredPathCandidates`, which suggests the roadmap's prep assignments were made against a gate-side design that neither step delivered.

**The change is verifiably non-breaking, and the check was cheap.**
`pnpm view` reports 27.0.1 published, and `git show pi-permission-system-v27.0.1:…/path-surfaces.ts` has no directional surfaces — Step 1 is unreleased.
So no released config can name `path_read`, and a bare-family config expands to identical rule lists on both members, making a read-routed answer bit-identical.
Two commands settled what would otherwise have been a paragraph of reasoning.

**The [#806] fixture work is what keeps the test migration to four files.**
`makeSurfaceCheck` has answered a family key for its directional members since [#806], so every handler test that declares `external_directory: deny` keeps working when the gate asks for `external_directory_read`.
Only the three files that assert *token shapes* (`token-collection.test.ts`, `program.test.ts`) or *surface names* (the two bash gate tests) migrate.

**One invariant citation was checked by opening the file, not by memory.**
The plan pins the forwarded-child deny on the `ServingPolicy resolves a forwarded request against real recorded authority` block — the one block in `test/authority/forwarded-request-server.test.ts` that rebuilds the real wiring; every other test in that file stubs `policy`.
That is exactly the defect [#806]'s pre-completion review caught in its own plan, and the `/plan-issue` template now carries the rule.

[#806]: https://github.com/gotgenes/pi-packages/issues/806
[#810]: https://github.com/gotgenes/pi-packages/issues/810
