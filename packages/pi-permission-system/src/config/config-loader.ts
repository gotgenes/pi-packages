import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import type { ZodError } from "zod";
import { PATH_SURFACES } from "#src/access-intent/path-surfaces";
import { hasHomePrefix } from "#src/path/expand-home";
import { mergeFlatPermissions } from "#src/policy/permission-merge";
import type { FlatPermissionConfig, PatternValue } from "#src/types";
import { isDenyWithReason, isPermissionState } from "#src/types";
import {
  getAncestorProjectScopes,
  getGlobalConfigPath,
  getLegacyExtensionConfigPath,
  getLegacyGlobalPolicyPath,
} from "./config-paths";
import {
  type ShellToolsConfig,
  type UnifiedPermissionConfig,
  unifiedConfigSchema,
} from "./config-schema";
import { type DialogKeysConfig, resolveDialogKeys } from "./dialog-keys";

// The unified config shape is derived from the zod schema (config-schema.ts,
// the single source of truth) and re-exported so existing importers keep their
// import path. All fields are optional so partial configs merge before
// defaults are applied downstream.
export type { ShellToolsConfig, UnifiedPermissionConfig };

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

/**
 * Normalize a raw `permission` value from parsed JSON into a FlatPermissionConfig.
 * Accepts PermissionState strings and DenyWithReason objects inside pattern
 * maps. Drops non-object top-level values, invalid PermissionState strings, and
 * invalid action values inside object maps.
 */
export function normalizeFlatPermissionValue(
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
 * Validate raw parsed JSON against the config schema (the single source of
 * truth in `config-schema.ts`).
 *
 * On success the typed config is returned. On failure the whole scope config is
 * rejected — fail-closed: an empty config contributes no rules, so missing
 * surfaces fall through to the universal `ask` default rather than `allow` —
 * and every schema violation is reported as a clear, actionable issue.
 */
export function validateUnifiedConfig(
  parsed: unknown,
): UnifiedConfigLoadResult {
  const result = unifiedConfigSchema.safeParse(parsed);
  if (result.success) {
    return { config: result.data, issues: [] };
  }
  return { config: {}, issues: formatConfigIssues(result.error) };
}

/** Render each schema violation as a clear, path-qualified message. */
function formatConfigIssues(error: ZodError): string[] {
  const messages: string[] = [];
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        messages.push(`Unrecognized config key '${key}'.`);
      }
      continue;
    }
    const location =
      issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
    messages.push(`Invalid config value at '${location}': ${issue.message}`);
  }
  return messages;
}

/**
 * Merge two unified configs.
 * - `permission` is deep-shallow merged (surface-level object maps are shallow-merged).
 * - Scalar fields (debugLog, permissionReviewLog, yoloMode) are replaced when
 *   present in the override.
 * - Array fields (piInfrastructureReadPaths) replace the base when present in
 *   the override (override-wins, same as scalars).
 * - `permissionDialogKeys` replaces the base map whole, unlike `shellTools`.
 * - `promptNotifications` replaces the base list whole, like the arrays.
 */
