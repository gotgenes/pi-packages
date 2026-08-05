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
 */

import type { Authorizer } from "./authorizer";

/**
 * Thrown when a second authorizer attempts to register the same link name.
 *
 * Exported so downstream extensions can reliably catch duplicate-registration
 * in child sessions without string-matching the error message.
 */
export class AuthorizerAlreadyRegisteredError extends Error {
  readonly code = "AUTHORIZER_ALREADY_REGISTERED" as const;

  constructor(readonly linkName: string) {
    super(`An authorizer is already registered for '${linkName}'.`);
    this.name = "AuthorizerAlreadyRegisteredError";
  }
}

/**
 * Return true when `value` matches the duplicate-registration error shape.
 *
 * Consumers should prefer this guard over `instanceof` across extension
 * boundaries, where each extension may import a different module instance.
 */
export function isAuthorizerAlreadyRegisteredError(
  value: unknown,
): value is AuthorizerAlreadyRegisteredError {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.name === "AuthorizerAlreadyRegisteredError" &&
    candidate.code === "AUTHORIZER_ALREADY_REGISTERED" &&
    typeof candidate.linkName === "string"
  );
}

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
      throw new AuthorizerAlreadyRegisteredError(name);
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
