import {
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, normalize } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { DebugReviewLogger } from "#src/logging/session-logger";
import {
  type DeclaredCommandEffects,
  detectShadowedCommandEffects,
  detectWrapperCommandEffects,
  NO_DECLARED_COMMAND_EFFECTS,
} from "./command-effects-config";
import type { ConfigIssueSource } from "./config-issue-reporter";
import { loadAndMergeConfigs, loadUnifiedConfig } from "./config-loader";
import {
  getGlobalConfigPath,
  getLegacyExtensionConfigPath,
  getLegacyGlobalPolicyPath,
  getLegacyProjectPolicyPath,
} from "./config-paths";
import { buildResolvedConfigLogEntry } from "./config-reporter";
import {
  DEFAULT_EXTENSION_CONFIG,
  EXTENSION_ROOT,
  normalizePermissionSystemConfig,
  type PermissionSystemExtensionConfig,
} from "./extension-config";
import type { ResolvedPolicyPaths } from "./policy-loader";
import { syncPermissionSystemStatus } from "./status";

/** Read-only view of the current config — for consumers that only read. */
export interface ConfigReader {
  current(): PermissionSystemExtensionConfig;
}

/**
 * Narrow subset of `ConfigStore` that `PermissionSession` depends on.
 *
 * Using an interface rather than the concrete class avoids private-member
 * coupling between the class and test doubles.
 */
export interface SessionConfigStore extends ConfigReader {
  refresh(cwd: string | undefined, projectTrusted: boolean): void;
  logResolvedPaths(cwd?: string): void;
  /** The `commandEffects` declarations the last {@link refresh} loaded, scope stamped. */
  declaredCommandEffects(): DeclaredCommandEffects;
}

/**
 * Narrow subset of `ConfigStore` for the `/permission-system` command.
 *
 * Using an interface rather than the concrete class avoids private-member
 * coupling between the class and test doubles.
 */
export interface CommandConfigStore extends ConfigReader {
  save(
    next: PermissionSystemExtensionConfig,
    ctx: ExtensionCommandContext,
  ): void;
}

/** Narrow view of the manager's resolved policy paths (for `logResolvedPaths`). */
export interface ResolvedPolicyPathProvider {
  getResolvedPolicyPaths(): ResolvedPolicyPaths;
}

export interface ConfigStoreDeps {
  agentDir: string;
  policyPaths: ResolvedPolicyPathProvider;
  logger: DebugReviewLogger;
  /** The pure-reader core's words, which a `commandEffects` declaration cannot override. */
  coreCommandWords: ReadonlySet<string>;
  /** The wrapper command names, whose arguments no `commandEffects` declaration describes. */
  wrapperCommandWords: ReadonlySet<string>;
}

/**
 * Owns the mutable extension config and the operations that read/write it.
 *
 * Replaces the three `(runtime, …)` config free functions
 * (`refreshExtensionConfig`, `saveExtensionConfig`, `logResolvedConfigPaths`)
 * with methods that privately own `config` and the issue list the last load
 * produced.
 *
 * Implements {@link ConfigReader} so consumers that only read the current config
 * can depend on the narrow interface rather than the full class.
 */
