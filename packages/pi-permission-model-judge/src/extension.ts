/**
 * Extension wiring: load the config at `session_start`, register the
 * `"model-judge"` link from the `permissions:ready` handler, and dispose on
 * shutdown.
 *
 * The ready event fires at least once per session and may repeat, and its
 * latch emission at the node's first `before_agent_start` runs after every
 * extension's `session_start` (ADR 0012 decision 3) — so the handler alone is
 * a sufficient registration site, needing only an idempotence guard. The
 * event's `sessionId` keys the service of the node that emitted it, which is
 * the node whose chain consults this link.
 */

import { complete as realComplete } from "@earendil-works/pi-ai";
import {
  type ExtensionAPI,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import type { PermissionsReadyEvent } from "@gotgenes/pi-permission-system";
import {
  getPermissionsService,
  PERMISSIONS_READY_CHANNEL,
} from "@gotgenes/pi-permission-system";

import { type LoadConfigResult, loadModelJudgeConfig } from "./config-loader";
import {
  MODEL_JUDGE_EXTENSION_ID,
  type ModelJudgeConfig,
} from "./config-schema";
import type { CompleteFn, ModelRegistryLike } from "./model-review";
import { createTypoReviewer } from "./typo-reviewer";

/** The operator-facing chain-link name referenced from `authorizerChain`. */
const LINK_NAME = "model-judge";

/** Injectable seams; production defaults read the filesystem and call the model. */
export interface ModelJudgeDependencies {
  loadConfig?: (cwd: string) => LoadConfigResult;
  complete?: CompleteFn;
}

function warn(message: string): void {
  console.warn(`[${MODEL_JUDGE_EXTENSION_ID}] ${message}`);
}

export function createModelJudgeExtension(
  pi: ExtensionAPI,
  dependencies: ModelJudgeDependencies = {},
): void {
  // `getAgentDir()` is read here rather than hoisted out of the lambda so the
  // env read happens only on the production path, and only when a config is
  // actually loaded — it honors `PI_CODING_AGENT_DIR`, matching where
  // pi-permission-system looks for the same global scope.
  const loadConfig =
    dependencies.loadConfig ??
    ((cwd: string) => loadModelJudgeConfig({ cwd, agentDir: getAgentDir() }));
  const complete: CompleteFn =
    dependencies.complete ??
    ((model, context, options) => realComplete(model, context, options));

  let config: ModelJudgeConfig | undefined;
  let registry: ModelRegistryLike | undefined;
  let dispose: (() => void) | undefined;
  let warnedUnresolvedService = false;

  pi.on("session_start", (_event, ctx) => {
    const result = loadConfig(ctx.cwd);
    config = result.config;
    registry = ctx.modelRegistry;
    for (const issue of result.issues) {
      warn(
        `config issue at ${issue.sourcePath ?? "(merged)"} — ${issue.path}: ${issue.message}`,
      );
    }
  });

  pi.events.on(PERMISSIONS_READY_CHANNEL, (data) => {
    // A repeat emission must be a no-op, and a session with no config of its
    // own registers nothing: that is the operator declining the link.
    if (dispose || !config) {
      return;
    }
    const sessionId = readySessionId(data);
    const service =
      sessionId === null ? undefined : getPermissionsService(sessionId);
    if (!service) {
      warnUnresolvedService();
      return;
    }
    const authorize = createTypoReviewer({
      getConfig: () => config,
      getRegistry: () => registry,
      complete,
    });
    dispose = service.registerAuthorizer(LINK_NAME, authorize);
  });

  pi.on("session_shutdown", () => {
    dispose?.();
    dispose = undefined;
    config = undefined;
    registry = undefined;
    warnedUnresolvedService = false;
  });

  /**
   * Report, once per session, that the link this session was configured for is
   * not registered — the vacancy would otherwise be visible only as the
   * absence of `model_judge` entries in the review log.
   */
  function warnUnresolvedService(): void {
    if (warnedUnresolvedService) {
      return;
    }
    warnedUnresolvedService = true;
    warn(
      "this session's node published no permission service, so the model-judge link is not registered — @gotgenes/pi-permission-system 27.0.0 or later must be loaded in the same session.",
    );
  }
}

/** The payload's session id, or `null` for any shape that cannot key the locator. */
function readySessionId(data: unknown): string | null {
  const sessionId = (data as Partial<PermissionsReadyEvent> | undefined)
    ?.sessionId;
  return typeof sessionId === "string" ? sessionId : null;
}
