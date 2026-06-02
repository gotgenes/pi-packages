/**
 * Centralized construction for `permissions:ui_prompt` payloads.
 *
 * Every emit site builds its event through one of these functions, so the
 * public contract's shape — including the normalized `surface`/`value`
 * projection — lives in exactly one place and cannot drift by source.
 *
 * This module is a leaf: it owns narrow input types that each call site's
 * domain object satisfies structurally, so it imports nothing from the
 * prompter, RPC, or forwarding modules (no import cycles, correct layering).
 */

import type {
  PermissionUiPromptEvent,
  PermissionUiPromptSource,
} from "./permission-events";

/** Input for a direct (non-forwarded) tool or skill prompt. */
export interface DirectPromptInput {
  requestId: string;
  source: "tool_call" | "skill_input" | "skill_read";
  agentName: string | null;
  message: string;
  toolName?: string;
  skillName?: string;
  path?: string;
  command?: string;
  target?: string;
}

/** Input for a `permissions:rpc:prompt` forwarded UI prompt. */
export interface RpcPromptInput {
  requestId: string;
  surface?: string | null;
  value?: string | null;
  agentName?: string | null;
  message: string;
}

/** Input for a file-forwarded subagent prompt shown by the parent UI. */
export interface ForwardedPromptInput {
  requestId: string;
  message: string;
  requesterAgentName: string | null;
  requesterSessionId: string | null;
  /** Original prompt origin, when the forwarded request carries it. */
  source?: PermissionUiPromptSource | null;
  /** Original normalized surface, when the forwarded request carries it. */
  surface?: string | null;
  /** Original normalized value, when the forwarded request carries it. */
  value?: string | null;
}

/** Normalized display surface for a direct prompt. */
function directSurface(input: DirectPromptInput): string | null {
  if (input.source === "skill_input" || input.source === "skill_read") {
    return "skill";
  }
  return input.toolName ?? null;
}

/** Normalized display value for a direct prompt. */
function directValue(input: DirectPromptInput): string | null {
  return (
    input.command ??
    input.path ??
    input.target ??
    input.skillName ??
    input.toolName ??
    null
  );
}

/** Build the UI prompt event for a direct tool/skill prompt. */
export function buildDirectUiPrompt(
  input: DirectPromptInput,
): PermissionUiPromptEvent {
  return {
    requestId: input.requestId,
    source: input.source,
    surface: directSurface(input),
    value: directValue(input),
    agentName: input.agentName,
    message: input.message,
    forwarding: null,
  };
}

/** Build the UI prompt event for an RPC-forwarded prompt. */
export function buildRpcUiPrompt(
  input: RpcPromptInput,
): PermissionUiPromptEvent {
  return {
    requestId: input.requestId,
    source: "rpc_prompt",
    surface: input.surface ?? null,
    value: input.value ?? null,
    agentName: input.agentName ?? null,
    message: input.message,
    forwarding: null,
  };
}

/**
 * Build the UI prompt event for a file-forwarded subagent prompt.
 *
 * `source` defaults to `"tool_call"` (the dominant forwarded origin) when the
 * persisted request predates carrying it — a parent on a newer version may read
 * a request written by an older child during an upgrade. The consumer still
 * receives the notify-now signal, message, and forwarding context.
 */
export function buildForwardedUiPrompt(
  input: ForwardedPromptInput,
): PermissionUiPromptEvent {
  return {
    requestId: input.requestId,
    source: input.source ?? "tool_call",
    surface: input.surface ?? null,
    value: input.value ?? null,
    agentName: input.requesterAgentName,
    message: input.message,
    forwarding: {
      requesterAgentName: input.requesterAgentName,
      requesterSessionId: input.requesterSessionId,
    },
  };
}
