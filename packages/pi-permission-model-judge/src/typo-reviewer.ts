/**
 * The deny-first typo-path reviewer: the `Authorizer` chain link this package
 * registers as `"model-judge"`.
 *
 * The decision runs top to bottom, deferring at the first miss so the cheap
 * gates short-circuit before any model call:
 *   1. surface is `external_directory` (else defer, silently — not our surface),
 *   2. a candidate path is present (else defer),
 *   3. the path matches a configured typo pattern (else defer, no model call),
 *   4. the model confirms the typo (deny with a teaching reason) or defers.
 *
 * Every failure path defers — more prompting, never less (ADR 0007 invariant 2).
 * This slice never emits `allow`.
 *
 * Observability (issue #626): once an ask matches a typo pattern (the [#625]
 * class — a candidate typo that *should* reach the model), the reviewer writes a
 * positive `model_judge.decision` review entry recording the outcome and, on a
 * defer, its reason — so a silent 100%-defer regression cannot hide again. The
 * cheap short-circuits (`no-path`, `pattern-miss`) and the raw model reply go to
 * the debug log; a non-`external_directory` surface is not logged at all.
 */

import type {
  Authorizer,
  AuthorizerLog,
  AuthorizerVerdict,
  PromptPermissionDetails,
} from "@gotgenes/pi-permission-system";

import type { ModelJudgeConfig } from "./config-schema";
import {
  type CompleteFn,
  type ModelCallDeferReason,
  type ModelRegistryLike,
  reviewPath,
} from "./model-review";
import type { ForcedToolChoice } from "./tool-choice";
import {
  type CompiledTypoPatterns,
  compileTypoPatterns,
  matchTypoPattern,
} from "./typo-patterns";

const REVIEWED_SURFACE = "external_directory";

/** Review-log event: one positive decision record per pattern-matched ask. */
const DECISION_EVENT = "model_judge.decision";
/** Debug-log event: a cheap short-circuit before the model stage. */
const SHORT_CIRCUIT_EVENT = "model_judge.short_circuit";
/** Debug-log event: the raw model reply, gated behind `debugLog`. */
const MODEL_REPLY_EVENT = "model_judge.model_reply";
/** Debug-log event: `typoPatterns` entries that failed to compile. */
const INVALID_PATTERNS_EVENT = "model_judge.invalid_patterns";

/** A defer decided before the model call, still recorded positively. */
type PreModelDeferReason = "model-unresolved" | "auth-failed";

/** The shared fields of a `model_judge.decision` record, before the outcome. */
interface DecisionBase {
  requestId: string;
  path: string;
  matchedPattern: string;
  modelId: string;
}

/**
 * One `model_judge.decision` record, whole.
 *
 * The model-call bookkeeping — latency, and the provider API and forcing value
 * the call was addressed with — is discriminated on `modelCalled`, so the "null
 * exactly when no call was made" rule is carried by the type rather than by two
 * object literals agreeing with each other.
 *
 * `api` and `toolChoice` are on the record because a wrong forcing spelling is
 * otherwise invisible: the call succeeds, the model answers in prose, and the
 * entry reads `no-tool-call` with nothing to distinguish it from a model that
 * simply declined the tool (#905).
 */
type DecisionRecord = DecisionBase & {
  verdict: AuthorizerVerdict["kind"];
  deferReason: ModelCallDeferReason | PreModelDeferReason | null;
} & (
    | {
        modelCalled: true;
        latencyMs: number;
        api: string;
        toolChoice: ForcedToolChoice;
      }
    | { modelCalled: false; latencyMs: null; api: null; toolChoice: null }
  );

/** Collaborators for the reviewer, injected so the extension and tests wire them. */
export interface TypoReviewerDeps {
  /** The loaded config, read live (absent until session config loads). */
  getConfig: () => ModelJudgeConfig | undefined;
  /** The session model registry, read live (captured at `session_start`). */
  getRegistry: () => ModelRegistryLike | undefined;
  /** The model-completion seam (production: `complete` from `@earendil-works/pi-ai`). */
  complete: CompleteFn;
}

/**
 * Build the `authorize` callback registered on the chain. The `query` argument
 * is unused in this slice — the deny-first reviewer decides from the path
 * pattern and the model, not from an engine re-query (slice 2 consumes it). The
 * `log` argument is the injected review-log seam the decision trail records to.
 */
