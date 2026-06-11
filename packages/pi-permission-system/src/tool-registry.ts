import { getNonEmptyString, toRecord } from "./common";

/** Narrow interface for the Pi tool API subset used by handler classes. */
export interface ToolRegistry {
  getAll(): unknown[];
  getActive(): unknown[];
  setActive(names: string[]): void;
}

export type ToolRegistrationCheckResult =
  | {
      status: "missing-tool-name";
    }
  | {
      status: "registered";
      requestedToolName: string;
      normalizedToolName: string;
    }
  | {
      status: "unregistered";
      requestedToolName: string;
      normalizedToolName: string;
      availableToolNames: string[];
    };

function normalizeToolName(
  toolName: string,
  aliases: Record<string, string>,
): string {
  return aliases[toolName] || toolName;
}

function buildReverseAliases(
  aliases: Record<string, string>,
): Map<string, string[]> {
  const reverse = new Map<string, string[]>();

  for (const [alias, canonical] of Object.entries(aliases)) {
    const existing = reverse.get(canonical) ?? [];
    if (!existing.includes(alias)) {
      existing.push(alias);
    }
    reverse.set(canonical, existing);
  }

  return reverse;
}

function addToolNameVariants(
  value: string,
  names: Set<string>,
  aliases: Record<string, string>,
  reverseAliases: ReadonlyMap<string, readonly string[]>,
): void {
  names.add(value);

  const normalized = normalizeToolName(value, aliases);
  names.add(normalized);

  const canonicalFromAlias = aliases[value];
  if (canonicalFromAlias) {
    names.add(canonicalFromAlias);
  }

  const aliasValues = reverseAliases.get(value);
  if (aliasValues) {
    for (const alias of aliasValues) {
      names.add(alias);
    }
  }

  const aliasValuesForNormalized = reverseAliases.get(normalized);
  if (aliasValuesForNormalized) {
    for (const alias of aliasValuesForNormalized) {
      names.add(alias);
    }
  }
}

export function getToolNameFromValue(value: unknown): string | null {
  const direct = getNonEmptyString(value);
  if (direct) {
    return direct;
  }

  const record = toRecord(value);
  const candidates = [record.toolName, record.name, record.tool];

  for (const candidate of candidates) {
    const stringValue = getNonEmptyString(candidate);
    if (stringValue) {
      return stringValue;
    }
  }

  return null;
}

export function checkRequestedToolRegistration(
  requestedToolName: string | null,
  registeredTools: readonly unknown[],
  aliases: Record<string, string> = {},
): ToolRegistrationCheckResult {
  const requested = getNonEmptyString(requestedToolName);
  if (!requested) {
    return {
      status: "missing-tool-name",
    };
  }

  const normalizedToolName = normalizeToolName(requested, aliases);
  const reverseAliases = buildReverseAliases(aliases);

  const registeredLookup = new Set<string>();
  const availableToolNames = new Set<string>();

  for (const tool of registeredTools) {
    const name = getToolNameFromValue(tool);
    if (!name) {
      continue;
    }

    availableToolNames.add(name);
    addToolNameVariants(name, registeredLookup, aliases, reverseAliases);
  }

  const isRegistered =
    registeredLookup.has(requested) || registeredLookup.has(normalizedToolName);

  if (isRegistered) {
    return {
      status: "registered",
      requestedToolName: requested,
      normalizedToolName,
    };
  }

  return {
    status: "unregistered",
    requestedToolName: requested,
    normalizedToolName,
    availableToolNames: [...availableToolNames].sort((a, b) =>
      a.localeCompare(b),
    ),
  };
}
