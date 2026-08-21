import { SUBAGENT_ENV_HINT_KEYS } from "#src/authority/permission-forwarding";
import type { SubagentSessionRegistry } from "#src/authority/subagent-registry";
import type { PathFlavor } from "#src/path/path-flavor";
import { readSessionId } from "#src/session-identity";

/**
 * Narrow context for subagent detection — the only session-manager readers
 * {@link isSubagentExecutionContext} and {@link isRegisteredSubagentChild}
 * consume. A full `ExtensionContext` satisfies this structurally.
 */
export interface SubagentDetectionContext {
  sessionManager: {
    getSessionId(): string;
    getSessionDir(): string;
  };
}

export function normalizeFilesystemPath(
  pathValue: string,
  flavor: PathFlavor,
): string {
  return flavor.fold(flavor.impl.normalize(pathValue));
}

/**
 * Return `true` when `ctx` belongs to an in-process subagent child registered
 * in `registry` by its session id.
 *
 * This is the only signal that identifies an **in-process** child (one sharing
 * the parent's `globalThis`); env-hint and filesystem heuristics identify
 * **process-based** subagents instead. The composition root uses this to decide
 * whether the instance owns the process-global service slot — a registered
 * child must not publish over its parent.
 */
export function isRegisteredSubagentChild(
  ctx: SubagentDetectionContext,
  registry: SubagentSessionRegistry,
): boolean {
  const sessionId = readSessionId(ctx);
  // An unreachable session id names no registration — treat as not-a-child.
  return sessionId !== null && registry.has(sessionId);
}

export function isSubagentExecutionContext(
  ctx: SubagentDetectionContext,
  subagentSessionsDir: string,
  flavor: PathFlavor,
  registry?: SubagentSessionRegistry,
): boolean {
  // 1. Explicit registry — in-process subagent extensions register by child
  //    session id before bindExtensions(); checked first so it takes priority
  //    over heuristics. Each concurrent sibling has a unique session id, so
  //    one sibling's disposed event cannot affect another's registration.
  if (registry && isRegisteredSubagentChild(ctx, registry)) {
    return true;
  }

  const sessionDir = ctx.sessionManager.getSessionDir();

  // 2. Env vars — process-based subagent extensions (nicobailon/pi-subagents,
  //    HazAT/pi-interactive-subagents, pi-agent-router, etc.).
  for (const key of SUBAGENT_ENV_HINT_KEYS) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim()) {
      return true;
    }
  }

  // 3. Filesystem path — fallback heuristic for extensions that store sessions
  //    under a known subagent root directory.
  if (!sessionDir) {
    return false;
  }

  const normalizedSessionDir = normalizeFilesystemPath(sessionDir, flavor);
  const normalizedSubagentRoot = normalizeFilesystemPath(
    subagentSessionsDir,
    flavor,
  );
  return flavor.isWithin(normalizedSessionDir, normalizedSubagentRoot);
}
