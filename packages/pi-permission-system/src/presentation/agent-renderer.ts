import {
  type DecisionSource,
  effectiveDecider,
} from "#src/authority/decision-source";
import { EXTENSION_ID } from "#src/extension-config";
import { DEFAULT_RENDER_BUDGET } from "#src/presentation/dialog-renderer";
import {
  describeBashCommandContext,
  flaggedElementLabel,
  flaggedElements,
} from "#src/presentation/fact-vocabulary";
import {
  allEvidence,
  findEvidence,
  type PromptPayload,
} from "#src/presentation/prompt-payload";
import type { BashCommandContext } from "#src/types";

/**
 * The agent-facing render of a refused permission ask (ADR 0011 §7).
 *
 * The rule that governs this renderer and no other:
 *
 * > The agent renderer identifies the call; it does not reproduce it.
 *
 * The agent authored the tool call, and the harness returns this text as that
 * call's own tool result with its arguments still in context, so echoing the
 * input back tells it nothing it did not already have. What is new is the
 * verdict: which surface gated the call, which rule matched, which of the
 * call's operands tripped it, and what the human said.
 *
 * The command is the one value never rendered — it is the payload that took
 * over the viewport in #710 and the context window on every denial. The
 * flagged element (a path, an MCP target, a skill) *is* rendered, because
 * which operand a rule fired on is below tool-call granularity and the agent
 * cannot recover it from its own arguments; being agent input, it is capped
 * rather than structurally bounded.
 */

/** Attribution tag on every block reason this extension produces. */
export const EXTENSION_TAG = `[${EXTENSION_ID}]`;

/** How much room the flagged element has, as the operator configured it. */
export interface AgentRenderBudget {
  /** Maximum characters of the flagged element's text. */
  readonly fieldMaxWidth: number;
}

/**
 * The agent-facing render a refused ask earns, chosen by what refused it.
 *
 * The single dispatch point for the refusal renderers below, so which sentence
 * the agent gets is decided once from the decider stamped on the decision
 * (#726) rather than re-derived from a marker at each caller. Being told a
 * policy extension refused the call, rather than the operator, is what lets an
 * agent read a link's corrective reason as policy instead of as the user's
 * instruction (ADR 0011 §7).
 *
 * A `forwarded` decision is dispatched on the decider inside the responding
 * session: the hop says *where*, and the agent is told *what*.
 *
 * Exhaustive with no `default`, so a new {@link DecisionSource} variant is a
 * compile error here rather than a silent user attribution.
 */
export function renderRefusal(
  payload: PromptPayload,
  decidedBy: DecisionSource,
  denialReason: string | null,
  budget: AgentRenderBudget = DEFAULT_RENDER_BUDGET,
): string {
  const decider = effectiveDecider(decidedBy);
  // The hop the unwrap discarded: *where* the decision was made. Kept as a
  // bare fact rather than the responder's identity, which stays undisclosed.
  const decidedElsewhere = decidedBy.kind === "forwarded";
  switch (decider.kind) {
    case "authorizer":
      return renderAuthorizerDenial(
        payload,
        decider.name,
        denialReason,
        budget,
      );
    case "unavailable":
      return renderUnavailableDenial(payload, denialReason, budget);
    case "rule":
      return renderEscalatedPolicyDenial(
        payload,
        { pattern: decider.pattern, decidedElsewhere },
        denialReason,
        budget,
      );
    // The remaining kinds never refuse: they only ever allow. A `forwarded`
    // reaching here named no inner decider (an older responder), so the hop
    // is all that is known and today's text is the fail-soft answer.
    case "user":
    case "gate_error":
    case "session_approval":
    case "infrastructure_read":
    case "yolo":
    case "forwarded":
      return renderUserDenial(payload, denialReason, budget);
  }
}

/** The agent-facing render of a policy deny. */
export function renderPolicyDenial(
  payload: PromptPayload,
  ruleReason: string | null,
  budget: AgentRenderBudget = DEFAULT_RENDER_BUDGET,
): string {
  return tagged(
    `Denied by policy: ${identification(payload, budget, "", askRuleClause(payload))}${boundaryClause(payload)}${provenanceClause(payload)}.`,
    ruleReason,
  );
}

