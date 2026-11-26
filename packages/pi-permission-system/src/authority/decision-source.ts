/**
 * What decided a permission request, recorded at the site that decided it.
 *
 * The decision paths are already distinct in the code — a session hit, an
 * auto-approval, an infrastructure read, a config rule, a chain link, a human
 * at a dialog, an unreachable authority — and each one knows what it is at the
 * moment it decides. This is that fact, carried to the record instead of being
 * discarded and re-guessed from an event name downstream.
 *
 * Every variant is **self-contained**: it repeats the detail that made it
 * decisive rather than leaning on a sibling log column. That duplicates
 * `surface` and the pattern on a local review line, and it is the only shape
 * that survives the forwarding hop, where the response file has no such
 * columns to lean on.
 */

/** Which human-facing surface the operator answered on. */
export type UserDecisionSurface = "dialog" | "select";

/** What turned auto-approve on: the `--auto-approve` launch flag, or the session command. */
export type AutoApproveSetter = "flag" | "command";

/**
 * Which asks an auto-approve scope covers: this node's own, every forwarded
 * one, or the forwarded asks of one requesting agent.
 */
export type AutoApproveScopeKind = "own" | "forwarded" | "agent";

export type DecisionSource =
  /** A human ruled, at the inline dialog or the `select`/`input` fallback. */
  | { kind: "user"; via: UserDecisionSurface }
  /** A registered `authorizerChain` link ruled; `name` is the configured name. */
  | {
      kind: "authorizer";
      name: string;
      verdict: "allow" | "deny";
      reason: string | null;
    }
  /** Recorded authority: a rule in the composed ruleset matched. */
  | {
      kind: "rule";
      surface: string;
      pattern: string | null;
      origin: string | null;
    }
  /** A session-scoped grant the operator made earlier in this session. */
  | { kind: "session_approval"; surface: string; pattern: string | null }
  /**
   * The session's auto-approve terminal allowed an ask every chain link
   * deferred. `setter` names what turned it on and `scope` which of its scopes
   * covered the ask; the requesting agent of an `agent` scope is already on
   * the record that carries this.
   */
  | {
      kind: "auto_approve";
      setter: AutoApproveSetter;
      scope: AutoApproveScopeKind;
    }
  /** A Pi infrastructure read, allowed by containment rather than by a rule. */
  | { kind: "infrastructure_read" }
  /**
   * No authority ever ruled: none was reachable, or the forwarding path gave
   * up before reaching one. `reason` names which path gave up.
   */
  | { kind: "unavailable"; reason: string }
  /** A gate threw, and the boundary blocked rather than allowed. */
  | { kind: "gate_error"; reason: string }
  /**
   * A human was shown the prompt and nobody answered it within the configured
   * `promptTimeoutMs` window, so the window denied. Distinct from
   * `unavailable`, where no prompt could be shown at all.
   */
  | { kind: "unanswered"; timeoutMs: number }
  /**
   * Another session decided. Recursive by design: the requesting side records
   * both that the decider was elsewhere and what, within that session, decided
   * — which is the distinction an audit of a forwarded ask needs.
   *
   * `decision` is `null` when the responder sent none (an older parent).
   */
  | {
      kind: "forwarded";
      responderSessionId: string | null;
      decision: DecisionSource | null;
    };

/**
 * How deep a `forwarded` chain may nest before {@link asDecisionSource} gives
 * up.
 *
 * Forwarding is depth-1 by invariant (child → root) and a relay hop makes it
 * two, so this is headroom rather than a working limit. It exists because the
 * value is read off disk: a recursive reader over a file another process wrote
 * is a stack-overflow surface, and the fail-closed answer is to stop.
 */
export const MAX_DECISION_SOURCE_DEPTH = 4;

/**
 * Narrow an unknown value to a {@link DecisionSource}, or `undefined`.
 *
 * Lives beside its type so a new variant updates the guard next door, following
 * `asPromptPayload` and `isPermissionDecisionState`. All-or-nothing: a
 * malformed field — at any nesting level — yields `undefined` rather than a
 * half-parsed record, because a provenance record that names a decider who did
 * not decide is worse than one that names none.
 */
export function asDecisionSource(value: unknown): DecisionSource | undefined {
  return narrowSource(value, MAX_DECISION_SOURCE_DEPTH);
}

/**
 * The decider a `forwarded` hop is standing in for: the innermost
 * non-`forwarded` source, or the hop itself when the responder named none.
 *
 * `forwarded` answers *where* a decision was made; every other variant answers
 * *what* made it. A reader asking the second question — how to name the
 * resolution, which refusal to render — wants the inner record, or it reports
 * the parent's policy as the operator's own answer.
 *
 * `responderSessionId` is deliberately dropped: the session that answered is a
 * separate fact, carried on the record itself and (for a served decision) on
 * the bus event's `forwarding` context.
 *
 * Bounded by {@link MAX_DECISION_SOURCE_DEPTH} like its sibling guard. A value
 * read off disk is already bounded there, and a locally-built one nests once
 * per hop, so the bound is insurance rather than a working limit; reaching it
 * yields the deepest frame seen, which reads as "decided elsewhere".
 */
