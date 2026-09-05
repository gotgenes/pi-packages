/**
 * Centralized construction for `permissions:ui_prompt` payloads.
 *
 * The single builder `buildUiPrompt` handles both direct and forwarded asks, so
 * the public contract's shape — including the normalized `surface`/`value`
 * projection and the `forwarding` context — lives in exactly one place and
 * cannot drift by source.
 *
 * This module is a leaf: it owns narrow input types that each call site's
 * domain object satisfies structurally, so it imports nothing from the
 * prompter or forwarding modules (no import cycles, correct layering).
 */

import type { PromptPayload } from "#src/presentation/prompt-payload";
import type {
  ForwardedPromptContext,
  PermissionUiPromptEvent,
} from "./permission-events";

/** Input for a direct (non-forwarded) tool or skill prompt. */
export interface DirectPromptInput {
  requestId: string;
  source: "tool_call" | "skill_input" | "skill_read";
  agentName: string | null;
  /** The ask's complete payload; the event carries its invariant core alone. */
  payload: PromptPayload;
  toolName?: string;
  skillName?: string;
  path?: string;
  command?: string;
  target?: string;
}

/**
 * Input for any UI prompt — direct or forwarded.
 *
 * A direct prompt supplies only the `DirectPromptInput` fields and lets
 * `surface`/`value` derive and `forwarding` default to `null`; a forwarded ask
 * supplies the child's original `surface`/`value` projection explicitly and a
 * populated `forwarding` context, so the parent's broadcast stays non-degraded
 * (the #292 contract hardening).
 */
export interface UiPromptInput extends DirectPromptInput {
  /** Explicit display surface; falls back to the derived projection when omitted. */
  surface?: string | null;
  /** Explicit display value; falls back to the derived projection when omitted. */
  value?: string | null;
  /** Forwarding context for a forwarded subagent ask; `null`/omitted for a direct prompt. */
  forwarding?: ForwardedPromptContext | null;
}

/**
 * Build a `permissions:ui_prompt` event from either a direct or a forwarded ask.
 *
 * `surface`/`value` use the explicit override when the caller sets them (an
 * explicit `null` is honored, not treated as "derive"); otherwise they fall
 * back to the direct-prompt projection. `forwarding` passes through, defaulting
 * to `null`.
 */
export function buildUiPrompt(input: UiPromptInput): PermissionUiPromptEvent {
  return {
    requestId: input.requestId,
    source: input.source,
    surface: input.surface !== undefined ? input.surface : directSurface(input),
    value: input.value !== undefined ? input.value : directValue(input),
    agentName: input.agentName,
    request: input.payload.request,
    forwarding: input.forwarding ?? null,
  };
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
