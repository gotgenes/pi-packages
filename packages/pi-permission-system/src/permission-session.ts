import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ForwardingController } from "#src/authority/forwarding-manager";
import {
  getActiveAgentName,
  getActiveAgentNameFromSystemPrompt,
} from "./active-agent";
import type { AuthorizerSelectionLifecycle } from "./authority/authorizer-selection";
import type { ShellToolsConfig } from "./config-schema";
import type { SessionConfigStore } from "./config-store";
import type { PermissionSystemExtensionConfig } from "./extension-config";
import type { ExtensionPaths } from "./extension-paths";
import type { ToolCallGateInputs } from "./handlers/gates/tool-call-gate-pipeline";
import type { PathFlavor } from "./path/path-flavor";
import { PathNormalizer } from "./path-normalizer";
import type { ScopedPermissionManager } from "./permission-manager";

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
 * - `AuthorizerSelectionLifecycle` — authorizer-selection lifecycle forwarded via activate/deactivate
 */
export class PermissionSession implements ToolCallGateInputs {
  private context: ExtensionContext | null = null;
  private skillEntries: SkillPromptEntry[] = [];
  private knownAgentName: string | null = null;
  private pathNormalizer: PathNormalizer;

  constructor(
    private readonly paths: ExtensionPaths,
    private readonly forwarding: ForwardingController,
    private readonly permissionManager: ScopedPermissionManager,
    private readonly sessionRules: SessionRules,
    private readonly configStore: SessionConfigStore,
    private readonly authorizerSelection: AuthorizerSelectionLifecycle,
    private readonly flavor: PathFlavor,
  ) {
    // Placeholder until the first activate(ctx) binds the real cwd; every gate
    // evaluate runs after activate (handleToolCall activates first), so this
    // empty-cwd value is never read.
    this.pathNormalizer = new PathNormalizer(flavor, "");
  }

  // ── Context lifecycle ──────────────────────────────────────────────────

  /**
   * Store the current extension context, rebuild the path normalizer for its
   * cwd, start forwarding, and activate the gateway.
   *
   * The normalizer is (re)built here rather than only at `resetForNewSession`
   * so it always tracks the active context's cwd — `ctx.cwd` is stable within a
   * session, so this is a no-op rebuild in production, but it closes the
   * fail-open gap if a tool call ever arrives before `session_start`.
   */
  activate(ctx: ExtensionContext): void {
    this.context = ctx;
    this.pathNormalizer = new PathNormalizer(this.flavor, ctx.cwd);
    this.forwarding.start(ctx);
    this.authorizerSelection.activate(ctx);
  }

  /** Clear the context, stop forwarding, and deactivate the authorizer selection. */
  deactivate(): void {
    this.context = null;
    this.forwarding.stop();
    this.authorizerSelection.deactivate();
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
   * Configures the injected PermissionManager for `ctx.cwd` (or global-only
   * when `projectTrusted` is `false`, withholding the project cwd so an
   * untrusted project's policy scopes are not loaded, #644), clears skill
   * entries, and activates the new context.
   */
  resetForNewSession(ctx: ExtensionContext, projectTrusted: boolean): void {
    this.permissionManager.configureForCwd(
      projectTrusted ? ctx.cwd : undefined,
    );
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
   *
   * When `projectTrusted` is `false` the project cwd is withheld, so a reload
   * in an untrusted project reloads only global policy; a trust grant on a
   * later reload re-includes the project scope (#644).
   */
  reload(projectTrusted: boolean): void {
    this.permissionManager.configureForCwd(
      projectTrusted ? this.context?.cwd : undefined,
    );
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

  /**
   * Reload merged config from disk; optionally update the stored runtime
   * context. When `projectTrusted` is `false`, the project scope is withheld
   * so an untrusted project's runtime config is not merged (#644).
   */
  refreshConfig(
    ctx: ExtensionContext | undefined,
    projectTrusted: boolean,
  ): void {
    this.configStore.refresh(ctx, projectTrusted);
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
    return resolveToolPreviewLimits();
  }

  /**
   * The configured shell-tool aliases (`shellTools`), mapping a non-`bash` tool
   * name to the input arguments holding its command and optional working
   * directory. `undefined` when no aliases are configured. Consumed by the
   * gate pipeline's {@link resolveShellInvocation} consult (#574).
   */
  getShellToolAliases(): ShellToolsConfig | undefined {
    return this.config.shellTools;
  }

  // ── Path normalization ────────────────────────────────────────────────

  /**
   * The session's {@link PathNormalizer}, carrying the host path flavor and the
   * session cwd. Rebuilt on every `resetForNewSession` so a session switch
   * rebinds the cwd.
   */
  getPathNormalizer(): PathNormalizer {
    return this.pathNormalizer;
  }
}
