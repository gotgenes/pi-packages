import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PermissionPromptDecision } from "#src/authority/permission-dialog";
import type { SubagentSessionRegistry } from "#src/authority/subagent-registry";
import type { AuthorizerLog, PermissionQuery } from "#src/service";
import type { DebugReviewLogger } from "#src/session-logger";
import { ParentAuthorizer } from "./approval-escalator";
import { DenyingAuthorizer } from "./denying-authorizer";
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
 * The terminal link: on `ask`, rules on a single request and is told the
 * decision. Structurally cannot defer — it always returns a full
 * {@link PermissionPromptDecision}, which is the type-level enforcement of
 * ADR 0007's terminal-cannot-defer invariant.
 *
 * One method, one responsibility. `DenyingAuthorizer` ignores `details`;
 * `LocalUserAuthorizer` reads `message`/`sessionLabel` and derives the UI
 * event from it; `ParentAuthorizer` reads `message` and derives the
 * forwarded display from it.
 */
export interface TerminalAuthorizer {
  authorize(
    details: PromptPermissionDetails,
  ): Promise<PermissionPromptDecision>;
}

/** Construction inputs for {@link selectAuthorizer}. */
export interface AuthorizerSelectionDeps {
  /** Single owner of subagent detection; the ParentAuthorizer-selection predicate. */
  detection: SubagentDetector;
  /** Construct the direct local terminal for the active UI context. */
  createLocalAuthorizer(ctx: ExtensionContext): TerminalAuthorizer;
  /** Forwarding directory `ParentAuthorizer` reads/writes request and response files under. */
  forwardingDir: string;
  /** In-process subagent session registry for forwarding target resolution. */
  registry?: SubagentSessionRegistry;
  logger: DebugReviewLogger;
}

/**
 * Select the `Authorizer` for the current context: the single owner of the
 * three-way `hasUI` / `isSubagent` / deny dispatch.
 *
 * Evaluated once per session activation (`AuthorizerSelection.activate`),
 * replacing the re-derivation of the same predicates across
 * `PromptingGateway`, `PermissionPrompter`, and `ApprovalEscalator`.
 */
export function selectAuthorizer(
  ctx: ExtensionContext,
  deps: AuthorizerSelectionDeps,
): TerminalAuthorizer {
  if (ctx.hasUI) {
    return deps.createLocalAuthorizer(ctx);
  }
  if (deps.detection.isSubagent(ctx)) {
    return new ParentAuthorizer(ctx, {
      forwardingDir: deps.forwardingDir,
      registry: deps.registry,
      logger: deps.logger,
    });
  }
  return new DenyingAuthorizer();
}
