import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEventData,
  buildNotificationDetails,
  escapeXml,
  formatTaskNotification,
  getStatusLabel,
  NotificationManager,
} from "#src/observation/notification";
import { createTestSubagent } from "#test/helpers/make-subagent";

// ---- Pure helper tests ----

describe("escapeXml", () => {
  it("escapes &, <, >", () => {
    expect(escapeXml("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
  });

  it("returns unchanged string with no special chars", () => {
    expect(escapeXml("hello world")).toBe("hello world");
  });
});

describe("getStatusLabel", () => {
  it('returns error message for "error"', () => {
    expect(getStatusLabel("error", "timeout")).toBe("Error: timeout");
  });

  it('returns "unknown" when error is undefined', () => {
    expect(getStatusLabel("error")).toBe("Error: unknown");
  });

  it('returns label for "aborted"', () => {
    expect(getStatusLabel("aborted")).toBe("Aborted (max turns exceeded)");
  });

  it('returns label for "steered"', () => {
    expect(getStatusLabel("steered")).toBe("Wrapped up (turn limit)");
  });

  it('returns "Done" for completed', () => {
    expect(getStatusLabel("completed")).toBe("Done");
  });
});

describe("formatTaskNotification", () => {
  const baseRecord = createTestSubagent();

  it("produces valid XML structure", () => {
    const xml = formatTaskNotification(baseRecord, 500);
    expect(xml).toContain("<task-notification>");
    expect(xml).toContain("</task-notification>");
    expect(xml).toContain("<task-id>agent-1</task-id>");
    expect(xml).toContain("<status>Done</status>");
  });

  it("truncates long results", () => {
    const longResult = "x".repeat(600);
    const record = createTestSubagent({ result: longResult });
    const xml = formatTaskNotification(record, 100);
    expect(xml).toContain("truncated");
    expect(xml).not.toContain(longResult);
  });

  it("shows No output when result is undefined", () => {
    const record = createTestSubagent({ result: undefined });
    const xml = formatTaskNotification(record, 500);
    expect(xml).toContain("No output.");
  });

  it("includes toolCallId from record.toolCallId when present", () => {
    const record = createTestSubagent({ toolCallId: "tc-123" });
    const xml = formatTaskNotification(record, 500);
    expect(xml).toContain("<tool-use-id>tc-123</tool-use-id>");
  });

  it("excludes toolCallId when absent", () => {
    const xml = formatTaskNotification(baseRecord, 500);
    expect(xml).not.toContain("tool-use-id");
  });
});

describe("buildNotificationDetails", () => {
  const baseRecord = createTestSubagent({
    description: "Test",
    result: "Done.",
    toolUses: 2,
    completedAt: 3000,
    lifetimeUsage: { input: 100, output: 200, cacheWrite: 0 },
  });

  it("maps record fields to notification shape", () => {
    const details = buildNotificationDetails(baseRecord, 500);
    expect(details.id).toBe("agent-1");
    expect(details.description).toBe("Test");
    expect(details.status).toBe("completed");
    expect(details.toolUses).toBe(2);
    expect(details.durationMs).toBe(2000);
    expect(details.totalTokens).toBe(300);
    expect(details.resultPreview).toBe("Done.");
  });

  it("reads turnCount and maxTurns from the record", () => {
    const record = createTestSubagent({
      description: "Test", result: "Done.", toolUses: 2,
      completedAt: 3000, lifetimeUsage: { input: 100, output: 200, cacheWrite: 0 },
      turnCount: 7, maxTurns: 10,
    });
    const details = buildNotificationDetails(record, 500);
    expect(details.turnCount).toBe(7);
    expect(details.maxTurns).toBe(10);
  });

  it("truncates long result previews with ellipsis", () => {
    const record = createTestSubagent({ description: "Test", result: "x".repeat(600), toolUses: 2, completedAt: 3000, lifetimeUsage: { input: 100, output: 200, cacheWrite: 0 } });
    const details = buildNotificationDetails(record, 100);
    expect(details.resultPreview).toHaveLength(101); // 100 chars + "…"
    expect(details.resultPreview.endsWith("…")).toBe(true);
  });
});

describe("buildEventData", () => {
  const baseRecord = createTestSubagent({
    type: "Explore",
    description: "Search files",
    result: "Found 3 files",
    toolUses: 5,
    lifetimeUsage: { input: 1000, output: 500, cacheWrite: 0 },
  });

  it("includes all expected fields", () => {
    const data = buildEventData(baseRecord);
    expect(data).toEqual({
      id: "agent-1",
      type: "Explore",
      description: "Search files",
      result: "Found 3 files",
      error: undefined,
      status: "completed",
      toolUses: 5,
      durationMs: 1000,
      tokens: { input: 1000, output: 500, total: 1500 },
    });
  });

  it("omits tokens when total is zero", () => {
    const record = createTestSubagent({ type: "Explore", description: "Search files", result: "Found 3 files", toolUses: 5, lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 } });
    const data = buildEventData(record);
    expect(data.tokens).toBeUndefined();
  });

  it("uses Date.now() fallback when completedAt is undefined", () => {
    vi.useFakeTimers();
    vi.setSystemTime(5000);
    const record = createTestSubagent({ type: "Explore", description: "Search files", result: "Found 3 files", toolUses: 5, lifetimeUsage: { input: 1000, output: 500, cacheWrite: 0 }, completedAt: undefined });
    const data = buildEventData(record);
    expect(data.durationMs).toBe(4000); // 5000 - 1000
    vi.useRealTimers();
  });
});

// ---- Factory tests ----

describe("NotificationManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeArgs() {
    return {
      sendMessage: vi.fn(),
    };
  }

  function makeManager(args: ReturnType<typeof makeArgs>) {
    return new NotificationManager(args.sendMessage);
  }

  const baseRecord = createTestSubagent({
    description: "Test",
    result: "Done.",
    toolUses: 2,
    lifetimeUsage: { input: 100, output: 200, cacheWrite: 0 },
  });

  it("sendCompletion schedules a nudge after the hold delay", () => {
    const args = makeArgs();
    const system = makeManager(args);
    system.sendCompletion(baseRecord);
    vi.advanceTimersByTime(300);
    expect(args.sendMessage).toHaveBeenCalledOnce();
  });

  it("every nudge carries the retrieval instruction", () => {
    const args = makeArgs();
    const system = makeManager(args);
    system.sendCompletion(baseRecord);
    vi.advanceTimersByTime(300);
    const content = (args.sendMessage.mock.calls[0][0] as { content: string }).content;
    expect(content).toContain("get_subagent_result");
  });

  it("sendCompletion skips the nudge when the record is already consumed (schedule-time guard)", () => {
    const args = makeArgs();
    const system = makeManager(args);
    const consumedRecord = createTestSubagent({ id: "consumed-1", consumedAt: 5000 });
    system.sendCompletion(consumedRecord);
    vi.advanceTimersByTime(300);
    expect(args.sendMessage).not.toHaveBeenCalled();
  });

  it("suppresses a scheduled nudge when the record becomes consumed before it fires (fire-time re-check)", () => {
    const args = makeArgs();
    const system = makeManager(args);
    const record = createTestSubagent({ id: "race-1" });
    system.sendCompletion(record);
    record.markConsumed(); // parent pulled during the hold window
    vi.advanceTimersByTime(300);
    expect(args.sendMessage).not.toHaveBeenCalled();
  });

  it("dispose clears all pending timers", () => {
    const args = makeArgs();
    const system = makeManager(args);
    system.sendCompletion(baseRecord);
    system.dispose();
    vi.advanceTimersByTime(300);
    expect(args.sendMessage).not.toHaveBeenCalled();
  });

  describe("parent-turn awareness", () => {
    it("holds a nudge that fires while the parent agent is streaming and delivers it on agent end", () => {
      const args = makeArgs();
      const system = makeManager(args);
      const record = createTestSubagent({ id: "held-1" });
      system.onParentAgentStart();
      system.sendCompletion(record);
      vi.advanceTimersByTime(300);
      // Not handed to pi's followUp queue mid-turn — held where consumed is still consultable.
      expect(args.sendMessage).not.toHaveBeenCalled();
      system.onParentAgentEnd();
      expect(args.sendMessage).toHaveBeenCalledOnce();
    });

    it("suppresses a held nudge when the record is consumed before agent end (fire→pull→turn-end race)", () => {
      const args = makeArgs();
      const system = makeManager(args);
      const record = createTestSubagent({ id: "race-2" });
      system.onParentAgentStart();
      system.sendCompletion(record);
      vi.advanceTimersByTime(300); // nudge fires mid-turn
      record.markConsumed(); // parent pulls via get_subagent_result later in the same turn
      system.onParentAgentEnd();
      expect(args.sendMessage).not.toHaveBeenCalled();
    });

    it("delivers at fire time when the parent went idle before the hold elapsed", () => {
      const args = makeArgs();
      const system = makeManager(args);
      const record = createTestSubagent({ id: "idle-1" });
      system.onParentAgentStart();
      system.onParentAgentEnd();
      system.sendCompletion(record);
      vi.advanceTimersByTime(300);
      expect(args.sendMessage).toHaveBeenCalledOnce();
    });

    it("does not duplicate a held nudge when the agent re-completes before agent end", () => {
      const args = makeArgs();
      const system = makeManager(args);
      const record = createTestSubagent({ id: "recomplete-1" });
      system.onParentAgentStart();
      system.sendCompletion(record);
      vi.advanceTimersByTime(300);
      system.sendCompletion(record); // e.g. a resumed run reaching terminal state again
      vi.advanceTimersByTime(300);
      system.onParentAgentEnd();
      expect(args.sendMessage).toHaveBeenCalledOnce();
    });

    it("dispose clears held nudges", () => {
      const args = makeArgs();
      const system = makeManager(args);
      const record = createTestSubagent({ id: "disposed-1" });
      system.onParentAgentStart();
      system.sendCompletion(record);
      vi.advanceTimersByTime(300);
      system.dispose();
      system.onParentAgentEnd();
      expect(args.sendMessage).not.toHaveBeenCalled();
    });
  });
});
