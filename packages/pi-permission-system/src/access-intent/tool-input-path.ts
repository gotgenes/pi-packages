import type { ToolAccessExtractorLookup } from "#src/tool-input/tool-access-extractor-registry";
import { getNonEmptyString, toRecord } from "#src/value-guards";
import { classifyToolKind } from "./tool-kind";

export function getPathBearingToolPath(
  toolName: string,
  input: unknown,
): string | null {
  if (classifyToolKind(toolName) !== "path") {
    return null;
  }

  return getNonEmptyString(toRecord(input).path);
}

/**
 * What supplied a tool call's path.
 *
 * `"convention"` covers both the built-in `input.path` / `input.arguments.path`
 * shapes and the default an unregistered extension tool falls back to — in
 * every case, nobody declared it.
 */
export type ToolPathSource =
  | "convention"
  | "local_extractor"
  | "inherited_extractor";

/** A tool call's path together with what supplied it. */
export interface ToolInputPathResult {
  path: string | null;
  source: ToolPathSource;
}

/**
 * Extract the filesystem path a tool will access, for the cross-cutting `path`
 * and `external_directory` gates.
 *
 * Unlike {@link getPathBearingToolPath} (built-in tools only), this recognizes
 * extension and MCP tools so they are no longer exempt from path gating:
 *
 * - `bash` → `null` (bash has its own token-based path gates).
 * - Built-in path-bearing tools → `input.path`.
 * - `mcp` → `input.arguments.path`.
 * - Any other tool → a registered {@link ToolAccessExtractor}'s path, else the
 *   default `input.path` convention.
 *
 * The result names what supplied the path, because an extractor resolved from
 * an ancestor node is a fact the gates record (ADR 0012 decision 1).
 */
export function getToolInputPath(
  toolName: string,
  input: unknown,
  extractors?: ToolAccessExtractorLookup,
): ToolInputPathResult {
  const record = toRecord(input);

  switch (classifyToolKind(toolName)) {
    case "bash":
      return byConvention(null);
    case "path":
      return byConvention(getNonEmptyString(record.path));
    case "mcp":
      return byConvention(getNonEmptyString(toRecord(record.arguments).path));
    case "skill":
    case "extension": {
      const custom = extractors?.resolve(toolName);
      if (custom) {
        return {
          path: getNonEmptyString(custom.extractor(record)),
          source:
            custom.origin === "inherited"
              ? "inherited_extractor"
              : "local_extractor",
        };
      }
      return byConvention(getNonEmptyString(record.path));
    }
  }
}

function byConvention(path: string | null): ToolInputPathResult {
  return { path, source: "convention" };
}
