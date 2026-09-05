/**
 * JSON serialization that survives the values a permission log actually
 * carries: `Error` instances, `bigint`s, and object graphs with cycles.
 *
 * Lives apart from the JSONL writer because both the log path and the
 * permission-prompt path serialize tool input, and only one of them redacts.
 */

/**
 * Rewrites a value before the standard JSON-safe handling runs.
 * Returning a replacement short-circuits nothing — the replacement itself
 * flows through the `Error` / `bigint` / cycle handling below.
 */
export type JsonValueTransform = (key: string, value: unknown) => unknown;

/**
 * Build a `JSON.stringify` replacer. Each call owns a fresh `seen` set, so a
 * replacer must not be reused across `stringify` calls.
 */
export function createJsonSafeReplacer(
  transform?: JsonValueTransform,
): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>();

  return (key: string, rawValue: unknown): unknown => {
    const value = transform ? transform(key, rawValue) : rawValue;

    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    }

    if (typeof value === "bigint") {
      return value.toString();
    }

    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return "[Circular]";
      }
      seen.add(value);
    }

    return value;
  };
}

/** Serialize `value` to JSON, tolerating errors, bigints, and cycles. */
export function safeJsonStringify(value: unknown): string | undefined {
  return JSON.stringify(value, createJsonSafeReplacer());
}
