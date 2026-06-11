import type {
  BeforeAgentStartEventResult,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  createActiveToolsCacheKey,
  createBeforeAgentStartPromptStateKey,
} from "#src/before-agent-start-cache";
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
 * Constructor deps:
 * - `session` — encapsulates all mutable session state and lifecycle operations
 * - `resolver` — owns permission-query surface: `getToolPermission`, `getPolicyCacheStamp`, skill check
 * - `toolRegistry` — Pi tool API subset (getAll + setActive)
 */
export class AgentPrepHandler {
  constructor(
    private readonly session: PermissionSession,
    private readonly resolver: PermissionResolver,
    private readonly toolRegistry: ToolRegistry,
  ) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async handle(
    event: BeforeAgentStartPayload,
    ctx: ExtensionContext,
  ): Promise<BeforeAgentStartEventResult> {
    this.session.activate(ctx);
    this.session.refreshConfig(ctx);

    const agentName = this.session.resolveAgentName(ctx, event.systemPrompt);
    const allTools = this.toolRegistry.getActive();
    const allowedTools: string[] = [];

    for (const tool of allTools) {
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

    const activeToolsCacheKey = createActiveToolsCacheKey(allowedTools);
    this.session.activeToolsGate.runIfChanged(activeToolsCacheKey, () => {
      this.toolRegistry.setActive(allowedTools);
    });

    const promptStateCacheKey = createBeforeAgentStartPromptStateKey({
      agentName,
      cwd: ctx.cwd,
      permissionStamp: this.resolver.getPolicyCacheStamp(
        agentName ?? undefined,
      ),
      systemPrompt: event.systemPrompt,
      allowedToolNames: allowedTools,
    });

    const promptResult = this.session.promptStateGate.runIfChanged(
      promptStateCacheKey,
      () => {
        const toolPromptResult = sanitizeAvailableToolsSection(
          event.systemPrompt,
          allowedTools,
        );
        const skillPromptResult = resolveSkillPromptEntries(
          toolPromptResult.prompt,
          this.resolver,
          agentName,
          ctx.cwd,
        );
        this.session.setActiveSkillEntries(skillPromptResult.entries);
        return skillPromptResult.prompt !== event.systemPrompt
          ? { systemPrompt: skillPromptResult.prompt }
          : {};
      },
    );
    return promptResult ?? {};
  }
}
