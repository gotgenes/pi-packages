import { getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { AgentTypeRegistry } from "#src/config/agent-types";
import type { SessionMessage } from "#src/types";
import type { TranscriptSource } from "#src/ui/session-navigation";
import { SessionNavigatorHandler, TranscriptPane } from "#src/ui/session-navigator";
import { makeNavigable } from "#test/helpers/make-navigable";
import { fakeSource, mockTui } from "#test/helpers/transcript-fixtures";

const registry = new AgentTypeRegistry(() => new Map());

// Pi's per-entry components read the global interactive theme; Pi initializes it
// at startup before any command runs. Tests must initialize it explicitly.
beforeAll(() => initTheme(undefined, false));

function ansiTheme() {
  return {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };
}

function makePane(opts: { source?: TranscriptSource; done?: (r: undefined) => void; tui?: TUI } = {}) {
  return new TranscriptPane({
    tui: opts.tui ?? mockTui(),
    theme: ansiTheme(),
    source: opts.source ?? fakeSource(),
    done: opts.done ?? vi.fn(),
    cwd: "/test/cwd",
    markdownTheme: getMarkdownTheme(),
  });
}

describe("TranscriptPane", () => {
  it("renders the transcript content", () => {
    const lines = makePane().render(80);
    expect(lines.some((l) => l.includes("Hello world"))).toBe(true);
  });

  it("subscribes on construction and requests a render on change", () => {
    const tui = mockTui();
    let captured: (() => void) | undefined;
    const source = fakeSource({
      subscribe: (onChange) => {
        captured = onChange;
        return () => {};
      },
    });
    makePane({ source, tui });
    captured?.();
    expect(tui.requestRender).toHaveBeenCalledOnce();
  });

  it("closes and calls done on Escape", () => {
    const done = vi.fn();
    const pane = makePane({ done });
    pane.handleInput("\x1b");
    expect(done).toHaveBeenCalledWith(undefined);
  });

  it("unsubscribes on dispose", () => {
    const unsub = vi.fn();
    const pane = makePane({ source: fakeSource({ subscribe: () => unsub }) });
    pane.dispose();
    expect(unsub).toHaveBeenCalledOnce();
  });

  it("does not request a render after dispose", () => {
    const tui = mockTui();
    let captured: (() => void) | undefined;
    const source = fakeSource({
      subscribe: (onChange) => {
        captured = onChange;
        return () => {};
      },
    });
    const pane = makePane({ source, tui });
    pane.dispose();
    captured?.();
    expect(tui.requestRender).not.toHaveBeenCalled();
  });

  it("appends the streaming-activity indicator while running", () => {
    const source = fakeSource({
      streaming: () => ({ activeTools: new Map([["k", "read"]]), responseText: "" }),
    });
    const out = makePane({ source }).render(80).join("\n");
    expect(out).toContain("◍");
  });

  describe("chrome", () => {
    // One message of numbered rows, so every visible row is identifiable content.
    const numbered = [
      { role: "user", content: Array.from({ length: 80 }, (_, i) => `r${String(i).padStart(3, "0")}`).join("\n") },
    ] as unknown as SessionMessage[];

    it("paints no box-drawing glyphs", () => {
      const out = makePane().render(80).join("\n");
      expect(out).not.toMatch(/[╭╮╰╯│─]/);
    });

    it("spends only two rows on chrome, leaving the rest to the transcript", () => {
      // 40 rows * 70% = 28 for the pane. A header and a footer leave a 26-row
      // viewport, of which 25 carry numbered text and one is the user-message
      // component's own trailing row. The box cost four more and showed 21.
      const pane = makePane({
        tui: mockTui(40, 80),
        source: fakeSource({ getMessages: () => numbered }),
      });
      const shown = pane.render(80).filter((line) => /r\d{3}/.test(line)).length;
      expect(shown).toBe(25);
    });
  });

  describe("scroll bounds", () => {
    // The host may lay a component out at a width narrower than the terminal.
    // The terminal here is 200 columns while the component is rendered at 180,
    // and the fixture text is sized to wrap to two rows at the render width but
    // one row at the full terminal width — so scroll math computed at the wrong
    // width yields the wrong maxScroll.
    const LAYOUT_WIDTH = 180;
    const wrappingMessages = Array.from({ length: 30 }, (_, i) => ({
      role: "user",
      content: `${String(i).padStart(3, "0")} ${"wrap".repeat(46)}`,
    })) as unknown as SessionMessage[];

    function paneAtBottom() {
      const pane = makePane({
        tui: mockTui(40, 200),
        source: fakeSource({ getMessages: () => wrappingMessages }),
      });
      const atBottom = pane.render(LAYOUT_WIDTH);
      return { pane, atBottom };
    }

    it("scrolls up from the bottom on a terminal wider than the render width", () => {
      const { pane, atBottom } = paneAtBottom();
      pane.handleInput("\x1b[A");
      expect(pane.render(LAYOUT_WIDTH)).not.toEqual(atBottom);
    });

    it("returns to the bottom when scrolling back down", () => {
      const { pane, atBottom } = paneAtBottom();
      pane.handleInput("\x1b[A");
      pane.handleInput("\x1b[B");
      expect(pane.render(LAYOUT_WIDTH)).toEqual(atBottom);
    });
  });

  it("refreshes its content when the source changes", () => {
    let messages = [{ role: "user", content: "first" }] as unknown as SessionMessage[];
    let captured: (() => void) | undefined;
    const source = fakeSource({
      getMessages: () => messages,
      subscribe: (onChange) => {
        captured = onChange;
        return () => {};
      },
    });
    const pane = makePane({ source });
    expect(pane.render(80).join("\n")).toContain("first");
    messages = [{ role: "user", content: "second" }] as unknown as SessionMessage[];
    captured?.();
    expect(pane.render(80).join("\n")).toContain("second");
  });
});

describe("SessionNavigatorHandler", () => {
  function makeUI(selectResult?: string) {
    return {
      select: vi.fn().mockResolvedValue(selectResult),
      notify: vi.fn(),
      custom: vi.fn().mockResolvedValue(undefined),
    };
  }

  // Invoke the component factory captured by the handler's ui.custom call and
  // render it — the act (handle) stays explicit in each test.
  function renderCapturedPane(ui: ReturnType<typeof makeUI>, width = 80): string[] {
    const factory = ui.custom.mock.calls[0][0] as (
      tui: TUI,
      theme: ReturnType<typeof ansiTheme>,
      kb: unknown,
      done: (r: undefined) => void,
    ) => Component;
    const pane = factory(mockTui(), ansiTheme(), undefined, vi.fn());
    return pane.render(width);
  }

  const noReadFile = (): string => {
    throw new Error("readFile not expected in this test");
  };

  it("notifies and skips the pane when no sessions are navigable", async () => {
    const ui = makeUI();
    const notReady = makeNavigable({ isSessionReady: () => false, outputFile: undefined });
    await new SessionNavigatorHandler().handle({ ui, agents: [notReady], registry, cwd: "/test/cwd", readFile: noReadFile });
    expect(ui.notify).toHaveBeenCalledWith("No subagent sessions to view.", "info");
    expect(ui.custom).not.toHaveBeenCalled();
  });

  it("does not open the pane when the operator cancels the picker", async () => {
    const ui = makeUI(undefined);
    await new SessionNavigatorHandler().handle({ ui, agents: [makeNavigable()], registry, cwd: "/test/cwd", readFile: noReadFile });
    expect(ui.select).toHaveBeenCalledOnce();
    expect(ui.custom).not.toHaveBeenCalled();
  });

  it("opens a read-only pane sourced from the picked record", async () => {
    const messages = [{ role: "assistant", content: [{ type: "text", text: "picked agent reply" }] }] as unknown as SessionMessage[];
    const record = makeNavigable({ agentMessages: messages });
    const [label] = (() => {
      // The handler labels entries identically to listNavigableAgents.
      return [
        "Agent (Test task) · 2 tools · completed · 3.0s",
      ];
    })();
    const ui = makeUI(label);

    await new SessionNavigatorHandler().handle({ ui, agents: [record], registry, cwd: "/test/cwd", readFile: noReadFile });

    expect(ui.custom).toHaveBeenCalledOnce();
    // Invariant #423: the handler is a reactive consumer — it sources the
    // transcript and never reads tool definitions off the record itself; only
    // the pane does, lazily, through the TranscriptSource at render time.
    expect(record.getToolDefinition).not.toHaveBeenCalled();
    // Invoke the captured component factory and render to confirm it is sourced from the picked record.
    expect(renderCapturedPane(ui).some((l) => l.includes("picked agent reply"))).toBe(true);
  });

  it("mounts the transcript outside Pi's overlay compositor", async () => {
    // Regular-mode overlays are composited into the buffer that backs scrollback,
    // so an overlay mount bakes the pane's chrome into terminal history (#733).
    const ui = makeUI("Agent (Test task) · 2 tools · completed · 3.0s");

    await new SessionNavigatorHandler().handle({
      ui,
      agents: [makeNavigable()],
      registry,
      cwd: "/test/cwd",
      readFile: noReadFile,
    });

    expect(ui.custom).toHaveBeenCalledWith(expect.any(Function), { overlay: false });
  });

  it("opens a pane sourced from the persisted file when a released agent is picked", async () => {
    const jsonl = [
      { type: "session", version: 3, id: "s1", timestamp: "2026-06-23T00:00:00Z", cwd: "/proj" },
      { type: "message", id: "m1", parentId: null, timestamp: "2026-06-23T00:00:01Z", message: { role: "assistant", content: [{ type: "text", text: "released reply" }] } },
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n");
    const readFile = vi.fn(() => jsonl);
    const released = makeNavigable({
      id: "e1", description: "Old task", status: "completed", startedAt: 1000, completedAt: 4000, toolUses: 5,
      isSessionReady: () => false, outputFile: "/tasks/e1.jsonl",
    });
    const ui = makeUI("Agent (Old task) · 5 tools · completed · 3.0s · session released (snapshot)");

    await new SessionNavigatorHandler().handle({ ui, agents: [released], registry, cwd: "/test/cwd", readFile });

    expect(readFile).toHaveBeenCalledWith("/tasks/e1.jsonl");
    expect(ui.custom).toHaveBeenCalledOnce();
    expect(renderCapturedPane(ui).some((l) => l.includes("released reply"))).toBe(true);
  });

  it("notifies and skips the pane when the session file cannot be read", async () => {
    const readFile = vi.fn(() => {
      throw new Error("ENOENT");
    });
    const released = makeNavigable({
      id: "e1", description: "Old task", status: "completed", startedAt: 1000, completedAt: 4000, toolUses: 5,
      isSessionReady: () => false, outputFile: "/tasks/e1.jsonl",
    });
    const ui = makeUI("Agent (Old task) · 5 tools · completed · 3.0s · session released (snapshot)");

    await new SessionNavigatorHandler().handle({ ui, agents: [released], registry, cwd: "/test/cwd", readFile });

    expect(ui.notify).toHaveBeenCalledWith("Could not read the session transcript file.", "error");
    expect(ui.custom).not.toHaveBeenCalled();
  });
});
