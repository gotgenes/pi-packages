import type {
  BeforeAgentStartEventResult,
  ExtensionContext,
  NormalizedBuildSystemPromptOptions,
} from "@earendil-works/pi-coding-agent";
import type { SubagentDetector } from "#src/authority/subagent-detection";
import {
  visibleSkillPromptEntries,
  withoutDeniedSkills,
} from "#src/exposure/skill-prompt-sanitizer";
import {
  type RegisteredTools,
  readRegisteredTools,
  type ToolRegistry,
} from "#src/exposure/tool-registry";
import type { ToolSurfaceObservation } from "#src/exposure/tool-surface-baseline";
import { renderToolSurfaceSections } from "#src/exposure/tool-surface-prompt";
import type { DebugLogger } from "#src/logging/session-logger";
import type { PermissionResolver } from "#src/policy/permission-resolver";
import type { PermissionSession } from "#src/session/permission-session";
import type { TurnPreparation } from "./session-turn-prep";

/** Minimal subset of BeforeAgentStartEvent used by this handler. */
interface BeforeAgentStartPayload {
  /** Pi renders a string; a host may supply ordered prompt fragments instead. */
  readonly systemPrompt: string | readonly string[];
  /**
   * The mutable parts Pi renders the prompt from; later handlers, and Pi
   * itself, see what this handler writes here. `customPrompt` says whether Pi
   * wrote a preamble at all: under one, it writes no tool surface.
   * `toolSnippets` and `promptGuidelines` are what a child's own tool surface
   * renders from, and `sections` is where it is stated. `skills` is the
   * catalogue Pi renders, which policy narrows.
   */
  systemPromptOptions?: Pick<
    NormalizedBuildSystemPromptOptions,
    "customPrompt" | "toolSnippets" | "promptGuidelines" | "sections" | "skills"
  >;
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
 * When provided, prompt changes are stated through `event.systemPromptOptions`,
 * never as a returned `systemPrompt`: a returned prompt is frozen for the run,
 * so the sections an extension later in the chain adds (Pi's own
 * `<mcp_servers>` among them) would never reach the provider (#999).
 * Without those options, only tool filtering and skill path resolution run;
 * there is no mutable section or skill catalogue to narrow.
 *
 * Narrowing the active set is enough for a prompt Pi wrote: Pi renders its
 * `<tools>` and `<rules>` from the reconciled active set. A subagent child's
 * prompt is always a custom one, under which Pi writes neither, so a child
 * states its own as `sections`, which Pi places after its `<cwd>` section. A
 * root under a custom prompt states none, matching Pi.
 *
 * Constructor deps:
 * - `turnPrep` — brings the node up to date for the turn before anything reads
 *   session state
 * - `session` — encapsulates all mutable session state and lifecycle operations
 * - `resolver` — owns permission-query surface: `isToolFullyDenied`, skill check
 * - `toolRegistry` — Pi tool API subset (getAll + getActive + setActive)
 * - `logger` — records each change to the effective tool surface
 * - `detector` — tells a subagent child from a root, which decides whether a
 *   custom prompt gets this node's tool surface
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
    private readonly detector: SubagentDetector,
  ) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async handle(
    event: BeforeAgentStartPayload,
    ctx: ExtensionContext,
  ): Promise<BeforeAgentStartEventResult> {
    this.turnPrep.prepare(ctx);

    // Normalize once at the boundary, before either prompt consumer reads it.
    const systemPrompt =
      typeof event.systemPrompt === "string"
        ? event.systemPrompt
        : event.systemPrompt.join("\n");
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

    const options = event.systemPromptOptions;
    if (options && this.isSubagentUnderCustomPrompt(event, ctx)) {
      const sections = renderToolSurfaceSections({
        allowedTools,
        toolSnippets: options.toolSnippets,
        guidelinesByTool: registered.guidelinesByTool,
        promptGuidelines: options.promptGuidelines,
      });
      // An empty section is one Pi leaves out, so this also clears a stale peer list.
      options.sections.tools = sections.tools ?? "";
      options.sections.rules = sections.rules;
    }

    // Path-match entries come from every catalogue the rendered prompt lists,
    // read before the skill list is narrowed.
    this.session.setActiveSkillEntries(
      visibleSkillPromptEntries(
        systemPrompt,
        this.resolver,
        agentName,
        this.session.getPathNormalizer(),
      ),
    );
    if (!options) return {};

    // Denials are judged on the list Pi renders `<skills>` from, not on the
    // rendered prompt: that prompt predates this turn's tool changes, and on
    // the turn `read`/`bash` return from a full denial it lists no catalogue.
    options.skills = withoutDeniedSkills(
      options.skills,
      this.resolver,
      agentName,
    );
    return {};
  }

  /**
   * Whether this node states its own tool surface through `sections`.
   *
   * Only a subagent child does: its prompt is always a custom one, under which
   * Pi writes no tool list or rules, and its inherited identity carries none
   * either. A root needs none — Pi renders its own from the narrowed active
   * set, or, under an operator's custom prompt, deliberately writes none.
   */
  private isSubagentUnderCustomPrompt(
    event: BeforeAgentStartPayload,
    ctx: ExtensionContext,
  ): boolean {
    return hasCustomPrompt(event) && this.detector.isSubagent(ctx);
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

/**
 * Whether Pi built the prompt from a custom one, by Pi's own `if (customPrompt)`
 * test, so an empty string reads here the way it reads there: as none.
 */
function hasCustomPrompt(event: BeforeAgentStartPayload): boolean {
  return Boolean(event.systemPromptOptions?.customPrompt);
}
