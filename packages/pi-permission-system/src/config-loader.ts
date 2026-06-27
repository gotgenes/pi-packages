import { existsSync, readFileSync } from "node:fs";
import { normalize } from "node:path";
import {
  getGlobalConfigPath,
  getLegacyExtensionConfigPath,
  getLegacyGlobalPolicyPath,
  getLegacyProjectPolicyPath,
  getProjectConfigPath,
} from "./config-paths";
import { mergeFlatPermissions } from "./permission-merge";
import type { FlatPermissionConfig, PatternValue } from "./types";
import {
  isDenyWithReason,
  isPermissionState,
  normalizeOptionalPositiveInt,
  normalizeOptionalStringArray,
  toRecord,
} from "./value-guards";

/**
 * Unified config shape combining runtime knobs and flat permission policy.
 * All fields are optional so partial configs (project-only, global-only) work.
 */
export interface UnifiedPermissionConfig {
  // Runtime knobs
  debugLog?: boolean;
  permissionReviewLog?: boolean;
  yoloMode?: boolean;
  allowSudo?: boolean;
  allowShellEscape?: boolean;
  toolInputPreviewMaxLength?: number;
  toolTextSummaryMaxLength?: number;
  piInfrastructureReadPaths?: string[];

  // Flat permission policy
  permission?: FlatPermissionConfig;
}

export interface UnifiedConfigLoadResult {
  config: UnifiedPermissionConfig;
  issues: string[];
}

export function stripJsonComments(input: string): string {
  let output = "";
  let i = 0;
  while (i < input.length) {
    const char = input[i];
    const next = input[i + 1] ?? "";

    if (char === "/" && next === "/") {
      const seg = consumeLineComment(input, i);
      output += seg.output;
      i = seg.nextIndex;
      continue;
    }
    if (char === "/" && next === "*") {
      const seg = consumeBlockComment(input, i);
      output += seg.output;
      i = seg.nextIndex;
      continue;
    }
    if (char === '"' || char === "'") {
      const seg = consumeString(input, i);
      output += seg.output;
      i = seg.nextIndex;
      continue;
    }

    output += char;
    i++;
  }
  return output;
}

/** A consumed run of source: the text to emit and the index to resume scanning. */
interface ScanSegment {
  output: string;
  nextIndex: number;
}

/** Consume a `//` line comment starting at `start`; drop the body, keep the newline. */
function consumeLineComment(input: string, start: number): ScanSegment {
  const newlineIndex = input.indexOf("\n", start);
  if (newlineIndex === -1) return { output: "", nextIndex: input.length };
  return { output: "\n", nextIndex: newlineIndex + 1 };
}

/** Consume a block comment starting at `start`; drop it entirely. */
function consumeBlockComment(input: string, start: number): ScanSegment {
  const closeIndex = input.indexOf("*/", start + 2);
  if (closeIndex === -1) return { output: "", nextIndex: input.length };
  return { output: "", nextIndex: closeIndex + 2 };
}

/**
 * Consume a string literal starting at the opening quote at `start`.
 * Honors backslash escapes so an escaped quote does not close the literal.
 * Emits the opening quote, body, and closing quote verbatim.
 */
function consumeString(input: string, start: number): ScanSegment {
  const quote = input[start];
  let output = quote;
  let i = start + 1;
  let escaping = false;
  while (i < input.length) {
    const char = input[i];
    output += char;
    i++;
    if (escaping) {
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (char === quote) break;
  }
  return { output, nextIndex: i };
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  return undefined;
}

/**
 * Normalize a raw `permission` value from parsed JSON into a FlatPermissionConfig.
 * Accepts PermissionState strings and DenyWithReason objects inside pattern
 * maps. Drops non-object top-level values, invalid PermissionState strings, and
 * invalid action values inside object maps.
 */
function normalizeFlatPermissionValue(
  value: unknown,
): FlatPermissionConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const normalized: FlatPermissionConfig = {};
  let hasAny = false;

  for (const [key, val] of Object.entries(record)) {
    if (typeof val === "string") {
      if (isPermissionState(val)) {
        normalized[key] = val;
        hasAny = true;
      }
    } else if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      const map: Record<string, PatternValue> = {};
      let mapHasAny = false;
      for (const [pattern, action] of Object.entries(
        val as Record<string, unknown>,
      )) {
        if (isDenyWithReason(action)) {
          map[pattern] = action;
          mapHasAny = true;
        } else if (isPermissionState(action)) {
          map[pattern] = action;
          mapHasAny = true;
        }
      }
      if (mapHasAny) {
        normalized[key] = map;
        hasAny = true;
      }
    }
  }

  return hasAny ? normalized : undefined;
}

/**
 * Normalize raw parsed JSON into the unified config shape.
 */
