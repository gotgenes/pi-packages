/**
 * The fail-closed boundary is the only tool_call handler the SDK sees.
 *
 * The SDK's emitToolCall (@earendil-works/pi-coding-agent dist/core/extensions/
 * runner.js) awaits the registered handler with NO try/catch — unlike
 * emitUserBash directly below it, which catches and continues. So a thrown
 * gate would otherwise yield no block and the command would run ungated with
 * no trace. This boundary must absorb the throw and fail closed.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { DecisionReporter } from "#src/decision-reporter";
import type { GateOutcome } from "#src/handlers/gates/types";
import { createFailClosedToolCall } from "#src/handlers/tool-call-boundary";

import { makeReporter } from "#test/helpers/gate-fixtures";
import { makeCtx, makeToolCallEvent } from "#test/helpers/handler-fixtures";

function makeAudit() {
  return {
    recordDecision: vi.fn<(action: "allow" | "block") => void>(),
    recordError: vi.fn<() => void>(),
  };
}

function makeTracer() {
  return {
    debug: vi.fn<(event: string, details?: Record<string, unknown>) => void>(),
  };
}

function gateReturning(outcome: GateOutcome) {
  return vi
    .fn<(event: unknown, ctx: ExtensionContext) => Promise<GateOutcome>>()
    .mockResolvedValue(outcome);
}

function gateThrowing(message: string) {
  return vi
    .fn<(event: unknown, ctx: ExtensionContext) => Promise<GateOutcome>>()
    .mockRejectedValue(new Error(message));
}

describe("createFailClosedToolCall", () => {
  it("translates an allow outcome to the empty SDK shape", async () => {
    const audit = makeAudit();
    const reporter = makeReporter();
    const boundary = createFailClosedToolCall(
      gateReturning({ action: "allow" }),
      reporter,
      audit,
      makeTracer(),
    );

    const result = await boundary(makeToolCallEvent("read"), makeCtx());

    expect(result).toEqual({});
    expect(audit.recordDecision).toHaveBeenCalledWith("allow");
    expect(audit.recordError).not.toHaveBeenCalled();
    expect(reporter.writeReviewLog).not.toHaveBeenCalled();
  });

  it("translates a block outcome to the SDK block shape with the reason", async () => {
    const audit = makeAudit();
    const reporter = makeReporter();
    const boundary = createFailClosedToolCall(
      gateReturning({ action: "block", reason: "denied by policy" }),
      reporter,
      audit,
      makeTracer(),
    );

    const result = await boundary(makeToolCallEvent("read"), makeCtx());

    expect(result).toEqual({ block: true, reason: "denied by policy" });
    expect(audit.recordDecision).toHaveBeenCalledWith("block");
  });

  it("writes a per-call decision trace with the tool name and action", async () => {
    const tracer = makeTracer();
    const boundary = createFailClosedToolCall(
      gateReturning({ action: "allow" }),
      makeReporter(),
      makeAudit(),
      tracer,
    );

    await boundary(makeToolCallEvent("bash"), makeCtx());

    expect(tracer.debug).toHaveBeenCalledWith(
      "permission.decision",
      expect.objectContaining({ toolName: "bash", action: "allow" }),
    );
  });

  it("blocks fail-closed when the gate throws, recording an error and a review-log entry", async () => {
    const audit = makeAudit();
    const reporter = makeReporter();
    const gate = vi
      .fn<(event: unknown, ctx: ExtensionContext) => Promise<GateOutcome>>()
      .mockRejectedValue(new Error("parser init failed"));
    const boundary = createFailClosedToolCall(
      gate,
      reporter,
      audit,
      makeTracer(),
    );

    const event = makeToolCallEvent("bash", {
      input: { command: "cd /repo && git push" },
    });
    const result = await boundary(event, makeCtx());

    expect((result as { block?: true }).block).toBe(true);
    expect(audit.recordError).toHaveBeenCalledTimes(1);
    expect(audit.recordDecision).not.toHaveBeenCalled();
    expect(reporter.writeReviewLog).toHaveBeenCalledWith(
      "permission_request.blocked",
      expect.objectContaining({
        requestId: expect.stringMatching(/^perm-/),
        toolName: "bash",
        command: "cd /repo && git push",
        resolution: "gate_error",
        error: "parser init failed",
        decidedBy: { kind: "gate_error", reason: "parser init failed" },
      }),
    );
  });

  it("identifies each errored call separately", async () => {
    const reporter = makeReporter();
    const gate = vi
      .fn<(event: unknown, ctx: ExtensionContext) => Promise<GateOutcome>>()
      .mockRejectedValue(new Error("parser init failed"));
    const boundary = createFailClosedToolCall(
      gate,
      reporter,
      makeAudit(),
      makeTracer(),
    );

    await boundary(makeToolCallEvent("bash"), makeCtx());
    await boundary(makeToolCallEvent("bash"), makeCtx());

    const ids = vi
      .mocked(reporter.writeReviewLog)
      .mock.calls.map(([, details]) => details.requestId);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("still blocks when recording the gate error itself throws", async () => {
    const reporter = makeReporter({
      writeReviewLog: () => {
        throw new Error("review log unwritable");
      },
    });
    const gate = vi
      .fn<(event: unknown, ctx: ExtensionContext) => Promise<GateOutcome>>()
      .mockRejectedValue(new Error("parser init failed"));
    const boundary = createFailClosedToolCall(
      gate,
      reporter,
      makeAudit(),
      makeTracer(),
    );

    const result = await boundary(makeToolCallEvent("bash"), makeCtx());

    expect((result as { block?: true }).block).toBe(true);
  });

  it("does not throw when the event is malformed and the gate throws", async () => {
    const audit = makeAudit();
    const reporter = makeReporter();
    const gate = vi
      .fn<(event: unknown, ctx: ExtensionContext) => Promise<GateOutcome>>()
      .mockRejectedValue("non-error rejection");
    const boundary = createFailClosedToolCall(
      gate,
      reporter,
      audit,
      makeTracer(),
    );

    const result = await boundary(undefined, makeCtx());

    expect((result as { block?: true }).block).toBe(true);
    expect(reporter.writeReviewLog).toHaveBeenCalledWith(
      "permission_request.blocked",
      expect.objectContaining({
        resolution: "gate_error",
        error: "non-error rejection",
      }),
    );
  });

  describe("terminal decision broadcast", () => {
    /** Captures the request id the review entry recorded for the same block. */
    function makeIdCapturingReporter(): {
      reporter: DecisionReporter;
      loggedRequestId: () => string;
    } {
      let logged = "";
      const reporter = makeReporter({
        writeReviewLog: vi.fn(
          (_event: string, details: Record<string, unknown>) => {
            logged = String(details.requestId);
          },
        ),
      });
      return { reporter, loggedRequestId: () => logged };
    }

    it("broadcasts a deny decision joined to the gate_error review entry", async () => {
      const { reporter, loggedRequestId } = makeIdCapturingReporter();
      const boundary = createFailClosedToolCall(
        gateThrowing("parser init failed"),
        reporter,
        makeAudit(),
        makeTracer(),
      );

      await boundary(
        makeToolCallEvent("bash", { input: { command: "git push" } }),
        makeCtx(),
      );

      expect(reporter.emitDecision).toHaveBeenCalledWith({
        requestId: loggedRequestId(),
        surface: "bash",
        value: "git push",
        result: "deny",
        resolution: "gate_error",
        origin: null,
        agentName: null,
        matchedPattern: null,
      });
    });

    it("names the tool as the value when the errored call carries no command", async () => {
      const reporter = makeReporter();
      const boundary = createFailClosedToolCall(
        gateThrowing("parser init failed"),
        reporter,
        makeAudit(),
        makeTracer(),
      );

      await boundary(makeToolCallEvent("read"), makeCtx());

      expect(reporter.emitDecision).toHaveBeenCalledWith(
        expect.objectContaining({ surface: "read", value: "read" }),
      );
    });

    it("still blocks when the broadcast itself throws", async () => {
      const reporter = makeReporter({
        emitDecision: () => {
          throw new Error("listener exploded");
        },
      });
      const boundary = createFailClosedToolCall(
        gateThrowing("parser init failed"),
        reporter,
        makeAudit(),
        makeTracer(),
      );

      const result = await boundary(makeToolCallEvent("bash"), makeCtx());

      expect((result as { block?: true }).block).toBe(true);
    });
  });
});
