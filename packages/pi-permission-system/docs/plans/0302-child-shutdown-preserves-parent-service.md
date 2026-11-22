---
issue: 302
issue_title: "Child subagent shutdown unpublishes the parent's global PermissionsService"
---

# Scope the global PermissionsService slot so a child cannot clobber the parent

## Problem Statement

Every extension instance — the top-level parent and each in-process subagent child — runs the same factory in `packages/pi-permission-system/src/index.ts`.
That factory unconditionally publishes the `PermissionsService` to a single process-global slot (`Symbol.for("@gotgenes/pi-permission-system:service")`) at init and deletes that slot on `session_shutdown`.
Two defects follow.
First, a child's init **overwrites** the parent's published service, so mid-run `getPermissionsService()` resolves the child's service (different runtime/config) rather than the parent's.
Second, the child's `session_shutdown` **deletes** the slot entirely, so after the first subagent finishes a still-live parent (and any third-party consumer) gets `undefined`.

The fix must keep `/reload` working: the slot is intentionally overwrite-safe for reload today, so whichever path we take cannot regress re-publication of a reloaded parent's service.

## Goals

- A live parent's `PermissionsService` survives an in-process child subagent's shutdown.
- Mid-run, `getPermissionsService()` resolves the parent's service, never a child's.
- Teardown removes only the slot the instance actually owns.
- `/reload` still re-publishes the reloaded parent's service (overwrite-safe), even if reload re-runs the factory.
- **Breaking:** `unpublishPermissionsService` gains a required `service` parameter (identity compare-and-delete).
  The package's only public export is `service.ts`, so this is a public API change → `feat!:`.

## Non-Goals

- No change to process-based subagent extensions (env-hint / filesystem detection).
  They run in their own OS process with their own `globalThis`; each still publishes normally.
- No change to the event-bus RPC fallback (`permissions:rpc:check` / `:prompt`).
  Those handlers stay registered at init and remain available at load.
