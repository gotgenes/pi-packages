import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTypeRegistry } from "#src/config/agent-types";
import type { PersistedRunSummary } from "#src/persisted-record";
import type { AgentSessionEvent, SessionMessage } from "#src/types";
import { fileSnapshotSource, listNavigableAgents, liveSource, type NavigableSubagent, type TranscriptSource } from "#src/ui/session-navigation";
import { makeNavigable } from "#test/helpers/make-navigable";

const registry = new AgentTypeRegistry(() => new Map());

describe("listNavigableAgents", () => {
  it("returns an empty list for no agents", () => {
    expect(listNavigableAgents([], registry, [])).toEqual([]);
  });

  it("makes a session-ready record a live entry", () => {
    const ready = makeNavigable({ id: "ready", isSessionReady: () => true });
    const entries = listNavigableAgents([ready], registry, []);
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry.kind).toBe("live");
    expect(entry.kind === "live" && entry.record).toBe(ready);
  });

  it("makes a released record (no live session, has outputFile) a snapshot entry", () => {
    const released = makeNavigable({
      id: "released",
      isSessionReady: () => false,
      outputFile: "/tasks/released-1.jsonl",
      description: "Investigate the bug",
      toolUses: 3,
    });
    const [entry] = listNavigableAgents([released], registry, []);
    expect(entry.kind).toBe("snapshot");
    expect(entry.kind === "snapshot" && entry.outputFile).toBe("/tasks/released-1.jsonl");
    expect(entry.label).toBe("Agent (Investigate the bug) · 3 tools · completed · 3.0s · session released (snapshot)");
  });

  it("drops a record with neither a live session nor an outputFile", () => {
    const gone = makeNavigable({ id: "gone", isSessionReady: () => false, outputFile: undefined });
    expect(listNavigableAgents([gone], registry, [])).toEqual([]);
  });

  it("builds a label with name, description, tool count, status, and duration", () => {
    const record = makeNavigable({
      type: "general-purpose",
      description: "Investigate the bug",
      toolUses: 3,
      status: "completed",
      startedAt: 1000,
      completedAt: 4000,
    });
    const [entry] = listNavigableAgents([record], registry, []);
    // getDisplayName resolves "general-purpose" against the empty registry to its fallback display name.
    expect(entry.label).toBe("Agent (Investigate the bug) · 3 tools · completed · 3.0s");
  });

  describe("heading", () => {
    it("names a live entry's agent, mode, and task", () => {
      const record = makeNavigable({ type: "general-purpose", description: "Investigate the bug" });
      const [entry] = listNavigableAgents([record], registry, []);
      expect(entry.heading).toEqual({ name: "Agent", modeLabel: "twin", description: "Investigate the bug" });
    });

    it("names a snapshot entry's agent, mode, and task", () => {
      const released = makeNavigable({
        isSessionReady: () => false,
        outputFile: "/tasks/released-1.jsonl",
        description: "Investigate the bug",
      });
      const [entry] = listNavigableAgents([released], registry, []);
      expect(entry.heading).toEqual({ name: "Agent", modeLabel: "twin", description: "Investigate the bug" });
    });

    it("carries no mode label for a replace-mode agent", () => {
      const [entry] = listNavigableAgents([makeNavigable({ type: "Explore", description: "Find auth files" })], registry, []);
      expect(entry.heading).toEqual({ name: "Explore", modeLabel: undefined, description: "Find auth files" });
    });
  });

  it("orders live entries before snapshot ones, and persisted runs last", () => {
    const live = makeNavigable({ id: "live-1", isSessionReady: () => true });
    const released = makeNavigable({ id: "released-1", isSessionReady: () => false, outputFile: "/tasks/x.jsonl" });
    const persisted = persistedRun({ id: "earlier", outputFile: "/tasks/earlier.jsonl" });
    const sources = listNavigableAgents([live, released], registry, [persisted]).map((e) =>
      e.kind === "live" ? e.record.id : e.outputFile,
    );
    expect(sources).toEqual(["live-1", "/tasks/x.jsonl", "/tasks/earlier.jsonl"]);
  });

  describe("persisted runs", () => {
    it("lists a persisted run with a transcript as a snapshot entry", () => {
      const entries = listNavigableAgents([], registry, [persistedRun()]);
      expect(entries).toEqual([
        {
          kind: "snapshot",
          outputFile: "/tasks/earlier.jsonl",
          heading: { name: "Agent", modeLabel: "twin", description: "Earlier task" },
          label: "Agent (Earlier task) · 7 tools · completed · 3.0s · session released (snapshot)",
        },
      ]);
    });

    it("lists a run the manager still holds once, from the manager", () => {
      const live = makeNavigable({ id: "earlier", isSessionReady: () => true });
      const entries = listNavigableAgents([live], registry, [persistedRun({ id: "earlier" })]);
      expect(entries.map((e) => e.kind)).toEqual(["live"]);
    });

    it("omits a persisted run that recorded no transcript", () => {
      expect(listNavigableAgents([], registry, [persistedRun({ outputFile: undefined })])).toEqual([]);
    });
  });

  describe("a run the limiter never admitted", () => {
    // Each run is enqueued at 1000, so 4_000 is 3 s later.
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(4_000);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const stoppedWhileQueued = {
      description: "Investigate the bug",
      toolUses: 3,
      status: "stopped",
      stoppedWhileQueued: true,
      startedAt: 1000,
      completedAt: 2000,
    } as const;

    it("labels a queued resume with its time in the queue, not as running", () => {
      const queued = makeNavigable({
        description: "Investigate the bug",
        toolUses: 3,
        status: "queued",
        startedAt: 1000,
        completedAt: undefined,
      });
      const [entry] = listNavigableAgents([queued], registry, []);
      expect(entry.label).toBe("Agent (Investigate the bug) · 3 tools · queued · queued 3.0s");
    });

    it("labels a resume stopped while queued with the time it waited, frozen at the stop", () => {
      const [entry] = listNavigableAgents([makeNavigable(stoppedWhileQueued)], registry, []);
      expect(entry.label).toBe("Agent (Investigate the bug) · 3 tools · stopped · queued 1.0s");
    });

    it("labels a released resume stopped while queued with the time it waited", () => {
      const released = makeNavigable({ ...stoppedWhileQueued, isSessionReady: () => false, outputFile: "/tasks/q.jsonl" });
      const [entry] = listNavigableAgents([released], registry, []);
      expect(entry.label).toBe("Agent (Investigate the bug) · 3 tools · stopped · queued 1.0s · session released (snapshot)");
    });

    it("labels a persisted resume stopped while queued with the time it waited", () => {
      const persisted = persistedRun({ status: "stopped", stoppedWhileQueued: true, startedAt: 1000, completedAt: 2000 });
      const [entry] = listNavigableAgents([], registry, [persisted]);
      expect(entry.label).toBe("Agent (Earlier task) · 7 tools · stopped · queued 1.0s · session released (snapshot)");
    });
  });
});