// Scalar knobs merged by override-replaces-base; keep in sync with
// PermissionSystemExtensionConfig booleans (debugLog, permissionReviewLog,
// yoloMode, doublePressToConfirm).
export function mergeUnifiedConfigs(
  base: UnifiedPermissionConfig,
  override: UnifiedPermissionConfig,
): UnifiedPermissionConfig {
  const merged: UnifiedPermissionConfig = {};

  // Boolean scalars: override replaces base when defined
  for (const key of [
    "debugLog",
    "permissionReviewLog",
    "yoloMode",
    "doublePressToConfirm",
  ] as const) {
    const value = override[key] ?? base[key];
    if (value !== undefined) {
      merged[key] = value;
    }
  }

  // Number scalars: override replaces base when defined
  for (const key of [
    "forwardingTimeoutMs",
    "promptTimeoutMs",
    "promptMaxRows",
    "promptFieldMaxWidth",
    "reviewLogFieldMaxWidth",
    "toolInputPreviewMaxLength",
    "toolTextSummaryMaxLength",
  ] as const) {
    const value = override[key] ?? base[key];
    if (value !== undefined) {
      merged[key] = value;
    }
  }

  // Array fields: override replaces base when defined
  for (const key of ["piInfrastructureReadPaths", "authorizerChain"] as const) {
    const value = override[key] ?? base[key];
    if (value !== undefined) {
      merged[key] = value;
    }
  }

  // permissionDialogKeys: whole-object replacement. A key map is validated as
  // a unit, so merging two individually valid maps could bind one character to
  // two decisions with neither file's own validation able to see it. Dropping a
  // base entry only restores a default letter, which is why this does not need
  // the shellTools rule below.
  const dialogKeys = override.permissionDialogKeys ?? base.permissionDialogKeys;
  if (dialogKeys !== undefined) {
    merged.permissionDialogKeys = dialogKeys;
  }

  // promptNotifications: override replaces base, as the string arrays above
  // do; its own block because a union-keyed write in that loop would have to
  // satisfy both element types at once.
  const notifications =
    override.promptNotifications ?? base.promptNotifications;
  if (notifications !== undefined) {
    merged.promptNotifications = notifications;
  }

  // shellTools: shallow-merge by tool name so a project entry overrides a
  // colliding tool's alias but never drops a global entry (a dropped alias is
  // a silent enforcement regression).
  const baseShell = base.shellTools;
  const overrideShell = override.shellTools;
  if (baseShell && overrideShell) {
    merged.shellTools = { ...baseShell, ...overrideShell };
  } else if (baseShell) {
    merged.shellTools = baseShell;
  } else if (overrideShell) {
    merged.shellTools = overrideShell;
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
 * Whether a permission pattern (or infrastructure path entry) is a relative
 * path that a project scope owns: not absolute, not home-anchored, and not
 * led by a wildcard (`*`, `?`, `[`), which matches anywhere by design
 * (`*.env` must keep matching outside the scope's directory).
 */
export function isRelativePathPattern(pattern: string): boolean {
  if (pattern.length === 0 || pattern === "*") return false;
  const first = pattern[0];
  if (first === "*" || first === "?" || first === "[") return false;
  if (first === "/" || first === "\\") return false;
  if (/^[A-Za-z]:[\\/]/.test(pattern)) return false;
  if (hasHomePrefix(pattern)) return false;
  return !isAbsolute(pattern);
}

/**
 * Resolve an ancestor scope's relative path-surface patterns against the
 * scope's own directory, so they keep meaning what they meant where they
 * were written.
 *
 * Only patterns on path surfaces (`read`, `write`, `path`,
 * `external_directory`, …) are rebased — `bash` command texts, `mcp`
 * targets, and skill/tool names are matched as written regardless of which
 * scope defined them. Non-relative patterns (absolute paths, `~`/`$HOME`,
 * wildcard-led patterns like `*.env`) pass through untouched.
 *
 * Pure and non-mutating; returns the input when nothing is relative.
 */
export function rebasePermissionForDir(
  permission: FlatPermissionConfig,
  projectDir: string,
): FlatPermissionConfig {
  let changed = false;
  const rebased: FlatPermissionConfig = {};
  for (const [surface, value] of Object.entries(permission)) {
    /* eslint-disable @typescript-eslint/no-unnecessary-condition -- defensive null/type checks; config values may differ at runtime */
    if (
      typeof value === "object" &&
      value !== null &&
      PATH_SURFACES.has(surface)
    ) {
      /* eslint-enable @typescript-eslint/no-unnecessary-condition */
      const patterns: Record<string, PatternValue> = {};
      for (const [pattern, action] of Object.entries(value)) {
        const next = isRelativePathPattern(pattern)
          ? join(projectDir, pattern)
          : pattern;
        if (next !== pattern) changed = true;
        patterns[next] = action;
      }
      rebased[surface] = patterns;
    } else {
      rebased[surface] = value;
    }
  }
  return changed ? rebased : permission;
}

/**
 * {@link rebasePermissionForDir} for a whole unified config: path-surface
 * permission patterns plus `piInfrastructureReadPaths` entries.
 *
 * Pure and non-mutating; returns the input when nothing is relative.
 */
export function rebaseProjectConfigForDir(
  config: UnifiedPermissionConfig,
  projectDir: string,
): UnifiedPermissionConfig {
  const permission = config.permission
    ? rebasePermissionForDir(config.permission, projectDir)
    : undefined;
  const infra = config.piInfrastructureReadPaths;
  let rebasedInfra = infra;
  if (infra?.some((entry) => isRelativePathPattern(entry))) {
    rebasedInfra = infra.map((entry) =>
      isRelativePathPattern(entry) ? join(projectDir, entry) : entry,
    );
  }
  if (
    permission === config.permission &&
    rebasedInfra === config.piInfrastructureReadPaths
  ) {
    return config;
  }
  return { ...config, permission, piInfrastructureReadPaths: rebasedInfra };
}

/**
 * Load global and project configs from the new layout, detect legacy files,
 * merge everything, and collect issues.
 *
 * Merge order:
 * 1. Legacy global policy (if present) — lowest precedence
 * 2. Legacy extension runtime config (if present and path differs from new global)
 * 3. New global config
 * 4. Per ancestor directory, top-most first: legacy project policy (if
 *    present), then the new project config — the nearest directory to `cwd`
 *    has the highest precedence
 *
 * A project config is read from `cwd` and every parent directory's `.pi`, so
 * parent-level permissions apply to sessions in nested directories. Within an
 * ancestor scope (every scope but the nearest), relative path patterns are
 * resolved against that scope's own directory, so they keep meaning what
 * they meant where they were written; the nearest scope keeps its legacy
 * cwd-relative matching unchanged.
 *
 * Legacy files are detected and warned about. Their content is parsed with the
 * flat-format parser — legacy-format keys (defaultPolicy, tools, bash, etc.)
 * are not translated and contribute no permission rules.
 *
 * When `options.includeProjectScope` is `false`, the project-scope step (4) is
 * skipped entirely — no ancestor project config is read or merged. This gates
 * project-local config on project trust: an untrusted repository cannot loosen
 * the operator's global policy (#644). It defaults to `true`, preserving the
 * trusted / caller-agnostic path.
 */
export function loadAndMergeConfigs(
  agentDir: string,
  cwd: string,
  extensionRoot: string,
  options: { includeProjectScope?: boolean } = {},
): MergedConfigResult {
  const includeProjectScope = options.includeProjectScope !== false;
  const allIssues: string[] = [];

  const newGlobalPath = getGlobalConfigPath(agentDir);
  const legacyGlobalPolicyPath = getLegacyGlobalPolicyPath(agentDir);
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
    // Legacy files are migrated away; the move-it guidance above is the
    // actionable signal, so strict-validation issues for them are suppressed.
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
    // See above: legacy-file validation issues are suppressed.
    merged = mergeUnifiedConfigs(merged, legacy.config);
  }

  // 3. New global config
  const globalResult = loadUnifiedConfig(newGlobalPath);
  allIssues.push(...globalResult.issues);
  const globalConfig = globalResult.config;
  merged = mergeUnifiedConfigs(merged, globalConfig);

  // 4. Ancestor project chain, top-most first — skipped when the project scope
  // is withheld, so an untrusted project contributes nothing and `project`
  // reports empty.
  let projectConfig: UnifiedPermissionConfig = {};
  if (includeProjectScope) {
    const scopes = getAncestorProjectScopes(cwd);
    scopes.forEach((scope, index) => {
      const isNearest = index === scopes.length - 1;
      const rebase = (
        config: UnifiedPermissionConfig,
      ): UnifiedPermissionConfig =>
        isNearest ? config : rebaseProjectConfigForDir(config, scope.dir);
      if (existsSync(scope.legacyPolicyPath)) {
        const legacy = loadUnifiedConfig(scope.legacyPolicyPath);
        allIssues.push(
          `Legacy project policy found at '${scope.legacyPolicyPath}'. ` +
            `Move it to '${scope.configPath}':\n` +
            `  mv '${scope.legacyPolicyPath}' '${scope.configPath}'`,
        );
        // See above: legacy-file validation issues are suppressed.
        const rebased = rebase(legacy.config);
        projectConfig = mergeUnifiedConfigs(projectConfig, rebased);
        merged = mergeUnifiedConfigs(merged, rebased);
      }
      const projectResult = loadUnifiedConfig(scope.configPath);
      allIssues.push(...projectResult.issues);
      const rebased = rebase(projectResult.config);
      projectConfig = mergeUnifiedConfigs(projectConfig, rebased);
      merged = mergeUnifiedConfigs(merged, rebased);
    });
  }

  const bashFallbackIssue = detectPermissiveBashFallback(merged.permission);
  if (bashFallbackIssue) allIssues.push(bashFallbackIssue);

  const deprecatedCapsIssue = detectDeprecatedPreviewCaps(merged);
  if (deprecatedCapsIssue) allIssues.push(deprecatedCapsIssue);

  const dialogKeysIssue = detectUnusableDialogKeys(merged);
  if (dialogKeysIssue) allIssues.push(dialogKeysIssue);

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
 * Detect a config still setting one of the two superseded tool-preview caps.
 *
 * `toolInputPreviewMaxLength` and `toolTextSummaryMaxLength` bounded one
 * preview inside a prompt, never the prompt itself, which is why they never
 * bounded it; `promptMaxRows` and `promptFieldMaxWidth` supersede them
 * (ADR 0011 §5). Both stay valid in the schema so an existing config is not
 * rejected fail-closed — they are simply no longer read.
 *
 * Pure, following `detectPermissiveBashFallback`: it takes the merged config
 * and returns a message; the caller owns pushing it onto the issue list.
 */
export function detectDeprecatedPreviewCaps(
  config: UnifiedPermissionConfig,
): string | undefined {
  const set = (
    ["toolInputPreviewMaxLength", "toolTextSummaryMaxLength"] as const
  ).filter((key) => config[key] !== undefined);
  if (set.length === 0) return undefined;

  return (
    `Permission config sets ${set.map((key) => `'${key}'`).join(" and ")}, ` +
    "which is deprecated and ignored. The prompt is bounded by " +
    "'promptMaxRows' and 'promptFieldMaxWidth' instead; remove the setting."
  );
}

/**
 * Detect a `permissionDialogKeys` entry the dialog cannot honor.
 *
 * Deliberately a warning rather than a fail-closed rejection: a mistyped hotkey
 * is cosmetic, and clamping the session's `allow` rules to `ask` over one would
 * make a display preference a policy event. The decision keeps its default
 * letter, and the message names the entry, the reason, and the letter kept.
 *
 * Where that message surfaces is the caller's problem: `ConfigIssueReporter`
 * warns it at session start and on any turn whose refresh first finds it,
 * latched per issue so a persisting one is not repeated (#933).
 *
 * Pure, following {@link detectPermissiveBashFallback}: it takes the merged
 * config and returns a message; the caller owns pushing it onto the issue list.
 */
export function detectUnusableDialogKeys(
  config: DialogKeysConfig,
): string | undefined {
  const { issues } = resolveDialogKeys(config);
  return issues.length === 0 ? undefined : issues.join(" ");
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
    return validateUnifiedConfig(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      config: {},
      issues: [`Failed to read config at '${path}': ${message}`],
    };
  }
}