export function effectiveDecider(source: DecisionSource): DecisionSource {
  let decider = source;
  for (let hop = 0; hop < MAX_DECISION_SOURCE_DEPTH; hop++) {
    if (decider.kind !== "forwarded" || decider.decision === null) {
      return decider;
    }
    decider = decider.decision;
  }
  return decider;
}

function narrowSource(
  value: unknown,
  depthBudget: number,
): DecisionSource | undefined {
  const candidate = asObject(value);
  if (!candidate) return undefined;

  switch (candidate.kind) {
    case "user":
      return narrowUser(candidate);
    case "authorizer":
      return narrowAuthorizer(candidate);
    case "rule":
      return narrowRule(candidate);
    case "session_approval":
      return narrowSessionApproval(candidate);
    case "auto_approve":
      return narrowAutoApprove(candidate);
    case "infrastructure_read":
      return { kind: "infrastructure_read" };
    case "unavailable":
      return typeof candidate.reason === "string"
        ? { kind: "unavailable", reason: candidate.reason }
        : undefined;
    case "gate_error":
      return typeof candidate.reason === "string"
        ? { kind: "gate_error", reason: candidate.reason }
        : undefined;
    case "unanswered":
      return narrowUnanswered(candidate);
    case "forwarded":
      return narrowForwarded(candidate, depthBudget);
    default:
      return undefined;
  }
}

function narrowUser(
  candidate: Record<string, unknown>,
): DecisionSource | undefined {
  const via = USER_DECISION_SURFACES.find((entry) => entry === candidate.via);
  return via ? { kind: "user", via } : undefined;
}

function narrowAutoApprove(
  candidate: Record<string, unknown>,
): DecisionSource | undefined {
  const setter = AUTO_APPROVE_SETTERS.find(
    (entry) => entry === candidate.setter,
  );
  const scope = AUTO_APPROVE_SCOPE_KINDS.find(
    (entry) => entry === candidate.scope,
  );
  return setter && scope ? { kind: "auto_approve", setter, scope } : undefined;
}

function narrowUnanswered(
  candidate: Record<string, unknown>,
): DecisionSource | undefined {
  const { timeoutMs } = candidate;
  return typeof timeoutMs === "number" &&
    Number.isFinite(timeoutMs) &&
    timeoutMs > 0
    ? { kind: "unanswered", timeoutMs }
    : undefined;
}

function narrowAuthorizer(
  candidate: Record<string, unknown>,
): DecisionSource | undefined {
  const verdict = AUTHORIZER_VERDICTS.find(
    (entry) => entry === candidate.verdict,
  );
  if (
    !verdict ||
    typeof candidate.name !== "string" ||
    !isNullableString(candidate.reason)
  ) {
    return undefined;
  }
  return {
    kind: "authorizer",
    name: candidate.name,
    verdict,
    reason: candidate.reason,
  };
}

function narrowRule(
  candidate: Record<string, unknown>,
): DecisionSource | undefined {
  if (
    typeof candidate.surface !== "string" ||
    !isNullableString(candidate.pattern) ||
    !isNullableString(candidate.origin)
  ) {
    return undefined;
  }
  return {
    kind: "rule",
    surface: candidate.surface,
    pattern: candidate.pattern,
    origin: candidate.origin,
  };
}

function narrowSessionApproval(
  candidate: Record<string, unknown>,
): DecisionSource | undefined {
  if (
    typeof candidate.surface !== "string" ||
    !isNullableString(candidate.pattern)
  ) {
    return undefined;
  }
  return {
    kind: "session_approval",
    surface: candidate.surface,
    pattern: candidate.pattern,
  };
}

/**
 * The inner decision is narrowed against a decremented budget, so a chain
 * deeper than {@link MAX_DECISION_SOURCE_DEPTH} is rejected whole rather than
 * truncated — a truncated chain would silently attribute the decision to the
 * last frame that fit.
 */
function narrowForwarded(
  candidate: Record<string, unknown>,
  depthBudget: number,
): DecisionSource | undefined {
  if (depthBudget <= 0 || !isNullableString(candidate.responderSessionId)) {
    return undefined;
  }
  if (candidate.decision === null) {
    return {
      kind: "forwarded",
      responderSessionId: candidate.responderSessionId,
      decision: null,
    };
  }
  const decision = narrowSource(candidate.decision, depthBudget - 1);
  return decision
    ? {
        kind: "forwarded",
        responderSessionId: candidate.responderSessionId,
        decision,
      }
    : undefined;
}

const USER_DECISION_SURFACES = [
  "dialog",
  "select",
] as const satisfies readonly UserDecisionSurface[];

const AUTHORIZER_VERDICTS = ["allow", "deny"] as const;

const AUTO_APPROVE_SETTERS = [
  "flag",
  "command",
] as const satisfies readonly AutoApproveSetter[];

const AUTO_APPROVE_SCOPE_KINDS = [
  "own",
  "forwarded",
  "agent",
] as const satisfies readonly AutoApproveScopeKind[];

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
