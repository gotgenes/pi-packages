/**
 * session-identity.ts — This node's own session id.
 *
 * One Pi session runtime is a **node** (ADR 0012): its own `ExtensionContext`,
 * event bus, gates, and `PermissionSession`. The session id is how a node names
 * itself to the rest of the process — it keys the subagent-child registry, the
 * serving-heartbeat records, and the session-keyed service publication.
 *
 * The read is defensive because the id is not guaranteed to be reachable: a
 * host may expose a session manager without one. An unavailable id is `null`
 * rather than a throw, so a caller decides what to do without an unreachable
 * id (skip a keyed publication, report "not a registered child") instead of
 * failing session startup.
 */

/** Narrow context: the only session-manager reader {@link readSessionId} consumes. */
export interface SessionIdentityContext {
  sessionManager: {
    getSessionId(): string;
  };
}

/**
 * Return the session id `ctx` belongs to, or `null` when the host does not
 * expose one (absent, empty, or throwing).
 */
export function readSessionId(ctx: SessionIdentityContext): string | null {
  try {
    return ctx.sessionManager.getSessionId() || null;
  } catch {
    return null;
  }
}
