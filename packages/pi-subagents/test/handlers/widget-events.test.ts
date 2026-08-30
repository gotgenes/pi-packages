import { describe, expect, it, vi } from "vitest";
import type { EventDrivenWidget } from "#src/handlers/widget-events";
import { WidgetEventsHandler } from "#src/handlers/widget-events";

function makeWidget() {
  return {
    setUICtx: vi.fn<EventDrivenWidget["setUICtx"]>(),
    onTurnStart: vi.fn<EventDrivenWidget["onTurnStart"]>(),
  };
}

describe("WidgetEventsHandler", () => {
  describe("handleSessionStart", () => {
    it("gives the widget the session's UI context", () => {
      const widget = makeWidget();
      const ui = { setStatus: vi.fn(), setWidget: vi.fn() };

      new WidgetEventsHandler(widget).handleSessionStart({}, { ui });

      expect(widget.setUICtx).toHaveBeenCalledWith(ui);
    });

    it("does not age the finished-agent linger", () => {
      const widget = makeWidget();

      new WidgetEventsHandler(widget).handleSessionStart({}, { ui: {} });

      expect(widget.onTurnStart).not.toHaveBeenCalled();
    });
  });

  describe("handleTurnStart", () => {
    it("ages the finished-agent linger", () => {
      const widget = makeWidget();

      new WidgetEventsHandler(widget).handleTurnStart();

      expect(widget.onTurnStart).toHaveBeenCalledOnce();
    });

    it("does not re-capture the UI context", () => {
      const widget = makeWidget();

      new WidgetEventsHandler(widget).handleTurnStart();

      expect(widget.setUICtx).not.toHaveBeenCalled();
    });
  });
});
