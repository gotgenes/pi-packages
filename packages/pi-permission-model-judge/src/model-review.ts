/**
 * The model call: ask a light model whether a candidate path is a typo, bounded
 * by `timeoutMs`, and map its reply to a `deny | defer` verdict.
 *
 * Fail-safe throughout — an unparseable reply, an unrecognized verdict, a
 * thrown or timed-out `complete`, all resolve to `defer` (more prompting, never
 * less). This slice never emits `allow`.
 */

import type {
  AssistantMessage,
  Context,
  Model,
  ProviderHeaders,
  TextContent,
  Tool,
  ToolCall,
} from "@earendil-works/pi-ai";
import type { AuthorizerVerdict } from "@gotgenes/pi-permission-system";

import type { ModelJudgeConfig } from "./config-schema";
import { type ForcedToolChoice, resolveToolChoice } from "./tool-choice";

/** The reason used for a deny when the model omits its own. */
export const GENERIC_TEACHING_REASON =
  "This looks like a mistyped path. Verify the correct location before retrying.";

/**
 * The single tool the model is forced to call. Forcing it removes free-text JSON
 * parsing by construction — the verdict arrives as structured `arguments`, so a
 * Markdown fence or a prose preamble can no longer cost a verdict. The forcing
 * value itself is per provider API; see `tool-choice.ts`.
 *
 * The Anthropic provider reads only `parameters.properties` / `parameters.required`,
 * so a plain JSON-Schema object is correct at runtime; the `as unknown as Tool`
 * bridge satisfies the `TSchema`-typed `parameters` field without a `typebox`
 * dependency.
 */
const VERDICT_TOOL = {
  name: "report_verdict",
  description:
    "Report whether the path is a mistyped path to reject (deny) or should be deferred to the human (defer).",
  parameters: {
    type: "object",
    properties: {
      verdict: {
        type: "string",
        enum: ["deny", "defer"],
        description: "deny a mistyped path; defer anything else",
      },
      reason: {
        type: "string",
        description:
          "Why the path is wrong and the correct location (required when denying)",
      },
    },
    required: ["verdict"],
  },
} as unknown as Tool;

/**
 * The injected model-completion seam — structurally the `complete` export of
 * `@earendil-works/pi-ai`. Injected so tests substitute a fake.
 */
export type CompleteFn = (
  model: Model<any>,
  context: Context,
  options?: {
    signal?: AbortSignal;
    apiKey?: string;
    headers?: ProviderHeaders;
    toolChoice?: ForcedToolChoice;
  },
) => Promise<AssistantMessage>;

/**
 * The auth resolved for a model call — structurally the `ResolvedRequestAuth`
 * of the core `ModelRegistry`, redeclared here because that type is not
 * re-exported from `@earendil-works/pi-coding-agent`.
 */
export type ResolvedRequestAuth =
  | { ok: true; apiKey?: string; headers?: ProviderHeaders }
  | { ok: false; error: string };

/** The narrow model-registry projection the reviewer needs (ISP). */
export interface ModelRegistryLike {
  find(provider: string, modelId: string): Model<any> | undefined;
  getApiKeyAndHeaders(model: Model<any>): Promise<ResolvedRequestAuth>;
}

/** Inputs for a single path review. */
export interface ReviewPathInputs {
  path: string;
  config: ModelJudgeConfig;
  model: Model<any>;
  complete: CompleteFn;
  apiKey?: string;
  headers?: ProviderHeaders;
}

/**
 * Why a model call defers, distinct enough to diagnose from the decision trail:
 * the reply carried no tool call to read (`no-tool-call`), the tool call named a
 * verdict other than `deny` (`non-deny-verdict`), the call was aborted at
 * `timeoutMs` (`timeout`), or `complete` threw for any other reason
 * (`call-failed` — the honest superset that catches, e.g., a 401 slipping past
 * pre-call auth resolution).
 */
export type ModelCallDeferReason =
  | "no-tool-call"
  | "non-deny-verdict"
  | "timeout"
  | "call-failed";

