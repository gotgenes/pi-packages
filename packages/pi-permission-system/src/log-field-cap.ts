/**
 * The permission review log's width bound (ADR 0011 §6).
 *
 * The log renders the prompt payload under its own configured limits, and this
 * is the limit: every string it writes is narrowed to a configured width. The
 * bound is applied at `writeLine`, the single place a log line is produced, so
 * a write path cannot be added that escapes it — the same discipline redaction
 * already has there.
 *
 * A cap is not redaction, and the two must not be conflated
 * (`docs/decisions/0010-permission-log-secret-exposure.md`). This narrows by
 * length alone and never reads a value to decide what to shorten; redaction
 * masks a value because of the key name it is bound to, and still does, so a
 * sensitive-keyed value is masked whole however long it was.
 */

/**
 * The width when the operator configures none.
 *
 * Not a new number: it is the bound that already governed `toolInputPreview`,
 * promoted from one field to every field so the log has one limit rather than
 * one limit and an unbounded remainder.
 */
export const DEFAULT_REVIEW_LOG_FIELD_MAX_WIDTH = 1000;

/** The two-field shape this module reads off the extension config. */
export interface ReviewLogWidthConfig {
  readonly reviewLogFieldMaxWidth?: number;
}

/** The configured review-log field width, or the built-in default. */
export function resolveReviewLogFieldWidth(
  config: ReviewLogWidthConfig,
): number {
  return config.reviewLogFieldMaxWidth ?? DEFAULT_REVIEW_LOG_FIELD_MAX_WIDTH;
}

/**
 * Narrow every string in a log-detail record to `maxWidth`.
 *
 * Recurses through plain objects and arrays so a nested detail is bounded too,
 * and touches strings only — a number, a boolean, or a null passes through as
 * it was. A shortened value is marked with a bare ellipsis, the same marker the
 * dialog uses: a character count is a number the reader cannot act on
 * (ADR 0011 §4).
 */
export function capLogFieldWidths<T>(details: T, maxWidth: number): T {
  return capValue(details, maxWidth) as T;
}

function capValue(value: unknown, maxWidth: number): unknown {
  if (typeof value === "string") {
    return value.length <= maxWidth
      ? value
      : `${value.slice(0, maxWidth)}\u2026`;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => capValue(entry, maxWidth));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        capValue(entry, maxWidth),
      ]),
    );
  }
  return value;
}

/**
 * Whether a value is a record this cap should descend into.
 *
 * A class instance (a `Date`, an `Error`) is left alone: rebuilding it as a
 * plain object would change what the writer serializes, and the cap's job is
 * to shorten strings, not to reshape a value.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
