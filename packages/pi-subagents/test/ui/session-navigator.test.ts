import { getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { AgentTypeRegistry } from "#src/config/agent-types";
import type { SessionMessage } from "#src/types";
import type { TranscriptSource } from "#src/ui/session-navigation";
import { SessionNavigatorHandler, TranscriptOverlay } from "#src/ui/session-navigator";
import { makeNavigable } from "#test/helpers/make-navigable";

const registry = new AgentTypeRegistry(() => new Map());

// Pi's per-entry components read the global interactive theme; Pi initializes it
// at startup before any command runs. Tests must initialize it explicitly.
beforeAll(() => initTheme(undefined, false));

function mockTui(rows = 40, columns = 80): TUI {
  return { terminal: { rows, columns }, requestRender: vi.fn() } as unknown as TUI;
}

function ansiTheme() {
  return {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };
}

function fakeSource(overrides: Partial<TranscriptSource> = {}): TranscriptSource {
  return {
    getMessages: () => [{ role: "user", content: "Hello world" }] as unknown as SessionMessage[],
    subscribe: () => () => {},
    streaming: () => undefined,
    getToolDefinition: () => undefined,
    ...overrides,
  };
}

function makeOverlay(opts: { source?: TranscriptSource; done?: (r: undefined) => void; tui?: TUI } = {}) {
  return new TranscriptOverlay({
    tui: opts.tui ?? mockTui(),
    theme: ansiTheme(),
    source: opts.source ?? fakeSource(),
    done: opts.done ?? vi.fn(),
    cwd: "/test/cwd",
    markdownTheme: getMarkdownTheme(),
  });
}

describe("TranscriptOverlay", () => {
  it("renders the transcript content", () => {
    const lines = makeOverlay().render(80);
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
    makeOverlay({ source, tui });
    captured?.();
    expect(tui.requestRender).toHaveBeenCalledOnce();
  });

  it("closes and calls done on Escape", () => {
    const done = vi.fn();
    const overlay = makeOverlay({ done });
    overlay.handleInput("\x1b");
    expect(done).toHaveBeenCalledWith(undefined);
  });

  it("unsubscribes on dispose", () => {
    const unsub = vi.fn();
    const overlay = makeOverlay({ source: fakeSource({ subscribe: () => unsub }) });
    overlay.dispose();
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
    const overlay = makeOverlay({ source, tui });
    overlay.dispose();
    captured?.();
    expect(tui.requestRender).not.toHaveBeenCalled();
  });

  it("renders a tool call through Pi's tool-execution component", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "tc-1", name: "read", arguments: { path: "/x.ts" } }],
        stopReason: "toolUse",
      },
      { role: "toolResult", toolCallId: "tc-1", toolName: "read", content: [{ type: "text", text: "file body" }], isError: false },
    ] as unknown as SessionMessage[];
    const out = makeOverlay({ source: fakeSource({ getMessages: () => messages }) })
      .render(80)
      .join("\n");
    expect(out).toContain("read");
  });

  it("appends the streaming-activity indicator while running", () => {
    const source = fakeSource({
      streaming: () => ({ activeTools: new Map([["k", "read"]]), responseText: "" }),
    });
    const out = makeOverlay({ source }).render(80).join("\n");
    expect(out).toContain("◍");
  });

  it("rebuilds the component tree when the source changes", () => {
    let messages = [{ role: "user", content: "first" }] as unknown as SessionMessage[];
    let captured: (() => void) | undefined;
    const source = fakeSource({
      getMessages: () => messages,
      subscribe: (onChange) => {
        captured = onChange;
        return () => {};
      },
    });
    const overlay = makeOverlay({ source });
    expect(overlay.render(80).join("\n")).toContain("first");
    messages = [{ role: "user", content: "second" }] as unknown as SessionMessage[];
    captured?.();
    expect(overlay.render(80).join("\n")).toContain("second");
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
  function renderCapturedOverlay(ui: ReturnType<typeof makeUI>, width = 80): string[] {
    const factory = ui.custom.mock.calls[0][0] as (
      tui: TUI,
      theme: ReturnType<typeof ansiTheme>,
      kb: unknown,
      done: (r: undefined) => void,
    ) => Component;
    const overlay = factory(mockTui(), ansiTheme(), undefined, vi.fn());
    return overlay.render(width);
  }

  const noReadFile = (): string => {
    throw new Error("readFile not expected in this test");
  };

  it("notifies and skips the overlay when no sessions are navigable", async () => {
    const ui = makeUI();
    const notReady = makeNavigable({ isSessionReady: () => false });
    await new SessionNavigatorHandler().handle({ ui, agents: [notReady], evicted: [], registry, cwd: "/test/cwd", readFile: noReadFile });
    expect(ui.notify).toHaveBeenCalledWith("No subagent sessions to view.", "info");
    expect(ui.custom).not.toHaveBeenCalled();
  });

  it("withholds a redacted native child's session from the picker", async () => {
    const ui = makeUI();
    const record = makeNavigable({
      description: "SECRET TASK BODY",
      agentMessages: [{ role: "assistant", content: "SECRET CHILD RESULT" }] as unknown as SessionMessage[],
      isParentResultRedacted: true,
    });

    await new SessionNavigatorHandler().handle({ ui, agents: [record], evicted: [], registry, cwd: "/test/cwd", readFile: noReadFile });

    expect(ui.notify).toHaveBeenCalledWith("No subagent sessions to view.", "info");
    expect(ui.select).not.toHaveBeenCalled();
    expect(ui.custom).not.toHaveBeenCalled();
  });

  it("does not open the overlay when the operator cancels the picker", async () => {
    const ui = makeUI(undefined);
    await new SessionNavigatorHandler().handle({ ui, agents: [makeNavigable()], evicted: [], registry, cwd: "/test/cwd", readFile: noReadFile });
    expect(ui.select).toHaveBeenCalledOnce();
    expect(ui.custom).not.toHaveBeenCalled();
  });

  it("opens a read-only overlay sourced from the picked record", async () => {
    const messages = [{ role: "assistant", content: [{ type: "text", text: "picked agent reply" }] }] as unknown as SessionMessage[];
    const record = makeNavigable({ agentMessages: messages });
    const [label] = (() => {
      // The handler labels entries identically to listNavigableAgents.
      return [
        "Agent (Test task) · 2 tools · completed · 3.0s",
      ];
    })();
    const ui = makeUI(label);

    await new SessionNavigatorHandler().handle({ ui, agents: [record], evicted: [], registry, cwd: "/test/cwd", readFile: noReadFile });

    expect(ui.custom).toHaveBeenCalledOnce();
    // Invariant #423: the handler is a reactive consumer — it sources the
    // transcript and never reads tool definitions off the record itself; only
    // the overlay does, lazily, through the TranscriptSource at render time.
    expect(record.getToolDefinition).not.toHaveBeenCalled();
    // Invoke the captured component factory and render to confirm it is sourced from the picked record.
    expect(renderCapturedOverlay(ui).some((l) => l.includes("picked agent reply"))).toBe(true);
  });

  it("opens an overlay sourced from the persisted file when an evicted agent is picked", async () => {
    const jsonl = [
      { type: "session", version: 3, id: "s1", timestamp: "2026-06-23T00:00:00Z", cwd: "/proj" },
      { type: "message", id: "m1", parentId: null, timestamp: "2026-06-23T00:00:01Z", message: { role: "assistant", content: [{ type: "text", text: "evicted reply" }] } },
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n");
    const readFile = vi.fn(() => jsonl);
    const evicted = [
      { id: "e1", type: "general-purpose", description: "Old task", status: "completed" as const, startedAt: 1000, completedAt: 4000, toolUses: 5, outputFile: "/tasks/e1.jsonl" },
    ];
    const ui = makeUI("Agent (Old task) · 5 tools · completed · 3.0s · evicted (snapshot)");

    await new SessionNavigatorHandler().handle({ ui, agents: [], evicted, registry, cwd: "/test/cwd", readFile });

    expect(readFile).toHaveBeenCalledWith("/tasks/e1.jsonl");
    expect(ui.custom).toHaveBeenCalledOnce();
    expect(renderCapturedOverlay(ui).some((l) => l.includes("evicted reply"))).toBe(true);
  });

  it("notifies and skips the overlay when the session file cannot be read", async () => {
    const readFile = vi.fn(() => {
      throw new Error("ENOENT");
    });
    const evicted = [
      { id: "e1", type: "general-purpose", description: "Old task", status: "completed" as const, startedAt: 1000, completedAt: 4000, toolUses: 5, outputFile: "/tasks/e1.jsonl" },
    ];
    const ui = makeUI("Agent (Old task) · 5 tools · completed · 3.0s · evicted (snapshot)");

    await new SessionNavigatorHandler().handle({ ui, agents: [], evicted, registry, cwd: "/test/cwd", readFile });

    expect(ui.notify).toHaveBeenCalledWith("Could not read the session transcript file.", "error");
    expect(ui.custom).not.toHaveBeenCalled();
  });
});
