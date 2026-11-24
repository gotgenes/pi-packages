import { getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, type TuiMouseEvent, visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentSessionEvent, SessionMessage } from "#src/types";
import type { TranscriptSource } from "#src/ui/session-navigation";
import { TranscriptContent } from "#src/ui/transcript-content";
import { fakeSource, mockTui } from "#test/helpers/transcript-fixtures";

// Pi's per-entry components read the global interactive theme; Pi initializes it
// at startup before any command runs. Tests must initialize it explicitly.
beforeAll(() => initTheme(undefined, false));

const WIDTH = 76;

function makeContent(source: TranscriptSource = fakeSource(), toolsExpanded = false): TranscriptContent {
  return new TranscriptContent({
    tui: mockTui(),
    cwd: "/test/cwd",
    markdownTheme: getMarkdownTheme(),
    source,
    toolsExpanded,
  });
}

function contentFrom(messages: SessionMessage[], toolsExpanded = false): TranscriptContent {
  return makeContent(fakeSource({ getMessages: () => messages }), toolsExpanded);
}

function allRows(content: TranscriptContent, width = WIDTH): string[] {
  return content.slice(width, 0, content.lineCount(width));
}

function rendered(content: TranscriptContent, width = WIDTH): string {
  return allRows(content, width).join("\n");
}

function manyMessages(count: number): SessionMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    role: "user",
    content: `message ${i}\n\nA paragraph long enough to wrap at the test width and produce several rows.`,
  })) as unknown as SessionMessage[];
}

