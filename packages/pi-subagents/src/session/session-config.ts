/**
 * session-config.ts — Pure configuration assembler for agent sessions.
 *
 * `assembleSessionConfig()` is the pure assembly core called by
 * `createSubagentSession()`. It accepts resolved inputs (agent type, narrow
 * context, run options, env info) and returns everything the factory needs to
 * create the SDK session — without importing or constructing any Pi SDK types.
 *
 * The only async IO in the assembly phase (`detectEnv`) is handled by the caller
 * before invoking this function, keeping the assembler synchronous.
 */

import type { Model } from "@earendil-works/pi-ai";
import type { AgentConfigLookup } from "#src/config/agent-types";
import type { EnvInfo } from "#src/session/env";
import type { ModelRegistry } from "#src/session/model-resolver";
import type { InheritedPrompt } from "#src/session/prompts";
import type { AgentPromptConfig, SubagentType, ThinkingLevel } from "#src/types";

// ── Public interfaces ────────────────────────────────────────────────────────

/**
 * IO collaborators injected into `assembleSessionConfig`.
 *
 * Bundling the IO-touching (or promptly testable) function into a single
 * interface keeps the assembler free of direct module imports and makes it
 * trivially testable without `vi.mock()` — callers inject real implementations
 * at the edge (`create-subagent-session.ts`) or stubs in tests.
 */
export interface AssemblerIO {
  buildAgentPrompt: (
    config: AgentPromptConfig,
    cwd: string,
    env: EnvInfo,
    inherited?: InheritedPrompt,
  ) => string;
}

/**
 * Narrow context the assembler reads from the parent session.
 * Tests construct plain objects satisfying this interface — no SDK mocking needed.
 *
 * The assembler never inspects model internals, only passes them through;
 * `resolveDefaultModel` reads `provider`/`id` from `getAvailable()` for the
 * availability check.
 */
export interface AssemblerContext {
  /** Parent working directory (overridable via options.cwd). */
  cwd: string;
  /** Parent's effective system prompt (for append-mode agents). */
  parentSystemPrompt: string;
  /** Parent's portable prompt parts, for `inherit_prompt: portable` agents. */
  parentPortablePrompt?: string;
  /** Parent's current model instance (fallback when agent config has no model). */
  parentModel?: Model<any>;
  /** Model registry for resolving config.model strings. */
  modelRegistry: ModelRegistry;
  /** Default prompt inheritance when the agent's frontmatter is silent. */
  promptInheritanceDefault?: "full" | "portable";
  /** Per-provider inheritance overrides, keyed by provider id of the child's model. */
  promptInheritanceProviders?: Record<string, "full" | "portable">;
}

/**
 * Narrow slice of per-spawn execution fields consumed by the assembler.
 * All fields are optional — callers pass only what they have.
 */
export interface AssemblerOptions {
  /** Override working directory (e.g. for worktree isolation). */
  cwd?: string;
  /** Explicit model override — wins over agentConfig.model and parent model. */
  model?: Model<any>;
  /** Explicit thinking level — wins over agentConfig.thinking. */
  thinkingLevel?: ThinkingLevel;
}

/**
 * Assembled configuration returned to `createSubagentSession()`.
 * Contains everything needed to create the SDK session and filter tools —
 * with no SDK object references.
 */
