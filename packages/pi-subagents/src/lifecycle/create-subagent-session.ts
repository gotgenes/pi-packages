/**
 * create-subagent-session.ts — Assembly factory for born-complete child sessions (issue #265).
 *
 * `createSubagentSession()` does the assembly portion that the old runner's
 * `runAgent()` did up front: detect the environment, assemble the session config,
 * create the SDK session (with the recursion guard as a tool denylist), publish
 * `spawning`/`session-created`, and bind extensions. It returns a fully usable
 * `SubagentSession` — `Subagent` then only coordinates (turn loop, steer, dispose).
 *
 * The factory takes a resolved `cwd` value, never the WorkspaceProvider: `cwd`
 * is a value the factory consumes directly (detectEnv, assembleSessionConfig,
 * createSession), so threading the provider through here would be a relay smell.
 */

import type { Model } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  type SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { AgentConfigLookup } from "#src/config/agent-types";
import type { ChildLifecyclePublisher } from "#src/lifecycle/child-lifecycle";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import { SubagentSession } from "#src/lifecycle/subagent-session";
import { AskParentTool, type QuestionRecorder } from "#src/session/ask-parent-tool";
import type { EnvInfo } from "#src/session/env";
import type { ModelRegistry } from "#src/session/model-resolver";
import { NotifyParentTool, type UpdateAnnouncer } from "#src/session/notify-parent-tool";
import { type AssemblerIO, assembleSessionConfig } from "#src/session/session-config";
import type { ParentSessionInfo, ShellExec, SubagentType, ThinkingLevel } from "#src/types";

/**
 * Recursion guard: names of tools registered by this extension that subagents
 * must NOT inherit. Passed to the SDK as a denylist, which it applies whenever
 * it rebuilds the child's tool registry — including the rebuild triggered by a
 * child extension registering a tool of its own. Filtering the active set once
 * after `bindExtensions` would be undone by that rebuild (#725).
 */
const EXCLUDED_TOOL_NAMES = ["subagent", "get_subagent_result", "steer_subagent"];

// ── IO boundary ───────────────────────────────────────────────────────────────

/** Minimal resource-loader contract used by the factory. */
export interface ResourceLoaderLike {
  reload(): Promise<void>;
}

/** Minimal session-manager contract used by the factory. */
export interface SessionManagerLike {
  newSession(opts: { parentSession?: string }): void;
  getSessionFile(): string | undefined;
  getSessionId(): string;
}

/** Options passed to EnvironmentIO/SessionFactoryIO methods. */
export interface ResourceLoaderOptions {
  cwd: string;
  agentDir: string;
  /** Settings the loader resolves packages from; defaults to the ambient ones when absent. */
  settingsManager?: SettingsManager;
  noPromptTemplates?: boolean;
  noThemes?: boolean;
  noContextFiles?: boolean;
  systemPromptOverride?: () => string;
  /** Override the append system prompt. Receives the current base value; return the replacement. */
  appendSystemPromptOverride?: (base: string[]) => string[];
}

/** Options passed to SessionFactoryIO.createSession. */
export interface CreateSessionOptions {
  cwd: string;
  agentDir: string;
  sessionManager: SessionManagerLike;
  settingsManager: SettingsManager;
  modelRegistry: ModelRegistry;
  model?: Model<any>;
  /** Allowlist: only these tool names are enabled in the session. */
  tools: string[];
  /**
   * Tool definitions supplied directly rather than by an extension. The SDK
   * filters these through `tools` too, so every name here must also be listed
   * there or the definition is silently dropped.
   */
  customTools?: ToolDefinition[];
  /** Denylist applied after `tools`, on every tool-registry rebuild. */
  excludeTools?: string[];
  resourceLoader: ResourceLoaderLike;
  thinkingLevel?: ThinkingLevel;
}

/**
 * Environment discovery - detect runtime context and resolve directories.
 *
 * Decouples the factory from direct process/SDK reads so each can be stubbed
 * independently in tests.
 */
