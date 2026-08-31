---
issue: 792
issue_title: "pi-permission-system: alarm when a registered in-process child session has no permission node"
---

# Alarm when a registered in-process child session has no permission node

## Release Recommendation

**Release:** ship independently

`docs/architecture/architecture.md` Phase 14 Step 7 (`#### Step 7: Alarm when a registered in-process child session has no permission node ([#792])`) carries `Release: independent`, and the step belongs to no `Release: batch "<name>"` group.
The change is additive on both packages — a new optional bus channel in `pi-subagents`, a new diagnostic subscriber in `pi-permission-system` — so neither half needs to wait for a sibling step.

## Problem Statement

Gating is node-local (ADR 0012 decision 1): each node loads its own instance of `pi-permission-system` and gates its own `tool_call`s.
An in-process subagent child that loads **no** instance therefore has no `tool_call` gate, no `before_agent_start` tool filtering, no `permission:` frontmatter resolution, and no ask-forwarding — every tool in its `tools:` allowlist runs ungated.

The parent's own gating is unaffected, so the operator watches the permission system work correctly and never learns the child is unguarded.

Two reachable paths land in that state:

1. One line of JSON in `subagents.json` — `"excludedExtensionPackages": ["npm:@gotgenes/pi-permission-system"]`.
   `pi-subagents` applies the exclusion during package resolution, so the extension's module is never imported in the child and its factory never runs there.
2. A load failure inside the child — a throwing factory, a resolution error.

Nothing in either package refuses or reports either configuration.

## Goals

- The parent node **detects** an in-process child that finished binding its extensions without publishing a permission node, and **announces** it: a `child_node_absent` review-log entry per affected child, plus a visible warning.
- The detection uses a real seam — a signal whose timing is guaranteed by the code, not a sleep or a heuristic delay.
- The announcement is loud enough that an operator running a session sees it, and quiet enough that a parent fanning out ten children does not get ten identical warnings.
- The warning is actionable: it names `excludedExtensionPackages` as the likely cause, hedged, because the parent cannot observe the difference between deliberate exclusion and a load failure.
- The `pi-subagents` half stays a pure announcement (ADR 0002): it emits a fact about the child session it created and knows nothing about permissions.

This change is **not breaking**.
Both halves are additive: a new bus channel that no existing subscriber reads, and a new subscriber for it.
A `pi-permission-system` running against an older `pi-subagents` hears nothing on the new channel and behaves exactly as today.

## Non-Goals

- **Refusing the spawn.**
  The alarm warns and lets the child run.
  Refusing would mean one package overriding another's settings, which cuts against ADR 0002's separation, and the operator who set `excludedExtensionPackages` set it deliberately.
- **Out-of-process children.**
  They share no `globalThis`, and `pi-subagents`' exclusion is in-process only.
  A child in its own process announces itself with `PI_SUBAGENT_PARENT_SESSION`; the keyed service map cannot answer for it.
- **Distinguishing deliberate exclusion from a load failure.**
  The parent cannot; both leave the identical absence.
  The warning names the likelier cause and admits the other in the same sentence.
- **Closing the split-provider extractor gap** — that is #793 / Phase 14 Step 8, a sibling residual of the same ADR 0012 decision 6, and it is not touched here.
- **Fixing `packages/pi-permission-system/src/handlers/lifecycle.ts`'s stale `activate` doc comment** ("skipped for registered subagent children", stale since #796).
  The Tidy-First assessor rejected it as scope creep: the staleness predates and is independent of this change.
  Recorded under `#### Deferred tidyings` in the Planning stage note.

## Background

### The publication signal

Since #699 every node publishes its service into a process-global session-keyed map.
`PermissionServiceLifecycle.activate` (`packages/pi-permission-system/src/service-lifecycle.ts`) calls `publishPermissionsService(sessionId, service)` from the node's `session_start`, keyed by `readSessionId(ctx)` — which reads `ctx.sessionManager.getSessionId()`.
`getPermissionsService(sessionId)` reads the same map.

That is the same session id `pi-subagents` puts on its `subagents:child:*` payloads: `create-subagent-session.ts` takes it from `sessionManager.getSessionId()` after `newSession()`, and the child's own `ctx` resolves it from the same `SessionManager`.

### Why the timing works

Pi's `AgentSession.bindExtensions()` (`../../pi/packages/coding-agent/src/core/agent-session.ts:2438`) does:

