import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { DebugReviewLogger } from "#src/session-logger";
import type { InboxProcessor } from "./forwarded-request-server";
import { getSessionId } from "./forwarder-context";
import { PERMISSION_FORWARDING_POLL_INTERVAL_MS } from "./permission-forwarding";
import type { ServingAnnouncer } from "./serving-registry";
import type { SubagentDetector } from "./subagent-detection";

/**
 * Narrow interface for the forwarding lifecycle used by `PermissionSession`.
 * `ForwardingManager` satisfies it; tests can provide a plain object mock.
 */
export interface ForwardingController {
  start(ctx: ExtensionContext): void;
  stop(): void;
}

/** Constructor config for {@link ForwardingManager}. */
export interface ForwardingManagerDeps {
  /** Single owner of subagent detection; gates whether this session may serve. */
  detection: SubagentDetector;
  /** Drains this session's forwarded-permission inbox on each tick. */
  forwarder: InboxProcessor;
  /** Publishes that this session is draining its inbox, for forwarding children. */
  serving: ServingAnnouncer;
  logger: DebugReviewLogger;
}

/**
 * Encapsulates the forwarded-permission polling lifecycle.
 *
 * Owns the timer, current context, and processing-lock state that previously
 * lived as 3 mutable fields on `ExtensionRuntime`. Call `start(ctx)` on each
 * session event that may activate forwarding; call `stop()` on session
 * shutdown.
 *
 * While polling, it publishes the session id it polls to the `ServingAnnouncer`
 * so a forwarding child can tell that someone is draining the inbox it wrote
 * into — and the review log records that id, so a child forwarding to a
 * *different* id is visible as a one-line diff against its
 * `forwarded_permission.request_created` entry (#719).
 */
export class ForwardingManager {
  private timer: NodeJS.Timeout | null = null;
  private context: ExtensionContext | null = null;
  private processing = false;
  private servingSessionId: string | null = null;

  constructor(private readonly deps: ForwardingManagerDeps) {}

  /**
   * Start polling if `ctx` has UI and is not a subagent execution context.
   * No-op (timer stays running) if already polling — updates the stored
   * context so the next tick uses the latest session.
   * Stops any existing poll when the context does not qualify for forwarding.
   */
  start(ctx: ExtensionContext): void {
    if (!ctx.hasUI || this.deps.detection.isSubagent(ctx)) {
      this.stop();
      return;
    }
    this.context = ctx;
    this.announceServing(getSessionId(ctx));
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      // Ahead of the processing guard: a session whose human is deliberating at
      // a forwarded dialog holds `processInbox` open for as long as they take,
      // and it is serving throughout. Refreshing behind the guard would let its
      // announcement decay exactly when it is most demonstrably alive, and
      // every other forwarding child would give up on it.
      this.refreshServing();
      if (!this.context || this.processing) {
        return;
      }
      this.processing = true;
      void this.deps.forwarder.processInbox(this.context).finally(() => {
        this.processing = false;
      });
    }, PERMISSION_FORWARDING_POLL_INTERVAL_MS);
  }

  /** Stop polling and clear all internal state. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.withdrawServing();
    this.context = null;
    this.processing = false;
  }

  // ── Private methods ────────────────────────────────────────────────

  /**
   * Publish `sessionId` as the served session, replacing any previous one.
   *
   * A no-op when the id is unchanged, since `start` runs on every
   * `before_agent_start`, `input`, and `tool_call` — the announcement must not
   * cost a log line per turn.
   */
  private announceServing(sessionId: string): void {
    if (this.servingSessionId === sessionId) {
      return;
    }
    this.withdrawServing();
    this.servingSessionId = sessionId;
    this.deps.serving.markServing(sessionId);
    this.deps.logger.review("forwarded_permission.serving_started", {
      sessionId,
    });
  }

  /**
   * Re-announce the served session, keeping a decayable channel current.
   *
   * Separate from {@link announceServing} because that one detects a change to
   * write its log line, and this one deliberately writes none — four review
   * entries a second would drown the log the announcement exists to make
   * readable.
   */
  private refreshServing(): void {
    if (this.servingSessionId === null) {
      return;
    }
    this.deps.serving.markServing(this.servingSessionId);
  }

  /** Withdraw the published session, if any. */
  private withdrawServing(): void {
    const sessionId = this.servingSessionId;
    if (sessionId === null) {
      return;
    }
    this.servingSessionId = null;
    this.deps.serving.clearServing(sessionId);
    this.deps.logger.review("forwarded_permission.serving_stopped", {
      sessionId,
    });
  }
}
