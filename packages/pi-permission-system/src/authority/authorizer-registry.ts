/**
 * Registry for named live-authority chain links (ADR 0007 §4).
 *
 * A downstream extension offers a named `Authorizer` link via
 * `PermissionsService.registerAuthorizer`; this registry stores the link's
 * `authorize` callback so composition can bind names to capabilities. One link
 * per name; duplicate registration throws.
 *
 * Registration alone grants no authority — a link decides nothing until the
 * operator names it in the `authorizerChain` config (the opt-in activation
 * model). `AuthorizerSelection` owns that config-order resolution; this registry
 * is storage only.
 *
 * A node that relays its asks runs no chain at all (ADR 0007 §7), so a link
 * registered there is accepted and never consulted — the vacant link cell.
 * {@link ObservedAuthorizerRegistrar} records that fact rather than refusing
 * the registration (ADR 0012 decision 4).
 */

import type { ReviewLogger } from "#src/session-logger";
import type { Authorizer } from "./authorizer";
import type { AdjudicationRole } from "./authorizer-selection";

/**
 * Read-only lookup used by chain composition (ISP — exposes only the read side,
 * not the registration surface).
 */
export interface AuthorizerLookup {
  get(name: string): Authorizer["authorize"] | undefined;
}

/**
 * Registration side of the registry (ISP — exposes only the write surface,
 * mirroring the read-only {@link AuthorizerLookup}).
 */
export interface AuthorizerRegistrar {
  register(name: string, authorize: Authorizer["authorize"]): () => void;
}

/**
 * Persistent registry mapping link names to their `authorize` callbacks.
 *
 * Owned by the extension factory (`index.ts`) so it survives across session
 * activations. Exposed to sibling extensions via
 * `PermissionsService.registerAuthorizer` and consulted by
 * `AuthorizerSelection` during chain resolution.
 */
export class AuthorizerRegistry
  implements AuthorizerLookup, AuthorizerRegistrar
{
  private readonly links = new Map<string, Authorizer["authorize"]>();

  /**
   * Register a link under `name`.
   *
   * Throws if a link is already registered for that name — keeps resolution
   * deterministic (a pi-permission-system package priority). Returns a disposer
   * that removes the link; the disposer is identity-guarded so a stale call
   * cannot evict a later registration.
   */
  register(name: string, authorize: Authorizer["authorize"]): () => void {
    if (this.links.has(name)) {
      throw new Error(`An authorizer is already registered for '${name}'.`);
    }
    this.links.set(name, authorize);
    return () => {
      if (this.links.get(name) === authorize) {
        this.links.delete(name);
      }
    };
  }

  get(name: string): Authorizer["authorize"] | undefined {
    return this.links.get(name);
  }
}

/**
 * The registrar a sibling extension reaches through `registerAuthorizer`:
 * accepts every registration, and records the ones this node will never
 * consult (ADR 0012 decision 4 — accept and observe).
 *
 * Registering everywhere is the correct default for a link author: the
 * architecture consults a link where adjudication happens, so a link needs no
 * placement ceremony and cannot be registered "in the wrong node". On a
 * relaying node that makes the registration vacant by the system's own routing
 * decision, not by author error — so it is honored (a working disposer comes
 * back) and written to the review log beside the per-ask
 * `authorizer_chain_delegated`, where an operator already looks to find out
 * where adjudication went.
 *
 * A decorator rather than a branch inside {@link AuthorizerRegistry}: storage
 * stays storage, and the chain's own lookup keeps reading the undecorated
 * registry.
 */
export class ObservedAuthorizerRegistrar implements AuthorizerRegistrar {
  constructor(
    private readonly registrar: AuthorizerRegistrar,
    private readonly role: AdjudicationRole,
    private readonly logger: ReviewLogger,
  ) {}

  /**
   * Register `name` into the underlying registry and return its disposer.
   *
   * The role is read per registration, not captured at construction: this
   * registrar outlives a session (the composition root owns it) while the
   * node's selected authority is per-activation. A duplicate registration
   * still throws, and records nothing — under the cross-node contract that is
   * a genuine author bug, not a vacancy.
   */
  register(name: string, authorize: Authorizer["authorize"]): () => void {
    const dispose = this.registrar.register(name, authorize);
    if (!this.role.adjudicatesLocally()) {
      this.logger.review("authorizer_link_vacant", { name });
    }
    return dispose;
  }
}
