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

[#481]: https://github.com/gotgenes/pi-packages/issues/481
