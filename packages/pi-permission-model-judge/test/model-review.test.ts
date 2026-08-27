import type { AssistantMessage, Context } from "@earendil-works/pi-ai";
import type { Mock } from "vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ModelJudgeConfig } from "#src/config-schema";
import {
  type CompleteFn,
  GENERIC_TEACHING_REASON,
  reviewPath,
} from "#src/model-review";
import {
  assistantText,
  assistantToolCall,
} from "#test/fixtures/assistant-message";

const CONFIG: ModelJudgeConfig = {
  provider: "anthropic",
  model: "claude-haiku",
  instructions: "Flag doubled path segments; explain the correct location.",
  typoPatterns: [".*"],
  timeoutMs: 5000,
};

// A minimal model stand-in — reviewPath only forwards it to `complete`.
const MODEL = { provider: "anthropic", id: "claude-haiku" } as never;

/** A `complete` seam that returns a forced tool call carrying `args`. */
function completeReporting(args: Record<string, unknown>): Mock<CompleteFn> {
  return vi.fn(async () => assistantToolCall(args));
}

describe("reviewPath", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("denies with the model's reason on a deny verdict", async () => {
    const args = { verdict: "deny", reason: "Wrong path; use pi-packages." };
    const complete = completeReporting(args);
    const outcome = await reviewPath({
      path: "/x/pi-permission-system/packages/pi-permission-system/a.ts",
      config: CONFIG,
      model: MODEL,
      complete,
    });
    expect(outcome.verdict).toEqual({
      kind: "deny",
      reason: "Wrong path; use pi-packages.",
    });
    // A deny carries no defer reason, but records the tool-call args + latency.
    expect(outcome.deferReason).toBeUndefined();
    expect(outcome.rawReply).toBe(JSON.stringify(args));
    expect(typeof outcome.latencyMs).toBe("number");
  });

  it("reads the tool call by position, ignoring the (rewritten) tool name", async () => {
    // The reply's tool call is named as the OAuth rewrite would name it.
    const complete: CompleteFn = vi.fn(async () =>
      assistantToolCall({ verdict: "deny", reason: "Doubled." }, "any_name"),
    );
    const outcome = await reviewPath({
      path: "/x/a.ts",
      config: CONFIG,
      model: MODEL,
      complete,
    });
    expect(outcome.verdict).toEqual({ kind: "deny", reason: "Doubled." });
  });

  it("substitutes a generic reason when a deny omits its reason", async () => {
    const complete = completeReporting({ verdict: "deny" });
    const outcome = await reviewPath({
      path: "/x/a.ts",
      config: CONFIG,
      model: MODEL,
      complete,
    });
    expect(outcome.verdict).toEqual({
      kind: "deny",
      reason: GENERIC_TEACHING_REASON,
    });
  });

  it("defers with reason non-deny-verdict on a defer verdict", async () => {
    const args = { verdict: "defer" };
    const complete = completeReporting(args);
    const outcome = await reviewPath({
      path: "/x/a.ts",
      config: CONFIG,
      model: MODEL,
      complete,
    });
    expect(outcome.verdict).toEqual({ kind: "defer" });
    expect(outcome.deferReason).toBe("non-deny-verdict");
    expect(outcome.rawReply).toBe(JSON.stringify(args));
  });

  it("defers with reason no-tool-call when the reply carries no tool call", async () => {
    const text = "I think this path is fine, honestly.";
    const complete: CompleteFn = vi.fn(async () => assistantText(text));
    const outcome = await reviewPath({
      path: "/x/a.ts",
      config: CONFIG,
      model: MODEL,
      complete,
    });
    expect(outcome.verdict).toEqual({ kind: "defer" });
    expect(outcome.deferReason).toBe("no-tool-call");
    // The model's text is retained for debug-level inspection.
    expect(outcome.rawReply).toBe(text);
  });

  it("defers with reason non-deny-verdict when the verdict value is unrecognized", async () => {
    const complete = completeReporting({ verdict: "maybe" });
    const outcome = await reviewPath({
      path: "/x/a.ts",
      config: CONFIG,
      model: MODEL,
      complete,
    });
    expect(outcome.verdict).toEqual({ kind: "defer" });
    expect(outcome.deferReason).toBe("non-deny-verdict");
  });

  it("defers with reason call-failed when complete rejects", async () => {
    const complete: CompleteFn = vi.fn(async () => {
      throw new Error("model unavailable");
    });
    const outcome = await reviewPath({
      path: "/x/a.ts",
      config: CONFIG,
      model: MODEL,
      complete,
    });
    expect(outcome.verdict).toEqual({ kind: "defer" });
    expect(outcome.deferReason).toBe("call-failed");
    // No reply arrived, so there is no raw text to record.
    expect(outcome.rawReply).toBeUndefined();
  });

  it("forces a single verdict tool and passes the instructions and path", async () => {
    const complete = completeReporting({ verdict: "defer" });
    await reviewPath({
      path: "/x/doubled/doubled/a.ts",
      config: CONFIG,
      model: MODEL,
      complete,
    });
    expect(complete).toHaveBeenCalledTimes(1);
    const [model, context, options] = complete.mock.calls[0] as [
      unknown,
      Context,
      { toolChoice?: string } | undefined,
    ];
    expect(model).toBe(MODEL);
    expect(context.systemPrompt).toBe(CONFIG.instructions);
    const firstMessage = context.messages[0] as { content: string };
    expect(firstMessage.content).toContain("/x/doubled/doubled/a.ts");
    // Exactly one tool, forced with toolChoice "any".
    expect(context.tools).toHaveLength(1);
    expect(context.tools?.[0]?.name).toBe("report_verdict");
    expect(options?.toolChoice).toBe("any");
  });

  it("forwards the resolved apiKey and headers into the completion", async () => {
    const complete = completeReporting({ verdict: "defer" });
    await reviewPath({
      path: "/x/a.ts",
      config: CONFIG,
      model: MODEL,
      complete,
      apiKey: "sk-test-123",
      headers: { "x-custom": "1" },
    });
    expect(complete).toHaveBeenCalledTimes(1);
    const [, , options] = complete.mock.calls[0] as [
      unknown,
      unknown,
      {
        signal?: AbortSignal;
        apiKey?: string;
        headers?: Record<string, string>;
      },
    ];
    expect(options.apiKey).toBe("sk-test-123");
    expect(options.headers).toEqual({ "x-custom": "1" });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("aborts the model call after timeoutMs and defers", async () => {
    vi.useFakeTimers();
    const complete: CompleteFn = vi.fn(
      (_model, _context, options) =>
        new Promise<AssistantMessage>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    );
    const promise = reviewPath({
      path: "/x/a.ts",
      config: { ...CONFIG, timeoutMs: 1000 },
      model: MODEL,
      complete,
    });
    await vi.advanceTimersByTimeAsync(1000);
    const outcome = await promise;
    expect(outcome.verdict).toEqual({ kind: "defer" });
    expect(outcome.deferReason).toBe("timeout");
  });
});