function persistedRun(overrides: Partial<PersistedRunSummary> = {}): PersistedRunSummary {
  return {
    id: "earlier",
    type: "general-purpose",
    description: "Earlier task",
    status: "completed",
    startedAt: 1000,
    completedAt: 4000,
    stoppedWhileQueued: false,
    toolUses: 7,
    outputFile: "/tasks/earlier.jsonl",
    ...overrides,
  };
}

describe("liveSource", () => {
  it("getMessages returns the record's agentMessages", () => {
    const messages = [{ role: "user", content: "hi" }] as unknown as SessionMessage[];
    const record = makeNavigable({ agentMessages: messages });
    expect(liveSource(record).getMessages()).toBe(messages);
  });

  it("subscribe delegates to subscribeToUpdates and forwards change notifications", () => {
    let captured: ((event: unknown) => void) | undefined;
    const unsub = vi.fn();
    const record = makeNavigable({
      subscribeToUpdates: vi.fn((fn: (event: unknown) => void) => {
        captured = fn;
        return unsub;
      }) as NavigableSubagent["subscribeToUpdates"],
    });
    const onChange = vi.fn();
    const returned = liveSource(record).subscribe(onChange);
    expect(record.subscribeToUpdates).toHaveBeenCalledOnce();
    const event = { type: "turn_end" } as AgentSessionEvent;
    captured?.(event);
    // The event is forwarded, not merely counted: the consumer routes on its
    // type to decide whether a streaming delta or a settled message arrived.
    expect(onChange).toHaveBeenCalledWith(event);
    expect(returned).toBe(unsub);
  });

  it("streaming returns activity state only while running", () => {
    const activeTools = new Map([["k", "read"]]);
    const running = makeNavigable({ status: "running", activeTools, responseText: "working" });
    expect(liveSource(running).streaming()).toEqual({ activeTools, responseText: "working" });

    const completed = makeNavigable({ status: "completed" });
    expect(liveSource(completed).streaming()).toBeUndefined();
  });

  it("sessionModel reads the record's model and thinking level at call time", () => {
    const record: { -readonly [K in keyof NavigableSubagent]: NavigableSubagent[K] } = makeNavigable();
    const source = liveSource(record);
    expect(source.sessionModel()).toEqual({ model: undefined, thinkingLevel: undefined });
    record.model = { provider: "anthropic", id: "claude-sonnet-5" };
    record.thinkingLevel = "high";
    expect(source.sessionModel()).toEqual({ model: { provider: "anthropic", id: "claude-sonnet-5" }, thinkingLevel: "high" });
  });

  it("getToolDefinition delegates to the record's getToolDefinition", () => {
    const def = { name: "read" } as unknown as ReturnType<TranscriptSource["getToolDefinition"]>;
    const record = makeNavigable({ getToolDefinition: vi.fn(() => def) });
    expect(liveSource(record).getToolDefinition("read")).toBe(def);
    expect(record.getToolDefinition).toHaveBeenCalledWith("read");
  });
});

