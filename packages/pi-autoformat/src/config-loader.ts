import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { BUILTIN_FORMATTERS } from "./builtin-formatters";
import type { CustomMutationToolSpec } from "./custom-mutation-tools";
import type { FormatScopeSetting } from "./format-scope";
import {
  type AutoformatConfig,
  createFormatterConfig,
  DEFAULT_FORMATTER_CONFIG,
  type EventBusMutationChannelConfig,
  type FormatterOutputReportingConfig,
  type UserFormatterConfig,
} from "./formatter-config";
import type {
  ChainStep,
  FallbackChainStep,
  FormatterDefinition,
} from "./formatter-registry";

// Pi's built-in tool names. Declaring any of these in customMutationTools is
// a configuration mistake: write/edit are already covered, bash has its own
// detection path (see plan 0004), and the rest do not mutate files.
const BUILTIN_TOOL_NAMES = new Set([
  "bash",
  "edit",
  "write",
  "read",
  "grep",
  "find",
  "ls",
]);

import type {
  ShellMutationDetectionConfig,
  WrapperConfig,
} from "./shell-mutation-detector";

export const AUTOFORMAT_EXTENSION_ID = "pi-autoformat";
export const AUTOFORMAT_CONFIG_FILE_NAME = "config.json";

export type ConfigValidationIssue = {
  path: string;
  message: string;
  sourcePath?: string;
};

export type ValidateConfigResult = {
  config: UserFormatterConfig;
  issues: ConfigValidationIssue[];
};

export type LoadConfigResult = {
  config: AutoformatConfig;
  globalConfigPath: string;
  projectConfigPath: string;
  issues: ConfigValidationIssue[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pushIssue(
  issues: ConfigValidationIssue[],
  path: string,
  message: string,
  sourcePath?: string,
): void {
  issues.push({ path, message, sourcePath });
}

function validateCommandTimeoutMs(
  value: unknown,
  issues: ConfigValidationIssue[],
  sourcePath?: string,
): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  pushIssue(
    issues,
    "commandTimeoutMs",
    "Expected a positive integer.",
    sourcePath,
  );
  return undefined;
}

function validateBooleanField(
  fieldPath: string,
  value: unknown,
  issues: ConfigValidationIssue[],
  sourcePath?: string,
): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  pushIssue(issues, fieldPath, "Expected a boolean.", sourcePath);
  return undefined;
}

function validateStringArray(
  fieldPath: string,
  value: unknown,
  issues: ConfigValidationIssue[],
  sourcePath?: string,
): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    pushIssue(
      issues,
      fieldPath,
      "Expected a non-empty array of strings.",
      sourcePath,
    );
    return undefined;
  }

  const normalized: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const entry = value[index];
    if (typeof entry !== "string" || entry.length === 0) {
      pushIssue(
        issues,
        `${fieldPath}[${index}]`,
        "Expected a non-empty string.",
        sourcePath,
      );
      return undefined;
    }
    normalized.push(entry);
  }

  return normalized;
}

function validateEnvironment(
  fieldPath: string,
  value: unknown,
  issues: ConfigValidationIssue[],
  sourcePath?: string,
): Record<string, string> | undefined {
  if (!isRecord(value)) {
    pushIssue(
      issues,
      fieldPath,
      "Expected an object with string values.",
      sourcePath,
    );
    return undefined;
  }

  const environment: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      pushIssue(
        issues,
        `${fieldPath}.${key}`,
        "Expected a string value.",
        sourcePath,
      );
      return undefined;
    }
    environment[key] = entry;
  }

  return environment;
}

