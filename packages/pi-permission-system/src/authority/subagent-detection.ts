import type { PathFlavor } from "#src/path/path-flavor";
import {
  isSubagentExecutionContext,
  type SubagentDetectionContext,
} from "./subagent-context";
import type { SubagentSessionRegistry } from "./subagent-registry";

/**
 * Narrow seam for the ask-path consumers: "is the current session a subagent?"
 *
 * `selectAuthorizer`/`AuthorizerSelection` depends on this single-method view so
 * its unit tests inject a one-field fake without casts. It is the
 * Authorizer-selection predicate the Phase 9 spine consumes.
 *
 * It answers "is this process a child", which is **not** "should this node relay
 * rather than decide". A UI host answers `true` here whenever its process
 * carries a parent-session marker — a spawner may export one from the root so
 * the children it launches inherit it. No consumer may read it as a relay
 * decision: `selectAuthorizer` relays a node with a UI only when a forwarding
 * target resolves *and* that target is serving (#909), and serving eligibility
 * does not consult this predicate at all (#907).
 */
export interface SubagentDetector {
  isSubagent(ctx: SubagentDetectionContext): boolean;
}

/** Composition-root inputs for {@link SubagentDetection}. */
export interface SubagentDetectionDeps {
  subagentSessionsDir: string;
  flavor: PathFlavor;
  registry?: SubagentSessionRegistry;
}

/**
 * Single owner of subagent detection.
 *
 * Constructed once in the composition root with the detection inputs
 * (`subagentSessionsDir`, `flavor`, `registry`) and shared across every
 * consumer, replacing the dep triple those consumers previously threaded
 * individually. Delegates to the pure detection functions in
 * {@link ./subagent-context}, holding only the deps.
 */
export class SubagentDetection implements SubagentDetector {
  constructor(private readonly deps: SubagentDetectionDeps) {}

  isSubagent(ctx: SubagentDetectionContext): boolean {
    return isSubagentExecutionContext(
      ctx,
      this.deps.subagentSessionsDir,
      this.deps.flavor,
      this.deps.registry,
    );
  }
}
