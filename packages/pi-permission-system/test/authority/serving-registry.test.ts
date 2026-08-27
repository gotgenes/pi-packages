import { afterEach, describe, expect, it, vi } from "vitest";
import {
  composeServingAnnouncers,
  getServingSessionRegistry,
  SERVING_SESSION_REGISTRY_KEY,
  ServingSessionRegistry,
} from "#src/authority/serving-registry";

/** The accessor caches on `globalThis`; drop the slot between tests. */
function clearGlobalRegistry(): void {
  const store = globalThis as Record<symbol, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- Symbol-keyed global property
  delete store[SERVING_SESSION_REGISTRY_KEY];
}

afterEach(clearGlobalRegistry);

describe("ServingSessionRegistry", () => {
  describe("isServing", () => {
    it("reports an unmarked session as not serving", () => {
      const registry = new ServingSessionRegistry();
      expect(registry.isServing("sess-1")).toBe(false);
    });

    it("reports a marked session as serving", () => {
      const registry = new ServingSessionRegistry();
      registry.markServing("sess-1");
      expect(registry.isServing("sess-1")).toBe(true);
    });

    it("does not report a sibling session as serving", () => {
      const registry = new ServingSessionRegistry();
      registry.markServing("sess-1");
      expect(registry.isServing("sess-2")).toBe(false);
    });
  });

  describe("markServing", () => {
    it("is idempotent", () => {
      const registry = new ServingSessionRegistry();
      registry.markServing("sess-1");
      registry.markServing("sess-1");
      expect(registry.servingIds()).toEqual(["sess-1"]);
    });

    it("keeps concurrent sessions independent", () => {
      const registry = new ServingSessionRegistry();
      registry.markServing("sess-1");
      registry.markServing("sess-2");
      registry.clearServing("sess-1");
      expect(registry.servingIds()).toEqual(["sess-2"]);
    });
  });

  describe("clearServing", () => {
    it("stops reporting the session as serving", () => {
      const registry = new ServingSessionRegistry();
      registry.markServing("sess-1");
      registry.clearServing("sess-1");
      expect(registry.isServing("sess-1")).toBe(false);
    });

    it("is a no-op for an unmarked session", () => {
      const registry = new ServingSessionRegistry();
      registry.clearServing("sess-1");
      expect(registry.servingIds()).toEqual([]);
    });
  });

  describe("servingIds", () => {
    it("is empty for a fresh registry", () => {
      expect(new ServingSessionRegistry().servingIds()).toEqual([]);
    });
  });
});

describe("composeServingAnnouncers", () => {
  function makeAnnouncer() {
    return { markServing: vi.fn(), clearServing: vi.fn() };
  }

  it("marks on every channel a serving session publishes to", () => {
    const first = makeAnnouncer();
    const second = makeAnnouncer();

    composeServingAnnouncers(first, second).markServing("sess-1");

    expect(first.markServing).toHaveBeenCalledExactlyOnceWith("sess-1");
    expect(second.markServing).toHaveBeenCalledExactlyOnceWith("sess-1");
  });

  it("clears on every channel", () => {
    const first = makeAnnouncer();
    const second = makeAnnouncer();

    composeServingAnnouncers(first, second).clearServing("sess-1");

    expect(first.clearServing).toHaveBeenCalledExactlyOnceWith("sess-1");
    expect(second.clearServing).toHaveBeenCalledExactlyOnceWith("sess-1");
  });

  it("is a no-op with no channels", () => {
    expect(() => {
      composeServingAnnouncers().markServing("sess-1");
    }).not.toThrow();
  });
});

describe("getServingSessionRegistry", () => {
  it("returns the same process-global instance on repeated calls", () => {
    expect(getServingSessionRegistry()).toBe(getServingSessionRegistry());
  });

  it("shares marks across callers, as separate jiti instances require", () => {
    getServingSessionRegistry().markServing("parent-session");
    expect(getServingSessionRegistry().isServing("parent-session")).toBe(true);
  });

  it("creates a fresh registry once the global slot is cleared", () => {
    const first = getServingSessionRegistry();
    first.markServing("parent-session");
    clearGlobalRegistry();
    expect(getServingSessionRegistry()).not.toBe(first);
    expect(getServingSessionRegistry().isServing("parent-session")).toBe(false);
  });
});