function validateFormatterDefinition(
  formatterName: string,
  value: unknown,
  issues: ConfigValidationIssue[],
  sourcePath?: string,
): FormatterDefinition | undefined {
  const fieldPath = `formatters.${formatterName}`;
  if (!isRecord(value)) {
    pushIssue(issues, fieldPath, "Expected an object.", sourcePath);
    return undefined;
  }

  const definition: Partial<FormatterDefinition> = {};
  let commandProvided = false;

  for (const [key, entry] of Object.entries(value)) {
    if (key === "command") {
      commandProvided = true;
      const command = validateStringArray(
        `${fieldPath}.command`,
        entry,
        issues,
        sourcePath,
      );
      if (command) {
        const offendingIndex = command.findIndex((arg) =>
          arg.includes("$FILE"),
        );
        if (offendingIndex >= 0) {
          pushIssue(
            issues,
            `${fieldPath}.command`,
            "$FILE substitution is no longer supported. Remove $FILE; file paths are appended to the command automatically. See docs/configuration.md.",
            sourcePath,
          );
        } else {
          definition.command = command;
        }
      }
      continue;
    }

    if (key === "extensions") {
      pushIssue(
        issues,
        `${fieldPath}.extensions`,
        "Deprecated. Remove this field; dispatch is driven by `chains`. The value is ignored.",
        sourcePath,
      );
      continue;
    }

    if (key === "environment") {
      definition.environment = validateEnvironment(
        `${fieldPath}.environment`,
        entry,
        issues,
        sourcePath,
      );
      continue;
    }

    if (key === "disabled") {
      definition.disabled = validateBooleanField(
        `${fieldPath}.disabled`,
        entry,
        issues,
        sourcePath,
      );
      continue;
    }

    pushIssue(
      issues,
      `${fieldPath}.${key}`,
      "Unknown formatter property.",
      sourcePath,
    );
  }

  if (!definition.command) {
    if (!commandProvided) {
      pushIssue(
        issues,
        `${fieldPath}.command`,
        "Missing required property.",
        sourcePath,
      );
    }
    return undefined;
  }

  const resolved: FormatterDefinition = {
    command: definition.command,
  };
  if (definition.environment !== undefined) {
    resolved.environment = definition.environment;
  }
  if (definition.disabled !== undefined) {
    resolved.disabled = definition.disabled;
  }
  return resolved;
}

function validateFormatters(
  value: unknown,
  issues: ConfigValidationIssue[],
  sourcePath?: string,
): Record<string, FormatterDefinition> | undefined {
  if (!isRecord(value)) {
    pushIssue(issues, "formatters", "Expected an object.", sourcePath);
    return undefined;
  }

  const formatters: Record<string, FormatterDefinition> = {};
  for (const [formatterName, formatterValue] of Object.entries(value)) {
    if (Object.hasOwn(BUILTIN_FORMATTERS, formatterName)) {
      pushIssue(
        issues,
        `formatters.${formatterName}`,
        `Shadows the built-in "${formatterName}" formatter. The user-declared definition will be used; remove this entry to fall back to the built-in.`,
        sourcePath,
      );
    }
    const definition = validateFormatterDefinition(
      formatterName,
      formatterValue,
      issues,
      sourcePath,
    );
    if (definition) {
      formatters[formatterName] = definition;
    }
  }

  return formatters;
}

