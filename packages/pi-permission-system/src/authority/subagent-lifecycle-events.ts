/**
 * subagent-lifecycle-events.ts — Subscribe to @gotgenes/pi-subagents' child
 * lifecycle events and dispatch each fact to its owner.
 *
 * @gotgenes/pi-subagents publishes its child-execution lifecycle on the Pi
 * event bus (ADR 0002): it no longer calls this package's service directly.
 * We register the child on `session-created`, audit it for a permission node on
 * `bound`, and unregister it on `disposed`.
 *
 * The module subscribes to the announcement and hands each fact to its owner —
 * the registry for the two registration events, the audit for `bound` — so the
 * channel names and payload shapes of the whole contract stay declared in one
 * place.
 *
 * The channel names and payload shapes are declared independently here (the two
 * packages must not depend on each other under jiti) and MUST match the
 * publisher in `@gotgenes/pi-subagents` (`src/lifecycle/child-lifecycle.ts`).
 *
 * The `session-created` handler MUST stay synchronous: the core emits it on the
 * same synchronous call stack immediately before `bindExtensions()`, and the
 * event bus dispatches listeners synchronously, so a synchronous handler lands
 * the registry entry before binding proceeds. Introducing an `await` before
 * `registry.register(...)` would break the pre-bind ordering.
 *
 * The `bound` handler carries no such requirement — nothing waits on it — but it
 * must not make the other two async either, since they share this module.
 */

import type { BoundChildAuditor } from "./child-node-audit";
import type { SubagentSessionRegistry } from "./subagent-registry";

/** Emitted by the core after session creation, before `bindExtensions()`. */
export const SUBAGENT_CHILD_SESSION_CREATED = "subagents:child:session-created";

/**
 * Emitted by the core once the child's extensions have bound, after every child
 * `session_start` handler has run — the one moment a parent can observe what
 * those extensions installed. Optional: an implementation that never emits it
 * is still conformant, and simply forfeits the unguarded-child alarm.
 */
export const SUBAGENT_CHILD_BOUND = "subagents:child:bound";

/** Emitted by the core in the run's `finally` (success and error). */
export const SUBAGENT_CHILD_DISPOSED = "subagents:child:disposed";

/** Minimal event-bus surface this module needs (subscribe only). */
interface LifecycleEventBus {
  on(channel: string, handler: (data: unknown) => void): () => void;
}

/** Fields read from the `session-created` payload (ISP). */
interface ChildSessionCreatedEvent {
  /** Child session id — the registry key. Must match the publisher. */
  sessionId: string;
  parentSessionId?: string;
}

/** Fields read from the `bound` payload (ISP). */
interface ChildBoundEvent {
  /** Child session id — the key its node would have published under. */
  sessionId: string;
  parentSessionId?: string;
}

/** Fields read from the `disposed` payload (ISP). */
interface ChildDisposedEvent {
  /** Child session id — the registry key. Must match the publisher. */
  sessionId: string;
}

/**
 * Subscribe to the subagent child lifecycle.
 *
 * @returns an unsubscribe that detaches every handler (call during
 *          `session_shutdown`).
 */
export function subscribeSubagentLifecycle(
  events: LifecycleEventBus,
  registry: SubagentSessionRegistry,
  audit: BoundChildAuditor,
): () => void {
  const unsubCreated = events.on(SUBAGENT_CHILD_SESSION_CREATED, (data) => {
    const event = data as ChildSessionCreatedEvent;
    registry.register(event.sessionId, {
      parentSessionId: event.parentSessionId,
    });
  });

  const unsubBound = events.on(SUBAGENT_CHILD_BOUND, (data) => {
    const event = data as ChildBoundEvent;
    audit.auditBoundChild({
      sessionId: event.sessionId,
      parentSessionId: event.parentSessionId,
    });
  });

  const unsubDisposed = events.on(SUBAGENT_CHILD_DISPOSED, (data) => {
    const event = data as ChildDisposedEvent;
    registry.unregister(event.sessionId);
  });

  return () => {
    unsubCreated();
    unsubBound();
    unsubDisposed();
  };
}
