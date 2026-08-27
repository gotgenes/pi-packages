import type { ToolInputFormatterLookup } from "#src/tool-input-formatter-registry";
import {
  TOOL_INPUT_PREVIEW_MAX_LENGTH,
  TOOL_TEXT_SUMMARY_MAX_LENGTH,
} from "#src/tool-input-preview";
import {
  ToolPreviewFormatter,
  type ToolPreviewFormatterOptions,
} from "#src/tool-preview-formatter";
import type { PermissionCheckResult } from "#src/types";

/**
 * Build a `PermissionCheckResult` for a presentation unit test.
 *
 * Defaults to the package's least-privilege `ask`. The presentation modules
 * (the payload builders, `permission-prompts`, `tool-preview-formatter`) never
 * read `state`, so a file whose subject is denials or allows wraps this with
 * its own default rather than the caller repeating the whole literal.
 */
export function makePermissionCheckResult(
  toolName: string,
  overrides: Partial<PermissionCheckResult> = {},
): PermissionCheckResult {
  return {
    toolName,
    state: "ask",
    source: "tool",
    origin: "builtin",
    ...overrides,
  };
}

/**
 * Build a `ToolPreviewFormatter` at the built-in preview limits.
 *
 * Pass `options` to exercise a configured limit, and `customFormatters` to
 * exercise the registry seam ahead of the built-in switch.
 */
export function makeToolPreviewFormatter(
  options: Partial<ToolPreviewFormatterOptions> = {},
  customFormatters?: ToolInputFormatterLookup,
): ToolPreviewFormatter {
  return new ToolPreviewFormatter(
    {
      toolInputPreviewMaxLength: TOOL_INPUT_PREVIEW_MAX_LENGTH,
      toolTextSummaryMaxLength: TOOL_TEXT_SUMMARY_MAX_LENGTH,
      ...options,
    },
    customFormatters,
  );
}