describe("fileSnapshotSource", () => {
  const SESSION_JSONL = [
    { type: "session", version: 3, id: "s1", timestamp: "2026-06-23T00:00:00Z", cwd: "/proj" },
    { type: "message", id: "m1", parentId: null, timestamp: "2026-06-23T00:00:01Z", message: { role: "user", content: "do the thing" } },
    { type: "message", id: "m2", parentId: "m1", timestamp: "2026-06-23T00:00:02Z", message: { role: "assistant", content: [{ type: "text", text: "done" }] } },
  ]
    .map((entry) => JSON.stringify(entry))
    .join("\n");

  it("reads the file, drops the session header, and returns the parsed messages", () => {
    const readFile = vi.fn(() => SESSION_JSONL);
    const source = fileSnapshotSource("/tasks/agent.jsonl", readFile);
    expect(readFile).toHaveBeenCalledWith("/tasks/agent.jsonl");
    expect(source.getMessages()).toEqual([
      { role: "user", content: "do the thing" },
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    ]);
  });

  it("is a static snapshot: no subscription, no streaming, no tool definitions", () => {
    const source = fileSnapshotSource("/tasks/agent.jsonl", () => SESSION_JSONL);
    expect(source.subscribe(() => {})).toBeUndefined();
    expect(source.streaming()).toBeUndefined();
    expect(source.getToolDefinition("read")).toBeUndefined();
  });

  describe("sessionModel", () => {
    it("reports the model and thinking level the session recorded", () => {
      const jsonl = [
        SESSION_JSONL,
        JSON.stringify({ type: "model_change", id: "c1", parentId: "m2", timestamp: "2026-06-23T00:00:03Z", provider: "anthropic", modelId: "claude-sonnet-5" }),
        JSON.stringify({ type: "thinking_level_change", id: "c2", parentId: "c1", timestamp: "2026-06-23T00:00:04Z", thinkingLevel: "medium" }),
      ].join("\n");
      const source = fileSnapshotSource("/tasks/agent.jsonl", () => jsonl);
      expect(source.sessionModel()).toEqual({ model: { provider: "anthropic", id: "claude-sonnet-5" }, thinkingLevel: "medium" });
    });

    it("reports the model the last assistant message ran on", () => {
      const jsonl = [
        SESSION_JSONL,
        JSON.stringify({
          type: "message",
          id: "m3",
          parentId: "m2",
          timestamp: "2026-06-23T00:00:05Z",
          message: { role: "assistant", content: [{ type: "text", text: "again" }], provider: "openai", model: "gpt-6" },
        }),
      ].join("\n");
      const source = fileSnapshotSource("/tasks/agent.jsonl", () => jsonl);
      expect(source.sessionModel().model).toEqual({ provider: "openai", id: "gpt-6" });
    });

    it("reports no model for a session whose entries name none", () => {
      const source = fileSnapshotSource("/tasks/agent.jsonl", () => SESSION_JSONL);
      expect(source.sessionModel().model).toBeUndefined();
    });
  });

  it("returns an empty transcript for a header-only file", () => {
    const headerOnly = JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-06-23T00:00:00Z", cwd: "/proj" });
    const source = fileSnapshotSource("/tasks/empty.jsonl", () => headerOnly);
    expect(source.getMessages()).toEqual([]);
  });
});
