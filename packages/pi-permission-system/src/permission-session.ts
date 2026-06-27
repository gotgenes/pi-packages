import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  getActiveAgentName,
  getActiveAgentNameFromSystemPrompt,
} from "./active-agent";

import type { BashAuditConfig } from "./bash-command-auditor";
import type { SessionConfigStore } from "./config-store";
import type { PermissionSystemExtensionConfig } from "./extension-config";
import type { ExtensionPaths } from "./extension-paths";
import type { ForwardingController } from "./forwarding-manager";
import type { ToolCallGateInputs } from "./handlers/gates/tool-call-gate-pipeline";
import type { ScopedPermissionManager } from "./permission-manager";
import type { PromptingGatewayLifecycle } from "./prompting-gateway";

import type { SessionRules } from "./session-rules";
import type { SkillPromptEntry } from "./skill-prompt-sanitizer";
import {
  resolveToolPreviewLimits,
  type ToolPreviewFormatterOptions,
} from "./tool-preview-formatter";

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
 * - `ForwardingController` — polling lifecycle
 * - `SessionConfigStore` — owns extension config; provides refresh, log, read
 * - `PromptingGatewayLifecycle` — prompting lifecycle forwarded via activate/deactivate
 */
export class PermissionSession implements ToolCallGateInputs {
  private context: ExtensionContext | null = null;
  private skillEntries: SkillPromptEntry[] = [];
  private knownAgentName: string | null = null;

  constructor(
    private readonly paths: ExtensionPaths,
    private readonly forwarding: ForwardingController,
    private readonly permissionManager: ScopedPermissionManager,
    private readonly sessionRules: SessionRules,
    private readonly configStore: SessionConfigStore,
    private readonly gateway: PromptingGatewayLifecycle,
  ) {}

  // ── Context lifecycle ──────────────────────────────────────────────────

  /** Store the current extension context, start forwarding, and activate the gateway. */
  activate(ctx: ExtensionContext): void {
    this.context = ctx;
    this.forwarding.start(ctx);
    this.gateway.activate(ctx);
  }

  /** Clear the context, stop forwarding, and deactivate the gateway. */
  deactivate(): void {
    this.context = null;
    this.forwarding.stop();
    this.gateway.deactivate();
  }

  /** Return the current runtime context, or null if not activated. */
  getRuntimeContext(): ExtensionContext | null {
    return this.context;
  }

  // ── UI notifications ────────────────────────────────────────────────────

  /** Surface a warning message to the user via the active UI context, if any. */
  notify(message: string): void {
    this.context?.ui.notify(message, "warning");
  }

  // ── Session lifecycle ────────────────────────────────────────────────────

  /**
   * Reset all mutable state for a new session.
   *
   * Configures the injected PermissionManager for `ctx.cwd`, clears skill
   * entries, and activates the new context.
   */
  resetForNewSession(ctx: ExtensionContext): void {
    this.permissionManager.configureForCwd(ctx.cwd);
    this.skillEntries = [];
    this.activate(ctx);
  }

  /**
   * Shut down the session: clear rules, skill entries, and deactivate
   * context + forwarding.
   */
  shutdown(): void {
    this.sessionRules.clear();
    this.skillEntries = [];
    this.deactivate();
  }

  /**
   * Reload permission manager and clear skill entries for the current context.
   * Used on config reload (e.g. `resources_discover` with reason "reload").
   */
  reload(): void {
    this.permissionManager.configureForCwd(this.context?.cwd);
    this.skillEntries = [];
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

  // Read by the `index.ts` config-modal adapter closure:
  // `permissionManager.getComposedConfigRules(session.lastKnownActiveAgentName ?? undefined)`.
  get lastKnownActiveAgentName(): string | null {
    return this.knownAgentName;
  }

  // ── Config ─────────────────────────────────────────────────────────────

  /** Reload merged config from disk; optionally update the stored runtime context. */
  refreshConfig(ctx?: ExtensionContext): void {
    this.configStore.refresh(ctx);
  }

  /** Write the resolved config path set to the review and debug logs. */
  logResolvedConfigPaths(): void {
    this.configStore.logResolvedPaths(this.context?.cwd);
  }

  /** Read current extension config. */
  get config(): PermissionSystemExtensionConfig {
    return this.configStore.current();
  }

  // ── Infrastructure paths ───────────────────────────────────────────────

  /**
   * Combined infrastructure read directories: static paths from
   * `ExtensionPaths` plus config-derived paths.
   */
  getInfrastructureReadDirs(): string[] {
    return [
      ...this.paths.piInfrastructureDirs,
      ...(this.config.piInfrastructureReadPaths ?? []),
    ];
  }

  /**
   * Resolved tool-preview formatter options from the current config.
   *
   * Replaces the handler's `resolveToolPreviewLimits(session.config)` reach
   * so the pipeline reads a clean value rather than pulling raw config.
   */
  getToolPreviewLimits(): ToolPreviewFormatterOptions {
    return resolveToolPreviewLimits(this.config);
  }

  /**
   * Bash command audit config derived from the current extension config.
   *
   * Supplies `allowSudo` and `allowShellEscape` flags to `auditBashCommand`
   * so the auditor respects the operator-set policy for each session.
   */
  getBashAuditConfig(): BashAuditConfig {
    return {
      allowSudo: this.config.allowSudo,
      allowShellEscape: this.config.allowShellEscape,
    };
  }
}