```ts
this._applyExtensionBindings(this._extensionRunner);
await this._extensionRunner.emit(this._sessionStartEvent);
```

So when `await session.bindExtensions({})` resolves in `createSubagentSession`, every child extension's `session_start` has already run to completion.
A healthy child has published under its own session id; a child with no node has published nothing.
The question is answerable exactly there, with no race and no sleep.

### The two dead seams

Both alternatives that would have avoided a `pi-subagents` change were checked against the code and are structurally unusable:

| Candidate seam                                                      | Why it fails                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Audit at `subagents:child:disposed`                                 | `SubagentSession.dispose()` (`packages/pi-subagents/src/lifecycle/subagent-session.ts:209`) awaits the child's `session_shutdown` **before** emitting `disposed`, and that shutdown runs `PermissionServiceLifecycle.teardown()` → `unpublishPermissionsService`. A healthy child has already withdrawn its keyed service by the time the parent hears `disposed`, so every child would false-alarm. The ordering is deliberate and documented (#709). |
| Sweep registered children at the parent's next `before_agent_start` | A foreground child runs inside the parent's `subagent` tool call (`SubagentManager.spawnAndWait` awaits `record.promise`), so the parent's next turn begins after that child was disposed and unregistered. The sweep sees only background children still alive at the parent's next turn, and can false-alarm on one whose `bindExtensions()` is still in flight.                                                                                     |

### The contract cost, and why it is small

`packages/pi-permission-system/docs/subagent-integration.md` states the in-process obligation as exactly two events, and ADR 0012 decision 5 says "An implementation's entire obligation is the announcement."
A third channel grows that.

The mitigation is to document it as **optional**: emit it and get the unguarded-child alarm; omit it and get today's silence.
The mandatory obligation stays at two events, and no existing implementation becomes non-conformant.
Of the four implementations in the conformance table, only `@gotgenes/pi-subagents` emits the existing two at all, so the practical population affected by the new channel is one.

### AGENTS.md constraints that apply

- The `session-created` handler in `subagent-lifecycle-events.ts` **must stay synchronous** — the pre-bind ordering is contract.
  The new `bound` handler carries no such requirement (nothing waits on it), but it must not make the module's other handlers async.
- `getSubagentSessionRegistry()` and the session-keyed service map are process-global by `Symbol.for()`; composition-root tests must clear every slot in `afterEach`.
- This is a cross-package change, so the plan lives at `docs/plans/`, not in one package's directory.

## Design Overview

### The new channel

`pi-subagents` gains a fourth member on the existing four-fold `ChildLifecyclePublisher` pattern:

```ts
/** Emitted after the child's extensions have bound and every `session_start` has run. */
export const SUBAGENT_CHILD_BOUND = "subagents:child:bound";

/** Payload for `subagents:child:bound`. */
export interface ChildBoundEvent {
  /** Child session id — matches the `session-created` payload. */
  sessionId: string;
  parentSessionId?: string;
}
```

`createSubagentSession` emits it immediately after `await session.bindExtensions({})` succeeds.
The existing `catch` arm (dispose + rethrow) must **not** emit it: a child whose binding threw never ran, and reporting it as unguarded would be a false alarm about a session that does not exist.

The payload is deliberately identical in shape to `session-created` — same two fields, same meanings — so a subscriber correlating the two needs no translation, and `pi-subagents` announces no fact it did not already announce.
Nothing about permissions, exclusion, or extension identity travels on it.

### The audit

A new `packages/pi-permission-system/src/authority/child-node-audit.ts` owns the decision and the message:

```ts
/** Answers whether the node whose session is `sessionId` published a service. */
export type NodePresenceLookup = (sessionId: string) => boolean;

/** The narrow log seam the audit needs (ISP): a durable record and a visible warning. */
export interface ChildNodeAuditLog {
  review(event: string, details?: Record<string, unknown>): void;
  warn(message: string): void;
}

export class ChildNodeAudit {
  auditBoundChild(event: { sessionId: string; parentSessionId?: string }): void;
}
```

`ChildNodeAuditLog` is structurally satisfied by the existing `SessionLogger`, so `index.ts` passes the session logger and no new logging plumbing is created.
`logger.warn` routes to `session.notify` → `ctx.ui.notify(message, "warning")`, the same visible-warning path `UNTRUSTED_PROJECT_MESSAGE` uses for the untrusted-project case (`packages/pi-permission-system/src/handlers/lifecycle.ts`).

