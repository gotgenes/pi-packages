# Migration guide: the process-root service slot is removed

Starting with the release that closes #796, the deprecated process-root service accessor and the `globalThis` slot behind it no longer exist.

This is a **breaking change**.
If your extension does not import `getRootPermissionsService`, `publishRootPermissionsService`, or `unpublishRootPermissionsService` from `@gotgenes/pi-permission-system`, nothing here affects you.

## What was removed

| Removed                                            | Replacement                                      |
| -------------------------------------------------- | ------------------------------------------------ |
| `getRootPermissionsService()`                      | `getPermissionsService(sessionId)`               |
| `publishRootPermissionsService(service)`           | — (internal; a node publishes its own service)   |
| `unpublishRootPermissionsService(service)`         | — (internal; a node unpublishes its own service) |
| `PI_PERMISSION_SYSTEM_DEP0001` deprecation warning | — (the deprecated path is gone)                  |

The `Symbol.for("@gotgenes/pi-permission-system:service")` slot is no longer written by any node.
`Symbol.for("@gotgenes/pi-permission-system:session-services")` — the session-keyed map — is the only service slot.

## What to change

Resolve the service of the node whose behavior you mean to affect, keyed by its session id.
The id arrives as a field on the `permissions:ready` payload; inside your own session handler, `ctx.sessionManager.getSessionId()` is the same value.

```typescript
import {
  getPermissionsService,
  PERMISSIONS_READY_CHANNEL,
  type PermissionsReadyEvent,
} from "@gotgenes/pi-permission-system";

let dispose: (() => void) | undefined;

pi.events.on(PERMISSIONS_READY_CHANNEL, (event) => {
  const { sessionId } = event as PermissionsReadyEvent;
  // Idempotent: ready may repeat, so a second emission must be a no-op.
  if (dispose || !sessionId) return;
  dispose = getPermissionsService(sessionId)?.registerAuthorizer(
    "my-link",
    authorize,
  );
});
```

If you are still on a zero-argument `getPermissionsService()` from a release before 27.0.0, migrate through [0794-keyed-service-locator.md](0794-keyed-service-locator.md) first — that release is where the accessor's signature changed.

## Why the deprecation window closed

[ADR 0012](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/decisions/0012-cross-node-extension-contract.md) decision 7 deferred the removal until downstream consumers had migrated.
`pi-permission-model-judge` 2.0.0 — the named migration case — registers through the keyed locator and floors its peer range at `>=27.0.0`, and no other known consumer reads the root slot.

The removal is also narrower than a deprecation window's usual population suggests.
`getRootPermissionsService` did not exist before 27.0.0: it is the name that release gave the old behavior when it reclaimed `getPermissionsService` for the keyed locator.
So no consumer predating the deprecation can be calling it — every caller adopted the name after it was already marked deprecated, in preference to the keyed locator this guide's predecessor recommends.

## What you will see if you miss a call site

The export is gone, so TypeScript reports `TS2724` at your import and plain JavaScript throws `TypeError: getRootPermissionsService is not a function`.

Calling `getPermissionsService()` with **no** argument still answers `undefined` and emits a once-guarded Node warning under code `PI_PERMISSION_SYSTEM_WARN0001`, naming the keyed call and the ready payload.
That warning is deliberately not a `DeprecationWarning`, so `--no-deprecation` does not silence it: a registration that never landed is not something to hide.

## What has not changed

- The `PermissionsService` interface — the five methods and their signatures are untouched.
- The keyed accessors `getPermissionsService` / `publishPermissionsService` / `unpublishPermissionsService`.
- The `permissions:ready`, `permissions:ui_prompt`, and `permissions:decision` payload shapes and cadence.
- Node-locality: a registration is still read only by the node it was made in, and an in-process subagent child still gets its own service.
