/**
 * Memoize an async factory, but drop a rejected result so the next call
 * retries.
 *
 * On success the resolved promise is cached and shared across all callers (the
 * factory runs once). On failure the cache is cleared before the rejection is
 * re-thrown, so a transient init failure does not poison the memo for the
 * process lifetime — the next call re-invokes the factory.
 */
export function memoizeAsyncWithRetry<T>(
  factory: () => Promise<T>,
): () => Promise<T> {
  let cached: Promise<T> | null = null;
  return () => {
    cached ??= factory().catch((error: unknown) => {
      cached = null; // poisoned result cleared → next call re-attempts
      throw error;
    });
    return cached;
  };
}
