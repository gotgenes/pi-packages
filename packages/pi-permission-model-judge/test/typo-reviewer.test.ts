import type { Model } from "@earendil-works/pi-ai";
import type { PromptPermissionDetails } from "@gotgenes/pi-permission-system";
import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";

import type { ModelJudgeConfig } from "#src/config-schema";
import type { CompleteFn, ModelRegistryLike } from "#src/model-review";
import { createTypoReviewer } from "#src/typo-reviewer";
import { assistantToolCall } from "#test/fixtures/assistant-message";
import { makePromptDetails } from "#test/fixtures/permission-details";

const CONFIG: ModelJudgeConfig = {
  provider: "anthropic",
  model: "claude-haiku",
  instructions: "Flag doubled path segments.",
  typoPatterns: ["packages/pi-permission-system/packages/pi-permission-system"],
  timeoutMs: 5000,
};

const TYPO_PATH =
  "/x/packages/pi-permission-system/packages/pi-permission-system/src/a.ts";

const MODEL = { provider: "anthropic", id: "claude-haiku" } as Model<any>;

function makeDetails(
  overrides: Partial<PromptPermissionDetails> = {},
): PromptPermissionDetails {
  return makePromptDetails({ path: TYPO_PATH, ...overrides });
}

function makeRegistry(model: Model<any> | undefined): ModelRegistryLike {
  return {
    find: vi.fn(() => model),
    getApiKeyAndHeaders: vi.fn(async () => ({
      ok: true as const,
      apiKey: "sk-test",
      headers: {},
    })),
  };
}

function denyingComplete(): Mock<CompleteFn> {
  return vi.fn(async () =>
    assistantToolCall({
      verdict: "deny",
      reason: "Doubled segment; use pi-packages.",
    }),
  );
}

/** A fake review-log seam: `review` + `debug` as `vi.fn()` stubs. */
function makeLog() {
  return { review: vi.fn(), debug: vi.fn() };
}

