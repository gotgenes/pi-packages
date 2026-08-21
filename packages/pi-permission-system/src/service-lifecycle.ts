import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AdjudicationRole } from "./authority/authorizer-selection";
import type { RegisteredChildDetector } from "./authority/subagent-detection";
import { emitReadyEvent, type PermissionEventBus } from "./permission-events";
import {
  type PermissionsService,
  publishPermissionsService,
  publishPermissionsServiceForSession,
  unpublishPermissionsService,
  unpublishPermissionsServiceForSession,
} from "./service";
import { readSessionId } from "./session-identity";

/** The session-scoped service lifecycle that the lifecycle handler drives. */
export interface ServiceLifecycle {
  activate(ctx: ExtensionContext): void;
  teardown(): void;
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
 *   consumer needs — the session id and the chain role — on the ready channel.
 * - `teardown` runs all session-scoped subscription cleanups in order, then
 *   unpublishes from both slots. Each unpublish is identity-scoped, so a
 *   superseded `/reload` generation cannot evict the fresh one.
 */
export class PermissionServiceLifecycle implements ServiceLifecycle {
  /** The key this instance last published under; `null` until it publishes. */
  private publishedSessionId: string | null = null;

  constructor(
    private readonly service: PermissionsService,
    private readonly detection: RegisteredChildDetector,
    private readonly role: AdjudicationRole,
    private readonly events: PermissionEventBus,
    private readonly subscriptions: readonly (() => void)[],
  ) {}

  activate(ctx: ExtensionContext): void {
    const sessionId = readSessionId(ctx);
    if (sessionId !== null) {
      publishPermissionsServiceForSession(sessionId, this.service);
      this.publishedSessionId = sessionId;
    }
    if (!this.detection.isRegisteredChild(ctx)) {
      publishPermissionsService(this.service);
    }
    emitReadyEvent(this.events, {
      sessionId,
      adjudicatesLocally: this.role.adjudicatesLocally(),
    });
  }

  teardown(): void {
    for (const unsubscribe of this.subscriptions) {
      unsubscribe();
    }
    if (this.publishedSessionId !== null) {
      unpublishPermissionsServiceForSession(
        this.publishedSessionId,
        this.service,
      );
      this.publishedSessionId = null;
    }
    unpublishPermissionsService(this.service);
  }
}
