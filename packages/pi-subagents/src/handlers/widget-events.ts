/**
 * Host-event handlers for the agent widget.
 *
 * Extracted from index.ts so each handler can be tested in isolation
 * with a mocked narrow widget interface.
 *
 * The three events are unrelated to each other and none is a tool call.
 * The widget can draw nothing until it holds a UI context, so the capture
 * belongs on an event that fires in every session; the linger clock counts
 * parent turns, so it belongs on the event that marks one; and the widget's
 * two resources have to be released when the session they belong to ends.
 */

/** Narrow widget interface — only the methods these handlers call. */
export interface EventDrivenWidget {
  setUICtx(ctx: unknown): void;
  onTurnStart(): void;
  dispose(): void;
}

/** Minimal context shape for session_start — only the field the handler reads. */
interface SessionStartCtx {
  ui: unknown;
}

/**
 * Feeds the widget the three host events it depends on.
 *
 * `session_start` supplies the UI context: Pi starts the TUI before it
 * initializes extensions and binds the UI context before emitting the event,
 * so `ctx.ui` is live here, and headless binds a no-op context rather than
 * none. `turn_start` ages finished agents out of the widget's roster.
 * `session_shutdown` releases the update interval and both UI registrations.
 */
export class WidgetEventsHandler {
  constructor(private readonly widget: EventDrivenWidget) {}

  handleSessionStart(_event: unknown, ctx: SessionStartCtx): void {
    this.widget.setUICtx(ctx.ui);
  }

  handleTurnStart(): void {
    this.widget.onTurnStart();
  }

  handleSessionShutdown(): void {
    this.widget.dispose();
  }
}
