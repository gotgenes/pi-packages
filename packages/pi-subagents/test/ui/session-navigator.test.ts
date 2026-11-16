import { getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import {
  type KeybindingsConfig,
  KeybindingsManager,
  TUI_KEYBINDINGS,
  type TuiMode,
  type TuiMouseEvent,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { AgentTypeRegistry } from "#src/config/agent-types";
import type { SessionMessage } from "#src/types";
import {
  type EntryHeading,
  listNavigableAgents,
  type SessionModel,
  type TranscriptSource,
} from "#src/ui/session-navigation";
import { type PaneKeys, SessionNavigatorHandler, type SessionNavigatorParams, TranscriptPane } from "#src/ui/session-navigator";
import { makeNavigable } from "#test/helpers/make-navigable";
import { fakeSource, mockTui } from "#test/helpers/transcript-fixtures";

const registry = new AgentTypeRegistry(() => new Map());

// Pi's per-entry components read the global interactive theme; Pi initializes it
// at startup before any command runs. Tests must initialize it explicitly.
beforeAll(() => initTheme(undefined, false));

/** One SGR colour per thinking level, so a test can tell which level painted a rule. */
const LEVEL_CODES: Record<string, number> = { off: 0, minimal: 1, low: 2, medium: 3, high: 4, xhigh: 5, max: 6 };
const levelColour = (level: string): string => `\x1b[38;5;${LEVEL_CODES[level] ?? 9}m`;
const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, "");

/** Plain-text theme; the thinking-border painter wraps in zero-width SGR codes. */
function ansiTheme() {
  return {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
    getThinkingBorderColor: (level: string) => (text: string) => `${levelColour(level)}${text}\x1b[39m`,
  };
}

const DEFAULT_HEADING: EntryHeading = { name: "Explore", modeLabel: undefined, description: "Find auth files" };

/** Pi's keybindings with the given overrides, as Pi passes them to a `ui.custom` factory. */
const keysWith = (overrides: KeybindingsConfig = {}): PaneKeys => new KeybindingsManager(TUI_KEYBINDINGS, overrides);

function makePane(
  opts: {
    source?: TranscriptSource;
    done?: (r: undefined) => void;
    tui?: TUI;
    heading?: EntryHeading;
    keys?: PaneKeys;
  } = {},
) {
  return new TranscriptPane({
    tui: opts.tui ?? mockTui(),
    keys: opts.keys ?? keysWith(),
    theme: ansiTheme(),
    source: opts.source ?? fakeSource(),
    heading: opts.heading ?? DEFAULT_HEADING,
    done: opts.done ?? vi.fn(),
    cwd: "/test/cwd",
    markdownTheme: getMarkdownTheme(),
  });
}

/** A user message of `n` numbered rows (`r000`, `r001`, …); it renders as n + 2 transcript lines. */
const rowsOf = (n: number) =>
  [
    { role: "user", content: Array.from({ length: n }, (_, i) => `r${String(i).padStart(3, "0")}`).join("\n") },
  ] as unknown as SessionMessage[];

const SONNET_HIGH: SessionModel = { model: { provider: "anthropic", id: "claude-sonnet-5" }, thinkingLevel: "high" };

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

    it("paints no frame: no corners or side borders, and rules only on the first and last rows", () => {
      const lines = makePane().render(80);
      expect(lines.join("\n")).not.toMatch(/[╭╮╰╯│]/);
      const ruled = lines.flatMap((line, i) => (line.includes("─") ? [i] : []));
      expect(ruled).toEqual([0, lines.length - 1]);
    });

    it("never paints a row wider than it was given", () => {
      const source = fakeSource({ sessionModel: () => SONNET_HIGH });
      for (const width of [6, 20, 57, 80]) {
        const pane = makePane({ source, heading: { name: "Agent", modeLabel: "twin", description: "Refactor the auth module" } });
        for (const line of pane.render(width)) expect(visibleWidth(line), `width ${width}`).toBeLessThanOrEqual(width);
      }
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

  describe("header rule", () => {
    const heading: EntryHeading = { name: "Agent", modeLabel: "twin", description: "Refactor auth" };
    const headerAt = (width: number, sessionModel: SessionModel = SONNET_HIGH): string =>
      stripAnsi(makePane({ heading, source: fakeSource({ sessionModel: () => sessionModel }) }).render(width)[0] ?? "");

    it("names the agent, its mode, its task, its model, and its thinking level", () => {
      expect(headerAt(80)).toBe(`── Agent (twin)  Refactor auth · anthropic/claude-sonnet-5 • high ${"─".repeat(14)}`);
    });

    it("says 'thinking off' rather than a bare 'off'", () => {
      expect(headerAt(80, { ...SONNET_HIGH, thinkingLevel: "off" })).toContain("anthropic/claude-sonnet-5 • thinking off");
    });

    it("names the thinking level on its own when the model is unknown", () => {
      expect(headerAt(80, { model: undefined, thinkingLevel: "high" })).toContain("Refactor auth · thinking high");
    });

    it("drops the task first as the width shrinks", () => {
      expect(headerAt(55)).toBe(`── Agent (twin) · anthropic/claude-sonnet-5 • high ${"─".repeat(4)}`);
    });

    it("drops the model next, keeping the agent's name", () => {
      expect(headerAt(30)).toBe(`── Agent (twin) ${"─".repeat(14)}`);
    });
  });

  describe("rule colour", () => {
    it("paints both rules for the child's thinking level", () => {
      const lines = makePane({ source: fakeSource({ sessionModel: () => SONNET_HIGH }) }).render(80);
      expect(lines[0]?.startsWith(`${levelColour("high")}── `)).toBe(true);
      expect(lines.at(-1)?.startsWith(`${levelColour("high")}── `)).toBe(true);
    });

    it("repaints when the child's thinking level changes", () => {
      let current: SessionModel = SONNET_HIGH;
      const pane = makePane({ source: fakeSource({ sessionModel: () => current }) });
      pane.render(80);
      current = { ...SONNET_HIGH, thinkingLevel: "low" };
      expect(pane.render(80)[0]?.startsWith(levelColour("low"))).toBe(true);
    });

    it("paints an unknown level as 'off'", () => {
      const lines = makePane({ source: fakeSource({ sessionModel: () => ({ model: undefined, thinkingLevel: undefined }) }) }).render(80);
      expect(lines[0]?.startsWith(levelColour("off"))).toBe(true);
    });
  });

  describe("footer rule", () => {
    const footerAt = (width: number, keys?: PaneKeys): string =>
      stripAnsi(makePane({ keys }).render(width).at(-1) ?? "");

    it("carries the scroll position on the left and the key hints on the right", () => {
      const footer = footerAt(80);
      expect(footer.startsWith("── 3 lines · 100% ─")).toBe(true);
      expect(footer.endsWith(" ↑↓ scroll · PageUp/PageDown · Home/End · Esc close ──")).toBe(true);
    });

    it("names the keys the operator bound", () => {
      const footer = footerAt(80, keysWith({ "tui.altScreen.pageUp": "ctrl+b" }));
      expect(footer.endsWith(" ↑↓ scroll · Ctrl+B/PageDown · Home/End · Esc close ──")).toBe(true);
    });

    it("omits a pair the operator left unbound", () => {
      const footer = footerAt(80, keysWith({ "tui.altScreen.top": [], "tui.altScreen.bottom": [] }));
      expect(footer.endsWith(" ↑↓ scroll · PageUp/PageDown · Esc close ──")).toBe(true);
    });

    it("drops the key hints, keeping the position, when both do not fit", () => {
      expect(footerAt(40)).toBe(`── 3 lines · 100% ${"─".repeat(22)}`);
    });
  });

  describe("height", () => {
    const paneFor = (messages: SessionMessage[]) =>
      makePane({ tui: mockTui(40, 80), source: fakeSource({ getMessages: () => messages }) });

    it("takes only the rows its transcript needs", () => {
      // 12 transcript rows, well under the cap, plus a header and a footer.
      expect(paneFor(rowsOf(10)).render(80)).toHaveLength(14);
    });

    it("stops growing at its share of the terminal", () => {
      // 82 transcript rows clamp to a 26-row viewport: 40 rows * 70%, less chrome.
      expect(paneFor(rowsOf(80)).render(80)).toHaveLength(28);
    });

    it("keeps a minimum viewport when there is nothing to show", () => {
      expect(paneFor([]).render(80)).toHaveLength(5);
    });
  });

  describe("paging keys", () => {
    // 80 numbered rows in a 40-row terminal: a 26-row viewport over 82 transcript lines.
    const PAGE = 26;
    const PG_UP = "\x1b[5~";
    const PG_DN = "\x1b[6~";
    const HOME = "\x1b[H";
    const END = "\x1b[F";

    /** The numbered rows the pane shows, in order. */
    const visibleRows = (pane: TranscriptPane): number[] =>
      pane
        .render(80)
        .flatMap((line) => /\br(\d{3})\b/.exec(stripAnsi(line)) ?? [])
        .filter((_, i) => i % 2 === 1)
        .map(Number);

    /** A pane the host has already painted once, as it is before any key arrives. */
    const longPane = (source = fakeSource({ getMessages: () => rowsOf(80) })) => {
      const pane = makePane({ tui: mockTui(40, 80), source });
      pane.render(80);
      return pane;
    };

    it("opens at the bottom of the transcript", () => {
      expect(visibleRows(longPane()).at(-1)).toBe(79);
    });

    it("pages up a full viewport", () => {
      const pane = longPane();
      const [bottomFirst = -1] = visibleRows(pane);
      pane.handleInput(PG_UP);
      expect(visibleRows(pane)[0]).toBe(bottomFirst - PAGE);
    });

    it("pages back down to the bottom", () => {
      const pane = longPane();
      pane.handleInput(PG_UP);
      pane.handleInput(PG_DN);
      expect(visibleRows(pane).at(-1)).toBe(79);
    });

    it("pages on the key the operator bound instead of PgUp", () => {
      const pane = makePane({
        tui: mockTui(40, 80),
        source: fakeSource({ getMessages: () => rowsOf(80) }),
        keys: keysWith({ "tui.altScreen.pageUp": "ctrl+b" }),
      });
      const atBottom = visibleRows(pane);
      pane.handleInput(PG_UP);
      expect(visibleRows(pane)).toEqual(atBottom);
      pane.handleInput("\x02");
      expect(visibleRows(pane)[0]).toBe((atBottom[0] ?? -1) - PAGE);
    });

    it("jumps to the top", () => {
      const pane = longPane();
      pane.handleInput(HOME);
      expect(visibleRows(pane)[0]).toBe(0);
    });

    it("jumps to the bottom and follows new output", () => {
      let messages = rowsOf(80);
      let captured: (() => void) | undefined;
      const pane = longPane(
        fakeSource({
          getMessages: () => messages,
          subscribe: (onChange) => {
            captured = onChange;
            return () => {};
          },
        }),
      );
      pane.handleInput(HOME);
      pane.handleInput(END);
      expect(visibleRows(pane).at(-1)).toBe(79);

      messages = rowsOf(90);
      captured?.();
      expect(visibleRows(pane).at(-1)).toBe(89);
    });
  });

  describe("mouse wheel", () => {
    const mouse = (type: TuiMouseEvent["type"], wheelDelta?: number): TuiMouseEvent => ({
      type,
      button: "none",
      x: 10,
      y: 5,
      screenX: 10,
      screenY: 5,
      width: 80,
      height: 28,
      shift: false,
      alt: false,
      ctrl: false,
      ...(wheelDelta === undefined ? {} : { wheelDelta }),
    });

    const firstRow = (pane: TranscriptPane): number =>
      pane
        .render(80)
        .map((line) => /\br(\d{3})\b/.exec(stripAnsi(line))?.[1])
        .filter((row) => row !== undefined)
        .map(Number)[0] ?? -1;

    function livePane() {
      let messages = rowsOf(80);
      let captured: (() => void) | undefined;
      const pane = makePane({
        tui: mockTui(40, 80),
        source: fakeSource({
          getMessages: () => messages,
          subscribe: (onChange) => {
            captured = onChange;
            return () => {};
          },
        }),
      });
      const grow = (rows: number) => {
        messages = rowsOf(rows);
        captured?.();
      };
      return { pane, grow };
    }

    it("scrolls the transcript up by the wheel's lines", () => {
      const { pane } = livePane();
      const atBottom = firstRow(pane);
      expect(pane.handleMouse(mouse("wheel", -3))).toEqual({ handled: true });
      expect(firstRow(pane)).toBe(atBottom - 3);
    });

    it("scrolls back to the bottom and follows new output", () => {
      const { pane, grow } = livePane();
      const atBottom = firstRow(pane);
      pane.handleMouse(mouse("wheel", -3));
      pane.handleMouse(mouse("wheel", 3));
      expect(firstRow(pane)).toBe(atBottom);
      grow(90);
      expect(firstRow(pane)).toBe(atBottom + 10);
    });

    it("leaves other mouse events to the host", () => {
      const { pane } = livePane();
      expect(pane.handleMouse(mouse("click"))).toBeUndefined();
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
  type ComponentFactory<R> = (
    tui: TUI,
    theme: ReturnType<typeof ansiTheme>,
    kb: PaneKeys,
    done: (r: R) => void,
  ) => Component;
  type PaneFactory = ComponentFactory<undefined>;

  /**
   * A `ctx.ui` double. Its `custom` behaves like Pi's: it runs the factory on a
   * TUI in `mode` and resolves with what `done` received if the factory called
   * it before returning, else `undefined` (the operator never closes the pane
   * here). A non-interactive UI resolves `undefined` without running anything,
   * as Pi's print and RPC modes do.
   */
  function makeUI(selectResult?: string, { mode = "regular", interactive = true }: { mode?: TuiMode; interactive?: boolean } = {}) {
    return {
      select: vi.fn().mockResolvedValue(selectResult),
      notify: vi.fn(),
      custom: vi.fn().mockImplementation((factory: ComponentFactory<unknown>) => {
        if (!interactive) return Promise.resolve(undefined);
        let result: unknown;
        factory(mockTui(40, 80, mode), ansiTheme(), keysWith(), (r) => {
          result = r;
        });
        return Promise.resolve(result);
      }),
    };
  }

  /** The factory of the `ui.custom` call that mounted the transcript pane; throws when none did. */
  function mountedPaneFactory(ui: ReturnType<typeof makeUI>): PaneFactory {
    const call = ui.custom.mock.calls.at(-1);
    if (!call) throw new Error("no transcript pane was mounted");
    return call[0] as PaneFactory;
  }

  // Invoke the factory that mounted the pane and render it — the act (handle)
  // stays explicit in each test.
  function renderCapturedPane(ui: ReturnType<typeof makeUI>, width = 80): string[] {
    const pane = mountedPaneFactory(ui)(mockTui(), ansiTheme(), keysWith(), vi.fn());
    return pane.render(width);
  }

  const noReadFile = (): string => {
    throw new Error("readFile not expected in this test");
  };

  // The act under test; the defaults are what no test here varies.
  function handleWith(
    ui: ReturnType<typeof makeUI>,
    agents: SessionNavigatorParams["agents"],
    overrides: Partial<Omit<SessionNavigatorParams, "ui" | "agents">> = {},
  ): Promise<void> {
    return new SessionNavigatorHandler().handle({ ui, agents, registry, cwd: "/test/cwd", readFile: noReadFile, sessionEntries: [], ...overrides });
  }

  it("notifies and skips the pane when no sessions are navigable", async () => {
    const ui = makeUI();
    const notReady = makeNavigable({ isSessionReady: () => false, outputFile: undefined });
    await handleWith(ui, [notReady]);
    expect(ui.notify).toHaveBeenCalledWith("No subagent sessions to view.", "info");
    expect(ui.custom).not.toHaveBeenCalled();
  });

  it("does not open the pane when the operator cancels the picker", async () => {
    const ui = makeUI(undefined);
    await handleWith(ui, [makeNavigable()]);
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

    await handleWith(ui, [record]);

    expect(mountedPaneFactory(ui)).toEqual(expect.any(Function));
    // Invariant #423: the handler is a reactive consumer — it sources the
    // transcript and never reads tool definitions off the record itself; only
    // the pane does, lazily, through the TranscriptSource at render time.
    expect(record.getToolDefinition).not.toHaveBeenCalled();
    // Invoke the captured component factory and render to confirm it is sourced from the picked record.
    expect(renderCapturedPane(ui).some((l) => l.includes("picked agent reply"))).toBe(true);
  });

  it("heads the pane with the picked agent's name and task", async () => {
    const ui = makeUI("Agent (Test task) · 2 tools · completed · 3.0s");
    await handleWith(ui, [makeNavigable()]);
    expect(stripAnsi(renderCapturedPane(ui)[0] ?? "").startsWith("── Agent (twin)  Test task ")).toBe(true);
  });

  it("mounts the transcript outside Pi's overlay compositor", async () => {
    // Regular-mode overlays are composited into the buffer that backs scrollback,
    // so an overlay mount bakes the pane's chrome into terminal history (#733).
    const ui = makeUI("Agent (Test task) · 2 tools · completed · 3.0s");

    await handleWith(ui, [makeNavigable()]);

    expect(ui.custom).toHaveBeenLastCalledWith(expect.any(Function), { overlay: false });
  });

  describe("mount mode", () => {
    const PICK = makeNavigable();
    const handleIn = (ui: ReturnType<typeof makeUI>) => handleWith(ui, [PICK]);
    const label = () => listNavigableAgents([PICK], registry, [])[0]?.label;

    it("floats the pane over the bottom of a fullscreen TUI, above Pi's footer", async () => {
      // Pi's fullscreen viewport claims PgUp/PgDn/Home/End before a docked
      // component sees them, and defers them only to a focused overlay.
      const ui = makeUI(label(), { mode: "fullscreen" });
      await handleIn(ui);
      expect(ui.custom).toHaveBeenLastCalledWith(expect.any(Function), {
        overlay: true,
        overlayOptions: { anchor: "bottom-center", width: "100%", maxHeight: "70%", margin: { bottom: 2 } },
      });
    });

    it("docks the pane when the UI reports no mode", async () => {
      const ui = makeUI(label(), { interactive: false });
      await handleIn(ui);
      expect(ui.custom).toHaveBeenLastCalledWith(expect.any(Function), { overlay: false });
    });

    it("mounts the pane once, after a probe that mounts nothing", async () => {
      const ui = makeUI(label(), { mode: "fullscreen" });
      await handleIn(ui);
      expect(ui.custom).toHaveBeenCalledTimes(2);
      expect(ui.custom.mock.calls[0]).toEqual([expect.any(Function)]);
    });
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

    await handleWith(ui, [released], { readFile });

    expect(readFile).toHaveBeenCalledWith("/tasks/e1.jsonl");
    expect(mountedPaneFactory(ui)).toEqual(expect.any(Function));
    expect(renderCapturedPane(ui).some((l) => l.includes("released reply"))).toBe(true);
  });

  describe("after the manager lost its records (a reload)", () => {
    const recordEntry = {
      type: "custom",
      customType: "subagents:record",
      data: {
        id: "e1", type: "general-purpose", description: "Old task", status: "completed",
        result: "done", startedAt: 1000, completedAt: 4000, outputFile: "/tasks/e1.jsonl", toolUses: 5,
      },
    };
    const label = "Agent (Old task) · 5 tools · completed · 3.0s · session released (snapshot)";

    it("offers the runs the session recorded", async () => {
      const ui = makeUI(undefined);
      await handleWith(ui, [], { sessionEntries: [recordEntry] });
      expect(ui.notify).not.toHaveBeenCalled();
      expect(ui.select).toHaveBeenCalledWith("Subagent sessions", [label]);
    });

    it("opens a recorded run from its transcript file", async () => {
      const readFile = vi.fn(() => JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-06-23T00:00:00Z", cwd: "/proj" }));
      const ui = makeUI(label);
      await handleWith(ui, [], { sessionEntries: [recordEntry], readFile });
      expect(readFile).toHaveBeenCalledWith("/tasks/e1.jsonl");
      expect(mountedPaneFactory(ui)).toEqual(expect.any(Function));
    });

    it("labels a recorded resume stopped while queued with the time it waited", async () => {
      const stoppedWhileQueued = {
        ...recordEntry,
        data: { ...recordEntry.data, status: "stopped", result: undefined, stoppedWhileQueued: true },
      };
      const ui = makeUI(undefined);
      await handleWith(ui, [], { sessionEntries: [stoppedWhileQueued] });
      expect(ui.select).toHaveBeenCalledWith("Subagent sessions", [
        "Agent (Old task) · 5 tools · stopped · queued 3.0s · session released (snapshot)",
      ]);
    });
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

    await handleWith(ui, [released], { readFile });

    expect(ui.notify).toHaveBeenCalledWith("Could not read the session transcript file.", "error");
    expect(ui.custom).not.toHaveBeenCalled();
  });
});