function validateFallbackStep(
  fieldPath: string,
  value: Record<string, unknown>,
  issues: ConfigValidationIssue[],
  sourcePath?: string,
  knownFormatterNames?: Set<string>,
): FallbackChainStep | undefined {
  let fallbackValue: unknown;
  let hasUnknown = false;
  for (const [key, entry] of Object.entries(value)) {
    if (key === "fallback") {
      fallbackValue = entry;
      continue;
    }
    pushIssue(
      issues,
      `${fieldPath}.${key}`,
      "Unknown fallback step property.",
      sourcePath,
    );
    hasUnknown = true;
  }

  if (!Array.isArray(fallbackValue) || fallbackValue.length === 0) {
    pushIssue(
      issues,
      `${fieldPath}.fallback`,
      "Expected a non-empty array of formatter names.",
      sourcePath,
    );
    return undefined;
  }

  const names: string[] = [];
  let nameError = false;
  for (let index = 0; index < fallbackValue.length; index += 1) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const entry = fallbackValue[index];
    if (typeof entry !== "string" || entry.length === 0) {
      pushIssue(
        issues,
        `${fieldPath}.fallback[${index}]`,
        "Expected a non-empty string.",
        sourcePath,
      );
      return undefined;
    }
    if (knownFormatterNames && !knownFormatterNames.has(entry)) {
      pushIssue(
        issues,
        `${fieldPath}.fallback[${index}]`,
        `Unknown formatter name "${entry}". Declare it in \`formatters\` or remove it from the fallback group.`,
        sourcePath,
      );
      nameError = true;
      continue;
    }
    names.push(entry);
  }

  if (hasUnknown || nameError) {
    return undefined;
  }

  return { fallback: names };
}

function validateChainStep(
  fieldPath: string,
  value: unknown,
  issues: ConfigValidationIssue[],
  sourcePath?: string,
  knownFormatterNames?: Set<string>,
): ChainStep | undefined {
  if (typeof value === "string") {
    if (value.length === 0) {
      pushIssue(
        issues,
        fieldPath,
        "Expected a non-empty formatter name.",
        sourcePath,
      );
      return undefined;
    }
    if (knownFormatterNames && !knownFormatterNames.has(value)) {
      pushIssue(
        issues,
        fieldPath,
        `Unknown formatter name "${value}". Declare it in \`formatters\` or remove it from \`chains\`.`,
        sourcePath,
      );
      return undefined;
    }
    return value;
  }

  if (isRecord(value)) {
    return validateFallbackStep(
      fieldPath,
      value,
      issues,
      sourcePath,
      knownFormatterNames,
    );
  }

  pushIssue(
    issues,
    fieldPath,
    'Expected a formatter name (string) or a fallback group ({ "fallback": [name, ...] }).',
    sourcePath,
  );
  return undefined;
}

function validateChains(
  value: unknown,
  issues: ConfigValidationIssue[],
  sourcePath: string | undefined,
  knownFormatterNames: Set<string>,
): Record<string, ChainStep[]> | undefined {
  if (!isRecord(value)) {
    pushIssue(issues, "chains", "Expected an object.", sourcePath);
    return undefined;
  }

  const chains: Record<string, ChainStep[]> = {};
  for (const [extension, chainValue] of Object.entries(value)) {
    if (extension !== "*" && !extension.startsWith(".")) {
      pushIssue(
        issues,
        `chains.${extension}`,
        'Expected a file extension key beginning with "." or the wildcard "*".',
        sourcePath,
      );
      continue;
    }

    if (!Array.isArray(chainValue) || chainValue.length === 0) {
      pushIssue(
        issues,
        `chains.${extension}`,
        "Expected a non-empty array of chain steps.",
        sourcePath,
      );
      continue;
    }

    const steps: ChainStep[] = [];
    let stepError = false;
    for (let index = 0; index < chainValue.length; index += 1) {
      const step = validateChainStep(
        `chains.${extension}[${index}]`,
        chainValue[index],
        issues,
        sourcePath,
        knownFormatterNames,
      );
      if (!step) {
        stepError = true;
        continue;
      }
      steps.push(step);
    }

    if (stepError) {
      continue;
    }
    // The wildcard key is preserved verbatim; only extensions are lowercased.
    chains[extension === "*" ? "*" : extension.toLowerCase()] = steps;
  }

  return chains;
}

