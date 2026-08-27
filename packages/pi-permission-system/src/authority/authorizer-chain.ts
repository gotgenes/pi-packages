import type { DecisionSource } from "#src/authority/decision-source";
import type { AuthorizerLog, PermissionQuery } from "#src/service";
import type {
  AuthorizerVerdict,
  NamedAuthorizer,
  TerminalAuthorizer,
} from "./authorizer";
import {
  createDeniedPermissionDecision,
  type PermissionPromptDecision,
} from "./permission-dialog";

/**
 * Compose the live-authority chain (ADR 0007): try each non-terminal `link`
 * in order, and on `defer` fall through to the next link, ending at the
 * context-selected `terminal` that always decides.
 *
 * The signature is the type-level terminal-cannot-defer invariant: `links` are
 * deferring {@link NamedAuthorizer}s while `terminal` is a
 * {@link TerminalAuthorizer} (returns a full decision), so a deferring link
 * cannot occupy the terminal slot.
 *
 * Each link is handed the session-scoped `query` and the review-log `log` at
 * `authorize` time (ADR 0007 §3) so it queries the deterministic engine at gate
 * parity and records its decision trail; the terminal receives neither. With
 * zero links the composed chain **is** the terminal instance (identity), so
 * behavior is byte-identical to the pre-chain spine — the empty-links case that
 * ships until a link registers.
 */
export function composeAuthorizerChain(
  links: readonly NamedAuthorizer[],
  terminal: TerminalAuthorizer,
  query: PermissionQuery,
  log: AuthorizerLog,
): TerminalAuthorizer {
  if (links.length === 0) {
    return terminal;
  }
  return {
    async authorize(details) {
      for (const link of links) {
        const verdict = await link.authorize(details, query, log);
        const decision = decideFromVerdict(link.name, verdict);
        if (decision) {
          return decision;
        }
        // `defer` \u2014 try the next link.
      }
      return terminal.authorize(details);
    },
  };
}

/**
 * Map a link's decisive verdict to a decision; `defer` yields `null`.
 *
 * The deciding link is named on the decision, not merely counted among the
 * consulted set the selection already records: a link ahead of it that
 * deferred decided nothing and must not be credited (#726).
 */
function decideFromVerdict(
  name: string,
  verdict: AuthorizerVerdict,
): PermissionPromptDecision | null {
  switch (verdict.kind) {
    case "allow":
      // A link grant is non-persistent (state `approved`, never
      // `approved_for_session`), per ADR 0007's off-by-default envelope.
      return {
        approved: true,
        state: "approved",
        decidedBy: decidedByLink(name, "allow", null),
      };
    case "deny":
      return {
        ...createDeniedPermissionDecision(verdict.reason),
        decidedBy: decidedByLink(name, "deny", verdict.reason ?? null),
      };
    case "defer":
      return null;
  }
}

function decidedByLink(
  name: string,
  verdict: "allow" | "deny",
  reason: string | null,
): DecisionSource {
  return { kind: "authorizer", name, verdict, reason };
}
