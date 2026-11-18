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
  /**
   * Dotted path to a Codex-style patch string in the tool's `input` payload.
   * The files the patch adds, updates, or moves to are extracted; deleted
   * files are skipped because nothing is left to format.
   */
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
  if (spec.patchField) {
    results.push(
      ...extractPathsFromPatch(resolveDottedPath(input, spec.patchField)),
    );
  }
  return results;
}

const PATCH_FILE_HEADERS = ["*** Add File: ", "*** Update File: "];
const PATCH_MOVE_HEADER = "*** Move to: ";

/**
 * Scan a Codex-style patch for the files it leaves behind. Only successful
 * tool results reach this, so the tool has already accepted the patch; a
 * header scan is enough. Lines are matched untrimmed because hunk content
 * lines always start with `+`, `-`, or a space, so quoted headers never match.
 */
function extractPathsFromPatch(patch: unknown): string[] {
  if (typeof patch !== "string") {
    return [];
  }
  const paths: string[] = [];
  for (const line of patch.split(/\r?\n/)) {
    const header = PATCH_FILE_HEADERS.find((prefix) => line.startsWith(prefix));
    if (header) {
      paths.push(line.slice(header.length).trim());
    } else if (line.startsWith(PATCH_MOVE_HEADER) && paths.length > 0) {
      paths[paths.length - 1] = line.slice(PATCH_MOVE_HEADER.length).trim();
    }
  }
  return paths;
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
