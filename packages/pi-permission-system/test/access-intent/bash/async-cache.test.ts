import { describe, expect, it, vi } from "vitest";

import { memoizeAsyncWithRetry } from "#src/access-intent/bash/async-cache";

describe("memoizeAsyncWithRetry", () => {
  it("invokes the factory once and shares the resolved value across calls", async () => {
    const factory = vi.fn<() => Promise<number>>().mockResolvedValue(42);
    const memoized = memoizeAsyncWithRetry(factory);

    const results = await Promise.all([memoized(), memoized(), memoized()]);

    expect(results).toEqual([42, 42, 42]);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("caches the same promise instance on success", async () => {
    const factory = vi.fn<() => Promise<string>>().mockResolvedValue("parser");
    const memoized = memoizeAsyncWithRetry(factory);

    await memoized();
    await memoized();

    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("surfaces the rejection to the caller each time the factory fails", async () => {
    const error = new Error("init failed");
    const factory = vi.fn<() => Promise<number>>().mockRejectedValue(error);
    const memoized = memoizeAsyncWithRetry(factory);

    await expect(memoized()).rejects.toThrow("init failed");
    await expect(memoized()).rejects.toThrow("init failed");
  });

  it("drops a rejected result so the next call re-invokes the factory", async () => {
    const factory = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue(7);
    const memoized = memoizeAsyncWithRetry(factory);

    await expect(memoized()).rejects.toThrow("transient");
    const recovered = await memoized();

    expect(recovered).toBe(7);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
