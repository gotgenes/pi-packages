/**
 * parent-snapshot.ts — Capture parent session state as a plain data snapshot.
 */

import { buildParentContext } from "#src/session/context";
import type { SessionContext } from "#src/types";

/**
 * Plain data snapshot of the parent session state captured at spawn time.
 * Replaces live `ExtensionContext` references so queued agents don't read stale state.
 */
export interface ParentSnapshot {
  /** Parent working directory. */
  cwd: string;
  /** Parent's effective system prompt (for append-mode agents). */
  systemPrompt: string;
  /** Parent's current model instance (fallback when agent config has no model). */
  model: unknown;
  /** Model registry for resolving config.model strings and creating sessions. */
  modelRegistry: {
    find(provider: string, modelId: string): unknown;
    getAvailable?(): Array<{ provider: string; id: string }>;
  };
  /** Active parent tool names captured at spawn time. */
  activeTools: string[];
  /** Pre-built parent conversation text (when inheritContext was requested). */
  parentContext?: string;
}

/**
 * Build an immutable snapshot of the parent session state.
 *
 * Called once at spawn time so queued agents capture state as it existed
 * when the user requested the agent, not when a queue slot opens.
 */
export function buildParentSnapshot(
  ctx: SessionContext,
  inheritContext?: boolean,
  activeTools: string[] = [],
): ParentSnapshot {
  const parentContext = inheritContext ? buildParentContext(ctx) : undefined;
  return {
    cwd: ctx.cwd,
    systemPrompt: ctx.getSystemPrompt(),
    model: ctx.model,

    modelRegistry: ctx.modelRegistry!,
    activeTools,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- || intentional: converts empty string to undefined as well as null/undefined
    parentContext: parentContext || undefined,
  };
}
