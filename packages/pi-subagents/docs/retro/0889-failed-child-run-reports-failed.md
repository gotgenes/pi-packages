---
issue: 889
issue_title: "pi-subagents: a child's provider error is reported as a successful, empty completion"
---

# Retro: #889 — pi-subagents: a child's provider error is reported as a successful, empty completion

## Stage: Planning (2026-09-07T06:26:43Z)

### Session summary

Verified the issue's source trace against the installed SDK (`@earendil-works/pi-coding-agent` / `pi-ai` / `pi-agent-core` at `0.84.4`), settled three design decisions at an `ask_user` gate, ran the Tidy-First assessor, and committed `docs/plans/0889-failed-child-run-reports-failed.md` — a six-step plan closing both fail-opens the issue names, plus a transcript pointer on the failed foreground return.
The issue is Phase 22 Step 17, `Release: independent`, landing as `fix:`.

### Observations

#### The throw beat the field

The obvious design — a `failure?: string` field on `TurnLoopResult` that `Subagent.completeRun` branches on — was displaced by having the turn loops **throw**.
`Subagent.run()` and `runResume()` already wrap the turn-loop calls in `try`/`catch` routing to `failRun`/`failResume`, which already reach `markError` → status `error` → `subagents:failed` → the `Agent failed:` branch.
So the mechanism half is one helper plus two `if (failure) throw` lines, `src/lifecycle/subagent.ts` needs zero changes, `resumeTurnLoop` keeps `Promise<string>`, and the shared `test/helpers/mock-session.ts` fixture and its ~12 `mockResolvedValue("…")` sites are untouched.
Worth remembering as a shape: when a package already has a working error path, the cheapest fix for a new failure class is often to *join* it rather than to add a parallel signal.

#### The roadmap's target list named a file the design does not touch

Step 17's `Target:` names `src/lifecycle/child-lifecycle.ts` "(whichever outcome the failed edge comes to publish)".
The adopted design publishes none — the throw precedes the `lifecycle.completed(...)` emit, and a session-factory failure already emits no `completed` either.
Recorded as a predicted-unchanged file with its claim rather than silently dropped.
Confirms the AGENTS.md reading rule: a roadmap `Target:` is the discovery sweep's guess at the blast radius, not a census.

#### `getLastAssistantText` was named as a target and deliberately left alone

Both the roadmap and my first instinct pointed at merging the new stop-reason read with the existing `getLastAssistantText` backward scan.
The Tidy-First assessor rejected it, correctly: `getLastAssistantText` **skips** empty-text assistant messages, and the provider's failure message is exactly a message with no text — reusing that predicate would walk past the erroring message to an unrelated earlier one.
This is the `code-design` skill's "shared predicate, different burden of proof" case, and it would have been a correctness bug dressed as a simplification.

#### Design gate

Three questions, all three recommendations adopted: reuse the existing `error` status (a new `SubagentStatus` member would break consumers' exhaustive switches for no gain), pass `errorMessage` verbatim and uncapped (matching how `record.error` already renders every thrown error), and fix **both** turn loops (the throw-based design makes the resume half nearly free).
Declined at the gate: rendering the child's partial text alongside the error — it is a mid-turn message rather than an answer the child stood behind, and rendering it as the outcome is the confabulation risk the issue exists to close.
The transcript pointer on the failed foreground return is the adopted route to that work instead.

#### Assessor found a touch point my file list missed

`test/helpers/make-subagent.ts` — `createTestSubagent` calls `createSubagentSessionStub()` with no `outputFile` argument, so no fixture can produce a record with a populated `outputFile`.
The transcript-pointer step needs one.
It became preparatory Step 1 rather than inline friction in Step 5.

#### Deferred tidyings

- `test/lifecycle/subagent-session.test.ts` — the assessor offered a `pushAssistantMessage(session, {…})` factory to replace the inlined `{ role: "assistant", content: [{ type: "text", text }] }` literal that `createSession` and `programTurns` each spell out, and that the new error cases would spell a third and fourth time.
  Declined: four short literals is not real friction, and the assessor itself rated it a judgment call rather than a clear win.

#### For the implementing session

- `readTurnFailure` must treat an **absent** `stopReason` as "not a failure".
  The existing test fixture at `test/lifecycle/subagent-session.test.ts` pushes assistant messages with no `stopReason` field at all, so a check written as `!== "stop"` would fail the whole existing suite.
- Step 2's value is in the half that stays green: today's suite passes under both the `??` and the truthiness spelling, so the `result: undefined` case must be asserted to still pass alongside the new `result: ""` case.
- Step 4 asserts at the second call site on purpose.
  A relocated or duplicated line is as unpinned at its new site as at its old one.
