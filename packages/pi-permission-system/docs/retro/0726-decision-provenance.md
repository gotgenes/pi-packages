---
issue: 726
issue_title: "pi-permission-system: permission decisions record no responder provenance — a human approval is indistinguishable from an auto-approval"
---

# Retro: #726 — permission decisions record no responder provenance

## Stage: Planning (2026-08-16T22:25:05Z)

### Session summary

Planned Phase 13 Step 6: a `DecisionSource` discriminated union (`decidedBy`) threaded from each decision site into the review log and across the forwarding wire.
Inventoried all twelve terminal decision sites and confirmed the issue's diagnosis — the ask path is where provenance is genuinely lost, because `composeAuthorizerChain` collapses a link decision, a human dialog decision, an absent-authority denial, and a relayed parent answer into the same `{approved, state, denialReason}`.
Plan committed at `packages/pi-permission-system/docs/plans/0726-decision-provenance.md` with nine red→green→commit cycles.

### Observations

- Two of the issue's three asks were already resolved or moot.
  The cross-ID-space join complaint was fixed by [#752] (the forwarding edge adopts the requester's `requestId`), and the `/permissions` history view it asks about does not exist — `/permission-system` is a config modal.
  Only the provenance half is real work.
- Operator decided at the clarification gate to **exclude** the `permissions:decision` bus event: consumers of the channel are not yet known, so widening it is premature.
  This narrows the roadmap's own Step 6 `Outcome:` line, which claims "every `permission_request.*` **and decision event** names its decider" — the plan lists correcting that line as a doc update.
- Operator chose **nested** forwarded provenance (`{kind:"forwarded", responderSessionId, decision}`) over a flat relay, and **self-contained** variants over lean ones.
  Self-contained is load-bearing rather than stylistic: `ForwardedPermissionResponse` has no `surface`/`pattern`/`origin` column, so a lean variant would lose which parent rule fired the moment it crossed the boundary.
- Measured rather than estimated, from the operator's live 7.44 MB review log: 9522 lines, 1432 terminal prompted decisions with no decider recorded, 5777 decision-bearing lines averaging 765 bytes.
  Predicted log growth is +7.4% worst case (a `rule` variant adds 95 bytes, a nested forwarded one 134) — set against the 28.7% [#746] removed.
- Confirmed by reading `log-field-cap.ts` and `log-redaction.ts` that both the width cap and the key-name mask **recurse** into nested objects, so a nested `decidedBy` needs no new bounding work.
  The plan pins this with a regression test rather than trusting the reading.
- The recursive tolerant guard is a fail-closed surface: `decidedBy` arrives off disk, so `asDecisionSource` is depth-bounded.
  Same class as [#752]'s filename-safety guard on an adopted request id — adoption is where an inbound value first gets to steer this process.
- Migration risk is concentrated in tests, not production: ~150 decision object literals across 19 test files plus 5 helpers.
  Many are `toEqual` assertions, which break as soon as production sets the field regardless of optionality — so the decomposition is per-producer (cycles 2–6) with the required-ness flip isolated to cycle 7, rather than optional-then-required as a blanket shield.
- Sequencing note for whoever picks this up: [#610] (Step 10) also enriches the review-log write path, and the roadmap says land Steps 6 and 10 in sequence.
  This lands first.

## Stage: Implementation — TDD (2026-08-17T01:47:50Z)

### Session summary

Landed all nine planned TDD cycles plus two Tidy-First preparatory commits (13 commits total).
`decidedBy` is now stamped at all twelve terminal decision sites and carried across the forwarding wire, required on `PermissionPromptDecision` and `GateBypass`.
Test count went 3010 → 3065 (+55) with `pnpm run check`, root `pnpm run lint`, and `pnpm fallow dead-code` all clean.

### Observations

- The `tidy-first-assessor` earned its keep by **rejecting** more than it recommended.
  It declined a blanket `test/helpers/` decision factory over the ~150 literals — correctly, on the grounds that most are `toEqual` **assertions** pinning the value under test, which no factory can supply, and that pre-collapsing them would be the large-blast-radius commit the plan's own Risks table mitigates via per-producer decomposition.
  It also declined a `GateBypass` builder (three sites sharing only `action: "allow"`) and a `PermissionGateParams` narrowing (already role-scoped).
  Its two Recommended commits both paid off: naming the chain links first made cycle 3 a two-line change, and defaulting the filler decisions in two helpers absorbed edits cycles 2 and 3 would otherwise have made by hand.
- One assessor claim needed checking rather than trusting: it described 12 call sites as "unexercised filler".
  Reading them showed a mix — in `permission-prompter.test.ts` line 83's test *subject* is that an approval logs `permission_request.approved`, so hiding the decision in a default would have harmed it.
  Adding the default and dropping the literal only at the genuinely-filler sites was the right resolution; a default parameter forces nothing.
- **Design decision not in the plan:** `UnattributedDecision` (`Omit<PermissionPromptDecision, "decidedBy">`).
  The plan sketched the dispatcher stamping `{kind:"user", via}` but did not name the type that makes it work under required-ness.
  This is the same shape `GateBypass.decision` uses for the request id (#752's "a gate keeps emitting only what it knows"), which is why it felt idiomatic rather than invented.
  It settles a real connascence question: having `reducePrompt` and `requestPermissionDecisionFromUi` each name their own surface would be two sites that must agree with the dispatcher's `mode === "tui"` branch.
- **Deviation from the plan (minor):** the plan's cycle-5 sketch had the bash bypasses carrying a session pattern.
  They cannot — a whole-command bypass covers many tokens at once, each possibly matched by a different session grant, so one pattern would be a guess.
  They record the surface with `pattern: null`, and the entry's existing `tokens`/`externalPaths` lists what was covered.
- Cycle 8 was a **characterization** cycle, not a feature one: two of its three tests passed on first run, because `capLogFieldWidths` already recursed and the redaction replacer descends by nature.
  The plan predicted this correctly ("pins it rather than trusting the reading"), and `test:` was the right commit type.
  The one failure was my own expectation being wrong — at width 10 the cap also shortened `name: "model-judge"`, which is correct behavior.
- The scripted test migration in the required-ness flip is the risk the AGENTS.md scripted-substitution warning describes, and it did misfire twice: it added `decidedBy` to an assertion over `presentInlinePermissionPrompt` (deliberately unattributed) and missed a bypass log assertion.
  Both were caught by `toEqual`'s exactness within one run — the exact-assertion convention is what made a scripted edit safe to attempt at all.
  The reviewer re-read every `test/` hunk and found no further slips.
- Two `Edit` calls failed on a wrong absolute path (`pi/pi-permission-system/...` instead of `pi/pi-packages/packages/pi-permission-system/...`) and were correctly blocked by the `external_directory` gate — the package's own gate catching a path mistake in a change to that package.
- Anchoring an `Edit` on a decorative `─` rule line failed as AGENTS.md warns; re-anchoring on the adjacent unique `describe(...)` line worked first time.

## Stage: Final Retrospective (2026-08-17T02:04:27Z)

### Session summary

Planning, TDD implementation, and ship all ran in a **single** session rather than the documented one-stage-per-session flow.
Shipped `pi-permission-system` v26.1.0 (Phase 13 Step 6): a `DecisionSource` union stamped at all twelve terminal decision sites and carried across the forwarding wire, in 13 commits with test count 3010 → 3065.
The pre-completion reviewer returned PASS with no fix-required findings.

### Observations

#### What went well

- The `tidy-first-assessor`'s **rejections** were its most valuable output, which is novel — prior retros have credited what it recommends.
  It declined a blanket decision-factory over the ~150 test literals on the grounds that most are `toEqual` **assertions** pinning the value under test (which no factory can supply), and that pre-collapsing them would be exactly the large-blast-radius commit the plan's own Risks table mitigates.
  A recommendation-only reading of that report would have produced a worse change.
- A design element absent from the plan emerged cleanly during implementation: `UnattributedDecision` (`Omit<PermissionPromptDecision, "decidedBy">`).
  It felt idiomatic rather than invented because `GateBypass.decision` already used the identical shape for the request id, recorded in the [#752] `Landed:` note.
  The architecture doc's landed-notes discipline paid off as a source of reusable patterns, not just history.
- Convergent iteration on the required-ness flip was not a rabbit hole: the `tsc` error count fell monotonically 52 → 16 → 11 → 8 → 1 → 0 across six tool calls, each targeting a strictly smaller residue.
  Worth distinguishing from the >5-call escalation signal, which is about *repeated* failure on the same error.
- The package's own `external_directory` gate blocked two malformed `Edit` paths in a change to that same package — the system under test catching a real mistake in its own development.

#### What caused friction (agent side)

- `other` — two `Edit` calls were issued with a hand-built absolute path missing the `pi-packages/packages/` segment (`/Users/chris/development/pi/pi-permission-system/test/authority/permission-prompter.test.ts`).
  Both were denied by the `external_directory` gate.
  Impact: two wasted tool calls, no rework.
  Every other file tool call in the session used a repo-relative path and none failed.
- `wrong-abstraction` — the bulk test migration in `9f39b1a9` used a Python script to insert `decidedBy: DECIDED_BY_HUMAN` across ~16 files.
  The script was line-oriented and safe from the regex boundary-spanning corruption `AGENTS.md` already warns about, but it could not tell a **mock producer** from an **assertion**, and misfired twice: it attributed a `presentInlinePermissionPrompt` assertion that must stay unattributed, and left a bypass log assertion unextended.
  Impact: two extra fix cycles inside one TDD step; no commit rework, because `toEqual`'s exactness turned both into immediate red.
  The safety property was the project's exact-assertion convention, not anything about the script.
- `missing-context` — red expectations were written before checking the fixture defaults they depend on, twice producing a red that failed for the wrong reason: `makeCheckResult({state: "allow"})` defaults to `origin: "builtin"` with no `matchedPattern` (expected `"global"`/`"*"`), and a `reviewLogFieldMaxWidth` of 10 also truncates `name: "model-judge"` (11 chars), not only the intended long field.
  Impact: ~4 extra tool calls across cycles 5, 6, and 8.
  Both fixes improved the tests — the forwarded-server case now sets explicit pattern/origin values rather than relying on defaults.
- `instruction-violation` (self-identified) — the first `read_session` call in this stage used `types: ["model_change"]`, which the `/retro` prompt explicitly forbids for model attribution ([#737]); it returned three phantom switches all naming the same model.
  Impact: one wasted tool call; the unfiltered read followed immediately.
  Notable only because the rule exists *because of* a prior retro and still did not fire preemptively.
- `instruction-violation` (self-identified) — an `Edit` anchored on a decorative `─` rule line failed, as `AGENTS.md` warns.
  Impact: one wasted tool call; re-anchoring on the adjacent unique `describe(...)` line worked first time.

#### What caused friction (user side)

- Nothing to flag.
  The one clarification gate carried three genuinely open decisions and all three answers changed the design: excluding the bus event narrowed the scope (and required correcting the roadmap's own `Outcome:` line, which overclaimed), nesting shaped the recursive type, and self-contained variants are what let the record survive the forwarding hop.
  The two follow-up questions attached to those answers ("how does this work in TypeScript?", "explain the duplication") were the highest-leverage intervention in the session — answering them surfaced the concrete duplication table and the named deprecation path, both of which went into the plan.

### Diagnostic details

- **Model-performance correlation** — the whole session ran on `anthropic/claude-opus-5` (verified from inline `[provider/model]` labels in an unfiltered `read_session`).
  Both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) ran on their frontmatter default `anthropic/claude-sonnet-5`.
  No mismatch: both did judgment-heavy read-only work well within sonnet's range, and the reviewer independently traced all twelve decision sites, the depth bound, and every `test/` hunk of the scripted migration.
- **Escalation-delay tracking** — no `rabbit-hole` friction points.
  The longest single-error sequence (six calls on the cycle-7 `tsc` residue) was monotonically convergent and is not the pattern the >5-call signal targets.
- **Unused-tool detection** — `colgrep` was never used; all exploration was `grep` plus targeted `read`.
  Defensible here because the decision sites are enumerable by review-log event name (`permission_request.` / `forwarded_permission.`), which is an exact-match problem.
  No dispatch was warranted for either friction point above.
- **Feedback-loop gap analysis** — no gap.
  `pnpm run check` plus the package suite ran after every one of the nine cycles; root `pnpm run lint` ran at cycles 1, 5, 7, and completion; `pnpm fallow dead-code` at baseline and completion.
  The 18 Biome formatting findings the Python script introduced surfaced at cycle 7's own gate, not at the end.

### Changes made

1. `AGENTS.md` § Edit tool batches — added the scripted-bulk-test-edit rule beside the existing `perl -0777` regex-corruption rule: a script cannot tell a mock producer from an assertion, so correctness rests on the suite, and only exact assertions (`toEqual`/`toHaveBeenCalledWith`) provide that; a touched `toMatchObject`/`objectContaining` site must be re-read by hand.
2. `AGENTS.md` § Shell and search — added the repo-relative file-tool-path rule.
3. `.pi/skills/tidy-first/SKILL.md` Step 3 — added that a **Rejected** item's reasoning should be read, since one contradicting the plan is a signal to re-examine the plan.

Considered and not landed: a rule about checking fixture defaults before writing red expectations (self-correcting, ~4 tool calls), louder emphasis on the unfiltered `read_session` rule ([#737] — self-corrected within one call), a `colgrep` nudge (grep was correct for an exact-match enumeration), and anything about running all stages in one session (operator's choice, and it worked).

[#610]: https://github.com/gotgenes/pi-packages/issues/610
[#737]: https://github.com/gotgenes/pi-packages/issues/737
[#746]: https://github.com/gotgenes/pi-packages/issues/746
[#752]: https://github.com/gotgenes/pi-packages/issues/752
