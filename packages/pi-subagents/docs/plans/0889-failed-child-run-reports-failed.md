---
issue: 889
issue_title: "pi-subagents: a child's provider error is reported as a successful, empty completion"
---

# Report a failed child run as failed

## Release Recommendation

**Release:** ship independently

Phase 22 Step 17 carries `Release: independent`, and the roadmap's `Release batches` subsection lists Step 17 among the independently releasable steps.
The step lands as `fix:`, which is an unhidden changelog type and cuts a patch release on its own.

## Problem Statement

A subagent whose LLM provider fails on a turn is handed to the parent as a **successful completion with an empty body**, not as a failure.
The parent model, given a completion header followed by nothing, confabulates what the child did.

@georgeharker's measured runs (reported while investigating [#883]) show `Agent completed in 2.6s (0 tool uses)` with an empty body, followed by parent claims such as "created proof.txt with done" and "changes are on its worktree branch" — while `git branch` was clean and no such file ever existed.

Two independent fail-opens compose to produce this:

1. `SubagentSession.runTurnLoop` treats "`session.prompt()` resolved" as "the run succeeded".
   Pi does not throw on a provider failure, so the errored turn is indistinguishable from a quiet one and `record.status` never becomes `error`.
2. `renderOutcomeBody` guards the result with `??`, which passes an empty string through, so the body renders as nothing rather than `No output.`

Both halves are in scope deliberately.
Fixing only the renderer converts silent confabulation into a visible `No output.` while still reporting a failure as a success; fixing only the status leaves the empty-string render as a second fail-open of the same shape.

## Goals

- A child turn ending in `stopReason: "error"` is reported as a **failed** run, carrying the provider's `errorMessage` verbatim to the parent.
- The same holds for a **resume** whose turn ends in `stopReason: "error"`.
- An empty result renders `No output.` in every carrier, not nothing.
- The failed-run foreground return names where the child's transcript lives, so a parent whose child died mid-work can still reach what it did.

This change is **not** breaking.
It adds no field to `SubagentRecord`, no member to the exported `SubagentStatus` union, and no parameter to any exported signature.
It changes observable behavior only on a path that is currently wrong: a run that today reports `completed` with an empty body comes to report `error` with the provider's message.

## Non-Goals

- **A new status distinct from `error`.**
  Considered and declined at the design gate: adding a member to the exported `SubagentStatus` union breaks consumers' exhaustive switches and needs an arm in every renderer and predicate, while buying nothing the issue asks for.
- **Delivering the child's partial text alongside the error.**
  Considered and declined at the same gate.
  `markError` sets `error` and not `result`, and the partial text is a mid-turn assistant message rather than an answer the child stood behind — rendering it as the outcome is the confabulation risk this issue exists to close.
  The transcript pointer added by Step 5 below is the adopted route to that work.
- **Capping or classifying the provider's error text.**
  `record.error` already renders verbatim for every thrown error in this package; a cap applied to one error source and not the other would have the two render by different rules.
- **Changing `getLastAssistantText`'s skip-empty-text predicate.**
  The roadmap's Step 17 target list names it, but the Tidy-First assessment established that it answers a different question with a different burden of proof (see Design Overview).
  It is read during this change and left alone.
- **A shared backward-scan abstraction over `session.messages`.**
  Rejected by the Tidy-First assessor as the wrong abstraction; see Design Overview.
- **Whitespace-only results.**
  `renderOutcomeBody`'s fix makes a whitespace-only result render `No output.` while `notification.ts`'s two truthiness guards would still render the whitespace.
  The divergence is unreachable in practice — `responseText` is already trimmed at both producers — and closing it would mean extracting a predicate for a case no input can produce.
