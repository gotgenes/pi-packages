import type { MutationSourceHandler } from "./touched-files-queue";

/**
 * Declarative spec for a custom mutation tool.
 *
 * Exactly one of `pathField`, `pathFields`, or `patchField` must be provided. Validation
 * of that constraint lives in the config loader so that schema errors
 * surface to the user with proper sourcePath attribution.
 */
export type CustomMutationToolSpec = {
  toolName: string;
  /** Single dotted path into the tool's `input` payload. */
  pathField?: string;
  /**
   * Multiple dotted paths into the tool's `input` payload. Each value
   * may resolve to a string or a string array; arrays are flattened.
   */
  pathFields?: string[];
  /** Dotted path to an OpenAI-style patch in the tool's `input` payload. */
  patchField?: string;
};

/**
 * Resolve a dotted path inside a value. Returns `undefined` when any
 * intermediate segment is missing or non-object.
 */
function resolveDottedPath(value: unknown, dottedPath: string): unknown {
  const segments = dottedPath.split(".");
  let current: unknown = value;
  for (const segment of segments) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function collectFromValue(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string") {
        out.push(entry);
      }
    }
  }
}

/**
 * Extract candidate paths from a tool's `input` payload using a spec.
 * Pure function — no normalization, no scope filtering. The queue handles
 * those centrally.
 */
export function extractPathsFromInput(
  input: unknown,
  spec: Pick<CustomMutationToolSpec, "pathField" | "pathFields" | "patchField">,
): string[] {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return [];
  }

  if (spec.patchField) {
    return extractPathsFromPatch(resolveDottedPath(input, spec.patchField));
  }

  const fields: string[] = [];
  if (spec.pathField) {
    fields.push(spec.pathField);
  }
  if (spec.pathFields) {
    fields.push(...spec.pathFields);
  }

  const results: string[] = [];
  for (const dottedPath of fields) {
    const resolved = resolveDottedPath(input, dottedPath);
    collectFromValue(resolved, results);
  }
  return results;
}

type PatchState = {
  paths: string[];
  operation?: "add" | "delete" | "update";
  moveAllowed: boolean;
};

function extractPathsFromPatch(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }

  const lines = value.trim().split(/\r?\n/);
  if (lines[0] !== "*** Begin Patch" || lines.at(-1) !== "*** End Patch") {
    return [];
  }

  const state: PatchState = { paths: [], moveAllowed: false };
  for (const line of lines.slice(1, -1)) {
    if (!consumePatchLine(line, state)) {
      return [];
    }
  }
  return state.paths;
}

function consumePatchLine(line: string, state: PatchState): boolean {
  if (line.startsWith("*** Environment ID: ") && !state.operation) {
    return true;
  }
  const header = parsePatchOperation(line);
  if (header) {
    if (!header.path) {
      return false;
    }
    state.paths.push(header.path);
    state.operation = header.operation;
    state.moveAllowed = state.operation === "update";
    return true;
  }
  if (line.startsWith("*** Move to: ")) {
    return consumePatchMove(line.slice("*** Move to: ".length), state);
  }
  if (line === "*** End of File" && state.operation === "update") {
    state.moveAllowed = false;
    return true;
  }
  state.moveAllowed = false;
  return isPatchBodyLine(line, state.operation);
}

function consumePatchMove(path: string, state: PatchState): boolean {
  if (!path || state.operation !== "update" || !state.moveAllowed) {
    return false;
  }
  state.paths[state.paths.length - 1] = path;
  state.moveAllowed = false;
  return true;
}

function parsePatchOperation(line: string) {
  const headers = [
    ["*** Add File: ", "add"],
    ["*** Delete File: ", "delete"],
    ["*** Update File: ", "update"],
  ] as const;
  for (const [prefix, operation] of headers) {
    if (line.startsWith(prefix)) {
      return { operation, path: line.slice(prefix.length) };
    }
  }
  return undefined;
}

function isPatchBodyLine(
  line: string,
  operation: "add" | "delete" | "update" | undefined,
): boolean {
  if (!operation || operation === "delete" || line.startsWith("***")) {
    return false;
  }
  return operation !== "add" || line.startsWith("+");
}

/** Build a single MutationSourceHandler from a spec. */
export function createCustomToolHandler(
  spec: CustomMutationToolSpec,
): MutationSourceHandler {
  return (toolName, payload) => {
    if (toolName !== spec.toolName) {
      return [];
    }
    return extractPathsFromInput(payload, spec);
  };
}

/** Build handlers for a list of specs, preserving order. */
export function createCustomToolHandlers(
  specs: CustomMutationToolSpec[],
): MutationSourceHandler[] {
  return specs.map(createCustomToolHandler);
}

/**
 * Parse a payload received on the EventBus `autoformat:touched` channel.
 * Accepts `{ path: string }` or `{ paths: string[] }`. Other shapes are
 * silently ignored (channel is best-effort; we must not log on every
 * malformed emission from a peer extension).
 */
export function parseTouchedPayload(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }
  const record = value as Record<string, unknown>;
  const results: string[] = [];

  if (typeof record.path === "string" && record.path.length > 0) {
    results.push(record.path);
  }

  if (Array.isArray(record.paths)) {
    for (const entry of record.paths) {
      if (typeof entry === "string" && entry.length > 0) {
        results.push(entry);
      }
    }
  }

  return results;
}
