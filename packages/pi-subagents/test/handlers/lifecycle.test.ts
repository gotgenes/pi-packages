import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { LifecycleManager, LifecycleRuntime } from "#src/handlers/lifecycle";
import { SessionLifecycleHandler } from "#src/handlers/lifecycle";
import { buildShutdownNotice, type ShutdownNotice, type StoppedAgent } from "#src/handlers/shutdown-notice";

const stoppedAgent: StoppedAgent = {
  id: "a1b2c3",
  type: "general-purpose",
  description: "Refactor auth module",
  stoppedWhileQueued: false,
  outputFile: "/sessions/parent/tasks/a1b2c3.jsonl",
};

describe("SessionLifecycleHandler", () => {
  let runtime: LifecycleRuntime;
  let manager: LifecycleManager;
  let mockSetSessionContext: Mock<LifecycleRuntime["setSessionContext"]>;
  let mockClearSessionContext: Mock<LifecycleRuntime["clearSessionContext"]>;
  let mockClearCompleted: Mock<LifecycleManager["clearCompleted"]>;
  let mockAbortAll: Mock<LifecycleManager["abortAll"]>;
  let mockDispose: Mock<LifecycleManager["dispose"]>;
  let mockDisposeNotifications: Mock<() => void>;
  let mockUnpublishService: Mock<() => void>;
  let mockSendMessage: Mock<(message: ShutdownNotice, options: { triggerTurn: false }) => void>;
  let handler: SessionLifecycleHandler;

  beforeEach(() => {
    mockSetSessionContext = vi.fn();
    mockClearSessionContext = vi.fn();
    mockClearCompleted = vi.fn(() => Promise.resolve());
    mockAbortAll = vi.fn((): StoppedAgent[] => []);
    mockDispose = vi.fn(() => Promise.resolve());
    mockDisposeNotifications = vi.fn();
    mockUnpublishService = vi.fn();
    mockSendMessage = vi.fn();

    runtime = {
      setSessionContext: mockSetSessionContext,
      clearSessionContext: mockClearSessionContext,
    };
    manager = {
      clearCompleted: mockClearCompleted,
      abortAll: mockAbortAll,
      dispose: mockDispose,
    };

    handler = new SessionLifecycleHandler(
      runtime,
      manager,
      mockDisposeNotifications,
      mockUnpublishService,
      mockSendMessage,
    );
  });

  describe("handleSessionStart", () => {
    it("sets session context and clears completed agents", async () => {
      const ctx = { cwd: "/some/path" };

      await handler.handleSessionStart({}, ctx);

      expect(runtime.setSessionContext).toHaveBeenCalledWith(ctx);
      expect(manager.clearCompleted).toHaveBeenCalled();
    });

    it("sets context before clearing completed", async () => {
      const callOrder: string[] = [];
      mockSetSessionContext.mockImplementation(() => {
        callOrder.push("setSessionContext");
      });
      mockClearCompleted.mockImplementation(() => {
        callOrder.push("clearCompleted");
        return Promise.resolve();
      });

      await handler.handleSessionStart({}, {});

      expect(callOrder).toEqual(["setSessionContext", "clearCompleted"]);
    });

    it("resolves only after the prior session's children have shut down", async () => {
      const cleared = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
      mockClearCompleted.mockReturnValue(cleared.promise);

      let settled = false;
      const pending = handler.handleSessionStart({}, {}).then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      cleared.resolve();
      await pending;
      expect(settled).toBe(true);
    });
  });

  describe("handleSessionBeforeSwitch", () => {
    it("clears completed agents", async () => {
      await handler.handleSessionBeforeSwitch();

      expect(manager.clearCompleted).toHaveBeenCalled();
    });

    it("resolves only after the cleared children have shut down", async () => {
      const cleared = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
      mockClearCompleted.mockReturnValue(cleared.promise);

      let settled = false;
      const pending = handler.handleSessionBeforeSwitch().then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      cleared.resolve();
      await pending;
      expect(settled).toBe(true);
    });
  });

  describe("handleSessionShutdown", () => {
    it("calls all cleanup steps", async () => {
      await handler.handleSessionShutdown({ reason: "reload" });

      expect(mockUnpublishService).toHaveBeenCalled();
      expect(mockClearSessionContext).toHaveBeenCalled();
      expect(mockAbortAll).toHaveBeenCalled();
      expect(mockDisposeNotifications).toHaveBeenCalled();
      expect(mockDispose).toHaveBeenCalled();
    });

    it("calls cleanup in correct order", async () => {
      const callOrder: string[] = [];
      mockUnpublishService.mockImplementation(() => { callOrder.push("unpublishService"); });
      mockClearSessionContext.mockImplementation(() => {
        callOrder.push("clearSessionContext");
      });
      mockAbortAll.mockImplementation(() => {
        callOrder.push("abortAll");
        return [stoppedAgent];
      });
      mockSendMessage.mockImplementation(() => { callOrder.push("sendMessage"); });
      mockDisposeNotifications.mockImplementation(() => { callOrder.push("disposeNotifications"); });
      mockDispose.mockImplementation(() => {
        callOrder.push("dispose");
        return Promise.resolve();
      });

      await handler.handleSessionShutdown({ reason: "reload" });

      // Notifications are torn down before the aborts: a terminal transition
      // fires its nudge synchronously when no parent run is active, and Pi
      // cannot recall a message already handed to it. The shutdown notice
      // reports what the aborts stopped, before the children are disposed.
      expect(callOrder).toEqual([
        "unpublishService",
        "clearSessionContext",
        "disposeNotifications",
        "abortAll",
        "sendMessage",
        "dispose",
      ]);
    });

    it("resolves only after every child session has shut down", async () => {
      const disposed = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
      mockDispose.mockReturnValue(disposed.promise);

      let settled = false;
      const pending = handler.handleSessionShutdown({ reason: "reload" }).then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      disposed.resolve();
      await pending;
      expect(settled).toBe(true);
    });

    describe("the shutdown notice", () => {
      it("tells the parent which agents the shutdown stopped, without starting a turn", async () => {
        mockAbortAll.mockReturnValue([stoppedAgent]);

        await handler.handleSessionShutdown({ reason: "reload" });

        expect(mockSendMessage).toHaveBeenCalledExactlyOnceWith(buildShutdownNotice("reload", [stoppedAgent]), {
          triggerTurn: false,
        });
      });

      it("sends nothing when the shutdown stopped nothing", async () => {
        await handler.handleSessionShutdown({ reason: "reload" });

        expect(mockSendMessage).not.toHaveBeenCalled();
      });

      it("still disposes the children when the notice cannot be sent", async () => {
        mockAbortAll.mockReturnValue([stoppedAgent]);
        mockSendMessage.mockImplementation(() => {
          throw new Error("stale extension context");
        });

        await handler.handleSessionShutdown({ reason: "reload" });

        expect(mockDispose).toHaveBeenCalledOnce();
      });
    });
  });
});
