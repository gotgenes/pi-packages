---
issue: 721
issue_title: "pi-permission-system: liveness detection for out-of-process forwarded permission requests"
---

# Retro: #721 — pi-permission-system: liveness detection for out-of-process forwarded permission requests

## Stage: Planning (2026-08-17T03:23:21Z)

### Session summary

Planned Phase 13 Step 5: a filesystem serving heartbeat (`<forwardingDir>/serving/<encoded-session-id>.json`) that lets an out-of-process forwarding child tell "a human is deliberating" from "nobody is home," so it abandons in ~2 s instead of burning the full 600 s `forwardingTimeoutMs`.
The clarification gate settled three parameters the issue left open: **serving heartbeat only** (no per-request claim artifact), **absence of a record means not serving** (fast-fail, accepting the upgrade-window skew cost), and **constants only, no new config field**.
Seven TDD steps, three of them `refactor:` for the module nothing imports yet, then `feat:` for publishing the heartbeat, `fix:` for the child's fast-fail, a composition-root test, and the docs commit carrying the roadmap `✅`.

### Observations

- **The parking condition had already been met, and the roadmap knew it.**
  The issue says "not worth building until someone reports the stall on a process-based subagent extension." [#735] is that report — a detached `pi-subagents` run forwarding to a parent that exited the previous day, with review-log evidence and a measured 30+ minutes per child.
  `docs/architecture/architecture.md` had already adopted both as Phase 13 Step 5 with `Release: independent` and prescribed the module name `src/authority/forwarding-liveness.ts` (a health-metric row greps for it).
  So the direction was settled before planning started, and the gate could spend its whole budget on mechanism rather than on "whether."
- **The claim artifact is worse than the issue text suggests, and the code is what shows it.**
  `ForwardedRequestServer.processInbox` drains **serially**, awaiting each escalation.
  While a human deliberates on request A, request B sits unclaimed in the same directory for minutes — so a naive claim falsely abandons it.
  Batch-claiming at scan time fixes that but degrades the artifact's meaning to "the loop saw you," and it still adds a third per-request file inside the tree whose removal ordering already produced the [#398] ENOENT write loop.
  That argument came from reading `processInbox`, not from the issue's framing, and it is what made the heartbeat the clear pick.
- **The heartbeat's placement is load-bearing.**
  A sibling `serving/` directory rather than a file inside `sessions/<id>/`, because `cleanupPermissionForwardingLocationIfEmpty` removes the session root when empty and a heartbeat there would entangle liveness with the [#398] ordering.
  For the same reason the `serving/` directory is created on demand and **never removed** — deleting it reintroduces exactly that race.
- **The sharpest correctness detail is the refresh's position relative to the `processing` guard.**
  `ForwardingManager`'s interval callback early-returns while `processing` is true, which is precisely the state a parent occupies while a human deliberates at the forwarded dialog — for as long as they take.
  A refresh after that guard would let the heartbeat go stale exactly when the parent is most demonstrably alive, and every other child would fast-fail against it.
  The plan puts the refresh first and pins it with a dedicated test in step 4; it is flagged as the one test that must not be dropped.
- **The provenance seam [#719] built paid off immediately.**
  `resolvePermissionForwardingTarget` already returns `{ sessionId, source }`, so the second channel did not need a new discriminator.
  Rather than giving `ParentAuthorizer` two lookups and a three-way branch, the plan introduces one target-keyed seam (`TargetServingLookup`) that owns the dispatch, and `checkServingLiveness` collapses to a single question with no provenance branch.
- **`markServing` doubling as the refresh avoided widening the seam.**
  The alternative was a third `refreshServing` method on `ServingAnnouncer`, which `ServingSessionRegistry` would implement as a no-op (an in-memory mark does not decay).
  Since `markServing` is already idempotent by contract and the heartbeat store can throttle internally, the two-method seam survives unchanged and only `index.ts` composition changes.
- **Rejected: treating absence as "not judgeable."**
  That is the skew-proof direction and mirrors [#719]'s stale-mark rule, but a cleanly exited parent leaves no record at all — so it would have delivered almost nothing for [#735] scenario 1, the exact reported case.
  The operator took the skew cost knowingly; the mitigation is an upgrade-the-parent-first note in `docs/subagent-integration.md`, mirroring [#745]'s ordering guidance, not a `docs/migration/` file, since nothing requires a user edit.
- **Doc greps found four stale rows, two of which no symbol grep would have caught.**
  `docs/subagent-integration.md` lines 71–72 state the liveness signal is process-local and out-of-process children still wait the full timeout — prose this change makes false with no removed symbol to match.
  `docs/configuration.md` line 106 and `.pi/skills/package-pi-permission-system/SKILL.md` line 64 carry the same in-process-only claim.
  The `in-process|out-of-process|process-local` sweep across docs, README, and the skills tree was the right instrument.
- **No follow-up issues filed.**
  The operator chose "heartbeat only" rather than "heartbeat now, claim as a follow-up," and the claim needs [#722]'s diagnosis before it is more than speculation.
  Both open questions in the plan are conditional on future evidence, so nothing was filed.

## Stage: Implementation — TDD (2026-08-17T04:19:34Z)

### Session summary

Landed all seven planned TDD steps in order with no preparatory commits — the Tidy-First assessor found nothing warranted, judging the plan's own step 1–3 (build the isolated module) / 4–5 (wire it in) split to already be the tidy-first move.
The `pi-permission-system` suite grew from 3065 to 3123 tests (+58) across 142 → 143 files.
All deterministic gates stayed green throughout: `check`, root `lint` (0 findings), full workspace `test`, and `fallow dead-code`.

### Observations

- **Pre-completion reviewer: PASS** — ready for `/ship-issue`, with no warnings.
  It independently traced the highest-risk invariant rather than accepting proximity as proof: it confirmed the refresh-ahead-of-the-guard test stubs `processInbox` to never resolve and asserts three `markServing` calls over 750 ms, so moving the refresh behind the guard would fail it.
- **A plan test got rejected during Red, which is the point of writing it first.**
  Step 1's planned "rewrites when the record was removed underneath it" implied an `existsSync` probe on the throttle path — a syscall on every poll tick to save at most one refresh window.
  Dropping it and asserting the bounded self-healing instead ("republishes at the next refresh boundary") matches the argument the plan already makes for pid-reuse pruning, and the 1 s window sits inside the 2 s grace so no child can abandon in it.
- **The two new composition-root tests passed on first run, as the plan predicted.**
  That is only reassuring because they are mutually discriminating: identical setup except for the `publishServingHeartbeat` call, one blocking with the not-serving reason and one still waiting when the parent answers.
  Either alone would have been weak evidence.
- **`makeLivenessJudge` wires the real judge over real records rather than a fake.**
  What the liveness tests are about is *which channel answers for which target*, and a hand-written double is free to disagree with exactly the routing under test.
- **Deviation: `test/authority/authorizer.test.ts` was listed in the plan but never touched.**
  It reaches `AuthorizerSelectionDeps` only through `makeAuthorizerSelectionDeps`, so the shared fixture absorbed the `servingRegistry` → `serving` rename entirely.
  The reviewer confirmed no coverage gap.
- **Deviation: `test/authority/serving-registry.test.ts` was touched but not listed.**
  The plan's module table said "add `composeServingAnnouncers`" without naming its test file; the fan-out/clear/no-channels cases landed there.
- **Two self-inflicted `Edit` failures, both rules `AGENTS.md` already states.**
  One batch was rejected because I retyped a test block's wrapping from memory instead of the file (`makeManager(serving).start(...)` had been reflowed across three lines).
  Twice I emitted an ignored `oldText2`/`newText2` key inside an `edits[]` entry — silently dropped, and only the reported block count proves nothing was lost.
  Counting reported blocks against intended edits caught it both times.
- **`vi` was missing from `serving-registry.test.ts`'s imports**, which surfaced as two failures only when that file ran alone — the combined run's summary attributed them ambiguously.
  Running the single file was what localized it.
- **The Biome/ESLint assertion loop fired once**, on a `record as ServingHeartbeat` in a `.filter().map()` chain.
  Restructuring to a `for...of` with an explicit guard removed the assertion rather than trading it for a `!`, per the documented fix.
- **A version number nearly shipped into the docs.**
  The upgrade-ordering note first named "older than 25.2.0"; the package is at 26.1.0 and release-please owns the next number, so the claim was unverifiable at write time.
  Rewritten to describe the condition ("a version that predates the heartbeat") rather than assert a number.
- **The `[#398]` and `[#719]` reference definitions were missing** from `architecture.md` after the `Landed:` note cited them — caught by grepping for the definitions rather than trusting `rumdl`, which flags unused definitions but not undefined references.

## Stage: Final Retrospective (2026-08-17T15:37:28Z)

### Session summary

One continuous session carried #721 from a parked enhancement through planning, seven TDD steps, and a clean ship to `@gotgenes/pi-permission-system@26.2.0`.
The shipped change gives an out-of-process subagent a filesystem serving heartbeat to read, so a child forwarding to a parent that has exited abandons in ~2 s with a truthful reason instead of burning the full ten-minute timeout — resolving [#735] scenario 1.
The suite grew 3065 → 3123 tests (+58); the user issued four slash commands and made zero corrections across the whole session.

### Observations

#### What went well

- **The parking condition was checked instead of assumed.**
  The issue's own last line says "not worth building until someone reports the stall on a process-based subagent extension."
  Rather than treating the `/plan-issue` invocation as implicit override, planning swept open issues and found [#735] — filed by a third party three weeks later, with review-log evidence, describing exactly that scenario.
  The roadmap had already adopted both as Phase 13 Step 5, so the direction was settled before planning began and the whole `ask_user` budget went to *mechanism* rather than *whether*.
- **A design argument came from the code, not the issue's framing.**
  [#721] presented claim artifact and serving heartbeat as roughly symmetric candidates.
  Reading `ForwardedRequestServer.processInbox` showed it drains **serially**, awaiting each escalation — so a per-request claim leaves a second request unclaimed for as long as a human deliberates on the first, and batch-claiming degrades the artifact to "the loop saw you."
  That constraint, absent from the issue, is what made the choice one-sided; it held up unchanged through implementation.
- **Writing the test first killed a test the plan had specified.**
  Step 1's planned "rewrites when the record was removed underneath it" implied an `existsSync` probe on the throttle path — a syscall on every poll tick to buy at most one refresh window.
  Replacing it with "republishes at the next refresh boundary" matches the argument the plan already made for pid-reuse pruning, and the 1 s gap sits inside the 2 s grace so no child can abandon in it.
  Test-Driven **Design** working as intended: the plan was slightly wrong and Red is where that surfaced.
- **The two composition-root tests were built to be mutually discriminating.**
  Both passed on first run, which is normally weak evidence.
  They earn it by differing in exactly one thing — whether `publishServingHeartbeat` was called — with one blocking on the not-serving reason and the other still waiting when the parent answers.
  Either alone would have proved little.
- **The pre-completion reviewer verified the invariant instead of locating it.**
  Asked to confirm the refresh-ahead-of-the-`processing`-guard test, it traced that `processInbox` is stubbed to never resolve and that three `markServing` calls are asserted over 750 ms — concluding the test would fail if the refresh moved behind the guard.
  That is the second consecutive issue where the reviewer distinguished "a test exists near this code" from "this test pins this behavior."
- **Deliberately reversing a shipped invariant was tracked as such.**
  [#719] established that an `env`-resolved target is never fast-failed; this change reverses it by design.
  It was named in the plan's "Invariants at risk", carried into the `fix:` commit body, recorded in the roadmap's `Landed:` note, and put to the operator at the clarification gate with its cost stated — rather than quietly overwritten.

#### What caused friction (agent side)

- `instruction-violation` (self-identified) — emitted `oldText2`/`newText2` keys inside a single `edits[]` entry **twice** (`test/authority/forwarding-manager.test.ts`, `test/helpers/forwarding-fixtures.ts`).
  `AGENTS.md` states the rule and its detection method explicitly.
  Impact: none — counting reported blocks against intended edits caught both, and the first batch was atomically rejected for an unrelated reason anyway.
  A salience miss against a crisp existing rule, not a documentation gap.
- `instruction-violation` (self-identified) — opened the retro's model-performance lens with a `types: ["model_change"]`-filtered `read_session`, which the `/retro` prompt warns against by name (Refs [#737]), in the same paragraph that prescribes the alternative.
  Impact: one wasted call, corrected on the next turn.
- `instruction-violation` (self-identified) — built an `Edit` `oldText` for `forwarding-manager.test.ts` from remembered layout rather than a fresh `Read`; `pi-autoformat` had wrapped `makeManager(serving).start(...)` across three lines.
  `AGENTS.md` states this directly.
  Impact: one atomically-rejected batch, one extra `Read`.
- `other` (over-filtered tool output) — a two-file vitest run reported `2 failed` with no detail because the command piped through `grep -E "Tests |Test Files |✕"`.
  The two follow-up attempts to extract the error (`grep -A12 "Failed Tests"`, then `sed -n '/FAIL\|AssertionError\|expected/p'`) each matched **nothing** and printed empty output, making it look like there was no failure to find.
  Running each file alone with an unfiltered `tail -40` located it immediately: `vi` was missing from `serving-registry.test.ts`'s imports.
  Impact: 3 extra tool calls, no rework.
- `other` (near-miss, caught pre-commit) — the upgrade-ordering note in `docs/subagent-integration.md` was first written as "older than 25.2.0."
  The package was at 26.1.0 and release-please assigns the next number at merge, so the claim was unverifiable at write time.
  Rewritten to describe the condition ("a version that predates the heartbeat").
  Impact: none — caught by checking `package.json` before committing, but only because the number felt worth checking.
- `other` (minor) — verified `git rev-parse` output length with `wc -c` twice during the ship, after already using the tool the prompt prescribes.
  Impact: 2 redundant calls; belt-and-braces against a rule about *hand-typed* SHAs that `git rev-parse` already satisfies.

#### What caused friction (user side)

- None to report.
  Four slash commands, zero corrections, and the single `ask_user` gate resolved mechanism, absence-semantics, and config surface in one round — answers that drove the plan's Goals directly and survived implementation unchanged.
- One opportunity, framed as such: the operator's roadmap had already adopted [#721] as Phase 13 Step 5 and pre-named the target module `forwarding-liveness.ts`, but the issue body still read "this is parked rather than scheduled."
  Planning reconciled the two by reading the roadmap, which cost a few calls.
  A one-line edit to a parked issue when its roadmap step is adopted would remove that reconciliation step for any future session that opens the issue first.

### Diagnostic details

- **Model-performance correlation** — no mismatch found.
  Turn labels from an unfiltered `read_session`: `claude-opus-5` for planning and TDD (judgment-heavy — mechanism trade-off, invariant reversal, test design), `claude-sonnet-5` for the entire ship sequence (deterministic and tool-driven, 25 turns with zero corrections), `claude-opus-5` for the retro.
  Both subagents ran `anthropic/claude-sonnet-5` per their frontmatter: `tidy-first-assessor` (19 tool uses) and `pre-completion-reviewer` (37 tool uses), both judgment-heavy and both returning substantive reports.
  This is the same allocation #719 arrived at and reached again without prompting.
- **Escalation-delay tracking** — nothing to flag.
  The longest run on a single unresolved question was the 5-call vitest-failure hunt above, at the threshold rather than over it, and it ended by changing approach (run the file alone, unfiltered) rather than by persisting.
  Notably the planning stage ran no root-cause hunt at all — the contrast with #719's ~30-call inline hunt is that this issue's cause was already established by its predecessor.
- **Unused-tool detection** — no gap.
  The `tidy-first-assessor` was dispatched and correctly reported nothing warranted, judging the plan's own step 1–3 / 4–5 split to already be the tidy-first move.
  Every search this session targeted an exact symbol or literal string, where `grep` is the right tool per the `colgrep` skill's decision table, so `colgrep`'s absence is not a miss.
- **Feedback-loop gap analysis** — no gap.
  `pnpm run check` and the cycle-scoped test file ran after every Red and every Green; the full package suite ran before each commit; root `pnpm run lint` and `pnpm fallow dead-code` ran at the green baseline, after the type-changing step 5, before the docs commit, and again as pre-push checks.
  The one type error introduced (the `servingRegistry` → `serving` rename reaching `authorizer-fixtures.ts`) surfaced on the `check` immediately after that step rather than at end-of-cycle.

### Changes made

1. `.pi/skills/testing/SKILL.md` — added a "Running tests" bullet: re-run a failing file alone and read the unfiltered `tail`, because a `grep`/`sed` filter over Vitest output often matches nothing and prints empty, which reads as "no failure" rather than "wrong filter."
   Backed by the 3 wasted calls above; placed beside the existing bullet about Vitest hiding a spike test's `console.log`, since both are about Vitest output being filtered into uselessness.
2. `AGENTS.md` § Commits — added a rule against naming an unreleased version in docs, immediately after the `CHANGELOG.md` line that already owns the release-please boundary.

Deliberately not landed: nothing for the three `instruction-violation`s or the `/retro` `model_change` misread — all four rules already exist, are already one crisp sentence with a `Refs`, and their prescribed detection methods worked.
Those were salience misses, which more text does not fix.
Also declined: a rule against over-verifying SHAs (the instinct is the one the prompt wants) and any rule promoting the Test-Driven Design win (rejecting a planned test that buys the wrong thing is what Red is for).

[#398]: https://github.com/gotgenes/pi-packages/issues/398
[#719]: https://github.com/gotgenes/pi-packages/issues/719
[#721]: https://github.com/gotgenes/pi-packages/issues/721
[#722]: https://github.com/gotgenes/pi-packages/issues/722
[#735]: https://github.com/gotgenes/pi-packages/issues/735
[#737]: https://github.com/gotgenes/pi-packages/issues/737
[#745]: https://github.com/gotgenes/pi-packages/issues/745
