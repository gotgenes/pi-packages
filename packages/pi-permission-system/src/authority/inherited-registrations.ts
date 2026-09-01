/**
 * inherited-registrations.ts — Complete a child node's fact-shaping lookups
 * from its ancestors in the same process.
 *
 * Registrations are node-local (ADR 0012 decision 1): an extractor or formatter
 * lands in the registry of the node whose extension registered it. That is
 * unchanged here. What this module adds is the decision's fact-shaping clause —
 * a **lookup** may cross an in-process node boundary, because an extractor
 * produces a path and a formatter produces display text, and neither decides
 * anything.
 *
 * The gap it closes is the split-provider condition (#793). Excluding a package
 * from child sessions normally removes its tools and their extractors together,
 * so nothing is weakened. But when package A registers a tool whose path lives
 * under a non-standard key and package B registers the extractor for it,
 * excluding B alone leaves the child with the tool and no way to see its path:
 * the `path` and `external_directory` gates never run for that call, and the
 * parent's own gating is unaffected, so the weakening is visible nowhere.
 *
 * Why this direction is safe, and why it stops here:
 *
 * - It is monotone. Without an extractor the gate does not run at all, so
 *   resolving one can only add a check, and the four path layers compose
 *   most-restrictive-wins — an inherited extractor can never loosen a decision.
 * - It carries no authority. Live authority converges at the adjudicating node
 *   (ADR 0007 §7), so there is deliberately **no** equivalent for the authorizer
 *   registry: a link returns a verdict, and inheriting one would run authority
 *   an operator's own `excludedExtensionPackages` removed.
 *
 * In-process only, by construction: an out-of-process child shares no
 * `globalThis`, so it reaches no ancestor service, and an extractor is a
 * closure that cannot be serialized to one.
 */

import type { PermissionsService } from "#src/service";
import type {
  ResolvedToolAccessExtractor,
  ToolAccessExtractorLookup,
} from "#src/tool-access-extractor-registry";
import type {
  ToolInputFormatter,
  ToolInputFormatterLookup,
} from "#src/tool-input-formatter-registry";

/** This node's own session id, or `null` when the host exposes none. */
export interface NodeIdentity {
  currentSessionId(): string | null;
}

/**
 * The read shape {@link AncestorNodes} needs from the subagent registry (ISP):
 * which node spawned the one named by `sessionId`.
 */
export interface ParentChainRegistry {
  get(sessionId: string): { parentSessionId?: string } | undefined;
}

/** Resolves a node's published service by session id. */
export type PermissionsServiceLocator = (
  sessionId: string,
) => PermissionsService | undefined;

/**
 * This node's ancestors in the current process, nearest first.
 *
 * Binds the three collaborators the walk needs so each lookup below takes one
 * of these rather than repeating them.
 */
export class AncestorNodes {
  constructor(
    private readonly node: NodeIdentity,
    private readonly registry: ParentChainRegistry,
    private readonly locate: PermissionsServiceLocator,
  ) {}

  /**
   * The first non-`undefined` answer `pick` gives for an ancestor's service.
   *
   * The walk is transitive rather than one hop: an exclusion applies to every
   * descendant equally, so in a nested spawn the grandchild's own parent is
   * missing the same registration it is.
   *
   * A hop that published no service is stepped over rather than ending the
   * walk — the registry still names that node's own parent — and each hop is
   * resolved through the locator per call, never cached, so a torn-down node
   * simply stops answering.
   */
  findFirst<T>(
    pick: (service: PermissionsService) => T | undefined,
  ): T | undefined {
    let sessionId = this.node.currentSessionId();
    // A malformed chain must not hang a tool call; a node is consulted once.
    const visited = new Set<string>();

    while (sessionId !== null && !visited.has(sessionId)) {
      visited.add(sessionId);
      const parentSessionId = this.registry.get(sessionId)?.parentSessionId;
      if (parentSessionId === undefined) {
        return undefined;
      }
      const service = this.locate(parentSessionId);
      const answer = service ? pick(service) : undefined;
      if (answer !== undefined) {
        return answer;
      }
      sessionId = parentSessionId;
    }
    return undefined;
  }
}

/**
 * An extractor lookup that falls back to this node's ancestors.
 *
 * The local registry always wins, so a child that registers its own extractor
 * for a tool keeps it, and the fallback is consulted only on a miss.
 */
export class InheritingToolAccessExtractorLookup
  implements ToolAccessExtractorLookup
{
  constructor(
    private readonly local: ToolAccessExtractorLookup,
    private readonly ancestors: AncestorNodes,
  ) {}

  resolve(toolName: string): ResolvedToolAccessExtractor | undefined {
    const own = this.local.resolve(toolName);
    if (own) {
      return own;
    }
    const inherited = this.ancestors.findFirst((service) =>
      service.getToolAccessExtractor(toolName),
    );
    return inherited
      ? { extractor: inherited, origin: "inherited" }
      : undefined;
  }
}

/**
 * A formatter lookup that falls back to this node's ancestors.
 *
 * Unlike the extractor above it reports no origin, because its consumer records
 * none: a formatter's effect is the rendered preview itself, and the child
 * builds that preview and forwards it to whichever node renders the ask.
 */
export class InheritingToolInputFormatterLookup
  implements ToolInputFormatterLookup
{
  constructor(
    private readonly local: ToolInputFormatterLookup,
    private readonly ancestors: AncestorNodes,
  ) {}

  get(toolName: string): ToolInputFormatter | undefined {
    return (
      this.local.get(toolName) ??
      this.ancestors.findFirst((service) =>
        service.getToolInputFormatter(toolName),
      )
    );
  }
}