export class ConfigStore
  implements SessionConfigStore, CommandConfigStore, ConfigIssueSource
{
  private config: PermissionSystemExtensionConfig;
  private configIssues: readonly string[] = [];
  // Held beside the runtime config rather than on it: `save()` rebuilds the
  // config through `normalizePermissionSystemConfig`, which would drop it.
  private declared: DeclaredCommandEffects = NO_DECLARED_COMMAND_EFFECTS;

  constructor(private readonly deps: ConfigStoreDeps) {
    this.config = { ...DEFAULT_EXTENSION_CONFIG };
  }

  /** Return the current extension config. */
  current(): PermissionSystemExtensionConfig {
    return this.config;
  }

  /**
   * The user's `commandEffects` declarations as of the last {@link refresh},
   * each stamped with the scope that declared it.
   */
  declaredCommandEffects(): DeclaredCommandEffects {
    return this.declared;
  }

  /**
   * What is wrong with the config as of the last {@link refresh}.
   *
   * Every issue `loadAndMergeConfigs` collects: a legacy-file notice, a zod
   * field violation, and the cross-cutting detectors (a permissive bash
   * fallback, a deprecated preview cap, a refused dialog-key binding).
   *
   * This store answers; `ConfigIssueReporter` decides whether the operator has
   * heard it yet (#933). Not to be confused with
   * `PermissionResolver.getPolicyIssues(agentName?)`, which answers for the
   * *policy* files rather than the extension config.
   */
  getConfigIssues(): readonly string[] {
    return this.configIssues;
  }

  /**
   * Reload merged config from disk.
   *
   * `cwd` scopes the project-level lookup; omit it when no session cwd is
   * known yet (the factory-time priming load).
   * When `projectTrusted` is `false`, the project scope is withheld so an
   * untrusted repository's runtime config (`yoloMode`, `permissionReviewLog`,
   * …) cannot loosen the operator's global config (#644).
   *
   * Takes no `ExtensionContext` on purpose: a load that holds one acquires UI
   * side effects it cannot honor when there is no session yet, which is how a
   * config warning came to be recorded as delivered without being shown
   * (#933). `PermissionSession.refreshConfig` syncs the status bar and
   * `ConfigIssueReporter` tells the operator; this reads files and answers
   * questions about them.
   */
  refresh(cwd: string | undefined, projectTrusted: boolean): void {
    const mergeResult = loadAndMergeConfigs(
      this.deps.agentDir,
      cwd ?? "",
      EXTENSION_ROOT,
      { includeProjectScope: projectTrusted },
    );
    const runtimeConfig = normalizePermissionSystemConfig(mergeResult.merged);
    this.config = runtimeConfig;
    this.declared = mergeResult.declaredCommandEffects;

    const ignoredDeclarations = [
      detectShadowedCommandEffects(this.declared, this.deps.coreCommandWords),
      detectWrapperCommandEffects(this.declared, this.deps.wrapperCommandWords),
    ].filter((issue) => issue !== undefined);
    this.configIssues = [...mergeResult.issues, ...ignoredDeclarations];

    const warning =
      mergeResult.issues.length > 0 ? mergeResult.issues.join("\n") : undefined;

    this.deps.logger.debug("config.loaded", {
      warning: warning ?? null,
      debugLog: runtimeConfig.debugLog,
      permissionReviewLog: runtimeConfig.permissionReviewLog,
      yoloMode: runtimeConfig.yoloMode,
      projectTrusted,
    });
  }

  /**
   * Save updated runtime knobs to the global config file, then update
   * the current config and sync UI status.
   *
   * Equivalent to `saveExtensionConfig(runtime, next, ctx)`.
   */
  save(
    next: PermissionSystemExtensionConfig,
    ctx: ExtensionCommandContext,
  ): void {
    const normalized = normalizePermissionSystemConfig(next);
    const globalPath = getGlobalConfigPath(this.deps.agentDir);

    const existing = loadUnifiedConfig(globalPath);
    const merged = {
      ...existing.config,
      debugLog: normalized.debugLog,
      permissionReviewLog: normalized.permissionReviewLog,
      yoloMode: normalized.yoloMode,
    };

    const tmpPath = `${globalPath}.tmp`;
    try {
      mkdirSync(dirname(globalPath), { recursive: true });
      writeFileSync(tmpPath, `${JSON.stringify(merged, null, 2)}\n`, "utf-8");
      renameSync(tmpPath, globalPath);
    } catch (error) {
      try {
        if (existsSync(tmpPath)) {
          unlinkSync(tmpPath);
        }
      } catch {
        // Ignore cleanup failures.
      }
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(
        `Failed to save permission-system config at '${globalPath}': ${message}`,
        "error",
      );
      return;
    }

    this.config = normalized;
    syncPermissionSystemStatus(ctx, normalized);

    this.deps.logger.debug("config.saved", {
      debugLog: normalized.debugLog,
      permissionReviewLog: normalized.permissionReviewLog,
      yoloMode: normalized.yoloMode,
    });
  }

  /**
   * Write the resolved config path set to the review and debug logs.
   *
   * Equivalent to `logResolvedConfigPaths(runtime)`.
   */
  logResolvedPaths(cwd?: string): void {
    const policyPaths = this.deps.policyPaths.getResolvedPolicyPaths();
    const { agentDir } = this.deps;
    const legacyGlobalPolicyDetected = existsSync(
      getLegacyGlobalPolicyPath(agentDir),
    );
    const legacyProjectPolicyDetected = cwd
      ? existsSync(getLegacyProjectPolicyPath(cwd))
      : false;
    const legacyExtConfigPath = getLegacyExtensionConfigPath(EXTENSION_ROOT);
    const newGlobalPath = getGlobalConfigPath(agentDir);
    const legacyExtensionConfigDetected =
      normalize(legacyExtConfigPath) !== normalize(newGlobalPath) &&
      existsSync(legacyExtConfigPath);
    const entry = buildResolvedConfigLogEntry({
      policyPaths,
      legacyGlobalPolicyDetected,
      legacyProjectPolicyDetected,
      legacyExtensionConfigDetected,
    });
    this.deps.logger.review(
      "config.resolved",
      entry as unknown as Record<string, unknown>,
    );
    this.deps.logger.debug(
      "config.resolved",
      entry as unknown as Record<string, unknown>,
    );
  }
}
