import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  getActiveAgentName,
  getActiveAgentNameFromSystemPrompt,
} from "#src/active-agent";
import { toRecord } from "#src/common";
import type {
  PermissionPromptDecision,
  RequestPermissionOptions,
} from "#src/permission-dialog";
import {
  emitUiPromptEvent,
  PERMISSIONS_PROTOCOL_VERSION,
  type PermissionEventBus,
  type PermissionUiPromptEvent,
} from "#src/permission-events";
import {
  type ForwardedPermissionRequest,
  type ForwardedPermissionResponse,
  isForwardedPermissionRequestForSession,
  PERMISSION_FORWARDING_POLL_INTERVAL_MS,
  PERMISSION_FORWARDING_TIMEOUT_MS,
  resolvePermissionForwardingTargetSessionId,
  SUBAGENT_PARENT_SESSION_ENV_CANDIDATES,
} from "#src/permission-forwarding";
import { isSubagentExecutionContext } from "#src/subagent-context";
import type { SubagentSessionRegistry } from "#src/subagent-registry";

import {
  cleanupPermissionForwardingLocationIfEmpty,
  ensurePermissionForwardingLocation,
  type ForwardedPermissionLogger,
  getExistingPermissionForwardingLocation,
  listRequestFiles,
  logPermissionForwardingError,
  logPermissionForwardingWarning,
  readForwardedPermissionRequest,
  readForwardedPermissionResponse,
  safeDeleteFile,
  sleep,
  writeJsonFileAtomic,
} from "./io";

export interface PermissionForwardingDeps {
  forwardingDir: string;
  subagentSessionsDir: string;
  /** In-process subagent session registry for detection and forwarding target resolution. */
  registry?: SubagentSessionRegistry;
  /** Event bus used for UI prompt broadcasts. */
  events?: PermissionEventBus;
  logger: ForwardedPermissionLogger;
  writeReviewLog: (event: string, details: Record<string, unknown>) => void;
  requestPermissionDecisionFromUi: (
    ui: ExtensionContext["ui"],
    title: string,
    message: string,
    options?: RequestPermissionOptions,
  ) => Promise<PermissionPromptDecision>;
  shouldAutoApprove: () => boolean;
}

export function getSessionId(ctx: ExtensionContext): string {
  try {
    const sessionId = ctx.sessionManager.getSessionId();
    if (typeof sessionId === "string" && sessionId.trim()) {
      return sessionId.trim();
    }
  } catch {}

  return "unknown";
}

function getContextSystemPrompt(ctx: ExtensionContext): string | undefined {
  const getSystemPrompt = toRecord(ctx).getSystemPrompt;
  if (typeof getSystemPrompt !== "function") {
    return undefined;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- getSystemPrompt is a Pi SDK accessor returning any
    const systemPrompt = getSystemPrompt.call(ctx);
    return typeof systemPrompt === "string" ? systemPrompt : undefined;
  } catch (error) {
    // No deps available in this helper — warning silently dropped.
    logPermissionForwardingWarning(
      null,
      "Failed to read context system prompt for forwarded permission metadata",
      error,
    );
    return undefined;
  }
}

export function formatForwardedPermissionPrompt(
  request: ForwardedPermissionRequest,
): string {
  const agentName = request.requesterAgentName || "unknown";
  const sessionId = request.requesterSessionId || "unknown";
  return [
    `Subagent '${agentName}' requested permission.`,
    `Session ID: ${sessionId}`,
    "",
    request.message,
  ].join("\n");
}