function validateFormatScope(
  value: unknown,
  issues: ConfigValidationIssue[],
  sourcePath?: string,
): FormatScopeSetting | undefined {
  if (value === "repoRoot" || value === "cwd") {
    return value;
  }
  if (Array.isArray(value)) {
    const result: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const entry = value[index];
      if (typeof entry !== "string" || entry.length === 0) {
        pushIssue(
          issues,
          `formatScope[${index}]`,
          "Expected a non-empty string.",
          sourcePath,
        );
        return undefined;
      }
      result.push(entry);
    }
    return result;
  }
  pushIssue(
    issues,
    "formatScope",
    'Expected "repoRoot", "cwd", or an array of paths.',
    sourcePath,
  );
  return undefined;
}

function validateWrapper(
  fieldPath: string,
  value: unknown,
  issues: ConfigValidationIssue[],
  sourcePath?: string,
): WrapperConfig | undefined {
  if (!isRecord(value)) {
    pushIssue(issues, fieldPath, "Expected an object.", sourcePath);
    return undefined;
  }
  const wrapper: Partial<WrapperConfig> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "prefix") {
      if (typeof entry !== "string" || entry.length === 0) {
        pushIssue(
          issues,
          `${fieldPath}.prefix`,
          "Expected a non-empty string.",
          sourcePath,
        );
        return undefined;
      }
      wrapper.prefix = entry;
      continue;
    }
    if (key === "outputFormat") {
      if (entry !== "lines") {
        pushIssue(
          issues,
          `${fieldPath}.outputFormat`,
          'Expected "lines".',
          sourcePath,
        );
        return undefined;
      }
      wrapper.outputFormat = entry;
      continue;
    }
    pushIssue(
      issues,
      `${fieldPath}.${key}`,
      "Unknown wrapper property.",
      sourcePath,
    );
  }
  if (!wrapper.prefix) {
    pushIssue(
      issues,
      `${fieldPath}.prefix`,
      "Missing required property.",
      sourcePath,
    );
    return undefined;
  }
  return { prefix: wrapper.prefix, outputFormat: wrapper.outputFormat };
}

function validateShellMutationDetection(
  value: unknown,
  issues: ConfigValidationIssue[],
  sourcePath?: string,
): Partial<ShellMutationDetectionConfig> | undefined {
  if (!isRecord(value)) {
    pushIssue(
      issues,
      "shellMutationDetection",
      "Expected an object.",
      sourcePath,
    );
    return undefined;
  }
  const result: Partial<ShellMutationDetectionConfig> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "enabled") {
      const enabled = validateBooleanField(
        "shellMutationDetection.enabled",
        entry,
        issues,
        sourcePath,
      );
      if (enabled !== undefined) {
        result.enabled = enabled;
      }
      continue;
    }
    if (key === "argumentParsing") {
      const argumentParsing = validateBooleanField(
        "shellMutationDetection.argumentParsing",
        entry,
        issues,
        sourcePath,
      );
      if (argumentParsing !== undefined) {
        result.argumentParsing = argumentParsing;
      }
      continue;
    }
    if (key === "snapshotGlobs") {
      if (!Array.isArray(entry)) {
        pushIssue(
          issues,
          "shellMutationDetection.snapshotGlobs",
          "Expected an array of strings.",
          sourcePath,
        );
        continue;
      }
      const globs: string[] = [];
      let valid = true;
      for (let index = 0; index < entry.length; index += 1) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const glob = entry[index];
        if (typeof glob !== "string" || glob.length === 0) {
          pushIssue(
            issues,
            `shellMutationDetection.snapshotGlobs[${index}]`,
            "Expected a non-empty string.",
            sourcePath,
          );
          valid = false;
          break;
        }
        globs.push(glob);
      }
      if (valid) {
        result.snapshotGlobs = globs;
      }
      continue;
    }
    if (key === "wrappers") {
      if (!Array.isArray(entry)) {
        pushIssue(
          issues,
          "shellMutationDetection.wrappers",
          "Expected an array.",
          sourcePath,
        );
        continue;
      }
      const wrappers: WrapperConfig[] = [];
      let valid = true;
      for (let index = 0; index < entry.length; index += 1) {
        const wrapper = validateWrapper(
          `shellMutationDetection.wrappers[${index}]`,
          entry[index],
          issues,
          sourcePath,
        );
        if (!wrapper) {
          valid = false;
          break;
        }
        wrappers.push(wrapper);
      }
      if (valid) {
        result.wrappers = wrappers;
      }
      continue;
    }
    pushIssue(
      issues,
      `shellMutationDetection.${key}`,
      "Unknown property.",
      sourcePath,
    );
  }
  return result;
}

