import { existsSync, readFileSync } from "node:fs";
import type { ZodError } from "zod";
import { mergeFlatPermissions } from "#src/policy/permission-merge";
import type { FlatPermissionConfig, PatternValue } from "#src/types";
import { isDenyWithReason, isPermissionState } from "#src/types";
import {
  type DeclaredCommandEffects,
  foldDeclaredCommandEffects,
  NO_DECLARED_COMMAND_EFFECTS,
} from "./command-effects-config";
import {
  getGlobalConfigPath,
  getLegacyGlobalPolicyPath,
  getLegacyProjectPolicyPath,
  getProjectConfigPath,
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
 * Keys whose override replaces the base whole when the override sets them.
 *
 * The retired `yoloMode` is kept so its detector sees it. `permissionDialogKeys`
 * is replaced whole rather than merged like `shellTools`: a key map is validated
 * as a unit, so merging two individually valid maps could bind one character to
 * two decisions with neither file's own validation able to see it, and dropping
 * a base entry only restores a default letter.
 */
const OVERRIDE_WINS_KEYS = [
  "debugLog",
  "permissionReviewLog",
  "yoloMode",
  "doublePressToConfirm",
  "forwardingTimeoutMs",
  "promptTimeoutMs",
  "promptMaxRows",
  "promptFieldMaxWidth",
  "reviewLogFieldMaxWidth",
  "toolInputPreviewMaxLength",
  "toolTextSummaryMaxLength",
  "piInfrastructureReadPaths",
  "authorizerChain",
  "permissionDialogKeys",
  "promptNotifications",
] as const;

/**
 * Merge two unified configs.
 * - Each of {@link OVERRIDE_WINS_KEYS} takes the override's value when the
 *   override sets it, and the base's otherwise; a key neither sets stays absent.
 * - `shellTools` is shallow-merged by tool name.
 * - `permission` is merged by `mergeFlatPermissions` for the bash-ungated
 *   warning; the policy itself is composed per scope by the permission manager.
 * - `commandEffects` is not merged here: its scope is load provenance the
 *   review log reports, so `loadAndMergeConfigs` folds it per layer with the
 *   scope stamped (`MergedConfigResult.declaredCommandEffects`).
 */
export function mergeUnifiedConfigs(
  base: UnifiedPermissionConfig,
  override: UnifiedPermissionConfig,
): UnifiedPermissionConfig {
  const merged: UnifiedPermissionConfig = {};

  for (const key of OVERRIDE_WINS_KEYS) {
    copyOverrideWins(merged, base, override, key);
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

  // Permission: read only by detectPermissiveBashFallback
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

/** Copy `key` into `merged`, the override's value winning over the base's. */
function copyOverrideWins<K extends keyof UnifiedPermissionConfig>(
  merged: UnifiedPermissionConfig,
  base: UnifiedPermissionConfig,
  override: UnifiedPermissionConfig,
  key: K,
): void {
  const value = override[key] ?? base[key];
  if (value !== undefined) merged[key] = value;
}

export interface MergedConfigResult {
  global: UnifiedPermissionConfig;
  project: UnifiedPermissionConfig;
  merged: UnifiedPermissionConfig;
  /** Every layer's `commandEffects`, shallow-merged by command, scope stamped. */
  declaredCommandEffects: DeclaredCommandEffects;
  issues: string[];
}

/** Where a legacy-file notice sends the user to move its settings. */
const LEGACY_FILES_GUIDE =
  "https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/migration/legacy-to-flat.md#legacy-file-locations";

/**
 * Load the global and project configs, merge them, and collect issues.
 *
 * The project config overrides the global one. Each `commandEffects` block is
 * folded with its scope stamped into `MergedConfigResult.declaredCommandEffects`.
 *
 * The legacy policy files (`pi-permissions.jsonc` in the agent directory and
 * in `<cwd>/.pi/agent/`) are never read: each one present raises a notice
 * saying so and where its settings belong.
 *
 * When `options.includeProjectScope` is `false`, the project scope is skipped
 * entirely — neither the project config nor its legacy file is read or
 * noticed. This gates project-local config on project trust: an untrusted
 * repository cannot loosen the operator's global policy (#644). It defaults to
 * `true`, preserving the trusted / caller-agnostic path.
 */
export function loadAndMergeConfigs(
  agentDir: string,
  cwd: string,
  options: { includeProjectScope?: boolean } = {},
): MergedConfigResult {
  const includeProjectScope = options.includeProjectScope !== false;
  const allIssues: string[] = [];

  const newGlobalPath = getGlobalConfigPath(agentDir);
  const newProjectPath = getProjectConfigPath(cwd);
  const legacy = findLegacyPolicyFiles(
    agentDir,
    includeProjectScope ? cwd : undefined,
  );
  if (legacy.global !== undefined) {
    allIssues.push(legacyFileNotice(legacy.global, newGlobalPath));
  }
  if (legacy.project !== undefined) {
    allIssues.push(legacyFileNotice(legacy.project, newProjectPath));
  }

  const globalResult = loadUnifiedConfig(newGlobalPath);
  allIssues.push(...globalResult.issues);
  const globalConfig = globalResult.config;

  // An untrusted project contributes nothing, and `project` reports empty.
  const projectResult = includeProjectScope
    ? loadUnifiedConfig(newProjectPath)
    : { config: {}, issues: [] };
  allIssues.push(...projectResult.issues);
  const projectConfig = projectResult.config;

  const merged = mergeUnifiedConfigs(globalConfig, projectConfig);
  const declared = foldDeclaredCommandEffects(
    foldDeclaredCommandEffects(
      NO_DECLARED_COMMAND_EFFECTS,
      globalConfig.commandEffects,
      "global",
    ),
    projectConfig.commandEffects,
    "project",
  );

  const bashFallbackIssue = detectPermissiveBashFallback(merged.permission);
  if (bashFallbackIssue) allIssues.push(bashFallbackIssue);

  const deprecatedCapsIssue = detectDeprecatedPreviewCaps(merged);
  if (deprecatedCapsIssue) allIssues.push(deprecatedCapsIssue);

  const retiredYoloIssue = detectRetiredYoloMode(merged);
  if (retiredYoloIssue) allIssues.push(retiredYoloIssue);

  const dialogKeysIssue = detectUnusableDialogKeys(merged);
  if (dialogKeysIssue) allIssues.push(dialogKeysIssue);

  return {
    global: globalConfig,
    project: projectConfig,
    merged,
    declaredCommandEffects: declared,
    issues: allIssues,
  };
}

/** The legacy policy files present on disk, by the scope each used to feed. */
export interface LegacyPolicyFiles {
  global?: string;
  project?: string;
}

/**
 * Find the legacy policy files that exist.
 *
 * The project file is looked for only under a non-empty `cwd`; the caller
 * withholds `cwd` when the project scope is not to be consulted.
 */
export function findLegacyPolicyFiles(
  agentDir: string,
  cwd: string | undefined,
): LegacyPolicyFiles {
  const found: LegacyPolicyFiles = {};
  const globalPath = getLegacyGlobalPolicyPath(agentDir);
  if (existsSync(globalPath)) found.global = globalPath;
  if (cwd) {
    const projectPath = getLegacyProjectPolicyPath(cwd);
    if (existsSync(projectPath)) found.project = projectPath;
  }
  return found;
}

/** The notice for a legacy file at `path`, whose settings belong in `replacement`. */
function legacyFileNotice(path: string, replacement: string): string {
  return `'${path}' is no longer read; move its settings to '${replacement}' — see ${LEGACY_FILES_GUIDE}`;
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
 * Detect a config still setting `yoloMode`, which is no longer read.
 *
 * Auto-approve replaced it and is set per session, never in a file (ADR 0016
 * §5): a file key would reach every running session. The key stays valid in the
 * schema so an existing config is not rejected fail-closed.
 *
 * Pure, following {@link detectPermissiveBashFallback}: it takes the merged
 * config and returns a message; the caller owns pushing it onto the issue list.
 */
export function detectRetiredYoloMode(
  config: UnifiedPermissionConfig,
): string | undefined {
  if (config.yoloMode === undefined) return undefined;
  return (
    "Permission config sets 'yoloMode', which is no longer read. " +
    "Auto-approve is set per session: launch with 'pi --auto-approve' or run " +
    "'/permission-system:auto-approve on'; remove the setting."
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

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (error) {
    return unreadableConfig(path, error);
  }
  return parseUnifiedConfigText(raw, path);
}

/**
 * Parse and validate a config file's text, as {@link loadUnifiedConfig} does
 * for the file at `path`. A reader and a writer of the same file share this,
 * so they agree on which files are invalid.
 */
export function parseUnifiedConfigText(
  raw: string,
  path: string,
): UnifiedConfigLoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(raw));
  } catch (error) {
    return unreadableConfig(path, error);
  }
  return validateUnifiedConfig(parsed);
}

function unreadableConfig(
  path: string,
  error: unknown,
): UnifiedConfigLoadResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    config: {},
    issues: [`Failed to read config at '${path}': ${message}`],
  };
}
