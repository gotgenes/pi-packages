---
issue: 898
issue_title: "pi-subagents: a failed compaction attempt hides the turn error it stripped, so the run reports success"
---

# Retro: #898 — pi-subagents: a failed compaction attempt hides the turn error it stripped, so the run reports success

## Stage: Planning (2026-09-07T19:31:15Z)

### Session summary

Answered the issue's own open question against the pinned SDK (`@earendil-works/pi-coding-agent@0.84.4`) — whether `compaction_end` / `_emitSessionCompactFailed` fire on Case 1's own failure — and found the answer decisive enough to displace both candidate mechanisms the issue named.
Settled the design at an `ask_user` gate, ran the Tidy-First assessor (which found a fixture hazard that would have reddened three tests for the wrong reason), and committed `docs/plans/0898-report-compaction-erased-turn-failure.md` — a four-step plan replacing the `session.messages` scan with a live `message_end` recorder.
The issue is Phase 22 Step 19, `Release: independent`, landing as `fix:`.

### Observations

#### The issue's first question had a "no" answer, and that decided the design

The issue named two candidate signals (`compaction_end`, `_emitSessionCompactFailed`) and correctly flagged that whether either fires on Case 1's stripping path was unverified.
It does — on **three** of the six exits from `_runAutoCompaction`, one of which carries no `errorMessage`.
The other three emit nothing at all, and one of those is the exit a subagent most plausibly takes: `prepareCompaction` returns `undefined` when there is nothing left to summarize, which is exactly a child whose spawn prompt alone overflows the window on its first LLM call — the [#889] reported shape.
Two further limits sealed it: `reason: "overflow"` cannot separate the stripping Case 1 from the non-stripping Case 2, and a failed threshold compaction strips nothing and must not fail a run.

The general lesson is the AGENTS.md one about roadmap `Target:` lists, applied to an issue body: the mechanism the author saw while reading is a lead, not a census of the exits.
Reading all six exits rather than the one the narrative described is what produced a different design.

#### The alternative was already in the file

`subagent-session.ts` already collects the turn's **text** live from the event stream (`collectResponseText`), while [#889]'s failure read reconstructed the turn's **outcome** from state afterwards.
Once that asymmetry is named the fix is obvious: collect the failure the same way, from `message_end`, which Pi emits before `_handlePostAgentRun` runs any compaction.
It covers all six compaction exits, plus a third stripping door I found in `_prepareRetry` (unreachable for this package today, since nothing here calls `abortRetry()`), and it stops depending on who owns `agent.state.messages` at read time.

#### Checking upstream `main` was the operator's call, and it mattered

I was ready to gate on the pinned SDK alone; the operator asked whether the latest Pi source should be checked first.
It should have been — `../../pi` is at `0.85.1`, and confirming the strip, the silent exit, and the `message_end` ordering are all unchanged there is what makes "no upstream fix is coming" a verified claim rather than an assumption.
Worth internalizing: when a design turns on a dependency's internals, "confirm the API exists in the installed version" and "check whether the mechanism has since changed upstream" are two separate reads, and the second is cheap.

#### The assessor found a hazard no amount of design review would have

The preparatory fixture change — make the failure fixtures emit `message_end` alongside the push — looks behavior-preserving.
It is not, in `subagent.test.ts`: `subscribeSubagentObserver` reads `event.message.usage.input` with **no guard** (a defensive test for the missing-usage case was deliberately removed in `docs/retro/0188-replace-any-casts-with-sdk-types.md`), and `Subagent.start()` wires that observer over the same mock session before driving the turn loop.
A synthesized `message_end` without `usage` throws a `TypeError` inside `session.prompt()` itself, so three tests would have gone red carrying the TypeError's message instead of the provider's.
The fix is one field, but the diagnosis is not one an implementing session would have reached quickly from a red suite.

The assessor also corrected my file list in the other direction: `createSession`'s default `prompt` and `programTurns` do **not** need instrumenting, because neither pushes a message carrying `stopReason: "error"` and the collector's un-signaled default is already "no failure".

#### Design gate

Two questions, both recommendations adopted.
The mechanism: a live recorder **replacing** the scan, rather than layered as a fallback over it — the fallback branch would be reachable only from fixtures, since production emits at least one assistant `message_end` per `prompt()` on every path that reaches the read.
The predicate: keep `"error"` only.
Case 1 also strips a truncated response (`stopReason: "length"`), and an unrescued truncation still reports as a completion; declined because a truncated answer carries the child's real text, so failing it would mean inventing an error string and discarding that work.
Recorded as a Non-Goal by explicit decision rather than filed as a follow-up.

#### The migration's own safeguard

The migrated fixtures push **and** emit, which is deliberate.
It makes Step 3's first killing mutation — restore the deleted scan — leave all six [#889] cases green while the three new strip cases go red.
That green-stays-green half is the evidence that the preparatory step did not quietly weaken the coverage it rewrote, which is otherwise the main risk of rewriting fixtures a prior issue just landed.

#### Deferred tidyings

- `packages/pi-subagents/test/lifecycle/subagent-session.test.ts` — the assessor offered converging the file's local `createSession()` stub onto the shared `createMockSession()` helper, the way `createFactorySession()` in `test/helpers/subagent-session-io.ts` already does.
  The two stubs are near-duplicates.
  Declined as out of scope: it is a 15–20-call-site rewrite across the whole file, including the manual listener iteration in the `text_delta` test and the `calls` teardown-order array four dispose tests depend on, where the plan's small generic-`emit` addition solves the actual blocking need in a few lines.

#### For the implementing session

- The `usage` field on every synthesized `message_end` is not polish; see the hazard above.
  Use `{ input: 0, output: 0, cacheWrite: 0 }`, which is what the real `handleRunFailure` sets (`EMPTY_USAGE`).
- The `||` in `errorMessage || PROVIDER_ERROR_WITHOUT_MESSAGE` carries the same `@typescript-eslint/prefer-nullish-coalescing` disable [#889] established, for the same reason: `handleRunFailure` sets `errorMessage: error.message`, which is `""` for a bare `new Error()`.
- The collector must copy the two scalars at event time.
  `AgentSession._replaceMessageInPlace` deletes and reassigns the target's keys, so a retained message reference would report whatever the message later became.
- Last-one-wins, never latched.
  A successful auto-retry emits a later clean `message_end`, and latching would report a recovered run as a failure.
- Step 3 is one commit for both turn loops: `failIfProviderErrored`'s signature changes at both call sites and the type checker will not accept them apart.

## Stage: Implementation — TDD (2026-09-07T23:52:44Z)

### Session summary

Executed the plan's four steps as separate commits, then two more from three rounds of pre-completion review that between them relocated the fix's central mechanism.
The `pi-subagents` suite went from 1628 to 1636 tests (+8).
The failure read moved from a post-run scan of `session.messages` to a collector the `SubagentSession` owns for its whole life, seeded from history at construction and updated from `message_end` as the session emits it.

### Observations

#### The plan's mutation predictions were exact

All three of Step 3's named mutations matched their predictions to the test.
Restoring the deleted scan reddened exactly the three new strip cases and left every [#889] case green — the green-stays-green half that was the point, since it is the evidence that Step 2's fixture migration did not weaken the coverage it rewrote.
The latch mutation reddened two, one of which had stayed green through Red; that is the case where the mutation is the *only* evidence the test discriminates.
Deleting the resume call site reddened four, all resume-path.

#### The assessor's `usage` hazard was real, and I measured it rather than trusting it

Removing the `usage` field from the emitted `message_end` in `subagent.test.ts` turns exactly three tests red with a `TypeError` from `subscribeSubagentObserver`'s unguarded `event.message.usage.input`.
That is a fixture defect that would have read as a failure of the mechanism under test.
The measurement cost one command and is recorded in the commit body.

#### Two review rounds moved the mechanism, and the second one moved it again

This is the substantive story of the session.
The plan's design — a per-call collector replacing the scan — was wrong in a way neither the plan, the Tidy-First assessment, nor any of my mutations could see, because all of them assumed at least one `message_end` per `prompt()` call.

Round 1 found the first hole: `AgentSession.prompt()` has three early returns that resolve **without running a turn** (an extension command matched, an `input` handler returned `{ action: "handled" }`, the message was queued while streaming), and `Subagent.resumeRefusal` does not refuse an agent whose earlier run errored.
So a resume could observe nothing and report the errored session as a completion.
The plan had asserted the opposite in as many words — "production emits at least one assistant `message_end` per `prompt()` on every path that reaches the read" — and used it to decline a fallback.
`pi-permission-system` returns `{ action: "handled" }` from exactly this path when its skill-input gate denies a `/skill:<name>` prompt, so the trigger is a standard prompt syntax, not a contrivance.

Round 2 found that the adopted fix — seeding the per-call collector from `session.messages` — did not close it: the failure an earlier call observed may be exactly the one Pi's overflow recovery stripped from that history.
I checked that finding against the pre-#898 code before escalating it and established it was **not** a regression — the deleted scan was equally blind — which is what turned the question from "fix a regression" into a scope decision for the operator.

The adopted answer relocates the state: the collector is a `private readonly` field on `SubagentSession`, constructed once, seeded from history at that moment, unsubscribed in `dispose()`.
That is a better design than the plan's on its own terms — how the last turn ended is a property of the session, not of each call — and it is the shape the plan would have reached had it enumerated `prompt()`'s early returns.

#### The lesson worth carrying

The plan verified, thoroughly, what the SDK does when a turn **runs**: six exits from `_runAutoCompaction`, the `message_end` ordering, `_prepareRetry`, `_replaceMessageInPlace`.
It never asked what `prompt()` does when a turn does **not** run.
A design that replaces a guard's evidence source has two questions to answer, and I answered only the first: what the new source sees that the old one missed, and what the old source saw that the new one misses.
The second is where both failures lived.

#### A test that pinned nothing

Round 3 passed but noted that the local session stub's `subscribe` returned a static no-op, so deleting the `dispose()` unsubscribe reddened nothing.
Closed it rather than deferring: the stub's remover is now real, and a test asserts the subscription is gone after teardown (mutation-verified — deleting the line turns it red).
A line that no mutation can kill is unpinned however new it is.

#### Deviations from the plan

- Step 3's planned test "an errored `message_end` followed by a clean one resolves" was already covered once Step 2 made the pre-existing [#889] case event-driven.
  Rather than duplicate it I added a distinct case modelling the real recovery sequence: the error emitted, its message absent from history, then a clean message.
  The reviewer judged the substitution sound.
- Two commits beyond the plan's four, both review-driven, both closing holes the plan's own premise had ruled out.
- The architecture `Landed:` note was rewritten twice as the mechanism moved; it now describes the session-lifetime collector rather than the per-call one the plan specified.

#### Pre-completion review

Three rounds: FAIL, FAIL, **PASS**.
Both FAILs were legitimate and both were fixed rather than argued down.
Round 3's non-blocking notes, recorded rather than actioned:

- A resume aborted mid-flight after an earlier failed turn reports the stale prior error rather than a clean cancellation.
  Pre-existing and identical under every design considered here; not a regression from this change.
- No test pins `stopReason: "length"` by name.
  It falls to the same branch as `"aborted"` and an absent stop reason, both of which are tested, and an unrescued truncation reporting as a completion is a recorded Non-Goal.

#### For the shipping session

- `**Release:** ship independently` — Phase 22 Step 19, two `fix:` commits, both naming user-observable outcomes.
- Nothing is deferred to a follow-up issue; the truncation Non-Goal was an explicit operator decision at the design gate.

[#889]: https://github.com/gotgenes/pi-packages/issues/889