/** The agent-facing render of a human's denial at an interactive prompt. */
export function renderUserDenial(
  payload: PromptPayload,
  denialReason: string | null,
  budget: AgentRenderBudget = DEFAULT_RENDER_BUDGET,
): string {
  return tagged(
    `The user denied this ${identification(payload, budget, "call", askRuleClause(payload))}${boundaryClause(payload)}${provenanceClause(payload)}.`,
    denialReason,
  );
}

/**
 * The agent-facing render of a registered `authorizerChain` link's refusal.
 *
 * Names the link, because "a policy extension the operator configured refused
 * this" and "the operator refused this" are different facts and only one of
 * them was true (#772). The name is operator configuration rather than agent
 * input, so it is not capped — the same treatment the matched rule gets.
 */
export function renderAuthorizerDenial(
  payload: PromptPayload,
  linkName: string,
  denialReason: string | null,
  budget: AgentRenderBudget = DEFAULT_RENDER_BUDGET,
): string {
  return tagged(
    `The '${linkName}' authorizer denied this ${identification(payload, budget, "call", askRuleClause(payload))}${boundaryClause(payload)}${provenanceClause(payload)}.`,
    denialReason,
  );
}

/** The rule that refused an escalated ask, and where it sat. */
export interface EscalatedRule {
  /** The pattern the deciding node's rule matched; `null` when none was recorded. */
  readonly pattern: string | null;
  /** Whether that node was reached through a forwarding hop. */
  readonly decidedElsewhere: boolean;
}

/**
 * The agent-facing render of a policy denial an escalation came back with.
 *
 * Distinct from {@link renderPolicyDenial} in which rule it names. That one
 * renders the rule on this session's payload, which is the rule that decided
 * when recorded authority answered locally. Here the ask was escalated, so the
 * payload's rule is the one that raised the *ask* and the rule that *denied*
 * lives on the decision — naming the payload's would name the wrong rule while
 * looking correct (ADR 0011 §10, #844).
 */
export function renderEscalatedPolicyDenial(
  payload: PromptPayload,
  rule: EscalatedRule,
  denialReason: string | null,
  budget: AgentRenderBudget = DEFAULT_RENDER_BUDGET,
): string {
  const decidedRule = ruleClause(rule.pattern, payload.request.commandContext);
  return tagged(
    `A policy rule${servingClause(rule.decidedElsewhere)} denied this ${identification(payload, budget, "call", decidedRule)}${boundaryClause(payload)}${provenanceClause(payload)}.`,
    denialReason,
  );
}

/** The agent-facing render when no live authority could answer the ask. */
export function renderUnavailableDenial(
  payload: PromptPayload,
  denialReason: string | null,
  budget: AgentRenderBudget = DEFAULT_RENDER_BUDGET,
): string {
  return tagged(
    `This ${identification(payload, budget, "call", askRuleClause(payload))} requires approval, but no interactive UI is available.`,
    denialReason,
  );
}

// ── Sentence assembly ──────────────────────────────────────────────────────

/**
 * Where the deciding authority sat, when it was not this session.
 *
 * Says that another session decided and never which one: the responder's
 * identity answers a question the requesting agent cannot act on, and §6 keeps
 * it off the render (ADR 0011 §10).
 */
function servingClause(decidedElsewhere: boolean): string {
  return decidedElsewhere ? " in the session serving this request" : "";
}

function tagged(sentence: string, reason: string | null): string {
  return `${EXTENSION_TAG} ${sentence}${reasonClause(reason)}`;
}

/**
 * What was refused, in the order a reader needs it: the gate surface, the tool
 * that reached it, who asked, which of the call's operands was flagged, and the
 * rule that fired.
 *
 * `callWord` is the noun the verdict needs after the surface — a user or
 * unavailable verdict refuses a *call*, while a policy deny refuses the
 * surface itself.
 *
 * `ruleText` is supplied rather than read off the payload, because an escalated
 * refusal names the rule that *decided* it, which is not always this session's
 * own (#844).
 */
function identification(
  payload: PromptPayload,
  budget: AgentRenderBudget,
  callWord: string,
  ruleText: string,
): string {
  return [
    `'${payload.request.surface}'`,
    callWord,
    invokedAsClause(payload),
    toolClause(payload),
    agentClause(payload),
    flaggedClause(payload, budget),
    ruleText,
  ]
    .filter((clause) => clause !== "")
    .join(" ");
}