describe("createTypoReviewer", () => {
  it("defers a non-external_directory surface without logging (not our surface)", async () => {
    const complete = denyingComplete();
    const registry = makeRegistry(MODEL);
    const log = makeLog();
    const authorize = createTypoReviewer({
      getConfig: () => CONFIG,
      getRegistry: () => registry,
      complete,
    });
    const verdict = await authorize(
      makeDetails({ surface: "bash", path: undefined, command: "ls" }),
      {} as never,
      log,
    );
    expect(verdict).toEqual({ kind: "defer" });
    expect(complete).not.toHaveBeenCalled();
    expect(registry.find).not.toHaveBeenCalled();
    expect(log.review).not.toHaveBeenCalled();
    expect(log.debug).not.toHaveBeenCalled();
  });

  it("defers when there is no config, without logging", async () => {
    const complete = denyingComplete();
    const log = makeLog();
    const authorize = createTypoReviewer({
      getConfig: () => undefined,
      getRegistry: () => makeRegistry(MODEL),
      complete,
    });
    const verdict = await authorize(makeDetails(), {} as never, log);
    expect(verdict).toEqual({ kind: "defer" });
    expect(complete).not.toHaveBeenCalled();
    expect(log.review).not.toHaveBeenCalled();
    expect(log.debug).not.toHaveBeenCalled();
  });

  it("debug-logs a no-path short-circuit and defers", async () => {
    const complete = denyingComplete();
    const log = makeLog();
    const authorize = createTypoReviewer({
      getConfig: () => CONFIG,
      getRegistry: () => makeRegistry(MODEL),
      complete,
    });
    const verdict = await authorize(
      makeDetails({ path: undefined, value: null }),
      {} as never,
      log,
    );
    expect(verdict).toEqual({ kind: "defer" });
    expect(complete).not.toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalledWith("model_judge.short_circuit", {
      requestId: "req-1",
      reason: "no-path",
    });
    expect(log.review).not.toHaveBeenCalled();
  });

  it("debug-logs a pattern-miss short-circuit and defers without a model call", async () => {
    const complete = denyingComplete();
    const registry = makeRegistry(MODEL);
    const log = makeLog();
    const authorize = createTypoReviewer({
      getConfig: () => CONFIG,
      getRegistry: () => registry,
      complete,
    });
    const verdict = await authorize(
      makeDetails({ path: "/x/pi-packages/src/a.ts" }),
      {} as never,
      log,
    );
    expect(verdict).toEqual({ kind: "defer" });
    expect(complete).not.toHaveBeenCalled();
    expect(registry.find).not.toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalledWith("model_judge.short_circuit", {
      requestId: "req-1",
      path: "/x/pi-packages/src/a.ts",
      reason: "pattern-miss",
    });
    expect(log.review).not.toHaveBeenCalled();
  });

  it("consults the model on a matched path, returns its verdict, and records the decision", async () => {
    const complete = denyingComplete();
    const log = makeLog();
    const authorize = createTypoReviewer({
      getConfig: () => CONFIG,
      getRegistry: () => makeRegistry(MODEL),
      complete,
    });
    const verdict = await authorize(makeDetails(), {} as never, log);
    expect(verdict).toEqual({
      kind: "deny",
      reason: "Doubled segment; use pi-packages.",
    });
    expect(complete).toHaveBeenCalledTimes(1);
    // A deny records a positive review entry with the matched pattern.
    expect(log.review).toHaveBeenCalledWith("model_judge.decision", {
      requestId: "req-1",
      surface: "external_directory",
      path: TYPO_PATH,
      matchedPattern: CONFIG.typoPatterns[0],
      modelCalled: true,
      modelId: "anthropic/claude-haiku",
      latencyMs: expect.any(Number),
      verdict: "deny",
      deferReason: null,
    });
    // The raw reply lands at debug level.
    expect(log.debug).toHaveBeenCalledWith("model_judge.model_reply", {
      requestId: "req-1",
      modelId: "anthropic/claude-haiku",
      rawReply: expect.stringContaining("Doubled segment"),
    });
  });

  it("records a defer with the model's defer reason", async () => {
    const complete: CompleteFn = vi.fn(async () =>
      assistantToolCall({ verdict: "defer" }),
    );
    const log = makeLog();
    const authorize = createTypoReviewer({
      getConfig: () => CONFIG,
      getRegistry: () => makeRegistry(MODEL),
      complete,
    });
    const verdict = await authorize(makeDetails(), {} as never, log);
    expect(verdict).toEqual({ kind: "defer" });
    expect(log.review).toHaveBeenCalledWith(
      "model_judge.decision",
      expect.objectContaining({
        modelCalled: true,
        verdict: "defer",
        deferReason: "non-deny-verdict",
      }),
    );
  });

  it("resolves auth and forwards the credentials into the completion", async () => {
    const complete = denyingComplete();
    const registry: ModelRegistryLike = {
      find: vi.fn(() => MODEL),
      getApiKeyAndHeaders: vi.fn(async () => ({
        ok: true as const,
        apiKey: "sk-resolved",
        headers: { "anthropic-beta": "oauth-2025" },
      })),
    };
    const authorize = createTypoReviewer({
      getConfig: () => CONFIG,
      getRegistry: () => registry,
      complete,
    });
    const verdict = await authorize(makeDetails(), {} as never, makeLog());
    expect(verdict).toEqual({
      kind: "deny",
      reason: "Doubled segment; use pi-packages.",
    });
    expect(registry.getApiKeyAndHeaders).toHaveBeenCalledWith(MODEL);
    const [, , options] = complete.mock.calls[0] as [
      unknown,
      unknown,
      { apiKey?: string; headers?: Record<string, string> },
    ];
    expect(options.apiKey).toBe("sk-resolved");
    expect(options.headers).toEqual({ "anthropic-beta": "oauth-2025" });
  });

  it("records an auth-failed defer without a model call", async () => {
    const complete = denyingComplete();
    const log = makeLog();
    const registry: ModelRegistryLike = {
      find: vi.fn(() => MODEL),
      getApiKeyAndHeaders: vi.fn(async () => ({
        ok: false as const,
        error: "no credentials configured",
      })),
    };
    const authorize = createTypoReviewer({
      getConfig: () => CONFIG,
      getRegistry: () => registry,
      complete,
    });
    const verdict = await authorize(makeDetails(), {} as never, log);
    expect(verdict).toEqual({ kind: "defer" });
    expect(complete).not.toHaveBeenCalled();
    expect(log.review).toHaveBeenCalledWith("model_judge.decision", {
      requestId: "req-1",
      surface: "external_directory",
      path: TYPO_PATH,
      matchedPattern: CONFIG.typoPatterns[0],
      modelCalled: false,
      modelId: "anthropic/claude-haiku",
      latencyMs: null,
      verdict: "defer",
      deferReason: "auth-failed",
    });
  });

  it("records a model-unresolved defer when the configured model does not resolve", async () => {
    const complete = denyingComplete();
    const log = makeLog();
    const authorize = createTypoReviewer({
      getConfig: () => CONFIG,
      getRegistry: () => makeRegistry(undefined),
      complete,
    });
    const verdict = await authorize(makeDetails(), {} as never, log);
    expect(verdict).toEqual({ kind: "defer" });
    expect(complete).not.toHaveBeenCalled();
    expect(log.review).toHaveBeenCalledWith(
      "model_judge.decision",
      expect.objectContaining({
        modelCalled: false,
        latencyMs: null,
        verdict: "defer",
        deferReason: "model-unresolved",
      }),
    );
  });

  it("reviews a bash-surfaced typo path carried only in accessIntent.matchValues", async () => {
    const complete = denyingComplete();
    const log = makeLog();
    const authorize = createTypoReviewer({
      getConfig: () => CONFIG,
      getRegistry: () => makeRegistry(MODEL),
      complete,
    });
    const verdict = await authorize(
      makeDetails({
        path: undefined,
        value: undefined,
        command: `cat ${TYPO_PATH}`,
        accessIntent: {
          surface: "external_directory",
          matchValues: [TYPO_PATH],
          boundaryValue: TYPO_PATH,
        },
      }),
      {} as never,
      log,
    );
    expect(verdict).toEqual({
      kind: "deny",
      reason: "Doubled segment; use pi-packages.",
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(log.review).toHaveBeenCalledWith("model_judge.decision", {
      requestId: "req-1",
      surface: "external_directory",
      path: TYPO_PATH,
      matchedPattern: CONFIG.typoPatterns[0],
      modelCalled: true,
      modelId: "anthropic/claude-haiku",
      latencyMs: expect.any(Number),
      verdict: "deny",
      deferReason: null,
    });
  });

  it("matches a later alias when the first candidate misses (first-match-wins)", async () => {
    const complete = denyingComplete();
    const log = makeLog();
    const authorize = createTypoReviewer({
      getConfig: () => CONFIG,
      getRegistry: () => makeRegistry(MODEL),
      complete,
    });
    const verdict = await authorize(
      makeDetails({
        path: undefined,
        value: undefined,
        accessIntent: {
          surface: "external_directory",
          matchValues: ["/x/pi-packages/src/a.ts", TYPO_PATH],
          boundaryValue: TYPO_PATH,
        },
      }),
      {} as never,
      log,
    );
    expect(verdict).toEqual({
      kind: "deny",
      reason: "Doubled segment; use pi-packages.",
    });
    // The matched alias (the second one), not the primary candidate, is recorded.
    expect(log.review).toHaveBeenCalledWith(
      "model_judge.decision",
      expect.objectContaining({ path: TYPO_PATH }),
    );
  });

  it("logs a pattern-miss with the primary candidate when no bash alias matches", async () => {
    const complete = denyingComplete();
    const registry = makeRegistry(MODEL);
    const log = makeLog();
    const authorize = createTypoReviewer({
      getConfig: () => CONFIG,
      getRegistry: () => registry,
      complete,
    });
    const verdict = await authorize(
      makeDetails({
        path: undefined,
        value: undefined,
        accessIntent: {
          surface: "external_directory",
          matchValues: ["/x/pi-packages/one.ts", "/x/pi-packages/two.ts"],
          boundaryValue: "/x/pi-packages/one.ts",
        },
      }),
      {} as never,
      log,
    );
    expect(verdict).toEqual({ kind: "defer" });
    expect(complete).not.toHaveBeenCalled();
    expect(registry.find).not.toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalledWith("model_judge.short_circuit", {
      requestId: "req-1",
      path: "/x/pi-packages/one.ts",
      reason: "pattern-miss",
    });
    expect(log.review).not.toHaveBeenCalled();
  });

  it("logs a no-path short-circuit when accessIntent carries no matchValues", async () => {
    const complete = denyingComplete();
    const log = makeLog();
    const authorize = createTypoReviewer({
      getConfig: () => CONFIG,
      getRegistry: () => makeRegistry(MODEL),
      complete,
    });
    const verdict = await authorize(
      makeDetails({
        path: undefined,
        value: undefined,
        accessIntent: {
          surface: "external_directory",
          matchValues: [],
          boundaryValue: null,
        },
      }),
      {} as never,
      log,
    );
    expect(verdict).toEqual({ kind: "defer" });
    expect(complete).not.toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalledWith("model_judge.short_circuit", {
      requestId: "req-1",
      reason: "no-path",
    });
    expect(log.review).not.toHaveBeenCalled();
  });

  it("reads the surface from accessIntent when the display surface is absent", async () => {
    const complete = denyingComplete();
    const authorize = createTypoReviewer({
      getConfig: () => CONFIG,
      getRegistry: () => makeRegistry(MODEL),
      complete,
    });
    const verdict = await authorize(
      makeDetails({
        surface: null,
        accessIntent: {
          surface: "external_directory",
          matchValues: [TYPO_PATH],
          boundaryValue: TYPO_PATH,
        },
      }),
      {} as never,
      makeLog(),
    );
    expect(verdict).toEqual({
      kind: "deny",
      reason: "Doubled segment; use pi-packages.",
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
