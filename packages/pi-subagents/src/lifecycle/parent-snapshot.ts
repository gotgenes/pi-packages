/**
 * parent-snapshot.ts — Capture parent session state as a plain data snapshot.
 */

import type { Model } from "@earendil-works/pi-ai";
import { buildParentContext } from "#src/session/context";
import type { ModelRegistry } from "#src/session/model-resolver";
import type { SessionContext } from "#src/types";

/**
 * The parent session's portable prompt parts, as pi reports them on
 * `before_agent_start`. Narrow structural slice of pi's
 * `BuildSystemPromptOptions` — everything another harness could re-home
 * without dragging pi's base prompt along.
 */
export interface ParentPromptOptions {
  /** Context files (AGENTS.md and kin) pi loaded for the parent session. */
  contextFiles?: Array<{ path: string; content: string }>;
  /** Custom system prompt (--system-prompt), if the parent runs one. */
  customPrompt?: string;
  /** Appended system prompt text (--append-system-prompt). */
  appendSystemPrompt?: string;
  /** Additional guideline bullets contributed to the parent's prompt. */
  promptGuidelines?: string[];
}

/**
 * Plain data snapshot of the parent session state captured at spawn time.
 * Replaces live `ExtensionContext` references so queued agents don't read stale state.
 */
export interface ParentSnapshot {
  /** Parent working directory. */
  cwd: string;
  /** Parent's effective system prompt (for append-mode agents). */
  systemPrompt: string;
  /**
   * Parent's portable prompt parts (context files, custom/append prompts, added
   * guidelines) for `inherit_prompt: portable` agents — the assembled prompt
   * minus pi's harness base and per-session layers. Undefined when pi has not
   * assembled a prompt yet (no parent turn has run).
   */
  portablePrompt?: string;
  /** Parent's current model instance (fallback when agent config has no model). */
  model: Model<any> | undefined;
  /** Model registry for resolving config.model strings and creating sessions. */
  modelRegistry: ModelRegistry;
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
  promptOptions?: ParentPromptOptions,
): ParentSnapshot {
  const parentContext = inheritContext ? buildParentContext(ctx) : undefined;
  return {
    cwd: ctx.cwd,
    systemPrompt: ctx.getSystemPrompt(),
    portablePrompt: buildPortablePrompt(promptOptions),
    model: ctx.model,
    modelRegistry: ctx.modelRegistry,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- || intentional: converts empty string to undefined as well as null/undefined
    parentContext: parentContext || undefined,
  };
}

/**
 * Join the parent's portable prompt parts into an identity a child can adopt.
 *
 * Skills are deliberately absent: the child session loads its own catalogue,
 * and the full-inheritance path strips the parent's for the same staleness
 * reason (see `inheritedIdentity` in prompts.ts). Context files must be here —
 * the child loader runs with `noContextFiles: true`, so this is the only way
 * portable-inheriting children see project instructions at all.
 */
function buildPortablePrompt(options?: ParentPromptOptions): string | undefined {
  if (!options) return undefined;
  const parts: string[] = [];
  if (options.contextFiles?.length) {
    const files = options.contextFiles
      .map(({ path, content }) => `<project_instructions path="${path}">\n${content}\n</project_instructions>`)
      .join("\n");
    parts.push(`<project_context>\n${files}\n</project_context>`);
  }
  if (options.promptGuidelines?.length) {
    parts.push(options.promptGuidelines.join("\n"));
  }
  if (options.customPrompt?.trim()) parts.push(options.customPrompt.trim());
  if (options.appendSystemPrompt?.trim()) parts.push(options.appendSystemPrompt.trim());
  const joined = parts.join("\n\n");
  return joined || undefined;
}
