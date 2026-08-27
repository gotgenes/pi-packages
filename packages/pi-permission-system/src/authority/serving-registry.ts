/**
 * serving-registry.ts — Which sessions are draining a forwarded-permission inbox.
 *
 * A session with a UI that is not itself a subagent polls its own
 * `<forwardingDir>/sessions/<id>/requests/` directory (see `ForwardingManager`)
 * and answers whatever a child forwards to it. Nothing else in the process can
 * observe that, so a child whose parent is *not* polling has no way to tell
 * "a human is being asked" from "nobody is home", and waits out the full
 * forwarding timeout before denying (#719).
 *
 * This registry publishes that fact: the polling session marks itself while it
 * polls, and a forwarding child checks whether its resolved target is marked.
 *
 * The single instance is stored on `globalThis` (via `Symbol.for()`) for the
 * same reason `SubagentSessionRegistry` is: each session's `ResourceLoader`
 * creates its own jiti instance and its own event bus, so the parent's
 * permission-system instance and an in-process child's instance share no
 * module state — only process globals. See `getServingSessionRegistry()`.
 *
 * The signal is meaningful only for an **in-process** child (one that resolved
 * its target through `SubagentSessionRegistry`, i.e. a forwarding target with
 * `source: "registry"`). A child in another process shares no `globalThis` with
 * its parent and must not read anything into an absent mark.
 */

/** Process-global key for the shared registry slot. Exported for test teardown. */
export const SERVING_SESSION_REGISTRY_KEY = Symbol.for(
  "@gotgenes/pi-permission-system:serving-registry",
);

/**
 * Announce-side seam: the polling session marks and clears itself.
 *
 * `ForwardingManager` depends on this rather than the concrete registry so it
 * neither reads the store nor gains a query it has no business making (ISP).
 */
export interface ServingAnnouncer {
  /**
   * Record that `sessionId` is polling its inbox.
   *
   * Idempotent, and called on every poll tick rather than once per session: an
   * announcement that can decay (the filesystem heartbeat) has to be kept
   * current, and one that cannot (this registry) costs a set insertion to say
   * so again.
   */
  markServing(sessionId: string): void;
  clearServing(sessionId: string): void;
}

/**
 * Fan an announcement out to every channel a serving session publishes on.
 *
 * A session announces to the process-global registry (for its in-process
 * children) and to the filesystem (for children in other processes). Composing
 * them keeps `ForwardingManager` holding one collaborator, so adding or
 * removing a channel never reaches the poll loop.
 */
export function composeServingAnnouncers(
  ...announcers: readonly ServingAnnouncer[]
): ServingAnnouncer {
  return {
    markServing(sessionId: string): void {
      for (const announcer of announcers) {
        announcer.markServing(sessionId);
      }
    },
    clearServing(sessionId: string): void {
      for (const announcer of announcers) {
        announcer.clearServing(sessionId);
      }
    },
  };
}

/**
 * Query-side seam: a forwarding child asks whether its target is draining.
 *
 * `servingIds()` exists for the diagnostic review entry a child writes when it
 * abandons an unserved request — the mismatch between the id it forwarded to
 * and the ids actually being served is the whole diagnosis.
 */
export interface ServingLookup {
  isServing(sessionId: string): boolean;
  servingIds(): readonly string[];
}

/**
 * Registry of sessions currently draining a forwarded-permission inbox.
 *
 * A process-global singleton — obtain it via {@link getServingSessionRegistry},
 * never `new` (see that accessor for why). Written exclusively by the owning
 * session's `ForwardingManager`, keyed by that session's own id, so one
 * session's shutdown cannot clear another's mark.
 *
 * A mark left behind by a session that died without `session_shutdown` makes a
 * child wait out the full timeout instead of abandoning early — the same
 * behavior as before this signal existed, which is the safe direction to fail.
 */
export class ServingSessionRegistry implements ServingAnnouncer, ServingLookup {
  private readonly serving = new Set<string>();

  /** Record that `sessionId` is polling its inbox. Idempotent. */
  markServing(sessionId: string): void {
    this.serving.add(sessionId);
  }

  /** Record that `sessionId` has stopped polling. No-op if unmarked. */
  clearServing(sessionId: string): void {
    this.serving.delete(sessionId);
  }

  /** Return `true` when `sessionId` is currently polling its inbox. */
  isServing(sessionId: string): boolean {
    return this.serving.has(sessionId);
  }

  /** Every currently-serving session id, for diagnostics. */
  servingIds(): readonly string[] {
    return [...this.serving];
  }
}

/**
 * Return the process-global ServingSessionRegistry, creating it on first call.
 *
 * Intentionally has no teardown hook: a child's `session_shutdown` must not be
 * able to wipe the parent's mark. Entries are added and removed exclusively by
 * the owning session's `ForwardingManager`.
 */
export function getServingSessionRegistry(): ServingSessionRegistry {
  const store = globalThis as Record<symbol, unknown>;
  const existing = store[SERVING_SESSION_REGISTRY_KEY] as
    | ServingSessionRegistry
    | undefined;
  if (existing) {
    return existing;
  }
  const registry = new ServingSessionRegistry();
  store[SERVING_SESSION_REGISTRY_KEY] = registry;
  return registry;
}