- **`@gotgenes/pi-claude-bridge` and [#883].**
  This issue was filed from that investigation but is neither bridge-specific nor provider-specific; [#883]'s own cause is separate and stays with that issue.

## Background

### The mechanism, verified against the installed SDK

The package pins `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai` at `0.84.4` (`packages/pi-subagents/package.json` `devDependencies`).
Read against that exact version:

- `agent-loop.js` — a streamed provider error returns an assistant message with `stopReason: "error"`; the loop emits `turn_end` and `agent_end` and **returns** without throwing.
- `agent.js` — a thrown executor error becomes a synthetic assistant message with `content: [{ type: "text", text: "" }]`, `stopReason: "error"`, and `errorMessage` set from the thrown error.
- Both reach `agent.state.messages` through the `message_end` reducer, and `AgentSession.messages` **is** `agent.state.messages`.
- `AgentSession._handlePostAgentRun` retries a retryable error, and `_prepareRetry` **removes** the errored message from agent state before the retry.
  So after a successful auto-retry the last assistant message is clean, and after an exhausted retry budget the errored one remains last.

The last assistant message in `session.messages` is therefore a sound **terminal** signal, not a mid-run artifact.

A hard abort (max turns + grace) and a user stop both yield `stopReason: "aborted"`, never `"error"`, so the existing `aborted` and `stopped` paths are untouched by a check that keys on `"error"` alone.

### Why the body renders empty

`runTurnLoop` computes `responseText` as `collector.getText().trim() || getLastAssistantText(session)`.
On the synthetic failure message the collector holds `""` (a `message_start` reset with no `text_delta` following it), and `getLastAssistantText` skips the empty-text failure message and scans further back.
In the reported runs the first LLM call failed, so there was no earlier assistant text and the result was `""`.

`renderOutcomeBody` then returns `outcome.result?.trim() ?? "No output."`.
`??` tests for nullish, and `""` is not nullish, so it returns `""`.

Reproduced from the code, today's foreground return for the reported runs is exactly:

```text
Agent completed in 2.6s (0 tool uses).
Agent ID: agent-1

```

`renderStatusNote("completed")` is `""`, which is why the header carries no qualifier.

### Constraints from AGENTS.md

- The package's `SubagentRecord` admission policy (`docs/decisions/0005-subagent-record-admission-policy.md`) governs what the public snapshot carries.
  This change adds nothing to it.
- `docs/architecture/architecture.md` Step 17 must be marked `✅` with a `Landed:` note at implementation completion — `/tdd-plan` lands it, it is not deferred to phase-history-write time.

## Design Overview

### The failure read

A new module-private helper in `src/lifecycle/subagent-session.ts` reads the session's **last** assistant message and reports the provider failure it ended on, if any:

```typescript
/**
 * The provider's failure on the run's last turn, or undefined when the run
 * ended for any other reason.
 *
 * Keyed on the last assistant message rather than any errored one in the
 * history: a retried error is removed from agent state before the retry, so a
 * message that is still last is one the retry budget did not rescue.
 */
function readTurnFailure(session: AgentSession): string | undefined {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const msg = session.messages[i];
    if (msg.role !== "assistant") continue;
    return msg.stopReason === "error"
      ? (msg.errorMessage ?? "provider reported an error with no message")
      : undefined;
  }
  return undefined;
}
```

Note the shape: it returns on the **first** assistant message it finds, in either direction.
That is what distinguishes it from `getLastAssistantText`, which keeps scanning past a message it does not like.

### Why a throw, and not a field on `TurnLoopResult`

The obvious fix is a `failure?: string` field on `TurnLoopResult` that `Subagent.completeRun` branches on.
Throwing is cheaper and more honest:

- `Subagent.run()` already wraps `runTurnLoop` in `try { this.completeRun(result); } catch (err) { this.failRun(err); }`, and `Subagent.runResume()` already wraps `resumeTurnLoop` in `try { this.completeResume(...); } catch (err) { this.failResume(err); }`.
  Verified against the real file by the Tidy-First assessor.
- `failRun`/`failResume` already do `markError` → status `error` → the `subagents:failed` event (`SubagentEventsObserver.onSubagentCompleted` branches on `isTerminalError()`) → the `Agent failed:` branch in `runForeground` → `renderStatusLabel`'s `Error:` form → the widget's error arm.
- A provider failure **is** an error, and every sibling failure in this class — a workspace-prepare failure, a session-factory failure — already flows as a throw into the same handler.
  A second mechanism for the same outcome would be the scattered decision, not the fix.
- `resumeTurnLoop` keeps its `Promise<string>` signature, so the shared `test/helpers/mock-session.ts` fixture and its twelve `mockResolvedValue("…")` call sites need no edit.

Consequence to state plainly: `lifecycle.completed(...)` does **not** fire for a run that failed this way, because the throw precedes it.
That is consistent with the established contract — a session-factory failure emits no `completed` either — and `SUBAGENT_CHILD_DISPOSED` still fires from the run's teardown, so no consumer loses its terminal signal.
`ChildCompletedEvent` keeps its current shape; no event payload changes.

The call sites:

```typescript
// runTurnLoop, replacing the bare `await session.prompt(...)`
await session.prompt(effectivePrompt);
const failure = readTurnFailure(session);
if (failure) throw new Error(failure);
this.meta.lifecycle.completed({ /* unchanged */ });
```

```typescript
// resumeTurnLoop, inside the existing try
await session.prompt(prompt);
const failure = readTurnFailure(session);
if (failure) throw new Error(failure);
```

Two call sites to one small helper, rather than a wrapper extracted to avoid writing one line twice — the assessor's call, and the two method bodies are not close enough in shape to share one (only `runTurnLoop` carries turn-limit tracking and the lifecycle emit).

### Why `getLastAssistantText` is not merged with it

The roadmap names `getLastAssistantText` as a Step 17 target ("reads message text and ignores the stop reason").
The Tidy-First assessor examined merging the two scans and rejected it, and the reasoning holds:

`getLastAssistantText` deliberately **skips** assistant messages with empty text, searching backward for the last one with content — it is a fallback for when the streamed-text collector came up empty.
`readTurnFailure` must inspect the message the provider error actually landed on, which is exactly a message with no text content.
Reusing the skip-empty predicate for the failure read would walk straight past the erroring message to an earlier, unrelated one — a correctness bug dressed as a simplification.

They are the "shared predicate, different burden of proof" case from the `code-design` skill: one answers "what did the child say?"
and may skip what it does not recognize; the other answers "did this run fail?"
and may not.
Two small scans, kept apart.

The stale-text hazard `getLastAssistantText` carries is closed by this change without editing it: when the run failed, `responseText` is discarded on the throw, so an earlier turn's text can no longer be presented as the child's final answer.

### The empty-result render

```typescript
// renderOutcomeBody, final line
const trimmed = outcome.result?.trim();
return trimmed || "No output.";
```

`notification.ts`'s two sites already guard with truthiness (`record.result ? … : "No output."` and `if (!record.result) return "No output.";`), which is the disagreement the issue names.
This aligns the third.

### The transcript pointer on a failed foreground return

`runForeground`'s error branch prints `Agent failed: <error>` and `Agent ID: <id>` plus the run-updates and workspace-notice addenda.
It prints no transcript pointer, while the completion nudge (`NotificationManager.buildPointerLines`) and `formatAgentReport` both do.
`src/tools/foreground-runner.ts` contains no `outputFile` reference at all today.

A failed run is the case where that pointer matters most — the body carries no result, so the transcript is the only route to what the child did before it died:

```typescript
const transcriptLine = record.outputFile
  ? `\nFull transcript available at: ${record.outputFile}`
  : "";
```

Appended after the `Agent ID:` line, before the addenda.
The success branch is deliberately left alone: it carries the result itself, so the asymmetry is the point rather than an oversight.

## Module-Level Changes

### Source

| File                                  | Change                                                                                                                                                                                                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lifecycle/subagent-session.ts`   | Add module-private `readTurnFailure(session)`. Call it in `runTurnLoop` after `await session.prompt(...)` and **before** `lifecycle.completed(...)`, throwing on a failure. Call it in `resumeTurnLoop` after `await session.prompt(...)`, throwing on a failure. `getLastAssistantText` unchanged. |
| `src/observation/outcome-delivery.ts` | `renderOutcomeBody`'s final line: `??` → truthiness on the trimmed value. Amend the surrounding doc comment, which does not currently name the empty-string case.                                                                                                                                   |
| `src/tools/foreground-runner.ts`      | The `record.status === "error"` branch gains a transcript pointer from `record.outputFile`. Its existing comment ("A failed run has no result text, so this return is the only carrier that can say where its workspace saved the work") is amended — it now also says where the transcript is.     |

### Test

| File                                        | Change                                                                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/helpers/make-subagent.ts`             | Add `outputFile?: string` to `TestSubagentOptions`, threaded into `createSubagentSessionStub(undefined, overrides.outputFile)` when `sessionReady` is set. Preparatory (Step 1).            |
| `test/lifecycle/subagent-session.test.ts`   | New cases for both turn loops rejecting on an errored last assistant message, for the `errorMessage`-absent fallback, and for `lifecycle.completed` **not** firing on the failed run.       |
| `test/observation/outcome-delivery.test.ts` | New case: an empty-string result renders `No output.` (today's suite covers `result: undefined` only).                                                                                      |
| `test/tools/foreground-runner.test.ts`      | New case: the failed-run return names the transcript path; and one for the no-`outputFile` record, which must not print a dangling label.                                                   |
| `test/lifecycle/subagent.test.ts`           | New integration case: a `runTurnLoop` rejection lands the record in `status: "error"` with the provider message as `record.error`. Pins the wiring the design predicts rather than assumes. |

### Docs

| File                                | Change                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| `docs/architecture/architecture.md` | Mark Step 17 `✅` (heading and the `S17` Mermaid node), add its `Landed:` note. |

### Predicted unchanged, with the claim each rests on

- `src/lifecycle/subagent.ts` — the throw routes through `run()`'s and `runResume()`'s existing `catch` blocks into `failRun`/`failResume`.
  Verified against the real file by the Tidy-First assessor, not merely predicted.
  If this proves wrong at implementation time it is a correction to the design, not a new step.
- `src/lifecycle/subagent-state.ts` — `markError` already formats `unknown` via `error instanceof Error ? error.message : String(error)`, and already guards `status !== "stopped"` so a user stop still wins over a provider error that lands in the same window.
- `src/lifecycle/child-lifecycle.ts` — no payload or channel change; the failed run simply does not reach the `completed` emit.
  The roadmap's Step 17 target list names this file for "whichever outcome the failed edge comes to publish"; the adopted design publishes none, so the file is untouched.
- `src/observation/notification.ts` — both `No output.` guards are already truthiness-based.
- `src/observation/subagent-events-observer.ts` — `subagents:failed` already fires off `isTerminalError()`, which `error` satisfies.
- `src/service/service.ts` and `src/service/service-adapter.ts` — no new status member, no new record field.
- `test/helpers/mock-session.ts` — `resumeTurnLoop` keeps `Promise<string>`; this is the fixture the throw-based design was chosen to protect.

### Symbol greps run at planning time

- `rg -n '"No output\.' src test` → three source sites (`outcome-delivery.ts:216`, `notification.ts:57`, `notification.ts:158`) and three test sites.
  Only the `outcome-delivery.ts` one uses `??`.
- `rg -n "resumeTurnLoop" test` → 30 matches across 5 files, of which ~12 are `mockResolvedValue("…")` on a string return.
  All stay valid.
- `rg -n "child:completed|SUBAGENT_CHILD_COMPLETED|ChildCompletedEvent" packages` → no consumer outside `pi-subagents` itself; the only references are the module, its test, and two plan documents.
- `grep -n "outputFile|transcript" src/tools/foreground-runner.ts` → no matches, confirming the pointer is absent from both branches.

## Test Impact Analysis

### New tests the change enables

The failure read is a pure function over `session.messages`, so the error path becomes unit-testable at `SubagentSession` level for the first time — previously nothing in `src/` read `stopReason` at all, so no test could distinguish a failed turn from a quiet one.
The local `createSession` factory in `test/lifecycle/subagent-session.test.ts` already pushes raw message objects into `session.messages`, so a message carrying `stopReason: "error"` / `errorMessage` needs no new machinery.

### Existing tests that become redundant

None.
Every existing case covers a path this change leaves intact: the success return, the abort and steer transitions, the `result: undefined` render, and the four resume-rejection cases in `test/lifecycle/subagent.test.ts` that already pin `failResume` (those become the precedent the new resume case follows, not a duplicate of it).

### Existing tests that must stay

- `test/lifecycle/subagent-session.test.ts` "returns the final assistant text even when no text_delta events streamed" — pins `getLastAssistantText`'s fallback, which this change must not disturb.
  Its fixture pushes an assistant message with **no** `stopReason` field, so `readTurnFailure` must treat an absent `stopReason` as "not a failure" rather than assuming the field is present.
- The turn-limit cases driving `turn_end` — the synthetic failure message also fires `turn_end` in the real SDK, so the abort/steer boundary must keep working when a run ends in error.

### Coverage claim

I checked that `test/observation/outcome-delivery.test.ts` covers `result: undefined` at line 176 and contains no empty-string case; `test/tools/get-result-report.test.ts:85` likewise asserts `No output.` from a record whose `result` is absent, not empty.
I did not audit every renderer's test file for an empty-string case beyond these two.

## Invariants at risk

Step 17 touches surfaces that Steps 10, 12, 14, and 15 refactored.
Each invariant below is named with the test that pins it.

| Invariant                                                                                                                                           | Owner            | Pinned by                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------- |
| A failed run's workspace notice still reaches the parent — `failRun` disposes the workspace and records the notice, and the error branch renders it | Step 12 ([#870]) | `test/tools/foreground-runner.test.ts:83` and the `status: "error"` cases at 106/121           |
| A failed run drops its `pendingQuestion` rather than advertising a resume                                                                           | Step 15 ([#878]) | `failRun`'s `clearPendingQuestion()`; `test/lifecycle/subagent.test.ts` resume-rejection cases |
| The updates a child sent mid-run survive a failure — `renderRunUpdates` is composed into the error branch                                           | Step 14 ([#872]) | `test/tools/foreground-runner.test.ts:94`                                                      |
| A user stop beats a provider error that lands in the same window                                                                                    | pre-existing     | `markError`'s `status !== "stopped"` guard, `test/lifecycle/subagent-state.test.ts`            |

The first three are already exercised by the error branch, which this change makes **reachable** for a new class of failure rather than altering.
That is the load-bearing observation: today those assertions run only against a thrown error, and after this change they also cover a provider error — so a regression in any of them surfaces in the existing suite rather than only in the new cases.

No quantitative invariant is at risk: the change adds no prompt bytes, no per-turn work (one backward scan per `prompt()` resolution, terminating on the first assistant message found), and no cache-key input.

## TDD Order

Each cycle is red → green → verify → commit.

1. **`test(pi-subagents): let createTestSubagent set the session outputFile`** *Preparatory (Tidy First).*
   `createTestSubagent` calls `createSubagentSessionStub()` with no second argument, so `record.outputFile` is always `undefined` unless the caller hand-rolls a full `execution`.
   Step 5 needs a fixture with a populated `outputFile`; without this it would build a session stub inline.
   Add `outputFile?: string` to `TestSubagentOptions` and thread it through the `sessionReady` branch.
   Test surface: `test/helpers/make-subagent.test.ts` — a subagent built with `{ sessionReady: true, outputFile: "/s/child.jsonl" }` reports that path.
   **Killing mutation:** drop the `overrides.outputFile` argument from the `createSubagentSessionStub(...)` call — the new assertion must go red.

2. **`fix(pi-subagents): render an empty subagent result as No output.`** The renderer half, first because it is independent and its absence masks the status half.
   Test surface: `test/observation/outcome-delivery.test.ts` — `renderOutcomeBody` with `result: ""` returns `No output.`; the existing `undefined` and trimmed-result cases stay green.
   **Killing mutation:** restore `outcome.result?.trim() ?? "No output."` — the empty-string case must go red while the `undefined` case stays green.
   That green-stays-green half is the point: it is what proves the new case discriminates, since today's suite passes under both spellings.

3. **`fix(pi-subagents): fail a child run whose provider errored`** The mechanism half for the initial run.
   Add `readTurnFailure` and the `runTurnLoop` call site.
   Test surface: `test/lifecycle/subagent-session.test.ts` — `runTurnLoop` rejects with the provider's `errorMessage` when the last assistant message carries `stopReason: "error"`; rejects with the fallback string when `errorMessage` is absent; resolves normally when the last assistant message carries `stopReason: "aborted"` or no `stopReason` at all; and `lifecycle.completed` is **not** called on the failing run.
   **Killing mutations**, one per equivalence class:
   - Make `readTurnFailure` return `undefined` unconditionally — the two rejection cases go red, the three resolve cases stay green.
   - Make it match `stopReason !== "stop"` instead of `=== "error"` — the `aborted` and no-`stopReason` cases go red.
   - Move the throw to **after** the `lifecycle.completed(...)` call — only the "completed not emitted" case goes red.
     This is the mutation that matters: the other two would pass a suite that never asserted the emit.

4. **`fix(pi-subagents): fail a resumed child run whose provider errored`** The same read at the second call site.
   Test surface: `test/lifecycle/subagent-session.test.ts` — `resumeTurnLoop` rejects on an errored last assistant message and resolves normally otherwise; plus `test/lifecycle/subagent.test.ts` — the record reaches `status: "error"` with the provider message as `record.error`, alongside the existing `resumeTurnLoop.mockRejectedValue` cases.
   **Killing mutation:** delete the `if (failure) throw new Error(failure);` line from `resumeTurnLoop` only — the new resume cases go red while every Step 3 case stays green.
   A relocated or duplicated line is as unpinned at its new site as at its old one, which is why this step asserts at the second call site rather than trusting Step 3's coverage.

5. **`fix(pi-subagents): name the transcript on a failed foreground return`** Test surface: `test/tools/foreground-runner.test.ts` — a failed record with an `outputFile` prints `Full transcript available at: <path>`; one without prints no dangling label; the existing workspace-notice and run-updates assertions on the error branch stay green.
   **Killing mutation:** make the transcript line unconditional (drop the `record.outputFile` guard) — the no-`outputFile` case goes red with a dangling `Full transcript available at: undefined`.

6. **`docs(pi-subagents): mark Phase 22 Step 17 complete`**
   Architecture-doc step mark: `✅` on the heading and the `S17` Mermaid node, plus the `Landed:` note recording that the failure surfaces as a throw into the existing `failRun`/`failResume` path, that `lifecycle.completed` does not fire for such a run, and that `getLastAssistantText` was examined and deliberately left alone.

Steps 2 through 5 are each independently releasable `fix:` commits; they land together and the release names the package once.

## Risks and Mitigations

| Risk                                                                                                  | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A successful auto-retry leaves an errored message in `session.messages` and the run is wrongly failed | `_prepareRetry` removes the errored message from `agent.state.messages` before retrying, and `session.messages` **is** that array — verified in the 0.84.4 compiled source. `readTurnFailure` returns on the first assistant message it finds, so an errored message deeper in the history cannot fail a run that recovered. Step 3's "resolves when the last assistant message is clean" case pins this. |
| A hard abort or user stop is misreported as a provider error                                          | Both yield `stopReason: "aborted"`. Step 3 asserts the `aborted` case resolves normally. Independently, `markError` guards `status !== "stopped"`, so a stop that already landed still wins.                                                                                                                                                                                                              |
| A context-overflow error is failed instead of compacted                                               | `_handlePostAgentRun` runs `_checkCompaction` and continues the agent, so a recovered overflow leaves a clean last message. An overflow that compaction could not rescue genuinely failed the run and should report as such.                                                                                                                                                                              |
| `errorMessage` is absent on some provider's error message                                             | The `?? "provider reported an error with no message"` fallback, pinned by its own case in Step 3. `renderStatusLabel` already carries an `?? "unknown"` fallback downstream, so nothing renders `undefined`.                                                                                                                                                                                              |
| The failed run loses its `completed` lifecycle event and a consumer misses the terminal signal        | No consumer outside this package subscribes to `subagents:child:completed` (grep run at planning time). `SUBAGENT_CHILD_DISPOSED` still fires from teardown, and the record-level `subagents:failed` event fires from `SubagentEventsObserver`. Stated in the Landed note so the contract change is recorded rather than discovered.                                                                      |
| The Tidy-First assessor's zero-change prediction for `subagent.ts` is wrong                           | It was verified against the real file, not predicted. If implementation finds otherwise, treat it as a design correction and add the routing explicitly rather than working around it.                                                                                                                                                                                                                    |

## Open Questions

None.
The two decisions the roadmap flagged for plan time — which status an errored turn maps onto, and whether `errorMessage` reaches the parent verbatim — were settled at the design gate: the existing `error` status with a transcript pointer added, and verbatim uncapped.
No follow-up issues are filed; nothing in this plan is deferred to one.

[#870]: https://github.com/gotgenes/pi-packages/issues/870
[#872]: https://github.com/gotgenes/pi-packages/issues/872
[#878]: https://github.com/gotgenes/pi-packages/issues/878
[#883]: https://github.com/gotgenes/pi-packages/issues/883
