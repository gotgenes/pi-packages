import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PermissionPromptDecision } from "#src/authority/permission-dialog";
import type { PermissionQuery } from "#src/service";
import {
  type Authorizer,
  type AuthorizerSelectionDeps,
  selectAuthorizer,
  type TerminalAuthorizer,
} from "./authorizer";
import { composeAuthorizerChain } from "./authorizer-chain";
import type { AuthorizerLookup } from "./authorizer-registry";
import { encloseInDelegationEnvelope } from "./delegation-envelope";
import type {
  PermissionPrompterApi,
  PromptPermissionDetails,
} from "./permission-prompter";

/**
 * The lifecycle slice of the selection owner that PermissionSession drives.
 *
 * PermissionSession calls activate/deactivate to keep the selection's stored
 * context in sync with its own — the same pattern the former
 * PromptingGatewayLifecycle used.
 */
export interface AuthorizerSelectionLifecycle {
  activate(ctx: ExtensionContext): void;
  deactivate(): void;
}

/**
 * The ask-escalation seam `GateRunner` depends on: escalate a single ask to
 * the session's selected `Authorizer` and return its decision.
 *
 * Replaces the two-method `GatePrompter` role (#556). There is no
 * "can anyone answer" pre-check: absent authority is the `DenyingAuthorizer`,
 * which answers by denying with a `confirmationUnavailable` marker.
 */
export interface AskEscalator {
  escalate(details: PromptPermissionDetails): Promise<PermissionPromptDecision>;
}

/**
 * Context-owning selection root for the Authorizer spine.
 *
 * The rewrite of `PromptingGateway`: owns the stored `ExtensionContext`, runs
 * `selectAuthorizer` once per activation, and implements `AskEscalator` by
 * delegating to the selected `Authorizer` via `PermissionPrompter`.
 *
 * `selectAuthorizer` encodes the liveness decision in *which* `Authorizer` it
 * returns (`LocalUserAuthorizer` / `ParentAuthorizer` when authority is
 * reachable, `DenyingAuthorizer` otherwise), so no separate confirmability
 * predicate survives (#556 dissolved `canConfirm()`).
 */
export class AuthorizerSelection
  implements AskEscalator, AuthorizerSelectionLifecycle
{
  private terminal: TerminalAuthorizer | null = null;

  constructor(
    private readonly deps: AuthorizerSelectionDeps & {
      prompter: PermissionPrompterApi;
      /** The session-scoped query injected into each chain link (ADR 0007 §3). */
      getPermissionQuery: () => PermissionQuery;
      /** Read-only lookup of registered links by name. */
      authorizerRegistry: AuthorizerLookup;
      /** The operator's configured link names, read live per ask. */
      getAuthorizerChain: () => string[];
      /** When true, links may grant `allow` on `external_directory` (opt-in). */
      getAllowAuthorizerOnExternalDirectory: () => boolean;
    },
  ) {}

  /**
   * Select the terminal Authorizer for `ctx` and store it. The non-terminal
   * chain is composed per ask in {@link escalate}, not here: ADR 0007 §4 lets a
   * link register in a `permissions:ready` handler that may fire after
   * activation, so link resolution is deferred to the session's first ask.
   */
  activate(ctx: ExtensionContext): void {
    this.terminal = selectAuthorizer(ctx, this.deps);
  }

  /**
   * Resolve the operator's `authorizerChain` names to registered links, in
   * config order (ADR 0007 invariant 1). An unregistered name is skipped with a
   * warning (invariant 2 — more prompting, never less); each resolved link is
   * wrapped in the bounded-delegation envelope so an `allow` on an excluded
   * surface cannot exceed the operator's policy.
   */
  private resolveConfiguredLinks(): Authorizer[] {
    const links: Authorizer[] = [];
    for (const name of this.deps.getAuthorizerChain()) {
      const authorize = this.deps.authorizerRegistry.get(name);
      if (authorize === undefined) {
        this.deps.logger.review("authorizer_chain_unregistered_link", { name });
        continue;
      }
      links.push({
        authorize: encloseInDelegationEnvelope(
          authorize,
          this.deps.getAllowAuthorizerOnExternalDirectory(),
        ),
      });
    }
    return links;
  }

  /** Clear the stored selection. */
  deactivate(): void {
    this.terminal = null;
  }

  /**
   * Escalate an ask through the composed chain and return its decision.
   *
   * Resolves the configured links freshly (so a link registered any time before
   * this first ask is honored) and composes them ahead of the selected
   * terminal. With zero links the composed value **is** the terminal instance,
   * so behavior is identical to a bare terminal escalation.
   *
   * Rejects if no terminal has been selected — i.e. before the session was
   * activated. Implements {@link AskEscalator}.
   */
  escalate(
    details: PromptPermissionDetails,
  ): Promise<PermissionPromptDecision> {
    if (this.terminal === null) {
      return Promise.reject(
        new Error("escalate called before the session was activated"),
      );
    }
    const chain = composeAuthorizerChain(
      this.resolveConfiguredLinks(),
      this.terminal,
      this.deps.getPermissionQuery(),
      this.deps.logger,
    );
    return this.deps.prompter.prompt(chain, details);
  }
}
