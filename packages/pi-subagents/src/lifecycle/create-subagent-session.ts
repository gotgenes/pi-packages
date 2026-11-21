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

import { dirname } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  type InlineExtension,
  type SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { AgentConfigLookup } from "#src/config/agent-types";
import { debugNote } from "#src/debug";
import type { ChildLifecyclePublisher } from "#src/lifecycle/child-lifecycle";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import { SubagentSession } from "#src/lifecycle/subagent-session";
import { resolveTurnLimits, type TurnLimitRequest } from "#src/lifecycle/turn-limits";
import { AskParentTool, type QuestionRecorder } from "#src/session/ask-parent-tool";
import { builtinExtensionsFor } from "#src/session/builtin-extensions";
import type { EnvInfo } from "#src/session/env";
import { expandMcpToolPatterns } from "#src/session/mcp-tool-patterns";
import type { ModelRegistry } from "#src/session/model-resolver";
import { NotifyParentTool, type UpdateAnnouncer } from "#src/session/notify-parent-tool";
import { type BranchEntryLike, branchModelSelection } from "#src/session/recorded-model";
import { type AssemblerIO, assembleSessionConfig } from "#src/session/session-config";
import type { ChildTranscriptHeader } from "#src/session/transcript-header";
import type {
  ParentSessionInfo,
  PromptInheritance,
  ShellExec,
  SubagentType,
  ThinkingLevel,
} from "#src/types";

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

/**
 * A session manager reopened on an existing child transcript. It also answers
 * whose session it holds, whether it holds a conversation, and which model its
 * branch selects, so the factory can check it continues the child it was asked
 * to before anything runs on it.
 */
export interface ReopenedSessionManagerLike extends SessionManagerLike {
  getHeader(): { id: string; cwd: string; parentSession?: string } | null;
  getBranch(): readonly BranchEntryLike[];
  buildSessionContext(): { messages: readonly unknown[] };
}

/**
 * A settled child's transcript to continue, and the identity it was recorded
 * under when the resume was accepted. The factory refuses to continue a file
 * that no longer carries that identity or holds no conversation: Pi opens a
 * missing path as a new, empty session, and a file replaced since would run
 * the resume on someone else's conversation.
 */
export interface ContinuedTranscript {
  file: string;
  header: ChildTranscriptHeader;
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
  /** Extensions supplied as code; `builtin` entries are Pi's built-ins, resolved as `builtin:<name>`. */
  extensionFactories?: InlineExtension[];
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
  /** Reopen an existing child transcript, whose header already records its cwd and parent. */
  openSessionManager: (transcript: string) => ReopenedSessionManagerLike;
  /**
   * Read, without writing, the identity a transcript's header records; undefined
   * when the file is missing, empty, or does not start with a usable header.
   * Consulted before `openSessionManager`, because Pi writes to some files as it
   * opens them.
   */
  readTranscriptHeader: (transcript: string) => ChildTranscriptHeader | undefined;
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
  /**
   * Which prompt-inheritance strategy a child on the given provider adopts.
   *
   * Resolved at the composition root from the operator's settings, so this
   * factory stays policy-free — the same shape the extension-exclusion policy
   * reaches it in.
   */
  resolvePromptInheritance: (provider: string | undefined) => PromptInheritance;
  /**
   * Names of the tools the parent session has registered, read when a child is
   * created. An agent's `mcp__<server>__*` tool patterns expand against them.
   */
  listParentToolNames: () => readonly string[];
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
  /** The caller's turn-limit inputs, resolved with the agent's own limit into the session's. */
  turnLimits?: TurnLimitRequest;
  /**
   * An earlier child transcript to continue instead of starting a new one: the
   * child an earlier manager ran, before a `/reload` or a restart. The session
   * is reopened on it, runs in the directory it recorded, keeps the model and
   * thinking level it selected, and its first run here is a resume.
   */
  transcript?: ContinuedTranscript;
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

  // A continued transcript is opened, and checked, before anything else: the
  // model its branch selects decides the child's model, and with it the prompt
  // strategy, and nothing may run on a file that no longer holds this child.
  const reopened = params.transcript && reopenTranscript(deps.io, params.transcript);

  // Resolve working directory upfront - needed for detectEnv before assembly.
  // A continued child runs where its transcript says it ran, as it would had
  // its session stayed live.
  const cwd = params.cwd ?? params.transcript?.header.cwd;
  const effectiveCwd = cwd ?? snapshot.cwd;
  const env = await deps.io.detectEnv(deps.exec, effectiveCwd);

  // Assemble session configuration (synchronous, no SDK objects).
  const cfg = assembleSessionConfig(
    type,
    {
      cwd: snapshot.cwd,
      parentSystemPrompt: snapshot.systemPrompt,
      parentPortablePrompt: snapshot.portablePrompt,
      parentModel: snapshot.model,
      modelRegistry: snapshot.modelRegistry,
      resolvePromptInheritance: deps.resolvePromptInheritance,
    },
    {
      cwd,
      model: params.model ?? (reopened && recordedModel(reopened, snapshot.modelRegistry)),
      thinkingLevel: params.thinkingLevel,
    },
    env,
    deps.registry,
    deps.io.assemblerIO,
  );

