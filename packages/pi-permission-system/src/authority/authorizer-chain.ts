import type { AuthorizerLog, PermissionQuery } from "#src/service";
import type {
  AuthorizerVerdict,
  NamedAuthorizer,
  TerminalAuthorizer,
} from "./authorizer";
import type { DecisionSource } from "./decision-source";
import {
  createDeniedPermissionDecision,
  type PermissionPromptDecision,
} from "./permission-dialog";
import type { PromptPermissionDetails } from "./permission-prompter";

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
      let current = details;
      for (const link of links) {
        const verdict = await link.authorize(current, query, log);
        const step = stepFromVerdict(link.name, verdict, current);
        if (step.kind === "decided") {
          return step.decision;
        }
        current = step.details;
      }
      return terminal.authorize(current);
    },
  };
}

/**
 * What one link's verdict does to the chain: decide the ask, or continue to
 * the next link with the ask it leaves.
 */
type ChainStep =
  | { kind: "decided"; decision: PermissionPromptDecision }
  | { kind: "continue"; details: PromptPermissionDetails };

/**
 * Map a link's verdict to the chain's next step: a decisive verdict decides,
 * and `defer` continues with the same ask.
 *
 * The deciding link is named on the decision, not merely counted among the
 * consulted set the selection already records: a link ahead of it that
 * deferred decided nothing and must not be credited (#726).
 */
function stepFromVerdict(
  name: string,
  verdict: AuthorizerVerdict,
  details: PromptPermissionDetails,
): ChainStep {
  switch (verdict.kind) {
    case "allow":
      // A link grant is non-persistent (state `approved`, never
      // `approved_for_session`), per ADR 0007's off-by-default envelope.
      return {
        kind: "decided",
        decision: {
          approved: true,
          state: "approved",
          decidedBy: decidedByLink(name, "allow", null),
        },
      };
    case "deny":
      return {
        kind: "decided",
        decision: {
          ...createDeniedPermissionDecision(verdict.reason),
          decidedBy: decidedByLink(name, "deny", verdict.reason ?? null),
        },
      };
    case "defer":
      return { kind: "continue", details };
  }
  // A link is another extension's code, so a verdict this version does not
  // know (a newer kind, or a malformed value) reaches here at run time; it
  // decides nothing, which is the fail-safe reading (ADR 0007 invariant 2).
  return { kind: "continue", details };
}

function decidedByLink(
  name: string,
  verdict: "allow" | "deny",
  reason: string | null,
): DecisionSource {
  return { kind: "authorizer", name, verdict, reason };
}
