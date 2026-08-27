import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TargetServingLookup } from "#src/authority/forwarding-liveness";
import type { PermissionPromptDecision } from "#src/authority/permission-dialog";
import type {
  PromptPreferences,
  requestPermissionDecision,
} from "#src/authority/permission-prompt-component";
import type { SubagentSessionRegistry } from "#src/authority/subagent-registry";
import type { PermissionEventBus } from "#src/permission-events";
import type { AuthorizerLog, PermissionQuery } from "#src/service";
import type { DebugReviewLogger } from "#src/session-logger";
import { ParentAuthorizer } from "./approval-escalator";
import { DenyingAuthorizer } from "./denying-authorizer";
import { LocalUserAuthorizer } from "./local-user-authorizer";
import type { PromptPermissionDetails } from "./permission-prompter";
import type { SubagentDetector } from "./subagent-detection";

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
 * re-derives: `selectAuthorizer` tests `hasUI` before `isSubagent`, so a
 * subagent that has its own UI decides locally, and re-deriving the role from
 * `detection.isSubagent(ctx)` alone would get that case wrong.
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
 * three-way `hasUI` / `isSubagent` / deny dispatch, and of the chain role that
 * dispatch implies.
 *
 * Evaluated once per session activation (`AuthorizerSelection.activate`),
 * replacing the re-derivation of the same predicates across
 * `PromptingGateway`, `PermissionPrompter`, and `ApprovalEscalator`.
 */
export function selectAuthorizer(
  ctx: ExtensionContext,
  deps: AuthorizerSelectionDeps,
): SelectedAuthority {
  if (ctx.hasUI) {
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
  if (deps.detection.isSubagent(ctx)) {
    return {
      terminal: new ParentAuthorizer(ctx, {
        forwardingDir: deps.forwardingDir,
        registry: deps.registry,
        serving: deps.serving,
        getTimeoutMs: deps.getForwardingTimeoutMs,
        logger: deps.logger,
      }),
      adjudicatesLocally: false,
    };
  }
  return { terminal: new DenyingAuthorizer(), adjudicatesLocally: true };
}
