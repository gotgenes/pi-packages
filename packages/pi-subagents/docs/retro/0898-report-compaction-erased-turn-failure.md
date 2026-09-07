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

[#889]: https://github.com/gotgenes/pi-packages/issues/889