The consumer's call site:

```ts
// index.ts — the lookup is a thunk over the module-level locator, so the
// audit never holds a cached service reference (per the service.ts guidance).
const childNodeAudit = new ChildNodeAudit(
  (sessionId) => getPermissionsService(sessionId) !== undefined,
  logger,
);
const unsubSubagentLifecycle = subscribeSubagentLifecycle(
  pi.events,
  subagentRegistry,
  childNodeAudit,
);
```

`subscribeSubagentLifecycle` gains the third subscription and folds its unsubscribe into the one it already returns, which continues to flow into `PermissionServiceLifecycle`'s `subscriptions` array — so teardown needs no change at all.

The alternative shape the Tidy-First assessor flagged — a sibling `subscribeChildNodeAudit(events, audit)` in the new module — was considered and declined.
`subagent-lifecycle-events.ts` already owns every channel name and payload interface of the announcement contract, and the new channel is part of that contract; splitting the subscription would put `SUBAGENT_CHILD_BOUND` in one module and its only subscriber in another, or duplicate the constant.
Keeping one subscribe/unsubscribe call site makes the module "subscribe to the announcement and dispatch each fact to its owner" — registry for `session-created`/`disposed`, audit for `bound` — with the audit *policy* living in its own module.

### The cadence latch

Both halves of the announcement fire on the same signal, but at different rates:

- The `child_node_absent` **review entry** is written for every affected child, carrying `{ childSessionId, parentSessionId }`.
  That is the durable record an operator or a later diagnostic reads, and it must be complete.
- The **visible warning** fires at most once per parent session.
  The cause is a single config line; a parent that fans out ten children would otherwise emit ten identical warnings.

The latch is a private boolean on the `ChildNodeAudit` instance, with **no re-arm hook**.
This is sufficient because the extension factory is re-invoked on every session switch (`/new`, `/resume`, `/fork`, `/import`) with a fresh `pi`/`ExtensionContext`, so everything constructed inside the factory body — including this auditor — is rebuilt per session generation.
A `session_start` with `reason: "reload"` reuses the same instance and therefore does not re-warn, which is the desired behavior: the operator was already told.

This deliberately does **not** reuse `PermissionServiceLifecycle`'s `announced` latch, and does not extract a shared latch helper.
That latch is unkeyed and per-node with an explicit re-arm in `activate`; this one has different semantics and a different owner, and two uses do not justify an abstraction.

### The warning text

```text
pi-permission-system: subagent child session <id> is running with no permission
node — this extension is not loaded in it, so its tool calls are not gated here.
Most often the package is listed in pi-subagents' `excludedExtensionPackages`; a
failure to load this extension in the child does the same. Further affected
children are recorded in the permission review log as `child_node_absent`.
```

Exported as a builder (not a bare constant) so the child session id can be interpolated, and so tests assert against the real string rather than a paraphrase — the same shape as `UNTRUSTED_PROJECT_MESSAGE`.

### Edge cases