/** The gated tool, named only when the surface has not already named it. */
function toolClause(payload: PromptPayload): string {
  const { toolName, surface } = payload.request;
  return toolName === null || toolName === surface
    ? ""
    : `for tool '${toolName}'`;
}

/** The name the agent actually called, when a shell alias re-exposed bash. */
function invokedAsClause(payload: PromptPayload): string {
  const { invokedToolName } = payload.request;
  return invokedToolName === null ? "" : `(invoked as '${invokedToolName}')`;
}

/** Which agent asked, when the ask carries a name. */
function agentClause(payload: PromptPayload): string {
  const { agentName } = payload.request.requester;
  return agentName ? `for agent '${agentName}'` : "";
}

/**
 * Which of the call's operands the rule fired on.
 *
 * Omitted for a bash ask, whose flagged element is the command §7 forbids
 * echoing; for a generic tool ask, whose value is the tool name an earlier
 * clause already stated; and for a payload-less forwarded relay, whose value
 * shape is unknown, so it cannot be shown to not be a command.
 */
function flaggedClause(
  payload: PromptPayload,
  budget: AgentRenderBudget,
): string {
  if (payload.kind === "bash" || payload.kind === "forwarded") {
    return "";
  }
  const label = flaggedElementLabel(payload);
  const elements = flaggedElements(payload).filter(
    (element) => element !== payload.request.toolName,
  );
  if (elements.length === 0) {
    return "";
  }
  const noun = elements.length === 1 ? label : `${label}s`;
  return `for ${noun} ${elements
    .map(
      (element) =>
        `'${cap(element, budget)}'${resolvedAlias(payload, element)}`,
    )
    .join(", ")}`;
}

/** The canonical target of a flagged path, when it names somewhere else. */
function resolvedAlias(payload: PromptPayload, element: string): string {
  const resolved =
    findEvidence(payload, "resolves to")?.text ??
    allEvidence(payload, "external path").find(
      (entry) => entry.text === element,
    )?.detail;
  return resolved ? ` (resolves to '${resolved}')` : "";
}

/** The rule that raised this session's own ask. */
function askRuleClause(payload: PromptPayload): string {
  return ruleClause(
    payload.request.matchedPattern,
    payload.request.commandContext,
  );
}

/**
 * The rule that fired, with the nested context that makes it intelligible.
 *
 * The pattern is a parameter rather than a payload read: an escalated refusal
 * renders the rule that decided it, which for a forwarded ask lives on the
 * response's decider and never on this session's payload. The command context
 * is a fact about the call either way, so it always comes from the payload.
 */
function ruleClause(
  pattern: string | null,
  commandContext: BashCommandContext | null,
): string {
  const parts: string[] = [];
  if (pattern !== null) {
    parts.push(`rule '${pattern}'`);
  }
  const context = describeBashCommandContext(commandContext);
  if (context !== undefined) {
    parts.push(`inside ${context}`);
  }
  return parts.length > 0 ? `(${parts.join(", ")})` : "";
}

/** The working directory the flagged paths escaped. */
function boundaryClause(payload: PromptPayload): string {
  const cwd = findEvidence(payload, "working directory")?.text;
  return cwd ? `: outside working directory '${cwd}'` : "";
}

/** The path a skill read reached its skill through. */
function provenanceClause(payload: PromptPayload): string {
  const readPath = findEvidence(payload, "read path")?.text;
  return readPath ? `, reached via '${readPath}'` : "";
}

function reasonClause(reason: string | null): string {
  return reason ? ` Reason: ${reason}.` : "";
}

/**
 * Narrow the flagged element to the budget.
 *
 * The command is never rendered, so this bounds the only agent-supplied value
 * that reaches the agent. A quantity bound applied uniformly, never a content
 * filter, with the same bare-ellipsis marker the dialog uses (ADR 0011 §4).
 */
function cap(text: string, budget: AgentRenderBudget): string {
  return text.length <= budget.fieldMaxWidth
    ? text
    : `${text.slice(0, budget.fieldMaxWidth)}\u2026`;
}