export interface SessionConfig {
  /** Resolved working directory (`options.cwd ?? ctx.cwd`). */
  effectiveCwd: string;
  /** Fully-assembled system prompt string (ready for `systemPromptOverride`). */
  systemPrompt: string;
  /** Built-in tool name allowlist for this agent type. */
  toolNames: string[];
  /**
   * Resolved model instance (undefined → use parent model as passed to SDK).
   * The assembler passes it through without inspection.
   */
  model: Model<any> | undefined;
  /** Resolved thinking level (undefined → inherit from session). */
  thinkingLevel: ThinkingLevel | undefined;
  /** Per-agent configured max turns (from agentConfig.maxTurns). */
  agentMaxTurns: number | undefined;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Resolve the default model from the agent config's model string.
 *
 * Priority: parentModel is the fallback; if `configModel` is a "provider/modelId"
 * string that resolves against the registry AND is in the available set, return
 * that model instead.
 */
function resolveDefaultModel(
  parentModel: Model<any> | undefined,
  registry: AssemblerContext["modelRegistry"],
  configModel?: string,
): Model<any> | undefined {
  if (configModel) {
    const slashIdx = configModel.indexOf("/");
    if (slashIdx !== -1) {
      const provider = configModel.slice(0, slashIdx);
      const modelId = configModel.slice(slashIdx + 1);

      const available = registry.getAvailable?.();
      const availableKeys = available
        ? new Set(available.map((m) => `${m.provider}/${m.id}`))
        : undefined;
      const isAvailable = (p: string, id: string) =>
        !availableKeys || availableKeys.has(`${p}/${id}`);

      const found = registry.find(provider, modelId);
      if (found && isAvailable(provider, modelId)) return found;
    }
  }
  return parentModel;
}

// ── Public function ──────────────────────────────────────────────────────────

/**
 * Assemble all configuration needed to create an agent session.
 *
 * Synchronous and side-effect-free — all IO is delegated through the `io`
 * parameter. The caller is responsible for resolving `EnvInfo` beforehand
 * via `detectEnv()`.
 *
 * @param type       The subagent type name (case-insensitive registry lookup).
 * @param ctx        Narrow context from the parent session.
 * @param options    Per-call overrides (cwd, model, thinkingLevel).
 * @param env        Pre-resolved environment info from `detectEnv()`.
 * @param registry   Agent config lookup — provides resolveAgentConfig and getToolNamesForType.
 * @param io         IO collaborators (skill loader, memory builder, prompt builder).
 */
export function assembleSessionConfig(
  type: SubagentType,
  ctx: AssemblerContext,
  options: AssemblerOptions,
  env: EnvInfo,
  registry: AgentConfigLookup,
  io: AssemblerIO,
): SessionConfig {
  const agentConfig = registry.resolveAgentConfig(type);

  const effectiveCwd = options.cwd ?? ctx.cwd;

  const toolNames = registry.getToolNamesForType(type);

  // Model resolution first — the child's provider scopes the prompt-inheritance
  // rules, so the prompt cannot be built until the model is known.
  // Priority: explicit option > config model string > parent model
  const model =
    options.model ??
    resolveDefaultModel(ctx.parentModel, ctx.modelRegistry, agentConfig.model);

  // Build system prompt from the resolved agent config. `promptInheritance`
  // settles frontmatter > provider rule > setting default here so every caller
  // of buildAgentPrompt sees one settled value; with nothing to settle the
  // config object passes through untouched.
  const promptInheritance =
    agentConfig.promptInheritance ??
    (model?.provider != null ? ctx.promptInheritanceProviders?.[model.provider] : undefined) ??
    ctx.promptInheritanceDefault;
  const configForPrompt = promptInheritance
    ? { ...agentConfig, promptInheritance }
    : agentConfig;
  const systemPrompt = io.buildAgentPrompt(configForPrompt, effectiveCwd, env, {
    systemPrompt: ctx.parentSystemPrompt,
    cwd: ctx.cwd,
    portablePrompt: ctx.parentPortablePrompt,
  });

  // Thinking level: explicit option > config model > undefined (inherit)
  const thinkingLevel = options.thinkingLevel ?? agentConfig.thinking;

  // Per-agent max turns (combined with per-call maxTurns and defaultMaxTurns by SubagentSession.runTurnLoop)
  const agentMaxTurns = agentConfig.maxTurns;

  return {
    effectiveCwd,
    systemPrompt,
    toolNames,
    model,
    thinkingLevel,
    agentMaxTurns,
  };
}
