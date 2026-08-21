import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AdjudicationRole } from "./authority/authorizer-selection";
import type { RegisteredChildDetector } from "./authority/subagent-detection";
import { emitReadyEvent, type PermissionEventBus } from "./permission-events";
import {
  type PermissionsService,
  publishPermissionsService,
  publishRootPermissionsService,
  unpublishPermissionsService,
  unpublishRootPermissionsService,
} from "./service";
import { readSessionId } from "./session-identity";

/** The session-scoped service lifecycle that the lifecycle handler drives. */
export interface ServiceLifecycle {
  activate(ctx: ExtensionContext): void;
  teardown(): void;
}

/**
 * Announces this node's ready facts at most once per session, whatever the
 * caller does (ADR 0012 decision 3, the ready latch).
 *
 * Kept separate from `ServiceLifecycle` because the two roles have different
 * callers: the session lifecycle starts and tears the node down, while the
 * latch fires from the turn about to start.
 */
export interface ReadyAnnouncer {
  announceReady(ctx: ExtensionContext): void;
}

/**
 * Owns the process-global service publication lifecycle for one extension
 * instance — that is, for one node (ADR 0012).
 *
 * - `activate` publishes the service under this node's own session id, so a
 *   sibling extension loaded into this node registers into the registries this
 *   node's gates and chain read. It additionally publishes to the legacy
 *   process-root slot unless this is a registered subagent child, which must
 *   not clobber its parent's slot (#302). Then it announces both facts a
 *   consumer needs — the session id and the chain role — on the ready channel,
 *   and re-arms the latch so the turn about to start announces once more.
 * - `announceReady` is that second announcement: it fires at most once per
 *   activation cycle, so `permissions:ready` reaches a consumer whose own
 *   `session_start` ran after this node's (ADR 0012 decision 3). The channel's
 *   contract is therefore "at least once per session, and may repeat" —
 *   handlers must be idempotent.
 * - `teardown` runs all session-scoped subscription cleanups in order, then
 *   unpublishes from both slots. Each unpublish is identity-scoped, so a
 *   superseded `/reload` generation cannot evict the fresh one.
 */
export class PermissionServiceLifecycle
  implements ServiceLifecycle, ReadyAnnouncer
{
  /** The key this instance last published under; `null` until it publishes. */
  private publishedSessionId: string | null = null;

  /** Whether the latch has already announced for the current session. */
  private announced = false;

  constructor(
    private readonly service: PermissionsService,
    private readonly detection: RegisteredChildDetector,
    private readonly role: AdjudicationRole,
    private readonly events: PermissionEventBus,
    private readonly subscriptions: readonly (() => void)[],
  ) {}

  activate(ctx: ExtensionContext): void {
    // Re-arm: a new session generation gets its own post-session_start
    // announcement, so a consumer that loaded after this node still hears one.
    this.announced = false;
    const sessionId = readSessionId(ctx);
    if (sessionId !== null) {
      publishPermissionsService(sessionId, this.service);
      this.publishedSessionId = sessionId;
    }
    if (!this.detection.isRegisteredChild(ctx)) {
      publishRootPermissionsService(this.service);
    }
    this.emitReady(ctx);
  }

  announceReady(ctx: ExtensionContext): void {
    if (this.announced) {
      return;
    }
    this.announced = true;
    this.emitReady(ctx);
  }

  teardown(): void {
    for (const unsubscribe of this.subscriptions) {
      unsubscribe();
    }
    if (this.publishedSessionId !== null) {
      unpublishPermissionsService(this.publishedSessionId, this.service);
      this.publishedSessionId = null;
    }
    unpublishRootPermissionsService(this.service);
  }

  /**
   * The one place a ready payload is built, so the `session_start` emission and
   * the latch emission cannot drift in shape: both read the node's facts from
   * the context they are handed.
   */
  private emitReady(ctx: ExtensionContext): void {
    emitReadyEvent(this.events, {
      sessionId: readSessionId(ctx),
      adjudicatesLocally: this.role.adjudicatesLocally(),
    });
  }
}