/**
 * The full result of a model review: the verdict plus the observability the
 * decision trail records. `deferReason` is set iff the verdict is `defer` and a
 * model call was made; `rawReply` carries the tool-call arguments as JSON when a
 * tool call arrived, or the assistant text on a `no-tool-call` defer (absent on
 * a timeout/throw before any reply).
 */
export interface ReviewOutcome {
  verdict: AuthorizerVerdict;
  deferReason?: ModelCallDeferReason;
  latencyMs: number;
  rawReply?: string;
  /** The `Model.api` the call was addressed to. */
  api: string;
  /** The forcing spelling actually sent, so a mismatch is readable from the trail. */
  toolChoice: ForcedToolChoice;
}

/**
 * Review one candidate path with the model and return the structured outcome.
 *
 * The call is aborted after `config.timeoutMs`; an abort, a rejection, or any
 * non-`deny` reply yields `defer` (more prompting, never less) with the reason
 * annotated so the caller can record why.
 */
export async function reviewPath(
  inputs: ReviewPathInputs,
): Promise<ReviewOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, inputs.config.timeoutMs);
  const startedAt = Date.now();
  // Resolved before the call so a timeout or a rejection still reports what
  // went on the wire. A model without an `api` resolves to the default spelling,
  // the same as an api the map does not name.
  const api = typeof inputs.model.api === "string" ? inputs.model.api : "";
  const toolChoice = resolveToolChoice(api);
  try {
    const context: Context = {
      systemPrompt: inputs.config.instructions,
      tools: [VERDICT_TOOL],
      messages: [
        {
          role: "user",
          content: renderReviewPrompt(inputs.path),
          timestamp: Date.now(),
        },
      ],
    };
    const reply = await inputs.complete(inputs.model, context, {
      signal: controller.signal,
      apiKey: inputs.apiKey,
      headers: inputs.headers,
      toolChoice,
    });
    return {
      ...readToolCallOutcome(reply),
      latencyMs: Date.now() - startedAt,
      api,
      toolChoice,
    };
  } catch {
    return {
      verdict: { kind: "defer" },
      deferReason: controller.signal.aborted ? "timeout" : "call-failed",
      latencyMs: Date.now() - startedAt,
      api,
      toolChoice,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** The user-turn prompt: hand the model the path and point it at the tool. */
function renderReviewPrompt(path: string): string {
  return [
    "A tool is about to access this path outside the working directory:",
    "",
    path,
    "",
    'Call report_verdict. Use verdict "deny" with a reason naming the correct location if this is a mistyped path; otherwise use verdict "defer".',
  ].join("\n");
}

/**
 * Map the forced tool call to a verdict; anything but a clean `deny` defers with
 * the reason that distinguishes it. The tool call is read by position (the first
 * one), not by name — under OAuth the provider rewrites the registered name, so
 * the reply's tool-call name cannot be relied on.
 *
 * Per-call bookkeeping such as `latencyMs` is stamped by `reviewPath`, which
 * owns the call — keeping it out of here means a new per-call field lands at one
 * place rather than at every verdict branch.
 */
function readToolCallOutcome(
  reply: AssistantMessage,
): Pick<ReviewOutcome, "verdict" | "deferReason" | "rawReply"> {
  const call = reply.content.find(
    (part): part is ToolCall => part.type === "toolCall",
  );
  if (!call) {
    return {
      verdict: { kind: "defer" },
      deferReason: "no-tool-call",
      rawReply: extractText(reply),
    };
  }
  const args = call.arguments;
  const rawReply = JSON.stringify(args);
  if (args.verdict !== "deny") {
    return {
      verdict: { kind: "defer" },
      deferReason: "non-deny-verdict",
      rawReply,
    };
  }
  const reason =
    typeof args.reason === "string" && args.reason.length > 0
      ? args.reason
      : GENERIC_TEACHING_REASON;
  return { verdict: { kind: "deny", reason }, rawReply };
}

/** Concatenate the text parts of an assistant reply. */
function extractText(reply: AssistantMessage): string {
  return reply.content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("");
}
