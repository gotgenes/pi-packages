import {
  classifyToolKind,
  isMcpCheck,
  isProxyMcpCheck,
} from "#src/access-intent/tool-kind";
import type { ToolPreviewFormatter } from "#src/tool-input/tool-preview-formatter";
import type { AskingBashUnit, PermissionCheckResult } from "#src/types";
import { getNonEmptyString, toRecord } from "#src/value-guards";
import type { PromptEvidence, PromptPayload } from "./prompt-payload";
import { localRequester } from "./prompt-payload";

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
      matchedSpelling: check.matchedSpelling ?? null,
      commandContext: check.commandContext ?? null,
      executedUnit: check.executedUnit ?? null,
      decidingPath: null,
      ...otherAskingUnitsFact(check, bash),
    },
    evidence: bash
      ? fullCommandEvidence(facts)
      : inputPreviewEvidence(facts, isProxyMcpCheck(check)),
    annotations: [],
  };
}

/**
 * The payload of a bash chain's ask narrowed to the units still asking, in
 * chain order, after some were decided.
 *
 * When the value's unit is still the first one left, every fact about it
 * stands and only the other units shrink. Otherwise the first unit left becomes
 * the value with its own rule; the facts only the gate's winner carried (its
 * spelling, wrapper, and context) are not known for it, so they read `null`.
 * The evidence is kept whole: the full command is what will run.
 */
export function narrowBashAskPayload(
  payload: PromptPayload,
  remaining: readonly AskingBashUnit[],
): PromptPayload {
  const { otherAskingUnits: _previous, ...request } = payload.request;
  const commands = remaining.map((unit) => unit.command);
  const head = remaining.at(0);
  if (head === undefined || head.command === request.value) {
    return {
      ...payload,
      request: { ...request, ...otherAskingUnits(commands, request.value) },
    };
  }
  return {
    ...payload,
    request: {
      ...request,
      value: head.command,
      matchedPattern: head.matchedPattern ?? null,
      matchedSpelling: null,
      executedUnit: null,
      commandContext: null,
      ...otherAskingUnits(commands, head.command),
    },
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

/**
 * Every other unit of a bash chain the gate left asking, beside the one the
 * value names: the answer covers them all, so the ask has to name them all.
 */
function otherAskingUnitsFact(
  check: PermissionCheckResult,
  bash: boolean,
): { otherAskingUnits?: string[] } {
  if (!bash || check.askingUnits === undefined) return {};
  return otherAskingUnits(
    check.askingUnits.map((unit) => unit.command),
    check.command ?? "",
  );
}

/**
 * The asking commands beside the one `value` names.
 *
 * Only the first command matching the value is removed, so a repeated command
 * (`echo a; echo a`) is still listed once. Absent when the value is the only
 * asking unit.
 */
function otherAskingUnits(
  commands: readonly string[],
  value: string,
): { otherAskingUnits?: string[] } {
  const valueIndex = commands.indexOf(value);
  const others = commands.filter((_command, index) => index !== valueIndex);
  return others.length === 0 ? {} : { otherAskingUnits: others };
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
 * A proxied MCP ask previews under the `mcp` key rather than the qualified
 * target, so a registered MCP formatter is consulted for every server. A Pi
 * MCP tool's input is its own arguments, so it previews under its own name.
 */
function inputPreviewEvidence(
  facts: ToolAskFacts,
  proxyMcp: boolean,
): PromptEvidence[] {
  const preview = facts.formatter?.formatToolInputForPrompt(
    proxyMcp ? "mcp" : facts.check.toolName,
    facts.input,
  );
  return preview ? [{ label: "input", text: preview, detail: null }] : [];
}
