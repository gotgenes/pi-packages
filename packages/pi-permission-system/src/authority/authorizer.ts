import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { DebugReviewLogger } from "#src/logging/session-logger";
import type { AuthorizerLog, PermissionQuery } from "#src/service";
import type { PermissionEventBus } from "#src/service/permission-events";
import { ParentAuthorizer } from "./approval-escalator";
import { DenyingAuthorizer } from "./denying-authorizer";
import { getSessionId } from "./forwarder-context";
import type { TargetServingLookup } from "./forwarding-liveness";
import { LocalUserAuthorizer } from "./local-user-authorizer";
import type { PermissionPromptDecision } from "./permission-dialog";
import type { PermissionForwardingTarget } from "./permission-forwarding";
import { resolvePermissionForwardingTarget } from "./permission-forwarding";
import type {
  PromptPreferences,
  requestPermissionDecision,
} from "./permission-prompt-component";
import type { PromptPermissionDetails } from "./permission-prompter";
import type { SubagentDetector } from "./subagent-detection";
import type { SubagentSessionRegistry } from "./subagent-registry";

/**
 * A non-terminal chain link's ruling on an `ask`: decide (`allow`/`deny`) or
 * pass the ask on to the next link (`defer`). A `deny` carries an optional
 * teaching `reason` the invoking model sees, so it can self-correct.
 */
export type AuthorizerVerdict =
  | { kind: "allow" }
  | { kind: "deny"; reason?: string }
  | { kind: "defer" };

/**
 * A non-terminal link in the live-authority chain: reviews an `ask` and may
 * decide it or defer to the next link (ADR 0007). The chain injects a narrow,
 * session-scoped {@link PermissionQuery} at `authorize` time (§3), so a link
 * queries the deterministic engine at gate parity rather than reaching for the
 * cross-extension service via `Symbol.for()`. It also injects an
 * {@link AuthorizerLog} so a link can record its decision trail to the shared
 * permission review log (same §3 injection pattern).
 */
export interface Authorizer {
  authorize(
    details: PromptPermissionDetails,
    query: PermissionQuery,
    log: AuthorizerLog,
  ): Promise<AuthorizerVerdict>;
}

/**
 * A resolved chain link together with the operator-configured name it came
 * from.
 *
 * `AuthorizerRegistry` already keys links by name, and `AuthorizerSelection`
 * has the name in scope when it resolves the operator's `authorizerChain`; the
 * name is carried through composition so a decision record can say *which*
 * link decided rather than only which links were consulted.
 */
export interface NamedAuthorizer extends Authorizer {
  readonly name: string;
}

/**
 * The terminal link: on `ask`, rules on a single request and is told the
 * decision. Structurally cannot defer — it always returns a full
 * {@link PermissionPromptDecision}, which is the type-level enforcement of
 * ADR 0007's terminal-cannot-defer invariant.
 *
 * One method, one responsibility. `DenyingAuthorizer` ignores `details`;
 * `LocalUserAuthorizer` renders `payload` for the human and derives the UI
 * event from the request facts; `ParentAuthorizer` ships `payload` over the
 * wire so the serving node renders it under its own budget.
 */
export interface TerminalAuthorizer {
  authorize(
    details: PromptPermissionDetails,
  ): Promise<PermissionPromptDecision>;
}

/**
 * The node's live-authority selection: who decides this node's asks, and
 * whether this node adjudicates them with its own chain.
 *
 * The chain role is the selection's product, not a discriminator a consumer
 * re-derives: a node with a UI decides locally unless it names another session
 * that is draining its forwarded-permission inbox (#909), so re-deriving the
 * role from `ctx.hasUI` or `detection.isSubagent(ctx)` alone would get that
 * case wrong in opposite directions.
 */
export interface SelectedAuthority {
  /** The terminal that decides this node's asks, or relays them upward. */
  readonly terminal: TerminalAuthorizer;
  /**
   * False when the terminal relays the ask to a serving node
   * (`ParentAuthorizer`): that node resolves the request against its own
   * recorded authority and escalates it through *its* chain over the same
   * child-fixed facts (#635), so resolving links here would adjudicate one ask
   * twice.
   */
  readonly adjudicatesLocally: boolean;
  /**
   * The target this selection itself verified as live, for the relay-transition
   * record. Absent on the headless relay arm, where the target is resolved per
   * ask by `ParentAuthorizer` rather than at selection.
   */
  readonly relayTarget?: PermissionForwardingTarget;
}

