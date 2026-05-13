import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  getActiveAgentName,
  getActiveAgentNameFromSystemPrompt,
} from "./active-agent";
import type { PermissionSystemExtensionConfig } from "./extension-config";
import type { ExtensionPaths } from "./extension-paths";
import type { ForwardingController } from "./forwarding-manager";
import type { PermissionPromptDecision } from "./permission-dialog";
import type { PermissionManager } from "./permission-manager";
import type { PromptPermissionDetails } from "./permission-prompter";
import type { Rule } from "./rule";
import { createPermissionManagerForCwd } from "./runtime";
import type { SessionLogger } from "./session-logger";
import { SessionRules } from "./session-rules";
import type { SkillPromptEntry } from "./skill-prompt-sanitizer";
import type { PermissionCheckResult, PermissionState } from "./types";

/**
 * Runtime operations that `PermissionSession` delegates to but does not own.
 *
 * Injected at construction time from the composition root (`index.ts`),
 * where the `ExtensionRuntime` is available.
 */
export interface PermissionSessionRuntimeDeps {
  /** Reload merged config from disk; optionally update the stored runtime context. */
  refreshExtensionConfig(ctx?: ExtensionContext): void;
  /** Write the resolved config path set to the review and debug logs. */
  logResolvedConfigPaths(): void;
  /** Read current extension config (called at query time). */
  getConfig(): PermissionSystemExtensionConfig;
  /** Whether the current context can show an interactive permission prompt. */
  canRequestPermissionConfirmation(ctx: ExtensionContext): boolean;
  /** Prompt the user for a permission decision, log the outcome, and return it. */
  promptPermission(
    ctx: ExtensionContext,
    details: PromptPermissionDetails,
  ): Promise<PermissionPromptDecision>;
}

/**
 * Encapsulates all mutable session state and exposes operations instead of
 * fields.
 *
 * Replaces the `SessionState` interface + scattered handler field mutations
 * with a single class that owns the `PermissionManager`, `SessionRules`,
 * cache keys, skill entries, and runtime context.
 *
 * Constructor deps:
 * - `ExtensionPaths` — immutable path constants
 * - `SessionLogger` — debug + review + warn
 * - `ForwardingController` — polling lifecycle
 * - `PermissionSessionRuntimeDeps` — config refresh + log delegates
 */
export class PermissionSession {
  private context: ExtensionContext | null = null;
  private permissionManager: PermissionManager;
  private readonly sessionRules = new SessionRules();
  private skillEntries: SkillPromptEntry[] = [];
  private knownAgentName: string | null = null;
  private toolsCacheKey: string | null = null;
  private promptCacheKey: string | null = null;

  constructor(
    private readonly paths: ExtensionPaths,
    readonly logger: SessionLogger,
    private readonly forwarding: ForwardingController,
    private readonly runtimeDeps: PermissionSessionRuntimeDeps,
  ) {
    this.permissionManager = createPermissionManagerForCwd(
      paths.agentDir,
      undefined,
    );
  }

  // ── Context lifecycle ──────────────────────────────────────────────────

  /** Store the current extension context and start forwarding. */
  activate(ctx: ExtensionContext): void {
    this.context = ctx;
    this.forwarding.start(ctx);
  }

  /** Clear the context and stop forwarding. */
  deactivate(): void {
    this.context = null;
    this.forwarding.stop();
  }

  /** Return the current runtime context, or null if not activated. */
  getRuntimeContext(): ExtensionContext | null {
    return this.context;
  }

  // ── Permission checking (delegates to PermissionManager) ───────────────

  checkPermission(
    surface: string,
    input: unknown,
    agentName?: string,
    sessionRules?: Rule[],
  ): PermissionCheckResult {
    return this.permissionManager.checkPermission(
      surface,
      input,
      agentName,
      sessionRules,
    );
  }

  getToolPermission(toolName: string, agentName?: string): PermissionState {
    return this.permissionManager.getToolPermission(toolName, agentName);
  }

  getConfigIssues(agentName?: string): string[] {
    return this.permissionManager.getConfigIssues(agentName);
  }

  getPolicyCacheStamp(agentName?: string): string {
    return this.permissionManager.getPolicyCacheStamp(agentName);
  }

  // ── Session rules (delegates to SessionRules) ──────────────────────────

  getSessionRuleset(): Rule[] {
    return this.sessionRules.getRuleset();
  }

  approveSessionRule(surface: string, pattern: string): void {
    this.sessionRules.approve(surface, pattern);
  }

  // ── Session lifecycle ────────────────────────────────────────────────────

