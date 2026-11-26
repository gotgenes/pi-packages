import { debugLog } from "#src/debug";
import { buildShutdownNotice, type ShutdownNotice, type StoppedAgent } from "#src/handlers/shutdown-notice";
import type { SessionContext } from "#src/types";

/**
 * Session lifecycle event handlers: session_start, session_before_switch, session_shutdown.
 *
 * Extracted from index.ts so each handler can be tested in isolation
 * with mocked narrow interfaces.
 */

/**
 * A stopped agent as the shutdown sees it: what the notice reads, plus the
 * promise of the run the abort stopped, which settles once that run's terminal
 * transition has appended its `subagents:record` entry. A `Subagent` satisfies
 * it structurally.
 */
export interface StoppedRun extends StoppedAgent {
  readonly promise: Promise<void> | undefined;
}

/** Narrow manager interface — only the methods lifecycle handlers call. */
export interface LifecycleManager {
  clearCompleted(): Promise<void>;
  abortAll(): readonly StoppedRun[];
  dispose(): Promise<void>;
}

/** The `session_shutdown` payload field the handler reads. */
interface SessionShutdownPayload {
  readonly reason?: string;
}

/** Narrow runtime interface — only the methods lifecycle handlers call. */
export interface LifecycleRuntime {
  setSessionContext(ctx: SessionContext): void;
  clearSessionContext(): void;
}

/**
 * Handles session lifecycle events.
 *
 * Constructor deps:
 * - `runtime` — owns session context state
 * - `manager` — manages agent lifecycle (clear, abort, dispose)
 * - `disposeNotifications` — tears down the notification system on shutdown
 * - `unpublishService` — unpublishes the SubagentsService symbol on shutdown
 * - `sendMessage` — leaves the shutdown notice in the parent session
 */
export class SessionLifecycleHandler {
  constructor(
    private readonly runtime: LifecycleRuntime,
    private readonly manager: LifecycleManager,
    private readonly disposeNotifications: () => void,
    private readonly unpublishService: () => void,
    private readonly sendMessage: (message: ShutdownNotice, options: { triggerTurn: false }) => void,
  ) {}

  handleSessionStart(_event: unknown, ctx: unknown): Promise<void> {
    this.runtime.setSessionContext(ctx as SessionContext);
    return this.manager.clearCompleted();
  }

  handleSessionBeforeSwitch(): Promise<void> {
    return this.manager.clearCompleted();
  }

  // Cleanup order matters:
  // 1. Unpublish service — prevent new cross-extension calls
  // 2. Clear session context — no more session state
  // 3. Dispose notifications — silence nudges *before* the aborts that would
  //    raise them: no parent run is active at shutdown, so a terminal
  //    transition delivers its nudge synchronously and Pi cannot recall it
  // 4. Abort all agents — stop running and queued work
  // 5. Leave the shutdown notice — name what step 4 stopped, so neither the
  //    user nor the parent waits for results that will not arrive. It starts
  //    no turn, and a send that fails must not skip the disposal below.
  // 6. Wait for every stopped run to end — a running child's abort only pulls
  //    its lever, and its record is appended once its turn loop has unwound,
  //    which must happen before Pi invalidates this instance (#1152)
  // 7. Dispose manager — final cleanup, awaited so each child's extensions get
  //    their `session_shutdown` before Pi tears the parent down (#709)
  handleSessionShutdown(event: SessionShutdownPayload): Promise<void> {
    this.unpublishService();
    this.runtime.clearSessionContext();
    this.disposeNotifications();
    const stopped = this.manager.abortAll();
    if (stopped.length > 0) this.sendShutdownNotice(event.reason, stopped);
    return this.disposeOnceEnded(stopped);
  }

  private async disposeOnceEnded(stopped: readonly StoppedRun[]): Promise<void> {
    await Promise.allSettled(stopped.flatMap(run => run.promise ?? []));
    await this.manager.dispose();
  }

  private sendShutdownNotice(reason: string | undefined, stopped: readonly StoppedAgent[]): void {
    try {
      this.sendMessage(buildShutdownNotice(reason, stopped), { triggerTurn: false });
    } catch (err) {
      debugLog("shutdown notice", err);
    }
  }
}
