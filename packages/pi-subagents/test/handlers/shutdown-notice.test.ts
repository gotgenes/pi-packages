import { describe, expect, it } from "vitest";
import { buildShutdownNotice, type StoppedAgent } from "#src/handlers/shutdown-notice";

const running: StoppedAgent = {
  id: "a1b2c3",
  type: "general-purpose",
  description: "Refactor auth module",
  stoppedWhileQueued: false,
  outputFile: "/sessions/parent/tasks/a1b2c3.jsonl",
};

const queued: StoppedAgent = {
  id: "d4e5f6",
  type: "Explore",
  description: "Find callers",
  stoppedWhileQueued: true,
  outputFile: undefined,
};

describe("buildShutdownNotice", () => {
  describe("message envelope", () => {
    it("is a displayed subagent-shutdown-notice", () => {
      expect(buildShutdownNotice("reload", [queued])).toEqual({
        customType: "subagent-shutdown-notice",
        content: [
          "`/reload` stopped these subagents before they finished, so their results will not arrive:",
          '- `d4e5f6` (Explore) "Find callers": was queued.',
          "Spawn them again if the work is still needed.",
        ].join("\n"),
        display: true,
      });
    });
  });

  describe("cause by shutdown reason", () => {
    it.each([
      ["reload", "`/reload`"],
      ["quit", "Quitting Pi"],
      ["new", "Starting a new session"],
      ["resume", "Switching sessions"],
      ["fork", "Forking the session"],
    ])("names %s as %s", (reason, cause) => {
      const [header] = buildShutdownNotice(reason, [queued]).content.split("\n");
      expect(header).toBe(`${cause} stopped these subagents before they finished, so their results will not arrive:`);
    });

    it.each([
      ["a missing reason", undefined],
      ["an unknown reason", "detach"],
    ])("falls back to a generic cause for %s", (_label, reason) => {
      const [header] = buildShutdownNotice(reason, [queued]).content.split("\n");
      expect(header).toBe("Ending the session stopped these subagents before they finished, so their results will not arrive:");
    });
  });

  describe("one line per stopped agent", () => {
    function agentLines(agents: readonly StoppedAgent[]): string[] {
      return buildShutdownNotice("reload", agents).content.split("\n").slice(1, -1);
    }

    it("states a running agent and its transcript", () => {
      expect(agentLines([running])).toEqual([
        '- `a1b2c3` (general-purpose) "Refactor auth module": was running. Transcript: `/sessions/parent/tasks/a1b2c3.jsonl`',
      ]);
    });

    it("states a running agent with no transcript yet", () => {
      expect(agentLines([{ ...running, outputFile: undefined }])).toEqual([
        '- `a1b2c3` (general-purpose) "Refactor auth module": was running.',
      ]);
    });

    it("states a queued agent with no transcript", () => {
      expect(agentLines([queued])).toEqual(['- `d4e5f6` (Explore) "Find callers": was queued.']);
    });

    it("states a queued resume with its earlier transcript", () => {
      expect(agentLines([{ ...queued, outputFile: "/sessions/parent/tasks/d4e5f6.jsonl" }])).toEqual([
        '- `d4e5f6` (Explore) "Find callers": was queued. Transcript: `/sessions/parent/tasks/d4e5f6.jsonl`',
      ]);
    });

    it("keeps the order the agents were stopped in", () => {
      expect(agentLines([queued, running]).map((line) => line.slice(0, 10))).toEqual(["- `d4e5f6`", "- `a1b2c3`"]);
    });
  });
});
