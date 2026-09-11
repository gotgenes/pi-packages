import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForwardingManager } from "#src/authority/forwarding-manager";
import { SUBAGENT_ENV_HINT_KEYS } from "#src/authority/permission-forwarding";
import {
  type ServingAnnouncer,
  ServingSessionRegistry,
} from "#src/authority/serving-registry";

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockProcessInbox = vi.fn((): Promise<void> => Promise.resolve());
const mockReview = vi.fn();

// ── Helpers ───────────────────────────────────────────────────────────────

function makeCtx(overrides: { hasUI?: boolean; sessionId?: string } = {}) {
  return {
    hasUI: overrides.hasUI ?? true,
    sessionManager: {
      getSessionId: vi.fn().mockReturnValue(overrides.sessionId ?? "sess-1"),
    },
    cwd: "/project",
  } as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext;
}

function makeForwarder() {
  return { processInbox: mockProcessInbox };
}

/**
 * A ctx whose session id can change after `start`, as an in-place session fork
 * does — the churn that desynchronizes the announcement from the drained inbox.
 */
function makeChurningCtx(sessionId: string) {
  const getSessionId = vi.fn((): string => sessionId);
  return {
    getSessionId,
    ctx: {
      hasUI: true,
      sessionManager: { getSessionId },
      cwd: "/project",
    } as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext,
  };
}

/** A `ServingAnnouncer` whose calls can be counted, for the refresh tests. */
function makeAnnouncer() {
  return { markServing: vi.fn(), clearServing: vi.fn() };
}

