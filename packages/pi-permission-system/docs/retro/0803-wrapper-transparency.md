---
issue: 803
issue_title: "pi-permission-system: exempt argument-independent read-only inner commands from the wrapper floor"
---

# Retro: #803 — pi-permission-system: exempt argument-independent read-only inner commands from the wrapper floor

## Stage: Planning (2026-08-27T02:42:22Z)

### Session summary

Produced `docs/plans/0803-wrapper-transparency.md` for Phase 14 Step 3 (ADR 0013 §11, the `capability-axis` batch tail).
Before writing, measured the change against the local review log with a disposable vitest spike that imported the **real** `classifyWrapperWords` / `proveCommandEffect` / tree-sitter modules rather than reimplementing them: 90 of 324 prompts across 2026-07/08 are wrapper-floored (27.8%), and 42 of those (13.0% of all prompts) are exempt under the delivered predicate — an independent reproduction of ADR 0013's ~13% claim.
Three `ask_user` decisions were taken; one was bounced and re-asked with the lever named.

### Observations

- **The spike found a fail-open the issue's wording would have shipped.**
  `executedUnitOf` unwraps *through* an opaque payload, so `xargs -I{} sh -c 'grep -l "…" {}'` yields `executedUnit = grep -l "…" {}` — head word `grep`.
  A predicate built literally on "the `executedUnitOf` head is a core word" (the issue's phrasing, and ADR 0013 §11's) would have exempted an unparsed shell program.
  The plan's predicate therefore shares the unwrap **loop** with `executedUnitOf` but refuses at an opaque layer, and cycle 2 asserts the two functions disagree on that input.
  This is the third consecutive step in this phase where verifying the plan's enumerated external facts against the real surface caught a fail-open (#807's `find -fprint0` and `file -C` were the prior two).
- **Two other corrections to the issue's literal text.**
  Core *membership* is not the right test — `xargs sort -o /etc/passwd` has a core head word and writes — so the predicate calls `proveCommandEffect` and inherits the retraction guards.
  And the redirect fact is not on the `command` node: tree-sitter-bash attaches `file_redirect` to the parent `redirected_statement`, and the local `TSNode` interface exposes no `.parent`, so the enumerator must relay a `writesViaRedirect` flag as it descends.
- **Verdict semantics went to the operator and B was chosen.**
  An exempt unit resolves the *inner* unit's text and takes that verdict, rather than merely lifting the floor.
  The two differ only where the inner text matches a more restrictive rule (`bash: {"*": "allow", "grep *": "deny"}` → `deny` instead of a silent `allow`), so B is a pure safety gain over the floor-lift-only alternative.
  Because the branch fires only where the floor would have (base `allow`), an explicit `deny`/`ask` on the wrapper is structurally untouchable.
- **The `sudo` gate was bounced, correctly.**
  The first ask offered include/exclude on a security framing without naming who owns the lever.
  The operator's reply — "it could be solved by a user by simply specifying some designation like ask or deny to `sudo` and `doas`" — is exactly right under verdict B, and the re-ask presented a per-configuration table showing the divergence needs a permissive `bash` policy *and* (outside cwd) a permissive read grant.
  Decision: no carve-out, plus a documented `sudo *: ask` recipe.
  Recorded in the plan's Non-Goals as a deliberate refusal to half-build a principal axis.
- **The audit fact routes through `logContext`, not `PromptRequestFacts`.**
  Step 2's `effect`/`effectSource` set the precedent, and it keeps a published cross-extension contract (five payload builders plus a tolerant guard) untouched.
- **One preparatory extraction is in the plan as cycle 1.**
  `redirect-analysis.ts` gives the `file_redirect` reading a single owner, consumed by both `token-collection.ts` and the enumerator; without it the two would each carry an operator table that must agree.
  It lands as a behavior-preserving `refactor:` ahead of any consumer, with the untouched `token-collection.test.ts` as the measurement.