| Case                                      | Behavior                                                                                                                                                                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bindExtensions()` throws                 | No `bound` event, so no audit and no alarm. The child never ran.                                                                                                                                                                           |
| Child has a node                          | `getPermissionsService(sessionId)` resolves; nothing is logged, nothing is warned.                                                                                                                                                         |
| Child's `ctx` exposes no session id       | `readSessionId` returns `null`, the child publishes nothing, and the audit alarms. The message's hedge covers this: it is genuinely a child with no reachable node, even though neither named cause applies. Rare, and the safe direction. |
| Several affected children                 | One review entry each; one warning.                                                                                                                                                                                                        |
| Parent is itself a relaying subagent node | The audit is node-local like every other registration, so a nested parent audits its own children. No special case.                                                                                                                        |
| `pi-subagents` older than the new channel | Nothing is emitted, nothing is audited — today's behavior exactly.                                                                                                                                                                         |
| A third-party in-process implementation   | Emits the optional channel or does not; the alarm is available to any that adopts it.                                                                                                                                                      |

## Module-Level Changes

### `pi-subagents`

- `packages/pi-subagents/src/lifecycle/child-lifecycle.ts` — add `SUBAGENT_CHILD_BOUND`, `ChildBoundEvent`, `bound(event)` on the `ChildLifecyclePublisher` interface, and the matching `emit` arm in `createChildLifecyclePublisher`.
  Extend the module doc comment to name the new channel and its post-`bindExtensions()` timing.
- `packages/pi-subagents/src/lifecycle/create-subagent-session.ts` — call `deps.lifecycle.bound({ sessionId, parentSessionId })` after `await session.bindExtensions({})` resolves, inside the `try` and after the existing comment block, with a comment stating that the `catch` arm must not emit it.
- `packages/pi-subagents/test/helpers/subagent-session-io.ts` — `createChildLifecycleMock()` gains `bound: vi.fn<ChildLifecyclePublisher["bound"]>()`.
  This must land in the **same commit** as the interface widening: `vi.fn<ChildLifecyclePublisher["bound"]>()` cannot be written before the method exists, and without it every deps object built through `createSubagentSessionDeps()` fails to satisfy the widened interface at its call site (used by `create-subagent-session.test.ts` and `subagent-session.test.ts`).
- `packages/pi-subagents/test/lifecycle/child-lifecycle.test.ts` — a case for the new publisher method, mirroring the four existing ones.
- `packages/pi-subagents/test/lifecycle/create-subagent-session.test.ts` — two cases: `bound` is emitted **after** `bindExtensions()` (via `mock.invocationCallOrder`, the pattern the file already uses at lines 168–182), and `bound` is **not** emitted when `bindExtensions()` rejects (the file already has two rejection cases at lines 218 and 241 to extend).
- `packages/pi-subagents/docs/architecture/architecture.md` — line 446's `child-lifecycle` module-tree entry lists the channels (`spawning`, `session-created` before `bindExtensions()`, `completed`, `disposed`); add `bound`.
  This is a current-behavior description, so it carries no issue ref.
- `packages/pi-subagents/docs/comparison-with-upstream.md` — line 55 enumerates the same four channels; add the fifth.
- `packages/pi-subagents/docs/configuration.md` — the `#### Excluding a permission extension` subsection gains a paragraph: excluding the permission system itself now produces a visible warning per parent session and a `child_node_absent` review entry per child, because the child runs ungated.
- `packages/pi-subagents/README.md` — line 270's "Deterministic child detection" bullet names `subagents:child:session-created`; it needs no change (the new channel serves a different purpose), but re-read it in the doc-update step to confirm it does not claim the event list is exhaustive.

### `pi-permission-system`

- `packages/pi-permission-system/src/authority/child-node-audit.ts` — **new**. `NodePresenceLookup`, `ChildNodeAuditLog`, `ChildNodeAudit`, and the exported warning-message builder.
- `packages/pi-permission-system/src/authority/subagent-lifecycle-events.ts` — add `SUBAGENT_CHILD_BOUND`, a `ChildBoundEvent` read-shape interface, a third parameter on `subscribeSubagentLifecycle`, and the third subscription plus its unsubscribe.
  Extend the module doc comment: the two-channel description becomes three, and it must state that the `bound` handler carries no synchronous-dispatch requirement while `session-created` still does.
- `packages/pi-permission-system/src/index.ts` — construct `ChildNodeAudit` over `(sessionId) => getPermissionsService(sessionId) !== undefined` and the existing `logger`, and pass it to `subscribeSubagentLifecycle`.
  `getPermissionsService` is exported from `./service`, which `index.ts` already imports from.
- `packages/pi-permission-system/test/authority/child-node-audit.test.ts` — **new**.
  Unit tests over the audit: silent when the node is present, review + warn when absent, review-per-child but warn-once across several absent children, payload fields on the review entry.
  `makeLogger()` from `test/helpers/session-fixtures.ts` already returns a full `SessionLogger` with `vi.fn()` stubs, so no new fixture is needed.
- `packages/pi-permission-system/test/authority/subagent-lifecycle-events.test.ts` — cases for the third subscription: `bound` reaches the audit with the payload's session id; the returned unsubscribe detaches all three handlers.
- `packages/pi-permission-system/test/composition-root.test.ts` — `makeBaseCtx` gains an optional `notify` capture (see TDD step 1), and a new case drives the real factory on a parent bus, fires `session-created` + `bound` for a child session that never published a service, and asserts both the review entry and exactly one `ui.notify` call.
- `packages/pi-permission-system/docs/subagent-integration.md` — the in-process channel table gains a third row marked optional; a short subsection explains what emitting it buys (the unguarded-child alarm) and states plainly that omitting it is conformant.
  `## What this package does on both ends` gains the audit to its list.
  The conformance table's note on `@gotgenes/pi-subagents` should say it emits all three.