export function normalizeUnifiedConfig(raw: unknown): {
  config: UnifiedPermissionConfig;
  issues: string[];
} {
  const record = toRecord(raw);
  const issues: string[] = [];
  const config: UnifiedPermissionConfig = {};

  // Runtime knobs
  const debugLog = normalizeOptionalBoolean(record.debugLog);
  if (debugLog !== undefined) config.debugLog = debugLog;

  const permissionReviewLog = normalizeOptionalBoolean(
    record.permissionReviewLog,
  );
  if (permissionReviewLog !== undefined)
    config.permissionReviewLog = permissionReviewLog;

  const yoloMode = normalizeOptionalBoolean(record.yoloMode);
  if (yoloMode !== undefined) config.yoloMode = yoloMode;

  const allowSudo = normalizeOptionalBoolean(record.allowSudo);
  if (allowSudo !== undefined) config.allowSudo = allowSudo;

  const allowShellEscape = normalizeOptionalBoolean(record.allowShellEscape);
  if (allowShellEscape !== undefined) config.allowShellEscape = allowShellEscape;

  const toolInputPreviewMaxLength = normalizeOptionalPositiveInt(
    record.toolInputPreviewMaxLength,
  );
  if (toolInputPreviewMaxLength !== undefined)
    config.toolInputPreviewMaxLength = toolInputPreviewMaxLength;

  const toolTextSummaryMaxLength = normalizeOptionalPositiveInt(
    record.toolTextSummaryMaxLength,
  );
  if (toolTextSummaryMaxLength !== undefined)
    config.toolTextSummaryMaxLength = toolTextSummaryMaxLength;

  const piInfrastructureReadPaths = normalizeOptionalStringArray(
    record.piInfrastructureReadPaths,
  );
  if (piInfrastructureReadPaths !== undefined)
    config.piInfrastructureReadPaths = piInfrastructureReadPaths;

  // Flat permission policy
  const permission = normalizeFlatPermissionValue(record.permission);
  if (permission !== undefined) config.permission = permission;

  return { config, issues };
}

/**
 * Merge two unified configs.
 * - `permission` is deep-shallow merged (surface-level object maps are shallow-merged).
 * - Scalar fields (debugLog, permissionReviewLog, yoloMode) are replaced when
 *   present in the override.
 * - Array fields (piInfrastructureReadPaths) replace the base when present in
 *   the override (override-wins, same as scalars).
 */
export function mergeUnifiedConfigs(
  base: UnifiedPermissionConfig,
  override: UnifiedPermissionConfig,
): UnifiedPermissionConfig {
  const merged: UnifiedPermissionConfig = {};

  // Boolean scalars: override replaces base when defined
  for (const key of ["debugLog", "permissionReviewLog", "yoloMode", "allowSudo", "allowShellEscape"] as const) {
    const value = override[key] ?? base[key];
    if (value !== undefined) {
      merged[key] = value;
    }
  }

  // Number scalars: override replaces base when defined
  for (const key of [
    "toolInputPreviewMaxLength",
    "toolTextSummaryMaxLength",
  ] as const) {
    const value = override[key] ?? base[key];
    if (value !== undefined) {
      merged[key] = value;
    }
  }

  // Array fields: override replaces base when defined
  const piInfrastructureReadPaths =
    override.piInfrastructureReadPaths ?? base.piInfrastructureReadPaths;
  if (piInfrastructureReadPaths !== undefined) {
    merged.piInfrastructureReadPaths = piInfrastructureReadPaths;
  }

  // Permission: deep-shallow merge
  const basePerm = base.permission;
  const overridePerm = override.permission;
  if (basePerm && overridePerm) {
    merged.permission = mergeFlatPermissions(basePerm, overridePerm);
  } else if (basePerm) {
    merged.permission = basePerm;
  } else if (overridePerm) {
    merged.permission = overridePerm;
  }

  return merged;
}

export interface MergedConfigResult {
  global: UnifiedPermissionConfig;
  project: UnifiedPermissionConfig;
  merged: UnifiedPermissionConfig;
  issues: string[];
}

/**
 * Load global and project configs from the new layout, detect legacy files,
 * merge everything, and collect issues.
 *
 * Merge order:
 * 1. Legacy global policy (if present) — lowest precedence
 * 2. Legacy extension runtime config (if present and path differs from new global)
 * 3. New global config
 * 4. Legacy project policy (if present)
 * 5. New project config — highest precedence
 *
 * Legacy files are detected and warned about. Their content is parsed with the
 * flat-format parser — legacy-format keys (defaultPolicy, tools, bash, etc.)
 * are not translated and contribute no permission rules.
 */
