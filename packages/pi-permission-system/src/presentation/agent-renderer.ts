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

/** The agent-facing render of a policy deny. */
export function renderPolicyDenial(
  payload: PromptPayload,
  ruleReason: string | null,
  budget: AgentRenderBudget = DEFAULT_RENDER_BUDGET,
): string {
  return tagged(
    `Denied by policy: ${identification(payload, budget, "")}${boundaryClause(payload)}${provenanceClause(payload)}.`,
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
    `The user denied this ${identification(payload, budget, "call")}${boundaryClause(payload)}${provenanceClause(payload)}.`,
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
    `This ${identification(payload, budget, "call")} requires approval, but no interactive UI is available.`,
    denialReason,
  );
}

// ── Sentence assembly ──────────────────────────────────────────────────────

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
 */
function identification(
  payload: PromptPayload,
  budget: AgentRenderBudget,
  callWord: string,
): string {
  return [
    `'${payload.request.surface}'`,
    callWord,
    invokedAsClause(payload),
    toolClause(payload),
    agentClause(payload),
    flaggedClause(payload, budget),
    ruleClause(payload),
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

/** The rule that fired, with the nested context that makes it intelligible. */
function ruleClause(payload: PromptPayload): string {
  const { matchedPattern, commandContext } = payload.request;
  const parts: string[] = [];
  if (matchedPattern !== null) {
    parts.push(`rule '${matchedPattern}'`);
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