  const { toolNames, unmatchedPatterns } = expandMcpToolPatterns(
    cfg.toolNames,
    deps.listParentToolNames(),
  );
  for (const pattern of unmatchedPatterns) {
    debugNote(`agent ${type}: tools pattern ${pattern} matched no tool the parent has`);
  }

  const agentDir = deps.io.getAgentDir();
  const sessionSettings = deps.io.createSettingsManager(cfg.effectiveCwd, agentDir);
  const loaderSettings = deps.io.createLoaderSettingsManager(sessionSettings);

  // Children inherit the parent's skills and every extension the composition
  // root did not exclude (#696), plus the Pi built-ins their tools call for —
  // Pi supplies those to its own CLI session only.
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
    extensionFactories: builtinExtensionsFor(toolNames),
  });
  await loader.reload();

  // Create a persisted SessionManager so transcripts are written in Pi's
  // official JSONL format. Falls back to a temp directory when the parent
  // session is not persisted (e.g. headless/API mode).
  // A continued transcript stays where it is, beside its siblings.
  const sessionDir = params.transcript === undefined
    ? deps.io.deriveSessionDir(params.parentSession?.parentSessionFile, cfg.effectiveCwd)
    : dirname(params.transcript.file);
  let sessionManager: SessionManagerLike;
  if (reopened) {
    sessionManager = reopened;
  } else {
    sessionManager = deps.io.createSessionManager(cfg.effectiveCwd, sessionDir);
    sessionManager.newSession({ parentSession: params.parentSession?.parentSessionId });
  }
  const sessionId = sessionManager.getSessionId();

  const childTools = buildChildTools(params);
  const { session } = await deps.io.createSession({
    cwd: cfg.effectiveCwd,
    agentDir,
    sessionManager,
    settingsManager: sessionSettings,
    modelRegistry: snapshot.modelRegistry,
    model: cfg.model,
    tools: [...toolNames, ...childTools.map((tool) => tool.name)],
    customTools: childTools,
    excludeTools: EXCLUDED_TOOL_NAMES,
    resourceLoader: loader,
    // Left unset for a continued transcript unless the caller chose one, so Pi
    // restores the level the child last ran at.
    thinkingLevel: reopened ? params.thinkingLevel : cfg.thinkingLevel,
  });

  const subagentSession = new SubagentSession(session, {
    outputFile: sessionManager.getSessionFile(),
    sessionId,
    sessionDir,
    agentName: type,
    turnLimits: resolveTurnLimits(params.turnLimits, cfg.agentMaxTurns),
    parentContext: snapshot.parentContext,
    continued: reopened !== undefined,
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

/**
 * Reopen a settled child's transcript, refusing one that no longer holds the
 * child the resume was accepted for. Throws before any SDK session exists, so
 * a refused transcript gets no turn and no entry.
 *
 * The file is checked twice. First read-only, right before it is opened: Pi
 * initialises an empty file it opens with a new header, and rewrites a session
 * in an older format as it loads it, so a file that is not this child's must
 * never reach the open. Then the session manager actually opened is checked,
 * since that, not the file read a moment earlier, is what the child continues.
 * Nothing awaits between the two, so nothing in this process can change the
 * file in between; another process writing to it at that instant is not
 * supported.
 */
function reopenTranscript(io: SessionFactoryIO, transcript: ContinuedTranscript): ReopenedSessionManagerLike {
  if (!holdsChild(io.readTranscriptHeader(transcript.file), transcript.header)) {
    throw notThisChild(transcript);
  }
  const reopened = io.openSessionManager(transcript.file);
  if (!holdsChild(reopened.getHeader() ?? undefined, transcript.header)) throw notThisChild(transcript);
  if (reopened.buildSessionContext().messages.length === 0) {
    throw new Error(`Transcript ${transcript.file} holds no conversation to continue; it was not restored.`);
  }
  return reopened;
}

/** Whether a transcript header names the child session recorded when its resume was accepted. */
function holdsChild(
  header: { id: string; cwd: string; parentSession?: string } | undefined,
  expected: ChildTranscriptHeader,
): boolean {
  return header?.id === expected.id && header.parentSession === expected.parentSession && header.cwd === expected.cwd;
}

function notThisChild(transcript: ContinuedTranscript): Error {
  return new Error(`Transcript ${transcript.file} no longer holds this child's session; it was not restored.`);
}

/**
 * The model a reopened transcript's branch selects, when the parent's registry
 * still knows it; undefined lets the agent's own model resolution decide.
 */
function recordedModel(
  sessionManager: ReopenedSessionManagerLike,
  registry: ModelRegistry,
): Model<any> | undefined {
  const selected = branchModelSelection(sessionManager.getBranch(), registry);
  return selected ? registry.find(selected.provider, selected.modelId) : undefined;
}
