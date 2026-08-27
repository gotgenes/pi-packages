import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PermissionPromptDecision } from "#src/authority/permission-dialog";
import type { PermissionQuery } from "#src/service";
import {
  type AuthorizerSelectionDeps,
  type NamedAuthorizer,
  type SelectedAuthority,
  selectAuthorizer,
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
 * The node's chain role, as a fact a collaborator can read: does this node's
 * authorizer chain run, or does it relay its asks to a serving node
 * (ADR 0007 §7)?
 *
 * Consumed by the service lifecycle (which broadcasts it on `permissions:ready`
 * so a sibling extension learns it without knowing what a subagent is) and by
 * the registration observer (which records a link registered where no chain
 * runs). Both depend on this single-method view rather than the selection
 * itself, and neither may re-derive the role from `detection.isSubagent(ctx)`:
 * `selectAuthorizer` tests `hasUI` first, so a subagent with its own UI
 * adjudicates locally.
 */
export interface AdjudicationRole {
  adjudicatesLocally(): boolean;
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
  implements AskEscalator, AuthorizerSelectionLifecycle, AdjudicationRole
{
  private authority: SelectedAuthority | null = null;

  constructor(
    private readonly deps: AuthorizerSelectionDeps & {
      prompter: PermissionPrompterApi;
      /** The session-scoped query injected into each chain link (ADR 0007 §3). */
      getPermissionQuery: () => PermissionQuery;
      /** Read-only lookup of registered links by name. */
      authorizerRegistry: AuthorizerLookup;
      /** The operator's configured link names, read live per ask. */
      getAuthorizerChain: () => string[];
    },
  ) {}

  /**
   * Select the live authority for `ctx` and store it. The non-terminal
   * chain is composed per ask in {@link escalate}, not here: ADR 0007 §4 lets a
   * link register in a `permissions:ready` handler that may fire after
   * activation, so link resolution is deferred to the session's first ask.
   */
  activate(ctx: ExtensionContext): void {
    this.authority = selectAuthorizer(ctx, this.deps);
  }

  /**
   * The chain links for this ask.
   *
   * A node that adjudicates locally resolves its configured names; a relaying
   * node resolves none. Its terminal hands the ask to a serving node, which
   * resolves the request against its own recorded authority and escalates it
   * through *its* chain over the same child-fixed facts (#635) — so running
   * links here would adjudicate one ask twice, and a relaying node cannot host
   * a link in the first place (#699). The delegation is recorded rather than
   * reported as a fail-safe skip: an absent link is the design here, not the
   * misconfiguration `authorizer_chain_unregistered_link` exists to surface.
   */
  private linksFor(
    authority: SelectedAuthority,
    requestId: string,
  ): NamedAuthorizer[] {
    const configured = this.deps.getAuthorizerChain();
    if (configured.length === 0) {
      return [];
    }
    if (!authority.adjudicatesLocally) {
      this.deps.logger.review("authorizer_chain_delegated", {
        requestId,
        links: configured,
      });
      return [];
    }
    return this.resolveConfiguredLinks(configured, requestId);
  }

  /**
   * Resolve the operator's `authorizerChain` names to registered links, in
   * config order (ADR 0007 invariant 1). An unregistered name is skipped with a
   * warning (invariant 2 — more prompting, never less); each resolved link is
   * wrapped in the bounded-delegation envelope so an `allow` on an excluded
   * surface cannot exceed the operator's policy.
   *
   * The resolved names are recorded against the ask before any link runs — a
   * link that defers decides nothing and would otherwise leave no evidence it
   * was consulted at all, which is what makes "the judge never ran" and "the
   * judge ran and deferred" indistinguishable in the review log.
   */
  private resolveConfiguredLinks(
    configured: readonly string[],
    requestId: string,
  ): NamedAuthorizer[] {
    const links: NamedAuthorizer[] = [];
    const resolved: string[] = [];
    for (const name of configured) {
      const authorize = this.deps.authorizerRegistry.get(name);
      if (authorize === undefined) {
        this.deps.logger.review("authorizer_chain_unregistered_link", {
          requestId,
          name,
        });
        continue;
      }
      resolved.push(name);
      links.push({ name, authorize: encloseInDelegationEnvelope(authorize) });
    }
    if (resolved.length > 0) {
      this.deps.logger.review("authorizer_chain_resolved", {
        requestId,
        links: resolved,
      });
    }
    return links;
  }

  /**
   * Whether this node adjudicates its own asks. Implements
   * {@link AdjudicationRole}.
   *
   * Reports `true` with no selection stored — before activation, or after
   * deactivation. Production never reads it there (`activate` runs inside
   * `PermissionSession.resetForNewSession`, ahead of every consumer), and
   * "this node adjudicates" is the fail-soft answer: it tells a sibling to
   * register, which a relaying node accepts and records rather than refusing
   * (ADR 0012 decision 4).
   */
  adjudicatesLocally(): boolean {
    return this.authority?.adjudicatesLocally ?? true;
  }

  /** Clear the stored selection. */
  deactivate(): void {
    this.authority = null;
  }

  /**
   * Escalate an ask through the composed chain and return its decision.
   *
   * Resolves this ask's links freshly (so a link registered any time before
   * this first ask is honored) and composes them ahead of the selected
   * terminal. With zero links — no chain configured, or a relaying node that
   * delegates adjudication to the serving node — the composed value **is** the
   * terminal instance, so behavior is identical to a bare terminal escalation.
   *
   * Rejects if no terminal has been selected — i.e. before the session was
   * activated. Implements {@link AskEscalator}.
   */
  escalate(
    details: PromptPermissionDetails,
  ): Promise<PermissionPromptDecision> {
    const authority = this.authority;
    if (authority === null) {
      return Promise.reject(
        new Error("escalate called before the session was activated"),
      );
    }
    const chain = composeAuthorizerChain(
      this.linksFor(authority, details.requestId),
      authority.terminal,
      this.deps.getPermissionQuery(),
      this.deps.logger,
    );
    return this.deps.prompter.prompt(chain, details);
  }
}