- `packages/pi-permission-system/docs/decisions/0012-cross-node-extension-contract.md` — an `#### Amendment (<date>, [#792]): an optional third in-process channel` under decision 5, recording that the entire *obligation* remains two events, that the third is optional and diagnostic, and why the two cheaper seams are structurally unusable.
  Follows the format of the three existing amendments; `grep -c '#### Amendment'` goes 3 → 4.
- `packages/pi-permission-system/docs/architecture/architecture.md` — mark Step 7 complete: `✅` on the `#### Step 7:` heading (line 1256) **and** on the Mermaid node `S7["Step 7 (#792): alarm on a child with no node"]` (line 1410), plus a `Landed:` note.
  This lands in the implementation doc-update commit, not at ship time.
- `.pi/skills/package-pi-permission-system/SKILL.md` — the `### Event-based subagent integration` paragraph (line 79) says the package "registers/unregisters child sessions in the `SubagentSessionRegistry` on `session-created` / `disposed`"; add the `bound` audit.

### Symbol and value greps run at planning time

- `grep -rn 'child_node_absent' packages/pi-permission-system/{src,test}` → **0** today (the roadmap Outcome's baseline).
- `grep -rn "subagents:child" --include='*.md' packages/ .pi/` → the eight non-archive doc sites listed above (excluding `CHANGELOG.md`, which release-please owns, and `.pi/npm/node_modules/`, which is an installed copy).
- No symbol is removed or renamed by this change, so the removal-grep rules do not apply.

## Test Impact Analysis

**New tests the change enables.**
`child-node-audit.ts` is a pure collaborator over an injected lookup and an injected log, so the whole decision — present/absent, warn-once, review-per-child, message content — is unit-testable with no bus, no factory, and no filesystem.
None of that is reachable today because the behavior does not exist.

**Existing tests that become redundant.**
None.
The change is purely additive on both packages; no existing assertion is subsumed.

**Existing tests that must stay.**
`test/authority/subagent-lifecycle-events.test.ts`'s synchronous-dispatch case ("populates the registry synchronously — before `emit()` returns") pins the pre-bind ordering contract for `session-created`.
Adding a third subscription must not make any handler async, and that test is the guard.
`test/lifecycle/create-subagent-session.test.ts`'s "emits session-created before `bindExtensions()`" pins the mirror-image ordering on the publisher side.

**The composition-root case is the integration proof.**
It is the only test that exercises the real factory across two event buses and the real process-global service map, which is what the design's central claim rests on: the parent's subscriber reads the same map the child's node writes.
A unit test over `ChildNodeAudit` cannot show that, because it stubs the lookup.

## Invariants at risk

| Invariant                                                                                                    | Where it is documented                                                       | What pins it                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The `session-created` handler is synchronous, so the registry entry lands before `bindExtensions()` proceeds | ADR 0012 decision 5; `subagent-lifecycle-events.ts` module doc               | `test/authority/subagent-lifecycle-events.test.ts` — "populates the registry synchronously — before `emit()` returns" (asserts with no `await` between `emit` and the assertion). Adding a third subscription cannot regress it silently. |
| `session-created` is emitted before `bindExtensions()` on the publisher side                                 | `child-lifecycle.ts` module doc; `create-subagent-session.ts` inline comment | `test/lifecycle/create-subagent-session.test.ts:173` — "emits session-created before `bindExtensions()`", via `invocationCallOrder`. The new `bound` emission sits after the same call and must not be inserted before it.                |
| A binding failure disposes and rethrows without leaking a registration                                       | #709; `create-subagent-session.ts` catch arm                                 | `test/lifecycle/create-subagent-session.test.ts:218,241`. The new emission must be inside the success path only; step 3 adds the assertion that `bound` is not emitted on rejection.                                                      |
| Every node publishes under its own session id; nothing is clobbered                                          | ADR 0012 decision 2, #699                                                    | `test/composition-root.test.ts`'s existing keyed-publication cases. The audit only *reads* the map, so it cannot regress this — but the new composition-root case would break loudly if publication timing moved.                         |
| `PermissionServiceLifecycle.teardown()` unsubscribes every session-scoped subscription                       | `service-lifecycle.ts`                                                       | The subscription count grows from one bus subscription to three inside a single unsubscribe closure; `test/composition-root.test.ts`'s teardown case continues to cover it because the returned closure is what teardown calls.           |

No invariant here is quantitative, so no baseline measurement is required beyond the `child_node_absent` grep above (0 → ≥ 1).

## TDD Order

Steps 1–5 are `pi-subagents`; steps 6–9 are `pi-permission-system`; step 10 is docs.
Each leaves both suites green.

1. **`test(pi-permission-system): let a composition-root ctx capture ui.notify calls`** *Preparatory (Tidy First).*
   `makeBaseCtx` in `test/composition-root.test.ts` hardcodes `notify: (): void => {}` (line 153) with no way to observe it, and no test in that 1666-line file asserts on a notify call today.
   Step 9's case must assert both the warning text and the once-per-session cap, so the capture has to exist first.
   Mirror the established `select` shape: add `notify?: (message: string, kind?: string) => void` to the options type and wire `ui.notify: options.notify ?? (() => {})`.
   No behavior change; the existing suite must stay green.
   *Killing mutation:* none — this step adds no assertion of its own.
   Its verification is that `pnpm --filter @gotgenes/pi-permission-system run test` is unchanged.

2. **`test(pi-subagents): pin the bound child-lifecycle channel`** → **`feat(pi-subagents): announce when a child session finishes binding its extensions`** Red: a `child-lifecycle.test.ts` case asserting `publisher.bound({ sessionId, parentSessionId })` emits `SUBAGENT_CHILD_BOUND` with that exact payload.
   Green: add the constant, `ChildBoundEvent`, the interface member, and the `emit` arm; widen `createChildLifecycleMock()` in `test/helpers/subagent-session-io.ts` in the same commit (the mock cannot be written before the method exists, and every `createSubagentSessionDeps()` call site fails to type-check without it).
   *Killing mutation:* change the emitted channel string in `createChildLifecyclePublisher.bound` from `SUBAGENT_CHILD_BOUND` to `SUBAGENT_CHILD_COMPLETED` — the new case must go red while all four existing publisher cases stay green.

3. **`feat(pi-subagents): emit the bound announcement after a child binds its extensions`** Red: two `create-subagent-session.test.ts` cases — `bound`'s `invocationCallOrder` is greater than `session.bindExtensions`'s, and `lifecycle.bound` is not called when `bindExtensions` rejects.
   Green: the call after `await session.bindExtensions({})` inside the `try`.
   This is the commit a user can observe (a new event reaches the bus), so it carries the `feat:`.
   *Killing mutations, one per equivalence class:*
   - Move the `bound(...)` call to just **before** `await session.bindExtensions({})` → must kill the ordering case, leave the rejection case green.
   - Move the `bound(...)` call into a `finally` (or after the `try`/`catch` with no rethrow guard) → must kill the rejection case, leave the ordering case green.

4. **`test(pi-permission-system): pin the child-node audit's decision and cadence`** → **`feat(pi-permission-system): record and warn when a bound child session has no permission node`** Red: `test/authority/child-node-audit.test.ts` — silent when the lookup answers present; one `review("child_node_absent", { childSessionId, parentSessionId })` and one `warn` when absent; three absent children produce three review entries and exactly one `warn`; the warning string contains the child session id and the `excludedExtensionPackages` hedge.
   Green: `src/authority/child-node-audit.ts`.
   *Killing mutations, one per equivalence class:*
   - Make `auditBoundChild` alarm unconditionally (drop the `hasNode` check) → kills the present-node case.
   - Move the latch set so it also guards `review` → kills the review-per-child case, leaves the warn-once case green.
   - Remove the latch entirely → kills the warn-once case, leaves the review-per-child case green.

5. **`feat(pi-permission-system): audit a bound child session for a missing permission node`** Red: `test/authority/subagent-lifecycle-events.test.ts` — emitting `SUBAGENT_CHILD_BOUND` on the bus reaches the audit with the payload's session id, and the returned unsubscribe detaches all three handlers (assert by emitting all three channels after unsubscribing).
   Green: the third parameter, the third subscription, and `index.ts` wiring in the same commit — `subscribeSubagentLifecycle`'s signature widens, so its sole production call site must move with it.
   *Killing mutations:*
   - Delete the `SUBAGENT_CHILD_BOUND` subscription from `subscribeSubagentLifecycle` → kills the dispatch case.
   - Return an unsubscribe that omits the new handler → kills the unsubscribe case, leaves the dispatch case green.
   - In `index.ts`, invert the lookup thunk to `getPermissionsService(sessionId) === undefined` → must kill the composition-root case added in step 6 (it will not kill any case in this step, which stubs the audit; state that explicitly so a green run here is not read as coverage).

6. **`test(pi-permission-system): prove the audit fires across two nodes' buses`** Red then green in one commit (the production code already exists after step 5): the composition-root case.
   Two factory instances on separate buses, the parent's `session_start` fired, then `SUBAGENT_CHILD_SESSION_CREATED` and `SUBAGENT_CHILD_BOUND` emitted on the parent bus for a child session id that never had a `session_start` of its own.
   Assert the `child_node_absent` review entry and exactly one captured `ui.notify`.
   Then emit a second `bound` for another unpublished child and assert the notify count is still one.
   *Killing mutation:* invert the `index.ts` lookup thunk as in step 5 — this case must go red where step 5's cases do not.
   *Note:* this is the only test that exercises the real process-global service map end to end; it is the proof of the design's central claim.

7. **`docs(pi-permission-system): document the optional bound channel and the unguarded-child alarm`** `docs/subagent-integration.md` (channel table row, the new subsection, the "on both ends" list, the conformance note) and the ADR 0012 decision-5 amendment.
   Verify with `grep -c '#### Amendment' packages/pi-permission-system/docs/decisions/0012-cross-node-extension-contract.md` → 4.

8. **`docs(pi-subagents): note the permission warning under excludedExtensionPackages`**
   `docs/configuration.md`'s `#### Excluding a permission extension` subsection, plus the two channel enumerations (`docs/architecture/architecture.md` line 446, `docs/comparison-with-upstream.md` line 55).

9. **`docs(pi-permission-system): mark Phase 14 Step 7 complete`** `✅` on the Step 7 heading and its Mermaid node, plus a `Landed:` note recording the seam finding (the two dead alternatives) and the optional-channel decision.
   Update `.pi/skills/package-pi-permission-system/SKILL.md`'s event-integration paragraph in the same commit.

Steps 7–9 are `docs:` commits and are `hidden: true` changelog types, so the release is cut by the `feat:` commits in steps 2–5.

## Risks and Mitigations

| Risk                                                                                       | Mitigation                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The new channel is read as growing every implementation's obligation                       | Document it as optional in both the ADR amendment and `subagent-integration.md`, in the same sentence that restates the two-event obligation. The conformance table keeps its existing ✓/✗ column meaning (the two mandatory events) rather than demoting anyone. |
| A child whose `ctx` exposes no session id false-alarms about its cause                     | The alarm is still correct — that child genuinely has no reachable node. The message hedges between two causes rather than asserting one, so it does not mislead. Recorded as an accepted residual.                                                               |
| Warn-once hides a second, differently-caused absence in the same session                   | Every affected child gets its own `child_node_absent` review entry with its session id and parent session id, and the warning text says so explicitly. The durable record is complete; only the UI notification is capped.                                        |
| The third subscription accidentally makes a handler async and breaks the pre-bind ordering | The existing synchronous-dispatch test is the guard, and the module doc comment states the constraint. The audit's own work (a map lookup and two log calls) is synchronous by construction.                                                                      |
| A scripted edit of the four-fold publisher pattern corrupts a neighbor                     | The additions are per-member `Edit` calls on distinct blocks, not a regex sweep across similar blocks.                                                                                                                                                            |
| The `bound` emission lands in the `catch` arm or a `finally` during implementation         | Step 3's second case pins it, and its killing mutation is exactly that edit.                                                                                                                                                                                      |

## Open Questions

- Whether a future step should let the audit distinguish exclusion from a load failure by having `pi-subagents` carry its resolved exclusion list on the payload.
  Declined here: it widens the announcement with a settings fact for a message-wording gain, and the operator gate chose the hedged message instead.
  Nothing is filed — this is a recorded non-direction, not a deferred task.
- Whether the sibling in-process implementations in the conformance table would adopt the optional channel.
  Not this change's concern; the table records adoption as it happens.

No follow-up issues were identified during planning, so none were filed.
