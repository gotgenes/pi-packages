/**
 * Built-in tool input formatters registered through the public seam at startup.
 *
 * Each formatter here dogfoods `ToolInputFormatterRegistry.register` — it goes
 * through exactly the same path a third-party extension would use.
 */

import { toRecord } from "#src/value-guards";
import type {
  ToolInputFormatter,
  ToolInputFormatterRegistry,
} from "./tool-input-formatter-registry";
import { truncateInlineText } from "./tool-input-preview";

/** Maximum total length of the generated argument summary (before "with " prefix). */
const MCP_ARGS_SUMMARY_MAX_LENGTH = 160;

/** Maximum length of a single string argument value (before quoting). */
const MCP_ARG_VALUE_MAX_LENGTH = 60;

/**
 * Render a single MCP argument value as a compact, readable fragment.
 *
 * - Strings: quoted and truncated.
 * - Numbers / booleans: plain string conversion.
 * - Arrays: `[N items]`.
 * - Objects: `{…}`.
 * - Everything else: plain string conversion.
 */
function renderArgValue(value: unknown): string {
  if (typeof value === "string") {
    return `"${truncateInlineText(value, MCP_ARG_VALUE_MAX_LENGTH)}"`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.length} items]`;
  }
  if (typeof value === "object" && value !== null) {
    return "{…}";
  }
  return String(value);
}

/**
 * Format an MCP tool call's `arguments` payload as a human-readable summary.
 *
 * Returns `undefined` when `arguments` is absent or empty — the MCP ask-prompt
 * is then left unchanged (no suffix appended).
 *
 * Intended to be registered as the `"mcp"` formatter via
 * `registerBuiltinToolInputFormatters`.
 */
export const formatMcpInputForPrompt: ToolInputFormatter = (
  input: Record<string, unknown>,
): string | undefined => {
  const args = toRecord(input.arguments);
  const entries = Object.entries(args);
  if (entries.length === 0) return undefined;

  const parts = entries.map(
    ([key, value]) => `${key}: ${renderArgValue(value)}`,
  );
  const summary = truncateInlineText(
    parts.join(", "),
    MCP_ARGS_SUMMARY_MAX_LENGTH,
  );
  return `with ${summary}`;
};

/**
 * Register all built-in tool input formatters into `registry`.
 *
 * Called once from the extension factory (`index.ts`) immediately after the
 * registry is constructed, before any third-party registration can occur.
 */
export function registerBuiltinToolInputFormatters(
  registry: ToolInputFormatterRegistry,
): void {
  registry.register("mcp", formatMcpInputForPrompt);
}
