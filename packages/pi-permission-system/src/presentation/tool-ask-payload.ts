import { classifyToolKind, isMcpCheck } from "#src/access-intent/tool-kind";
import type {
  PromptEvidence,
  PromptPayload,
} from "#src/presentation/prompt-payload";
import { localRequester } from "#src/presentation/prompt-payload";
import type { ToolPreviewFormatter } from "#src/tool-preview-formatter";
import type { PermissionCheckResult } from "#src/types";
import { getNonEmptyString, toRecord } from "#src/value-guards";

/** The facts the per-tool gate holds when it raises an ask. */
export interface ToolAskFacts {
  /** The resolved check: the gated tool, the matched rule, the offending unit. */
  check: PermissionCheckResult;
  agentName: string | null;
  /** The gate surface the rule fired on — `bash` for a shell alias (#574). */
  surface: string;
  /** The tool the agent actually called, when a shell alias re-exposes bash. */
  invokedToolName?: string | null;
  /** The raw tool input, the source of the input-preview evidence. */
  input?: unknown;
  /** Renders the per-tool input preview; absent means no preview evidence. */
  formatter?: ToolPreviewFormatter;
}

/**
 * Build the payload for the per-tool gate: a bash, MCP, or generic-tool ask.
 *
 * The branch decides only the payload's `kind` and which fact is the
 * decision-relevant `value`; how any of it reads is a renderer's decision.
 */
export function buildToolAskPayload(facts: ToolAskFacts): PromptPayload {
  const { check } = facts;
  const bash = classifyToolKind(check.toolName) === "bash";
  const mcp = isMcpCheck(check) && check.target !== undefined;

  return {
    kind: bash ? "bash" : mcp ? "mcp" : "tool",
    request: {
      requester: localRequester(facts.agentName),
      surface: facts.surface,
      toolName: check.toolName,
      invokedToolName: distinctInvokedName(facts),
      value: askValue(check, bash, mcp),
      matchedPattern: check.matchedPattern ?? null,
      commandContext: check.commandContext ?? null,
      executedUnit: check.executedUnit ?? null,
    },
    evidence: bash
      ? fullCommandEvidence(facts)
      : inputPreviewEvidence(facts, mcp),
    annotations: [],
  };
}

/**
 * The decision-relevant value: the offending command for bash, the qualified
 * target for MCP, the tool name otherwise.
 *
 * A bash check with no command yields the empty string rather than the tool
 * name — the ask is about a command, and naming the surface instead would
 * assert a command that was never resolved.
 */
function askValue(
  check: PermissionCheckResult,
  bash: boolean,
  mcp: boolean,
): string {
  if (bash) return check.command ?? "";
  if (mcp) return check.target ?? "";
  return check.toolName;
}

/** The invoked tool name, but only when it is a fact the gated name does not carry. */
function distinctInvokedName(facts: ToolAskFacts): string | null {
  const invoked = facts.invokedToolName ?? null;
  return invoked === null || invoked === facts.check.toolName ? null : invoked;
}

/** The enclosing command, when the gated unit is only part of what will run. */
function fullCommandEvidence(facts: ToolAskFacts): PromptEvidence[] {
  const fullCommand = getNonEmptyString(toRecord(facts.input).command);
  if (fullCommand === null || fullCommand === facts.check.command) {
    return [];
  }
  return [{ label: "full command", text: fullCommand, detail: null }];
}

/**
 * The per-tool input preview, when a formatter is registered and produces one.
 *
 * An MCP ask previews under the `mcp` key rather than the qualified target, so
 * a registered MCP formatter is consulted for every server.
 */
function inputPreviewEvidence(
  facts: ToolAskFacts,
  mcp: boolean,
): PromptEvidence[] {
  const preview = facts.formatter?.formatToolInputForPrompt(
    mcp ? "mcp" : facts.check.toolName,
    facts.input,
  );
  return preview ? [{ label: "input", text: preview, detail: null }] : [];
}
