import type { AuthorizerLog, PermissionQuery } from "#src/service";
import type {
  Authorizer,
  AuthorizerInvocationContext,
  AuthorizerVerdict,
  TerminalAuthorizer,
} from "./authorizer";
import { createDeniedPermissionDecision } from "./permission-dialog";

/**
 * Compose the live-authority chain (ADR 0007): try each non-terminal `link`
 * in order, and on `defer` fall through to the next link, ending at the
 * context-selected `terminal` that always decides.
 *
 * The signature is the type-level terminal-cannot-defer invariant: `links` are
 * deferring {@link Authorizer}s while `terminal` is a {@link TerminalAuthorizer}
 * (returns a full decision), so a deferring link cannot occupy the terminal
 * slot.
 *
 * Each link is handed the session-scoped `query`, the review-log `log`, and
 * the optional aggregate runtime `context` at `authorize` time (ADR 0007 §3)
 * so it queries the deterministic engine at gate parity and records its
 * decision trail; the terminal receives neither. With zero links the composed
 * chain **is** the terminal instance (identity), so behavior is byte-identical
 * to the pre-chain spine — the empty-links case that ships until a link
 * registers.
 */
export function composeAuthorizerChain(
  links: readonly Authorizer[],
  terminal: TerminalAuthorizer,
  query: PermissionQuery,
  log: AuthorizerLog,
  context: AuthorizerInvocationContext,
): TerminalAuthorizer {
  if (links.length === 0) {
    return terminal;
  }
  return {
    async authorize(details) {
      for (const link of links) {
        const verdict = await link.authorize(details, query, log, context);
        const decision = decideFromVerdict(verdict);
        if (decision) {
          return decision;
        }
        // `defer` \u2014 try the next link.
      }
      return terminal.authorize(details);
    },
  };
}

/** Map a link's decisive verdict to a decision; `defer` yields `null`. */
function decideFromVerdict(verdict: AuthorizerVerdict) {
  switch (verdict.kind) {
    case "allow":
      // A link grant is non-persistent (state `approved`, never
      // `approved_for_session`), per ADR 0007's off-by-default envelope.
      return { approved: true, state: "approved" } as const;
    case "deny":
      return createDeniedPermissionDecision(verdict.reason);
    case "defer":
      return null;
  }
}
