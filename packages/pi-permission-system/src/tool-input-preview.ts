import { safeJsonStringify } from "./json-safe-stringify";
import { redactedJsonStringify } from "./log-redaction";

export const TOOL_INPUT_PREVIEW_MAX_LENGTH = 200;
export const TOOL_TEXT_SUMMARY_MAX_LENGTH = 80;

export function truncateInlineText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

export function countTextLines(value: string): number {
  if (!value) {
    return 0;
  }

  return value.split(/\r\n|\r|\n/).length;
}

export function formatCount(
  value: number,
  singular: string,
  plural: string,
): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

/** Serialize tool input for display in a permission prompt, unredacted. */
export function serializeToolInputPreview(input: unknown): string {
  return normalizeSerializedPreview(safeJsonStringify(input));
}

/**
 * Serialize tool input for the review log, masking sensitive-keyed values.
 *
 * The log path needs its own entry point because the input is flattened to a
 * string here — by the time it reaches the JSONL writer its keys are gone, so
 * that boundary's redaction pass can no longer see them.
 */
export function serializeRedactedToolInputPreview(input: unknown): string {
  return normalizeSerializedPreview(redactedJsonStringify(input));
}

function normalizeSerializedPreview(serialized: string | undefined): string {
  if (!serialized || serialized === "{}" || serialized === "null") {
    return "";
  }

  return serialized.replace(/\s+/g, " ").trim();
}
