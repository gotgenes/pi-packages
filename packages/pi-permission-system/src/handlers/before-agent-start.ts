import type {
  BeforeAgentStartEventResult,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { DebugLogger } from "#src/logging/session-logger";
import type { PermissionResolver } from "#src/permission-resolver";
import type { PermissionSession } from "#src/permission-session";
import { resolveSkillPromptEntries } from "#src/skill-prompt-sanitizer";
import { sanitizeAvailableToolsSection } from "#src/system-prompt-sanitizer";
import { getToolNameFromValue, type ToolRegistry } from "#src/tool-registry";
import type { ToolSurfaceObservation } from "#src/tool-surface-baseline";
import type { TurnPreparation } from "./session-turn-prep";

/** Minimal subset of BeforeAgentStartEvent used by this handler. */
interface BeforeAgentStartPayload {
  systemPrompt: string;
}

/**
 * Pure helper: returns true when the tool should be exposed to the agent.
 *
 * A tool is withheld only when *every* value under its surface resolves to
 * `deny`, so a blanket `bash: deny` hides the tool entirely while a partially
 * permissive `bash: {"*": "deny", "git *": "ask"}` keeps it reachable (#815).
 */
export function shouldExposeTool(
  toolName: string,
  agentName: string | null,
  isToolFullyDenied: (toolName: string, agentName?: string) => boolean,
): boolean {
  return !isToolFullyDenied(toolName, agentName ?? undefined);
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
 * - `resolver` — owns permission-query surface: `isToolFullyDenied`, skill check
 * - `toolRegistry` — Pi tool API subset (getAll + getActive + setActive)
 * - `logger` — records each change to the effective tool surface
 *
 * The active set is recomputed from the session's pre-filter tool surface
 * every turn, so relaxing a rule restores the tool it had withheld (#873).
 */
export class AgentPrepHandler {
  constructor(
    private readonly turnPrep: TurnPreparation,
    private readonly session: PermissionSession,
    private readonly resolver: PermissionResolver,
    private readonly toolRegistry: ToolRegistry,
    private readonly logger: DebugLogger,
  ) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async handle(
    event: BeforeAgentStartPayload,
    ctx: ExtensionContext,
  ): Promise<BeforeAgentStartEventResult> {
    this.turnPrep.prepare(ctx);

    const agentName = this.session.resolveAgentName(ctx, event.systemPrompt);
    const surface = this.session.resolveExposedTools(
      this.observeToolSurface(),
      (toolName) =>
        shouldExposeTool(toolName, agentName, (t, a) =>
          this.resolver.isToolFullyDenied(t, a),
        ),
    );
    const allowedTools = [...surface.exposed];

    this.toolRegistry.setActive(allowedTools);
    if (surface.changed) {
      this.logger.debug("tool_surface.changed", {
        exposed: surface.exposed,
        withheld: surface.withheld,
        restored: surface.restored,
      });
    }

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

  private observeToolSurface(): ToolSurfaceObservation {
    return {
      active: toolNamesOf(this.toolRegistry.getActive()),
      registered: new Set(toolNamesOf(this.toolRegistry.getAll())),
    };
  }
}

function toolNamesOf(tools: readonly unknown[]): string[] {
  const names: string[] = [];
  for (const tool of tools) {
    const toolName = getToolNameFromValue(tool);
    if (toolName) {
      names.push(toolName);
    }
  }
  return names;
}