export function loadAndMergeConfigs(
  agentDir: string,
  cwd: string,
  extensionRoot: string,
): MergedConfigResult {
  const allIssues: string[] = [];

  const newGlobalPath = getGlobalConfigPath(agentDir);
  const newProjectPath = getProjectConfigPath(cwd);
  const legacyGlobalPolicyPath = getLegacyGlobalPolicyPath(agentDir);
  const legacyProjectPolicyPath = getLegacyProjectPolicyPath(cwd);
  const legacyExtConfigPath = getLegacyExtensionConfigPath(extensionRoot);

  // Start with empty
  let merged: UnifiedPermissionConfig = {};

  // 1. Legacy global policy
  if (existsSync(legacyGlobalPolicyPath)) {
    const legacy = loadUnifiedConfig(legacyGlobalPolicyPath);
    allIssues.push(
      `Legacy global policy found at '${legacyGlobalPolicyPath}'. ` +
        `Move it to '${newGlobalPath}':\n` +
        `  mv '${legacyGlobalPolicyPath}' '${newGlobalPath}'`,
    );
    allIssues.push(...legacy.issues);
    merged = mergeUnifiedConfigs(merged, legacy.config);
  }

  // 2. Legacy extension runtime config (only if different from new global path)
  const normalizedLegacyExt = normalize(legacyExtConfigPath);
  const normalizedNewGlobal = normalize(newGlobalPath);
  if (
    normalizedLegacyExt !== normalizedNewGlobal &&
    existsSync(legacyExtConfigPath)
  ) {
    const legacy = loadUnifiedConfig(legacyExtConfigPath);
    allIssues.push(
      `Legacy extension config found at '${legacyExtConfigPath}'. ` +
        `Move runtime settings to '${newGlobalPath}':\n` +
        `  mv '${legacyExtConfigPath}' '${newGlobalPath}'`,
    );
    allIssues.push(...legacy.issues);
    merged = mergeUnifiedConfigs(merged, legacy.config);
  }

  // 3. New global config
  const globalResult = loadUnifiedConfig(newGlobalPath);
  allIssues.push(...globalResult.issues);
  const globalConfig = globalResult.config;
  merged = mergeUnifiedConfigs(merged, globalConfig);

  // 4. Legacy project policy
  if (existsSync(legacyProjectPolicyPath)) {
    const legacy = loadUnifiedConfig(legacyProjectPolicyPath);
    allIssues.push(
      `Legacy project policy found at '${legacyProjectPolicyPath}'. ` +
        `Move it to '${newProjectPath}':\n` +
        `  mv '${legacyProjectPolicyPath}' '${newProjectPath}'`,
    );
    allIssues.push(...legacy.issues);
    merged = mergeUnifiedConfigs(merged, legacy.config);
  }

  // 5. New project config
  const projectResult = loadUnifiedConfig(newProjectPath);
  allIssues.push(...projectResult.issues);
  const projectConfig = projectResult.config;
  merged = mergeUnifiedConfigs(merged, projectConfig);

  const bashFallbackIssue = detectPermissiveBashFallback(merged.permission);
  if (bashFallbackIssue) allIssues.push(bashFallbackIssue);

  return {
    global: globalConfig,
    project: projectConfig,
    merged,
    issues: allIssues,
  };
}

/**
 * Detect the config footgun where a permissive top-level `*: allow` leaves the
 * bash surface ungated, so every bash command silently inherits `allow`.
 *
 * Returns one warning string when `permission["*"] === "allow"` and the `bash`
 * surface neither is a bare string (shorthand for `{ "*": … }`) nor an object
 * map with an explicit `"*"` key. Returns `undefined` otherwise. The detector
 * is pure: it takes the merged permission map and returns a message; the caller
 * owns pushing it onto the issue list.
 */
export function detectPermissiveBashFallback(
  permission: FlatPermissionConfig | undefined,
): string | undefined {
  if (permission?.["*"] !== "allow") return undefined;

  // The Record index signature reports an absent surface as the value type, not
  // `undefined`; read through a Partial view so the absent-bash guard is honest
  // (an unguarded Object.hasOwn(undefined, …) would throw at runtime).
  const surfaces: Partial<FlatPermissionConfig> = permission;
  const bash = surfaces.bash;
  // A bare string surface is shorthand for `{ "*": action }` — explicitly gated.
  if (typeof bash === "string") return undefined;
  // An object map with an explicit `"*"` key is explicitly gated.
  if (bash && Object.hasOwn(bash, "*")) return undefined;

  return (
    "Permission config sets a permissive top-level '*': 'allow' with no 'bash' '*' policy, " +
    "so bash commands silently inherit 'allow'. Set an explicit 'bash' policy " +
    '(e.g. "bash": { "*": "ask" }) to gate bash commands.'
  );
}

/**
 * Load and normalize a unified config file.
 * Returns an empty config with no issues if the file does not exist.
 * Returns an empty config with an issue if the file cannot be parsed.
 */
export function loadUnifiedConfig(path: string): UnifiedConfigLoadResult {
  if (!existsSync(path)) {
    return { config: {}, issues: [] };
  }

  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(stripJsonComments(raw)) as unknown;
    return normalizeUnifiedConfig(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      config: {},
      issues: [`Failed to read config at '${path}': ${message}`],
    };
  }
}