describe("TranscriptContent", () => {
  describe("message mapping", () => {
    it("renders a user message", () => {
      expect(rendered(makeContent())).toContain("Hello world");
    });

    it("renders a tool call and its result through Pi's tool-execution component", () => {
      const messages = [
        {
          role: "assistant",
          content: [{ type: "toolCall", id: "tc-1", name: "read", arguments: { path: "/x.ts" } }],
          stopReason: "toolUse",
        },
        {
          role: "toolResult",
          toolCallId: "tc-1",
          toolName: "read",
          content: [{ type: "text", text: "file body" }],
          isError: false,
        },
      ] as unknown as SessionMessage[];

      // Expanded: a collapsed `read` hides its result body.
      const out = rendered(contentFrom(messages, true));

      expect(out).toContain("read");
      expect(out).toContain("file body");
    });

    it("renders a skill invocation and the user message that follows it", () => {
      const messages = [
        {
          role: "user",
          content: '<skill name="testing" location="/skills/testing">\nskill body\n</skill>\n\nrun the suite',
        },
      ] as unknown as SessionMessage[];

      const out = rendered(contentFrom(messages));

      expect(out).toContain("testing");
      expect(out).toContain("run the suite");
    });

    it("renders a bash execution with its output", () => {
      const messages = [
        { role: "bashExecution", command: "ls -la", output: "total 0", exitCode: 0 },
      ] as unknown as SessionMessage[];

      expect(rendered(contentFrom(messages))).toContain("ls -la");
    });

    it("skips custom-role messages, which need the child session's renderer registry", () => {
      const messages = [
        { role: "custom", customType: "task-notification", content: "invisible payload" },
        { role: "user", content: "visible" },
      ] as unknown as SessionMessage[];

      const out = rendered(contentFrom(messages));

      expect(out).not.toContain("invisible payload");
      expect(out).toContain("visible");
    });
  });

  describe("built-in tool renderers", () => {
    it("draws a built-in tool with Pi's renderer when the source has no definition for it", () => {
      // A released agent's snapshot source has no tool registry; without a
      // definition Pi prints the call's arguments as JSON.
      const out = rendered(contentFrom([toolCallMessage("tc-1"), toolResultMessage("tc-1", "file body")]));

      expect(out).toContain("read");
      expect(out).not.toContain('"path"');
    });
  });

  describe("expansion", () => {
    const readCall = (): SessionMessage[] => [toolCallMessage("tc-1"), toolResultMessage("tc-1", "file body")];
    const compaction = {
      role: "compactionSummary",
      summary: "the compacted summary",
      tokensBefore: 1000,
      timestamp: 1,
    } as unknown as SessionMessage;
    const skill = userMessage('<skill name="testing" location="/skills/testing">\nthe skill body\n</skill>\n\nrun the suite');
    // Pi previews a collapsed bash run by its last 20 lines, so only the first is hidden.
    const bash = {
      role: "bashExecution",
      command: "seq 30",
      output: Array.from({ length: 30 }, (_, i) => `out ${String(i + 1).padStart(2, "0")}`).join("\n"),
      exitCode: 0,
    } as unknown as SessionMessage;

    describe("collapsed", () => {
      it("hides a tool result's body", () => {
        expect(rendered(contentFrom(readCall(), false))).not.toContain("file body");
      });

      it("hides a compaction summary's text", () => {
        expect(rendered(contentFrom([compaction], false))).not.toContain("the compacted summary");
      });

      it("hides a skill's body", () => {
        expect(rendered(contentFrom([skill], false))).not.toContain("the skill body");
      });

      it("previews a bash run by its last lines", () => {
        expect(rendered(contentFrom([bash], false))).not.toContain("out 01");
      });
    });

    describe("expanded", () => {
      it("shows a tool result's body", () => {
        expect(rendered(contentFrom(readCall(), true))).toContain("file body");
      });

      it("shows a compaction summary's text", () => {
        expect(rendered(contentFrom([compaction], true))).toContain("the compacted summary");
      });

      it("shows a skill's body", () => {
        expect(rendered(contentFrom([skill], true))).toContain("the skill body");
      });

      it("shows a bash run's whole output", () => {
        expect(rendered(contentFrom([bash], true))).toContain("out 01");
      });

      it("expands a tool call that settles in a later batch", () => {
        const history: SessionMessage[] = [userMessage("read the file")];
        const content = makeContent(fakeSource({ getMessages: () => history }), true);
        allRows(content);

        history.push(...readCall());
        content.apply(settled());

        expect(rendered(content)).toContain("file body");
      });

      it("keeps blocks expanded when agent_end rebuilds the transcript", () => {
        const history = readCall();
        const content = makeContent(fakeSource({ getMessages: () => history }), true);
        allRows(content);

        content.apply({ type: "agent_end" } as AgentSessionEvent);

        expect(rendered(content)).toContain("file body");
      });

      it("keeps blocks expanded when history is replaced by a shorter one", () => {
        let history: SessionMessage[] = [userMessage("a"), userMessage("b"), userMessage("c")];
        const content = makeContent(fakeSource({ getMessages: () => history }), true);
        allRows(content);

        history = readCall();
        content.apply(settled());

        expect(rendered(content)).toContain("file body");
      });
    });

    describe("toggling", () => {
      it("expands every block on one toggle and collapses them on the next", () => {
        const content = contentFrom(readCall(), false);
        allRows(content);

        content.toggleExpanded();
        const expanded = rendered(content);
        content.toggleExpanded();

        expect(expanded).toContain("file body");
        expect(rendered(content)).not.toContain("file body");
      });

      it("mounts a block that settles after a toggle in the toggled state", () => {
        const history: SessionMessage[] = [userMessage("read the file")];
        const content = makeContent(fakeSource({ getMessages: () => history }), false);
        allRows(content);
        content.toggleExpanded();

        history.push(...readCall());
        content.apply(settled());

        expect(rendered(content)).toContain("file body");
      });
    });

    describe("clicks", () => {
      afterEach(() => vi.restoreAllMocks());

      /** A left click on transcript row `y`, as the pane forwards it. */
      const click = (y: number, overrides: Partial<TuiMouseEvent> = {}): TuiMouseEvent => ({
        type: "click",
        button: "left",
        x: 3,
        y,
        screenX: 3,
        screenY: y,
        width: WIDTH,
        height: 1,
        shift: false,
        alt: false,
        ctrl: false,
        ...overrides,
      });
      const rowContaining = (content: TranscriptContent, text: string): number =>
        allRows(content).findIndex((row) => row.includes(text));

      it("toggles the collapsed tool call a click lands on", () => {
        const content = contentFrom([userMessage("first"), ...readCall()], false);

        const result = content.handleMouse(click(rowContaining(content, "/x.ts")));

        expect(result).toEqual({ handled: true });
        expect(rendered(content)).toContain("file body");
      });

      it("leaves a click on a block with no click handling to the host", () => {
        const content = contentFrom([userMessage("first"), ...readCall()], false);

        expect(content.handleMouse(click(rowContaining(content, "first")))).toBeUndefined();
      });

      it("leaves a click below the settled history to the host", () => {
        const source = fakeSource({
          getMessages: readCall,
          streaming: () => ({ activeTools: new Map([["k", "read"]]), responseText: "" }),
        });
        const content = makeContent(source, false);

        expect(content.handleMouse(click(rowContaining(content, "◍")))).toBeUndefined();
      });

      it("re-renders only the clicked block", () => {
        const history = [...manyMessages(20), ...readCall()];
        const content = contentFrom(history, false);
        const y = rowContaining(content, "/x.ts");
        const fullRebuild = fullRebuildRenderCount(history);

        const render = vi.spyOn(Container.prototype, "render");
        content.handleMouse(click(y));
        allRows(content);

        expect(render.mock.calls.length).toBeGreaterThan(0);
        expect(render.mock.calls.length).toBeLessThan(fullRebuild);
      });
    });
  });

  // The leading-spacer decision is a whole-transcript property that per-message
  // blocks cannot read off their own container, so it is hoisted onto the
  // content object. The equivalence test cannot catch a bug here — both of its
  // sides run this same code — so assert the rows directly.
  describe("user-message separation", () => {
    it("does not lead the transcript with a blank separator row", () => {
      const rows = allRows(contentFrom([userMessage("first question")]));

      expect(rows[0]).not.toBe("");
    });

    it("costs exactly one extra row when a user message follows other content", () => {
      const alone = allRows(contentFrom([userMessage("a question")])).length;
      const assistantOnly = allRows(contentFrom([assistantText("an answer")])).length;

      const together = allRows(contentFrom([assistantText("an answer"), userMessage("a question")])).length;

      expect(together).toBe(assistantOnly + alone + 1);
    });

    it("still separates a user message that settles in a later batch", () => {
      const alone = allRows(contentFrom([userMessage("a question")])).length;
      const history = [assistantText("an answer")];
      const content = makeContent(fakeSource({ getMessages: () => history }));
      const assistantOnly = allRows(content).length;

      history.push(userMessage("a question"));
      content.apply(settled());

      // Compared against the arithmetic, not against a freshly built transcript:
      // the hoisted flag has to survive the batch boundary, and a fresh build
      // would carry the same bug on both sides of that comparison.
      expect(allRows(content).length).toBe(assistantOnly + alone + 1);
    });
  });

  describe("live tail", () => {
    it("appends the streaming-activity row while the agent is running", () => {
      const source = fakeSource({
        streaming: () => ({ activeTools: new Map([["k", "read"]]), responseText: "" }),
      });

      expect(rendered(makeContent(source))).toContain("◍");
    });

    it("omits the streaming-activity row when the agent is not running", () => {
      expect(rendered(makeContent())).not.toContain("◍");
    });
  });

  describe("source changes", () => {
    it("picks up new messages on apply", () => {
      let messages = [{ role: "user", content: "first" }] as unknown as SessionMessage[];
      const content = makeContent(fakeSource({ getMessages: () => messages }));
      expect(rendered(content)).toContain("first");

      messages = [{ role: "user", content: "second" }] as unknown as SessionMessage[];
      content.apply();

      expect(rendered(content)).toContain("second");
    });
  });

  describe("in-flight message", () => {
    afterEach(() => vi.restoreAllMocks());

    it("renders streaming text before it settles into the history", () => {
      const content = contentFrom(manyMessages(2));

      content.apply(partialAssistant("partial answer so far"));

      expect(rendered(content)).toContain("partial answer so far");
    });

    it("renders streaming thinking traces", () => {
      const content = contentFrom(manyMessages(2));

      content.apply(thinkingAssistant("weighing the options"));

      expect(rendered(content)).toContain("weighing the options");
    });

    it("replaces the in-flight rows on each delta rather than appending them", () => {
      const content = contentFrom(manyMessages(2));

      content.apply(partialAssistant("first chunk"));
      content.apply(partialAssistant("first chunk and second chunk"));
      const out = rendered(content);

      expect(out).toContain("first chunk and second chunk");
      expect(out.match(/first chunk/g)).toHaveLength(1);
    });

    it("does not re-read the message history on a streaming delta", () => {
      const messages = manyMessages(5);
      const getMessages = vi.fn(() => messages);
      const content = makeContent(fakeSource({ getMessages }));
      allRows(content);
      getMessages.mockClear();

      content.apply(partialAssistant("streaming"));
      allRows(content);

      expect(getMessages).not.toHaveBeenCalled();
    });

    it("re-renders far less than a full rebuild on a streaming delta", () => {
      const history = manyMessages(20);
      const content = makeContent(fakeSource({ getMessages: () => history }));
      allRows(content);
      const fullRebuild = fullRebuildRenderCount(history);

      const render = vi.spyOn(Container.prototype, "render");
      content.apply(partialAssistant("streaming"));
      allRows(content);

      expect(render.mock.calls.length).toBeLessThan(fullRebuild);
    });

    it("drops the in-flight rows once the message settles", () => {
      let messages = manyMessages(2);
      const content = makeContent(fakeSource({ getMessages: () => messages }));
      content.apply(partialAssistant("settling answer"));

      messages = [
        ...messages,
        {
          role: "assistant",
          content: [{ type: "text", text: "settling answer" }],
          stopReason: "stop",
          timestamp: 1,
        } as unknown as SessionMessage,
      ];
      content.apply({ type: "message_end" } as AgentSessionEvent);
      const out = rendered(content);

      expect(out).toContain("settling answer");
      expect(out.match(/settling answer/g)).toHaveLength(1);
    });

    it("keeps the activity row below the in-flight message", () => {
      const source = fakeSource({
        getMessages: () => manyMessages(2),
        streaming: () => ({ activeTools: new Map(), responseText: "partial answer" }),
      });
      const content = makeContent(source);
      content.apply(partialAssistant("partial answer"));

      const rows = allRows(content);

      expect(rows.findIndex((row) => row.includes("partial answer"))).toBeLessThan(
        rows.findIndex((row) => row.includes("◍")),
      );
    });
  });

  describe("width handling", () => {
    it("returns no rows at a non-positive width", () => {
      expect(makeContent().lineCount(0)).toBe(0);
      expect(makeContent().slice(0, 0, 10)).toEqual([]);
    });

    it("truncates every row to the requested width", () => {
      const messages = [
        { role: "user", content: "x".repeat(500) },
      ] as unknown as SessionMessage[];

      const lines = allRows(contentFrom(messages), 40);

      expect(lines.every((line) => visibleWidth(line) <= 40)).toBe(true);
    });
  });

  describe("viewport slicing", () => {
    it("returns only the requested window", () => {
      const content = contentFrom(manyMessages(20));
      const all = allRows(content);

      expect(content.slice(WIDTH, 4, 3)).toEqual(all.slice(4, 7));
    });

    it("clamps a window that runs past the last row", () => {
      const content = contentFrom(manyMessages(3));
      const total = content.lineCount(WIDTH);

      expect(content.slice(WIDTH, total - 1, 10)).toEqual(allRows(content).slice(total - 1));
    });

    it("includes the live activity row in the last window", () => {
      const source = fakeSource({
        getMessages: () => manyMessages(3),
        streaming: () => ({ activeTools: new Map([["k", "read"]]), responseText: "" }),
      });
      const content = makeContent(source);
      const total = content.lineCount(WIDTH);

      expect(content.slice(WIDTH, total - 2, 2).join("\n")).toContain("◍");
    });
  });

  describe("incremental settling", () => {
    afterEach(() => vi.restoreAllMocks());

    /** A source over a mutable array, as a live record's history behaves. */
    function growingSource(messages: SessionMessage[]) {
      return fakeSource({ getMessages: () => messages });
    }

    it("matches a freshly built transcript line for line", () => {
      const history: SessionMessage[] = [];
      const content = makeContent(growingSource(history));

      for (const message of richTranscript()) {
        history.push(message);
        content.apply(settled());
      }

      expect(allRows(content)).toEqual(allRows(contentFrom(richTranscript())));
    });

    it("renders only the newly settled message when one arrives", () => {
      const history = manyMessages(20);
      const content = makeContent(growingSource(history));
      allRows(content);
      history.push(...manyMessages(1));
      // Measured before any spy is installed — a spy nested inside another
      // inflates the baseline and the comparison stops discriminating.
      const fullRebuild = fullRebuildRenderCount(history);

      const render = vi.spyOn(Container.prototype, "render");
      content.apply(settled());
      allRows(content);

      expect(render.mock.calls.length).toBeGreaterThan(0);
      expect(render.mock.calls.length).toBeLessThan(fullRebuild);
    });

    it("re-renders only the affected block when a tool result lands", () => {
      const history: SessionMessage[] = [...manyMessages(20), toolCallMessage("tc-1")];
      // Expanded: a collapsed `read` hides the body this test watches land.
      const content = makeContent(growingSource(history), true);
      content.apply(settled());
      allRows(content);
      history.push(toolResultMessage("tc-1", "tool output body"));
      const fullRebuild = fullRebuildRenderCount(history);

      const render = vi.spyOn(Container.prototype, "render");
      content.apply(settled());
      const rows = allRows(content).join("\n");

      expect(rows).toContain("tool output body");
      expect(render.mock.calls.length).toBeLessThan(fullRebuild);
    });

    it("keeps consumed messages aligned across a skipped custom message", () => {
      const history: SessionMessage[] = [];
      const content = makeContent(growingSource(history));

      history.push({ role: "custom", customType: "note", content: "invisible" } as unknown as SessionMessage);
      content.apply(settled());
      history.push({ role: "user", content: "after the custom message" } as unknown as SessionMessage);
      content.apply(settled());

      expect(rendered(content)).toContain("after the custom message");
      expect(rendered(content)).not.toContain("invisible");
    });

    it("rebuilds when history is replaced wholesale", () => {
      let history = manyMessages(5);
      const content = makeContent(fakeSource({ getMessages: () => history }));
      allRows(content);

      // Compaction and branching swap the array for a new one rather than
      // appending, so the consumed prefix no longer mirrors the source.
      history = [{ role: "user", content: "post-compaction history" } as unknown as SessionMessage];
      content.apply(settled());

      const out = rendered(content);
      expect(out).toContain("post-compaction history");
      expect(out).not.toContain("message 0");
    });

    it("rebuilds on agent_end to pick up in-place message mutations", () => {
      const history = manyMessages(3);
      const content = makeContent(growingSource(history));
      allRows(content);

      (history[1] as unknown as { content: string }).content = "mutated in place";
      content.apply({ type: "agent_end" } as AgentSessionEvent);

      expect(rendered(content)).toContain("mutated in place");
    });

    it("rebuilds on compaction_end", () => {
      const history = manyMessages(3);
      const content = makeContent(growingSource(history));
      allRows(content);

      (history[1] as unknown as { content: string }).content = "replaced by compaction";
      content.apply({ type: "compaction_end" } as AgentSessionEvent);

      expect(rendered(content)).toContain("replaced by compaction");
    });
  });

  // White-box pins: these are the only assertions that catch a silent return to
  // re-rendering the whole transcript on every paint and keypress.
  describe("render accounting", () => {
    afterEach(() => vi.restoreAllMocks());

    it("renders the component tree once across repeated paints and scrolls", () => {
      const content = contentFrom(manyMessages(20));
      const render = vi.spyOn(Container.prototype, "render");

      content.slice(WIDTH, 0, 10);
      const afterFirstPaint = render.mock.calls.length;
      content.slice(WIDTH, 0, 10);
      content.slice(WIDTH, 5, 10);
      content.lineCount(WIDTH);

      expect(afterFirstPaint).toBeGreaterThan(0);
      expect(render.mock.calls.length).toBe(afterFirstPaint);
    });

    it("does not consult the source's message history while painting", () => {
      const messages = manyMessages(5);
      const getMessages = vi.fn(() => messages);
      const content = makeContent(fakeSource({ getMessages }));
      getMessages.mockClear();

      content.lineCount(WIDTH);
      content.slice(WIDTH, 0, 10);
      content.slice(WIDTH, 3, 10);

      expect(getMessages).not.toHaveBeenCalled();
    });

    it("re-renders at a new width, then caches that width too", () => {
      const content = contentFrom(manyMessages(20));
      content.slice(WIDTH, 0, 10);
      const render = vi.spyOn(Container.prototype, "render");

      content.slice(WIDTH + 20, 0, 10);
      const afterWidthChange = render.mock.calls.length;
      content.slice(WIDTH + 20, 0, 10);

      expect(afterWidthChange).toBeGreaterThan(0);
      expect(render.mock.calls.length).toBe(afterWidthChange);
    });

    it("re-renders after the source changes", () => {
      let messages = manyMessages(5);
      const content = makeContent(fakeSource({ getMessages: () => messages }));
      content.slice(WIDTH, 0, 10);
      const render = vi.spyOn(Container.prototype, "render");

      messages = manyMessages(6);
      content.apply();
      content.slice(WIDTH, 0, 10);

      expect(render.mock.calls.length).toBeGreaterThan(0);
    });
  });
});

