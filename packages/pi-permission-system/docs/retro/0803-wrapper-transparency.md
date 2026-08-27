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

## Stage: Final Retrospective (2026-08-27T17:01:46Z)

### Session summary

Planned, implemented, and shipped Phase 14 Step 3 in one session — 15 commits, released as `pi-permission-system-v27.1.0` (the `capability-axis` batch tail carrying [#806], [#807], and this issue).
The wrapper floor no longer applies to a wrapper running a proven pure reader, relieving a measured 13.1% of all prompts.
One blocking fail-open was introduced during implementation and caught by pre-completion review before it landed; one pre-existing fail-open ([#814]) was found, filed, and dispositioned as a new roadmap step.

### Observations

#### What went well

- **A `refactor:` extraction became a security defect, and a fresh-context reviewer on a weaker model caught what the implementing model missed.**
  The implementation ran on `claude-opus-5`; the `pre-completion-reviewer` runs on `claude-sonnet-5` by frontmatter.
  The reviewer found that `redirectProvesFileWrite` had inherited `token-collection.ts`'s `ARG_NODE_TYPES` filter, so `xargs grep foo > $OUT` was exempted.
  Fresh context plus an explicit re-derivation mandate beat raw model strength on this class of defect — the implementing model had written the tests, the docs, and the plan's own risk table, and none of them covered the shape.
- **Dispatching the reviewer adversarially is what produced the finding.**
  The dispatch named the change as a security boundary, listed five claims to re-derive rather than accept, and required the reviewer to *enumerate its own candidate input shapes* instead of checking the ones the tests cover.
  It enumerated `$VAR`, `${VAR}`, and `$(cmd)` destinations, which no test in the suite touched.
  A generic "review this issue" dispatch would have found nothing — every deterministic check was green.
- **Mutation-checking every new pin caught nothing but proved everything.**
  Three pins were verified by reverting the implementation to its plausible-wrong form: the naive `executedUnitOf`-string predicate failed exactly the four opaque-payload tests, removing the `writesViaRedirect` relay failed exactly the six redirect tests, and dropping the `logContext` stamp failed exactly the one audit test.
  Since each test was written after its implementation in the same cycle, the mutation is the only thing separating a pin from a tautology.
- **The planning-stage spike paid for the whole session.**
  Running the *real* modules over the real review log (rather than reimplementing them, as the earlier `measure-core-coverage.mjs` precedent invited) exposed that `executedUnitOf` unwraps through an opaque payload — a fail-open the issue's own wording and ADR 0013 §11's own wording would both have shipped.

#### What caused friction (agent side)

- `missing-context` — the extracted `redirectProvesFileWrite` reused the token collector's `ARG_NODE_TYPES` destination filter without asking what a `false` meant to the *new* caller.
  The extraction was genuinely behavior-preserving for its original consumer, which is what made it read as safe; the new consumer was deciding whether to remove a guard, where "unrecognized" must mean "unsafe", not "no write".
  Impact: the single blocking review finding, one extra `fix:` commit (`0e1ed359`), a rename, three new test blocks, and a re-dispatch of the reviewer.
  This is the one defect of the session and it is worth more than the rest combined.
- `instruction-violation` (user-caught) — the first `sudo`/`doas` `ask_user` gate offered include/exclude on a security framing without naming who owns the lever or what happens in each concrete configuration.
  `AGENTS.md` line 186 states exactly this rule (Refs #789), and the operator bounced the gate for exactly that reason.
  Impact: one extra gate round-trip; the re-ask with a per-configuration table produced a decision immediately.
- `other` (malformed tool call) — an `Edit` call carried a stray top-level `"rm *"` parameter and a `newText` truncated mid-sentence, which silently swallowed the `#### Which key to actually write` heading in `docs/configuration.md` while reporting `Successfully replaced 2 block(s)`.
  `AGENTS.md`'s existing "count reported blocks against intended edits" check would not have caught it — two blocks were reported and two were intended.
  Impact: one corrupted doc region, self-caught by the immediately following `grep`, repaired in the next edit.
  No rework beyond that.
- `other` (environment) — diagnosing the flaky `test/authority/` failures took roughly six tool calls (two full-suite runs, one subset run, `uptime`, `ps`, a 60-second sleep, a re-run) before concluding it was host load rather than a regression.
  Impact: added friction, no rework; the conclusion was correct and the suite was green at lower load.
- `missing-context` — the first `redirect-analysis.test.ts` case asserted `{ effect: "unproven", source: "none" }` for `cat <> rw.txt`; `none` is not a member of the `EffectSource` union, and the real answer was `read`.
  Impact: one failed test run — but it is what surfaced [#814], so the cost was negative on net.
- `other` — the first Biome suppression comment was written across two lines, so the `biome-ignore` directive did not attach to the offending line.
  Impact: one extra lint round-trip.

#### What caused friction (user side)

- Nothing that cost the session time.
  Two interventions were strictly load-bearing:
  1. The `sudo` gate bounce supplied the reframing the gate should have contained — that a user rule (`bash: {"sudo *": "ask"}`) already owns the lever, which under the chosen verdict semantics is a complete answer.
     This turned a security-posture question into a documentation question.
  2. Choosing "New step in Phase 14" for [#814] over the recommended "defer to Phase 15" corrected a conservative default: the phase had just built the module the defect lives in, so fixing it there is cheaper than reopening the file next phase.
- Pattern worth noting across both: the agent's proposals defaulted to the more conservative option and the operator's judgment expanded them in both cases.

### Diagnostic details

- **Model-performance correlation** — attributed from inline `[provider/model]` labels in an unfiltered `read_session`, cross-checked against three `model_change` events.
  Planning and TDD implementation ran on `anthropic/claude-opus-5`; the ship stage ran on `anthropic/claude-sonnet-5`; this retro runs on `anthropic/claude-opus-5`.
  Both subagents (`tidy-first-assessor`, `pre-completion-reviewer` ×2) ran on `anthropic/claude-sonnet-5` per their frontmatter.
  No mismatch: judgment-heavy design work drew the stronger model, and the mechanical ship stage (push, CI watch, close, merge) drew the cheaper one.
  The notable data point is that the sonnet-5 reviewer found a defect the opus-5 implementer had written tests and docs around — evidence that the fresh-context dispatch is doing more work here than the model tier.
- **Escalation-delay tracking** — no sequence exceeded five consecutive tool calls on the same error.
  The flaky-test diagnosis (~6 calls) is the longest run, but each call tested a different hypothesis rather than retrying the same one, and it correctly terminated at "environmental".
- **Unused-tool detection** — `colgrep` was loaded per the `/plan-issue` prompt but never invoked; every exploration targeted a known symbol (`WRAPPER_SENTINEL`, `executedUnitOf`, `ARG_NODE_TYPES`), which the `colgrep` skill's own decision table assigns to `grep`.
  Not a miss.
  No `Explore` dispatch was warranted — the issue supplied a numbered source trace, which `AGENTS.md` explicitly exempts from the hunt-dispatch rule.
- **Feedback-loop gap analysis** — no gap.
  `pnpm run check` and a targeted `vitest run` ran inside every one of the seven TDD cycles, `pnpm run lint` at each commit boundary, and the full workspace suite plus `pnpm fallow dead-code` at cycle 3, cycle 5, and before each of the two reviewer dispatches.
  The one verification that ran late — the full suite after the final doc commit — is what surfaced the load-induced flakes, not a real defect.

### Changes made

1. `.pi/skills/code-design/SKILL.md` — added a "Shared predicate, different burden of proof" heuristic under Structural Design, generalizing this session's blocking defect: a classifier's `false` and a guard's `false` mean different things, and reusing one as the other turns every unrecognized shape into a silent pass.
   Placed beside "Structural reasons before extracting duplication", whose mirror image it is.
2. `.pi/skills/pre-completion/SKILL.md` — added a sentence to Step 2 requiring a re-derivation mandate when the change removes or narrows a guard, including the enumeration clause (the reviewer must enumerate its own candidate inputs rather than check the tested ones) that is what actually produced this session's finding.
3. `.pi/skills/package-pi-permission-system/SKILL.md` — added two lines to the Testing section identifying a `test/authority/` forwarding-liveness failure with an absurd reported duration as host load rather than a regression, beside the `ParentAuthorizer` polling guidance that causes it.
4. `AGENTS.md` — widened the clarification-gate rule at line 186 from "which component owns the lever" to "which component or config rule owns the lever", and added `#803` to its refs; the `sudo` gate's lever was a user config rule, which the component-only framing did not prompt for.

[#481]: https://github.com/gotgenes/pi-packages/issues/481
[#609]: https://github.com/gotgenes/pi-packages/issues/609
[#806]: https://github.com/gotgenes/pi-packages/issues/806
[#807]: https://github.com/gotgenes/pi-packages/issues/807
[#814]: https://github.com/gotgenes/pi-packages/issues/814
