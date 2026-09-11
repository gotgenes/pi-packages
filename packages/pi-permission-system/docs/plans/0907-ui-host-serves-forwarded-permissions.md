---
issue: 907
issue_title: "pi-permission-system：Root session is detected as a subagent when `PI_SUBAGENT_PARENT_SESSION` names its own id — serving heartbeat withdrawn, every forwarded ask fails closed (nicobailon/pi-subagents interop)"
---

# A UI host serves forwarded permissions, and follows its own session id

## Release Recommendation

**Release:** ship independently

No roadmap step references [#907]: Phase 15's spine is token roles, declared effects, and the sandbox seam, and this defect lives in `authority/`'s forwarding lifecycle.
Phase 15's sweep list records it as out of scope with PR [#911] as its close target.
The change is a user-visible `fix:` in three commits, so `./scripts/release/next-version.sh pi-permission-system` will print a patch tag once it lands.

## Problem Statement

An operator runs an interactive Pi session with `nicobailon/pi-subagents` loaded.
Every gated tool call in every subagent child refuses with *"requires approval, but no interactive UI is available"* — while the operator sits at a live TUI that is never prompted.

The review log tells the story in four lines:

```text
15:36:03  forwarded_permission.serving_started     sessionId=01a086cf…
15:36:25  forwarded_permission.serving_stopped     sessionId=01a086cf…
15:37:06  forwarded_permission.request_created     targetSessionId=01a086cf…
15:37:08  forwarded_permission.no_serving_session  servingChannel=heartbeat servingState=absent
```

The root serves for 22 seconds, until its first turn event, and then stops.
The child resolves the parent *correctly* and finds nobody draining the inbox.

`nicobailon/pi-subagents` sets `PI_SUBAGENT_PARENT_SESSION` to the root's own session id **inside the root process**, so spawned runner subprocesses inherit it.
Since [#789] folded `SUBAGENT_PARENT_SESSION_ENV_CANDIDATES` into `SUBAGENT_ENV_HINT_KEYS`, that marker makes `isSubagentExecutionContext` answer `true` for the root, and `ForwardingManager.start` withdraws serving on every turn event.

The reporter's two follow-up findings extend it.
A session id that changes mid-process desynchronizes the serving heartbeat from the inbox the watcher actually drains.
And a headless child whose marker has been overwritten with its own id resolves *itself* as its forwarding target.

## Goals

- A session with a UI serves its own forwarded-permission inbox, whatever `PI_SUBAGENT_*` markers its process environment carries.
- The published serving heartbeat names the session id the inbox watcher is actually draining, even when that id changes mid-process.
- No node resolves itself as its own forwarding target.
- The suite's subagent-detection and forwarding tests are independent of the developer's ambient environment.

This change is **not** breaking.
It alters no config key, default, or output shape; it restores a capability that a third-party environment variable was silently suppressing.
Suggested commit types are `fix:` and `test:`/`docs:`.

## Non-Goals

- **Changing subagent detection.**
  `isSubagentExecutionContext` keeps answering "is this process a child", unchanged.
  See the Design Overview for why the fix belongs at the consumer instead; this is the one place the plan diverges from PR [#911].
- **A Windows retry around the atomic rename.**
  The reporter's side observation (`EPERM … rename` on the heartbeat publish) is filed as [#914] and is out of scope here.
- **Closing [#722].**
  [#907]'s timeline answers that issue's open diagnostic question ("if the ids match, the timer was not running") for the env-resolved class, but [#722] was reported against `@gotgenes/pi-subagents@19.2.1`, which sets no `PI_SUBAGENT_*` variable at all.
  This change does not explain that report, and [#722] stays open.
- **Rescuing a child whose parent marker was overwritten.**
  Once a spawner's `PI_SUBAGENT_PARENT_SESSION` has been replaced with the child's own id, the real parent's identity is gone from the process and nothing in this package can recover it.
  The goal here is an accurate refusal, not a recovery.
- **An ADR for the serving policy.**
  The rule this change lands — a UI host serves — is one line in an existing architecture section, not a new decision record.

## Background

### The three collaborators

`ForwardingManager` (`src/authority/forwarding-manager.ts`) owns the 250 ms poll timer.
`PermissionSession.activate` calls `start(ctx)`, which runs at `before_agent_start` (`src/handlers/session-turn-prep.ts:47`) and at each `tool_call`/skill gate (`src/handlers/permission-gate-handler.ts:52,83`) — so on every turn event.
Its guard is:

```typescript
if (!ctx.hasUI || this.deps.detection.isSubagent(ctx)) {
  this.stop();
  return;
}
```

`ForwardedRequestServer.processInbox(ctx)` is what the timer drives.
It reads `getSessionId(ctx)` **live** on every tick (`src/authority/forwarded-request-server.ts:231`) and ignores any request whose `targetSessionId` differs from it (`:293`).

`resolvePermissionForwardingTarget` (`src/authority/permission-forwarding.ts`) answers where a child sends its ask: `source: "self"` whenever `hasUI`, else the registry entry's `parentSessionId`, else the first non-empty `SUBAGENT_PARENT_SESSION_ENV_CANDIDATES` value.

### The guard's premise expired

The `!ctx.hasUI || isSubagentExecutionContext(ctx)` condition dates to `bb9086e0` (MasuRii, 2026-03-07), the commit that introduced forwarding at all — with no plan, ADR, or recorded rationale.
At that commit `SUBAGENT_ENV_HINT_KEYS` was three per-extension "I am a subagent" markers (`PI_IS_SUBAGENT`, `PI_SUBAGENT_SESSION_ID`, `PI_AGENT_ROUTER_SUBAGENT`), none of which a root could ever carry.
[#22] and [#789] later folded the parent-session names in, on the reasoning that "a process that names a parent session is a child by definition".
That reasoning is correct for a child and false for a root that publishes the variable so its children inherit it, and the guard's meaning changed underneath it.

### Verified upstream facts

Read from `nicobailon/pi-subagents` at tags `v0.66.0` and `v0.67.0`, `src/extension/index.ts`, in `resetSessionState`:

```typescript
if (!process.env[SUBAGENT_CHILD_ENV]) {
  const sessionId = ctx.sessionManager.getSessionId();
  if (sessionId) {
    process.env[SUBAGENT_PARENT_SESSION_ENV] = sessionId;
    parentSessionEnvValue = sessionId;
  }
}
```

Three consequences matter to the design.
The root process genuinely sets the marker to its own id, confirming the report.
`resetSessionState` is reached only from the `session_start` handler, so a session id that changes without a `session_start` leaves the marker holding the **previous** id — which is why an equality comparison against the live id is not a durable fix.
And the child-host guard is `PI_SUBAGENT_CHILD`, confirming the reporter's finding 2: a spawner that sets the parent marker without also setting `PI_SUBAGENT_CHILD` has it overwritten with the child's own id.

The code has not moved: `v0.67.0` is byte-identical in this block.

### The defect does not reach us today

`@gotgenes/pi-subagents` sets no `PI_SUBAGENT_*` variable (`grep -rn "PI_SUBAGENT" packages/pi-subagents/src/` returns only `PI_SUBAGENTS_DEBUG`), and it delegates in-process through the registry channel.
The defect is real and the owner is our detection consumer, but the priority is interop rather than a regression in our own pairing.

### Constraints from AGENTS.md and the package skill

- The per-tick re-announcement must stay **ahead of** the `processing` guard, so a parent holding `processInbox` open for a deliberating human keeps announcing.
- `refreshServing` deliberately writes no review entry per tick — four review entries a second would drown the log.
- A `SubagentDetectionContext` is a narrow interface; widening it obliges an audit of every hand-built ctx literal in `test/`.
  This plan avoids the widening entirely.

## Design Overview

### The fix belongs at the consumer, not the predicate

`isSubagent(ctx)` has exactly one reader that can ever observe `hasUI === true`: the `ForwardingManager.start` guard.
`selectAuthorizer` (`src/authority/authorizer.ts:131`) returns on `ctx.hasUI` before testing it, and `resolvePermissionForwardingTarget` returns `source: "self"` on `hasUI` without consulting the env candidates at all.
So for a UI-bearing process the parent-session hint's *entire* observable effect is "do not serve" — which is the defect.

The guard therefore becomes:

```typescript
if (!ctx.hasUI) {
  this.stop();
  return;
}
```

A node with a UI has a human who can answer, so it drains its own inbox.
That is the same rule `selectAuthorizer` already applies to the ask path, and the two now agree instead of disagreeing for one population.

PR [#911] fixes the predicate instead: it adds `hasUI` to `SubagentDetectionContext` and skips a parent-session hint whose value equals the UI host's own session id.
Both approaches are behaviorally identical for every consumer — verified above, since no other consumer reaches `isSubagent` with `hasUI` true — but the equality comparison depends on the marker tracking the live session id, which the upstream source shows it does not.
Moving the fix to the consumer is also the smaller change: no shared-interface widening, no `hasUI` field threaded into every hand-built detection ctx, and `isSubagent` keeps meaning exactly "is this process a child".

The residual is that `isSubagent(root)` still answers `true` when the marker is set.
That is a latent trap for a future consumer, mitigated by the fact that the module doc for `SelectedAuthority` already warns against re-deriving a role from it and this plan adds the same warning to `SubagentDetector`.

### The heartbeat follows the live session id

`ForwardingManager` publishes under `this.servingSessionId`, captured at the last `start(ctx)`; `processInbox` reads the live id every tick.
Between a mid-process id change and the root's next turn event the two disagree, and both directions fail:

- A child holding the pre-change id sees a live heartbeat, waits, and is ignored by `processInbox` — the full ten-minute stall.
- A child holding the post-change id finds no heartbeat and fast-fails after the grace window.

During a long background subagent run the root is idle, which is exactly when that window is widest.

`refreshServing` gains the migration, so the announcer converges on what the watcher already reads:

```typescript
private refreshServing(): void {
  if (this.servingSessionId === null || this.context === null) {
    return;
  }
  const liveSessionId = normalizePermissionForwardingSessionId(
    getSessionId(this.context),
  );
  if (liveSessionId !== null && liveSessionId !== this.servingSessionId) {
    this.announceServing(liveSessionId);
    return;
  }
  this.deps.serving.markServing(this.servingSessionId);
}
```

Delegating to `announceServing` is deliberate: it already withdraws the old record, marks the new one, and writes the `serving_stopped`/`serving_started` pair.
A migration is a rare, diagnosis-worthy event, so it *should* log — unlike the per-tick refresh, which stays silent because the unchanged-id branch never reaches `announceServing`.

The `servingSessionId` lifecycle after this change, in one place:

| Transition        | Trigger                                                             | Log                                   |
| ----------------- | ------------------------------------------------------------------- | ------------------------------------- |
| `null` → id       | `start(ctx)` on a UI ctx                                            | `serving_started`                     |
| id → same id      | `start(ctx)` again, or a poll tick                                  | none                                  |
| id → different id | `start(ctx)` after a switch, or a poll tick observing a live change | `serving_stopped` + `serving_started` |
| id → `null`       | `stop()`                                                            | `serving_stopped`                     |

`normalizePermissionForwardingSessionId` guards both the migration and `announceServing` itself, so an unreachable id — `getSessionId` returns the `"unknown"` sentinel when `getSessionId()` throws or is empty — keeps the last real record rather than publishing a `serving/unknown.json` nobody can target.

### A node never forwards to itself

`resolvePermissionForwardingTarget` already receives `currentSessionId` (stamped by `ParentAuthorizer` as `requesterSessionId`).
A candidate equal to it is not a usable target in either channel: a request written into your own inbox is drained by a watcher you are not running, and answered by nobody.

Both the registry lookup and the env loop skip such a candidate and continue.
When nothing else resolves, the function returns `null` and the caller's existing message fires — the one that names the env candidates and points a maintainer at the convention — rather than the child hanging on itself.

This is what fixes the reporter's finding 2, and it fixes it for every option considered: PR [#911]'s `hasUI` gate keeps a headless self-namer classified as a child, which means it forwards, and without this guard it forwards to itself.

### Call-site sketch

`ForwardingManagerDeps` loses its `detection` field, so the composition root shrinks:

```typescript
new ForwardingManager({
  forwarder: requestServer,
  serving: composeServingAnnouncers(servingRegistry, servingHeartbeats),
  logger,
});
```

`subagentDetection` stays live in `src/index.ts` — `AuthorizerSelection` is still its consumer — so nothing is orphaned and `pnpm fallow dead-code` stays at 0.

### Tidy-First assessment

The assessor confirmed the design against the real files: the guard, the `detection` field and its single wiring line, the three private serving methods, and `resolvePermissionForwardingTarget`'s registry-then-env shape with `currentSessionId` already threaded all check out as described.
It confirmed that `test/authority/subagent-context.test.ts` and `test/authority/subagent-detection.test.ts` reference `ForwardingManager` nowhere, supporting the predicted-unchanged claim below.

Its one Recommended preparatory commit — extract a non-logging `setServingId` so the migration can mark a new id without `announceServing`'s log line — is **dissolved rather than deferred**: the design settled that the migration *should* log, which is precisely what `announceServing` already does, so `refreshServing` delegates to it and needs no extracted slice.

It also flagged a soft contradiction worth carrying into the TDD Order: with the detector dependency gone, a `forwarding-manager.test.ts` unit test can only assert that setting the env variable has *no effect*, because there is no longer a mock to fool.
The scenario that genuinely reproduces the report needs the composition-root harness, which has the fixtures for it.
The TDD Order below places the regression tests accordingly.

## Module-Level Changes

| File                                                                                   | Change                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/authority/forwarding-manager.ts`                                                  | `start` guards on `!ctx.hasUI` alone; `ForwardingManagerDeps` drops `detection`; the `SubagentDetector` import goes with it; `refreshServing` migrates on a live-id change; `announceServing` refuses an unnormalizable id; import `normalizePermissionForwardingSessionId` alongside the existing `PERMISSION_FORWARDING_POLL_INTERVAL_MS`; class doc records that a UI host always serves                    |
| `src/authority/permission-forwarding.ts`                                               | `resolvePermissionForwardingTarget` skips a registry or env candidate equal to `currentSessionId`; doc comment states why a self-target can never be answered                                                                                                                                                                                                                                                  |
| `src/authority/subagent-detection.ts`                                                  | Doc-only: `SubagentDetector` gains the warning that a UI-bearing node may answer `true` and that serving eligibility is `hasUI`, not this predicate                                                                                                                                                                                                                                                            |
| `src/index.ts`                                                                         | Drop `detection: subagentDetection` from the `new ForwardingManager({...})` bag (line ~218); `subagentDetection` itself stays, consumed by `AuthorizerSelection`                                                                                                                                                                                                                                               |
| `test/authority/forwarding-manager.test.ts`                                            | Remove `mockIsSubagent`, `makeDetection`, and the three detector-behavior tests (~lines 108, 117, 192); add the env-has-no-effect case and the heartbeat-migration cases                                                                                                                                                                                                                                       |
| `test/authority/permission-forwarding.test.ts`                                         | Self-target cases for both channels                                                                                                                                                                                                                                                                                                                                                                            |
| `test/authority/approval-escalator.test.ts`                                            | Env-hygiene `beforeEach`; a self-naming-marker case asserting the actionable unresolved-target refusal                                                                                                                                                                                                                                                                                                         |
| `test/composition-root.test.ts`                                                        | Env-hygiene `beforeEach`; the two serving-eligibility scenarios                                                                                                                                                                                                                                                                                                                                                |
| `test/authority/subagent-context.test.ts`, `test/authority/subagent-detection.test.ts` | Env-hygiene `beforeEach` only — no `hasUI` field, no assertion changes                                                                                                                                                                                                                                                                                                                                         |
| `test/service/permission-events.test.ts`                                               | Env-hygiene `beforeEach`                                                                                                                                                                                                                                                                                                                                                                                       |
| `docs/architecture/architecture.md`                                                    | Serving eligibility stated in the forwarding section; the `forwarding-manager.ts` module-tree entry gains the migration constraint; the env-var inventory row for nicobailon corrected; the stale "Neither nicobailon nor HazAT sets a parent-session env var today" sentence corrected; the two `resolvePermissionForwardingTargetSessionId` headings renamed to the real `resolvePermissionForwardingTarget` |
| `docs/subagent-integration.md`                                                         | A spawner may set the marker in its own root process for inheritance; doing so does not stop that root from serving                                                                                                                                                                                                                                                                                            |
| `.pi/skills/package-pi-permission-system/SKILL.md`                                     | The re-announce paragraph gains the migration rule and the hasUI serving rule                                                                                                                                                                                                                                                                                                                                  |

### Predicted unchanged, with the claim each rests on

- `src/authority/subagent-context.ts` — the fix is at the consumer, so the predicate's inputs and answer are untouched.
  This is the file PR [#911] edits; if it needs a change here, the design was wrong.
- `src/authority/authorizer.ts` and `src/authority/authorizer-selection.ts` — `selectAuthorizer` already returns on `hasUI` before consulting the detector, so its behavior is identical before and after.
- `src/authority/serving-registry.ts` and `src/authority/forwarding-io.ts` — the migration reuses `markServing`/`clearServing` as they stand; no announcer or heartbeat-record shape changes.
- `test/helpers/session-fixtures.ts` — it mocks `ForwardingController` (`start`/`stop`), not `ForwardingManagerDeps`, so the removed field does not reach it.

### Grep obligations before the file list is final

- `new ForwardingManager` and `ForwardingManagerDeps` — two sites total (`src/index.ts:217`, `test/authority/forwarding-manager.test.ts:41`), both listed.
- `detection:` across `test/` — confirm no other fixture constructs the deps bag.
- `SubagentDetector` across `src/` — confirm `AuthorizerSelectionDeps` still imports it after the removal, or the type is orphaned.
- `resolvePermissionForwardingTargetSessionId` across `docs/` — the old name survives in two `architecture.md` headings; historical plans under `docs/plans/` quote the old guard and are **not** to be edited.

## Test Impact Analysis

### New coverage the change enables

The composition-root harness can now express the report directly: start a root session, set the marker to its own id, fire a turn event, and assert the serving registry still holds it.
That scenario was unreachable as a unit test because the defect lives in the interaction between an env read and a turn event, not in either alone.

`forwarding-manager.test.ts` gains the first coverage of a session id that changes *during* a poll — its `makeCtx` already returns `getSessionId` as a `vi.fn()`, so the churn is a `mockReturnValue` away, and the suite already runs on fake timers.

### Tests that become redundant

Three tests in `forwarding-manager.test.ts` assert the detector gating that this change deletes: "does not start polling when the detector reports a subagent context" (~108), "stops any existing poll when called with a subagent context" (~117), and "consults the detector with the current context" (~192).
They are removed with the behavior, not migrated — trimming them is part of the behavior change, not a preparation for it.

### Tests that must stay

The `serving refresh` block's four existing cases all pin invariants this change must preserve, especially "adds no review entry per refresh" and "re-announces while a drain is still in flight".
The `start()` no-UI cases stay: `!ctx.hasUI` is the whole guard now, so they carry more weight than before, not less.

`permission-forwarding.test.ts` passes `env` explicitly on every `resolvePermissionForwardingTarget` case, so it is immune to ambient environment and needs no hygiene `beforeEach`.

### External facts verified at planning time

`vi.stubEnv(key, undefined)` deletes the key rather than setting the string `"undefined"`.
Measured on this repo's pinned Vitest (4.1.11) with a scratch test asserting `"PROBE_KEY" in process.env === false` after stubbing a pre-set variable.

## Invariants at risk

| Invariant                                                                                                                    | Constituency                                                                           | Pinned by                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The per-tick refresh runs ahead of the `processing` guard, so a parent whose human is deliberating keeps announcing ([#719]) | Every other child of that parent, which would otherwise fast-fail on a live parent     | `re-announces while a drain is still in flight` — must stay green through the `refreshServing` rewrite                                                            |
| The refresh writes no review entry per tick ([#719])                                                                         | Anyone reading the review log; four entries a second makes it unreadable               | `adds no review entry per refresh` — the migration branch is the new way to break this, so the test must be extended to run across several ticks with a stable id |
| A no-UI context never polls                                                                                                  | Correctness of the whole forwarding model — a child must not drain its own inbox       | The two `start()` no-UI cases; a mutation deleting the guard entirely must turn them red                                                                          |
| Absence of a heartbeat means unserved, never unknown ([#721])                                                                | A child of a cleanly exited parent, which must fast-fail rather than stall ten minutes | `out-of-process forwarding liveness` in `composition-root.test.ts`; the migration must clear the old record, not leave two live ones                              |
| Registry and filesystem detection evidence still classify a child                                                            | In-process children and extensions storing sessions under the subagent root            | `test/authority/subagent-context.test.ts`, untouched by this change — which is itself the claim                                                                   |

The fourth row is the one this change could regress quietly: a migration that marks the new id without clearing the old leaves two heartbeats alive, and a child holding the stale id would wait out the full timeout instead of fast-failing.
Delegating to `announceServing` — which calls `withdrawServing()` first — is what prevents it, and the TDD Order names the mutation that checks it.

## TDD Order

### 1. Make the suite independent of the ambient environment

`test: clear subagent env hints before each detection and forwarding test`

Adopted from PR [#911].
Add a `beforeEach` clearing every `SUBAGENT_ENV_HINT_KEYS` entry via `vi.stubEnv(key, undefined)` to `test/authority/subagent-context.test.ts`, `test/authority/subagent-detection.test.ts`, `test/authority/approval-escalator.test.ts`, `test/composition-root.test.ts`, and `test/service/permission-events.test.ts`, each paired with an `afterEach` `vi.unstubAllEnvs()` where one is not already present.

Honest framing for the commit body: this repairs no current failure.
Measured — this planning session's environment carries no `PI_SUBAGENT_*` key.
It hardens the suite for a contributor running it from inside a session with `nicobailon/pi-subagents` loaded, where `PI_SUBAGENT_PARENT_SESSION` is set process-wide, and it removes ambient env as a confound for the steps that follow.

This step leads the order because every later step asserts on behavior that reads `process.env`.

Killing mutation: add `PI_SUBAGENT_PARENT_SESSION` to the Vitest environment for the whole run.
Before this step, `composition-root.test.ts`'s in-process child detection cases and `approval-escalator.test.ts` go red; after it, the suite stays green.

### 2. A UI host serves its own inbox

`fix: keep serving forwarded permissions when the session's own id is inherited as a parent marker`

Red — two scenarios in `test/composition-root.test.ts` under a new `interactive serving eligibility` describe, built on the existing `makeBaseCtx` / `fireSessionStart` / `getServingSessionRegistry` fixtures:

1. A root session starts and is serving; `PI_SUBAGENT_PARENT_SESSION` is then stubbed to the root's **own** id; a `before_agent_start` fires; the serving registry still holds the root's id.
   This is the reported case, adopted from PR [#911].
2. The same, with the marker naming a **different** session id.
   This is where this design and PR [#911] diverge, so it must be pinned: a UI host serves regardless of what the marker names, which is what makes the fix survive the id churn Step 3 addresses.

Plus, in `test/authority/forwarding-manager.test.ts`, a case asserting that setting the hint variables has no effect on a UI context's polling — a regression test with no mock to fool, per the assessor's note.

Green — `start` guards on `!ctx.hasUI`; `ForwardingManagerDeps` drops `detection`; the `SubagentDetector` import and the `src/index.ts` wiring line go in the same commit, since the field becomes unused only once the guard stops reading it and there is no green intermediate state.
Remove `mockIsSubagent`, `makeDetection`, and the three detector-behavior tests in the same commit for the same reason.
Add the `SubagentDetector` doc warning.

Killing mutations:

- Restore the consult — make `start` return early when `process.env.PI_SUBAGENT_PARENT_SESSION` is set.
  Both composition-root scenarios go red; the no-UI cases stay green.
- Delete the guard entirely, so `start` polls for every context.
  The two `start()` no-UI cases go red, and the serving-eligibility scenarios stay green — which is the signal that the two halves of the guard are pinned separately.

### 3. The heartbeat follows the session id

`fix: republish the serving heartbeat when the session id changes mid-session`

Red — new cases in `forwarding-manager.test.ts`'s `serving refresh` block, using `makeAnnouncer` and the existing fake timers:

- After `start(ctx)`, `ctx.sessionManager.getSessionId` begins returning a new id; the next tick calls `clearServing(old)` then `markServing(new)`, and every later tick marks the new id alone.
- The migration writes `serving_stopped` with the old id and `serving_started` with the new one — exactly one pair, not one per tick.
- A live id that is unreachable (`getSessionId` throwing, so the `"unknown"` sentinel) does not migrate; the last real id stays served.
- `announceServing` refuses an unnormalizable id at `start` too, so a context with no session id publishes nothing.
- The existing `adds no review entry per refresh` case is extended across several ticks with a stable id, so the migration branch cannot sneak a log line into the steady state.

Green — `refreshServing` re-resolves the live id and delegates a change to `announceServing`; `announceServing` normalizes its argument.

Killing mutations:

- Make `refreshServing` re-mark `this.servingSessionId` unconditionally, ignoring the live id.
  The first two cases go red; the steady-state and unreachable-id cases stay green.
- Have the migration call `markServing(new)` without the withdrawal — replace the `announceServing` delegation with a bare field assignment plus `markServing`.
  The `clearServing(old)` assertion and the `serving_stopped` assertion go red; everything else stays green.
  This is the mutation that guards the two-live-heartbeats invariant.
- Drop the `normalizePermissionForwardingSessionId` guard.
  Only the unreachable-id cases go red.

### 4. A node never forwards to itself

`fix: refuse a forwarding target that names the requesting session`

Red — in `test/authority/permission-forwarding.test.ts`, four `resolvePermissionForwardingTarget` cases (the file passes `env` explicitly, so they need no stubbing):

- An env candidate equal to `currentSessionId`, with a second candidate naming a real parent → the real parent wins, `source: "env"`.
- The only env candidate equal to `currentSessionId` → `null`.
- A registry entry whose `parentSessionId` equals `currentSessionId`, with a usable env candidate → the env candidate wins.
- A self-naming candidate with surrounding whitespace → still skipped, since both sides normalize.

Plus one case in `test/authority/approval-escalator.test.ts`: a headless requester whose only marker names its own id abandons with the "could not resolve a parent session" refusal, and writes **no** request file.

Green — both candidate channels compare against the normalized `currentSessionId` and skip a match.

Killing mutations:

- Remove the skip from the env loop.
  The first, second, and fourth cases go red, plus the escalator case; the registry case stays green.
- Remove the skip from the registry branch.
  Only the third case goes red.

### 5. Documentation

`docs: record that a UI host always serves forwarded permissions`

- `docs/architecture/architecture.md`: state serving eligibility in the forwarding section; add the migration constraint to the `forwarding-manager.ts` module-tree entry; correct the env-var inventory row for `nicobailon/pi-subagents`, which now sets `PI_SUBAGENT_PARENT_SESSION` in its root process; correct the stale sentence claiming neither nicobailon nor HazAT sets a parent-session variable; rename the two `resolvePermissionForwardingTargetSessionId` headings to the real symbol.
- `docs/subagent-integration.md`: a spawner may set the marker in its own root process so children inherit it, and doing so does not stop that root from serving.
  Keep the existing obligation sentence — the convention is unchanged, only its blast radius is clarified.
- `.pi/skills/package-pi-permission-system/SKILL.md`: the serving paragraph gains both new rules.

The module-tree entry states current behavior and cites no issue, per the architecture-doc convention: neither rule is a lint-guarded boundary or an ADR string boundary.

Verification: `pnpm exec rumdl check` on each edited file, and `find .rumdl_cache -type f -delete` first is unnecessary here since no file is moved or renamed.

## Risks and Mitigations

| Risk                                                                                                | Mitigation                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A UI-bearing subagent child now serves its own inbox where it previously did not                    | Serving is not authorization: the inbox is keyed by that node's own session id, so only its own descendants can reach it, and it prompts its own human. `selectAuthorizer` already gives such a node `LocalUserAuthorizer`, so this makes the two paths agree rather than introducing a new one |
| `isSubagent(root)` still answers `true`, misleading a future consumer                               | The predicate's only other consumer tests `hasUI` first by design and documents it; Step 2 adds the same warning to `SubagentDetector`. The alternative — PR [#911]'s predicate fix — was declined because its equality comparison is defeated by the id churn the upstream source confirms     |
| The migration leaves two live heartbeats, turning a fast-fail into a ten-minute stall               | Step 3 names the mutation that checks it (`markServing` without the withdrawal) and asserts `clearServing(old)` explicitly, rather than asserting only on the new id                                                                                                                            |
| The migration floods the review log if a host's `getSessionId` is unstable                          | `announceServing` early-returns on an unchanged id, so a stable id logs nothing; Step 3's extended steady-state test runs several ticks to pin it. An unstable host is a real risk this accepts: a log pair per genuine change is the diagnostic [#722] asked for                               |
| Removing `detection` from `ForwardingManagerDeps` orphans `SubagentDetector` or `SubagentDetection` | Both keep `AuthorizerSelection` as a consumer; `pnpm fallow dead-code` gates it at 0 in Step 2                                                                                                                                                                                                  |
| The self-target skip hides a legitimate parent that happens to share an id                          | Two sessions cannot share an id — `sessionManager.newSession()` assigns a unique one per session, which is the same property the subagent registry's sibling keying rests on                                                                                                                    |

## Open Questions

- Whether [#722] is explained by this defect for any reporter other than [#907]'s.
  Its original report predates `@gotgenes/pi-subagents` setting any marker, so the answer needs a review log from that reporter, not a code reading.
  Deferred to [#722] itself.
- Whether the heartbeat write should survive a transient Windows file lock.
  Filed as [#914], out of scope here.

[#22]: https://github.com/gotgenes/pi-packages/issues/22
[#719]: https://github.com/gotgenes/pi-packages/issues/719
[#721]: https://github.com/gotgenes/pi-packages/issues/721
[#722]: https://github.com/gotgenes/pi-packages/issues/722
[#789]: https://github.com/gotgenes/pi-packages/issues/789
[#907]: https://github.com/gotgenes/pi-packages/issues/907
[#911]: https://github.com/gotgenes/pi-packages/pull/911
[#914]: https://github.com/gotgenes/pi-packages/issues/914