- **No follow-up issues filed.**
  The three Open Questions each state why nothing is filed: the principal axis has no motivating population, widening to `commandEffects` is ADR 0013's own "evidence, not symmetry" bar, and `env`'s environment-assignment surface is [#481]'s deliberate trade-off rather than a regression this step introduces.
  The `roadmap-fit` skill was therefore not exercised.

## Stage: Implementation — TDD (2026-08-27T16:29:33Z)

### Session summary

Shipped Phase 14 Step 3 across seven planned TDD cycles plus one tidy-first prep, one mid-flight issue disposition, and two review-driven follow-ups — 14 commits.
A wrapper unit running a proven pure reader is no longer floored to a synthetic `ask`; it resolves by the inner command's own bash rules, measured at 43 of 328 prompts relieved (13.1%) across 2026-07 and 2026-08.
Test count went 3501 → 3618 passing (+117) plus 2 deliberate `it.fails`.

### Observations

- **Pre-completion review caught a real fail-open, and it was mine.**
  The first implementation's `redirectProvesFileWrite` reused `token-collection.ts`'s `ARG_NODE_TYPES` filter, which only recognizes a *literal* destination.
  So `xargs grep foo > $OUT`, `>${OUT}`, and `> $(mktemp)` proved no write and were exempted — an `allow` where the pre-change code asked, for a write to a run-time-chosen path that the path projection also does not collect ([#609]).
  The floor had been the only guard those shapes ever had.
  The lesson generalizes past this fix: an extraction that is genuinely behavior-preserving *for its original consumer* can be unsafe the moment a second consumer asks a different question of it.
  The token collector asks what to **attribute** (answer: a proof); the enumerator asks whether it is safe to **remove a guard** (answer: a refusal).
  The function is now `redirectMayWriteFile` and the module doc states the split, because the name `provesFileWrite` was itself part of how the mistake read as correct.
- **Three of the plan's design decisions survived contact; one did not.**
  Refusing to unwrap through an opaque payload, proving the inner command through `proveCommandEffect` rather than core membership, and treating `sudo`/`doas` as ordinary wrappers all held exactly as planned and are each pinned by mutation-verified tests.
  The plan's design-review note predicting that two relayed facts would not yet earn a record was wrong in practice — four positional parameters with an optional one in the middle read worse than a `UnitScope`, which also gave `collectCommands` a named `TOP_LEVEL_SCOPE` instead of a bare `undefined, false`.
- **Every new pin was checked by mutation, and it paid for itself twice.**
  Reverting `isTransparentWrapper` to the naive "read `executedUnitOf`'s head word" implementation the issue's own wording describes failed exactly the four opaque-payload tests; removing the `writesViaRedirect` relay failed exactly the six redirect tests; removing the `logContext` stamp failed exactly the one audit test.
  A test written after its implementation is worth nothing until something like this is run against it.
- **Two composition-root tests were false-greened by the change itself.**
  Both yolo reconciliation tests used `xargs grep foo`, which is now exempt — so "still floors an indirection wrapper with yolo off" failed, and its sibling "auto-approves under yolo" would have passed for the wrong reason.
  Both moved to a non-core inner command, and a third test covers the newly distinguished case (an exempt wrapper raises no ask at all, end to end through the real extension).
- **Deviations from the plan, all recorded in commit bodies:** `cross-extension-api.md` and `migration/0746-review-log-fields.md` were not edited (both document `PromptRequestFacts`, which is untouched — the fact rides `logContext`, as [#807]'s `effect`/`effectSource` do); the plan's file list now records that as deliberate rather than leaving it reading as an unfinished checklist.
- **[#814] filed and dispositioned mid-implementation.**
  Writing `redirect-analysis.ts`'s first direct tests exposed that tree-sitter-bash has no node for the read-write open `<>`, so what it proves depends on how the destination is spelled (`cat <> rw.txt` proves a read, `cat <> ~/rw.txt` proves a write).
  Pre-existing, out of this step's scope, filed with a live repro, adopted as Phase 14 Step 12 by operator decision, and pinned by two `it.fails` characterization tests that flip when it lands.
- **The measurement instrument now prices its own clauses.**
  The first version reported only totals while the docstring asserted per-clause costs, which the reviewer correctly flagged as not re-derivable.
  It now prints what each conservative clause forfeits (6 / 0 / 0), so no number in the plan or the roadmap rests on prose.
- **Environment note for a future session:** the machine ran at load average 15–24 from unrelated system daemons, and the timing-sensitive `test/authority/` forwarding-liveness tests flake under it with nonsensical reported durations (a test "taking" 77 minutes).
  A different pair failed on each run and all passed in isolation; the clean full-suite run at lower load is 151 files / 3618 passed / 2 expected fail.
  Re-run before believing a failure there.
- **Pre-completion reviewer: FAIL, then WARN.**
  The first dispatch returned FAIL on the redirect fail-open above.
  After the fix, the re-review independently re-derived all five security claims live (including a ten-shape sweep of heredocs, herestrings, multiple redirects, subshell and nested-execution redirects, and both `<>` spellings) and found no remaining gap.
  Its three WARNs — a stale `redirectProvesFileWrite` name in the architecture module tree, the plan's undelivered doc rows, and a new Biome `noTemplateCurlyInString` warning — are all resolved in `8484bd39`.

[#481]: https://github.com/gotgenes/pi-packages/issues/481
[#609]: https://github.com/gotgenes/pi-packages/issues/609
[#807]: https://github.com/gotgenes/pi-packages/issues/807
[#814]: https://github.com/gotgenes/pi-packages/issues/814