export async function waitForForwardedPermissionApproval(
  ctx: ExtensionContext,
  message: string,
  deps: PermissionForwardingDeps,
): Promise<PermissionPromptDecision> {
  const requesterSessionId = getSessionId(ctx);
  const targetSessionId = resolvePermissionForwardingTargetSessionId({
    hasUI: ctx.hasUI,
    isSubagent: isSubagentExecutionContext(
      ctx,
      deps.subagentSessionsDir,
      deps.registry,
    ),
    currentSessionId: requesterSessionId,
    env: process.env,
    sessionId: requesterSessionId,
    registry: deps.registry,
  });

  if (!targetSessionId) {
    logPermissionForwardingError(
      deps.logger,
      `Permission forwarding target session could not be resolved. ` +
        `Checked env vars: ${SUBAGENT_PARENT_SESSION_ENV_CANDIDATES.join(", ")}. ` +
        `If you are using a subagent extension (nicobailon/pi-subagents, HazAT/pi-interactive-subagents, etc.), ` +
        `ask its maintainer to set PI_SUBAGENT_PARENT_SESSION in the child process environment ` +
        `(see https://github.com/gotgenes/pi-permission-system/issues/143).`,
    );
    return { approved: false, state: "denied" };
  }

  const location = ensurePermissionForwardingLocation(
    deps.logger,
    deps.forwardingDir,
    targetSessionId,
  );
  if (!location) {
    logPermissionForwardingError(
      deps.logger,
      `Permission forwarding is unavailable because session-scoped directories could not be prepared for '${targetSessionId}'`,
    );
    return { approved: false, state: "denied" };
  }

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${process.pid}`;
  const requesterAgentName =
    getActiveAgentName(ctx) ??
    getActiveAgentNameFromSystemPrompt(getContextSystemPrompt(ctx)) ??
    "unknown";
  const request: ForwardedPermissionRequest = {
    id: requestId,
    createdAt: Date.now(),
    requesterSessionId,
    targetSessionId,
    requesterAgentName,
    message,
  };

  const requestPath = join(location.requestsDir, `${requestId}.json`);
  const responsePath = join(location.responsesDir, `${requestId}.json`);

  deps.writeReviewLog("forwarded_permission.request_created", {
    requestId,
    requesterAgentName,
    requesterSessionId: request.requesterSessionId,
    targetSessionId,
    requestPath,
    responsePath,
  });

  try {
    writeJsonFileAtomic(deps.logger, requestPath, request);
  } catch (error) {
    logPermissionForwardingError(
      deps.logger,
      `Failed to write forwarded permission request '${requestPath}'`,
      error,
    );
    return { approved: false, state: "denied" };
  }

  const deadline = Date.now() + PERMISSION_FORWARDING_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (existsSync(responsePath)) {
      const response = readForwardedPermissionResponse(
        deps.logger,
        responsePath,
      );
      deps.writeReviewLog("forwarded_permission.response_received", {
        requestId,
        approved: response?.approved ?? null,
        state: response?.state ?? null,
        denialReason: response?.denialReason ?? null,
        responderSessionId: response?.responderSessionId ?? null,
        targetSessionId,
        responsePath,
      });
      safeDeleteFile(
        deps.logger,
        responsePath,
        "forwarded permission response",
      );
      safeDeleteFile(deps.logger, requestPath, "forwarded permission request");
      cleanupPermissionForwardingLocationIfEmpty(deps.logger, location);
      return response ?? { approved: false, state: "denied" };
    }

    await sleep(PERMISSION_FORWARDING_POLL_INTERVAL_MS);
  }

  logPermissionForwardingWarning(
    deps.logger,
    `Timed out waiting for forwarded permission response '${responsePath}'`,
  );
  deps.writeReviewLog("forwarded_permission.response_timed_out", {
    requestId,
    requesterAgentName,
    targetSessionId,
    responsePath,
  });
  safeDeleteFile(deps.logger, requestPath, "forwarded permission request");
  cleanupPermissionForwardingLocationIfEmpty(deps.logger, location);
  return { approved: false, state: "denied" };
}

export async function processForwardedPermissionRequests(
  ctx: ExtensionContext,
  deps: PermissionForwardingDeps,
): Promise<void> {
  if (!ctx.hasUI) {
    return;
  }

  const currentSessionId = getSessionId(ctx);
  const location = getExistingPermissionForwardingLocation(
    deps.forwardingDir,
    currentSessionId,
  );
  if (!location) {
    return;
  }

  const requestFiles = listRequestFiles(deps.logger, location.requestsDir);
  if (requestFiles.length === 0) {
    return;
  }

  for (const fileName of requestFiles) {
    const requestPath = join(location.requestsDir, fileName);
    const request = readForwardedPermissionRequest(deps.logger, requestPath);
    if (!request) {
      safeDeleteFile(
        deps.logger,
        requestPath,
        `${location.label} forwarded permission request`,
      );
      continue;
    }

    if (!isForwardedPermissionRequestForSession(request, currentSessionId)) {
      logPermissionForwardingWarning(
        deps.logger,
        `Ignoring forwarded permission request '${request.id}' because it targets session '${request.targetSessionId}' instead of '${currentSessionId}'`,
      );
      safeDeleteFile(
        deps.logger,
        requestPath,
        `${location.label} forwarded permission request`,
      );
      continue;
    }

    const forwardedPermissionLogDetails = {
      requestId: request.id,
      source: location.label,
      requesterAgentName: request.requesterAgentName,
      requesterSessionId: request.requesterSessionId,
      targetSessionId: request.targetSessionId,
      requestPath,
    };

    let decision: PermissionPromptDecision = {
      approved: false,
      state: "denied",
    };
    if (deps.shouldAutoApprove()) {
      deps.writeReviewLog(
        "forwarded_permission.auto_approved",
        forwardedPermissionLogDetails,
      );
      decision = { approved: true, state: "approved" };
    } else {
      deps.writeReviewLog(
        "forwarded_permission.prompted",
        forwardedPermissionLogDetails,
      );
      try {
        if (deps.events) {
          const message = formatForwardedPermissionPrompt(request);
          emitUiPromptEvent(deps.events, {
            protocolVersion: PERMISSIONS_PROTOCOL_VERSION,
            requestId: request.id,
            source: "forwarded_permission",
            surface: null,
            value: request.message,
            agentName: request.requesterAgentName || null,
            message,
            toolCallId: null,
            toolName: null,
            skillName: null,
            path: null,
            command: null,
            target: request.message,
            toolInputPreview: null,
            sessionLabel: null,
          });
        }
        decision = await deps.requestPermissionDecisionFromUi(
          ctx.ui,
          "Permission Required (Subagent)",
          formatForwardedPermissionPrompt(request),
        );
      } catch (error) {
        logPermissionForwardingError(
          deps.logger,
          "Failed to show forwarded permission confirmation dialog",
          error,
        );
        decision = { approved: false, state: "denied" };
      }
    }

    const responsePath = join(location.responsesDir, `${request.id}.json`);
    deps.writeReviewLog(
      decision.approved
        ? "forwarded_permission.approved"
        : "forwarded_permission.denied",
      {
        requestId: request.id,
        source: location.label,
        requesterAgentName: request.requesterAgentName,
        requesterSessionId: request.requesterSessionId,
        targetSessionId: request.targetSessionId,
        responsePath,
        resolution: decision.state,
        denialReason: decision.denialReason ?? null,
      },
    );
    try {
      writeJsonFileAtomic(deps.logger, responsePath, {
        approved: decision.approved,
        state: decision.state,
        denialReason: decision.denialReason,
        responderSessionId: currentSessionId,
        respondedAt: Date.now(),
      } satisfies ForwardedPermissionResponse);
    } catch (error) {
      logPermissionForwardingError(
        deps.logger,
        `Failed to write ${location.label} forwarded permission response '${responsePath}'`,
        error,
      );
      continue;
    }

    safeDeleteFile(
      deps.logger,
      requestPath,
      `${location.label} forwarded permission request`,
    );
  }

  cleanupPermissionForwardingLocationIfEmpty(deps.logger, location);
}

export async function confirmPermission(
  ctx: ExtensionContext,
  message: string,
  deps: PermissionForwardingDeps,
  options?: RequestPermissionOptions,
  uiPromptEvent?: PermissionUiPromptEvent,
): Promise<PermissionPromptDecision> {
  if (ctx.hasUI) {
    if (deps.events && uiPromptEvent) {
      emitUiPromptEvent(deps.events, uiPromptEvent);
    }
    return deps.requestPermissionDecisionFromUi(
      ctx.ui,
      "Permission Required",
      message,
      options,
    );
  }

  if (
    !isSubagentExecutionContext(ctx, deps.subagentSessionsDir, deps.registry)
  ) {
    return { approved: false, state: "denied" };
  }

  return waitForForwardedPermissionApproval(ctx, message, deps);
}