function validateCustomMutationToolEntry(
  fieldPath: string,
  value: unknown,
  issues: ConfigValidationIssue[],
  sourcePath: string | undefined,
  seenToolNames: Set<string>,
): CustomMutationToolSpec | undefined {
  if (!isRecord(value)) {
    pushIssue(issues, fieldPath, "Expected an object.", sourcePath);
    return undefined;
  }

  let toolName: string | undefined;
  let pathField: string | undefined;
  let pathFields: string[] | undefined;
  let patchField: string | undefined;
  let hasUnknown = false;

  for (const [key, entry] of Object.entries(value)) {
    if (key === "toolName") {
      if (typeof entry !== "string" || entry.length === 0) {
        pushIssue(
          issues,
          `${fieldPath}.toolName`,
          "Expected a non-empty string.",
          sourcePath,
        );
        return undefined;
      }
      if (BUILTIN_TOOL_NAMES.has(entry)) {
        pushIssue(
          issues,
          `${fieldPath}.toolName`,
          `"${entry}" is a Pi built-in tool and cannot be declared as a custom mutation tool. Built-in mutating tools (write, edit) are already covered; others do not mutate files.`,
          sourcePath,
        );
        return undefined;
      }
      if (seenToolNames.has(entry)) {
        pushIssue(
          issues,
          `${fieldPath}.toolName`,
          `Duplicate toolName "${entry}". Each tool may only be declared once.`,
          sourcePath,
        );
        return undefined;
      }
      toolName = entry;
      continue;
    }

    if (key === "pathField") {
      if (typeof entry !== "string" || entry.length === 0) {
        pushIssue(
          issues,
          `${fieldPath}.pathField`,
          "Expected a non-empty string.",
          sourcePath,
        );
        return undefined;
      }
      pathField = entry;
      continue;
    }

    if (key === "pathFields") {
      if (!Array.isArray(entry) || entry.length === 0) {
        pushIssue(
          issues,
          `${fieldPath}.pathFields`,
          "Expected a non-empty array of strings.",
          sourcePath,
        );
        return undefined;
      }
      const collected: string[] = [];
      for (let index = 0; index < entry.length; index += 1) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const item = entry[index];
        if (typeof item !== "string" || item.length === 0) {
          pushIssue(
            issues,
            `${fieldPath}.pathFields[${index}]`,
            "Expected a non-empty string.",
            sourcePath,
          );
          return undefined;
        }
        collected.push(item);
      }
      pathFields = collected;
      continue;
    }

    if (key === "patchField") {
      if (typeof entry !== "string" || entry.length === 0) {
        pushIssue(
          issues,
          `${fieldPath}.patchField`,
          "Expected a non-empty string.",
          sourcePath,
        );
        return undefined;
      }
      patchField = entry;
      continue;
    }

    pushIssue(issues, `${fieldPath}.${key}`, "Unknown property.", sourcePath);
    hasUnknown = true;
  }

  if (hasUnknown) {
    return undefined;
  }

  if (!toolName) {
    pushIssue(
      issues,
      `${fieldPath}.toolName`,
      "Missing required property.",
      sourcePath,
    );
    return undefined;
  }

  const settingCount = [pathField, pathFields, patchField].filter(
    (setting) => setting !== undefined,
  ).length;
  if (settingCount !== 1) {
    pushIssue(
      issues,
      fieldPath,
      "Expected exactly one of `pathField`, `pathFields`, or `patchField`.",
      sourcePath,
    );
    return undefined;
  }

  seenToolNames.add(toolName);
  if (pathField !== undefined) {
    return { toolName, pathField };
  }
  if (pathFields !== undefined) {
    return { toolName, pathFields };
  }
  if (patchField !== undefined) {
    return { toolName, patchField };
  }
  return undefined;
}