/** Construction inputs for {@link selectAuthorizer}. */
export interface AuthorizerSelectionDeps {
  /** Single owner of subagent detection; the ParentAuthorizer-selection predicate. */
  detection: SubagentDetector;
  /** Event bus used by `LocalUserAuthorizer` for the `permissions:ui_prompt` broadcast. */
  events: PermissionEventBus;
  /** Read live at prompt time; threaded into `LocalUserAuthorizer`. */
  getPromptPreferences: () => PromptPreferences;
  /** Injected for testability; production callers pass the real function. */
  requestPermissionDecision: typeof requestPermissionDecision;
  /** Forwarding directory `ParentAuthorizer` reads/writes request and response files under. */
  forwardingDir: string;
  /** In-process subagent session registry for forwarding target resolution. */
  registry?: SubagentSessionRegistry;
  /** Whether a forwarding target is draining its inbox, on whichever channel can say. */
  serving: TargetServingLookup;
  /** The forwarding timeout, read live so a config edit applies to the next ask. */
  getForwardingTimeoutMs: () => number;
  logger: DebugReviewLogger;
}

/**
 * Select the live authority for the current context: the single owner of the
 * three-way local / relay / deny dispatch, and of the chain role that dispatch
 * implies.
 *
 * Evaluated on every session activation (`AuthorizerSelection.activate`), which
 * is what lets a node with a UI follow its declared parent's liveness: the
 * moment that parent stops serving, the next activation selects the local
 * dialog again.
 */
export function selectAuthorizer(
  ctx: ExtensionContext,
  deps: AuthorizerSelectionDeps,
): SelectedAuthority {
  if (ctx.hasUI) {
    const relayTarget = resolveLiveRelayTarget(ctx, deps);
    if (relayTarget === null) {
      return {
        terminal: new LocalUserAuthorizer({
          ui: ctx.ui,
          mode: ctx.mode,
          events: deps.events,
          getPromptPreferences: deps.getPromptPreferences,
          requestPermissionDecision: deps.requestPermissionDecision,
        }),
        adjudicatesLocally: true,
      };
    }
    return {
      terminal: buildParentAuthorizer(ctx, deps),
      adjudicatesLocally: false,
      relayTarget,
    };
  }
  if (deps.detection.isSubagent(ctx)) {
    return {
      terminal: buildParentAuthorizer(ctx, deps),
      adjudicatesLocally: false,
    };
  }
  return { terminal: new DenyingAuthorizer(), adjudicatesLocally: true };
}

/**
 * The session a node with a UI should relay to, or `null` when it should decide
 * for itself.
 *
 * A human is present here, so only a definite "yes" relays: a target nobody can
 * confirm is draining its inbox leaves the ask with the human who is already
 * watching. That is the opposite burden of proof from
 * `ParentAuthorizer.checkServingLiveness`, where an unjudgeable target waits
 * out the timeout because a headless child has no alternative.
 */
function resolveLiveRelayTarget(
  ctx: ExtensionContext,
  deps: AuthorizerSelectionDeps,
): PermissionForwardingTarget | null {
  const sessionId = getSessionId(ctx);
  const target = resolvePermissionForwardingTarget({
    isSubagent: deps.detection.isSubagent(ctx),
    currentSessionId: sessionId,
    sessionId,
    registry: deps.registry,
  });
  if (target === null || deps.serving.isServing(target) !== true) {
    return null;
  }
  return target;
}

/** The relaying terminal for `ctx`, built from the selection's own deps. */
function buildParentAuthorizer(
  ctx: ExtensionContext,
  deps: AuthorizerSelectionDeps,
): ParentAuthorizer {
  return new ParentAuthorizer(ctx, {
    forwardingDir: deps.forwardingDir,
    registry: deps.registry,
    serving: deps.serving,
    getTimeoutMs: deps.getForwardingTimeoutMs,
    logger: deps.logger,
  });
}
