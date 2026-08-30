import type { SessionContext } from "#src/types";

/**
 * Session lifecycle event handlers: session_start, session_before_switch, session_shutdown.
 *
 * Extracted from index.ts so each handler can be tested in isolation
 * with mocked narrow interfaces.
 */

/** Narrow manager interface — only the methods lifecycle handlers call. */
export interface LifecycleManager {
  clearCompleted(): Promise<void>;
  abortAll(): void;
  dispose(): Promise<void>;
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
 * - `disposeWidget` — unregisters the live widget and stops its timer
 * - `disposeNotifications` — tears down the notification system on shutdown
 * - `unpublishService` — unpublishes the SubagentsService symbol on shutdown
 */
export class SessionLifecycleHandler {
  constructor(
    private readonly runtime: LifecycleRuntime,
    private readonly manager: LifecycleManager,
    private readonly disposeNotifications: () => void,
    private readonly unpublishService: () => void,
    private readonly disposeWidget: () => void = () => {},
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
  // 2. Dispose the widget — unregister UI state and stop its timer while its context is valid
  // 3. Clear session context — no more session state
  // 4. Dispose notifications — silence nudges *before* the aborts that would
  //    raise them: no parent run is active at shutdown, so a terminal
  //    transition delivers its nudge synchronously and Pi cannot recall it
  // 5. Abort all agents — stop running and queued work
  // 6. Dispose manager — final cleanup, awaited so each child's extensions get
  //    their `session_shutdown` before Pi tears the parent down (#709)
  handleSessionShutdown(): Promise<void> {
    this.unpublishService();
    this.disposeWidget();
    this.runtime.clearSessionContext();
    this.disposeNotifications();
    this.manager.abortAll();
    return this.manager.dispose();
  }
}
