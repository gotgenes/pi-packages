/**
 * parent-snapshot.ts — Capture parent session state as a plain data snapshot.
 */

import type { Model } from "@earendil-works/pi-ai";
import { buildParentContext } from "#src/session/context";
import type { ModelRegistry } from "#src/session/model-resolver";
import type { SessionContext } from "#src/types";

/**
 * The parent session's operator-authored prompt parts, as Pi reports them on
 * `before_agent_start`.
 *
 * A narrow structural slice of Pi's `BuildSystemPromptOptions` holding the
 * layers an operator wrote and nothing Pi or a tool contributed. `skills` is
 * excluded for the reason ADR 0006 cuts the catalogue: the child loads its
 * own. `promptGuidelines` is excluded because Pi derives it per session from
 * the tools actually in the registry, so inheriting the parent's would assert
 * guidance for tools the child may not hold — the defect ADR 0008 removed with
 * the `<sub_agent_context>` block. `selectedTools` and `toolSnippets` are
 * excluded because the tool surface is node-local prose.
 */
export interface ParentPromptOptions {
  /** Context files (AGENTS.md and kin) Pi loaded for the parent session. */
  contextFiles?: Array<{ path: string; content: string }>;
  /** Custom system prompt (`--system-prompt`), when the parent runs one. */
  customPrompt?: string;
  /** Appended system prompt text (`--append-system-prompt`). */
  appendSystemPrompt?: string;
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
  /** Parent's current model instance (fallback when agent config has no model). */
  model: Model<any> | undefined;
  /** Model registry for resolving config.model strings and creating sessions. */
  modelRegistry: ModelRegistry;
  /** Pre-built parent conversation text (when inheritContext was requested). */
  parentContext?: string;
  /**
   * The parent's operator-authored parts, rendered as an identity a child on a
   * re-homing provider may adopt in place of the assembled prompt (ADR 0009).
   * Undefined when Pi has assembled no prompt yet, or when the parent has no
   * such parts.
   */
  portablePrompt?: string;
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
    model: ctx.model,
    modelRegistry: ctx.modelRegistry,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- || intentional: converts empty string to undefined as well as null/undefined
    parentContext: parentContext || undefined,
    portablePrompt: buildPortablePrompt(promptOptions),
  };
}

/**
 * Compose the parent's operator-authored parts into an identity a child may
 * adopt, in the order Pi's own `buildSystemPrompt` composes them: the custom
 * prompt, then the appended prompt, then the project-context block.
 *
 * The result is what Pi would assemble for a session with a custom prompt and
 * no tools or skills, so a host that re-homes it sees text shaped the way its
 * own harness produces — not Pi's base preamble.
 *
 * Returns undefined when no part survives, which routes the caller to the
 * generic base rather than back to the full prompt.
 */
function buildPortablePrompt(options?: ParentPromptOptions): string | undefined {
  if (!options) return undefined;
  const sections: string[] = [];
  const custom = options.customPrompt?.trim();
  if (custom) sections.push(custom);
  const appended = options.appendSystemPrompt?.trim();
  if (appended) sections.push(appended);
  const projectContext = renderProjectContext(options.contextFiles);
  if (projectContext) sections.push(projectContext);
  return sections.length > 0 ? sections.join("\n\n") : undefined;
}

/**
 * Render context files as Pi's `<project_context>` block, byte for byte.
 *
 * Pi writes a lead-in sentence and separates each `<project_instructions>`
 * block with a blank line; matching it exactly is what keeps a portable child's
 * project instructions indistinguishable from a parent's.
 */
function renderProjectContext(
  contextFiles: ParentPromptOptions["contextFiles"],
): string | undefined {
  if (!contextFiles || contextFiles.length === 0) return undefined;
  const blocks = contextFiles.map(
    ({ path, content }) =>
      `<project_instructions path="${path}">\n${content}\n</project_instructions>\n`,
  );
  return `<project_context>\n\nProject-specific instructions and guidelines:\n\n${blocks.join("\n")}\n</project_context>`;
}
