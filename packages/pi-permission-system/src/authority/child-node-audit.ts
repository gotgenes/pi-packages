/**
 * child-node-audit.ts — Report an in-process subagent child that runs with no
 * permission node.
 *
 * Gating is node-local (ADR 0012 decision 1): each node loads its own instance
 * of this extension and gates its own `tool_call`s. A child that loads none has
 * no gate, no tool filtering, no `permission:` frontmatter resolution, and no
 * ask-forwarding — every tool in its `tools:` allowlist runs ungated. The
 * parent's own gating is unaffected, so without this audit the operator watches
 * the permission system work and never learns the child is unguarded.
 *
 * The signal is publication: since #699 every node publishes its service under
 * its own session id, and a subagent implementation announces the moment a
 * child finished binding its extensions. A child that has published nothing by
 * then has no node.
 *
 * The two halves of the alarm fire at different rates on purpose. The review
 * entry is the durable record and must be complete, so it is written for every
 * affected child. The visible warning is capped at one per parent session: the
 * cause is a single line of configuration, and a parent that fans out ten
 * children would otherwise emit ten identical warnings.
 */

/** Answers whether the node whose session is `sessionId` published a service. */
export type NodePresenceLookup = (sessionId: string) => boolean;

/** The narrow log seam this audit needs (ISP): a durable record and a warning. */
export interface ChildNodeAuditLog {
  review(event: string, details?: Record<string, unknown>): void;
  warn(message: string): void;
}

/** Fields read from the child-bound announcement (ISP). */
export interface BoundChild {
  /** Child session id — the key its node would have published under. */
  sessionId: string;
  parentSessionId?: string;
}

/**
 * The agent-facing text for an unguarded child.
 *
 * The parent cannot tell a deliberate exclusion from a load failure — both
 * leave the identical absence — so the message names the likelier cause and
 * admits the other in the same sentence.
 */
export function childNodeAbsentMessage(childSessionId: string): string {
  return (
    `pi-permission-system: subagent child session ${childSessionId} is ` +
    "running with no permission node — this extension is not loaded in it, so " +
    "its tool calls are not gated there. Most often the package is listed in " +
    "pi-subagents' excludedExtensionPackages; a failure to load this extension " +
    "in the child does the same. Further affected children are recorded in the " +
    "permission review log as child_node_absent."
  );
}

/** The audit seam the child-lifecycle subscription drives (ISP). */
export interface BoundChildAuditor {
  auditBoundChild(child: BoundChild): void;
}

/**
 * Audits each child that finishes binding, and alarms on one with no node.
 *
 * The warn-once latch is a plain field with no re-arm hook, because the
 * extension factory is re-invoked per session generation — a `/new`, `/resume`,
 * `/fork`, or `/import` switch builds a fresh audit. A `session_start` with
 * `reason: "reload"` reuses this instance and deliberately does not re-warn:
 * the operator has already been told.
 */
export class ChildNodeAudit implements BoundChildAuditor {
  private warned = false;

  constructor(
    private readonly hasNode: NodePresenceLookup,
    private readonly log: ChildNodeAuditLog,
  ) {}

  auditBoundChild(child: BoundChild): void {
    if (this.hasNode(child.sessionId)) {
      return;
    }
    this.log.review("child_node_absent", {
      childSessionId: child.sessionId,
      parentSessionId: child.parentSessionId ?? null,
    });
    if (this.warned) {
      return;
    }
    this.warned = true;
    this.log.warn(childNodeAbsentMessage(child.sessionId));
  }
}