export interface EnvironmentIO {
  detectEnv: (exec: ShellExec, cwd: string) => Promise<EnvInfo>;
  getAgentDir: () => string;
  deriveSessionDir: (parentSessionFile: string | undefined, effectiveCwd: string) => string;
}

/**
 * Session factory - create SDK objects for a child agent session.
 *
 * Decouples the factory from direct Pi SDK imports and sibling-module IO,
 * making it testable via plain stub objects without vi.mock().
 */
export interface SessionFactoryIO {
  createResourceLoader: (opts: ResourceLoaderOptions) => ResourceLoaderLike;
  createSessionManager: (cwd: string, sessionDir: string) => SessionManagerLike;
  createSettingsManager: (cwd: string, agentDir: string) => SettingsManager;
  /**
   * Settings view the child's resource loader resolves packages from.
   * The composition root decides whether any package extensions are excluded;
   * the identity function reproduces the child's default full inheritance.
   */
  createLoaderSettingsManager: (parent: SettingsManager) => SettingsManager;
  createSession: (opts: CreateSessionOptions) => Promise<{ session: AgentSession }>;
  assemblerIO: AssemblerIO;
}

/**
 * IO boundary injected into createSubagentSession().
 *
 * Intersection of EnvironmentIO and SessionFactoryIO — callers satisfy both
 * sub-interfaces via TypeScript's structural typing.
 */
export type SubagentSessionIO = EnvironmentIO & SessionFactoryIO;

/**
 * Dependencies injected at construction time — the IO boundary plus the two
 * static domain deps (exec, registry) every creation needs.
 */
export interface SubagentSessionDeps {
  io: SubagentSessionIO;
  exec: ShellExec;
  registry: AgentConfigLookup;
  /** Publishes the child-execution lifecycle so consumers can observe it. */
  lifecycle: ChildLifecyclePublisher;
}

/** Per-spawn parameters — the fields that vary per child session. */
export interface CreateSubagentSessionParams {
  snapshot: ParentSnapshot;
  type: SubagentType;
  /** Resolved workspace cwd; undefined → parent cwd. */
  cwd?: string;
  /** Parent session identity (file path + session ID). */
  parentSession?: ParentSessionInfo;
  model?: Model<any>;
  thinkingLevel?: ThinkingLevel;
  /**
   * Records a question the child declares with `ask_parent`. Supplied for every
   * child; its absence installs no ask-back tool.
   */
  askParent?: QuestionRecorder;
  /**
   * Announces a mid-run update the child sends with `notify_parent`. Supplied
   * only for a background child whose operator left the channel on; its absence
   * installs no update tool.
   */
  notifyParent?: UpdateAnnouncer;
}

/**
 * The core's own child-facing tools, built for whichever callbacks this run
 * supplied. An agent's `tools:` list is its complete capability allowlist, so
 * these are appended to it rather than drawn from it: they are protocol the
 * core installs in every child, and neither reaches the filesystem, the shell,
 * or the network.
 */
function buildChildTools(params: CreateSubagentSessionParams): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  if (params.askParent) tools.push(new AskParentTool(params.askParent).toToolDefinition());
  if (params.notifyParent)
    tools.push(new NotifyParentTool(params.notifyParent).toToolDefinition());
  return tools;
}

/**
 * Build a born-complete SubagentSession: assemble config, create the SDK
 * session, publish lifecycle events, bind extensions, apply the recursion guard.
 */