- No change to the `SubagentSessionRegistry` storage, keying, or lifecycle-event subscription (#296, #298 already settled those).
- No change to the `permissions:decision` event or the gate/forwarding logic.

## Background

Relevant modules:

- `src/index.ts` — the composition root.
  Constructs `permissionsService`, calls `publishPermissionsService(...)` and `emitReadyEvent(pi.events)` at init, and wires a `session_shutdown` cleanup closure that calls `unpublishPermissionsService()`.
- `src/service.ts` — the public accessor (`publishPermissionsService`, `getPermissionsService`, `unpublishPermissionsService`, the `PermissionsService` interface).
  The package `exports` map points `.` at this file.
- `src/subagent-context.ts` — `isSubagentExecutionContext(ctx, subagentSessionsDir, registry?)`.
  Branch 1 (registry by session id) is the only signal that identifies an **in-process** child; branches 2–3 (env, filesystem) identify **process-based** subagents.
- `src/subagent-registry.ts` — the process-global `SubagentSessionRegistry`, populated by the parent's `subagents:child:session-created` subscription before the child's `bindExtensions()`.
- `src/handlers/lifecycle.ts` — `SessionLifecycleHandler`.
  `handleSessionStart(event, ctx)` is the first lifecycle event that carries a `ctx` (and therefore a session id).
  `handleSessionShutdown()` runs the injected cleanup closure.
- `src/permission-events.ts` — `emitReadyEvent` / `PERMISSIONS_READY_CHANNEL`, documented as "emitted once on extension load."

Key constraint discovered during investigation: **the factory has no `ctx` at init**, so it cannot read the child's session id and cannot consult the registry to know whether it is an in-process child.
`FakePi` / `ExtensionAPI` expose no session id to the factory body.
The earliest moment child-ness can be determined is `session_start`, where `ctx.sessionManager.getSessionId()` is available and the parent has already registered the child.

Constraint from `AGENTS.md` / the package skill: `globalThis` + `Symbol.for()` is the prescribed cross-extension channel; module-scoped singletons do not survive jiti isolation.
The fix stays on that channel.

The `#297` composition-root suite (`test/composition-root.test.ts`) added a `multi-instance global service interplay` block that characterizes this exact bug: one test asserts the buggy `undefined`, and an `it.fails("DESIRED: ...")` asserts the fixed behavior.

## Design Overview

### Decision model

The publish decision moves from factory-init to `session_start`, gated on a precise **in-process child** check (registry only — not the full `isSubagentExecutionContext`).
Teardown becomes identity-scoped: an instance removes the slot only if it still holds that instance's own service object.

Why the registry-only gate (not `isSubagentExecutionContext`): the env-hint and filesystem branches identify **process-based** subagents, which run in a separate OS process with their own `globalThis` and *should* publish (they are the sole owner of their process's slot).
Only the registry branch identifies an **in-process** child sharing the parent's `globalThis` — the one case that must skip publishing.
Using the full detector would wrongly suppress publication inside a process-based subagent's own process.

Why publish at `session_start` rather than init: init has no `ctx`, so the in-process child cannot be distinguished from a reloaded parent at that point — both present as "slot already occupied."
The registry signal (the only reliable discriminator) needs a session id, which first appears at `session_start`.

Why compare-and-delete on teardown: if `/reload` re-runs the factory, the old instance's `session_shutdown` can fire after the new instance's `session_start` re-publish.
An unconditional delete (or a `didPublish` boolean) would wipe the new generation's service.
Comparing object identity makes teardown safe regardless of shutdown/init ordering, and also makes a child's shutdown a no-op (the child never owned the slot).

### Lifecycle trace (multi-instance, shared `globalThis`)

```text
parent init             → construct adapter A (no publish, no ready yet)
parent session_start    → not in registry → publish(A); emit ready   slot = A
child  init             → construct adapter B (no publish, no ready yet)
child  session_start    → in registry     → skip publish; emit ready  slot = A
child  session_shutdown → unpublish(B): current(A) !== B → no-op       slot = A
parent still live       → getPermissionsService() === A   ✓
```

### Reload trace (factory re-runs for the top-level session)

```text
new parent init          → construct adapter A'  (no publish)
new parent session_start → not in registry → publish(A')              slot = A'
old parent session_shutdown → unpublish(A): current(A') !== A → no-op  slot = A'
```

(If the old shutdown instead fires first: `unpublish(A)` deletes A, then the new `session_start` publishes A'.
Either order ends at A'.)

### New / changed shapes

`unpublishPermissionsService` becomes identity-scoped (breaking signature):

```typescript
/**
 * Remove the service from globalThis, but only when the current slot still
 * holds `service`. A child instance (which never published) and a superseded
 * reload generation are therefore no-ops.
 */
export function unpublishPermissionsService(service: PermissionsService): void {
  if (getPermissionsService() === service) {
    delete (globalThis as Record<symbol, unknown>)[SERVICE_KEY];
  }
}
```

New exported helper in `subagent-context.ts` (extracted from branch 1, returns a value, reused by two call sites):

```typescript
export function isRegisteredSubagentChild(
  ctx: ExtensionContext,
  registry: SubagentSessionRegistry,
): boolean {
  try {
    const sessionId = ctx.sessionManager.getSessionId();
    if (!sessionId) {
      return false;
    }
    return registry.has(sessionId);
  } catch {
    return false; // getSessionId() unavailable → treat as not-a-registered-child
  }
}
```

Composition-root wiring in `index.ts` (the new collaborator passed into the lifecycle handler):

```typescript
const activateServiceForSession = (ctx: ExtensionContext): void => {
  if (!isRegisteredSubagentChild(ctx, subagentRegistry)) {
    publishPermissionsService(permissionsService);
  }
  emitReadyEvent(pi.events);
};
// ...
const lifecycle = new SessionLifecycleHandler(session, activateServiceForSession, () => {
  rpcHandles.unsubCheck();
  rpcHandles.unsubPrompt();
  unsubSubagentLifecycle();
  unpublishPermissionsService(permissionsService);
});
```

`SessionLifecycleHandler.handleSessionStart` calls `this.activateService(ctx)` at the end of its body (after config refresh / reset, so the published adapter sees current runtime state).
This is a Tell-Don't-Ask seam: the handler announces "session started"; the composition root decides whether to publish.
Dependency width of the handler goes from 2 → 3 constructor deps — within the design-review threshold.

### `permissions:ready` semantics (confirmed with maintainer)

`emitReadyEvent` moves from init to `session_start` (emitted after the gated publish).
This preserves the #297 ordering contract — a consumer reacting to `permissions:ready` can still resolve the service immediately — at the cost of changing the event's timing from "once on load" to "once per `session_start`."
For an in-process child, `ready` still fires at its `session_start`, and `getPermissionsService()` then resolves the parent's service (already published), so the contract holds for children too.

### Edge cases

1. No session id (`getSessionId()` throws or returns empty) → `isRegisteredSubagentChild` returns `false` → instance publishes.
   Safe default for top-level / process-based contexts.
2. Process-based subagent (env hint / filesystem) → not in registry → publishes into its own process's slot.
   Unchanged from today.
3. `/reload` (`session_start` reason `"reload"`) → `activateServiceForSession` runs again, re-publishing the same adapter (idempotent) and re-emitting `ready`.
   Acceptable under the new per-`session_start` semantics.
4. Concurrent sibling children → none publishes; the slot stays the parent's throughout. (The unsound stash/restore alternative was rejected for exactly this case.)

## Module-Level Changes

| File                                | Change                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/service.ts`                    | `unpublishPermissionsService(service)` → required param, identity compare-and-delete. Update doc comments (drop "overwrites … safe for /reload" framing on publish; describe identity-scoped delete).                                                                                                                                                                              |
| `src/subagent-context.ts`           | Add exported `isRegisteredSubagentChild(ctx, registry)`; refactor `isSubagentExecutionContext` branch 1 to call it.                                                                                                                                                                                                                                                                |
| `src/handlers/lifecycle.ts`         | `SessionLifecycleHandler` gains a third constructor dep `activateService: (ctx) => void`; `handleSessionStart` calls it after refresh/reset.                                                                                                                                                                                                                                       |
| `src/index.ts`                      | Remove init-time `publishPermissionsService(...)` and `emitReadyEvent(...)`. Add `activateServiceForSession`, pass it to `SessionLifecycleHandler`. Change cleanup closure to `unpublishPermissionsService(permissionsService)`. Swap the `isSubagentExecutionContext` import usage as needed (the existing `canRequestPermissionConfirmation` call still uses the full detector). |
| `src/permission-events.ts`          | Update `PERMISSIONS_READY_CHANNEL` / `emitReadyEvent` doc comments: emitted at `session_start`, not load.                                                                                                                                                                                                                                                                          |
| `docs/cross-extension-api.md`       | Update: service published at `session_start` (not startup); `permissions:ready` timing in the events table and the "Ready Event" section; the reload note; the "publishes a fresh service on re-initialization" note. Add a short note that an in-process child does not publish and that `getPermissionsService()` resolves the parent's service.                                 |
| `docs/architecture/architecture.md` | Line ~457: "publishes … during startup" → at `session_start`, gated for in-process children.                                                                                                                                                                                                                                                                                       |

Grep sweep confirmed no other `src/` consumers of `unpublishPermissionsService` (sole caller is the `index.ts` cleanup closure) and no other `emitReadyEvent` caller.
The package skill (`.pi/skills/package-pi-permission-system/SKILL.md`) does not document publish-at-load / ready-at-load specifics, so no skill edit is required (re-grep before finalizing the docs commit).

## Test Impact Analysis

1. **New tests the change enables.**
   - `service.test.ts`: identity compare-and-delete — `unpublish(A)` clears only when the slot is `A`; `unpublish(B)` while slot is `A` is a no-op.
   - `subagent-context.test.ts`: `isRegisteredSubagentChild` unit coverage (registered hit, miss, empty/absent session id, `getSessionId` throw).
   - `composition-root.test.ts`: the `it.fails("DESIRED: the parent's service survives a child's shutdown")` flips to a real pass; a new assertion that mid-run `getPermissionsService()` resolves the **parent's** adapter, not the child's.
2. **Tests that become redundant.**
   - `composition-root.test.ts`: the `it("currently leaves the parent without a resolvable service after the child shuts down")` characterization test asserts the bug and must be removed (its premise is now false).
3. **Tests that stay but need wiring updates (not redundant — they exercise the moved seam).**
   - `composition-root.test.ts` "ready emitted after service publication" and "shutdown teardown chain": must now fire `session_start` (publish/ready moved off init).
     Their contracts are unchanged.
   - `handlers/lifecycle.test.ts`: the `new SessionLifecycleHandler(session, cleanupRpc)` instantiation gains the `activateService` stub; add a case asserting `handleSessionStart` invokes it.
   - `service.test.ts` `afterEach` and the existing no-arg `unpublishPermissionsService()` calls: update to pass a service (e.g. `afterEach` clears via `const s = getPermissionsService(); if (s) unpublishPermissionsService(s);`).

## TDD Order

1. **`refactor: extract isRegisteredSubagentChild from subagent detector` (`test:` + `refactor:`)** Red: add `subagent-context.test.ts` cases for `isRegisteredSubagentChild` (hit / miss / empty id / throw).
   Green: add the exported helper and rewire `isSubagentExecutionContext` branch 1 to call it.
   Existing `isSubagentExecutionContext` tests must stay green (behavior unchanged).
   Commit: `refactor: extract isRegisteredSubagentChild seam (#302)`.

2. **`feat!: identity-scoped unpublishPermissionsService`** This step removes the no-arg signature, so the sole `src/` caller (`index.ts` cleanup closure) and all `service.test.ts` no-arg calls break at the type level — fold them into this one commit.
   Red: add `service.test.ts` cases — `unpublish(A)` clears only when slot is `A`; `unpublish(B)` while slot is `A` is a no-op; update `afterEach` and existing no-arg calls to pass a service.
   Green: change `unpublishPermissionsService(service)` to compare-and-delete; update the `index.ts` cleanup closure to pass `permissionsService`.
   Commit: `feat!: scope service teardown to the publishing instance (#302)`.

3. **`fix: publish the service at session_start, gated for in-process children`** This is the bug fix and the user-visible behavior change.
   Adding the `activateService` dep to `SessionLifecycleHandler` breaks its sole production instantiation and the `handlers/lifecycle.test.ts` instantiation at the type level — fold those into this commit.
   Red: update `composition-root.test.ts` — remove the bug-characterization test; convert `it.fails(...)` to a passing test; fire `session_start` (with a non-child parent ctx and a registry-registered child ctx) in the multi-instance helper, the teardown-chain test, and the ready-ordering test; add the "mid-run resolves the parent's adapter" assertion.
   Update `handlers/lifecycle.test.ts` instantiation + add an "invokes activateService on session_start" case.
   Green: in `index.ts`, remove init-time publish + `emitReadyEvent`, add `activateServiceForSession`, pass it into `SessionLifecycleHandler`; in `lifecycle.ts`, accept and invoke `activateService` in `handleSessionStart`.
   Commit: `fix: keep the parent's service published across child shutdown (#302)`.

4. **`docs: align service publication and ready-event timing`** Update `service.ts` / `permission-events.ts` doc comments, `docs/cross-extension-api.md` (events table, Ready Event section, reload + re-initialization notes, in-process child note), and `docs/architecture/architecture.md`.
   Re-grep the package skill before committing; include it only if it documents the old timing.
   Commit: `docs: document session_start service publication and ready timing (#302)`.

## Risks and Mitigations

- **Risk:** an in-process child never fires `session_start`, so it never reaches the gate.
  **Mitigation:** that is the desired outcome — the child simply never publishes; the parent's slot is untouched.
  The parent always fires `session_start`, so it always publishes.
- **Risk:** a load-time consumer that resolved the service at extension load now sees `undefined` until `session_start`.
  **Mitigation:** the documented best practice is to resolve per-use, and `permissions:ready` (the documented readiness signal) moves to `session_start` alongside the publish, so a `ready`-driven consumer is unaffected.
  Called out in the docs commit.
- **Risk:** `unpublishPermissionsService` signature change breaks an external caller.
  **Mitigation:** it is a provider-side lifecycle function; external consumers use only `getPermissionsService()`.
  Shipped as `feat!:` so release-please bumps major and the change is visible in the changelog.
- **Risk:** using the wrong detector (full `isSubagentExecutionContext`) would suppress publication inside a process-based subagent's own process.
  **Mitigation:** the gate deliberately uses the registry-only `isRegisteredSubagentChild`; the distinction is documented in Design Overview and covered by the helper's unit tests.

## Open Questions

- Should `permissions:ready` be emitted at most once per instance (guarded) rather than on every `session_start` including reloads?
  Deferred: re-emitting on reload is harmless and arguably correct ("re-readied for this session"); revisit only if a consumer reports duplicate-`ready` churn.
