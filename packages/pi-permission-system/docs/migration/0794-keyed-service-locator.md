# Migration guide: the keyed service locator and the ready cadence

Starting with the release that closes #794, two things change for an extension that talks to pi-permission-system:

1. `getPermissionsService()` requires the session id of the node whose service you want.
2. `permissions:ready` fires at least once per session and may repeat, so a registration handler must be idempotent.

Both are **breaking changes**.
If your extension neither imports `@gotgenes/pi-permission-system` nor listens on `permissions:ready`, nothing here affects you.

## Why the accessor changed

One Pi process can host several **nodes** — a root session and each of its in-process subagent children are separate session runtimes, each with its own gates, registries, and authorizer chain.
A registration is read by the node it was made in, so "the permission service" was never a single thing to ask for.
The old zero-arg accessor answered with the **process root's** service, which is the wrong node in every node but the root: inside a subagent child it handed back the parent's service, so a chain link landed where the child's gates never read it, and a policy query answered against the parent's config.

That is the defect behind the duplicate-registration errors reported in #699, and the contract that replaces it is [ADR 0012](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/decisions/0012-cross-node-extension-contract.md).
Each node now publishes its own service under its own session id, and you resolve the one you mean.

## What to change

| Before                                 | After                                                              |
| -------------------------------------- | ------------------------------------------------------------------ |
| `getPermissionsService()`              | `getPermissionsService(sessionId)`                                 |
| — (no equivalent)                      | `getRootPermissionsService()` — the old behavior, still deprecated |
| `publishPermissionsService(service)`   | `publishRootPermissionsService(service)`                           |
| `unpublishPermissionsService(service)` | `unpublishRootPermissionsService(service)`                         |

The session id arrives as a field on the `permissions:ready` payload.
Inside your own session handler, `ctx.sessionManager.getSessionId()` is the same value.

```typescript
let dispose: (() => void) | undefined;

pi.events.on(PERMISSIONS_READY_CHANNEL, (event) => {
  const { sessionId } = event as PermissionsReadyEvent;
  // Idempotent: ready may repeat, so a second emission must be a no-op.
  if (dispose || !sessionId) return;
  void (async () => {
    const { getPermissionsService } = await import(
      "@gotgenes/pi-permission-system"
    );
    dispose = getPermissionsService(sessionId)?.registerAuthorizer(
      "my-link",
      authorize,
    );
  })();
});

pi.on("session_shutdown", () => {
  dispose?.();
  dispose = undefined;
});
```

That handler is the whole registration.
A second attempt from your own `session_start` — the dual-path workaround that load-order ambiguity used to require — is no longer needed and should be deleted.

## The session id is required, not optional

`getPermissionsService` takes `sessionId` as a required argument rather than an optional one, and there is no zero-arg overload.
`PermissionsReadyEvent.sessionId` is `string | null`, and any shape where a `null` could reach the locator and fall through to the process root's slot would restore exactly the wrong-node bug the contract removes.

A TypeScript consumer gets a compile error.
A JavaScript consumer, or one compiled against an earlier major, still reaches the function with no argument: that call returns `undefined` — never another node's service — and emits a once-guarded Node warning:

```text
(node:12345) [PI_PERMISSION_SYSTEM_WARN0001] Warning: getPermissionsService() was called without a session id and answered undefined. …
```

Watch for it after upgrading.
A consumer that guards with `if (!service) return;` treats the `undefined` as "the permission system is not loaded" and silently registers nothing, so the warning is the only evidence that a link stopped being consulted.
It is deliberately not a `DeprecationWarning`, so `--no-deprecation` does not silence it.

## The ready cadence

`permissions:ready` used to be described as firing once, at each node's `session_start`.
It now fires **at least once per session, and may repeat**: each node emits it at `session_start` after publishing, and again at its first `before_agent_start` — which runs after every extension's `session_start` and before any tool call, hence before any ask.

The second emission is what makes the ready handler a sufficient registration site regardless of extension load order.
The cost is that a handler which registers unconditionally now hits `registerAuthorizer`'s duplicate-name throw on every session rather than only on a user-initiated `/reload`.
Guard it with a stored dispose handle, as shown above, and release the handle on `session_shutdown`.

`registerToolInputFormatter` and `registerToolAccessExtractor` throw on a duplicate name for the same reason and want the same guard.

## What has not changed

- The `PermissionsService` interface — the five methods and their signatures are untouched.
- The `permissions:ready`, `permissions:ui_prompt`, and `permissions:decision` payload shapes.
- The process-root slot itself: a node that is not an in-process subagent child still publishes to it, so `getRootPermissionsService()` answers exactly as the old zero-arg accessor did.
  It remains deprecated (`PI_PERMISSION_SYSTEM_DEP0001`), and its removal is deferred to a later major.
