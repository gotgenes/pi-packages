import type { PathFlavor } from "#src/path/path-flavor";
import {
  isSubagentExecutionContext,
  type SubagentDetectionContext,
} from "./subagent-context";
import type { SubagentSessionRegistry } from "./subagent-registry";

/**
 * Narrow seam for the ask-path consumers: "is the current session a subagent?"
 *
 * `selectAuthorizer`/`AuthorizerSelection` and `ForwardingManager` depend on
 * this single-method view so their unit tests inject a one-field fake without
 * casts. It is the Authorizer-selection predicate the Phase 9 spine consumes.
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
