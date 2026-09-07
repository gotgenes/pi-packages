---
issue: 898
issue_title: "pi-subagents: a failed compaction attempt hides the turn error it stripped, so the run reports success"
---

# Record the turn's failure as it happens, not from session state afterwards

## Release Recommendation

**Release:** ship independently

Phase 22 Step 19 carries `Release: independent`, and the roadmap's `Release batches` subsection lists Step 19 among the independently releasable steps.
The step lands as `fix:`, an unhidden changelog type that cuts a patch release on its own.

## Problem Statement

A child subagent whose provider errors can still be handed to the parent as a **successful completion**, because the evidence the failure read depends on is erased before the read runs.

Step 17 ([#889]) decides a run failed by scanning `session.messages` backwards for the last assistant message and testing its `stopReason`.
Pi's `AgentSession._checkCompaction` removes that message from `agent.state.messages` before attempting overflow compaction, and restores nothing when the compaction attempt itself fails.
`AgentSession.messages` **is** `agent.state.messages` by reference, so the scan walks past the erased turn to an earlier assistant message and reports success — stale text from a prior turn, or `""` on the very first.
That is exactly the confabulation [#889] closed, reached through a door its read cannot see.

The fix is a different mechanism rather than a wider predicate: record the failure **while it happens** instead of reconstructing it afterwards from state a collaborator is free to rewrite.

## Goals

- A run whose turn error was stripped by a failed compaction attempt reports `error` with the provider's message, not a stale-text success.
- The same holds for a resume.
- The outcome stops depending on who owns `agent.state.messages` at read time: it is recorded from the session's own event stream, which no later state rewrite can revise.
- The predicate stays exactly what Step 17 shipped — `stopReason === "error"`, with `"aborted"`, `"length"`, and an absent `stopReason` all reading as "not a failure".

This change is **not** breaking.
It adds no field to `SubagentRecord`, no member to the exported `SubagentStatus` union, and no parameter to any exported signature.
It changes observable behavior only on a path that is currently wrong.

## Non-Goals

- **A compaction-event-driven mechanism.**
  The issue floated `compaction_end` and `_emitSessionCompactFailed` as the two candidate signals and named establishing their coverage as the first thing to check.
  It was checked, and they are insufficient — see Background.
  `src/observation/record-observer.ts`, which the roadmap's `Target:` names for this step, is untouched.
- **Widening the predicate to an unrescued truncation (`stopReason: "length"`).**
  `_checkCompaction`'s Case 1 strips on `contextOverflow || recoverableLength`, so a truncated response whose compaction also failed ends the run the same way.
  Today that run reports `completed` carrying the child's partial text.
  Declined at the design gate: a truncated answer carries the child's real work, so it is not the empty-completion confabulation this issue exists to close; failing it would mean inventing an error string (a `length` stop carries no `errorMessage`) and discarding that text.
  Recorded here rather than filed — no follow-up issue.
- **Counting a failed compaction as a compaction.**
  `subscribeSubagentObserver` gates `state.incrementCompactions()` on `!event.aborted && event.result`, which is correct: a compaction that failed did not happen.
  The issue notes this gate as a lead; the adopted mechanism does not need it and it stays as it is.
- **Surfacing the compaction failure itself to the parent.**
  The error the parent receives is the provider's own overflow message, which is the true diagnosis.
  Prefixing it with compaction context would be available on only three of the six failure exits (see Background), so the parent would learn it inconsistently.
- **Changing `getLastAssistantText` or `collectResponseText`.**
  Both are read during this change and left alone.
- **Restoring the stripped message.**
  It is Pi's state, rewritten by Pi's own recovery logic; this package reads outcomes, it does not repair the SDK's message history.

## Background

### The stripping path, verified against the pinned SDK

The package pins `@earendil-works/pi-coding-agent` at `0.84.4` (`packages/pi-subagents/package.json` `devDependencies`).
Read against that exact version, `dist/core/agent-session.js`:

`_checkCompaction` Case 1 (`:1684-1689`) — the first overflow attempt — sets `_overflowRecoveryAttempted`, removes the last assistant message from `agent.state.messages`, then calls `_runAutoCompaction("overflow", willRetry)`.
The second attempt (`:1661-1680`) does **not** strip, which is why only the first attempt's own failure is invisible.

### The issue's open question, answered: the compaction events do not cover it

`_runAutoCompaction` has six exits after the strip, and only one emits what the issue hoped for:

| Exit from `_runAutoCompaction` after the strip         | Event emitted                                                                    |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `!this.model` (`:1739`)                                | none — unreachable from Case 1, whose `sameModel` guard already required a model |
| `_getSummarizationRequestAuth` throws (`:1741`)        | **none** — `started` is still `false`, so the `catch` at `:1866` emits nothing   |
| `prepareCompaction(...)` returns `undefined` (`:1744`) | **none** — returns before `started = true`                                       |
| `session_before_compact` cancels (`:1762`)             | `compaction_end` `aborted: true`, no `errorMessage`                              |
| abort signal after summarization (`:1805`)             | `compaction_end` `aborted: true`, no `errorMessage`                              |
| summarization throws (`:1866`)                         | `compaction_end` with `errorMessage`, plus `_emitSessionCompactFailed`           |

The silent third row is the most likely instance of this bug in a subagent.
`prepareCompaction` returns `undefined` when there is nothing left to summarize (`dist/core/compaction/compaction.js:562`: `messagesToSummarize.length === 0 && turnPrefixMessages.length === 0`).
A child whose spawn prompt alone overflows the context window on its **first** LLM call has nothing to cut, so it takes the strip, exits silently, and no compaction event ever fires.
That is the shape [#889] was reported from.

Two further limits: `compaction_end` carries `reason: "overflow"` for both Case 1 and Case 2, and only Case 1 strips — so the event cannot distinguish "the turn's error was erased" from "a completed response was compacted".
And a failed **threshold** compaction (Case 3) strips nothing at all, so it must not fail a run.

### A third stripping door of the same shape

`_prepareRetry` (`:2301`) also removes the last assistant message — before its backoff sleep — and returns `false` without restoring it if that sleep is aborted (`:2306-2320`).
Nothing in `pi-subagents` calls `abortRetry()`, so it is unreachable for this package today.
It is listed because it makes the general point concrete: any collaborator may rewrite `agent.state.messages` between the failure and a read of it, and the count of such collaborators is not ours to fix.

### The mechanism the issue did not list

`message_end` is emitted for the errored assistant message — from the streamed path (`@earendil-works/pi-agent-core` `dist/agent-loop.js:238` and `:251`) and from `Agent.handleRunFailure` (`dist/agent.js:362`, which synthesises a message with empty text content, `usage: EMPTY_USAGE`, `stopReason: "error"`, and `errorMessage`).
`AgentSession._handleAgentEvent` forwards every agent event to session listeners at `:386`, and `_handlePostAgentRun` — which is where `_checkCompaction` runs — is not called until `await this.agent.prompt(messages)` resolves (`:776`).
So a session subscriber sees the errored `message_end` **before** anything strips it.

A successful auto-retry emits a later, clean `message_end`, so recording last-one-wins is correct and a latch would be wrong.
`AgentSession` mutates finalized messages in place (`_replaceMessageInPlace`, `:453-465`), so the recorder must copy the scalars it needs rather than retain the message object.

### Confirmed against upstream `main`

The `pi` checkout beside this repo is at `0.85.1` (`c1d4c8011`), ahead of the pin.
Every mechanism this design rests on is unchanged there, read in `packages/coding-agent/src/core/agent-session.ts` and `packages/agent/src/agent.ts`: the Case 1 strip and its comment, the silent `!preparation` early return in `_runAutoCompaction`, the listener forward in `_handleAgentEvent` ahead of `_runAgentPrompt`'s `_handlePostAgentRun` loop, and `handleRunFailure`'s `message_end` emit.
No line numbers are cited for that checkout: it tracks `main` and drifts mid-session, so only the pinned `dist/` above is citable.
`earendil-works/pi` has no open issue on the missing restore.
Upstream drift is not the risk here — and the adopted design is the one that stops caring about it.

### Constraints from AGENTS.md

- `docs/architecture/architecture.md` Step 19 must be marked `✅` with a `Landed:` note at implementation completion; `/tdd-plan` lands it rather than deferring it to phase-history-write time.
- `docs/decisions/0005-subagent-record-admission-policy.md` governs the public snapshot; this change adds nothing to it.

## Design Overview

### Record the outcome, do not reconstruct it

`src/lifecycle/subagent-session.ts` already collects the turn's **text** live from the event stream, in `collectResponseText`.
The failure is collected the same way, by a sibling module-private helper:

```typescript
/**
 * Subscribe to a session and record how its last assistant message ended.
 *
 * Read live rather than scanned from `session.messages` afterwards: Pi's
 * overflow recovery removes the failed message from agent state before
 * attempting compaction and restores nothing when that compaction fails, so
 * by the time a run settles its own error may no longer be in the history
 * (#898). The event is emitted before any of that runs.
 *
 * Last-one-wins rather than latched: a successful auto-retry emits a later,
 * clean `message_end`, and that run recovered.
 */
function collectTurnFailure(session: AgentSession) {
  let failure: string | undefined;
  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (event.type !== "message_end" || event.message.role !== "assistant") return;
    failure =
      event.message.stopReason === "error"
        ? event.message.errorMessage || PROVIDER_ERROR_WITHOUT_MESSAGE
        : undefined;
  });
  return { getFailure: () => failure, unsubscribe };
}
```

The `||` is deliberate and carries the same `@typescript-eslint/prefer-nullish-coalescing` disable Step 17 established at this exact expression: `Agent.handleRunFailure` sets `errorMessage: error.message`, which is `""` for a bare `new Error()`, and `??` would pass that through.

`readTurnFailure` — the backward scan over `session.messages` — is **deleted**.
`failIfProviderErrored` keeps its name and its one-line call sites, and takes the recorded failure instead of the session:

```typescript
function failIfProviderErrored(failure: string | undefined): void {
  if (failure) throw new Error(failure);
}
```

The `role === "assistant"` narrowing is not defensive: `stopReason` and `errorMessage` exist only on `AssistantMessage` (`@earendil-works/pi-ai` `dist/types.d.ts:307-327`), so the compiler requires the check.

### The call sites

```typescript
// runTurnLoop — alongside the existing collector and abort forwarding
const failures = collectTurnFailure(session);
const collector = collectResponseText(session);
const cleanupAbort = forwardAbortSignal(session, opts.signal);

try {
  await session.prompt(effectivePrompt);
  failIfProviderErrored(failures.getFailure());
  this.meta.lifecycle.completed({ /* unchanged */ });
} finally {
  unsubTurns();
  failures.unsubscribe();
  collector.unsubscribe();
  cleanupAbort();
}
```

`resumeTurnLoop` takes the same three lines against its own `try`/`finally`.
The recorded value survives the unsubscribe — it is a closure variable, not a live read — so the ordering in `finally` is free.

Everything downstream is unchanged, because the throw is the same throw Step 17 landed: `Subagent.run()` and `runResume()` already route it to `failRun`/`failResume` → `markError` → status `error` → the `subagents:failed` event → the `Agent failed:` branch with its transcript pointer.

### Why not the compaction events

They were the issue's own two candidates and the roadmap's `Target:`, and the table in Background is the reason they lose: three of the six post-strip exits emit nothing at all, two more emit only `aborted: true`, and `reason: "overflow"` cannot separate the stripping Case 1 from the non-stripping Case 2.
A mechanism that covers half the exits and needs a disambiguation the event does not carry is a wider predicate wearing a new mechanism's clothes.

### Why not keep the scan as a fallback

A recorder-with-scan-fallback keeps every [#889] test untouched, which is its whole appeal.
It was declined at the design gate: production emits at least one assistant `message_end` per `prompt()` on every path that reaches the read, so the fallback branch would be reachable only from fixtures — a test pinning a path production never takes.
It also preserves the scan's latent hazard, which is that it answers from state whose owner is free to rewrite it.

### Two collectors, not one

`collectResponseText` and `collectTurnFailure` are kept apart, per the Tidy-First assessment.
They react to disjoint event types (`message_start`/`message_update` versus `message_end`) and share no predicate, so merging saves one `subscribe` call and nothing else.
Their results also differ in kind: the collected text is *optimistic and overridable* — the caller discards it via `collector.getText().trim() || getLastAssistantText(session)` — while the failure is *authoritative*, consulted once to decide whether to throw.
Putting a discardable fact and a control-flow-determining fact behind one interface invites a later reader to weigh them the same.
`runTurnLoop` already runs three independent per-turn subscriptions in one `try`/`finally`; a fourth matches the file's shape.

## Module-Level Changes

### Source

| File                                | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lifecycle/subagent-session.ts` | Add module-private `collectTurnFailure(session)`. Delete `readTurnFailure`. `failIfProviderErrored` takes `string \| undefined` instead of the session. Both turn loops create the collector before `prompt()`, pass `failures.getFailure()` to the unchanged call site, and unsubscribe in `finally`. Rewrite the `failIfProviderErrored` doc comment, whose "Keyed on the *last* assistant message … Pi removes a retried error from agent state before retrying" paragraph describes the mechanism being replaced. |

No other `src/` file changes.

### Test

| File                                      | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test/lifecycle/subagent-session.test.ts` | Preparatory: generalize `emitTurnEnd(listeners)` into a generic `emit(listeners, event)` on the local `createSession` stub. Preparatory: `programMessages` emits a `message_end` (carrying `usage`) alongside every message it pushes. New: `runTurnLoop` and `resumeTurnLoop` reject when the errored `message_end` was emitted but the message is absent from `session.messages`, with an earlier clean message present. New: an errored `message_end` followed by a clean one resolves. |
| `test/lifecycle/subagent.test.ts`         | Preparatory: the three inline `session.prompt` bodies in `describe("Subagent — provider failures reach the record")` emit a `message_end` (carrying `usage`) alongside each push. New: a run whose errored message was emitted and then stripped lands `status: "error"` with the provider's message.                                                                                                                                                                                      |

### Docs

| File                                | Change                                                                                                                                                                                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/architecture/architecture.md` | Mark Step 19 `✅` (heading and the `S19` Mermaid node) and add its `Landed:` note. Add one forward-pointing sentence to Step 17's `Landed:` note, whose "`readTurnFailure` reads the last assistant message's stop reason" clause becomes stale on this change. |

### The `usage` requirement on emitted fixtures

The Tidy-First assessment found the one way the preparatory fixture change can go wrong, and it is not obvious.
`subscribeSubagentObserver` (`src/observation/record-observer.ts:61-67`) reads `event.message.usage.input` on every assistant `message_end` with **no guard** — `docs/retro/0188-replace-any-casts-with-sdk-types.md` records that a defensive "ignores `message_end` without usage" test was deliberately removed, because the SDK type guarantees `usage` is present on a real event.
`Subagent.start()`/`resume()` wire that observer over the same mock session **before** driving the turn loop (`src/lifecycle/subagent.ts:351`, `:471`), so in `test/lifecycle/subagent.test.ts` a synthesized `message_end` without `usage` throws a `TypeError` inside `session.prompt()` itself.
The three tests in that block would go red carrying the TypeError's message instead of the provider's — red for a reason unrelated to what they assert.

Every synthesized `message_end` therefore carries `usage: { input: 0, output: 0, cacheWrite: 0 }`, matching `emitResumeUsageAndCompaction` in `test/helpers/mock-session.ts` and the fixtures in `test/lifecycle/subagent-manager.test.ts:1139-1140`.
This is also what the real SDK does: `handleRunFailure` sets `usage: EMPTY_USAGE` on the synthetic failure message.
`test/lifecycle/subagent-session.test.ts` has no observer in the loop and does not need it, but carries it anyway so the two files' fixtures do not diverge on a detail one of them depends on.

### Predicted unchanged, with the claim each rests on

- `src/observation/record-observer.ts` — the roadmap's `Target:` names it, and the adopted mechanism publishes nothing through it.
  Its `compaction_end` gate stays as-is because a compaction that failed did not happen.
  It does start receiving `message_end` events from the migrated fixtures, which is why they carry `usage`.
- `src/lifecycle/subagent.ts` — the throw routes through `run()`'s and `runResume()`'s existing `catch` blocks, exactly as Step 17 established and verified.
- `src/lifecycle/subagent-state.ts`, `src/lifecycle/child-lifecycle.ts`, `src/observation/outcome-delivery.ts`, `src/tools/foreground-runner.ts` — Step 17 already routes a provider failure through all four; this change alters only where the failure is read from, not what is thrown or where it lands.
- `test/helpers/mock-session.ts` — `createMockSession` already exposes a generic `emit`, so the `subagent.test.ts` fixtures need no shared-helper change.
- `createSession`'s default `prompt` and `programTurns` in `test/lifecycle/subagent-session.test.ts` — the assessor's correction to my first file list.
  Neither pushes a message carrying `stopReason: "error"`, and the collector's un-signaled default is already "no failure", so instrumenting them changes nothing observable.
- `packages/pi-subagents/README.md`, `docs/configuration.md`, `.pi/skills/package-pi-subagents/SKILL.md` — grepped for `readTurnFailure`, `failIfProviderErrored`, and "provider error"; the only hits outside `src/`/`test/` are `docs/plans/0889-*.md`, `docs/retro/0889-*.md` (both historical records of that change, not current-behavior docs), and `architecture.md`'s Step 17 note, which is listed above.

## Test Impact Analysis

### New tests the change enables

The strip scenario is testable for the first time.
No existing fixture can express "the message was emitted and then erased", because every failure fixture in the package models only the state side — a push into `session.messages` with no event — which is precisely the half that compaction rewrites.
Once `programMessages` emits, a test can emit the errored `message_end` and leave `session.messages` holding only an earlier clean message, which is the real sequence.

That test is also the regression test for the old mechanism: under the deleted scan it passes silently as a success carrying the earlier turn's text.

### Existing tests that become redundant

None.
The six provider-failure cases Step 17 landed keep asserting exactly what they assert; the preparatory step adds an event to the fixture and removes nothing.

### Existing tests that must stay

- The six `programMessages`-driven cases in `test/lifecycle/subagent-session.test.ts` (`describe("SubagentSession — runTurnLoop provider failures")` and the two resume cases) — they pin Step 17's outcome, and after the migration they push **and** emit, which is what lets the "restore the scan" mutation leave them green while the new strip tests go red.
- "returns the final assistant text even when no `text_delta` events streamed" — pins `getLastAssistantText`'s fallback, untouched here.
- The turn-limit cases driving `turn_end` — the preparatory generic `emit` must leave `emitTurnEnd`'s behavior identical.

### Coverage claim

I grepped `stopReason` across `packages/pi-subagents/test/` and found assistant-message fixtures in exactly three files: `test/ui/transcript-content.test.ts` (`"stop"`/`"toolUse"` only, for rendering), `test/lifecycle/subagent.test.ts`, and `test/lifecycle/subagent-session.test.ts`.
Only the latter two carry `stopReason: "error"`, and both are listed in Module-Level Changes.
I grepped `message_end` across `packages/pi-subagents/src/` and found four readers: `record-observer.ts` (the `usage` accumulation above), `ui/transcript-content.ts` (rendering, not in any turn-loop test's path), and two doc comments in `lifecycle/usage.ts` and `lifecycle/subagent-state.ts`.
I did not audit `test/ui/` for incidental subscribers, because no UI test drives a turn loop.

## Invariants at risk

Step 17 ([#889]) is the surface this step rewrites, so its documented outcomes are the ones at risk.

| Invariant                                                                                       | Owner            | Pinned by                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A turn ending in `stopReason: "error"` fails the run, carrying `errorMessage` verbatim          | Step 17          | The three rejection cases in `describe("SubagentSession — runTurnLoop provider failures")` plus the two resume cases, all migrated in the preparatory step  |
| An absent `stopReason`, and `"aborted"`, both resolve normally                                  | Step 17          | "resolves normally when the last turn was aborted rather than errored" and "…carries no stopReason"                                                         |
| An errored turn the retry budget rescued resolves normally                                      | Step 17          | "resolves normally when an errored turn was followed by a clean one" — migrated, and joined by an event-driven twin that pins last-one-wins against a latch |
| `lifecycle.completed` does not fire for a failed run                                            | Step 17          | "does not emit completed for a run whose provider errored"                                                                                                  |
| An empty `errorMessage` falls back rather than rendering blank                                  | Step 17          | "rejects with a fallback when the errored turn carries no message"                                                                                          |
| A failed run's workspace notice, transcript pointer, and mid-run updates still reach the parent | Steps 12, 14, 17 | `test/tools/foreground-runner.test.ts` error-branch cases — untouched, since what is thrown and where it lands are unchanged                                |

The load-bearing detail is that the preparatory step makes the migrated fixtures emit **in addition to** pushing.
That is what makes the two mutations independent: restoring the scan leaves all six green (they still push) while the new strip tests go red, which is the evidence that the migration did not quietly weaken Step 17's coverage.

No quantitative invariant is at risk.
The change adds one session subscription per turn loop and one scalar assignment per assistant `message_end`, and removes a backward scan over `session.messages`; it adds no prompt bytes and no cache-key input.

## TDD Order

Each cycle is red → green → verify → commit.

1. **`refactor(pi-subagents): give the local session stub a generic emit`** *Preparatory (Tidy First).*
   `createSession` in `test/lifecycle/subagent-session.test.ts` has no generic broadcast — only `emitTurnEnd(listeners)`, which hard-codes `{ type: "turn_end" }`.
   Step 2 needs to emit `message_end` from the same fixture and has nothing to call.
   Generalize the body into `emit(listeners, event)` and have `emitTurnEnd` delegate to it.
   Test surface: none added; the full package suite must stay green, and the turn-limit cases are the existing consumers that prove the generalized emit is still wired.
   **Killing mutation:** make `emit` a no-op — the turn-limit steer/abort cases go red.

2. **`test(pi-subagents): drive provider failures through message_end events`** *Preparatory (Tidy First).*
   `programMessages` emits a `message_end` carrying `usage: { input: 0, output: 0, cacheWrite: 0 }` alongside every message it pushes, and the three inline `session.prompt` bodies in `subagent.test.ts`'s provider-failure block do the same.
   The fixtures then model both halves of what the SDK does — the event and the state — instead of only the half compaction rewrites.
   Test surface: no assertions added; the full suite must stay green under the **unchanged** source, since the scan still reads the pushed messages.
   This step has no killing mutation of its own, which is what makes it preparatory: deleting its emits reddens nothing until Step 3 lands, and reddens the migrated cases immediately afterwards.
   The `usage` field is not polish — omitting it makes `subscribeSubagentObserver`'s unguarded `event.message.usage.input` throw a `TypeError` inside `session.prompt()`, turning the three `subagent.test.ts` cases red for the wrong reason.

3. **`fix(pi-subagents): report a child run whose failed compaction erased the turn error`** Add `collectTurnFailure`, delete `readTurnFailure`, retype `failIfProviderErrored`, and wire the collector into both turn loops.
   One step rather than two, because the helper's signature changes at both call sites in the same commit and the type checker will not accept them apart.
   Test surface: `test/lifecycle/subagent-session.test.ts` — `runTurnLoop` rejects with the provider's message when the errored `message_end` was emitted and `session.messages` holds only an earlier clean message; the same for `resumeTurnLoop`; an errored `message_end` followed by a clean one resolves normally.
   Plus `test/lifecycle/subagent.test.ts` — the stripped-message run lands `status: "error"` with the provider's message and no `result`.
   **Killing mutations**, one per equivalence class:
   - Restore the deleted `session.messages` scan in place of the collector — the three strip cases (run, resume, integration) go red, and every migrated Step 17 case stays green.
     This is the pair that matters: green-stays-green is the evidence that Step 2 did not weaken the coverage it rewrote.
   - Latch the failure (drop the `: undefined` arm, so a clean message cannot clear it) — the "errored then clean" case goes red, and a real auto-retry would be reported as a failure.
   - Delete the `failIfProviderErrored(...)` call from `resumeTurnLoop` only — the resume strip case and the resume integration case go red while every run-path case stays green.
     A relocated read is as unpinned at its new site as at its old one.

4. **`docs(pi-subagents): mark Phase 22 Step 19 complete`** `✅` on the Step 19 heading and the `S19` Mermaid node, plus a `Landed:` note recording: that the compaction events were checked against the pinned SDK and found to cover only three of six post-strip exits (one of them silently, on the path a first-call overflow actually takes); that the adopted mechanism records the outcome from `message_end` rather than reading `session.messages`; that `record-observer.ts`, which the `Target:` named, was left untouched; and that the `"error"` predicate is unchanged, with an unrescued `"length"` truncation deliberately still reporting as a completion.
   Add one sentence to Step 17's `Landed:` note pointing forward, since its "`readTurnFailure` reads the last assistant message's stop reason" clause stops being true.

## Risks and Mitigations

| Risk                                                                                                                               | Mitigation                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The preparatory fixture emit turns three `subagent.test.ts` cases red through `subscribeSubagentObserver`'s unguarded `usage` read | Every synthesized `message_end` carries `usage: { input: 0, output: 0, cacheWrite: 0 }`, which is also what the real `handleRunFailure` sets (`EMPTY_USAGE`). Found by the Tidy-First assessor against the real files, not predicted.                                                              |
| The migration quietly weakens Step 17's coverage — the six cases pass for a new reason                                             | The migrated fixtures push **and** emit, so Step 3's first killing mutation (restore the scan) must leave all six green. A failure of that mutation to behave as predicted is the signal that the migration changed what they test.                                                                |
| A successful auto-retry is misreported as a failure                                                                                | Last-one-wins, not latched: `_prepareRetry` continues the agent and the retried turn emits its own clean `message_end`. Pinned by the "errored then clean" case and by Step 3's latch mutation.                                                                                                    |
| A failed **threshold** compaction (Case 3, which strips nothing) fails a healthy run                                               | The collector never reads a compaction event at all. It reports what the turn's own last assistant message said, so a run whose turn ended in `"stop"` is unaffected by any compaction outcome.                                                                                                    |
| A user stop or hard abort is reported as a provider error                                                                          | Both yield `stopReason: "aborted"`, which the predicate excludes; `markError`'s `status !== "stopped"` guard independently keeps a landed stop winning.                                                                                                                                            |
| The SDK stops emitting `message_end` before compaction runs, silently reopening the hole                                           | Verified in the pinned `0.84.4` and in `main` `0.85.1`, on both the streamed and synthetic paths. Recorded in the `Landed:` note so the dependency is documented rather than tacit. The inverse risk — that Pi later fixes the strip upstream — costs nothing: the recorder is correct either way. |
| The recorder retains a message object the SDK mutates in place                                                                     | It copies the two scalars it needs at event time. `_replaceMessageInPlace` deletes and reassigns the target's keys, so a retained reference would report whatever the message later became.                                                                                                        |

## Open Questions

None.
The roadmap's plan-time design decision — which event carries enough to distinguish "compaction failed and took the turn's error with it" from "compaction failed but the turn was fine" — was answered by establishing that **neither** candidate event does, and the gate settled the mechanism on that finding.
No follow-up issues are filed; the truncation case is recorded as a Non-Goal by explicit operator decision rather than deferred to one.

[#889]: https://github.com/gotgenes/pi-packages/issues/889
