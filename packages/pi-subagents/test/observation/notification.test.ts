import { describe, expect, it, vi } from "vitest";
import {
  buildEventData,
  buildNotificationDetails,
  escapeXml,
  formatTaskNotification,
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

  it("escapes double and single quotes (attribute-safe)", () => {
    expect(escapeXml('say "hi" it\'s fine')).toBe("say &quot;hi&quot; it&apos;s fine");
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

  describe("an agent stopped before it ever started", () => {
    // Stats are seeded non-zero by the factory: a never-started block omits
    // <usage> because the agent never ran, not because the numbers are zero.
    const neverStarted = createTestSubagent({
      status: "stopped",
      stoppedWhileQueued: true,
      result: undefined,
      toolCallId: "tc-123",
    });

    it("emits a trimmed block that claims no result and no usage", () => {
      expect(formatTaskNotification(neverStarted, 500)).toBe(
        [
          "<task-notification>",
          "<task-id>agent-1</task-id>",
          "<tool-use-id>tc-123</tool-use-id>",
          "<status>Stopped before starting</status>",
          '<summary>Subagent "Test task" was stopped while queued and never started</summary>',
          "</task-notification>",
        ].join("\n"),
      );
    });

    it("omits the tool-use-id when the spawn carried none", () => {
      const record = createTestSubagent({ status: "stopped", stoppedWhileQueued: true, result: undefined });
      expect(formatTaskNotification(record, 500)).not.toContain("tool-use-id");
    });
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

  it("previews a never-started agent as never started, not as empty output", () => {
    const record = createTestSubagent({ status: "stopped", stoppedWhileQueued: true, result: undefined });
    const details = buildNotificationDetails(record, 500);
    expect(details.resultPreview).toBe("Never started — stopped while queued.");
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

  it("sendCompletion delivers the nudge immediately when the parent is idle", () => {
    const args = makeArgs();
    const system = makeManager(args);
    system.sendCompletion(baseRecord);
    expect(args.sendMessage).toHaveBeenCalledOnce();
  });

  it("every nudge carries the retrieval instruction", () => {
    const args = makeArgs();
    const system = makeManager(args);
    system.sendCompletion(baseRecord);
    const content = (args.sendMessage.mock.calls[0][0] as { content: string }).content;
    expect(content).toContain("get_subagent_result");
  });

  it("surfaces a declared question as answerable in the nudge", () => {
    const args = makeArgs();
    const system = makeManager(args);
    system.sendCompletion(
      createTestSubagent({ id: "agent-3", pendingQuestion: "Which config?" }),
    );
    const content = (args.sendMessage.mock.calls[0][0] as { content: string }).content;
    expect(content).toContain("This agent is waiting on an answer:");
    expect(content).toContain("Which config?");
    expect(content).toContain('resume: "agent-3"');
  });

  it("omits the retrieval instruction for an agent that never started", () => {
    const args = makeArgs();
    const system = makeManager(args);
    const record = createTestSubagent({ status: "stopped", stoppedWhileQueued: true, result: undefined });
    system.sendCompletion(record);
    const content = (args.sendMessage.mock.calls[0][0] as { content: string }).content;
    expect(content).toBe(formatTaskNotification(record, 500));
  });

  it("sendCompletion skips the nudge when the record is already consumed (enqueue-time guard)", () => {
    const args = makeArgs();
    const system = makeManager(args);
    const consumedRecord = createTestSubagent({ id: "consumed-1", consumedAt: 5000 });
    system.sendCompletion(consumedRecord);
    expect(args.sendMessage).not.toHaveBeenCalled();
  });

  describe("disposal", () => {
    // At session_shutdown no parent run is active, so sendCompletion would
    // otherwise skip the withhold queue and hand Pi an unrecallable followUp.
    it("sends nothing after dispose, with no parent run to defer to", () => {
      const args = makeArgs();
      const system = makeManager(args);
      system.dispose();
      system.sendCompletion(baseRecord);
      expect(args.sendMessage).not.toHaveBeenCalled();
    });

    it("withholds a never-started agent's nudge while the parent run is active", () => {
      const args = makeArgs();
      const system = makeManager(args);
      const record = createTestSubagent({
        id: "never-1",
        status: "stopped",
        stoppedWhileQueued: true,
        result: undefined,
      });

      // The ESC path: InterruptHandler stops queued agents from inside the
      // parent's run, so the nudge waits for agent_settled like any other.
      system.onParentAgentStart();
      system.sendCompletion(record);
      expect(args.sendMessage).not.toHaveBeenCalled();

      system.onParentAgentSettled();
      expect(args.sendMessage).toHaveBeenCalledOnce();
    });
  });

  describe("parent-turn boundary", () => {
    /** The agent id a delivered notification block names. */
    function taskIdOf(content: string): string {
      return /<task-id>([^<]*)<\/task-id>/.exec(content)?.[1] ?? "";
    }

    /**
     * Models Pi's delivery semantics. While the parent's agent run is active a
     * `followUp` is queued unrecallably and drained at turn end; once the run has
     * settled (`_isAgentRunActive` is already false when extensions are notified)
     * a `triggerTurn` message starts a fresh turn.
     * See `agent-session.ts:1443-1450` and `:581-582`.
     */
    function makePiParent() {
      const deliveredToLlm: string[] = [];
      let runActive = false;
      const manager = new NotificationManager((msg, opts) => {
        if (runActive && opts?.deliverAs === "followUp") {
          deliveredToLlm.push(msg.content); // handed to the unrecallable queue
        } else if (opts?.triggerTurn) {
          deliveredToLlm.push(msg.content);
        }
      });
      return {
        manager,
        deliveredToLlm,
        startRun() {
          runActive = true;
          manager.onParentAgentStart();
        },
        settleRun() {
          runActive = false;
          manager.onParentAgentSettled();
        },
      };
    }

    it("withholds a nudge that arrives while the parent's run is active", () => {
      const parent = makePiParent();
      parent.startRun();
      parent.manager.sendCompletion(createTestSubagent({ id: "held-1" }));
      expect(parent.deliveredToLlm).toHaveLength(0);
    });

    it("delivers the withheld nudge once the run settles when the parent never pulled", () => {
      const parent = makePiParent();
      parent.startRun();
      parent.manager.sendCompletion(createTestSubagent({ id: "kept-1" }));
      parent.settleRun();
      expect(parent.deliveredToLlm).toHaveLength(1);
    });

    it("suppresses the nudge when the parent pulls the result later in the same turn", () => {
      const parent = makePiParent();
      const record = createTestSubagent({ id: "race-1" });
      parent.startRun();
      parent.manager.sendCompletion(record);
      record.markConsumed(); // get_subagent_result, later in the same turn
      parent.settleRun();
      expect(parent.deliveredToLlm).toHaveLength(0);
    });

    it("collapses a re-completion during the same turn into a single delivery", () => {
      const parent = makePiParent();
      const record = createTestSubagent({ id: "recomplete-1" });
      parent.startRun();
      parent.manager.sendCompletion(record);
      parent.manager.sendCompletion(record); // e.g. a resumed run reaching terminal state again
      parent.settleRun();
      expect(parent.deliveredToLlm).toHaveLength(1);
    });

    it("flushes nudges from different agents in the order they arrived", () => {
      const parent = makePiParent();
      parent.startRun();
      parent.manager.sendCompletion(createTestSubagent({ id: "first-1" }));
      parent.manager.sendCompletion(createTestSubagent({ id: "second-1" }));
      parent.settleRun();
      expect(parent.deliveredToLlm.map(taskIdOf)).toEqual(["first-1", "second-1"]);
    });

    it("keeps a re-completed agent in the queue position it first took", () => {
      const parent = makePiParent();
      const early = createTestSubagent({ id: "early-1" });
      parent.startRun();
      parent.manager.sendCompletion(early);
      parent.manager.sendCompletion(createTestSubagent({ id: "late-1" }));
      parent.manager.sendCompletion(early); // the resumed run terminates again
      parent.settleRun();
      expect(parent.deliveredToLlm.map(taskIdOf)).toEqual(["early-1", "late-1"]);
    });

    it("delivers immediately when the parent is idle at completion", () => {
      const parent = makePiParent();
      parent.manager.sendCompletion(createTestSubagent({ id: "idle-1" }));
      expect(parent.deliveredToLlm).toHaveLength(1);
    });

    it("dispose drops nudges withheld for the current run", () => {
      const parent = makePiParent();
      parent.startRun();
      parent.manager.sendCompletion(createTestSubagent({ id: "disposed-1" }));
      parent.manager.dispose();
      parent.settleRun();
      expect(parent.deliveredToLlm).toHaveLength(0);
    });

    describe("a running child's mid-run update", () => {
      it("is delivered immediately when the parent is idle", () => {
        const parent = makePiParent();
        parent.manager.sendUpdate(createTestSubagent({ id: "live-1" }), "Course change.");
        expect(parent.deliveredToLlm).toHaveLength(1);
      });

      it("is withheld while the parent's run is active, then flushed", () => {
        const parent = makePiParent();
        parent.startRun();
        parent.manager.sendUpdate(createTestSubagent({ id: "live-1" }), "Course change.");
        expect(parent.deliveredToLlm).toHaveLength(0);
        parent.settleRun();
        expect(parent.deliveredToLlm).toHaveLength(1);
      });

      it("is dropped after dispose, like every other announcement", () => {
        const parent = makePiParent();
        parent.manager.dispose();
        parent.manager.sendUpdate(createTestSubagent({ id: "live-1" }), "Course change.");
        expect(parent.deliveredToLlm).toHaveLength(0);
      });

      it("keeps every update, because two updates are two facts", () => {
        const parent = makePiParent();
        const record = createTestSubagent({ id: "live-1" });
        parent.startRun();
        parent.manager.sendUpdate(record, "First finding.");
        parent.manager.sendUpdate(record, "Second finding.");
        parent.settleRun();
        expect(parent.deliveredToLlm).toHaveLength(2);
      });

      it("keeps its place ahead of the same child's later completion", () => {
        const parent = makePiParent();
        const record = createTestSubagent({ id: "live-1" });
        parent.startRun();
        parent.manager.sendUpdate(record, "Course change.");
        parent.manager.sendCompletion(record);
        parent.settleRun();
        expect(parent.deliveredToLlm.map((c) => c.slice(0, 18))).toEqual([
          "<subagent-update>\n",
          "<task-notification",
        ]);
      });

      it("is announced even after the parent collected an earlier outcome", () => {
        const parent = makePiParent();
        const record = createTestSubagent({ id: "live-1" });
        record.markConsumed();

        parent.manager.sendUpdate(record, "Course change.");

        // Consumption records that the *outcome* was collected. An update is a
        // new fact, so the gate that silences a duplicate outcome does not apply.
        expect(parent.deliveredToLlm).toHaveLength(1);
      });

      it("is announced even while a carrier holds the outcome", () => {
        const parent = makePiParent();
        const record = createTestSubagent({ id: "live-1" });
        record.claim();

        parent.manager.sendUpdate(record, "Course change.");

        expect(parent.deliveredToLlm).toHaveLength(1);
      });
    });
  });
});