export function createTypoReviewer(
  deps: TypoReviewerDeps,
): Authorizer["authorize"] {
  const compiledFor = memoizeCompiledPatterns();

  return async (details, _query, log) => {
    const config = deps.getConfig();
    if (!config) {
      return { kind: "defer" };
    }
    if (surfaceOf(details) !== REVIEWED_SURFACE) {
      return { kind: "defer" };
    }
    const { requestId } = details;
    const candidates = candidatePathsOf(details);
    if (candidates.length === 0) {
      log.debug(SHORT_CIRCUIT_EVENT, { requestId, reason: "no-path" });
      return { kind: "defer" };
    }
    const compiled = compiledFor(config, log);
    let matched: { path: string; matchedPattern: string } | undefined;
    for (const candidate of candidates) {
      const pattern = matchTypoPattern(candidate, compiled);
      if (pattern !== undefined) {
        matched = { path: candidate, matchedPattern: pattern };
        break;
      }
    }
    if (matched === undefined) {
      log.debug(SHORT_CIRCUIT_EVENT, {
        requestId,
        path: candidates[0],
        reason: "pattern-miss",
      });
      return { kind: "defer" };
    }
    const { path, matchedPattern } = matched;

    const modelId = `${config.provider}/${config.model}`;
    const base: DecisionBase = { requestId, path, matchedPattern, modelId };
    const registry = deps.getRegistry();
    const model = registry?.find(config.provider, config.model);
    if (!registry || !model) {
      return deferWith(log, base, "model-unresolved");
    }
    const auth = await registry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      return deferWith(log, base, "auth-failed");
    }

    const outcome = await reviewPath({
      path,
      config,
      model,
      complete: deps.complete,
      apiKey: auth.apiKey,
      headers: auth.headers,
    });
    if (outcome.rawReply !== undefined) {
      log.debug(MODEL_REPLY_EVENT, {
        requestId,
        modelId,
        rawReply: outcome.rawReply,
      });
    }
    writeDecision(log, {
      ...base,
      modelCalled: true,
      latencyMs: outcome.latencyMs,
      api: outcome.api,
      toolChoice: outcome.toolChoice,
      verdict: outcome.verdict.kind,
      deferReason: outcome.deferReason ?? null,
    });
    return outcome.verdict;
  };
}

/**
 * Record a pre-model defer (`model-unresolved` / `auth-failed`) as a positive
 * `model_judge.decision` entry and return the defer verdict — so the two
 * model-resolution failures leave evidence on record, not a silent absence.
 */
function deferWith(
  log: AuthorizerLog,
  base: DecisionBase,
  deferReason: PreModelDeferReason,
): AuthorizerVerdict {
  writeDecision(log, {
    ...base,
    modelCalled: false,
    latencyMs: null,
    api: null,
    toolChoice: null,
    verdict: "defer",
    deferReason,
  });
  return { kind: "defer" };
}

/**
 * Write one decision record to the review log. The only writer of
 * `DECISION_EVENT`, so neither caller can omit a field or spell the surface
 * differently.
 */
function writeDecision(log: AuthorizerLog, record: DecisionRecord): void {
  log.review(DECISION_EVENT, { surface: REVIEWED_SURFACE, ...record });
}

/** The gate-authoritative surface, falling back to the display surface. */
function surfaceOf(details: PromptPermissionDetails): string | undefined {
  return details.accessIntent?.surface ?? details.surface ?? undefined;
}

/**
 * Candidate paths to test against the typo patterns, most authoritative first.
 *
 * `accessIntent.matchValues` is the raising gate's authoritative path alias set
 * (absolute ∪ cwd-relative ∪ canonical) — present for both file-tool and
 * `bash` external_directory asks, and the only place a `bash`-surfaced path
 * appears (the gate sets `command`/`accessIntent`, never `path`). `path` and
 * `value` are fallbacks for a details bag without `accessIntent` (an older
 * forwarded request or a hand-built local ask). `value` is last because a
 * forwarded `bash` ask's display value is the command string, not a path.
 */
function candidatePathsOf(details: PromptPermissionDetails): string[] {
  const seen = new Set<string>();
  for (const value of details.accessIntent?.matchValues ?? []) {
    seen.add(value);
  }
  if (details.path !== undefined) {
    seen.add(details.path);
  }
  if (details.value != null) {
    seen.add(details.value);
  }
  return [...seen];
}

/**
 * Compile a config's patterns once and reuse the result while the same config
 * object is in effect — the config is stable per session, so this avoids
 * recompiling the regexes on every ask.
 */
function memoizeCompiledPatterns(): (
  config: ModelJudgeConfig,
  log: AuthorizerLog,
) => CompiledTypoPatterns {
  let cache:
    | { config: ModelJudgeConfig; compiled: CompiledTypoPatterns }
    | undefined;
  return (config, log) => {
    if (cache?.config === config) {
      return cache.compiled;
    }
    const compiled = compileTypoPatterns(config.typoPatterns);
    if (compiled.invalidPatterns.length > 0) {
      log.debug(INVALID_PATTERNS_EVENT, {
        invalidPatterns: compiled.invalidPatterns,
      });
    }
    cache = { config, compiled };
    return compiled;
  };
}