/** A `message_update` carrying an in-flight assistant message with text. */
function partialAssistant(text: string): AgentSessionEvent {
  return {
    type: "message_update",
    message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop", timestamp: 1 },
  } as unknown as AgentSessionEvent;
}

/** A `message_start` carrying an in-flight assistant message with a thinking trace. */
function thinkingAssistant(thinking: string): AgentSessionEvent {
  return {
    type: "message_start",
    message: { role: "assistant", content: [{ type: "thinking", thinking }], stopReason: "stop", timestamp: 1 },
  } as unknown as AgentSessionEvent;
}

/**
 * A settle notification. Pi pushes the finished message into its message array
 * before notifying listeners, so the event body carries nothing the consumer
 * needs beyond its type.
 */
function settled(): AgentSessionEvent {
  return { type: "message_end" } as AgentSessionEvent;
}

function userMessage(text: string): SessionMessage {
  return { role: "user", content: text } as unknown as SessionMessage;
}

function assistantText(text: string): SessionMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    timestamp: 1,
  } as unknown as SessionMessage;
}

function toolCallMessage(id: string): SessionMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id, name: "read", arguments: { path: "/x.ts" } }],
    stopReason: "toolUse",
    timestamp: 1,
  } as unknown as SessionMessage;
}

function toolResultMessage(toolCallId: string, text: string): SessionMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName: "read",
    content: [{ type: "text", text }],
    isError: false,
  } as unknown as SessionMessage;
}

/** One of each role the mapping handles, in a plausible agent-run order. */
function richTranscript(): SessionMessage[] {
  return [
    { role: "user", content: "read the file and summarize it" },
    toolCallMessage("tc-1"),
    toolResultMessage("tc-1", "the file body"),
    {
      role: "assistant",
      content: [{ type: "text", text: "Here is the **summary** you asked for." }],
      stopReason: "stop",
      timestamp: 2,
    },
    { role: "custom", customType: "note", content: "skipped" },
    { role: "bashExecution", command: "ls -la", output: "total 0", exitCode: 0 },
    { role: "user", content: "thanks" },
  ] as unknown as SessionMessage[];
}

/**
 * How many `Container.render` calls a from-scratch build of `messages` costs.
 * Call with no spy installed: `vi.spyOn` over an existing spy double-counts.
 */
function fullRebuildRenderCount(messages: SessionMessage[]): number {
  const fresh = contentFrom([...messages]);
  const render = vi.spyOn(Container.prototype, "render");
  allRows(fresh);
  const count = render.mock.calls.length;
  render.mockRestore();
  return count;
}