function validateCustomMutationTools(
  value: unknown,
  issues: ConfigValidationIssue[],
  sourcePath?: string,
): CustomMutationToolSpec[] | undefined {
  if (!Array.isArray(value)) {
    pushIssue(
      issues,
      "customMutationTools",
      "Expected an array of mutation tool specs.",
      sourcePath,
    );
    return undefined;
  }

  const seenToolNames = new Set<string>();
  const collected: CustomMutationToolSpec[] = [];
  let hasError = false;
  for (let index = 0; index < value.length; index += 1) {
    const entry = validateCustomMutationToolEntry(
      `customMutationTools[${index}]`,
      value[index],
      issues,
      sourcePath,
      seenToolNames,
    );
    if (!entry) {
      hasError = true;
      continue;
    }
    collected.push(entry);
  }

  if (hasError) {
    return undefined;
  }
  return collected;
}

function validateFormatterOutput(
  value: unknown,
  issues: ConfigValidationIssue[],
  sourcePath?: string,
): Partial<FormatterOutputReportingConfig> | undefined {
  if (!isRecord(value)) {
    pushIssue(issues, "formatterOutput", "Expected an object.", sourcePath);
    return undefined;
  }

  const result: Partial<FormatterOutputReportingConfig> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "onFailure") {
      if (entry === "none" || entry === "stderr" || entry === "both") {
        result.onFailure = entry;
        continue;
      }
      pushIssue(
        issues,
        "formatterOutput.onFailure",
        'Expected one of "none", "stderr", or "both".',
        sourcePath,
      );
      continue;
    }
    if (key === "maxBytes" || key === "maxLines") {
      if (typeof entry === "number" && Number.isInteger(entry) && entry >= 0) {
        result[key] = entry;
        continue;
      }
      pushIssue(
        issues,
        `formatterOutput.${key}`,
        "Expected a non-negative integer.",
        sourcePath,
      );
      continue;
    }
    pushIssue(
      issues,
      `formatterOutput.${key}`,
      "Unknown property.",
      sourcePath,
    );
  }

  if (Object.keys(result).length === 0) {
    return undefined;
  }
  return result;
}

function validateEventBusMutationChannel(
  value: unknown,
  issues: ConfigValidationIssue[],
  sourcePath?: string,
): Partial<EventBusMutationChannelConfig> | undefined {
  if (!isRecord(value)) {
    pushIssue(
      issues,
      "eventBusMutationChannel",
      "Expected an object.",
      sourcePath,
    );
    return undefined;
  }

  const result: Partial<EventBusMutationChannelConfig> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "enabled") {
      const enabled = validateBooleanField(
        "eventBusMutationChannel.enabled",
        entry,
        issues,
        sourcePath,
      );
      if (enabled !== undefined) {
        result.enabled = enabled;
      }
      continue;
    }
    if (key === "channel") {
      if (typeof entry !== "string" || entry.length === 0) {
        pushIssue(
          issues,
          "eventBusMutationChannel.channel",
          "Expected a non-empty string.",
          sourcePath,
        );
        continue;
      }
      result.channel = entry;
      continue;
    }
    pushIssue(
      issues,
      `eventBusMutationChannel.${key}`,
      "Unknown property.",
      sourcePath,
    );
  }
  return result;
}

