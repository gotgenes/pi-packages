import type { AuthorizerLog, PermissionQuery } from "#src/service";
import { narrowAsk } from "./ask-narrowing";
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
 *
 * A link's `allow_units` narrows the ask the rest of the chain sees (ADR 0007
 * §9). When the terminal answers a narrowed ask for the session, the decision
 * names the narrowed grants, since the recorder otherwise grants the gate's
 * suggestion for the whole ask.
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
        const step = stepFromVerdict(link.name, verdict, current, log);
        if (step.kind === "decided") {
          return step.decision;
        }
        current = step.details;
      }
      const decision = await terminal.authorize(current);
      return current === details
        ? decision
        : withNarrowedGrants(decision, current);
    },
  };
}

/**
 * Name, on a session-scoped answer to a narrowed ask, the grants that answer
 * covers: the narrowed ask's own, or none when it offers none. Never left
 * absent, because absence means the gate's suggestion for the whole ask.
 */
function withNarrowedGrants(
  decision: PermissionPromptDecision,
  narrowed: PromptPermissionDetails,
): PermissionPromptDecision {
  if (
    decision.state !== "approved_for_session" &&
    decision.state !== "approved_for_serving_session"
  ) {
    return decision;
  }
  return {
    ...decision,
    // A terminal that already names narrowed grants answered an ask narrowed
    // further down its own path (a relay whose serving node narrowed it), so
    // its list is the narrower one and is kept.
    narrowedGrants:
      decision.narrowedGrants ?? narrowed.sessionApproval?.grants ?? [],
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
  log: AuthorizerLog,
): ChainStep {
  switch (verdict.kind) {
    case "allow":
      return { kind: "decided", decision: linkAllowed(name) };
    case "allow_units":
      return stepFromPartialAllow(name, verdict.units, details, log);
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

/**
 * A link's allow of the whole call.
 *
 * A link grant is non-persistent (state `approved`, never
 * `approved_for_session`), per ADR 0007's off-by-default envelope.
 */
function linkAllowed(name: string): PermissionPromptDecision {
  return {
    approved: true,
    state: "approved",
    decidedBy: decidedByLink(name, "allow", null),
  };
}

/**
 * The step a partial allow takes: allow the call once no unit is left, continue
 * with the narrowed ask otherwise, and defer when it named no asking unit.
 *
 * Every narrowing is recorded where it is taken, since the decision for the
 * call names only whoever decided the last of it.
 */
function stepFromPartialAllow(
  name: string,
  units: readonly string[],
  details: PromptPermissionDetails,
  log: AuthorizerLog,
): ChainStep {
  const narrowed = narrowAsk(details, namedUnits(units));
  if (narrowed.kind === "unchanged") return { kind: "continue", details };
  log.review("authorizer_units_allowed", {
    requestId: details.requestId,
    link: name,
    allowedUnits: narrowed.allowedUnits,
    remainingUnits: narrowed.kind === "settled" ? [] : narrowed.remainingUnits,
  });
  return narrowed.kind === "settled"
    ? { kind: "decided", decision: linkAllowed(name) }
    : { kind: "continue", details: narrowed.details };
}

/**
 * The unit names a link sent, keeping only strings: a link is another
 * extension's code, and a malformed list must name nothing rather than be
 * read character by character.
 */
function namedUnits(units: unknown): string[] {
  return Array.isArray(units)
    ? units.filter((unit): unit is string => typeof unit === "string")
    : [];
}

function decidedByLink(
  name: string,
  verdict: "allow" | "deny",
  reason: string | null,
): DecisionSource {
  return { kind: "authorizer", name, verdict, reason };
}
