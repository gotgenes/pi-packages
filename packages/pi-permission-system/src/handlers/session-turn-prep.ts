import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ReadyAnnouncer } from "#src/service-lifecycle";

/** The session surface the turn-prep routine drives. */
export interface TurnPrepSession {
  activate(ctx: ExtensionContext): void;
  refreshConfig(
    ctx: ExtensionContext | undefined,
    projectTrusted: boolean,
  ): void;
}

/** What a `before_agent_start` handler asks for; `SessionTurnPrep` provides it. */
export interface TurnPreparation {
  prepare(ctx: ExtensionContext): void;
}

/**
 * Brings this node up to date for the turn about to start.
 *
 * Everything that must be true before the node answers a permission question
 * this turn lives here, so the `before_agent_start` handler is left with the
 * one job its name describes: filtering tools and sanitizing the prompt.
 *
 * Constructor deps:
 * - `session` — activated with the turn's context, then refreshed from disk
 * - `warmParser` — warms the tree-sitter parser so the synchronous advisory
 *   bash path can decompose at gate parity; `before_agent_start` precedes any
 *   tool call, so triggering it here closes the pre-warm window (#309)
 * - `readyAnnouncer` — re-announces `permissions:ready` once per session
 *   (ADR 0012 decision 3); `before_agent_start` runs after every extension's
 *   `session_start` and before any ask, so a consumer that registers from the
 *   ready handler alone is heard in time
 */
export class SessionTurnPrep implements TurnPreparation {
  constructor(
    private readonly session: TurnPrepSession,
    private readonly warmParser: () => void,
    private readonly readyAnnouncer: ReadyAnnouncer,
  ) {}

  prepare(ctx: ExtensionContext): void {
    // Fire-and-forget: warming is idempotent and best-effort, so it never
    // delays agent start. A bash advisory query before it completes falls back
    // to whole-string matching.
    this.warmParser();
    this.session.activate(ctx);
    // Gate the mid-session runtime-config refresh on project trust too, so an
    // untrusted project cannot slip its runtime config (e.g. `yoloMode`) in
    // right before agent start after session_start withheld it (#644). The
    // session_start handler already warned; do not re-warn on every start.
    this.session.refreshConfig(ctx, ctx.isProjectTrusted());
    // Announce last: the node is up to date for the turn, so a consumer that
    // resolves the service in its ready handler queries current policy. The
    // once-per-session guard lives in the announcer, not here.
    this.readyAnnouncer.announceReady(ctx);
  }
}