function validateConfigObject(
  value: unknown,
  sourcePath?: string,
): ValidateConfigResult {
  const issues: ConfigValidationIssue[] = [];
  const config: UserFormatterConfig = {};

  if (!isRecord(value)) {
    pushIssue(issues, "$", "Expected a JSON object.", sourcePath);
    return { config, issues };
  }

  // Two passes: validate everything except chains first so we can build the
  // known-formatter-name set (built-ins + this file's formatters) before
  // validating chains' formatter references.
  for (const [key, entry] of Object.entries(value)) {
    if (key === "$schema") {
      if (typeof entry !== "string") {
        pushIssue(issues, "$schema", "Expected a string.", sourcePath);
      }
      continue;
    }

    if (key === "formatMode") {
      pushIssue(
        issues,
        "formatMode",
        "formatMode has been removed; prompt-end formatting is now the only mode.",
        sourcePath,
      );
      continue;
    }

    if (key === "notifyAgent") {
      pushIssue(
        issues,
        "notifyAgent",
        "notifyAgent has been removed; the extension now notifies via steering messages at turn end.",
        sourcePath,
      );
      continue;
    }

    if (key === "commandTimeoutMs") {
      const commandTimeoutMs = validateCommandTimeoutMs(
        entry,
        issues,
        sourcePath,
      );
      if (commandTimeoutMs !== undefined) {
        config.commandTimeoutMs = commandTimeoutMs;
      }
      continue;
    }

    if (key === "hideSummariesInTui") {
      const hideSummariesInTui = validateBooleanField(
        "hideSummariesInTui",
        entry,
        issues,
        sourcePath,
      );
      if (hideSummariesInTui !== undefined) {
        config.hideSummariesInTui = hideSummariesInTui;
      }
      continue;
    }

    if (key === "formatters") {
      const formatters = validateFormatters(entry, issues, sourcePath);
      if (formatters) {
        config.formatters = formatters;
      }
      continue;
    }

    if (key === "chains") {
      // Defer chains until we know which formatter names are valid in this file.
      continue;
    }

    if (key === "formatScope") {
      const formatScope = validateFormatScope(entry, issues, sourcePath);
      if (formatScope !== undefined) {
        config.formatScope = formatScope;
      }
      continue;
    }

    if (key === "shellMutationDetection") {
      const detection = validateShellMutationDetection(
        entry,
        issues,
        sourcePath,
      );
      if (detection !== undefined) {
        config.shellMutationDetection = detection;
      }
      continue;
    }

    if (key === "customMutationTools") {
      const tools = validateCustomMutationTools(entry, issues, sourcePath);
      if (tools !== undefined) {
        config.customMutationTools = tools;
      }
      continue;
    }

    if (key === "formatterOutput") {
      const formatterOutput = validateFormatterOutput(
        entry,
        issues,
        sourcePath,
      );
      if (formatterOutput !== undefined) {
        config.formatterOutput = formatterOutput;
      }
      continue;
    }

    if (key === "eventBusMutationChannel") {
      const channel = validateEventBusMutationChannel(
        entry,
        issues,
        sourcePath,
      );
      if (channel !== undefined) {
        config.eventBusMutationChannel = channel;
      }
      continue;
    }

    pushIssue(issues, key, "Unknown top-level property.", sourcePath);
  }

  if ("chains" in value) {
    const knownFormatterNames = new Set<string>([
      ...Object.keys(DEFAULT_FORMATTER_CONFIG.formatters),
      ...Object.keys(config.formatters ?? {}),
      ...Object.keys(BUILTIN_FORMATTERS),
    ]);
    const chains = validateChains(
      value.chains,
      issues,
      sourcePath,
      knownFormatterNames,
    );
    if (chains) {
      config.chains = chains;
    }
  }

  return { config, issues };
}

export function validateUserFormatterConfig(
  value: unknown,
  sourcePath?: string,
): ValidateConfigResult {
  return validateConfigObject(value, sourcePath);
}

function readJsonFile(filePath: string): unknown {
  if (!existsSync(filePath)) {
    return undefined;
  }

  return JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
}

