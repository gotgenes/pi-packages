import { getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { type Component, Container, type TUI } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { AgentTypeRegistry } from "#src/config/agent-types";
import type { AgentSessionEvent, SessionMessage } from "#src/types";
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


function assistantSessionEvent(
  type: "message_start" | "message_update" | "message_end",
  content: { type: "text"; text: string } | { type: "thinking"; thinking: string },
  timestamp = 1,
): AgentSessionEvent {
  const message = {
    role: "assistant",
    content: [content],
    stopReason: "stop",
    timestamp,
  };
  if (type !== "message_update") return { type, message } as unknown as AgentSessionEvent;
  const delta = content.type === "text" ? content.text : content.thinking;
  const assistantMessageEvent = {
    type: content.type === "text" ? "text_delta" : "thinking_delta",
    delta,
  };
  return { type, message, assistantMessageEvent } as unknown as AgentSessionEvent;
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
    let captured: ((event?: AgentSessionEvent) => void) | undefined;
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
    captured?.({ type: "message_end" } as AgentSessionEvent);
    expect(overlay.render(80).join("\n")).toContain("second");
  });

  describe("large-transcript performance invariants", () => {
    it("reuses rendered transcript lines across paints and scrolling at the same width", () => {
      const messages = Array.from(
        { length: 200 },
        (_, i) => ({ role: "user", content: `message ${i}\n${"body\n".repeat(20)}` }),
      ) as unknown as SessionMessage[];
      // Overlay renders at 90% of the terminal width in production. Keep the
      // terminal wider than the component width so input must reuse the actual
      // rendered layout rather than recomputing at terminal width.
      const overlay = makeOverlay({
        source: fakeSource({ getMessages: () => messages }),
        tui: mockTui(40, 160),
      });
      const containerRender = vi.spyOn(Container.prototype, "render");
      try {
        const initialOutput = overlay.render(80);
        const initialRenderCalls = containerRender.mock.calls.length;

        overlay.render(80);
        overlay.handleInput("\x1b[A");
        const scrolledOutput = overlay.render(80);

        expect(containerRender).toHaveBeenCalledTimes(initialRenderCalls);
        expect(scrolledOutput).not.toEqual(initialOutput);
      } finally {
        containerRender.mockRestore();
      }
    });

    it("invalidates rendered transcript lines when width changes", () => {
      const overlay = makeOverlay();
      const containerRender = vi.spyOn(Container.prototype, "render");
      try {
        overlay.render(80);
        const initialRenderCalls = containerRender.mock.calls.length;

        overlay.render(100);

        expect(containerRender.mock.calls.length).toBeGreaterThan(initialRenderCalls);
      } finally {
        containerRender.mockRestore();
      }
    });

    it("does not rebuild the transcript tree for high-frequency streaming updates", () => {
      const tui = mockTui();
      const messages = [{ role: "user", content: "stable" }] as unknown as SessionMessage[];
      const getMessages = vi.fn(() => messages);
      let captured: ((event: AgentSessionEvent) => void) | undefined;
      const source = fakeSource({
        getMessages,
        subscribe: (onChange) => {
          captured = onChange;
          return () => {};
        },
      });
      makeOverlay({ source, tui });
      captured?.(assistantSessionEvent("message_start", { type: "text", text: "" }));
      const setupMessageReads = getMessages.mock.calls.length;

      captured?.(assistantSessionEvent("message_update", { type: "text", text: "token" }));
      captured?.(assistantSessionEvent("message_update", { type: "text", text: "token two" }));

      expect(getMessages).toHaveBeenCalledTimes(setupMessageReads);
      expect(tui.requestRender).toHaveBeenCalledTimes(3);
    });


    it("keeps the lightweight streaming row live while settled transcript lines stay cached", () => {
      let responseText = "first token";
      let captured: ((event: AgentSessionEvent) => void) | undefined;
      const messages = [{ role: "user", content: "settled" }] as unknown as SessionMessage[];
      const source = fakeSource({
        getMessages: () => messages,
        streaming: () => ({ activeTools: new Map(), responseText }),
        subscribe: (onChange) => {
          captured = onChange;
          return () => {};
        },
      });
      const overlay = makeOverlay({ source });
      expect(overlay.render(80).join("\n")).toContain("first token");

      const containerRender = vi.spyOn(Container.prototype, "render");
      try {
        responseText = "second token";
        captured?.({ type: "tool_execution_update" } as AgentSessionEvent);

        expect(overlay.render(80).join("\n")).toContain("second token");
        expect(containerRender).not.toHaveBeenCalled();
      } finally {
        containerRender.mockRestore();
      }
    });


    it("streams the current rich assistant message without rebuilding settled history", () => {
      let captured: ((event: AgentSessionEvent) => void) | undefined;
      const getMessages = vi.fn(
        () => [{ role: "user", content: "settled history" }] as unknown as SessionMessage[],
      );
      const source = fakeSource({
        getMessages,
        streaming: () => ({ activeTools: new Map(), responseText: "" }),
        subscribe: (onChange) => {
          captured = onChange;
          return () => {};
        },
      });
      const overlay = makeOverlay({ source });
      captured?.(assistantSessionEvent("message_start", { type: "thinking", thinking: "" }));
      captured?.(
        assistantSessionEvent("message_update", {
          type: "thinking",
          thinking: "live full thinking block",
        }),
      );
      const setupMessageReads = getMessages.mock.calls.length;

      expect(overlay.render(80).join("\n")).toContain("live full thinking block");

      captured?.(
        assistantSessionEvent("message_update", {
          type: "thinking",
          thinking: "updated full thinking block",
        }),
      );
      expect(overlay.render(80).join("\n")).toContain("updated full thinking block");
      expect(getMessages).toHaveBeenCalledTimes(setupMessageReads);
    });

    it("consumes newly settled messages when a message settles", () => {
      const messages = [{ role: "user", content: "stable" }] as unknown as SessionMessage[];
      let captured: ((event: AgentSessionEvent) => void) | undefined;
      const source = fakeSource({
        getMessages: () => messages,
        subscribe: (onChange) => {
          captured = onChange;
          return () => {};
        },
      });
      const overlay = makeOverlay({ source });
      overlay.render(80);

      const settled = { role: "user", content: "just settled" } as unknown as SessionMessage;
      messages.push(settled);
      captured?.({ type: "message_end", message: settled } as unknown as AgentSessionEvent);

      expect(overlay.render(80).join("\n")).toContain("just settled");
    });
  });

  describe("incremental settlement", () => {
    function liveFixture(initial: SessionMessage[]) {
      const messages = initial;
      let captured: ((event?: AgentSessionEvent) => void) | undefined;
      const source = fakeSource({
        getMessages: () => messages,
        subscribe: (onChange) => {
          captured = onChange;
          return () => {};
        },
      });
      return {
        messages,
        source,
        emit: (event: AgentSessionEvent | undefined) => captured?.(event),
      };
    }

    it("renders only the newly settled message's components when a message settles", () => {
      const fixture = liveFixture(
        Array.from(
          { length: 200 },
          (_, i) => ({ role: "user", content: `message ${i}\n${"body\n".repeat(20)}` }),
        ) as unknown as SessionMessage[],
      );
      const overlay = makeOverlay({ source: fixture.source, tui: mockTui(40, 160) });
      overlay.render(80);

      const containerRender = vi.spyOn(Container.prototype, "render");
      try {
        const settled = { role: "user", content: "fresh settled message" } as unknown as SessionMessage;
        fixture.messages.push(settled);
        fixture.emit({ type: "message_end", message: settled } as unknown as AgentSessionEvent);

        expect(overlay.render(80).join("\n")).toContain("fresh settled message");
        expect(containerRender.mock.calls.length).toBeLessThanOrEqual(4);
      } finally {
        containerRender.mockRestore();
      }
    });

    it("updates only the affected tool block when its result settles", () => {
      const assistant = {
        role: "assistant",
        content: [{ type: "toolCall", id: "tc-1", name: "read", arguments: { path: "/x.ts" } }],
        stopReason: "toolUse",
        timestamp: 1,
      } as unknown as SessionMessage;
      const padding = Array.from(
        { length: 50 },
        (_, i) => ({ role: "user", content: `filler ${i}` }),
      ) as unknown as SessionMessage[];
      const fixture = liveFixture([...padding, assistant]);
      const overlay = makeOverlay({ source: fixture.source, tui: mockTui(40, 160) });
      const before = overlay.render(80).join("\n");

      const containerRender = vi.spyOn(Container.prototype, "render");
      try {
        const result = {
          role: "toolResult",
          toolCallId: "tc-1",
          toolName: "read",
          content: [{ type: "text", text: "tool result body" }],
          isError: false,
        } as unknown as SessionMessage;
        fixture.messages.push(result);
        fixture.emit({ type: "message_end", message: result } as unknown as AgentSessionEvent);

        const after = overlay.render(80).join("\n");
        expect(after).not.toEqual(before);
        expect(containerRender.mock.calls.length).toBeLessThanOrEqual(4);
      } finally {
        containerRender.mockRestore();
      }
    });

    it("produces the same lines as a freshly built overlay after incremental settles", () => {
      const user = (text: string) => ({ role: "user", content: text }) as unknown as SessionMessage;
      const assistant = {
        role: "assistant",
        content: [
          { type: "text", text: "let me read that" },
          { type: "toolCall", id: "tc-9", name: "read", arguments: { path: "/y.ts" } },
        ],
        stopReason: "toolUse",
        timestamp: 5,
      } as unknown as SessionMessage;
      const result = {
        role: "toolResult",
        toolCallId: "tc-9",
        toolName: "read",
        content: [{ type: "text", text: "y file body" }],
        isError: false,
      } as unknown as SessionMessage;
      const fixture = liveFixture([user("alpha")]);
      const overlay = makeOverlay({ source: fixture.source });
      overlay.render(80);

      for (const settled of [assistant, result, user("beta"), user("gamma")]) {
        fixture.messages.push(settled);
        fixture.emit({ type: "message_end", message: settled } as unknown as AgentSessionEvent);
      }

      const fresh = makeOverlay({
        source: fakeSource({ getMessages: () => fixture.messages }),
      });
      expect(overlay.render(80)).toEqual(fresh.render(80));
    });

    it("re-renders settled history on agent_end to capture in-place mutations", () => {
      const message = { role: "user", content: "before mutation" } as unknown as SessionMessage;
      const fixture = liveFixture([message]);
      const overlay = makeOverlay({ source: fixture.source });
      expect(overlay.render(80).join("\n")).toContain("before mutation");

      (message as unknown as { content: string }).content = "after mutation";
      fixture.emit({ type: "agent_end" } as unknown as AgentSessionEvent);

      expect(overlay.render(80).join("\n")).toContain("after mutation");
    });

    it("falls back to a full rebuild when settled history shrinks under the overlay", () => {
      let messages = [
        { role: "user", content: "one" },
        { role: "user", content: "two" },
      ] as unknown as SessionMessage[];
      let captured: ((event?: AgentSessionEvent) => void) | undefined;
      const source = fakeSource({
        getMessages: () => messages,
        subscribe: (onChange) => {
          captured = onChange;
          return () => {};
        },
      });
      const overlay = makeOverlay({ source });
      expect(overlay.render(80).join("\n")).toContain("two");

      messages = [{ role: "user", content: "rewritten" }] as unknown as SessionMessage[];
      captured?.({ type: "turn_end" } as unknown as AgentSessionEvent);

      const out = overlay.render(80).join("\n");
      expect(out).toContain("rewritten");
      expect(out).not.toContain("two");
    });
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
    const notReady = makeNavigable({ isSessionReady: () => false, outputFile: undefined });
    await new SessionNavigatorHandler().handle({ ui, agents: [notReady], registry, cwd: "/test/cwd", readFile: noReadFile });
    expect(ui.notify).toHaveBeenCalledWith("No subagent sessions to view.", "info");
    expect(ui.custom).not.toHaveBeenCalled();
  });

  it("does not open the overlay when the operator cancels the picker", async () => {
    const ui = makeUI(undefined);
    await new SessionNavigatorHandler().handle({ ui, agents: [makeNavigable()], registry, cwd: "/test/cwd", readFile: noReadFile });
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

    await new SessionNavigatorHandler().handle({ ui, agents: [record], registry, cwd: "/test/cwd", readFile: noReadFile });

    expect(ui.custom).toHaveBeenCalledOnce();
    // Invariant #423: the handler is a reactive consumer — it sources the
    // transcript and never reads tool definitions off the record itself; only
    // the overlay does, lazily, through the TranscriptSource at render time.
    expect(record.getToolDefinition).not.toHaveBeenCalled();
    // Invoke the captured component factory and render to confirm it is sourced from the picked record.
    expect(renderCapturedOverlay(ui).some((l) => l.includes("picked agent reply"))).toBe(true);
  });

  it("opens an overlay sourced from the persisted file when a released agent is picked", async () => {
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
    expect(renderCapturedOverlay(ui).some((l) => l.includes("released reply"))).toBe(true);
  });

  it("notifies and skips the overlay when the session file cannot be read", async () => {
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
