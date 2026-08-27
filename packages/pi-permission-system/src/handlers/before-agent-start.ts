import type {
  BeforeAgentStartEventResult,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { TurnPreparation } from "#src/handlers/session-turn-prep";
import type { PermissionResolver } from "#src/permission-resolver";
import type { PermissionSession } from "#src/permission-session";
import { resolveSkillPromptEntries } from "#src/skill-prompt-sanitizer";
import { sanitizeAvailableToolsSection } from "#src/system-prompt-sanitizer";
import { getToolNameFromValue, type ToolRegistry } from "#src/tool-registry";
import type { PermissionState } from "#src/types";

/** Minimal subset of BeforeAgentStartEvent used by this handler. */
interface BeforeAgentStartPayload {
  systemPrompt: string;
}

/**
 * Pure helper: returns true when the tool should be exposed to the agent.
 * Checks the tool-level permission (not command-level) so that a blanket
 * `bash: deny` hides the tool entirely before any invocation is attempted.
 */
export function shouldExposeTool(
  toolName: string,
  agentName: string | null,
  getToolPermission: (toolName: string, agentName?: string) => PermissionState,
): boolean {
  const toolPermission = getToolPermission(toolName, agentName ?? undefined);
  return toolPermission !== "deny";
}

/**
 * Handles the `before_agent_start` event: tool filtering + prompt sanitization.
 *
 * Recomputes the active tool set and the returned system-prompt override on
 * every fire (no memoization): the override must be returned each turn so that
 * skill filtering is reapplied and the wire prompt stays byte-stable, rather
 * than letting Pi reset to its skill-unfiltered base prompt on a cache hit.
 *
 * Constructor deps:
 * - `turnPrep` — brings the node up to date for the turn before anything reads
 *   session state
 * - `session` — encapsulates all mutable session state and lifecycle operations
 * - `resolver` — owns permission-query surface: `getToolPermission`, skill check
 * - `toolRegistry` — Pi tool API subset (getActive + setActive)
 */
export class AgentPrepHandler {
  constructor(
    private readonly turnPrep: TurnPreparation,
    private readonly session: PermissionSession,
    private readonly resolver: PermissionResolver,
    private readonly toolRegistry: ToolRegistry,
  ) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async handle(
    event: BeforeAgentStartPayload,
    ctx: ExtensionContext,
  ): Promise<BeforeAgentStartEventResult> {
    this.turnPrep.prepare(ctx);

    const agentName = this.session.resolveAgentName(ctx, event.systemPrompt);
    const activeTools = this.toolRegistry.getActive();
    const allowedTools: string[] = [];

    for (const tool of activeTools) {
      const toolName = getToolNameFromValue(tool);
      if (!toolName) {
        continue;
      }
      if (
        shouldExposeTool(toolName, agentName, (t, a) =>
          this.resolver.getToolPermission(t, a),
        )
      ) {
        allowedTools.push(toolName);
      }
    }

    this.toolRegistry.setActive(allowedTools);

    const toolPromptResult = sanitizeAvailableToolsSection(
      event.systemPrompt,
      allowedTools,
    );
    const skillPromptResult = resolveSkillPromptEntries(
      toolPromptResult.prompt,
      this.resolver,
      agentName,
      this.session.getPathNormalizer(),
    );
    this.session.setActiveSkillEntries(skillPromptResult.entries);
    return skillPromptResult.prompt !== event.systemPrompt
      ? { systemPrompt: skillPromptResult.prompt }
      : {};
  }
}