function mergeUserConfigs(
  base: UserFormatterConfig,
  overrides: UserFormatterConfig,
): UserFormatterConfig {
  return {
    commandTimeoutMs: overrides.commandTimeoutMs ?? base.commandTimeoutMs,
    hideSummariesInTui: overrides.hideSummariesInTui ?? base.hideSummariesInTui,
    formatScope: overrides.formatScope ?? base.formatScope,
    shellMutationDetection: mergeShellMutationDetection(
      base.shellMutationDetection,
      overrides.shellMutationDetection,
    ),
    // Arrays replace wholesale (consistent with formatScope, snapshotGlobs).
    customMutationTools:
      overrides.customMutationTools ?? base.customMutationTools,
    eventBusMutationChannel: mergeEventBusMutationChannel(
      base.eventBusMutationChannel,
      overrides.eventBusMutationChannel,
    ),
    formatterOutput: mergeFormatterOutput(
      base.formatterOutput,
      overrides.formatterOutput,
    ),
    formatters: {
      ...base.formatters,
      ...overrides.formatters,
    },
    chains: {
      ...base.chains,
      ...overrides.chains,
    },
  };
}

function mergeFormatterOutput(
  base: Partial<FormatterOutputReportingConfig> | undefined,
  overrides: Partial<FormatterOutputReportingConfig> | undefined,
): Partial<FormatterOutputReportingConfig> | undefined {
  if (!base && !overrides) {
    return undefined;
  }
  return { ...(base ?? {}), ...(overrides ?? {}) };
}

function mergeEventBusMutationChannel(
  base: Partial<EventBusMutationChannelConfig> | undefined,
  overrides: Partial<EventBusMutationChannelConfig> | undefined,
): Partial<EventBusMutationChannelConfig> | undefined {
  if (!base && !overrides) {
    return undefined;
  }
  return { ...(base ?? {}), ...(overrides ?? {}) };
}

function mergeShellMutationDetection(
  base: Partial<ShellMutationDetectionConfig> | undefined,
  overrides: Partial<ShellMutationDetectionConfig> | undefined,
): Partial<ShellMutationDetectionConfig> | undefined {
  if (!base && !overrides) {
    return undefined;
  }
  // Per AGENTS.md / plan: arrays replace, scalars override.
  return {
    ...(base ?? {}),
    ...(overrides ?? {}),
  };
}

export function getGlobalConfigPath(agentDir: string): string {
  return join(
    agentDir,
    "extensions",
    AUTOFORMAT_EXTENSION_ID,
    AUTOFORMAT_CONFIG_FILE_NAME,
  );
}

export function getProjectConfigPath(cwd: string): string {
  return join(
    cwd,
    ".pi",
    "extensions",
    AUTOFORMAT_EXTENSION_ID,
    AUTOFORMAT_CONFIG_FILE_NAME,
  );
}

export function loadAutoformatConfig(options: {
  cwd: string;
  agentDir: string;
}): LoadConfigResult {
  const { cwd, agentDir } = options;
  const globalConfigPath = getGlobalConfigPath(agentDir);
  const projectConfigPath = getProjectConfigPath(cwd);
  const issues: ConfigValidationIssue[] = [];

  let mergedUserConfig: UserFormatterConfig = {};

  for (const configPath of [globalConfigPath, projectConfigPath]) {
    const rawConfig = (() => {
      try {
        return readJsonFile(configPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pushIssue(issues, "$", `Failed to read config: ${message}`, configPath);
        return undefined;
      }
    })();

    if (rawConfig === undefined) {
      continue;
    }

    const validated = validateUserFormatterConfig(rawConfig, configPath);
    issues.push(...validated.issues);
    mergedUserConfig = mergeUserConfigs(mergedUserConfig, validated.config);
  }

  return {
    config: createFormatterConfig(mergedUserConfig),
    globalConfigPath,
    projectConfigPath,
    issues,
  };
}
