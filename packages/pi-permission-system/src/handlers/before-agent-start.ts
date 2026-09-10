import type {
  BeforeAgentStartEventResult,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { resolveSkillPromptEntries } from "#src/exposure/skill-prompt-sanitizer";
import {
  type RegisteredTools,
  readRegisteredTools,
  type ToolRegistry,
} from "#src/exposure/tool-registry";
import type { ToolSurfaceObservation } from "#src/exposure/tool-surface-baseline";
import {
  normalizePrompt,
  renderToolSurface,
} from "#src/exposure/tool-surface-prompt";
import type { DebugLogger } from "#src/logging/session-logger";
import type { PermissionResolver } from "#src/policy/permission-resolver";
import type { PermissionSession } from "#src/session/permission-session";
import type { TurnPreparation } from "./session-turn-prep";

/** Minimal subset of BeforeAgentStartEvent used by this handler. */
interface BeforeAgentStartPayload {
  systemPrompt: string | readonly string[];
  /**
   * The parts Pi assembled the prompt from. `toolSnippets` is what lets this
   * handler render the session's own tool list instead of editing the one Pi
   * wrote — including in a child, whose inherited identity carries none.
   */
  systemPromptOptions?: {
    toolSnippets?: Record<string, string>;
  };
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
 * skill filtering is reapplied and the wire prompt stays stable across turns,
 * rather than letting Pi reset to its skill-unfiltered base prompt on a cache
 * hit.
 *
 * The tool surface is relocated rather than edited in place, so a subagent
 * child's inherited identity stays byte-identical to its parent's (#890).
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
    const systemPrompt = normalizePrompt(event.systemPrompt);
    this.turnPrep.prepare(ctx);

    const agentName = this.session.resolveAgentName(ctx, systemPrompt);
    const registered = readRegisteredTools(this.toolRegistry.getAll());
    const surface = this.session.resolveExposedTools(
      this.observeToolSurface(registered),
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

    const toolSurfacePrompt = renderToolSurface(systemPrompt, {
      allowedTools,
      toolSnippets: event.systemPromptOptions?.toolSnippets ?? {},
      guidelinesByTool: registered.guidelinesByTool,
    });
    const skillPromptResult = resolveSkillPromptEntries(
      toolSurfacePrompt,
      this.resolver,
      agentName,
      this.session.getPathNormalizer(),
    );
    this.session.setActiveSkillEntries(skillPromptResult.entries);
    return skillPromptResult.prompt !== systemPrompt
      ? { systemPrompt: skillPromptResult.prompt }
      : {};
  }

  private observeToolSurface(
    registered: RegisteredTools,
  ): ToolSurfaceObservation {
    return {
      active: readRegisteredTools(this.toolRegistry.getActive()).names,
      registered: new Set(registered.names),
    };
  }
}
