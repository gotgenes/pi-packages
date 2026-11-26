import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InterruptManager } from "#src/handlers/interrupt";
import { InterruptHandler } from "#src/handlers/interrupt";

describe("InterruptHandler", () => {
  let manager: InterruptManager;
  let mockAbortAll: ReturnType<typeof vi.fn<InterruptManager["abortAll"]>>;
  let handler: InterruptHandler;

  beforeEach(() => {
    mockAbortAll = vi.fn();
    manager = { abortAll: mockAbortAll };
    handler = new InterruptHandler(manager, () => true);
  });

  describe("handleTurnStart", () => {
    it("aborts all subagents when the latched signal fires", () => {
      const controller = new AbortController();
      handler.handleTurnStart({ signal: controller.signal });

      expect(mockAbortAll).not.toHaveBeenCalled();
      controller.abort();
      expect(mockAbortAll).toHaveBeenCalledOnce();
    });

    it("does not abort when the signal never fires", () => {
      const controller = new AbortController();
      handler.handleTurnStart({ signal: controller.signal });
      expect(mockAbortAll).not.toHaveBeenCalled();
    });

    it("latches only one listener across repeated turns with the same signal", () => {
      const controller = new AbortController();
      handler.handleTurnStart({ signal: controller.signal });
      handler.handleTurnStart({ signal: controller.signal });
      handler.handleTurnStart({ signal: controller.signal });

      controller.abort();
      expect(mockAbortAll).toHaveBeenCalledOnce();
    });

    it("re-wires to a new signal and ignores the stale one", () => {
      const first = new AbortController();
      handler.handleTurnStart({ signal: first.signal });

      const second = new AbortController();
      handler.handleTurnStart({ signal: second.signal });

      // The stale signal no longer triggers an abort.
      first.abort();
      expect(mockAbortAll).not.toHaveBeenCalled();

      // The current signal does.
      second.abort();
      expect(mockAbortAll).toHaveBeenCalledOnce();
    });

    it("detaches the previous listener when the signal becomes undefined", () => {
      const controller = new AbortController();
      handler.handleTurnStart({ signal: controller.signal });
      handler.handleTurnStart({ signal: undefined });

      controller.abort();
      expect(mockAbortAll).not.toHaveBeenCalled();
    });

    it("is a no-op when called with an undefined signal", () => {
      expect(() => handler.handleTurnStart({ signal: undefined })).not.toThrow();
      expect(mockAbortAll).not.toHaveBeenCalled();
    });
  });

  describe("abort-all policy", () => {
    it("leaves subagents running when the policy declines", () => {
      const declining = new InterruptHandler(manager, () => false);
      const controller = new AbortController();
      declining.handleTurnStart({ signal: controller.signal });

      controller.abort();
      expect(mockAbortAll).not.toHaveBeenCalled();
    });

    it("reads the policy when the signal fires, not when the turn starts", () => {
      let allowed = true;
      const live = new InterruptHandler(manager, () => allowed);
      const controller = new AbortController();
      live.handleTurnStart({ signal: controller.signal });

      // The user flips the setting mid-turn; the next ESC must honor it.
      allowed = false;
      controller.abort();
      expect(mockAbortAll).not.toHaveBeenCalled();
    });

    it("honors a policy that turns on mid-turn", () => {
      let allowed = false;
      const live = new InterruptHandler(manager, () => allowed);
      const controller = new AbortController();
      live.handleTurnStart({ signal: controller.signal });

      allowed = true;
      controller.abort();
      expect(mockAbortAll).toHaveBeenCalledOnce();
    });

    it("does not consult the policy until the signal fires", () => {
      const policy = vi.fn(() => true);
      const live = new InterruptHandler(manager, policy);
      const controller = new AbortController();
      live.handleTurnStart({ signal: controller.signal });

      expect(policy).not.toHaveBeenCalled();
      controller.abort();
      expect(policy).toHaveBeenCalledOnce();
    });
  });
});