export async function createSubagentSession(
  params: CreateSubagentSessionParams,
  deps: SubagentSessionDeps,
): Promise<SubagentSession> {
  const { snapshot, type } = params;
  const parentSessionId = params.parentSession?.parentSessionId;
  deps.lifecycle.spawning({ agentName: type, parentSessionId });

  // Resolve working directory upfront - needed for detectEnv before assembly.
  const effectiveCwd = params.cwd ?? snapshot.cwd;
  const env = await deps.io.detectEnv(deps.exec, effectiveCwd);

  // Assemble session configuration (synchronous, no SDK objects).
  const cfg = assembleSessionConfig(
    type,
    {
      cwd: snapshot.cwd,
      parentSystemPrompt: snapshot.systemPrompt,
      parentModel: snapshot.model,
      modelRegistry: snapshot.modelRegistry,
    },
    {
      cwd: params.cwd,
      model: params.model,
      thinkingLevel: params.thinkingLevel,
    },
    env,
    deps.registry,
    deps.io.assemblerIO,
  );

  const agentDir = deps.io.getAgentDir();
  const sessionSettings = deps.io.createSettingsManager(cfg.effectiveCwd, agentDir);
  const loaderSettings = deps.io.createLoaderSettingsManager(sessionSettings);

  // Children inherit the parent's skills and every extension the composition
  // root did not exclude (#696).
  //
  // Suppress AGENTS.md/CLAUDE.md and APPEND_SYSTEM.md - upstream's
  // buildSystemPrompt() re-appends both AFTER systemPromptOverride, which
  // would defeat prompt_mode: replace. Parent context, if wanted, reaches the
  // subagent via prompt_mode: append (parentSystemPrompt is embedded in
  // systemPromptOverride) or inherit_context (conversation).
  const loader = deps.io.createResourceLoader({
    cwd: cfg.effectiveCwd,
    agentDir,
    settingsManager: loaderSettings,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => cfg.systemPrompt,
    appendSystemPromptOverride: () => [],
  });
  await loader.reload();

  // Create a persisted SessionManager so transcripts are written in Pi's
  // official JSONL format. Falls back to a temp directory when the parent
  // session is not persisted (e.g. headless/API mode).
  const sessionDir = deps.io.deriveSessionDir(params.parentSession?.parentSessionFile, cfg.effectiveCwd);
  const sessionManager = deps.io.createSessionManager(cfg.effectiveCwd, sessionDir);
  sessionManager.newSession({ parentSession: params.parentSession?.parentSessionId });
  const sessionId = sessionManager.getSessionId();

  const childTools = buildChildTools(params);
  const { session } = await deps.io.createSession({
    cwd: cfg.effectiveCwd,
    agentDir,
    sessionManager,
    settingsManager: sessionSettings,
    modelRegistry: snapshot.modelRegistry,
    model: cfg.model,
    tools: [...cfg.toolNames, ...childTools.map((tool) => tool.name)],
    customTools: childTools,
    excludeTools: EXCLUDED_TOOL_NAMES,
    resourceLoader: loader,
    thinkingLevel: cfg.thinkingLevel,
  });

  const subagentSession = new SubagentSession(session, {
    outputFile: sessionManager.getSessionFile(),
    sessionId,
    sessionDir,
    agentName: type,
    agentMaxTurns: cfg.agentMaxTurns,
    parentContext: snapshot.parentContext,
    lifecycle: deps.lifecycle,
  });

  // Publish session-created before bindExtensions() so observers (e.g. the
  // permission system) can register the child synchronously and have their
  // entry in place for the first permission check during child extension
  // initialization. The event bus dispatches synchronously, so a synchronous
  // subscriber completes before this returns.
  deps.lifecycle.sessionCreated({ sessionId, parentSessionId });

  try {
    // Bind extensions so that session_start fires and extensions can initialize.
    await session.bindExtensions({});
  } catch (err) {
    // Binding failed after session-created — dispose (child session_shutdown +
    // session.dispose() + emit disposed) before rethrowing so neither the
    // registration nor a partially-initialized extension's resources leak.
    await subagentSession.dispose();
    throw err;
  }

  // Every child session_start handler has now run, so this is the first — and
  // only — moment a parent can observe what the child's extensions installed.
  // Deliberately outside the try above: a child whose binding threw never ran.
  deps.lifecycle.bound({ sessionId, parentSessionId });

  return subagentSession;
}
