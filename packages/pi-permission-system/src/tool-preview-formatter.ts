import { classifyToolKind, isMcpCheck } from "./access-intent/tool-kind";
import type { ToolInputFormatterLookup } from "./tool-input-formatter-registry";
import {
  serializeRedactedToolInputPreview,
  serializeToolInputPreview,
  TOOL_INPUT_PREVIEW_MAX_LENGTH,
  TOOL_TEXT_SUMMARY_MAX_LENGTH,
  truncateInlineText,
} from "./tool-input-preview";
import {
  formatEditInputForPrompt,
  formatReadInputForPrompt,
  formatWriteInputForPrompt,
  getPromptPath,
} from "./tool-input-prompt-formatters";
import type { PermissionCheckResult } from "./types";
import { getNonEmptyString, toRecord } from "./value-guards";

export interface ToolPreviewFormatterOptions {
  toolInputPreviewMaxLength: number;
  toolTextSummaryMaxLength: number;
}

/**
 * The built-in `ToolPreviewFormatterOptions`.
 *
 * Takes no config: `toolInputPreviewMaxLength` and `toolTextSummaryMaxLength`
 * are subsumed by the renderer budgets (`promptMaxRows` / `promptFieldMaxWidth`,
 * ADR 0011 §5), so an operator's values no longer take effect. The constants
 * remain because they still shape a *prompt* preview; what the review log
 * persists is bounded by `reviewLogFieldMaxWidth` at the writer instead.
 */
export function resolveToolPreviewLimits(): ToolPreviewFormatterOptions {
  return {
    toolInputPreviewMaxLength: TOOL_INPUT_PREVIEW_MAX_LENGTH,
    toolTextSummaryMaxLength: TOOL_TEXT_SUMMARY_MAX_LENGTH,
  };
}

/**
 * Formats tool inputs for permission prompts and review logs.
 *
 * Accepts configurable limits in its constructor — the single injection
 * point for preview-length configuration (#266).
 */
export class ToolPreviewFormatter {
  constructor(
    private readonly options: ToolPreviewFormatterOptions,
    private readonly customFormatters?: ToolInputFormatterLookup,
  ) {}

  // ── Prompt formatting ───────────────────────────────────────────────────

  /**
   * Collapse whitespace, trim, and truncate a string to fit inline.
   * An explicit `maxLength` overrides the constructor default.
   */
  sanitizeInlineText(value: string, maxLength?: number): string {
    const limit = maxLength ?? this.options.toolTextSummaryMaxLength;
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized ? truncateInlineText(normalized, limit) : "empty text";
  }

  /** Serialize `input` to inline JSON and truncate at `toolInputPreviewMaxLength`. */
  formatJsonInputForPrompt(input: unknown): string {
    const inline = serializeToolInputPreview(input);
    return inline
      ? `with input ${truncateInlineText(inline, this.options.toolInputPreviewMaxLength)}`
      : "";
  }

  /** Format search-tool (grep/find/ls) input for a permission prompt. */
  formatSearchInputForPrompt(
    toolName: string,
    input: Record<string, unknown>,
  ): string {
    const parts: string[] = [];
    const path = getPromptPath(input);
    const pattern = getNonEmptyString(input.pattern);
    const glob = getNonEmptyString(input.glob);

    if (pattern) {
      parts.push(`pattern '${this.sanitizeInlineText(pattern)}'`);
    }
    if (glob) {
      parts.push(`glob '${this.sanitizeInlineText(glob)}'`);
    }
    if (path) {
      parts.push(`path '${path}'`);
    } else if (
      toolName === "find" ||
      toolName === "grep" ||
      toolName === "ls"
    ) {
      parts.push("current working directory");
    }

    return parts.length > 0 ? `for ${parts.join(", ")}` : "";
  }

  /**
   * Format any tool input for display in a permission ask-prompt.
   *
   * Dispatches to the appropriate pure formatter for known tools
   * and falls back to inline JSON for everything else.
   */
  formatToolInputForPrompt(toolName: string, input: unknown): string {
    const inputRecord = toRecord(input);

    const custom = this.customFormatters?.get(toolName);
    if (custom) {
      const rendered = custom(inputRecord);
      if (rendered !== undefined) {
        return rendered;
      }
    }

    switch (toolName) {
      case "edit":
        return formatEditInputForPrompt(inputRecord);
      case "write":
        return formatWriteInputForPrompt(inputRecord);
      case "read":
        return formatReadInputForPrompt(inputRecord);
      case "find":
      case "grep":
      case "ls":
        return this.formatSearchInputForPrompt(toolName, inputRecord);
      case "mcp":
        // The MCP target is already a request fact on the prompt payload.
        // When no custom formatter is registered (or it declines), produce no
        // additional preview rather than leaking the raw event JSON.
        return "";
      default:
        return this.formatJsonInputForPrompt(input);
    }
  }

  // ── Log formatting ──────────────────────────────────────────────────────

  /**
   * Serialize `input` to inline JSON for the review log, masking
   * sensitive-keyed values.
   *
   * Unbounded here: the writer narrows every field it persists to
   * `reviewLogFieldMaxWidth`, so a second bound at the producer would be a
   * limit the operator cannot see or change.
   */
  formatGenericToolInputForLog(input: unknown): string | undefined {
    const inline = serializeRedactedToolInputPreview(input);
    return inline ? `input ${inline}` : undefined;
  }

  /** Derive a loggable input preview string for the review log. */
  getToolInputPreviewForLog(
    result: PermissionCheckResult,
    input: unknown,
    pathBearingTools: ReadonlySet<string>,
  ): string | undefined {
    if (classifyToolKind(result.toolName) === "bash" || isMcpCheck(result)) {
      return undefined;
    }

    if (pathBearingTools.has(result.toolName)) {
      return this.formatToolInputForPrompt(result.toolName, input) || undefined;
    }

    return this.formatGenericToolInputForLog(input);
  }

  /** Build the structured log context object for a permission review log entry. */
  getPermissionLogContext(
    result: PermissionCheckResult,
    input: unknown,
    pathBearingTools: ReadonlySet<string>,
  ): {
    command?: string;
    target?: string;
    toolInputPreview?: string;
    origin?: string;
  } {
    return {
      command: result.command,
      target: result.target,
      toolInputPreview: this.getToolInputPreviewForLog(
        result,
        input,
        pathBearingTools,
      ),
      origin: result.origin,
    };
  }
}