function makeManager(serving: ServingAnnouncer = new ServingSessionRegistry()) {
  return new ForwardingManager({
    forwarder: makeForwarder(),
    serving,
    logger: { review: mockReview, debug: vi.fn() },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("ForwardingManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    for (const key of SUBAGENT_ENV_HINT_KEYS) {
      vi.stubEnv(key, undefined);
    }
    mockProcessInbox.mockReset();
    mockProcessInbox.mockResolvedValue(undefined);
    mockReview.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  describe("stop()", () => {
    it("is a no-op when not started", () => {
      const manager = makeManager();
      expect(() => manager.stop()).not.toThrow();
    });

    it("clears the timer and processing state after start()", async () => {
      const manager = makeManager();
      const ctx = makeCtx();
      manager.start(ctx);
      manager.stop();

      // After stop, the timer fires no more callbacks.
      mockProcessInbox.mockClear();
      await vi.advanceTimersByTimeAsync(500);
      expect(mockProcessInbox).not.toHaveBeenCalled();
    });
  });

  describe("start()", () => {
    it("does not start polling when hasUI is false", async () => {
      const manager = makeManager();
      const ctx = makeCtx({ hasUI: false });
      manager.start(ctx);

      await vi.advanceTimersByTimeAsync(500);
      expect(mockProcessInbox).not.toHaveBeenCalled();
    });

    it("stops any existing poll and does not start a new one when hasUI is false", async () => {
      const manager = makeManager();
      const uiCtx = makeCtx({ hasUI: true });
      const noUiCtx = makeCtx({ hasUI: false });

      manager.start(uiCtx);
      // Now stop the polling by calling start() with no-UI ctx.
      manager.start(noUiCtx);

      mockProcessInbox.mockClear();
      await vi.advanceTimersByTimeAsync(500);
      expect(mockProcessInbox).not.toHaveBeenCalled();
    });

    it.each(SUBAGENT_ENV_HINT_KEYS)(
      "keeps polling a UI context when %s is set",
      async (key) => {
        // Serving eligibility is `hasUI` alone. A spawner may export a marker
        // from its own root process so its children inherit it, and that root
        // must keep draining the inbox those children write into (#907).
        vi.stubEnv(key, "sess-1");
        const manager = makeManager();
        manager.start(makeCtx({ sessionId: "sess-1" }));

        await vi.advanceTimersByTimeAsync(500);
        expect(mockProcessInbox).toHaveBeenCalled();
      },
    );

    it("starts polling and calls processInbox on tick", async () => {
      const manager = makeManager();
      const ctx = makeCtx();
      manager.start(ctx);

      await vi.advanceTimersByTimeAsync(250);
      expect(mockProcessInbox).toHaveBeenCalledWith(ctx);
    });

    it("is idempotent — calling start() twice does not create a second timer", async () => {
      const manager = makeManager();
      const ctx = makeCtx();
      manager.start(ctx);
      manager.start(ctx);

      await vi.advanceTimersByTimeAsync(250);
      // Only one tick should fire per interval, not two.
      expect(mockProcessInbox).toHaveBeenCalledTimes(1);
    });

    it("updates the context when called again while already running", async () => {
      const manager = makeManager();
      const ctx1 = makeCtx({ sessionId: "sess-1" });
      const ctx2 = makeCtx({ sessionId: "sess-2" });
      manager.start(ctx1);
      manager.start(ctx2);

      await vi.advanceTimersByTimeAsync(250);
      // The process call should use the newer context.
      expect(mockProcessInbox).toHaveBeenCalledWith(ctx2);
    });

    it("skips a tick while processing is in progress", async () => {
      // Make processInbox hang so processing=true persists.
      let resolveProcess: () => void;
      mockProcessInbox.mockReturnValue(
        new Promise<void>((resolve) => {
          resolveProcess = resolve;
        }),
      );

      const manager = makeManager();
      const ctx = makeCtx();
      manager.start(ctx);

      // First tick starts processing.
      await vi.advanceTimersByTimeAsync(250);
      expect(mockProcessInbox).toHaveBeenCalledTimes(1);

      // Second tick is skipped because processing flag is still true.
      await vi.advanceTimersByTimeAsync(250);
      expect(mockProcessInbox).toHaveBeenCalledTimes(1);

      // Resolve and a third tick should fire.
      resolveProcess!();
      await vi.advanceTimersByTimeAsync(250);
      expect(mockProcessInbox).toHaveBeenCalledTimes(2);
    });
  });

  describe("serving announcement", () => {
    it("marks the polled session as serving", () => {
      const serving = new ServingSessionRegistry();
      makeManager(serving).start(makeCtx({ sessionId: "sess-1" }));

      expect(serving.servingIds()).toEqual(["sess-1"]);
    });

    it("logs the polled session id once per session", () => {
      const manager = makeManager();
      const ctx = makeCtx({ sessionId: "sess-1" });
      manager.start(ctx);
      manager.start(ctx);

      expect(mockReview).toHaveBeenCalledExactlyOnceWith(
        "forwarded_permission.serving_started",
        { sessionId: "sess-1" },
      );
    });

    it("clears the mark on stop()", () => {
      const serving = new ServingSessionRegistry();
      const manager = makeManager(serving);
      manager.start(makeCtx({ sessionId: "sess-1" }));
      manager.stop();

      expect(serving.servingIds()).toEqual([]);
    });

    it("logs serving_stopped only when it was serving", () => {
      const manager = makeManager();
      manager.stop();
      expect(mockReview).not.toHaveBeenCalled();

      manager.start(makeCtx({ sessionId: "sess-1" }));
      mockReview.mockClear();
      manager.stop();

      expect(mockReview).toHaveBeenCalledExactlyOnceWith(
        "forwarded_permission.serving_stopped",
        { sessionId: "sess-1" },
      );
    });

    it("moves the mark when the session id changes", () => {
      const serving = new ServingSessionRegistry();
      const manager = makeManager(serving);
      manager.start(makeCtx({ sessionId: "sess-1" }));
      manager.start(makeCtx({ sessionId: "sess-2" }));

      expect(serving.servingIds()).toEqual(["sess-2"]);
    });

    it("clears the mark when a later context no longer qualifies", () => {
      const serving = new ServingSessionRegistry();
      const manager = makeManager(serving);
      manager.start(makeCtx({ sessionId: "sess-1" }));
      manager.start(makeCtx({ sessionId: "sess-1", hasUI: false }));

      expect(serving.servingIds()).toEqual([]);
    });

    it("never marks a session it does not poll", () => {
      const serving = new ServingSessionRegistry();
      makeManager(serving).start(
        makeCtx({ sessionId: "sess-1", hasUI: false }),
      );

      expect(serving.servingIds()).toEqual([]);
    });

    it("marks nothing when the session id is unreachable", () => {
      // A serving record under the `unknown` sentinel names a session no child
      // can target, so publishing one only litters the heartbeat directory.
      const serving = new ServingSessionRegistry();
      const { ctx, getSessionId } = makeChurningCtx("sess-1");
      getSessionId.mockImplementation(() => {
        throw new Error("session id unavailable");
      });

      makeManager(serving).start(ctx);

      expect(serving.servingIds()).toEqual([]);
      expect(mockReview).not.toHaveBeenCalled();
    });
  });

  describe("serving refresh", () => {
    it("re-announces on every poll tick, so the announcement cannot decay", async () => {
      const serving = makeAnnouncer();
      makeManager(serving).start(makeCtx({ sessionId: "sess-1" }));
      serving.markServing.mockClear();

      await vi.advanceTimersByTimeAsync(750);

      expect(serving.markServing).toHaveBeenCalledTimes(3);
      expect(serving.markServing).toHaveBeenCalledWith("sess-1");
    });

    it("re-announces while a drain is still in flight", async () => {
      // A human deliberating at a forwarded dialog holds `processInbox` open
      // for as long as they take. That session is serving, and must not read as
      // gone to another child while it waits — so the refresh cannot sit behind
      // the processing guard.
      mockProcessInbox.mockReturnValue(new Promise<void>(() => undefined));
      const serving = makeAnnouncer();
      makeManager(serving).start(makeCtx({ sessionId: "sess-1" }));
      await vi.advanceTimersByTimeAsync(250);
      expect(mockProcessInbox).toHaveBeenCalledTimes(1);
      serving.markServing.mockClear();

      await vi.advanceTimersByTimeAsync(750);

      expect(serving.markServing).toHaveBeenCalledTimes(3);
    });

    it("adds no review entry per refresh", async () => {
      makeManager(makeAnnouncer()).start(makeCtx({ sessionId: "sess-1" }));
      mockReview.mockClear();

      await vi.advanceTimersByTimeAsync(1000);

      expect(mockReview).not.toHaveBeenCalled();
    });

    it("republishes under the new id when the session id changes mid-session", async () => {
      // `processInbox` reads the live id on every tick, so an announcement
      // pinned to the id captured at `start` drifts away from the inbox being
      // drained: a child holding the old id waits out the full timeout while a
      // child holding the new one finds no heartbeat at all (#907).
      const serving = makeAnnouncer();
      const { ctx, getSessionId } = makeChurningCtx("sess-1");
      makeManager(serving).start(ctx);
      serving.markServing.mockClear();

      getSessionId.mockReturnValue("sess-2");
      await vi.advanceTimersByTimeAsync(250);

      expect(serving.clearServing).toHaveBeenCalledExactlyOnceWith("sess-1");
      expect(serving.markServing).toHaveBeenCalledExactlyOnceWith("sess-2");

      serving.markServing.mockClear();
      await vi.advanceTimersByTimeAsync(500);

      expect(serving.markServing).toHaveBeenCalledTimes(2);
      expect(serving.markServing).toHaveBeenCalledWith("sess-2");
    });

    it("logs the migration once, not once per tick", async () => {
      const { ctx, getSessionId } = makeChurningCtx("sess-1");
      makeManager(makeAnnouncer()).start(ctx);
      mockReview.mockClear();

      getSessionId.mockReturnValue("sess-2");
      await vi.advanceTimersByTimeAsync(1000);

      expect(mockReview.mock.calls).toEqual([
        ["forwarded_permission.serving_stopped", { sessionId: "sess-1" }],
        ["forwarded_permission.serving_started", { sessionId: "sess-2" }],
      ]);
    });

    it("keeps serving the last reachable id when the live id is unreachable", async () => {
      const serving = makeAnnouncer();
      const { ctx, getSessionId } = makeChurningCtx("sess-1");
      makeManager(serving).start(ctx);
      serving.markServing.mockClear();
      mockReview.mockClear();

      getSessionId.mockImplementation(() => {
        throw new Error("session id unavailable");
      });
      await vi.advanceTimersByTimeAsync(750);

      expect(serving.markServing).toHaveBeenCalledTimes(3);
      expect(serving.markServing).toHaveBeenCalledWith("sess-1");
      expect(serving.clearServing).not.toHaveBeenCalled();
      expect(mockReview).not.toHaveBeenCalled();
    });

    it("stops re-announcing once stopped", async () => {
      const serving = makeAnnouncer();
      const manager = makeManager(serving);
      manager.start(makeCtx({ sessionId: "sess-1" }));
      manager.stop();
      serving.markServing.mockClear();

      await vi.advanceTimersByTimeAsync(750);

      expect(serving.markServing).not.toHaveBeenCalled();
    });
  });
});
