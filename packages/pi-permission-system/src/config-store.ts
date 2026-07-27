import {
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, normalize } from "node:path";
import type {
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

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
import {
  applyPermissionSystemRuntimeOverrides,
  type PermissionSystemRuntimeOverrides,
} from "./runtime-config-overrides";
import type { DebugReviewLogger } from "./session-logger";
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
  refresh(ctx: ExtensionContext | undefined, projectTrusted: boolean): void;
  logResolvedPaths(cwd?: string): void;
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
  runtimeOverrides: PermissionSystemRuntimeOverrides;
}

/**
 * Owns the mutable extension config and the operations that read/write it.
 *
 * Replaces the three `(runtime, …)` config free functions
 * (`refreshExtensionConfig`, `saveExtensionConfig`, `logResolvedConfigPaths`)
 * with methods that privately own `config` and `lastConfigWarning`.
 *
 * Implements {@link ConfigReader} so consumers that only read the current config
 * can depend on the narrow interface rather than the full class.
 */
export class ConfigStore implements SessionConfigStore, CommandConfigStore {
  private config: PermissionSystemExtensionConfig;
  private lastConfigWarning: string | null = null;

  constructor(private readonly deps: ConfigStoreDeps) {
    this.config = this.applyRuntimeOverrides({
      ...DEFAULT_EXTENSION_CONFIG,
    });
  }

  /** Return the current extension config. */
  current(): PermissionSystemExtensionConfig {
    return this.config;
  }

  /**
   * Reload merged config from disk.
   *
   * If `ctx` is provided, uses it to derive the cwd and sync UI status.
   * When `projectTrusted` is `false`, the project scope is withheld so an
   * untrusted repository's runtime config (`yoloMode`, `permissionReviewLog`,
   * …) cannot loosen the operator's global config (#644).
   */
  refresh(ctx: ExtensionContext | undefined, projectTrusted: boolean): void {
    const cwd = ctx?.cwd ?? null;
    const mergeResult = loadAndMergeConfigs(
      this.deps.agentDir,
      cwd ?? "",
      EXTENSION_ROOT,
      { includeProjectScope: projectTrusted },
    );
    const fileConfig = normalizePermissionSystemConfig(mergeResult.merged);
    const runtimeConfig = this.applyRuntimeOverrides(fileConfig);
    this.config = runtimeConfig;

    if (ctx?.hasUI) {
      syncPermissionSystemStatus(ctx, runtimeConfig);
    }

    const warning =
      mergeResult.issues.length > 0 ? mergeResult.issues.join("\n") : undefined;

    if (warning && warning !== this.lastConfigWarning) {
      this.lastConfigWarning = warning;
      ctx?.ui.notify(warning, "warning");
    } else if (!warning) {
      this.lastConfigWarning = null;
    }

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
  // Called via the CommandConfigStore interface from config-modal.ts — fallow cannot trace through interfaces.
  // fallow-ignore-next-line unused-class-member
  save(
    next: PermissionSystemExtensionConfig,
    ctx: ExtensionCommandContext,
  ): void {
    const normalized = normalizePermissionSystemConfig(next);
    const globalPath = getGlobalConfigPath(this.deps.agentDir);

    const existing = loadUnifiedConfig(globalPath);
    const persistedYoloMode =
      this.deps.runtimeOverrides.yoloMode === true
        ? existing.config.yoloMode === true
        : normalized.yoloMode;
    const persistedConfig = {
      ...normalized,
      yoloMode: persistedYoloMode,
    };
    const merged = {
      ...existing.config,
      debugLog: persistedConfig.debugLog,
      permissionReviewLog: persistedConfig.permissionReviewLog,
      yoloMode: persistedConfig.yoloMode,
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

    this.config = this.applyRuntimeOverrides(persistedConfig);
    syncPermissionSystemStatus(ctx, this.config);
    this.lastConfigWarning = null;

    this.deps.logger.debug("config.saved", {
      debugLog: this.config.debugLog,
      permissionReviewLog: this.config.permissionReviewLog,
      yoloMode: this.config.yoloMode,
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

  private applyRuntimeOverrides(
    config: PermissionSystemExtensionConfig,
  ): PermissionSystemExtensionConfig {
    return applyPermissionSystemRuntimeOverrides(
      config,
      this.deps.runtimeOverrides,
    );
  }
}
