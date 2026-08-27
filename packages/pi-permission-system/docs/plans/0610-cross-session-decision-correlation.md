---
issue: 610
issue_title: "pi-permission-system: make UI prompt decisions correlatable in the serving session"
---

# Cross-session prompt/decision correlation

## Release Recommendation

**Release:** ship independently

Phase 13 Step 10 carries `Release: independent` in the roadmap's release batches, and both batches ("presentation-payload", "presentation-contract") have already shipped.
The change is additive to the broadcast contract — a new optional field, a new resolution value, and a new emit site — so it releases as a `feat:` with no migration note.

## Problem Statement

A forwarded subagent ask is prompted on the parent and decided on the child.
The parent emits `permissions:ui_prompt` immediately before showing the dialog, but the terminal `permissions:decision` is emitted by the requesting child's `GateRunner`, on the child's own `pi.events` bus.
Every session gets its own bus, so a parent-side consumer that marks an agent blocked when it sees `permissions:ui_prompt` has no public signal that clears it, and stays blocked forever.

The same defect exists at a second site inside one session: `createFailClosedToolCall` blocks the tool call and writes a `permission_request.blocked` review entry with `resolution: "gate_error"`, but emits no `permissions:decision` ([#753]).
It is the only path that blocks a tool call without a terminal broadcast.

[#752] already supplied the join key.
`ForwardedPermissionRequest.id` **is** the child's minted `requestId`, `buildForwardedAskDetails` sets `details.requestId = request.id`, and `buildUiPrompt` copies it onto the broadcast — so the parent's prompt already carries the correlatable id.
What is missing is one terminal emit on the parent's bus, and one at the fail-closed boundary.

## Goals

- Emit a parent-side `permissions:decision` for a forwarded request the serving session escalates, carrying the same `requestId` its own `permissions:ui_prompt` carried.
- Project the same `surface` / `value` / `agentName` onto that decision as the prompt carried, from the same `PromptPermissionDetails` object, so the two cannot drift.
- Emit a terminal `permissions:decision` from the fail-closed `tool_call` boundary when a gate error blocks the call ([#753]), sharing the request id its `gate_error` review entry already carries.
- Add `gate_error` to `PermissionDecisionResolution` and an optional `forwarding` context to `PermissionDecisionEvent`.
- Keep silently resolved forwarded requests silent: a request the serving node's recorded authority allows or denies emits neither a prompt nor a terminal event, exactly as today.

Not breaking.
Both contract changes are additive: a new optional field, and a new member of a union no code switches over exhaustively.

## Non-Goals

- No change to the child side.
  The child's `GateRunner` keeps emitting its own `permissions:decision` on the child's bus when the forwarded response comes back; this plan adds a second, parent-side event, it does not move one.
- No change to the forwarded wire format (`ForwardedPermissionRequest` / `ForwardedPermissionResponse`) — the id and the display projection it needs are already on it.
- No `decidedBy` on the bus.
  ADR 0011 §6 makes the bus the narrowest renderer and [#726] deliberately kept provenance off it; that holds for the new emit.
- No new resolution values for an `authorizerChain` link's verdict.
  A link's allow/deny is reported as `user_approved` / `user_denied` on both the local and the served path today; correcting that is filed as [#772] and is out of scope here.
- No re-derivation of the child's facts on the parent.
  The event is built from the details the parent already assembled under ADR 0008 §3's disclosure rules.

## Background

Relevant modules, as they stand on `main`:

| Module                                      | Role                                                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/permission-events.ts`                  | The public broadcast contract: channel constants, event types, swallowing emit helpers                                        |
| `src/decision-reporter.ts`                  | `DecisionReporter` (`writeReviewLog` + `emitDecision`) and `GateDecisionReporter`, which owns the `SessionLogger` and the bus |
| `src/handlers/gates/runner.ts`              | Mints the request id per gate and is the only `permissions:decision` emit site today                                          |
| `src/handlers/tool-call-boundary.ts`        | The fail-closed `tool_call` boundary; holds a `DecisionReporter` already and mints its own id in `recordGateError`            |
| `src/authority/forwarded-request-server.ts` | The serving-down role: drains the inbox, resolves against recorded authority, escalates on `ask`, writes the response         |
| `src/authority/local-user-authorizer.ts`    | The single `permissions:ui_prompt` emit site, direct and forwarded alike                                                      |
| `src/permission-ui-prompt.ts`               | `buildUiPrompt` — the one construction site for the prompt broadcast                                                          |

Constraints that apply:

- `AGENTS.md` § Commits — additive contract change, so `feat:`, not `feat!:`.
- The package skill's log-writes section: the `permissions:decision` event carries no `decidedBy`, and the two `writeLine` bounds do not apply to a bus event.
- The package skill's testing section: a new required field on `ForwardedRequestServerDeps` lands in the shared `makeServerDeps` fixture, which all 19 `new ForwardedRequestServer(...)` call sites in the suite go through.
- `docs/architecture/architecture.md` § disclosure ladder: "a cross-extension broadcast receives the minimum needed to stay correlatable", and requester identity (`requesterCwd`, `principal`) crosses to neither the ask details nor the bus.

## Design Overview

### Where the parent-side emit lives

`ForwardedRequestServer.resolveDecision` — the roadmap's target, confirmed with the operator.
It is the site that owns the served request's lifecycle: it writes the `forwarded_permission.*` review entries, builds the escalated ask's details, catches an escalation failure, and writes the response the child polls for.

The emit fires for **every** forwarded request that reaches escalation, and for none that recorded authority resolves.
That branch split is structural rather than a predicate over the decision:

| Serving-side outcome                                            | Terminal event on the parent bus    |
| --------------------------------------------------------------- | ----------------------------------- |
| Recorded authority allows or denies (`check.state !== "ask"`)   | none — unchanged                    |
| Human answers the dialog (approve / approve-for-session / deny) | emitted                             |
| An `authorizerChain` link decides without prompting             | emitted                             |
| No authority reachable (`confirmationUnavailable`)              | emitted                             |
| The escalation throws                                           | emitted, `resolution: "gate_error"` |

The last row is why the emit sits at the server rather than at `LocalUserAuthorizer`: the throw can happen *after* the `ui_prompt` broadcast went out, and the server's existing `catch` is the only place that sees it.
A consumer correlates on `requestId` and ignores an id it never saw prompted, so the two rows that emit without a preceding prompt cost it nothing.

The emit happens immediately after the escalation returns — **before** `applyGrantScope` translates a whole-serving-session grant and **before** the response file is written.
Two consequences, both intended: an IO failure writing the response cannot swallow the terminal signal, and the event's `resolution` reflects the scope the human actually chose rather than the wire translation.

### Consumer call site

```typescript
pi.events.on("permissions:ui_prompt", (raw) => {
  const event = raw as PermissionUiPromptEvent;
  blocked.set(event.requestId, event.forwarding?.requesterAgentName ?? event.agentName);
});
pi.events.on("permissions:decision", (raw) => {
  blocked.delete((raw as PermissionDecisionEvent).requestId);
});
```

No command or path text crosses into the consumer's state, which is the constraint the reporter named.

### Contract changes

```typescript
/** How a permission decision was reached. */
export type PermissionDecisionResolution =
  | "policy_allow"
  // … unchanged members …
  | "confirmation_unavailable"
  /** The gate threw and the boundary blocked, or an escalation failed. */
  | "gate_error";

export interface PermissionDecisionEvent {
  // … unchanged fields …
  /**
   * Forwarding context, present only on a decision this session made while
   * serving another session's forwarded request. Absent on a local decision.
   */
  forwarding?: ForwardedPromptContext | null;
}
```

`forwarding` is optional rather than required-and-`null`: only the served path sets it, so no existing emit path or its exact-equality tests change.
It discloses nothing new on this channel — `permissions:ui_prompt` already carries the identical `ForwardedPromptContext` for the same request — while `requesterCwd` and `principal` stay off the bus as ADR 0008 §3 requires.

### The server's new collaborator

`DecisionReporter` splits so the server can depend on the half it uses:

```typescript
export interface DecisionBroadcaster {
  emitDecision(event: PermissionDecisionEvent): void;
}

export interface DecisionReporter extends DecisionBroadcaster {
  writeReviewLog(event: string, details: Record<string, unknown>): void;
}
```

`GateDecisionReporter` satisfies both unchanged, and `index.ts` passes it as the server's `broadcaster`.
The alternative — handing the server the whole `DecisionReporter` — was rejected: the server already writes review entries through its `DebugReviewLogger`, so it would gain a second, redundant route to the review log.

### The extracted module in its surroundings

```typescript
// ForwardedRequestServer.resolveDecision, escalation branch
this.logger.review("forwarded_permission.prompted", logDetails);
const details = buildForwardedAskDetails(request);
const decision = await this.escalateAsk(details, request.id);
this.broadcaster.emitDecision(buildServedDecisionEvent(details, decision));
return decision;
```

`escalateAsk` absorbs the existing `try`/`catch`, returning the `gate_error` denial the current code returns inline; the emit then covers both outcomes with one call and no second branch.
`buildServedDecisionEvent` and its resolution mapping are module-private helpers beside `buildForwardedAskDetails` and `toAccessFacts`, tested through the server exactly as those are.

```typescript
function buildServedDecisionEvent(
  details: PromptPermissionDetails,
  decision: PermissionPromptDecision,
): PermissionDecisionEvent {
  const facts = details.payload.request;
  return {
    requestId: details.requestId,
    surface: details.surface ?? facts.surface,
    value: details.value ?? facts.value,
    agentName: details.agentName,
    result: decision.approved ? "allow" : "deny",
    resolution: servedResolution(decision),
    origin: null,
    matchedPattern: null,
    forwarding: details.forwarding ?? null,
  };
}
```

Building from `details` — the same object `buildUiPrompt` renders — is what makes "the same projection as the prompt" a property of the code rather than a convention.
`PromptRequestFacts.surface` and `value` are non-nullable, so the fallback for a version-skew request that carried no display projection is the payload's own facts (`""` in the fully degraded case), never a sentinel and never `null`.

`origin` and `matchedPattern` are `null` by construction: an escalated request is one recorded authority did *not* decide, so no rule won.

The resolution mapping reads the decider's own stamp rather than re-deriving it:

```typescript
function servedResolution(decision: PermissionPromptDecision): PermissionDecisionResolution {
  if (decision.decidedBy.kind === "gate_error") return "gate_error";
  if (decision.confirmationUnavailable) return "confirmation_unavailable";
  if (!decision.approved) return "user_denied";
  return decision.state === "approved_for_session" ||
    decision.state === "approved_for_serving_session"
    ? "user_approved_for_session"
    : "user_approved";
}
```

This deliberately does not reuse `deriveResolution` (`src/handlers/gates/helpers.ts`): that function maps a *gate outcome* (a check state plus a gate action plus three collected flags), while the server holds the `PermissionPromptDecision` itself.
Reaching into `handlers/gates/` from `authority/` to reuse a five-parameter function whose first two arguments would be constants is worse than a five-line mapping stated where the decision is held.

### The fail-closed boundary ([#753])

`recordGateError` already mints an id for its review entry; the change hoists it to a local and emits alongside:

```typescript
const requestId = createPermissionRequestId();
reporter.writeReviewLog("permission_request.blocked", { requestId, /* … */ });
reporter.emitDecision({
  requestId,
  surface: bestEffortToolName(event),
  value: bestEffortCommand(event) ?? bestEffortToolName(event),
  result: "deny",
  resolution: "gate_error",
  origin: null,
  agentName: null,
  matchedPattern: null,
});
```

Both calls stay inside `recordGateError`'s swallowing `try`, so `{ block: true }` remains unconditional — the guarantee [#452] and [#752] both leaned on.
`agentName` is `null`: the boundary has no session context, and the throw may have come from anywhere in the pipeline.
The `value` falls back to the tool name for a non-bash call, matching `directValue`'s fallback on the prompt side.

### Design review

Run against the `design-review` checklist, since this adds a field to a shared dependency bag.

| Check                   | Finding                                                                                                                                                                   | Disposition                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Dependency width        | `ForwardedRequestServerDeps` goes 6 → 7 fields; the class reads every one                                                                                                 | Accept — a composition-root wiring bag, and the new field is the narrowest possible seam (`DecisionBroadcaster`, one method) |
| Law of Demeter          | `details.payload.request.surface` in the fallback                                                                                                                         | Accept — `PromptPayload` is a data contract read as data by every renderer (ADR 0011 §2); a method on it would be a renderer |
| Output arguments        | None                                                                                                                                                                      | —                                                                                                                            |
| Parameter relay         | `details` is built once and used by both the escalation and the emit                                                                                                      | Correct direction — the relay is what removes the drift                                                                      |
| Repeated discriminators | `servedResolution` adds a `decision.state` switch; the only other `PermissionDecisionState` reader is `PermissionPrompter`'s review write, which passes the state through | Two sites, below the 3-site threshold; watch                                                                                 |
| Test mock depth         | `makeServerDeps` gains one `{ emitDecision: vi.fn() }` default                                                                                                            | Fine — no cast, no nesting                                                                                                   |

## Module-Level Changes

| File                                               | Change                                                                                                                                                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/permission-events.ts`                         | `PermissionDecisionResolution` gains `"gate_error"`; `PermissionDecisionEvent` gains optional `forwarding?: ForwardedPromptContext \| null`                                                                |
| `src/decision-reporter.ts`                         | Extract `DecisionBroadcaster`; `DecisionReporter extends DecisionBroadcaster` (no implementation change)                                                                                                   |
| `src/handlers/tool-call-boundary.ts`               | `recordGateError` hoists the minted id and emits a `gate_error` decision beside the review entry                                                                                                           |
| `src/authority/forwarded-request-server.ts`        | `ForwardedRequestServerDeps.broadcaster: DecisionBroadcaster`; `resolveDecision`'s escalation branch extracts `escalateAsk` and emits; new module-private `buildServedDecisionEvent` + `servedResolution`  |
| `src/index.ts`                                     | Move the `const reporter = new GateDecisionReporter(logger, pi.events)` construction above the `ForwardedRequestServer` construction and pass it as `broadcaster`                                          |
| `test/helpers/forwarding-fixtures.ts`              | `makeServerDeps` gains a `broadcaster: { emitDecision: vi.fn() }` default                                                                                                                                  |
| `test/authority/forwarded-request-server.test.ts`  | New `describe` for the served terminal decision (8 cases, below)                                                                                                                                           |
| `test/handlers/tool-call-boundary.test.ts`         | Two new cases for the `gate_error` broadcast                                                                                                                                                               |
| `docs/cross-extension-api.md`                      | Decision section: served-forwarded paragraph, `forwarding` payload-field row, `gate_error` resolution row; UI-prompt section: name the paired terminal event                                               |
| `docs/architecture/architecture.md`                | Module-tree entries for `decision-reporter.ts`, `tool-call-boundary.ts`, `forwarded-request-server.ts`; Step 10 `✅` on the heading and the Mermaid node plus a `Landed:` note; two new health-metric rows |
| `README.md`                                        | Fail-closed bullet: the gate error now also broadcasts a terminal decision                                                                                                                                 |
| `.pi/skills/package-pi-permission-system/SKILL.md` | The fail-closed paragraph and the broadcast paragraph, both of which state the current emit behavior                                                                                                       |

Grep discipline applied while building this list:

- No export is removed or renamed, so no consumer grep is owed.
- `permissions:decision` across `src/`, `test/`, `docs/`, `README.md`, and `.pi/skills/` returns the files above plus committed plans and retros, which are historical records and stay as written.
- `gate_error` appears in `docs/configuration.md` (the review-log sentence), `README.md`, and the skill; the configuration sentence is about the review log alone and stays accurate, so only the two behavior statements change.
- No exhaustive `switch` over `PermissionDecisionResolution` exists in `src/` or `test/`, so the new union member breaks nothing.
- `new ForwardedRequestServer(` has one production call site (`src/index.ts:184`) and 19 test call sites, all of which build their deps through `makeServerDeps`.

Health-metric rows to add to the Phase 13 table (baseline `0` is correct as of the 2026-08-15 phase-open snapshot; both files had no emit then):

| Metric                                                                                         | Baseline (2026-08-15) | Phase 13 target |
| ---------------------------------------------------------------------------------------------- | --------------------- | --------------- |
| Terminal decision emit in the fail-closed boundary (`emitDecision` in `tool-call-boundary.ts`) | 0                     | ≥ 1             |
| Parent-side served decision emit (`emitDecision` in `authority/forwarded-request-server.ts`)   | 0                     | ≥ 1             |

## Test Impact Analysis

1. **New tests this enables.**
   The parent-side terminal event has no existing coverage because it did not exist; the server's unit suite already drives a full `processInbox` round trip against a temp forwarding directory, so every branch of the emit is reachable without new scaffolding.
   The boundary's `gate_error` broadcast is likewise directly reachable through the existing `makeReporter` fixture.
2. **Tests that become redundant.**
   None.
   No behavior is replaced; the change is purely additive at both sites.
3. **Tests that must stay as-is.**
   `test/permission-events.test.ts`'s emit-helper cases (the swallowing contract) and `test/decision-reporter.test.ts`'s full-literal factory — the latter constructs a complete `PermissionDecisionEvent`, and the new field being optional is what keeps it compiling untouched.
   The composition-root forwarding round-trip tests simulate the parent by writing the response file directly rather than driving `processInbox`, so they neither exercise nor need the new emit.

## Invariants at risk

| Invariant                                                                                                                          | Origin                                     | Pinned by                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| A forwarded ask carries one id from the child's gate to the human's decision                                                       | Step 9 ([#752])                            | New test: the emitted decision's `requestId` equals the request's `id`, which equals the `ui_prompt`'s                                            |
| The bus carries no `decidedBy`                                                                                                     | Step 6 ([#726]), ADR 0011 §6               | New test asserting the emitted event with `toEqual`, so an added key fails                                                                        |
| The ask details project `surface` / `matchValues` / `boundaryValue` only; `requesterCwd` / `principal` never leave the wire object | [#635], ADR 0008 §3                        | Existing access-facts cases in `forwarded-request-server.test.ts`, unchanged; the new emit reads `details`, which is already the projected object |
| `{ block: true }` is unconditional at the fail-closed boundary                                                                     | [#452], reinforced by [#752]               | Existing "still blocks when the reporter throws" case, extended with a throwing `emitDecision`                                                    |
| A silently resolved forwarded request stays silent                                                                                 | This issue's own compatibility requirement | New test: a request the serving policy allows emits no decision                                                                                   |

Nothing here is quantitative — no budget, prefix, or latency characteristic is touched — so no baseline measurement is owed.

## TDD Order

1. **Split `DecisionBroadcaster` out of `DecisionReporter` and hoist the reporter construction.**
   `src/decision-reporter.ts` gains the narrow interface with `DecisionReporter` extending it; `src/index.ts` moves the `GateDecisionReporter` construction above the `ForwardedRequestServer` construction.
   No behavior change and no new test — `pnpm run check` plus the full suite is the gate.
   Commit: `refactor(pi-permission-system): split DecisionBroadcaster out of DecisionReporter`.
2. **The fail-closed boundary broadcasts its terminal decision ([#753]).**
   Red, in `test/handlers/tool-call-boundary.test.ts`: "emits a terminal decision carrying the same request id as the `gate_error` review entry" and "still blocks when the decision emit throws".
   Green: add `"gate_error"` to `PermissionDecisionResolution` and emit from `recordGateError`.
   Commit: `feat(pi-permission-system): broadcast a terminal decision when a gate error blocks a tool call (#753)`.
3. **The serving session broadcasts a terminal decision for a served forwarded ask ([#610]).**
   Red, in `test/authority/forwarded-request-server.test.ts`, after adding the `broadcaster` default to `makeServerDeps`:
   1. A human approval emits `result: "allow"`, `resolution: "user_approved"`, with the request's `id` as `requestId`.
   2. The emitted `surface` / `value` / `agentName` equal the projection `buildUiPrompt` would render from the same details.
   3. A denial emits `result: "deny"`, `resolution: "user_denied"`.
   4. A whole-serving-session grant emits `user_approved_for_session` — the human's scope, not the post-translation `approved`.
   5. An unreachable authority emits `confirmation_unavailable`.
   6. A failed escalation emits `result: "deny"`, `resolution: "gate_error"`.
   7. A request the serving policy resolves without escalating emits nothing.
   8. A version-skew request with no `surface` / `value` falls back to the payload's request facts.
   9. The emitted event carries `forwarding` with the requester's agent and session, and no `decidedBy` (asserted with `toEqual`).

   Green: the `broadcaster` dep, the `escalateAsk` extraction, `buildServedDecisionEvent` / `servedResolution`, the optional `forwarding` field on `PermissionDecisionEvent`, and the `index.ts` wiring — all in one commit, since the required dep makes the call site a compile error otherwise.
   Commit: `feat(pi-permission-system): emit a parent-side terminal decision for a served forwarded ask (#610)`.
4. **Documentation.**
   `docs/cross-extension-api.md`, `docs/architecture/architecture.md` (module tree, Step 10 `✅` + Mermaid node + `Landed:` note, two new metric rows), `README.md`, and the package skill.
   Commit: `docs(pi-permission-system): document the served forwarded decision broadcast (#610)`.

## Risks and Mitigations

| Risk                                                                                                                    | Mitigation                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A consumer receives a terminal decision for a request it never saw prompted (chain-link or unavailable-authority path)  | Documented in `docs/cross-extension-api.md`: correlate on `requestId` and ignore unknown ids — the same defensive read the contract already prescribes                                          |
| The `index.ts` wiring passes a reporter bound to a different bus than the one `LocalUserAuthorizer` emits the prompt on | Both come from the same `pi.events` in one factory invocation; the reporter hoist keeps them adjacent, and the required dep makes omission a compile error                                      |
| A throwing consumer breaks inbox draining                                                                               | `emitDecisionEvent` swallows listener throws, and `GateDecisionReporter.emitDecision` delegates to it — no new failure mode                                                                     |
| The new emit fires twice for one request if `processInbox` re-reads a request file                                      | Not reachable: the request file is deleted after the response is written, and a re-read would re-escalate the whole ask, which is the pre-existing behavior this change does not touch          |
| `test/composition-root.test.ts` does not drive `processInbox`, so the end-to-end wiring is unasserted                   | Accepted: the polling loop is timer-driven and the existing round-trip tests simulate the parent deliberately; the required-dep compile error plus the server's unit suite cover the two halves |

## Open Questions

- An `authorizerChain` link's verdict is reported as `user_approved` / `user_denied` on both the local and the served path, because `deriveResolution` never sees the decision's `decidedBy`.
  Filed as [#772]; deferred rather than folded in, since correcting it changes the resolution a local decision reports and is therefore a contract change of its own.
- Step 10 is the last open step of Phase 13.
  Closing the phase — the `history/` file, the recomputed baseline, the next phase's findings — is `/plan-improvements` work and stays out of this plan.

[#452]: https://github.com/gotgenes/pi-packages/issues/452
[#635]: https://github.com/gotgenes/pi-packages/issues/635
[#726]: https://github.com/gotgenes/pi-packages/issues/726
[#752]: https://github.com/gotgenes/pi-packages/issues/752
[#753]: https://github.com/gotgenes/pi-packages/issues/753
[#772]: https://github.com/gotgenes/pi-packages/issues/772