  /**
   * Reset all mutable state for a new session.
   *
   * Creates a fresh PermissionManager scoped to `ctx.cwd`, clears caches,
   * skill entries, and activates the new context.
   */
  resetForNewSession(ctx: ExtensionContext): void {
    this.permissionManager = createPermissionManagerForCwd(
      this.paths.agentDir,
      ctx.cwd,
    );
    this.skillEntries = [];
    this.toolsCacheKey = null;
    this.promptCacheKey = null;
    this.activate(ctx);
  }

  /**
   * Shut down the session: clear rules, caches, skill entries, and
   * deactivate context + forwarding.
   */
  shutdown(): void {
    this.sessionRules.clear();
    this.skillEntries = [];
    this.toolsCacheKey = null;
    this.promptCacheKey = null;
    this.deactivate();
  }

  /**
   * Reload permission manager and clear caches for the current context.
   * Used on config reload (e.g. `resources_discover` with reason "reload").
   */
  reload(): void {
    this.permissionManager = createPermissionManagerForCwd(
      this.paths.agentDir,
      this.context?.cwd,
    );
    this.skillEntries = [];
    this.toolsCacheKey = null;
    this.promptCacheKey = null;
  }

  // ── Agent-start caching ────────────────────────────────────────────────

  shouldUpdateActiveTools(cacheKey: string): boolean {
    return this.toolsCacheKey !== cacheKey;
  }

  commitActiveToolsCacheKey(cacheKey: string): void {
    this.toolsCacheKey = cacheKey;
  }

  shouldUpdatePromptState(cacheKey: string): boolean {
    return this.promptCacheKey !== cacheKey;
  }

  commitPromptStateCacheKey(cacheKey: string): void {
    this.promptCacheKey = cacheKey;
  }

  // ── Skill entries ──────────────────────────────────────────────────────

  getActiveSkillEntries(): SkillPromptEntry[] {
    return this.skillEntries;
  }

  setActiveSkillEntries(entries: SkillPromptEntry[]): void {
    this.skillEntries = entries;
  }

  // ── Agent name ─────────────────────────────────────────────────────────

  /**
   * Resolve the active agent name from the session context, system prompt,
   * or last known name. Updates lastKnownActiveAgentName as a side effect.
   */
  resolveAgentName(
    ctx: ExtensionContext,
    systemPrompt?: string,
  ): string | null {
    const fromSession = getActiveAgentName(ctx);
    if (fromSession) {
      this.knownAgentName = fromSession;
      return fromSession;
    }
    const fromSystemPrompt = getActiveAgentNameFromSystemPrompt(systemPrompt);
    if (fromSystemPrompt) {
      this.knownAgentName = fromSystemPrompt;
      return fromSystemPrompt;
    }
    return this.knownAgentName;
  }

  get lastKnownActiveAgentName(): string | null {
    return this.knownAgentName;
  }

  // ── Config ─────────────────────────────────────────────────────────────

  /** Reload merged config from disk; optionally update the stored runtime context. */
  refreshConfig(ctx?: ExtensionContext): void {
    this.runtimeDeps.refreshExtensionConfig(ctx);
  }

  /** Write the resolved config path set to the review and debug logs. */
  logResolvedConfigPaths(): void {
    this.runtimeDeps.logResolvedConfigPaths();
  }

  /** Read current extension config. */
  get config(): PermissionSystemExtensionConfig {
    return this.runtimeDeps.getConfig();
  }

  // ── Infrastructure paths ───────────────────────────────────────────────

  getAgentDir(): string {
    return this.paths.agentDir;
  }

  getInfrastructureDirs(): readonly string[] {
    return this.paths.piInfrastructureDirs;
  }

  /** Config-derived infrastructure read paths (current at call time). */
  getInfrastructureReadPaths(): string[] {
    return this.config.piInfrastructureReadPaths ?? [];
  }

  // ── Prompting ──────────────────────────────────────────────────────────

  /** Whether the current context can show an interactive permission prompt. */
  canPrompt(ctx: ExtensionContext): boolean {
    return this.runtimeDeps.canRequestPermissionConfirmation(ctx);
  }

  /** Prompt the user for a permission decision, log the outcome, and return it. */
  prompt(
    ctx: ExtensionContext,
    details: PromptPermissionDetails,
  ): Promise<PermissionPromptDecision> {
    return this.runtimeDeps.promptPermission(ctx, details);
  }

  /** Generate a unique ID for a permission request. */
  createPermissionRequestId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${process.pid}`;
  }
}
